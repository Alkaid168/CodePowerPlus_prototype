/* 题目库与题面阅读：左题面、右题目信息；列表通过原生链接在新标签页打开。 */
import { api } from '../api.js';
import { h, mount } from '../dom.js';
import { statementHost } from '../problemStatement.js';
import problemEditView from './problemEdit.js';
import { navigate } from '../router.js';
import { store } from '../store.js';
import { icon } from '../icons.js';
import { DIFFICULTY_BANDS, knowledgeFilter, pageNumbers } from '../problemFilters.js';
import { button, card, difficultyTag, emptyState, errorBox, formatDate, loading, notice, sourceLink,
  statusBadge, table, tag } from '../components.js';

export default {
  async render({ param }) {
    const editing = /^(\d+)\/edit$/.exec(param || '');
    if (editing) return problemEditView.render({ problemId: Number(editing[1]) });
    return param ? renderDetail(Number(param)) : renderList();
  },
};

async function renderList() {
  try {
    await store.ensureKnowledge(api);
  } catch (error) { return errorBox(error, () => navigate('problems')); }
  const names = new Map(store.state.knowledge.map(node => [node.id, node.name]));
  let page = 1, pageSize = 20, totalPages = 1, requestId = 0;
  let criteria = { q: '', knowledge_ids: '', difficulty_min: null, difficulty_max: null };
  const host = h('div', { class: 'problem-list-results', 'aria-live': 'polite' });
  const count = h('span', { class: 'hint problem-result-count' });
  const search = h('input', { class: 'input', id: 'problem-query', type: 'search',
    'aria-label': '题目搜索', placeholder: '搜索题目标题、正文或算法标签' });
  const difficulty = h('select', { 'aria-label': '难度筛选' }, h('option', { value: '' }, '全部难度'),
    DIFFICULTY_BANDS.map(([low, high, name]) => h('option', { value: `${low},${high}` },
      `${name} · ${low === high ? low : `${low}–${high}`}`)));
  const tags = knowledgeFilter(store.state.knowledge, () => applyFilters());
  const form = h('form', { class: 'problem-search-form' },
    h('div', { class: 'problem-search-input' }, icon('search'), search), difficulty, tags.node,
    button('搜索', { type: 'submit' }));
  form.addEventListener('submit', event => { event.preventDefault(); applyFilters(); });
  difficulty.addEventListener('change', applyFilters);
  function applyFilters() {
    const [low, high] = difficulty.value.split(',').map(Number);
    criteria = { q: search.value.trim(), knowledge_ids: tags.value().join(','),
      difficulty_min: difficulty.value ? low : null, difficulty_max: difficulty.value ? high : null };
    page = 1; load();
  }
  function goTo(value) {
    page = Math.min(totalPages, Math.max(1, Number(value) || 1)); load();
  }
  function pagination(total) {
    const size = h('select', { 'aria-label': '每页题目数', onChange: event => {
      pageSize = Number(event.target.value); page = 1; load();
    } }, [10, 20, 50, 100].map(value => h('option', { value: String(value) }, `${value} 题 / 页`)));
    size.value = String(pageSize);
    const jump = h('input', { class: 'input', type: 'number', min: 1, max: totalPages,
      value: page, required: true, 'aria-label': '跳转页码' });
    const jumpForm = h('form', { class: 'problem-page-jump', onSubmit: event => {
      event.preventDefault(); goTo(jump.value);
    } }, h('span', {}, '跳至'), jump, h('span', {}, '页'),
    button('跳转', { type: 'submit', variant: 'secondary', small: true }));
    return h('footer', { class: 'problem-pagination' },
      h('div', { class: 'problem-pagination-summary' }, h('span', {}, `共 ${total} 题`), size),
      h('nav', { class: 'problem-page-buttons', 'aria-label': '题目分页' },
        button('上一页', { variant: 'secondary', small: true, disabled: page <= 1, onClick: () => goTo(page - 1) }),
        pageNumbers(page, totalPages).map(value => value === '…' ? h('span', { class: 'problem-page-ellipsis' }, '…')
          : h('button', { class: `btn small problem-page-number ${value === page ? '' : 'secondary'}`, type: 'button',
            'aria-label': `第 ${value} 页`, 'aria-current': value === page ? 'page' : null,
            onClick: () => goTo(value) }, value)),
        button('下一页', { variant: 'secondary', small: true, disabled: page >= totalPages, onClick: () => goTo(page + 1) })),
      jumpForm);
  }
  async function load() {
    const current = ++requestId;
    const focusLabel = host.contains(document.activeElement) ? document.activeElement.getAttribute('aria-label') : null;
    host.setAttribute('aria-busy', 'true');
    mount(host, loading('读取题目…'));
    try {
      const data = await api.problems({ ...criteria, limit: pageSize, offset: (page - 1) * pageSize });
      if (current !== requestId) return;
      totalPages = Math.max(1, Math.ceil(data.total / pageSize));
      if (page > totalPages) { page = totalPages; return load(); }
      count.textContent = data.total ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, data.total)} / ${data.total} 题` : '0 题';
      const listing = table(['题号', '题目', '标签', '难度', '分析状态', '录入时间', ''],
        data.items.map(problem => [
          h('span', { class: 'problem-list-id' }, `#${problem.id}`),
          problemLink(problem, 'btn link problem-list-title', problem.title),
          h('div', { class: 'problem-list-tags' }, problem.knowledge_ids.length
            ? problem.knowledge_ids.map(id => tag(names.get(id) || '旧版标签', 'muted')) : h('span', { class: 'hint' }, '—')),
          difficultyTag(problem.difficulty, problem.difficulty_band),
          problem.analysis_stale ? h('span', { class: 'badge pending' }, '需要更新')
            : problem.analysis_status ? statusBadge(problem.analysis_status) : h('span', { class: 'hint' }, '未分析'),
          h('span', { class: 'problem-list-date', title: formatDate(problem.created_at) }, formatDate(problem.created_at).split(' ')[0]),
          problemLink(problem, 'btn secondary small', '查看'),
        ]));
      listing.classList.add('problem-list-table');
      [...listing.querySelectorAll('tbody tr')].forEach(row => [...row.children].forEach((cell, i) => {
        cell.dataset.label = ['题号', '题目', '标签', '难度', '分析状态', '录入时间', ''][i];
      }));
      mount(host, data.items.length ? listing : emptyState(
        criteria.q || criteria.knowledge_ids || criteria.difficulty_min ? '没有找到符合条件的题目，可调整筛选后重试。' : '题库还没有题目。',
        !criteria.q && !criteria.knowledge_ids && !criteria.difficulty_min
          ? button('去录入题目', { onClick: () => navigate('analysis') }) : null), pagination(data.total));
      // 等待期间用户主动切到搜索框时，不能抢走其焦点。
      if (focusLabel && host.isConnected && (document.activeElement === document.body
          || document.activeElement === document.querySelector('main'))) {
        const target = [...host.querySelectorAll('[aria-label]')].find(control => control.getAttribute('aria-label') === focusLabel);
        (target && !target.disabled ? target : host.querySelector('[aria-current=page]'))?.focus({ preventScroll: true });
      }
    } catch (error) { if (current === requestId) { count.textContent = ''; mount(host, errorBox(error, load)); } }
    finally { if (current === requestId) host.setAttribute('aria-busy', 'false'); }
  }
  const node = h('div', { class: 'problem-library' },
    card({ title: '题目检索', className: 'problem-search-card' }, form),
    card({ title: '题目列表', className: 'problem-list-card', actions: count }, host));
  load(); return node;
}

