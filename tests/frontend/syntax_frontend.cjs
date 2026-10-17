const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

class Node {
  constructor(tag, props = {}, ...children) {
    this.tag = tag; this.children = []; this.listeners = {}; this.value = ''; this.dataset = {};
    this.className = ''; this.disabled = false; this.isConnected = true;
    this.classList = { add() {}, toggle() {} }; Object.assign(this, props); this.append(...children);
    if (tag === 'select') this.value = (this.children.find(c => c.selected) || this.children[0])?.value || '';
  }
  append(...children) { this.children.push(...children.flat(Infinity).filter(c => c !== null && c !== undefined && c !== false)); }
  setAttribute(k, v) { this[k] = v; }
  getAttribute(k) { return this[k]; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  querySelectorAll(selector) {
    if (selector === 'button') return all(this).filter(n => n.tag === 'button');
    return [];
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  contains(n) { return all(this).includes(n); }
  focus() { document.activeElement = this; }
  scrollIntoView(options) { this.scrolled = options; }
  scrollTo(options) { Object.assign(this, options); }
  get textContent() { return text(this); }
  set textContent(v) { this.children = [String(v)]; }
}
const all = n => (n.children || []).flatMap(c => c instanceof Node ? [c, ...all(c)] : []);
const text = n => (n.children || []).map(c => c instanceof Node ? text(c) : String(c)).join('');
const h = (tag, props = {}, ...children) => {
  const n = new Node(tag, props, ...children);
  for (const [k, v] of Object.entries(props)) if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
  return n;
};
const mount = (n, ...children) => { n.children = []; n.append(...children); return n; };
const document = { activeElement: null, body: new Node('body'), createElementNS: (_, tag) => new Node(tag) };
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const click = async n => { assert.ok(n, 'missing button'); await n.listeners.click?.({ currentTarget: n, preventDefault() {} }); await tick(); };
const find = (n, label) => all(n).find(c => c.tag === 'button' && text(c) === label);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

(async () => {
  const syntax = { id: 'syntax', name: '语法基础', level: 1, children: [] };
  const output = { id: 'syntax.output', name: '输出入门', level: 2, parent_id: 'syntax', intro_rating: 100,
    summary: '输出文字', children: [] };
  syntax.children.push(output);
  const roots = [syntax, ...['basic', 'search', 'dp', 'string', 'math', 'ds', 'graph', 'geometry', 'misc']
    .map(id => ({ id, name: id === 'basic' ? '算法基础' : id, level: 1, children: [] }))];
  const flat = [...roots, output]; const byId = new Map(flat.map(n => [n.id, n]));
  const requests = []; let slow = null;
  const api = { knowledgeDetail: async id => slow && id === 'syntax' ? slow.promise : { ...byId.get(id), ancestors: id === output.id ? [syntax] : [] },
    problems: async criteria => { requests.push(criteria); return { items: [], total: 0 }; } };
  const store = { state: { knowledge: flat, knowledgeTree: roots }, ensureKnowledge: async () => flat };
  const components = { button: (label, props) => h('button', props, label), card: (props, ...c) => h('section', {}, props.actions, ...c),
    difficultyTag: () => h('span'), emptyState: label => h('p', {}, label), errorBox: e => h('p', {}, e.message), loading: () => h('p', {}, 'loading'),
    formatDate: v => v, notice: () => null, sourceLink: () => null, statusBadge: () => null, table: () => h('table'), tag: () => null };
  const stubs = { 'api.js': { api }, 'store.js': { store }, 'dom.js': { h, mount }, 'icons.js': { icon: () => h('svg') },
    'components.js': components, 'search.js': { matchesSearch: (node, query) => node.name.includes(query), normalizeSearch: v => v },
    'router.js': { navigate() {} }, 'problemStatement.js': { statementHost: () => h('article') }, 'problemEdit.js': { default: {} } };
  const context = vm.createContext({ document, queueMicrotask, requestAnimationFrame: fn => fn(), window: { requestAnimationFrame: fn => fn() } });
  const cache = new Map();
  async function moduleAt(file) {
    if (cache.has(file)) return cache.get(file);
    const module = new vm.SourceTextModule(fs.readFileSync(file, 'utf8'), { context }); cache.set(file, module);
    await module.link(async spec => {
      const basename = path.basename(spec); const data = stubs[basename];
      if (data) return new vm.SyntheticModule(Object.keys(data), function () { for (const [k, v] of Object.entries(data)) this.setExport(k, v); }, { context });
      return moduleAt(path.resolve(path.dirname(file), spec));
    }); return module;
  }
  const scenario = process.argv[2];
  const module = await moduleAt(path.resolve(`app/static/js/views/${scenario === 'filters' ? 'problems' : 'knowledge'}.js`)); await module.evaluate();
  if (scenario === 'filters') {
    const view = await module.namespace.default.render({ param: '' }); await tick();
    const select = all(view).find(n => n.tag === 'select' && n['aria-label'] === '难度筛选');
    assert.equal(select.children.length, 16); assert.equal(text(select.children[1]), '输出入门 · 100');
    assert.equal(text(select.children[7]), '基础综合 · 700'); assert.equal(text(select.children[8]), '入门 · 800–1000');
    select.value = '100,100'; select.listeners.change(); await tick();
    assert.equal(requests.at(-1).difficulty_min, 100); assert.equal(requests.at(-1).difficulty_max, 100);
  } else if (scenario === 'knowledge') {
    const view = await module.namespace.default.render({ param: 'syntax' }); await tick();
    const art = all(view).find(n => n.tag === 'svg' && n.role === 'img');
    assert.ok(art); assert.ok(text(art).includes('printf') && text(art).includes('main.c'), 'syntax needs a C terminal/code illustration');
    await click(find(view, '输出入门')); assert.ok(!text(view).includes('入门门槛'));
    await click(find(view, '算法基础')); const basicArt = all(view).find(n => n.tag === 'svg' && n.role === 'img');
    assert.ok(!text(basicArt).includes('printf')); assert.equal(all(basicArt).filter(n => n.tag === 'rect').length, 5);
  } else if (scenario === 'navigation') {
    const view = await module.namespace.default.render({ param: '' }); await tick();
    const tabs = all(view).find(n => n.role === 'tablist');
    assert.equal(tabs.children.length, 10); assert.equal(tabs.children.filter(n => n.tabIndex === 0).length, 1);
    let prevented = false;
    tabs.children[0].listeners.keydown({ key: 'End', preventDefault() { prevented = true; } }); await tick();
    assert.ok(prevented); assert.equal(document.activeElement.textContent, 'misc');
    assert.equal(tabs.children.at(-1)['aria-selected'], 'true'); assert.ok(tabs.children.at(-1).scrolled);
  } else if (scenario === 'race') {
    slow = deferred(); const view = await module.namespace.default.render({ param: '' }); await tick();
    await click(find(view, '算法基础')); slow.resolve({ ...syntax, ancestors: [] }); await tick();
    const detail = all(view).find(n => n.class === 'knowledge-detail');
    assert.ok(text(detail).startsWith('算法基础'), 'delayed syntax response cannot replace the selected domain');
  }
  console.log(`PASS ${scenario}`);
})().catch(error => { console.error(error); process.exitCode = 1; });
