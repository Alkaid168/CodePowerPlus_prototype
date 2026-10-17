/* 标签编辑器：手工标注与审核纠正共用同一份交互与校验。 */
import { api } from './api.js';
import { h, mount } from './dom.js';
import { button, field } from './components.js';
import { matchesSearch } from './search.js';
import { store } from './store.js';

export async function createTagEditor(initial = [], { compact = false, onChange = () => {} } = {}) {
  const knowledge = await store.ensureKnowledge(api);
  const selectable = knowledge.filter((node) => node.level > 1);
  const rows = initial.map((row) => ({ role: 'primary', evidence: '', confidence: 0.8, ...row }));

  const search = h('input', { class: 'input', type: 'search', placeholder: compact ? '搜索知识标签' : '搜索知识点名称或 ID（只列 L2 / L3）' });
  const picker = h('select', { class: 'input' });
  const host = h('div', { class: 'stack tight' });

  function refreshOptions() {
    const matches = selectable.filter((node) => matchesSearch(node, search.value)).slice(0, 500);
    mount(picker, matches.map((node) => h('option', { value: node.id }, compact ? node.name : `${node.name} · ${node.id}`)));
  }

  function rowNode(row, index) {
    const node = knowledge.find((item) => item.id === row.id);
    const role = h('select', { class: 'input' },
      h('option', { value: 'primary', selected: row.role === 'primary' }, compact ? '核心考点' : '主知识点'),
      h('option', { value: 'secondary', selected: row.role === 'secondary' }, compact ? '也涉及' : '辅助知识点'));
    role.addEventListener('change', () => { row.role = role.value; onChange(); });
    const evidence = h('textarea', { rows: 2, placeholder: '题面或解法中的具体证据，例如：需要快速回答区间和' }, row.evidence || '');
    evidence.addEventListener('input', () => { row.evidence = evidence.value; onChange(); });
    const confidence = h('input', { class: 'input', type: 'number', min: '0', max: '1', step: '0.05',
      value: String(row.confidence ?? 0.8) });
    confidence.addEventListener('input', () => { row.confidence = confidence.value; onChange(); });
    return h('fieldset', { class: 'list-item' },
      h('div', { class: 'row wrap' },
        h('strong', {}, node ? node.name : row.id),
        compact ? null : h('span', { class: 'mono muted' }, row.id),
        h('span', { class: 'spacer' }),
        button('移除', { variant: 'secondary', small: true, iconName: 'trash-2',
          onClick: () => { rows.splice(index, 1); paint(); onChange(); } })),
      h('div', { class: 'grid two', style: { marginTop: '10px' } },
        field('角色', role),
        compact ? null : field('该知识点置信度', confidence)),
      field('判断证据', evidence));
  }

  function paint() {
    mount(host, rows.length
      ? rows.map((row, index) => rowNode(row, index))
      : h('p', { class: 'hint' }, compact ? '暂无标签' : '还没有标签：先在上面搜索并添加一个主知识点。'));
  }

  const addButton = button('添加知识点', {
    variant: compact ? 'secondary' : '',
    iconName: 'plus',
    onClick: () => {
      if (!picker.value) return;
      const role = rows.some((row) => row.role === 'primary') ? 'secondary' : 'primary';
      rows.push({ id: picker.value, role, evidence: '', confidence: 0.8 });
      paint();
      onChange();
    },
  });

  search.addEventListener('input', refreshOptions);
  refreshOptions();
  paint();

  const node = h('div', { class: `stack${compact ? ' review-tag-editor' : ''}` },
    h('div', { class: 'card' },
      field('查找知识点', search),
      h('div', { class: 'inline-form' },
        h('div', { style: { flex: '1' } }, field('选择知识点', picker)),
        addButton)),
    host);

  return {
    node,
    rows,
    add(id, role = 'primary', evidence = '', confidence = 0.8) {
      rows.push({ id, role, evidence, confidence });
      paint();
      onChange();
    },
    reset(list = []) {
      rows.length = 0;
      rows.push(...list);
      paint();
    },
    read() {
      if (!rows.length) throw new Error('至少需要一个主知识点。');
      const primary = rows.filter((row) => row.role === 'primary');
      if (!primary.length) throw new Error('至少需要一个主知识点。');
      const missing = rows.find((row) => !String(row.evidence || '').trim());
      if (missing) throw new Error(`知识点 ${compact ? knowledge.find(node => node.id === missing.id)?.name || missing.id : missing.id} 还缺判断证据。`);
      const ids = rows.map((row) => row.id);
      if (new Set(ids).size !== ids.length) throw new Error('同一个知识点不能重复添加。');
      // 多个解法或同一分支的不同考点都可作主标签；祖先/后代冲突由服务端统一校验。
      return {
        primary_knowledge_ids: primary.map((row) => row.id),
        secondary_knowledge_ids: rows.filter((row) => row.role === 'secondary').map((row) => row.id),
        evidence: Object.fromEntries(rows.map((row) => [row.id, String(row.evidence).trim()])),
        knowledge_confidence: Object.fromEntries(rows.map((row) => [row.id, Number(row.confidence)])),
      };
    },
  };
}
