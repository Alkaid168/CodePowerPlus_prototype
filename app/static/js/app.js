/* 前端入口：左侧固定导航，主体独立滚动，不再使用顶部栏。 */
import { api } from './api.js';
import { byId, h, mount } from './dom.js';
import { icon } from './icons.js';
import { store } from './store.js';
import { errorBox, loading } from './components.js';
import { currentRoute, navigate, onRouteChange } from './router.js';

import overviewView from './views/overview.js';
import knowledgeView from './views/knowledge.js';
import knowledgeGraphView from './views/knowledgeGraph.js';
import problemsView from './views/problems.js';
import analysisView from './views/analysis.js';
import reviewsView from './views/reviews.js';
import submissionsView from './views/submissions.js';
import profileView from './views/profile.js';
import pathView from './views/path.js';
import recommendationsView from './views/recommendations.js';
import tutorView from './views/tutor.js';

const ROUTES = [
  { id: 'overview', label: '总览', icon: 'layout-dashboard', title: '学习总览', view: overviewView },
  { id: 'knowledge', label: '知识树', icon: 'book-open', title: '知识树', showTitle: false, view: knowledgeView },
  { id: 'knowledge-graph', label: '知识图谱', icon: 'network', title: '知识图谱', showTitle: false, view: knowledgeGraphView },
  { id: 'problems', label: '题目库', icon: 'list-checks', title: '题目库', view: problemsView },
  { id: 'analysis', label: '题目录入与分析', icon: 'sparkles', title: '题目录入与分析', view: analysisView },
  { id: 'reviews', label: '审核队列', icon: 'clipboard-check', title: '审核队列', view: reviewsView },
  { id: 'submissions', label: '提交记录', icon: 'send', title: '提交记录', view: submissionsView },
  { id: 'profile', label: '能力画像', icon: 'user-round', title: '能力画像', showTitle: false, view: profileView },
  { id: 'path', label: '学习路径', icon: 'route', title: '学习路径', view: pathView },
  { id: 'recommendations', label: '推荐训练', icon: 'target', title: '推荐训练', view: recommendationsView },
  { id: 'tutor', label: '代码辅导', icon: 'message-circle', title: '代码辅导', view: tutorView },
];

function paintNav(activeId) {
  mount(byId('nav'), ROUTES.map((route) => h('button', {
    type: 'button',
    class: `nav-item${route.id === activeId ? ' active' : ''}`,
    title: route.label,
    'aria-label': route.label,
    'aria-current': route.id === activeId ? 'page' : null,
    onClick: () => navigate(route.id),
  }, icon(route.icon), h('span', {}, route.label))));
}

let renderVersion = 0;
let activeView = null;
async function renderRoute() {
  const version = ++renderVersion;
  activeView?.dispose?.();
  activeView = null;
  const { id, param } = currentRoute();
  const route = ROUTES.find((item) => item.id === id) || ROUTES[0];
  const problemDetail = route.id === 'problems' && Boolean(param);
  const reviewDetail = route.id === 'reviews' && Boolean(param);
  byId('app').classList.toggle('app-standalone', problemDetail || reviewDetail);
  byId('sidebar').hidden = problemDetail || reviewDetail;
  paintNav(route.id);
  document.title = `${route.title} · CodePowerPlus`;
  const main = byId('main');
  mount(main, loading());
  try {
    const view = await route.view.render({ param });
    if (version !== renderVersion) {
      view.dispose?.();
      return;
    }
    activeView = view;
    if (problemDetail) document.title = `${view.querySelector('.problem-heading')?.textContent || '题目详情'} · CodePowerPlus`;
    if (reviewDetail) document.title = `审核 ${view.querySelector('.review-heading')?.textContent || '题目'} · CodePowerPlus`;
    mount(main, route.id === 'overview'
      ? view
      : h('div', { class: `route-shell route-shell-${route.id}${reviewDetail ? ' route-shell-review-detail' : ''}` }, route.showTitle === false || problemDetail || reviewDetail ? null : h('h1', { class: 'route-title' }, route.title), view));
  } catch (error) {
    if (version !== renderVersion) return;
    mount(main, h('div', { class: 'stack' }, errorBox(error, renderRoute)));
  }
  main.focus({ preventScroll: true });
}

async function boot() {
  try {
    store.set({ health: await api.health() });
  } catch {
    store.set({ health: null });
  }
  onRouteChange(renderRoute);
  await renderRoute();
}

boot();
