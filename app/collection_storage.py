"""Independent SQLite collection store. No learning DB or OJ session access."""
from contextlib import closing, contextmanager
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
import uuid

DEFAULT_LIMIT = 150 * 1024**2
DEFAULT_WARNING = 120 * 1024**2
FIELDS = ('submission_id', 'problem_key', 'submitted_at', 'language', 'verdict', 'score',
          'time_ms', 'memory_bytes', 'source_state', 'source_hash')
SCHEMA = """
CREATE TABLE IF NOT EXISTS user_storage(
  user_id TEXT PRIMARY KEY, used_bytes INTEGER NOT NULL DEFAULT 0 CHECK(used_bytes>=0));
CREATE TABLE IF NOT EXISTS source_blobs(
  user_id TEXT NOT NULL, hash TEXT NOT NULL, content BLOB NOT NULL, storage_bytes INTEGER NOT NULL,
  PRIMARY KEY(user_id,hash));
CREATE TABLE IF NOT EXISTS batches(
  user_id TEXT NOT NULL, batch_id TEXT NOT NULL, platform TEXT NOT NULL, account_id TEXT NOT NULL,
  digest TEXT NOT NULL, receipt TEXT NOT NULL, created_at TEXT NOT NULL, storage_bytes INTEGER NOT NULL,
  PRIMARY KEY(user_id,batch_id));
CREATE TABLE IF NOT EXISTS external_submissions(
  user_id TEXT NOT NULL, platform TEXT NOT NULL, account_id TEXT NOT NULL, submission_id TEXT NOT NULL,
  problem_key TEXT NOT NULL, submitted_at TEXT NOT NULL, language TEXT NOT NULL, verdict TEXT NOT NULL,
  score REAL, time_ms INTEGER, memory_bytes INTEGER, source_state TEXT NOT NULL, source_hash TEXT,
  first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, storage_bytes INTEGER NOT NULL,
  PRIMARY KEY(user_id,platform,account_id,submission_id),
  FOREIGN KEY(user_id,source_hash) REFERENCES source_blobs(user_id,hash));
CREATE INDEX IF NOT EXISTS external_by_time ON external_submissions(user_id,submitted_at,submission_id);
CREATE INDEX IF NOT EXISTS external_by_source ON external_submissions(user_id,source_hash);
CREATE INDEX IF NOT EXISTS external_by_account_time
  ON external_submissions(user_id,platform,account_id,submitted_at,submission_id);
CREATE TABLE IF NOT EXISTS observations(
  observation_id INTEGER PRIMARY KEY, user_id TEXT NOT NULL, platform TEXT NOT NULL,
  account_id TEXT NOT NULL, submission_id TEXT NOT NULL, batch_id TEXT NOT NULL,
  payload TEXT NOT NULL, observed_at TEXT NOT NULL, storage_bytes INTEGER NOT NULL,
  FOREIGN KEY(user_id,platform,account_id,submission_id)
    REFERENCES external_submissions(user_id,platform,account_id,submission_id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS observations_by_submission
  ON observations(user_id,platform,account_id,submission_id,observation_id);
CREATE INDEX IF NOT EXISTS batches_by_account ON batches(user_id,platform,account_id);
"""


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def charged(value, overhead=128):
    """Stable logical quota: UTF-8 bytes plus documented per-row allowance."""
    return len(canonical(value).encode('utf-8')) + overhead


class StorageQuotaExceeded(ValueError):
    def __init__(self, used_bytes, attempted_bytes, limit_bytes):
        super().__init__('storage_quota_exceeded')
        self.detail = dict(code='storage_quota_exceeded', used_bytes=used_bytes,
                           attempted_bytes=attempted_bytes, limit_bytes=limit_bytes)


