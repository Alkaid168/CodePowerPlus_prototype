"""SQLite 存储层：连接、表结构与事务。

三层职责分得很清楚：
- 本文件只管“数据怎么存”，不知道任何业务规则；
- repositories 负责把行转成字典；
- services 负责业务规则（分析、审核、画像、推荐）。
"""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock

SCHEMA_VERSION = 4

# 题目的 OJ 编号从 1000 开始；`problems.id` 本身就是对外编号，不再另设一套。
# 编号由 ProblemRepository 在插入时用 MAX(id)+1 计算，不依赖 AUTOINCREMENT——
# 0.2 版原型建的库是普通 INTEGER PRIMARY KEY，没有 sqlite_sequence 表。
FIRST_PROBLEM_ID = 1000

SCHEMA = """
CREATE TABLE IF NOT EXISTS schema_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS problems (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    source_url TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS problem_analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
    payload TEXT NOT NULL,
    origin TEXT NOT NULL DEFAULT 'manual',
    initial_status TEXT NOT NULL DEFAULT 'pending',
    taxonomy_version TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS analysis_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
    original_analysis_id INTEGER NOT NULL REFERENCES problem_analyses(id),
    analysis_id INTEGER NOT NULL REFERENCES problem_analyses(id),
    action TEXT NOT NULL CHECK (action IN ('approve', 'reject')),
    reviewer TEXT NOT NULL,
    comment TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
    verdict TEXT NOT NULL,
    code TEXT NOT NULL DEFAULT '',
    language TEXT NOT NULL DEFAULT 'unknown',
    knowledge_ids TEXT NOT NULL DEFAULT '[]',
    taxonomy_version TEXT NOT NULL DEFAULT '',
    analysis_id INTEGER,
    difficulty INTEGER,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS learner_profiles (
    user_id TEXT PRIMARY KEY,
    experience TEXT NOT NULL,
    language TEXT NOT NULL,
    goal_knowledge_ids TEXT NOT NULL DEFAULT '[]',
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS learner_profile_ratings (
    user_id TEXT NOT NULL REFERENCES learner_profiles(user_id) ON DELETE CASCADE,
    knowledge_id TEXT NOT NULL,
    prior_mean REAL NOT NULL,
    prior_sd REAL NOT NULL CHECK (prior_sd > 0),
    source TEXT NOT NULL CHECK (source IN ('self_reported', 'unassessed')),
    evidence_count INTEGER NOT NULL DEFAULT 0 CHECK (evidence_count >= 0),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, knowledge_id)
);
CREATE INDEX IF NOT EXISTS analyses_by_problem ON problem_analyses(problem_id, id);
CREATE INDEX IF NOT EXISTS reviews_by_problem ON analysis_reviews(problem_id, id);
CREATE INDEX IF NOT EXISTS submissions_by_user ON submissions(user_id, id);
CREATE INDEX IF NOT EXISTS submissions_by_problem ON submissions(problem_id, id);
"""

# 0.2 版原型的库没有这些列。补上以后旧数据仍可读；旧分析按 legacy 处理，不参与画像。
LEGACY_COLUMNS: dict[str, dict[str, str]] = {
    'problems': {
        'source_url': "TEXT NOT NULL DEFAULT ''",
        'created_at': "TEXT NOT NULL DEFAULT ''",
        'reference_solution': "TEXT NOT NULL DEFAULT ''",
        'reference_code': "TEXT NOT NULL DEFAULT ''",
        'revision': 'INTEGER NOT NULL DEFAULT 1',
    },
    'problem_analyses': {
        'problem_revision': 'INTEGER NOT NULL DEFAULT 1',
        'input_snapshot': "TEXT NOT NULL DEFAULT '{}'",
        'origin': "TEXT NOT NULL DEFAULT 'legacy'",
        'initial_status': "TEXT NOT NULL DEFAULT 'legacy'",
        'taxonomy_version': "TEXT NOT NULL DEFAULT ''",
        'created_at': "TEXT NOT NULL DEFAULT ''",
    },
    'submissions': {
        'tags': "TEXT NOT NULL DEFAULT '[]'",
        'code': "TEXT NOT NULL DEFAULT ''",
        'language': "TEXT NOT NULL DEFAULT 'unknown'",
        'knowledge_ids': "TEXT NOT NULL DEFAULT '[]'",
        'taxonomy_version': "TEXT NOT NULL DEFAULT ''",
        'analysis_id': 'INTEGER',
        'difficulty': 'INTEGER',
        'created_at': "TEXT NOT NULL DEFAULT ''",
    },
}


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


class Database:
    """一个应用实例持有一个连接，串行化写入，避免 SQLite 的并发写入问题。"""

    def __init__(self, path: str | Path = ':memory:'):
        self.path = str(path)
        if self.path != ':memory:':
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(self.path, check_same_thread=False, timeout=15)
        self.conn.row_factory = sqlite3.Row
        self.lock = RLock()
        with self.lock:
            self.conn.execute('PRAGMA foreign_keys = ON')
            if self.path != ':memory:':
                self.conn.execute('PRAGMA journal_mode = WAL')
            self._ensure_schema()

    # --- schema -----------------------------------------------------------
    def _ensure_schema(self) -> None:
        with self.conn:
            self.conn.executescript(SCHEMA)
            self._rename_legacy_source()
            for table, columns in LEGACY_COLUMNS.items():
                existing = {row['name'] for row in self.conn.execute(f'PRAGMA table_info({table})')}
                for name, definition in columns.items():
                    if name not in existing:
                        self.conn.execute(f'ALTER TABLE {table} ADD COLUMN {name} {definition}')
            self.conn.execute('INSERT OR REPLACE INTO schema_meta(key, value) VALUES (?, ?)',
                              ('schema_version', str(SCHEMA_VERSION)))

    def _rename_legacy_source(self) -> None:
        """旧库的 problems.source 是自由文本；新库改叫 source_url 并保留原值。"""
        columns = {row['name'] for row in self.conn.execute('PRAGMA table_info(problems)')}
        if 'source' in columns and 'source_url' not in columns:
            self.conn.execute('ALTER TABLE problems RENAME COLUMN source TO source_url')


    @property
    def schema_version(self) -> int:
        row = self.query_one('SELECT value FROM schema_meta WHERE key = ?', ('schema_version',))
        return int(row['value']) if row else 0

    # --- queries ----------------------------------------------------------
    def query(self, sql: str, params: tuple = ()) -> list[sqlite3.Row]:
        with self.lock:
            return self.conn.execute(sql, params).fetchall()

    def query_one(self, sql: str, params: tuple = ()) -> sqlite3.Row | None:
        with self.lock:
            return self.conn.execute(sql, params).fetchone()

    def execute(self, sql: str, params: tuple = ()) -> sqlite3.Cursor:
        with self.lock:
            # 已有事务归调用方提交；不能让审核中的一次插入提前提交整个事务。
            if self.conn.in_transaction:
                return self.conn.execute(sql, params)
            with self.conn:
                return self.conn.execute(sql, params)

    @contextmanager
    def transaction(self):
        """需要“读—判断—写”原子性的场景（例如审核）用 BEGIN IMMEDIATE。"""
        with self.lock:
            self.conn.execute('BEGIN IMMEDIATE')
            try:
                yield self.conn
            except BaseException:
                self.conn.rollback()
                raise
            else:
                self.conn.commit()

    def close(self) -> None:
        with self.lock:
            self.conn.close()
