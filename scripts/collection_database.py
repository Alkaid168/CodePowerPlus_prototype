"""SQLite backup/restore to a NEW file. Never overwrite a running collection DB."""
import argparse
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.collection_storage import backup_database, restore_database


def main():
    parser = argparse.ArgumentParser(description='采集库一致性备份/恢复（目标必须不存在）')
    parser.add_argument('action', choices=['backup', 'restore'])
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--destination', required=True, type=Path)
    args = parser.parse_args()
    operation = backup_database if args.action == 'backup' else restore_database
    try:
        print(operation(args.source, args.destination))
    except (ValueError, OSError) as exc:
        parser.exit(1, str(exc)+'\n')


if __name__ == '__main__':
    main()
