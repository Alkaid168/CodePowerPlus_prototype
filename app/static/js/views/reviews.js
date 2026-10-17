/* 审核队列只展示摘要，单题审核使用独立地址。 */
import { api } from '../api.js';
import { h, mount } from '../dom.js';
import { store } from '../store.js';
import { icon } from '../icons.js';
import { normalizeSearch } from '../search.js';
import { pageNumbers } from '../problemFilters.js';
import { button, card, difficultyTag, emptyState, errorBox, loading, statusBadge, table, tag } from '../components.js';
import { renderReviewDetail } from './reviewDetail.js';
const STATUSES = [['pending', '待审核'], ['approved', '已通过'], ['rejected', '已驳回']];
const queueState = { status: 'pending', query: '', page: 1, size: 20 };
export default {
  async render({ param } = {}) {
    await store.ensureKnowledge(api);
    return param ? renderReviewDetail(Number(param)) : renderQueue();
  },
};
function renderQueue() {
  const names = new Map(store.state.knowledge.map(node => [node.id, node.name]));
  let items = [], requestId = 0, queueLoading = false, queueFailed = false;
  const tabs = h('div', { class: 'tabs review-status-tabs', role: 'group', 'aria-label': '审核状态' });
  const host = h('div', { class: 'review-queue-results', 'aria-live': 'polite' });
  const count = h('span', { class: 'hint review-queue-count' });
  const search = h('input', { class: 'input', type: 'search', value: queueState.query,
    'aria-label': '搜索审核题目', placeholder: '搜索题号、题名或标签', onInput: () => {
      queueState.query = search.value; queueState.page = 1; paint();
    } });
  function paintTabs(focusStatus = '') {
    mount(tabs, STATUSES.map(([status, label]) => h('button', { type: 'button',
      class: `tab${status === queueState.status ? ' active' : ''}`, 'aria-pressed': String(status === queueState.status),
      onClick: () => { queueState.status = status; queueState.page = 1; paintTabs(status); load(); } }, label)));
    if (focusStatus) [...tabs.children][STATUSES.findIndex(([value]) => value === focusStatus)]?.focus({ preventScroll: true });
  }
  function paint(focus = '') {
    if (queueLoading || queueFailed) return;
    const query = normalizeSearch(queueState.query);
    const found = items.filter(problem => normalizeSearch([problem.id, problem.title,
      ...[...problem.analysis.primary_knowledge_ids, ...problem.analysis.secondary_knowledge_ids]
        .flatMap(id => [id, names.get(id) || ''])].join(' ')).includes(query));
    const pages = Math.max(1, Math.ceil(found.length / queueState.size));
    queueState.page = Math.min(queueState.page, pages);
    count.textContent = `共 ${found.length} 题`;
    const rows = found.slice((queueState.page - 1) * queueState.size, queueState.page * queueState.size);
    const link = (problem, label, className) => h('a', { href: `#/reviews/${problem.id}`, class: className,
      target: '_blank', rel: 'noopener noreferrer', title: `在新标签页打开 #${problem.id}` }, label);
    const listing = table(['题目', '知识标签', '难度', '状态', ''], rows.map(problem => {
      const analysis = problem.analysis;
      return [h('div', { class: 'review-queue-title' }, h('span', { class: 'review-number' }, `#${problem.id}`),
        link(problem, problem.title, 'review-title-link')),
      h('div', { class: 'problem-list-tags' }, [...analysis.primary_knowledge_ids, ...analysis.secondary_knowledge_ids]
        .map(id => tag(names.get(id) || '旧版标签', 'muted'))),
      difficultyTag(analysis.difficulty, analysis.difficulty_band),
      analysis.is_stale ? h('span', { class: 'badge pending' }, '需要更新') : statusBadge(analysis.review_status),
      link(problem, analysis.review_status === 'pending' && !analysis.is_stale ? '审核' : '查看', 'btn secondary small')];
    }));
    listing.classList.add('review-queue-table');
    const size = h('select', { 'aria-label': '每页审核题目数', onChange: event => {
      queueState.size = Number(event.target.value); queueState.page = 1; paint('size');
    } }, [10, 20, 50].map(value => h('option', { value: String(value) }, `${value} 题 / 页`)));
    size.value = String(queueState.size);
    function go(page, control) { queueState.page = page; paint(control); }
    const controls = new Map();
    const previous = button('上一页', { variant: 'secondary', small: true, disabled: queueState.page <= 1,
      onClick: () => go(queueState.page - 1, 'previous') });
    const next = button('下一页', { variant: 'secondary', small: true, disabled: queueState.page >= pages,
      onClick: () => go(queueState.page + 1, 'next') });
    controls.set('previous', previous); controls.set('next', next); controls.set('size', size);
    const pageControls = pageNumbers(queueState.page, pages).map(page => {
      if (page === '…') return h('span', {}, '…');
      const control = h('button', { type: 'button', class: `btn small ${page === queueState.page ? '' : 'secondary'}`,
        'aria-label': `第 ${page} 页`, 'aria-current': page === queueState.page ? 'page' : null,
        onClick: () => go(page, String(page)) }, page);
      controls.set(String(page), control); return control;
    });
    mount(host, rows.length ? listing : emptyState(query ? '没有找到匹配的题目' : queueState.status === 'pending' ? '暂无待审核题目' : '暂无记录'),
      h('footer', { class: 'problem-pagination review-pagination' }, count, size,
        h('nav', { class: 'problem-page-buttons', 'aria-label': '审核队列分页' },
          previous, pageControls, next)));
    if (focus) {
      const target = controls.get(focus);
      (target && !target.disabled ? target : controls.get(String(queueState.page)))?.focus({ preventScroll: true });
    }
  }
  async function load() {
    const request = ++requestId;
    queueLoading = true; queueFailed = false; items = [];
    count.textContent = ''; host.setAttribute('aria-busy', 'true'); mount(host, loading('读取队列…'));
    try {
      const data = await api.reviewQueue(queueState.status);
      if (request !== requestId) return;
      queueLoading = false; items = data.items; paint();
    } catch (error) { if (request === requestId) { queueFailed = true; mount(host, errorBox(error, load)); } }
    finally { if (request === requestId) { queueLoading = false; host.setAttribute('aria-busy', 'false'); } }
  }
  paintTabs(); load();
  return h('div', { class: 'review-queue' }, card({ className: 'review-queue-card' },
    h('header', { class: 'review-queue-toolbar' }, tabs, h('div', { class: 'problem-search-input' }, icon('search'), search)), host));
}