def backup_database(source, destination):
    source, destination = Path(source).resolve(), Path(destination).resolve()
    if not source.is_file():
        raise FileNotFoundError(source)
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive create avoids overwriting a live DB or a previous backup.
    with destination.open('xb'):
        pass
    try:
        with closing(sqlite3.connect(source.as_uri()+'?mode=ro', uri=True)) as origin:
            with closing(sqlite3.connect(destination)) as target:
                origin.backup(target, pages=256)
                if target.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                    raise ValueError('backup_integrity_failed')
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    return str(destination)


def restore_database(source, destination):
    source = Path(source).resolve()
    if not source.is_file():
        raise FileNotFoundError(source)
    with closing(sqlite3.connect(source.as_uri()+'?mode=ro', uri=True)) as db:
        tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not {'batches', 'external_submissions', 'observations'} <= tables:
            raise ValueError('not_a_collection_database')
        if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('backup_integrity_failed')
    return backup_database(source, destination)


class CollectionStore:
    def __init__(self, path, *, limit_bytes=DEFAULT_LIMIT, warning_bytes=DEFAULT_WARNING):
        if not 0 < warning_bytes <= limit_bytes:
            raise ValueError('invalid_storage_limits')
        self.path = str(Path(path).resolve())
        self.limit_bytes, self.warning_bytes = limit_bytes, warning_bytes
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            version = db.execute('PRAGMA user_version').fetchone()[0]
            tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if version == 2:
            return
        if version > 2:
            raise ValueError('unsupported_collection_schema')
        legacy = 'external_submissions' in tables
        if legacy:
            backup_database(self.path, self.path+'.pre-v2-'+uuid.uuid4().hex+'.db')
        with self.connect() as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('BEGIN IMMEDIATE')
            # Another process may have completed the migration while we backed up.
            if db.execute('PRAGMA user_version').fetchone()[0] == 2:
                return
            if legacy:
                db.execute('DROP INDEX IF EXISTS external_by_time')
                for name in ('batches', 'external_submissions', 'observations'):
                    db.execute(f'ALTER TABLE {name} RENAME TO legacy_{name}')
            for statement in SCHEMA.split(';'):
                if statement.strip():
                    db.execute(statement)
            if legacy:
                self._migrate(db)
            db.execute('PRAGMA user_version=2')

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        db.execute('PRAGMA busy_timeout=15000')
        try:
            with db:
                yield db
        finally:
            db.close()

    def _ensure_user(self, db, user):
        db.execute('INSERT OR IGNORE INTO user_storage(user_id) VALUES(?)', (user,))

    def _adjust(self, db, user, delta):
        db.execute('UPDATE user_storage SET used_bytes=used_bytes+? WHERE user_id=?', (delta, user))

    def _source(self, db, user, row):
        code = row.pop('source_code', None)
        if code is None:
            row['source_hash'] = None
            return
        content = code.encode('utf-8')
        digest = hashlib.sha256(content).hexdigest()
        row['source_hash'] = digest
        size = len(content) + 128
        inserted = db.execute('INSERT OR IGNORE INTO source_blobs VALUES(?,?,?,?)',
                              (user, digest, content, size)).rowcount
        if inserted:
            self._adjust(db, user, size)

    def _write_submission(self, db, key, row, first_seen, last_seen):
        size = charged(dict(zip(('user_id', 'platform', 'account_id'), key[:3])) | row, 256)
        values = [*key, *[row.get(f) for f in FIELDS[1:]], first_seen, last_seen, size]
        columns = ('user_id', 'platform', 'account_id', *FIELDS, 'first_seen', 'last_seen', 'storage_bytes')
        # Keep INSERT (rather than REPLACE) semantics for FK safety and rollback tests.
        db.execute('INSERT INTO external_submissions('+','.join(columns)+') VALUES('+','.join('?' for _ in values)+')',
                   values)
        self._adjust(db, key[0], size)

    def _observe(self, db, key, row, batch_id, stamp):
        payload = canonical(row)
        size = charged(row)
        db.execute('INSERT INTO observations(user_id,platform,account_id,submission_id,batch_id,payload,observed_at,storage_bytes) VALUES(?,?,?,?,?,?,?,?)',
                   (*key, batch_id, payload, stamp, size))
        self._adjust(db, key[0], size)
        old = db.execute('SELECT observation_id,storage_bytes FROM observations WHERE user_id=? AND platform=? AND account_id=? AND submission_id=? ORDER BY observation_id DESC LIMIT -1 OFFSET 20', key).fetchall()
        for item in old:
            db.execute('DELETE FROM observations WHERE observation_id=?', (item['observation_id'],))
            self._adjust(db, key[0], -item['storage_bytes'])

    def _receipt(self, db, user, batch_id, digest, receipt, stamp):
        size = charged(receipt | dict(batch_id=batch_id, digest=digest))
        db.execute('INSERT INTO batches VALUES(?,?,?,?,?,?,?,?)',
                   (user, batch_id, receipt['platform'], receipt['account_id'], digest,
                    canonical(receipt), stamp, size))
        self._adjust(db, user, size)

    def _gc_sources(self, db, user):
        unused = db.execute('SELECT hash,storage_bytes FROM source_blobs b WHERE b.user_id=? AND NOT EXISTS(SELECT 1 FROM external_submissions s WHERE s.user_id=b.user_id AND s.source_hash=b.hash)', (user,)).fetchall()
        for row in unused:
            db.execute('DELETE FROM source_blobs WHERE user_id=? AND hash=?', (user, row['hash']))
            self._adjust(db, user, -row['storage_bytes'])

    def _migrate(self, db):
        for old in db.execute('SELECT * FROM legacy_external_submissions'):
            user = old['user_id']
            self._ensure_user(db, user)
            row = json.loads(old['payload'])
            self._source(db, user, row)
            self._write_submission(db, (user, old['platform'], old['account_id'], old['submission_id']),
                                   row, old['first_seen'] or '', old['last_seen'] or '')
        for old in db.execute('SELECT * FROM legacy_batches'):
            self._ensure_user(db, old['user_id'])
            raw = json.loads(old['payload'])
            receipt = {k: raw[k] for k in ('platform', 'account_id', 'coverage', 'adapter_version')}
            receipt['count'] = len(raw['submissions'])
            self._receipt(db, old['user_id'], old['batch_id'], old['digest'], receipt, old['created_at'])
        for old in db.execute('SELECT * FROM legacy_observations ORDER BY observed_at,batch_id'):
            key = tuple(old[k] for k in ('user_id', 'platform', 'account_id', 'submission_id'))
            row = json.loads(old['payload'])
            row.pop('source_code', None)
            self._observe(db, key, row, old['batch_id'], old['observed_at'])
        # Never reject/delete historical rows merely because a new quota is smaller.
        for name in ('observations', 'external_submissions', 'batches'):
            db.execute(f'DROP TABLE legacy_{name}')

    def import_batch(self, user_id, batch):
        digest = hashlib.sha256(canonical(batch.model_dump(mode='json')).encode()).hexdigest()
        stamp = datetime.now(timezone.utc).isoformat()
        counts = dict(inserted=0, updated=0, replayed=False)
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            self._ensure_user(db, user_id)
            previous_usage = db.execute('SELECT used_bytes FROM user_storage WHERE user_id=?', (user_id,)).fetchone()[0]
            old = db.execute('SELECT digest FROM batches WHERE user_id=? AND batch_id=?', (user_id, batch.batch_id)).fetchone()
            if old:
                if old['digest'] != digest:
                    raise ValueError('batch_id already used with different content')
                return dict(inserted=0, updated=0, replayed=True)
            for submission in batch.submissions:
                row = submission.model_dump(mode='json')
                key = (user_id, batch.platform, batch.account_id, submission.submission_id)
                existing = db.execute('SELECT * FROM external_submissions WHERE user_id=? AND platform=? AND account_id=? AND submission_id=?', key).fetchone()
                self._source(db, user_id, row)
                if existing and row['source_state'] != 'available' and existing['source_state'] == 'available':
                    row.update(source_state=existing['source_state'], source_hash=existing['source_hash'])
                changed = not existing or any(existing[f] != row.get(f) for f in FIELDS)
                if existing:
                    # Update in place so FK observations survive; sources are already inserted.
                    size = charged(dict(zip(('user_id', 'platform', 'account_id'), key[:3])) | row, 256)
                    columns = (*FIELDS[1:], 'last_seen', 'storage_bytes')
                    values = [*[row.get(f) for f in FIELDS[1:]], stamp, size, *key]
                    db.execute('UPDATE external_submissions SET '+','.join(f'{f}=?' for f in columns)+' WHERE user_id=? AND platform=? AND account_id=? AND submission_id=?', values)
                    self._adjust(db, user_id, size-existing['storage_bytes'])
                    counts['updated'] += 1
                else:
                    self._write_submission(db, key, row, stamp, stamp)
                    counts['inserted'] += 1
                if changed:
                    self._observe(db, key, row, batch.batch_id, stamp)
            self._gc_sources(db, user_id)
            receipt = dict(platform=batch.platform, account_id=batch.account_id,
                           adapter_version=batch.adapter_version, coverage=batch.coverage.model_dump(),
                           count=len(batch.submissions))
            self._receipt(db, user_id, batch.batch_id, digest, receipt, stamp)
            attempted = db.execute('SELECT used_bytes FROM user_storage WHERE user_id=?', (user_id,)).fetchone()[0]
            if attempted > self.limit_bytes:
                raise StorageQuotaExceeded(previous_usage, attempted, self.limit_bytes)
        return counts

    def usage(self, user_id):
        with self.connect() as db:
            used = db.execute('SELECT used_bytes FROM user_storage WHERE user_id=?', (user_id,)).fetchone()
            count = db.execute('SELECT count(*) FROM external_submissions WHERE user_id=?', (user_id,)).fetchone()[0]
            sources = db.execute('SELECT count(*),coalesce(sum(length(content)),0) FROM source_blobs WHERE user_id=?', (user_id,)).fetchone()
        total = used[0] if used else 0
        return dict(used_bytes=total, limit_bytes=self.limit_bytes, warning_bytes=self.warning_bytes,
                    warning=total >= self.warning_bytes, submission_count=count,
                    source_count=sources[0], source_bytes=sources[1])

    def list_submissions(self, user_id, limit=50, offset=0, *, platform=None, account_id=None):
        where, params = 's.user_id=?', [user_id]
        if platform is not None:
            where += ' AND s.platform=?'
            params.append(platform)
        if account_id is not None:
            where += ' AND s.account_id=?'
            params.append(account_id)
        with self.connect() as db:
            total = db.execute('SELECT count(*) FROM external_submissions s WHERE '+where, params).fetchone()[0]
            rows = db.execute('SELECT s.*,b.content FROM external_submissions s LEFT JOIN source_blobs b ON b.user_id=s.user_id AND b.hash=s.source_hash WHERE '+where+' ORDER BY s.submitted_at DESC,s.submission_id DESC LIMIT ? OFFSET ?', [*params, limit, offset]).fetchall()
        return dict(total=total, items=[dict(platform=r['platform'], account_id=r['account_id'],
                    **{f: r[f] for f in FIELDS}, source_code=r['content'].decode() if r['content'] is not None else None) for r in rows])

    def delete_account(self, user_id, platform, account_id):
        key = (user_id, platform, account_id)
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            self._ensure_user(db, user_id)
            released = 0
            for table in ('observations', 'batches', 'external_submissions'):
                released += db.execute(f'SELECT coalesce(sum(storage_bytes),0) FROM {table} WHERE user_id=? AND platform=? AND account_id=?', key).fetchone()[0]
            deleted = db.execute('DELETE FROM external_submissions WHERE user_id=? AND platform=? AND account_id=?', key).rowcount
            db.execute('DELETE FROM batches WHERE user_id=? AND platform=? AND account_id=?', key)
            self._adjust(db, user_id, -released)
            self._gc_sources(db, user_id)
        return dict(deleted=deleted, storage=self.usage(user_id))