function problemLink(problem, className, label) {
  return h('a', { class: className, href: `#/problems/${problem.id}`, target: '_blank', rel: 'noopener noreferrer',
    title: `在新标签页打开 #${problem.id}` }, label);
}

async function renderDetail(problemId) {
  try {
    await store.ensureKnowledge(api);
    const names = new Map(store.state.knowledge.map((node) => [node.id, node.name]));
    const problem = await api.problem(problemId);
    const analysis = problem.analysis;
    const knowledgeGroup = (label, ids) => !ids?.length ? null : h('section', { class: 'problem-knowledge-group' },
      h('h3', {}, label),
      h('div', { class: 'problem-tags' }, ids.map((id) => tag(names.get(id) || id, 'muted', { title: id }))),
      h('div', { class: 'problem-evidence' }, ids.filter((id) => analysis.evidence?.[id]).map((id) =>
        h('p', {}, h('span', { class: 'problem-evidence-name' }, `${names.get(id) || id}：`), analysis.evidence[id]))));
    const information = h('aside', { class: 'problem-information', 'aria-label': '题目信息' },
      card({ title: '题目信息', className: 'problem-info-card',
        actions: analysis ? statusBadge(analysis.review_status) : null },
        analysis ? h('div', { class: 'problem-analysis-summary' },
          analysis.is_stale ? notice('题目已修订，这份分析需要更新。', 'warn') : null,
          h('div', { class: 'problem-rating' }, h('span', { class: 'problem-caption' }, '难度'),
            difficultyTag(analysis.difficulty, analysis.difficulty_band)),
          analysis.difficulty_reason ? h('section', { class: 'problem-rating-reason' },
            h('h3', {}, '难度说明'), h('p', {}, analysis.difficulty_reason)) : null,
          knowledgeGroup('核心考点', analysis.primary_knowledge_ids),
          knowledgeGroup('也涉及', analysis.secondary_knowledge_ids))
          : h('p', { class: 'problem-info-empty' }, '暂未分析，可前往手工标注。'),
        problem.source_url ? h('section', { class: 'problem-source' },
          h('span', { class: 'problem-caption' }, '题目来源'), sourceLink(problem.source_url)) : null,
        h('div', { class: 'problem-info-actions' },
          button('手工标注', { iconName: 'tags', onClick: () => navigate(`analysis/${problem.id}`) }),
          analysis?.review_status === 'pending'
            ? button('去审核', { variant: 'secondary', iconName: 'clipboard-check', onClick: () => navigate(`reviews/${problem.id}`) }) : null,
          button('去编辑', { variant: 'secondary', iconName: 'square-pen', onClick: () => navigate(`problems/${problem.id}/edit`) }))));
    return h('div', { class: 'problem-detail' },
      h('header', { class: 'problem-header' },
        h('h1', { class: 'problem-heading' },
          h('span', { class: 'problem-number' }, `#${problem.id} `),
          h('span', { class: 'problem-title' }, problem.title))),
      h('div', { class: 'problem-reading-layout' },
        h('section', { class: 'card problem-statement-card', 'aria-label': '题面' }, statementHost(problem.description, problem.title)),
        information));
  } catch (error) {
    return h('div', { class: 'stack' }, errorBox(error, () => navigate(`problems/${problemId}`)));
  }
}
