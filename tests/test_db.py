"""数据库层：版本号、外键约束与旧库兼容。"""
import sqlite3

import pytest

from app.db import FIRST_PROBLEM_ID, SCHEMA_VERSION, Database, utcnow


def test_fresh_database_has_current_schema(tmp_path):
    db = Database(tmp_path / 'fresh.db')
    try:
        assert db.schema_version == SCHEMA_VERSION
        assert db.query_one('SELECT COUNT(*) AS n FROM problems')['n'] == 0
        assert utcnow()
    finally:
        db.close()


def test_problems_are_numbered_from_1000(tmp_path):
    """题目编号从 1000 开始，由仓储层计算，连续递增。"""
    from app.repositories import ProblemRepository

    db = Database(tmp_path / 'numbering.db')
    try:
        problems = ProblemRepository(db)
        assert problems.create('一', 'd')['id'] == FIRST_PROBLEM_ID
        assert problems.create('二', 'd')['id'] == FIRST_PROBLEM_ID + 1
    finally:
        db.close()


def test_numbering_works_without_autoincrement(tmp_path):
    """0.2 版原型建的表是普通 INTEGER PRIMARY KEY，没有 sqlite_sequence。"""
    from app.repositories import ProblemRepository

    path = tmp_path / 'legacy-numbering.db'
    connection = sqlite3.connect(path)
    connection.executescript(
        'CREATE TABLE problems (id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, '
        "source TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT '');")
    connection.commit()
    connection.close()

    db = Database(path)
    try:
        ddl = db.query_one("SELECT sql FROM sqlite_master WHERE name = 'problems'")['sql']
        assert 'AUTOINCREMENT' not in ddl.upper()
        problems = ProblemRepository(db)
        assert problems.create('一', 'd')['id'] == FIRST_PROBLEM_ID
        assert problems.create('二', 'd')['id'] == FIRST_PROBLEM_ID + 1
    finally:
        db.close()


def test_empty_database_starts_over_at_1000(tmp_path):
    """清空题库后重新编号，不会从旧的最大编号继续。"""
    from app.repositories import ProblemRepository

    db = Database(tmp_path / 'restart.db')
    try:
        problems = ProblemRepository(db)
        problems.create('一', 'd')
        db.execute('DELETE FROM problems')
        assert problems.create('二', 'd')['id'] == FIRST_PROBLEM_ID
    finally:
        db.close()


def test_foreign_keys_are_enforced(tmp_path):
    db = Database(tmp_path / 'fk.db')
    try:
        with pytest.raises(sqlite3.IntegrityError):
            db.execute('INSERT INTO problem_analyses(problem_id, payload, created_at) VALUES (?, ?, ?)',
                       (99, '{}', utcnow()))
    finally:
        db.close()


def test_legacy_database_gains_missing_columns(tmp_path):
    path = tmp_path / 'legacy.db'
    connection = sqlite3.connect(path)
    connection.executescript(
        'CREATE TABLE problems (id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, '
        "source TEXT NOT NULL DEFAULT '');"
        'CREATE TABLE problem_analyses (id INTEGER PRIMARY KEY, problem_id INTEGER NOT NULL, payload TEXT NOT NULL);'
        'CREATE TABLE submissions (id INTEGER PRIMARY KEY, user_id TEXT NOT NULL, problem_id INTEGER NOT NULL, '
        'verdict TEXT NOT NULL, tags TEXT NOT NULL);'
        "INSERT INTO problems VALUES (1, '旧题', '旧描述', 'https://example.com/p/1');")
    connection.commit()
    connection.close()

    db = Database(path)
    try:
        row = db.query_one('SELECT * FROM problems WHERE id = 1')
        assert row['title'] == '旧题'
        # 旧库的自由文本来源被改名成 source_url 并保留原值。
        assert row['source_url'] == 'https://example.com/p/1'
        assert db.schema_version == SCHEMA_VERSION
    finally:
        db.close()


def test_legacy_analyses_are_marked_legacy(tmp_path):
    path = tmp_path / 'legacy.db'
    connection = sqlite3.connect(path)
    connection.executescript(
        'CREATE TABLE problems (id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL);'
        'CREATE TABLE problem_analyses (id INTEGER PRIMARY KEY, problem_id INTEGER NOT NULL, payload TEXT NOT NULL);'
        "INSERT INTO problems VALUES (1, '旧题', '旧描述');"
        "INSERT INTO problem_analyses VALUES (1, 1, '{\"tags\": [\"dp\"]}');")
    connection.commit()
    connection.close()

    from app.repositories import AnalysisRepository
    db = Database(path)
    try:
        analysis = AnalysisRepository(db).latest(1)
        assert analysis is not None
        assert analysis['origin'] == 'legacy'
        assert analysis['review_status'] == 'legacy'
    finally:
        db.close()
