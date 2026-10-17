/* 题库标签筛选：中文名称与路径展示，沿用知识树的双语检索规则。 */
import { h, mount } from './dom.js';
import { matchesSearch } from './search.js';
import { icon } from './icons.js';

export const DIFFICULTY_BANDS = [
  [100, 100, '输出入门'], [200, 200, '变量与输入输出'], [300, 300, '基本运算'],
  [400, 400, '条件分支'], [500, 500, '循环与数组'], [600, 600, '字符与字符串'], [700, 700, '基础综合'],
  [800, 1000, '入门'], [1100, 1300, '基础'], [1400, 1600, '进阶'], [1700, 1900, '提高'],
  [2000, 2200, '区域赛铜牌'], [2300, 2500, '区域赛银牌'], [2600, 2900, '区域赛金牌'], [3000, 3500, '国际赛'],
];

export function knowledgeFilter(nodes, onChange) {
  let selected = new Set(), draft = new Set(), domain = '';
  const names = new Map(nodes.map(node => [node.id, node]));
  const children = new Map();
  for (const node of nodes) {
    const key = node.parent_id || '';
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(node);
  }
  const domains = children.get('') || [];
  let chipRefs = new Map();
  const path = node => {
    const parents = [];
    for (let parent = names.get(node.parent_id); parent; parent = names.get(parent.parent_id)) parents.unshift(parent.name);
    return parents.join(' / ');
  };
  const label = h('span', {}, '全部标签');
  const trigger = h('button', { class: 'input problem-tag-trigger', type: 'button', id: 'problem-tag-filter',
    'aria-label': '标签筛选', 'aria-haspopup': 'dialog', 'aria-expanded': 'false',
    'aria-controls': 'problem-tag-dialog', onClick: open }, label, icon('chevron-right'));
  const search = h('input', { class: 'input', type: 'search', placeholder: '搜索全部标签',
    'aria-label': '搜索全部标签', onInput: () => {
      if (domain) { domain = ''; renderNavigation(); }
      renderGroups();
    },
    onKeydown: event => {
      if (event.key === 'Enter') event.preventDefault();
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const controls = [...groups.querySelectorAll('[data-tag-id]')];
        // 搜索结果先定位最具体的匹配，避免回车误选整个领域。
        const matches = controls.filter(control => matchesSearch(names.get(control.dataset.tagId), search.value.trim()));
        const targets = matches.length ? matches : controls;
        (event.key === 'ArrowDown' ? targets[0] : targets.at(-1))?.focus();
      }
    } });
  const navigation = h('nav', { class: 'problem-tag-domains', 'aria-label': '标签分类' });
  const selectedCount = h('span', { 'aria-live': 'polite' });
  const selection = h('div', { class: 'problem-tag-selection' });
  const clear = h('button', { type: 'button', class: 'btn ghost small', onClick: () => {
    draft.clear(); updateSelection(); clear.focus();
  } }, '清空');
  const groups = h('div', { class: 'problem-tag-groups', tabIndex: 0, 'aria-label': '分类标签列表' });
  groups.addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const controls = [...groups.querySelectorAll('[data-tag-id]')];
    const index = controls.indexOf(event.target);
    if (index < 0) return;
    event.preventDefault();
    const step = ['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1;
    if (index + step < 0) search.focus();
    else controls[Math.min(index + step, controls.length - 1)]?.focus();
  });
  const dialog = h('dialog', { class: 'problem-tag-dialog', id: 'problem-tag-dialog',
    'aria-labelledby': 'problem-tag-dialog-title', 'aria-describedby': 'problem-tag-mode' },
  h('header', { class: 'problem-tag-dialog-header' }, h('h2', { id: 'problem-tag-dialog-title' }, '选择算法标签'),
    h('button', { type: 'button', class: 'btn ghost problem-tag-close', 'aria-label': '关闭标签选择', onClick: close }, icon('x'))),
  h('div', { class: 'problem-tag-dialog-tools' }, h('div', { class: 'problem-search-input' }, icon('search'), search), navigation),
  h('section', { class: 'problem-tag-selected' }, h('div', { class: 'problem-tag-selected-heading' }, selectedCount, clear), selection),
  groups,
  h('footer', { class: 'problem-tag-dialog-footer' }, h('span', { class: 'hint', id: 'problem-tag-mode' }, '同时包含所选标签；大类包含其下级'),
    h('div', {}, h('button', { type: 'button', class: 'btn secondary', onClick: close }, '取消'),
      h('button', { type: 'button', class: 'btn', onClick: () => {
        selected = new Set(draft); label.textContent = selected.size ? `已选 ${selected.size} 个标签` : '全部标签';
        trigger.title = [...selected].map(id => names.get(id).name).join('、');
        close(); onChange([...selected]);
      } }, '确认筛选'))));
  const root = h('div', { class: 'problem-tag-filter' }, trigger, dialog);

  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const controls = [...dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex="0"]')];
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });

  function close() { dialog.close(); }
  dialog.addEventListener('close', () => {
    trigger.setAttribute('aria-expanded', 'false');
    if (trigger.isConnected) trigger.focus({ preventScroll: true });
  });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
  });
  function open() {
    draft = new Set(selected); domain = ''; search.value = '';
    renderNavigation(); renderGroups(); updateSelection();
    dialog.showModal(); trigger.setAttribute('aria-expanded', 'true'); search.focus(); groups.scrollTop = 0;
  }
  function renderNavigation() {
    mount(navigation, [{ id: '', name: '全部分类' }, ...domains].map(node => h('button', {
      type: 'button', class: 'problem-tag-domain', 'aria-pressed': String(domain === node.id),
      onClick: event => {
        domain = node.id;
        for (const control of navigation.children) control.setAttribute('aria-pressed', String(control === event.currentTarget));
        renderGroups();
      },
    }, node.name)));
  }
  function chip(node, wholeDomain = false) {
    const control = h('button', { type: 'button', class: 'problem-tag-chip', title: path(node),
      dataset: { tagId: node.id }, 'aria-label': wholeDomain ? `选择整个${node.name}` : node.name,
      'aria-pressed': String(draft.has(node.id)), onClick: () => {
        if (draft.has(node.id)) draft.delete(node.id); else draft.add(node.id);
        updateSelection();
      } }, wholeDomain ? `${node.name}（全部）` : node.name);
    chipRefs.set(node.id, control); return control;
  }
  function renderGroups() {
    chipRefs = new Map();
    const query = search.value.trim();
    const matched = node => matchesSearch(node, query) || (query && matchesSearch({ name: path(node) }, query));
    const below = node => [node, ...(children.get(node.id) || []).flatMap(below)];
    const sections = domains.filter(node => !domain || domain === node.id).map(top => {
      const branches = [];
      let loose = [];
      const flush = () => {
        if (loose.length) branches.push(h('div', { class: 'problem-tag-loose' }, loose));
        loose = [];
      };
      for (const branch of children.get(top.id) || []) {
        const leaves = (children.get(branch.id) || []).flatMap(below).filter(matched);
        if (!matched(branch) && !leaves.length) continue;
        if (!leaves.length) { loose.push(chip(branch)); continue; }
        flush();
        branches.push(h('div', { class: 'problem-tag-branch' }, chip(branch),
          h('div', { class: 'problem-tag-leaves' }, leaves.map(node => chip(node)))));
      }
      flush();
      if (!matched(top) && !branches.length) return null;
      return h('section', { class: 'problem-tag-section' },
        h('div', { class: 'problem-tag-section-heading' }, h('h3', {}, top.name), chip(top, true)), branches);
    }).filter(Boolean);
    mount(groups, sections.length ? sections : h('div', { class: 'problem-tag-empty' }, '没有找到匹配的标签'));
    groups.scrollTop = 0;
  }
  function updateSelection() {
    selectedCount.textContent = `已选标签（${draft.size}）`;
    for (const [id, control] of chipRefs) control.setAttribute('aria-pressed', String(draft.has(id)));
    mount(selection, draft.size ? [...draft].map(id => h('button', { type: 'button', class: 'problem-tag-remove',
      'aria-label': `移除${names.get(id).name}`, onClick: () => {
        draft.delete(id); updateSelection(); search.focus();
      } }, names.get(id).name, icon('x'))) : h('span', { class: 'hint' }, '暂未选择标签'));
  }
  return { node: root, value: () => [...selected] };
}

export function pageNumbers(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [...new Set([1, total, current - 1, current, current + 1].filter(p => p >= 1 && p <= total))].sort((a, b) => a - b);
  return pages.flatMap((p, i) => i && p - pages[i - 1] > 1 ? ['…', p] : [p]);
}
