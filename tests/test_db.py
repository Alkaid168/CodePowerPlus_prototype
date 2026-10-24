"""数据库层：版本号、外键约束与旧库兼容。"""
import sqlite3

import pytest

from app.db import FIRST_PROBLEM_ID, SCHEMA_VERSION, Database, utcnow
from app.db import SCHEMA


def test_version_two_database_retains_rows_when_revision_columns_are_added(tmp_path):
    """原二版表结构仍在 SCHEMA 中；新增列由补列迁移提供，不能伪造历史输入。"""
    path = tmp_path / 'v2.db'
    with sqlite3.connect(path) as conn:
        conn.executescript(SCHEMA)
        conn.execute("INSERT INTO schema_meta VALUES ('schema_version','2')")
        conn.execute("INSERT INTO problems(id,title,description,source_url,created_at) VALUES (1000,'old','old statement','','old time')")
        conn.execute("INSERT INTO problem_analyses(problem_id,payload,origin,initial_status,taxonomy_version,created_at) VALUES (1000,'{}','manual','pending','old','old time')")
    db = Database(path)
    try:
        problem = dict(db.query_one('SELECT * FROM problems'))
        analysis = dict(db.query_one('SELECT * FROM problem_analyses'))
        assert problem['description'] == 'old statement' and problem['revision'] == 1
        assert problem['reference_solution'] == problem['reference_code'] == ''
        assert analysis['problem_revision'] == 1 and analysis['input_snapshot'] == '{}'
        assert db.schema_version == 4
    finally:
        db.close()


def test_fresh_database_has_current_schema(tmp_path):
    db = Database(tmp_path / 'fresh.db')
    try:
        assert db.schema_version == SCHEMA_VERSION
        assert db.query_one('SELECT COUNT(*) AS n FROM problems')['n'] == 0
        assert utcnow()
    finally:
        db.close()


def test_version_three_adds_profile_tables_without_modifying_existing_records(tmp_path):
    path = tmp_path / 'v3.db'
    db = Database(path)
    db.execute(
        'INSERT INTO problems(id,title,description,created_at) VALUES (1000,?,?,?)',
        ('保留题目', '保留原始题面', '2026-10-17'))
    before = tuple(db.query_one('SELECT * FROM problems WHERE id=1000'))
    db.close()
    with sqlite3.connect(path) as conn:
        conn.execute('DROP TABLE learner_profile_ratings')
        conn.execute('DROP TABLE learner_profiles')
        conn.execute("UPDATE schema_meta SET value='3' WHERE key='schema_version'")
    migrated = Database(path)
    try:
        assert migrated.schema_version == 4
        assert tuple(migrated.query_one('SELECT * FROM problems WHERE id=1000')) == before
        assert migrated.query_one('SELECT COUNT(*) AS n FROM learner_profiles')['n'] == 0
        assert migrated.query_one('SELECT COUNT(*) AS n FROM learner_profile_ratings')['n'] == 0
    finally:
        migrated.close()


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
