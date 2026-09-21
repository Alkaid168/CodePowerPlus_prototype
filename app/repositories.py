"""数据访问层：只负责读写 SQLite，不判断业务规则。

分析记录是**不可变**的：每次保存都插一行新版本，最新一行就是当前分析。
审核状态由该版本最新的一条审核记录决定（没有审核记录时看 initial_status）。
"""
from __future__ import annotations

import json

from app.db import FIRST_PROBLEM_ID, Database, utcnow

ANALYSIS_COLUMNS = ('id', 'problem_id', 'payload', 'origin', 'initial_status', 'taxonomy_version', 'created_at')
SUBMISSION_COLUMNS = ('id', 'user_id', 'problem_id', 'verdict', 'language', 'code', 'knowledge_ids',
                      'taxonomy_version', 'analysis_id', 'difficulty', 'created_at')


class ProblemRepository:
    def __init__(self, db: Database):
        self.db = db

    def create(self, title: str, description: str, source_url: str = '') -> dict:
        """插入一道题并分配 OJ 编号。

        编号在 SQL 里用 MAX(id)+1 计算，所以空库第一道题是 1000，
        而且不依赖 AUTOINCREMENT——旧原型建的库没有 sqlite_sequence 表。
        写入语句本身是原子的，编号不会因为并发插入而重复。
        """
        cursor = self.db.execute(
            'INSERT INTO problems(id, title, description, source_url, created_at) '
            'VALUES ((SELECT COALESCE(MAX(id), ? - 1) + 1 FROM problems), ?, ?, ?, ?)',
            (FIRST_PROBLEM_ID, title, description, source_url, utcnow()))
        return self.get(cursor.lastrowid)

    def get(self, problem_id: int) -> dict | None:
        row = self.db.query_one('SELECT * FROM problems WHERE id = ?', (problem_id,))
        return dict(row) if row else None

    def list(self, q: str = '', limit: int = 100, offset: int = 0) -> tuple[list[dict], int]:
        pattern = f'%{q}%'
        total = self.db.query_one('SELECT COUNT(*) AS n FROM problems WHERE title LIKE ? OR description LIKE ?',
                                  (pattern, pattern))['n']
        rows = self.db.query('SELECT * FROM problems WHERE title LIKE ? OR description LIKE ? ORDER BY id DESC LIMIT ? OFFSET ?',
                             (pattern, pattern, limit, offset))
        return [dict(row) for row in rows], total

    def all(self) -> list[dict]:
        return [dict(row) for row in self.db.query('SELECT * FROM problems ORDER BY id DESC')]

    def count(self) -> int:
        return self.db.query_one('SELECT COUNT(*) AS n FROM problems')['n']


class AnalysisRepository:
    def __init__(self, db: Database):
        self.db = db

    def add(self, problem_id: int, payload: dict, *, origin: str, status: str = 'pending',
            taxonomy_version: str = '') -> dict:
        cursor = self.db.execute(
            'INSERT INTO problem_analyses(problem_id, payload, origin, initial_status, taxonomy_version, created_at) '
            'VALUES (?, ?, ?, ?, ?, ?)',
            (problem_id, json.dumps(payload, ensure_ascii=False), origin, status, taxonomy_version, utcnow()))
        return self.get(cursor.lastrowid)

    def get(self, analysis_id: int) -> dict | None:
        row = self.db.query_one('SELECT * FROM problem_analyses WHERE id = ?', (analysis_id,))
        if row is None:
            return None
        return self._to_dict(row, self._statuses([row['id']]).get(row['id'], row['initial_status']))

    def latest(self, problem_id: int) -> dict | None:
        row = self.db.query_one('SELECT * FROM problem_analyses WHERE problem_id = ? ORDER BY id DESC LIMIT 1',
                                (problem_id,))
        if row is None:
            return None
        return self._to_dict(row, self._statuses([row['id']]).get(row['id'], row['initial_status']))

    def latest_by_problem(self, problem_ids: list[int]) -> dict[int, dict]:
        if not problem_ids:
            return {}
        placeholders = ','.join('?' * len(problem_ids))
        rows = self.db.query(
            f'SELECT * FROM problem_analyses WHERE id IN '
            f'(SELECT MAX(id) FROM problem_analyses WHERE problem_id IN ({placeholders}) GROUP BY problem_id)',
            tuple(problem_ids))
        statuses = self._statuses([row['id'] for row in rows])
        return {row['problem_id']: self._to_dict(row, statuses.get(row['id'], row['initial_status']))
                for row in rows}

    def history(self, problem_id: int) -> list[dict]:
        rows = self.db.query('SELECT * FROM problem_analyses WHERE problem_id = ? ORDER BY id DESC', (problem_id,))
        statuses = self._statuses([row['id'] for row in rows])
        return [self._to_dict(row, statuses.get(row['id'], row['initial_status'])) for row in rows]

    def count(self) -> int:
        return self.db.query_one('SELECT COUNT(*) AS n FROM problem_analyses')['n']

    def approved_count(self) -> int:
        return sum(1 for analysis in self.latest_by_problem(self._problem_ids()).values()
                   if analysis['review_status'] == 'approved')

    def _problem_ids(self) -> list[int]:
        return [row['id'] for row in self.db.query('SELECT id FROM problems')]

    def _statuses(self, analysis_ids: list[int]) -> dict[int, str]:
        if not analysis_ids:
            return {}
        placeholders = ','.join('?' * len(analysis_ids))
        rows = self.db.query(
            f'SELECT analysis_id, action FROM analysis_reviews WHERE analysis_id IN ({placeholders}) '
            f'AND id IN (SELECT MAX(id) FROM analysis_reviews WHERE analysis_id IN ({placeholders}) GROUP BY analysis_id)',
            tuple(analysis_ids) + tuple(analysis_ids))
        return {row['analysis_id']: ('approved' if row['action'] == 'approve' else 'rejected') for row in rows}

    @staticmethod
    def _to_dict(row, review_status: str) -> dict:
        return {**json.loads(row['payload']), 'analysis_id': row['id'], 'problem_id': row['problem_id'],
                'review_status': review_status, 'origin': row['origin'], 'created_at': row['created_at']}


