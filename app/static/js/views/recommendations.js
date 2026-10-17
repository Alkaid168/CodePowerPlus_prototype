/* 推荐训练：按标签薄弱度与难度适配排序，并给出可核对的分项理由。 */
import { api } from '../api.js';
import { h, mount } from '../dom.js';
import { navigate } from '../router.js';
import { store } from '../store.js';
import { button, card, emptyState, errorBox, loading, notice } from '../components.js';

export default {
  async render() {
    const host = h('div', { class: 'stack' });
    const node = h('div', { class: 'stack' },
      card({ title: `推荐训练 · ${store.state.userId}` },
        notice('只推荐当前版本、已审核的题目，并排除你已经 AC 的题目；推荐分 = 薄弱度 × 0.6 + 难度适配 × 0.4。')),
      host);
    load(host);
    return node;
  },
};

async function load(host) {
  mount(host, loading('计算推荐…'));
  try {
    const data = await api.recommendations(store.state.userId);
    const items = data.recommendations || [];
    mount(host, items.length
      ? h('div', { class: 'grid two' }, items.map(cardFor))
      : emptyState('暂时没有可推荐的题目。先分析并审核题目，或换一个学习者。'));
  } catch (error) {
    mount(host, errorBox(error, () => load(host)));
  }
}

function cardFor(item) {
  return h('section', { class: 'card' },
    h('div', { class: 'row' },
      h('div', {},
        h('h2', {}, item.title),
        h('p', { class: 'hint' },
          `#${item.problem_id} · 难度评分 ${item.difficulty ?? '—'}${item.difficulty_band ? `（${item.difficulty_band}）` : ''}`)),
      h('span', { class: 'spacer' }),
      h('span', { class: 'badge info' }, `推荐分 ${item.recommendation_score.toFixed(2)}`)),
    h('div', { class: 'row wrap', style: { marginTop: '10px' } },
      item.target_knowledge_ids.map((id, index) => h('button', {
        type: 'button', class: 'tag', onClick: () => navigate(`knowledge/${encodeURIComponent(id)}`),
      }, item.target_knowledge_names[index] || id))),
    h('ul', { style: { margin: '10px 0 0', paddingLeft: '18px' } },
      item.reasons.map((reason) => h('li', {}, reason))),
    h('dl', { class: 'score-list', style: { marginTop: '12px' } },
      Object.entries(item.score_breakdown).map(([key, value]) => h('div', {},
        h('dt', {}, key === 'weakness' ? '薄弱度' : '难度匹配'), h('dd', {}, String(value))))),
    h('div', { class: 'row', style: { marginTop: '12px' } },
      button('查看题目', { onClick: () => navigate(`problems/${item.problem_id}`) })));
}
