"""Storage acceptance tests. All accounts/content are synthetic; DBs are temporary."""
import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor

import pytest
from app.collection import CollectionStore, ImportBatch


def make_batch(batch_id='batch-1', ids=('1',), code='// 合成源码\nint main(){}', account='alice'):
    return ImportBatch(schema_version=1, adapter_version='0.4.0', batch_id=batch_id,
                       platform='codeforces', account_id=account, coverage={'status': 'complete_visible'},
                       submissions=[dict(submission_id=i, problem_key='1/A',
                                         submitted_at='2026-10-21T00:00:00Z', language='C++',
                                         verdict='OK', source_state='available', source_code=code) for i in ids])


def test_dedup_usage_replay_and_history_bound(tmp_path):
    store = CollectionStore(tmp_path/'store.db')
    store.import_batch('u', make_batch(ids=('1', '2')))
    usage = store.usage('u')
    assert usage['source_bytes'] == len('// 合成源码\nint main(){}'.encode())
    assert usage['source_count'] == 1 and usage['submission_count'] == 2
    assert usage['limit_bytes'] == 150*1024**2
    store.import_batch('u', make_batch(ids=('1', '2')))
    assert store.usage('u') == usage
    for i in range(30):
        batch = make_batch(f'changed-{i}', ids=('1',))
        batch.submissions[0].verdict = str(i)
        store.import_batch('u', batch)
    with store.connect() as db:
        assert db.execute('SELECT count(*) FROM observations WHERE submission_id="1"').fetchone()[0] == 20
        assert db.execute('PRAGMA journal_mode').fetchone()[0] == 'wal'
        assert db.execute('PRAGMA foreign_keys').fetchone()[0] == 1
        assert db.execute('PRAGMA foreign_key_check').fetchall() == []
        assert 'int main' not in db.execute('SELECT receipt FROM batches LIMIT 1').fetchone()[0]
        assert all('source_code' not in row[0] for row in db.execute('SELECT payload FROM observations'))
    assert store.list_submissions('u')['items'][0]['source_code'] == '// 合成源码\nint main(){}'


def test_quota_rolls_back_entire_batch_and_other_user_is_independent(tmp_path):
    store = CollectionStore(tmp_path/'store.db', limit_bytes=5000, warning_bytes=4000)
    store.import_batch('u', make_batch())
    before = store.usage('u')
    with pytest.raises(ValueError, match='storage_quota_exceeded'):
        store.import_batch('u', make_batch('big', ids=('2', '3'), code='z'*6000))
    assert store.usage('u') == before
    assert store.list_submissions('u')['total'] == 1
    store.import_batch('other', make_batch())
    assert store.usage('other')['source_count'] == 1
    with store.connect() as db:
        assert db.execute('SELECT count(*) FROM source_blobs').fetchone()[0] == 2
        assert db.execute('SELECT count(*) FROM batches WHERE batch_id="big"').fetchone()[0] == 0


def test_account_delete_preserves_other_accounts_and_shared_code(tmp_path):
    store = CollectionStore(tmp_path/'store.db')
    store.import_batch('u', make_batch())
    store.import_batch('u', make_batch('bob', account='bob'))
    assert store.usage('u')['source_count'] == 1
    result = store.delete_account('u', 'codeforces', 'alice')
    assert result['deleted'] == 1
    assert store.list_submissions('u')['items'][0]['account_id'] == 'bob'
    assert store.usage('u')['source_count'] == 1
    store.delete_account('u', 'codeforces', 'bob')
    assert store.usage('u')['used_bytes'] == 0


def test_concurrent_imports_cannot_exceed_user_quota(tmp_path):
    store = CollectionStore(tmp_path/'store.db', limit_bytes=8000, warning_bytes=6000)
    def insert(i):
        try:
            store.import_batch('u', make_batch(f'b-{i}', ids=(str(i),), code=str(i)*3000))
            return True
        except ValueError as exc:
            assert 'storage_quota_exceeded' in str(exc)
            return False
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(insert, range(4)))
    assert 0 < sum(results) < 4
    assert store.usage('u')['used_bytes'] <= 8000
    assert store.list_submissions('u')['total'] == sum(results)


