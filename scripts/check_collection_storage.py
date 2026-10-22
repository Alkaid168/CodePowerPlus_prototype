"""Reproducible synthetic capacity check; only temporary SQLite databases."""
import hashlib
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app.collection import CollectionStore, ImportBatch


def snapshot(store):
    digest = hashlib.sha256()
    with store.connect() as db:
        for table, order in [('external_submissions', 'submission_id'),
                             ('source_blobs', 'hash'), ('batches', 'batch_id'),
                             ('observations', 'observation_id'), ('user_storage', 'user_id')]:
            for row in db.execute(f'SELECT * FROM {table} ORDER BY {order}'):
                digest.update(repr(tuple(row)).encode())
        assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        assert not db.execute('PRAGMA foreign_key_check').fetchall()
    return digest.hexdigest()


def run_case(directory, source_size):
    path = directory/f'source-{source_size}.db'
    store = CollectionStore(path)
    # Keep one connection open so WAL growth is observable between imports.
    keeper = sqlite3.connect(path)
    assert keeper.execute('PRAGMA journal_mode').fetchone()[0] == 'wal'
    started = time.perf_counter()
    peak_bytes = 0
    for offset in range(0, 5000, 25):
        rows = []
        for i in range(offset, offset+25):
            prefix = f'// synthetic submission {i:06d}\n'
            code = (prefix+'x'*(source_size-len(prefix))) if source_size else None
            rows.append(dict(submission_id=str(i), problem_key=f'{100+i//26}/{chr(65+i%26)}',
                             submitted_at='2026-10-22T00:00:00Z', language='C++',
                             verdict='OK', time_ms=10, memory_bytes=1024,
                             source_state='available' if code else 'not_requested', source_code=code))
        batch = ImportBatch(schema_version=1, adapter_version='0.1.0',
                            batch_id=f'synthetic-{offset}', platform='codeforces',
                            account_id='synthetic_student', coverage={'status': 'complete_visible'},
                            submissions=rows)
        store.import_batch('synthetic-user', batch)
        peak_bytes = max(peak_bytes, sum(p.stat().st_size for p in
                                        (path, Path(str(path)+'-wal'), Path(str(path)+'-shm')) if p.exists()))
    seconds = time.perf_counter()-started
    usage = store.usage('synthetic-user')
    assert usage['submission_count'] == 5000
    assert usage['source_bytes'] == source_size*5000
    expected = snapshot(store)
    backup, restored = directory/f'backup-{source_size}.db', directory/f'restored-{source_size}.db'
    for action, source, target in [('backup', path, backup), ('restore', backup, restored)]:
        subprocess.run([sys.executable, str(ROOT/'scripts/collection_database.py'), action,
                        '--source', str(source), '--destination', str(target)],
                       check=True, capture_output=True, text=True)
    assert snapshot(CollectionStore(restored)) == expected
    keeper.execute('PRAGMA wal_checkpoint(TRUNCATE)')
    keeper.close()
    return dict(submissions=5000, unique_source_bytes_each=source_size, usage=usage,
                import_seconds=round(seconds, 3), database_bytes_after_checkpoint=path.stat().st_size,
                observed_peak_db_wal_shm_bytes=peak_bytes, restored_snapshot_sha256=expected,
                backup_restore_cli_verified=True)


def main():
    with tempfile.TemporaryDirectory(prefix='codepowerplus-synthetic-storage-') as folder:
        cases = [run_case(Path(folder), size) for size in (0, 2048, 5120)]
    report = dict(date='2026-10-22', synthetic_only=True, production_load_test=False,
                  cases=cases, notes='Unique ASCII sources; 25 records/batch; timings describe this local machine only.')
    target = ROOT/'output/collector/storage-check-2026-10-22.json'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
