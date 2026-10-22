/* 知识图谱：领域浏览、双视图与按需详情，图形交互由 GraphCanvas 管理。 */
import { api } from '../api.js';
import { h, mount } from '../dom.js';
import { icon } from '../icons.js';
import { matchesSearch, normalizeSearch } from '../search.js';
import { GraphCanvas } from '../graph/canvas.js';
import { knowledgeTitle } from '../knowledgeWeights.js';

export default {
  async render({ param = '' } = {}) {
    const data = await api.knowledgeGraph();
    const byId = new Map(data.nodes.map(node => [node.id, node]));
    const before = new Map(data.nodes.map(node => [node.id, []]));
    const after = new Map(data.nodes.map(node => [node.id, []]));
    for (const edge of data.edges) {
      before.get(edge.target)?.push(edge);
      after.get(edge.source)?.push(edge);
    }
    let controller = null;
    let state = {
      mode: 'force', domain: 'all', paused: false, scale: 1,
      nodeCount: data.nodes.length, edgeCount: data.edges.length,
    };
    let matches = [];
    let activeResult = -1;
    const query = h('input', {
      id: 'kg-query', class: 'kg-query', type: 'search', placeholder: '搜索知识点',
      autocomplete: 'off', role: 'combobox', 'aria-label': '搜索知识点',
      'aria-autocomplete': 'list', 'aria-controls': 'kg-results', 'aria-expanded': 'false',
    });
    const results = h('div', {
      id: 'kg-results', class: 'kg-results', role: 'listbox', 'aria-label': '匹配的知识点',
      hidden: true,
    });
    const search = h('div', { class: 'kg-search' }, icon('search', { size: 16 }), query, results);
    const viewport = h('div', {
      class: 'kg-viewport', id: 'kg-viewport', 'aria-label': '知识点前置关系图',
    });
    const inspector = h('aside', {
      class: 'kg-inspector', 'aria-label': '知识点详情', hidden: true,
    });
    const accessibleSelect = h('select', {
      id: 'kg-accessible-node', class: 'visually-hidden',
      'aria-label': '选择图中的知识点',
      onChange: event => {
        if (event.target.value) focusNode(event.target.value);
      },
    }, h('option', { value: '' }, '选择知识点'),
    data.domains.map(domain => h('optgroup', { label: domain.name },
      data.nodes.filter(node => node.domain_id === domain.id)
        .map(node => h('option', { value: node.id }, node.name)))));
    const modeButtons = [
      ['force', '弹性视图'], ['tree', '科技树'],
    ].map(([mode, label]) => h('button', {
      type: 'button', class: `kg-view-button${mode === 'force' ? ' active' : ''}`,
      role: 'tab', 'aria-selected': String(mode === 'force'), 'aria-controls': 'kg-viewport',
      tabIndex: mode === 'force' ? 0 : -1,
      onClick: () => controller?.setMode(mode),
      onKeydown: event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : mode === 'force' ? 1 : 0;
        controller?.setMode(next === 0 ? 'force' : 'tree');
        modeButtons[next].focus({ preventScroll: true });
      },
    }, label));
    const domainItems = [{ id: 'all', name: '全部' }, ...data.domains];
    const domainButtons = domainItems.map(domain => h('button', {
      type: 'button', class: `kg-domain${domain.id === 'all' ? ' active' : ''}`,
      'aria-pressed': String(domain.id === 'all'),
      onClick: () => controller?.setDomain(domain.id),
    }, domain.name));
    const scale = h('output', { class: 'kg-scale', 'aria-label': '图谱缩放比例' }, '100%');
    const pause = tool('暂停弹性布局', icon('pause'), () => controller?.togglePause(), 'kg-pause');
    const counts = h('span', { class: 'kg-counts', 'aria-live': 'polite' });
    const hint = h('p', { class: 'kg-hint' }, '拖动节点 · 滚轮缩放 · 点选查看');
    const root = h('section', { class: 'kg-page', 'aria-label': '知识图谱' },
      h('header', { class: 'kg-header' },
        h('h1', { class: 'kg-title' }, '知识图谱'),
        h('div', { class: 'kg-view-switch', role: 'tablist', 'aria-label': '图谱视图' }, modeButtons),
        search),
      h('nav', { class: 'kg-domains', 'aria-label': '知识领域' }, domainButtons),
      h('div', { class: 'kg-stage' }, viewport, inspector,
        h('div', { class: 'kg-tools', role: 'group', 'aria-label': '图谱操作' },
          tool('缩小', icon('minus'), () => controller?.zoom(1 / 1.2)),
          scale,
          tool('放大', icon('plus'), () => controller?.zoom(1.2)),
          h('span', { class: 'kg-tool-divider', 'aria-hidden': 'true' }),
          tool('复位图谱', icon('refresh-cw'), () => controller?.reset()),
          pause),
        hint),
      h('footer', { class: 'kg-footer' }, counts),
      accessibleSelect);

    function tool(label, content, onClick, extraClass = '') {
      return h('button', {
        type: 'button', class: `kg-tool${extraClass ? ` ${extraClass}` : ''}`,
        title: label, 'aria-label': label, onClick,
      }, content);
    }

    function closeSearch() {
      results.hidden = true;
      activeResult = -1;
      query.setAttribute('aria-expanded', 'false');
      query.removeAttribute('aria-activedescendant');
    }

    function focusNode(id) {
      if (!byId.has(id)) return;
      query.value = '';
      closeSearch();
      controller?.focusNode(id);
    }

    function paintResults({ showAll = false } = {}) {
      if (!normalizeSearch(query.value) && !showAll) {
        closeSearch();
        return;
      }
      matches = data.nodes.filter(node => matchesSearch(node, query.value));
      if (activeResult >= matches.length) activeResult = matches.length - 1;
      results.hidden = false;
      query.setAttribute('aria-expanded', 'true');
      mount(results, matches.length
        ? matches.map((node, index) => h('button', {
            id: `kg-result-${index}`, type: 'button',
            class: `kg-result${index === activeResult ? ' active' : ''}`,
            role: 'option', tabIndex: -1, 'aria-selected': String(index === activeResult),
            onMousedown: event => event.preventDefault(),
            onClick: () => focusNode(node.id),
          },
          h('span', { class: 'kg-result-name' }, node.name),
          h('span', { class: 'kg-result-domain' }, node.domain_name)))
        : h('p', { class: 'kg-no-results', role: 'status' }, '没有匹配的知识点'));
      if (activeResult >= 0 && matches.length) {
        query.setAttribute('aria-activedescendant', `kg-result-${activeResult}`);
        results.children[activeResult]?.scrollIntoView({ block: 'nearest' });
      } else query.removeAttribute('aria-activedescendant');
    }

    function relatedSection(title, edges, endpoint) {
      return h('section', { class: 'kg-related' },
        h('h3', {}, title, h('span', { class: 'kg-related-count' }, edges.length)),
        edges.length
          ? h('div', { class: 'kg-related-list' }, edges.map(edge => {
              const node = byId.get(edge[endpoint]);
              return h('button', {
                type: 'button', class: 'kg-related-item', title: edge.reason,
                onClick: () => focusNode(node.id),
              }, h('span', {}, node.name), icon('chevron-right', { size: 14 }));
            }))
          : h('p', { class: 'kg-related-empty' }, `未标注${title}`));
    }

    function showSelection(id) {
      const node = byId.get(id);
      inspector.hidden = !node;
      root.classList.toggle('kg-has-selection', Boolean(node));
      accessibleSelect.value = node?.id || '';
      if (!node) {
        mount(inspector);
        return;
      }
      mount(inspector,
        h('div', { class: 'kg-inspector-top' },
          h('span', { class: 'kg-inspector-domain' }, node.domain_name),
          tool('关闭知识点详情', icon('x'), () => controller?.selectNode(null), 'kg-close')),
        knowledgeTitle(node, { titleClass: 'kg-inspector-title' }),
        h('p', { class: 'kg-summary' }, node.summary),
        relatedSection('前驱', before.get(id) || [], 'source'),
        relatedSection('后继', after.get(id) || [], 'target'));
    }

    function showState(next) {
      state = next;
      modeButtons.forEach((button, index) => {
        const selected = state.mode === (index === 0 ? 'force' : 'tree');
        button.classList.toggle('active', selected);
        button.setAttribute('aria-selected', String(selected));
        button.tabIndex = selected ? 0 : -1;
      });
      domainButtons.forEach((button, index) => {
        const selected = state.domain === domainItems[index].id;
        button.classList.toggle('active', selected);
        button.setAttribute('aria-pressed', String(selected));
      });
      scale.textContent = `${Math.round(state.scale * 100)}%`;
      const pauseLabel = state.paused ? '继续弹性布局' : '暂停弹性布局';
      pause.title = state.reducedMotion ? '已按减少动态设置暂停布局' : pauseLabel;
      pause.setAttribute('aria-label', pause.title);
      pause.setAttribute('aria-pressed', String(state.paused));
      pause.disabled = state.mode !== 'force' || state.reducedMotion;
      mount(pause, state.paused ? icon('play') : icon('pause'));
      counts.textContent = `${state.nodeCount} 个知识点 · ${state.edgeCount} 条前置关系`;
      hint.textContent = state.mode === 'tree'
        ? '向下滚动 · 拖动画布 · 点选查看'
        : '拖动节点 · 滚轮缩放 · 点选查看';
    }

    query.addEventListener('input', () => {
      activeResult = -1;
      paintResults();
    });
    query.addEventListener('focus', () => paintResults());
    query.addEventListener('keydown', event => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeSearch();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (results.hidden) activeResult = -1;
        matches = data.nodes.filter(node => matchesSearch(node, query.value));
        if (matches.length) {
          activeResult = activeResult < 0
            ? event.key === 'ArrowDown' ? 0 : matches.length - 1
            : (activeResult + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
        }
        paintResults({ showAll: true });
      } else if (event.key === 'Enter' && !results.hidden && matches.length) {
        event.preventDefault();
        focusNode(matches[Math.max(0, activeResult)].id);
      }
    });
    search.addEventListener('focusout', event => {
      if (!search.contains(event.relatedTarget)) closeSearch();
    });
    root.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !inspector.hidden && event.target !== query) {
        controller?.selectNode(null);
        viewport.querySelector('canvas')?.focus({ preventScroll: true });
      }
    });
    controller = new GraphCanvas(viewport, data, { onSelect: showSelection, onChange: showState });
    showState(controller.getState());
    if (byId.has(param)) focusNode(param);
    root.dispose = () => controller.destroy();
    return root;
  },
};