def test_legacy_migration_has_backup_and_preserves_receipt_and_source(tmp_path):
    path = tmp_path/'legacy.db'
    batch = make_batch()
    payload = batch.model_dump(mode='json')
    raw = json.dumps(payload, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
    import hashlib
    digest = hashlib.sha256(raw.encode()).hexdigest()
    with sqlite3.connect(path) as db:
        db.executescript('''
        CREATE TABLE batches(user_id TEXT,batch_id TEXT,digest TEXT,payload TEXT,created_at TEXT,PRIMARY KEY(user_id,batch_id));
        CREATE TABLE external_submissions(user_id TEXT,platform TEXT,account_id TEXT,submission_id TEXT,submitted_at TEXT,payload TEXT,first_seen TEXT,last_seen TEXT,PRIMARY KEY(user_id,platform,account_id,submission_id));
        CREATE TABLE observations(user_id TEXT,platform TEXT,account_id TEXT,submission_id TEXT,batch_id TEXT,payload TEXT,observed_at TEXT,PRIMARY KEY(user_id,platform,account_id,submission_id,batch_id));
        ''')
        db.execute('INSERT INTO batches VALUES(?,?,?,?,?)', ('u', 'batch-1', digest, raw, 'now'))
        row = payload['submissions'][0]
        db.execute('INSERT INTO external_submissions VALUES(?,?,?,?,?,?,?,?)',
                   ('u', 'codeforces', 'alice', '1', row['submitted_at'], json.dumps(row), 'now', 'now'))
        db.execute('INSERT INTO observations VALUES(?,?,?,?,?,?,?)',
                   ('u', 'codeforces', 'alice', '1', 'batch-1', json.dumps(row), 'now'))
    store = CollectionStore(path)
    assert store.list_submissions('u')['items'][0]['source_code'] == batch.submissions[0].source_code
    assert store.import_batch('u', batch)['replayed']
    assert len(list(tmp_path.glob('legacy.db.pre-v2-*.db'))) == 1
    with store.connect() as db:
        assert db.execute('PRAGMA user_version').fetchone()[0] == 2
        assert not any(row[0].startswith('legacy_') for row in db.execute('SELECT name FROM sqlite_master'))


def test_backup_restore_new_destination_and_refuses_overwrite(tmp_path):
    from app.collection_storage import backup_database, restore_database
    store = CollectionStore(tmp_path/'original.db')
    store.import_batch('u', make_batch())
    backup_database(store.path, tmp_path/'backup.db')
    restore_database(tmp_path/'backup.db', tmp_path/'restored.db')
    restored = CollectionStore(tmp_path/'restored.db')
    assert restored.list_submissions('u') == store.list_submissions('u')
    with pytest.raises(FileExistsError):
        restore_database(tmp_path/'backup.db', store.path)
    with pytest.raises(FileNotFoundError):
        backup_database(tmp_path/'missing.db', tmp_path/'unused.db')


def test_source_replacement_gc_and_multibyte_usage_reconcile(tmp_path):
    store = CollectionStore(tmp_path/'store.db')
    store.import_batch('u', make_batch(code='旧源码'*80))
    store.import_batch('u', make_batch('changed', code='新源码'*100))
    usage = store.usage('u')
    assert usage['source_count'] == 1
    assert usage['source_bytes'] == len(('新源码'*100).encode())
    missing = make_batch('missing')
    missing.submissions[0].source_state = 'blocked'
    missing.submissions[0].source_code = missing.submissions[0].source_hash = None
    store.import_batch('u', missing)
    assert store.list_submissions('u')['items'][0]['source_code'] == '新源码'*100
    with store.connect() as db:
        charged = sum(db.execute(f'SELECT sum(storage_bytes) FROM {table} WHERE user_id=?', ('u',)).fetchone()[0]
                      for table in ('external_submissions', 'observations', 'source_blobs', 'batches'))
        assert store.usage('u')['used_bytes'] == charged


def test_corrupt_legacy_migration_rolls_back_and_keeps_backup(tmp_path):
    path = tmp_path/'broken.db'
    with sqlite3.connect(path) as db:
        db.executescript('''
        CREATE TABLE batches(user_id TEXT,batch_id TEXT,digest TEXT,payload TEXT,created_at TEXT);
        CREATE TABLE external_submissions(user_id TEXT,platform TEXT,account_id TEXT,submission_id TEXT,submitted_at TEXT,payload TEXT,first_seen TEXT,last_seen TEXT);
        CREATE TABLE observations(user_id TEXT,platform TEXT,account_id TEXT,submission_id TEXT,batch_id TEXT,payload TEXT,observed_at TEXT);
        ''')
        db.execute('INSERT INTO external_submissions VALUES(?,?,?,?,?,?,?,?)',
                   ('u', 'codeforces', 'alice', '1', 'now', 'corrupted-json', 'now', 'now'))
    with pytest.raises(json.JSONDecodeError):
        CollectionStore(path)
    with sqlite3.connect(path) as db:
        assert db.execute('PRAGMA user_version').fetchone()[0] == 0
        assert db.execute('SELECT payload FROM external_submissions').fetchone()[0] == 'corrupted-json'
        assert db.execute("SELECT count(*) FROM sqlite_master WHERE name LIKE 'legacy_%'").fetchone()[0] == 0
    assert len(list(tmp_path.glob('broken.db.pre-v2-*.db'))) == 1
