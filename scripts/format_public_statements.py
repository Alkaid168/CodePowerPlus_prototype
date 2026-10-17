"""40题受控数学排版维护。默认只检查；--apply 先备份后原子修复，绝不改分析快照。"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sqlite3
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app.config import load_settings
from app.db import Database
from app.statement_formatting import apply_formatting, validate_formatting


def snapshot(conn):
    names = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
    return {name: [dict(row) for row in conn.execute(f'SELECT * FROM "{name}" ORDER BY rowid')]
            for name in names}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    folder = ROOT / 'data/evaluation/public40'
    items, patches = [], []
    for platform in ('luogu', 'codeforces'):
        items.extend(json.loads((folder / f'{platform}.json').read_text(encoding='utf-8'))['items'])
        data = json.loads((folder / f'formatting/{platform}.json').read_text(encoding='utf-8'))
        if data['version'] != 'statement-formatting-v1':
            raise ValueError('unknown patch version')
        patches.extend(data['items'])
    validate_formatting(items, patches)
    path = Path(load_settings().db_path).resolve()
    if not path.is_file():
        raise ValueError('existing formal database required')
    with sqlite3.connect(path.as_uri() + '?mode=ro', uri=True) as conn:
        conn.row_factory = sqlite3.Row
        before = snapshot(conn)
    # 在副本上运行完整冲突检查及不可变性比对；dry run 不写正式库。
    trial = Database(':memory:')
    with sqlite3.connect(path.as_uri() + '?mode=ro', uri=True) as source:
        source.backup(trial.conn)
    try:
        proposed = apply_formatting(trial, items, patches)
        after = snapshot(trial.conn)
        expected = {entry['problem_id']: patch['description'] for entry, patch in zip(proposed, patches)}
        for name, rows in before.items():
            compared = after[name]
            if name == 'problems':
                rows = [{**row, 'description': expected.get(row['id'], row['description'])} for row in rows]
            if rows != compared:
                raise ValueError(f'unexpected table mutation: {name}')
    finally:
        trial.close()
    if not args.apply:
        print(f'Validated {len(patches)} patches; would change {sum(r["changed"] for r in proposed)} statements; formal database unchanged.')
        return
    backup_dir = Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'CodePowerPlus/backups'
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup = backup_dir / f'before-statement-formatting-{stamp}.sqlite3'
    with sqlite3.connect(path.as_uri() + '?mode=ro', uri=True) as source, sqlite3.connect(backup) as target:
        source.backup(target)
        if target.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            raise ValueError('backup failed integrity check')
    receipt = {'version': 'statement-formatting-v1', 'backup': str(backup),
               'note': 'formatting only; semantic revision and immutable original analyses retained',
               'items': proposed, 'patches': patches}
    receipt_path = backup.with_suffix('.json')
    receipt_path.write_text(json.dumps({**receipt, 'state': 'prepared'}, ensure_ascii=False, indent=2), encoding='utf-8')
    db = Database(path)
    try:
        applied = apply_formatting(db, items, patches)
        if db.query_one('PRAGMA quick_check')[0] != 'ok' or db.query('PRAGMA foreign_key_check'):
            raise ValueError('integrity check failed')
    finally:
        db.close()
    receipt_path.write_text(json.dumps({**receipt, 'state': 'applied', 'items': applied}, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'Applied {sum(r["changed"] for r in applied)} statements. Backup and receipt: {receipt_path}')


if __name__ == '__main__':
    main()
