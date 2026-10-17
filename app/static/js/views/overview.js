/* 总览：无顶部栏；卡片铺满主体；有题目时展示具体题目。 */
import { api } from '../api.js';
import { h } from '../dom.js';
import { navigate } from '../router.js';
import { store } from '../store.js';
import { button } from '../components.js';

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return '上午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function metric(label, value) {
  return h('article', { class: 'card overview-metric' },
    h('div', { class: 'overview-metric-label' }, label),
    h('div', { class: 'overview-metric-value' }, String(value)));
}

function focusCard(problem) {
  if (problem) {
    return h('section', { class: 'card overview-focus' },
      h('div', { class: 'overview-focus-copy' },
        h('h2', { class: 'overview-problem-heading' },
          h('span', { class: 'overview-problem-number' }, `#${problem.id} `),
          h('span', { class: 'overview-problem-title' }, problem.title)),
        h('div', { class: 'overview-focus-actions' },
          button('开始练习', { iconName: 'play', onClick: () => navigate(`problems/${problem.id}`) }),
          button('查看题目分析', { variant: 'secondary', iconName: 'clipboard-check', onClick: () => navigate(`analysis/${problem.id}`) }))));
  }
  return h('section', { class: 'card overview-focus' },
    h('div', { class: 'overview-focus-copy' },
      h('span', { class: 'tag' }, '开始使用'),
      h('h2', {}, '建立第一道题的学习记录'),
      h('div', { class: 'overview-focus-actions' },
        button('录入并分析题目', { iconName: 'sparkles', onClick: () => navigate('analysis') }),
        button('查看能力画像', { variant: 'secondary', iconName: 'user-round', onClick: () => navigate('profile') }))));
}

function knowledgePanel(weak) {
  const empty = weak.length === 0;
  return h('section', { class: `card overview-lower-card${empty ? ' overview-lower-empty' : ''}` },
    h('div', { class: 'overview-section-head' }, h('h2', {}, '薄弱知识点')),
    empty
      ? h('div', { class: 'overview-empty-copy' },
          h('p', {}, '暂无做题证据'),
          button('查看能力画像', { variant: 'secondary', onClick: () => navigate('profile') }))
      : h('div', { class: 'overview-progress-list' }, weak.map((item) => h('div', { class: 'overview-progress-row' },
          h('span', { title: item.name }, item.name),
          h('span', { class: 'bar' }, h('i', { style: { width: `${Math.round((item.mastery ?? 0) * 100)}%` } })),
          h('span', { class: 'overview-progress-value' }, item.mastery === null ? '—' : `${Math.round(item.mastery * 100)}%`)))));
}

function firstProblem(data) {
  if (!data.problems) return null;
  return api.problems({ limit: 1 }).then((result) => result.items?.[0] || null).catch(() => null);
}

export default {
  async render() {
    const data = await api.overview(store.state.userId);
    const weak = (data.weakest_knowledge || []).slice(0, 5);
    const problem = await firstProblem(data);
    const learner = store.state.userId === 'demo-user' ? '同学' : store.state.userId;
    return h('div', { class: 'overview-v2' },
      h('div', { class: 'overview-head' },
        h('h1', {}, `${greeting()}，${learner}`),
        h('div', { class: 'overview-actions' },
          button('查看训练记录', { variant: 'secondary', iconName: 'list-checks', onClick: () => navigate('submissions') }),
          button('记录提交', { iconName: 'send', onClick: () => navigate('submissions') }))),
      h('div', { class: 'overview-metrics' },
        metric('题目', data.problems),
        metric('待审核分析', data.pending_reviews),
        metric('提交记录', data.submissions)),
      focusCard(problem),
      knowledgePanel(weak));
  },
};