class ReviewRepository:
    def __init__(self, db: Database):
        self.db = db

    def add(self, problem_id: int, original_analysis_id: int, analysis_id: int, action: str,
            reviewer: str, comment: str) -> dict:
        cursor = self.db.execute(
            'INSERT INTO analysis_reviews(problem_id, original_analysis_id, analysis_id, action, reviewer, comment, created_at) '
            'VALUES (?, ?, ?, ?, ?, ?, ?)',
            (problem_id, original_analysis_id, analysis_id, action, reviewer, comment, utcnow()))
        return self.get(cursor.lastrowid)

    def get(self, review_id: int) -> dict | None:
        row = self.db.query_one('SELECT * FROM analysis_reviews WHERE id = ?', (review_id,))
        return dict(row) if row else None

    def list_for_problem(self, problem_id: int) -> list[dict]:
        rows = self.db.query('SELECT * FROM analysis_reviews WHERE problem_id = ? ORDER BY id DESC', (problem_id,))
        return [dict(row) for row in rows]

    def count(self) -> int:
        return self.db.query_one('SELECT COUNT(*) AS n FROM analysis_reviews')['n']


class SubmissionRepository:
    def __init__(self, db: Database):
        self.db = db

    def add(self, user_id: str, problem_id: int, verdict: str, *, code: str = '', language: str = 'unknown',
            knowledge_ids: list[str] | None = None, taxonomy_version: str = '', analysis_id: int | None = None,
            difficulty: int | None = None) -> dict:
        cursor = self.db.execute(
            'INSERT INTO submissions(user_id, problem_id, verdict, code, language, knowledge_ids, taxonomy_version, '
            'analysis_id, difficulty, created_at, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            (user_id, problem_id, verdict, code, language, json.dumps(knowledge_ids or [], ensure_ascii=False),
             taxonomy_version, analysis_id, difficulty, utcnow(), '[]'))
        return self.get(cursor.lastrowid)

    def get(self, submission_id: int) -> dict | None:
        row = self.db.query_one('SELECT * FROM submissions WHERE id = ?', (submission_id,))
        return self._to_dict(row) if row else None

    def list(self, user_id: str | None = None, limit: int = 200, offset: int = 0) -> tuple[list[dict], int]:
        if user_id is None:
            total = self.db.query_one('SELECT COUNT(*) AS n FROM submissions')['n']
            rows = self.db.query('SELECT * FROM submissions ORDER BY id DESC LIMIT ? OFFSET ?', (limit, offset))
        else:
            total = self.db.query_one('SELECT COUNT(*) AS n FROM submissions WHERE user_id = ?', (user_id,))['n']
            rows = self.db.query('SELECT * FROM submissions WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?',
                                 (user_id, limit, offset))
        return [self._to_dict(row) for row in rows], total

    def history_for_user(self, user_id: str) -> list[dict]:
        """按时间正序返回，供画像计算使用。"""
        rows = self.db.query('SELECT * FROM submissions WHERE user_id = ? ORDER BY id ASC', (user_id,))
        return [self._to_dict(row) for row in rows]

    def users(self) -> list[str]:
        return [row['user_id'] for row in self.db.query('SELECT DISTINCT user_id FROM submissions ORDER BY user_id')]

    def count(self) -> int:
        return self.db.query_one('SELECT COUNT(*) AS n FROM submissions')['n']

    @staticmethod
    def _to_dict(row) -> dict:
        return {key: row[key] for key in SUBMISSION_COLUMNS} | {'knowledge_ids': json.loads(row['knowledge_ids'])}
