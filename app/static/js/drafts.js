/* 浏览器内草稿：只写 localStorage，不调用服务端、不修改已保存题目。 */
const PREFIX = 'codepowerplus:draft:v1:';
const DELAY = 450;
const CONTENT = ['title', 'description', 'source_url', 'reference_solution', 'reference_code'];
const MANUAL = ['difficulty', 'confidence', 'difficulty_reason', 'solution_idea'];
const copy = value => JSON.parse(JSON.stringify(value));
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const integer = value => Number.isSafeInteger(value) && value > 0;
let writeSequence = 0;
const nonce = () => `${Date.now()}:${++writeSequence}:${Math.random()}`;

function browserStorage() {
  try { return window.localStorage; } catch { return null; }
}
function keyFor(user, kind, id) {
  return `${PREFIX}${encodeURIComponent(user || 'demo-user')}:${kind}:${id ?? 'new'}`;
}
function validData(kind, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  if (kind !== 'manual') return CONTENT.every(key => typeof data[key] === 'string');
  return MANUAL.every(key => typeof data[key] === 'string') && Array.isArray(data.rows)
    && data.rows.every(row => row && typeof row.id === 'string'
      && ['primary', 'secondary'].includes(row.role) && typeof row.evidence === 'string'
      && (typeof row.confidence === 'string' || (typeof row.confidence === 'number' && Number.isFinite(row.confidence))));
}
function validRecord(record, user, kind, id) {
  return record?.schema === 1 && record.user === user && record.kind === kind && record.id === id
    && record.base && (record.base.revision === null || integer(record.base.revision))
    && (record.base.analysisId === null || integer(record.base.analysisId)) && validData(kind, record.data);
}

export function readCreated(user, storage = browserStorage()) {
  try {
    const record = JSON.parse(storage?.getItem(keyFor(user, 'created', null)) || 'null');
    return record?.schema === 1 && integer(record.id) && integer(record.revision) ? record : null;
  } catch { return null; }
}
export function createdVersion(user, storage = browserStorage()) {
  try { return JSON.stringify([storage?.getItem(keyFor(user, 'created', null)) || null,
    storage?.getItem(keyFor(user, 'created-version', null)) || null]); }
  catch { return null; }
}
export function rememberCreated(user, problem, storage = browserStorage(), expectedVersion = undefined) {
  try {
    if (!storage) return false;
    const record = {schema: 1, id: problem.id, revision: problem.revision, token: nonce()};
    if (expectedVersion !== undefined && createdVersion(user, storage) !== expectedVersion) {
      // 清空/另一次创建后才返回的旧编号仍留档，但不替换当前录入的恢复指针。
      const key = keyFor(user, 'created-recovery', null);
      let previous;
      try { previous = JSON.parse(storage.getItem(key) || '[]'); } catch { previous = []; }
      storage.setItem(key, JSON.stringify([...(Array.isArray(previous) ? previous : []), record]));
      return false;
    }
    storage.setItem(keyFor(user, 'created', null), JSON.stringify(record));
    return true;
  } catch { return false; }
}
export function clearCreated(user, storage = browserStorage(), expectedVersion = undefined) {
  try {
    if (!storage || (expectedVersion !== undefined && createdVersion(user, storage) !== expectedVersion)) return false;
    storage.removeItem(keyFor(user, 'created', null));
    storage.setItem(keyFor(user, 'created-version', null), nonce());
    return true;
  } catch { return false; }
}

const entryOperations = new Map();
export function acquireEntrySave(user) {
  if (entryOperations.has(user)) return null;
  const token = nonce(); entryOperations.set(user, token);
  return () => { if (entryOperations.get(user) === token) entryOperations.delete(user); };
}

