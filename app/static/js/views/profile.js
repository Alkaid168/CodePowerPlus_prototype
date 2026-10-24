import { api } from '../api.js';
import { h } from '../dom.js';
import { navigate } from '../router.js';
import { store } from '../store.js';
import { button } from '../components.js';

function domainCard(item) {
  return h('article', { class: 'profile-domain', 'aria-label': `${item.name} ${item.score}分` },
    h('h2', {}, item.name),
    h('div', { class: 'profile-domain-score' },
      h('strong', {}, String(item.score)),
      item.knowledge_id === 'syntax' ? h('span', {}, '/ 800') : null));
}

export default {
  async render() {
    const data = await api.profile(store.state.userId);
    return h('div', { class: 'profile-page' },
      h('h1', {}, '能力画像'),
      h('section', { class: 'profile-summary', 'aria-label': '总评分' },
        h('div', { class: 'profile-total' },
          h('h2', {}, '总评分'),
          h('strong', {}, String(data.overall.score))),
        button('记录提交', { iconName: 'send', onClick: () => navigate('submissions') })),
      h('section', { class: 'profile-domain-grid', 'aria-label': '各领域评分' },
        data.dimensions.map(domainCard)));
  },
};
