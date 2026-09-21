/* 知识树：顶部按 L1 领域切换，左侧浏览当前领域的 L2/L3，右侧查看详情。 */
import { api } from '../api.js';
import { h, mount } from '../dom.js';
import { icon } from '../icons.js';
import { knowledgeIllustration } from '../knowledgeIllustrations.js';
import { matchesSearch, normalizeSearch } from '../search.js';
import { store } from '../store.js';
import { button, emptyState, errorBox, loading } from '../components.js';

function nodePath(node, byId) {
  const path = [];
  let current = node;
  while (current) {
    path.unshift(current);
    current = current.parent_id ? byId.get(current.parent_id) : null;
  }
  return path;
}

function pathText(node, byId) {
  return nodePath(node, byId).map((item) => item.name).join(' › ');
}

export default {
  async render({ param }) {
    const flat = await store.ensureKnowledge(api);
    const roots = store.state.knowledgeTree;
    const byId = new Map(flat.map((node) => [node.id, node]));
    const expanded = new Set();
    let selectedRootId = roots[0]?.id || '';
    let activeId = selectedRootId;

    const tabsHost = h('nav', { class: 'knowledge-l1-tabs', role: 'tablist', 'aria-label': '知识领域' });
    const treeHost = h('div', { class: 'knowledge-tree-scroll', 'aria-label': '当前领域的知识节点' });
    const detailHost = h('div', { class: 'knowledge-detail-host' });
    const query = h('input', {
      id: 'knowledge-query',
      class: 'input',
      type: 'search',
      placeholder: '搜索知识点',
      autocomplete: 'off',
    });

    function selectedRoot() {
      return byId.get(selectedRootId) || roots[0];
    }

    function rootIdFor(node) {
      return nodePath(node, byId)[0]?.id || selectedRootId;
    }

    function reveal(id) {
      let current = byId.get(id)?.parent_id ? byId.get(byId.get(id).parent_id) : null;
      while (current) {
        expanded.add(current.id);
        current = current.parent_id ? byId.get(current.parent_id) : null;
      }
    }

    function paintTabs() {
      mount(tabsHost, roots.map((root) => h('button', {
        type: 'button',
        class: `knowledge-l1-tab${root.id === selectedRootId ? ' active' : ''}`,
        role: 'tab',
        'aria-selected': String(root.id === selectedRootId),
        onClick: () => selectRoot(root.id),
      }, root.name)));
    }

    function rowFor(node, { result = false } = {}) {
      const hasChildren = Boolean(node.children?.length);
      const isExpanded = expanded.has(node.id);
      const classes = [
        'tree-row',
        result ? 'knowledge-result-row' : '',
        activeId === node.id ? 'active' : '',
      ].filter(Boolean).join(' ');
      const label = result
        ? h('span', { class: 'knowledge-result-main' },
            h('span', { class: 'knowledge-result-name' }, node.name),
            h('span', { class: 'knowledge-result-path' }, pathText(node, byId)))
        : h('span', { class: 'tree-label' }, node.name);

      return h('button', {
        type: 'button',
        class: classes,
        title: node.summary || node.name,
        dataset: {
          level: String(node.level),
          hasChildren: String(hasChildren),
        },
        'aria-expanded': hasChildren ? String(isExpanded) : undefined,
        'aria-current': activeId === node.id ? 'true' : undefined,
        onClick: () => {
          if (hasChildren) {
            if (isExpanded) expanded.delete(node.id);
            else expanded.add(node.id);
          }
          activeId = node.id;
          reveal(node.id);
          paintList();
          show(node.id);
        },
      }, h('span', { class: 'tree-arrow', 'aria-hidden': 'true' }), label);
    }

    function visibleRows(nodes) {
      const rows = [];
      const walk = (items) => {
        for (const node of items) {
          rows.push(rowFor(node));
          if (expanded.has(node.id) && node.children?.length) walk(node.children);
        }
      };
      walk(nodes);
      return rows;
    }

    function paintList() {
      const keyword = query.value.trim();
      if (keyword) {
        const items = flat.filter((node) => node.level > 1 && matchesSearch(node, keyword));
        mount(treeHost,
          h('div', { class: 'knowledge-result-list' },
            h('p', { class: 'knowledge-result-count', 'aria-live': 'polite' }, `匹配 ${items.length} 个节点`),
            items.length
              ? items.map((node) => rowFor(node, { result: true }))
              : emptyState('没有匹配的知识点。')));
        return;
      }
      const root = selectedRoot();
      mount(treeHost, h('div', { class: 'knowledge-tree-list' }, visibleRows(root?.children || [])));
    }

    function selectRoot(id) {
      selectedRootId = id;
      activeId = id;
      expanded.clear();
      query.value = '';
      paintTabs();
      paintList();
      show(id);
    }

    function activateNode(node) {
      const rootId = rootIdFor(node);
      if (rootId !== selectedRootId) {
        selectedRootId = rootId;
        expanded.clear();
        paintTabs();
      }
      activeId = node.id;
      reveal(node.id);
      paintList();
      show(node.id);
    }

    async function show(id) {
      const node = byId.get(id);
      if (!node) {
        showEmpty();
        return;
      }
      activeId = id;
      reveal(id);
      mount(detailHost, loading('读取知识点…'));
      try {
        const detail = await api.knowledgeDetail(id);
        renderDetail(normalizeDetail(detail));
      } catch (error) {
        mount(detailHost, errorBox(error, () => show(id)));
      }
    }

    function crumb(node, isCurrent) {
      return h('button', {
        type: 'button',
        class: `knowledge-crumb${isCurrent ? ' current' : ''}`,
        'aria-current': isCurrent ? 'page' : undefined,
        onClick: () => activateNode(node),
      }, node.name);
    }

    function normalizeDetail(node) {
      const ancestors = Array.isArray(node.ancestors) ? node.ancestors : [];
      const children = Array.isArray(node.children) ? node.children : [];
      return { ...node, ancestors, children };
    }

    function renderDetail(node) {
      const path = node.level === 1 ? [node] : [...(node.ancestors || []), node];
      const isL1 = node.level === 1;
      const children = Array.isArray(node.children) ? node.children : [];
      const hasChildren = !isL1 && children.length > 0;
      const showIntroduction = !hasChildren && node.level >= 2;
      mount(detailHost,
        h('article', { class: 'knowledge-detail' },
          node.level === 1 ? null : h('nav', { class: 'knowledge-breadcrumbs', 'aria-label': '知识点路径' },
            path.flatMap((item, index) => [
              crumb(item, index === path.length - 1),
              index < path.length - 1 ? h('span', { class: 'knowledge-crumb-sep', 'aria-hidden': 'true' }) : null,
            ])),
          h('header', { class: 'knowledge-detail-header' }, h('h2', {}, node.name)),
          isL1
            ? h('div', { class: 'knowledge-l1-art' },
                knowledgeIllustration(node.id, { label: `${node.name}核心知识示意图` }))
            : null,
          showIntroduction
            ? h('section', { class: 'knowledge-section' },
                h('h3', {}, '知识点介绍'),
                h('p', { class: 'knowledge-summary' }, node.summary || '暂无介绍。'))
            : null,
          hasChildren
            ? h('div', { class: 'knowledge-children' }, children.map((child) => h('button', {
                type: 'button',
                class: 'knowledge-child',
                onClick: () => activateNode(child),
              }, h('span', { class: 'knowledge-child-name' }, child.name))))
            : null));
    }

    function showEmpty() {
      mount(detailHost,
        h('div', { class: 'knowledge-empty' },
          h('p', {}, '从左侧选择知识点，查看它在词表中的位置、介绍与下级节点。'),
          button('随便看看', {
            variant: 'secondary',
            onClick: () => selectRoot(selectedRootId),
          })));
    }

    query.addEventListener('input', paintList);
    paintTabs();
    paintList();
    // 直接用 URL 里的知识点定位：需要同时切换 L1、展开祖先并选中左树那一行。
    const initialNode = flat.find((node) => node.id === param);
    if (initialNode) activateNode(initialNode);
    else if (selectedRootId) selectRoot(selectedRootId);
    else showEmpty();

    const levelBar = h('div', { class: 'knowledge-level-bar' },
      tabsHost,
      h('label', { class: 'visually-hidden', for: 'knowledge-query' }, '搜索知识点'),
      h('div', { class: 'knowledge-search-field' }, icon('search', { size: 16 }), query));

    const treePanel = h('section', { class: 'knowledge-panel knowledge-tree-panel' }, treeHost);
    const detailPanel = h('section', { class: 'knowledge-panel knowledge-detail-panel' }, detailHost);
    return h('div', { class: 'knowledge-workspace' }, levelBar, treePanel, detailPanel);
  },
};