export function createDraftSession({user = 'demo-user', kind, id = null,
  base = {revision: null, analysisId: null}, createdRevision = null,
  baseline = {}, read, onState = () => {}, storage = browserStorage()}) {
  const key = keyFor(user, kind, id);
  let ownedValue = null;
  let initial = null; let archived = []; let failed = !storage;
  try {
    ownedValue = storage?.getItem(key) || null;
    const value = JSON.parse(ownedValue || 'null');
    if (validRecord(value, user, kind, id)) initial = value;
    const previous = JSON.parse(storage?.getItem(`${key}:recovery`) || '[]');
    if (Array.isArray(previous)) archived = previous.filter(item => validRecord(item, user, kind, id));
  } catch { failed = true; }
  // 建题还在返回途中时重入产生的草稿尚无服务端版本；已记录编号且创建版本未变时可继续编辑它。
  const newlyCreated = kind === 'entry' && initial?.base.revision === null
    && createdRevision !== null && createdRevision === base.revision && initial.base.analysisId === base.analysisId;
  let mismatch = initial && !equal(initial.base, base) && !newlyCreated ? initial : null;
  let timer = null; let disposed = false; let dirty = false; let baselineValue = copy(baseline);
  const restored = initial && !mismatch ? copy(initial.data) : null;
  const status = state => { if (!disposed) onState(state); };
  function archiveMismatch() {
    if (!mismatch) return;
    const next = [...archived, mismatch];
    storage.setItem(`${key}:recovery`, JSON.stringify(next));
    archived = next; mismatch = null;
  }
  const session = {
    restored,
    get recovery() { return mismatch || archived.length ? copy([...archived, ...(mismatch ? [mismatch] : [])]) : null; },
    changed() {
      if (disposed) return;
      dirty = true;
      window.clearTimeout(timer);
      status(failed ? 'warning' : session.recovery ? 'recovery' : 'pending');
      timer = window.setTimeout(() => session.flush(), DELAY);
    },
    flush() {
      window.clearTimeout(timer); timer = null;
      if (disposed || !dirty) return;
      try {
        if (!storage) throw new Error('Browser storage unavailable');
        const data = copy(read());
        if (!validData(kind, data)) throw new Error('Invalid draft payload');
        // 保存当前输入前将旧版本草稿单独保留；恢复按钮只导出，不覆盖服务端新版。
        archiveMismatch();
        if (equal(data, baselineValue)) { storage.removeItem(key); ownedValue = null; }
        else {
          const value = JSON.stringify({schema: 1, user, kind, id, base: copy(base), data, writer: nonce()});
          storage.setItem(key, value); ownedValue = value;
        }
        dirty = false; failed = false;
        status(session.recovery ? 'recovery' : equal(data, baselineValue) ? 'hidden' : 'saved');
      } catch { failed = true; status('warning'); }
    },
    clean(value = read()) {
      window.clearTimeout(timer); timer = null; dirty = false; baselineValue = copy(value);
      try {
        if (!storage) throw new Error('Browser storage unavailable');
        // 慢请求可能在新视图写入后返回；只清理本 session 最后看到/写入的那一份。
        if ((storage.getItem(key) || null) !== ownedValue) return false;
        archiveMismatch(); storage.removeItem(key); ownedValue = null; failed = false;
        status(session.recovery ? 'recovery' : 'hidden');
        return true;
      } catch { failed = true; status('warning'); return false; }
    },
    clear(value = read()) {
      session.clean(value);
      try {
        if (!storage) throw new Error('Browser storage unavailable');
        storage.removeItem(`${key}:recovery`); mismatch = null; archived = [];
        status('hidden');
      } catch { failed = true; status('warning'); }
    },
    dispose() { if (disposed) return; session.flush(); disposed = true; window.clearTimeout(timer); },
  };
  status(session.recovery ? 'recovery' : restored ? 'saved' : 'hidden');
  return session;
}

// 全模块只保留一套离页监听。重新进入/刷新分析页先关闭旧视图，避免积累计时器和 DOM 引用。
let activeView = null;
let listening = false;
export function createDraftView() {
  activeView?.dispose();
  const route = window.location.hash;
  const cleanups = new Set();
  const flushes = new Set();
  const view = {
    active: true,
    add(cleanup) { if (view.active) cleanups.add(cleanup); else cleanup(); return () => cleanups.delete(cleanup); },
    onFlush(flush) { if (view.active) flushes.add(flush); return () => flushes.delete(flush); },
    flush() { for (const flush of flushes) flush(); },
    dispose() {
      if (!view.active) return;
      view.active = false;
      for (const cleanup of cleanups) cleanup();
      cleanups.clear();
      flushes.clear();
      if (activeView === view) activeView = null;
    },
  };
  activeView = view;
  if (!listening) {
    window.addEventListener('hashchange', () => {
      if (activeView && activeView.route !== window.location.hash) activeView.dispose();
    });
    window.addEventListener('pagehide', () => activeView?.flush());
    listening = true;
  }
  view.route = route;
  return view;
}
