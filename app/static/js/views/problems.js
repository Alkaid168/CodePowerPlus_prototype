/* 题目库：列表 + 详情（描述、分析状态、知识证据、分析历史）。 */
import { api } from '../api.js';
import { h, mount } from '../dom.js';
import { mountMarkdown } from '../markdown.js';
import { navigate } from '../router.js';
import { store } from '../store.js';
import { button, card, difficultyTag, emptyState, errorBox, formatDate, loading, notice, sourceLink,
  statusBadge, table, tag } from '../components.js';

const PAGE_SIZE = 20;

export default {
  async render({ param }) {
    return param ? renderDetail(Number(param)) : renderList();
  },
};

async function renderList() {
  let offset = 0;
  let query = '';
  const host = h('div', { class: 'stack' });
  const search = h('input', { class: 'input', type: 'search', placeholder: '搜索标题或描述' });

  async function load() {
    mount(host, loading('读取题目…'));
    try {
      const data = await api.problems({ q: query, limit: PAGE_SIZE, offset });
      if (!data.items.length) {
        mount(host, emptyState('还没有题目。先到「题目分析」录入并分析一道题。',
          button('去录入题目', { iconName: 'sparkles', onClick: () => navigate('analysis') })));
        return;
      }
      mount(host,
        table(['ID', '标题', '分析状态', '标签', '难度', '录入时间', ''],
          data.items.map((problem) => [
            String(problem.id),
            h('button', { class: 'btn link', onClick: () => navigate(`problems/${problem.id}`) }, problem.title),
            problem.analysis_status ? statusBadge(problem.analysis_status) : h('span', { class: 'hint' }, '未分析'),
            problem.knowledge_ids.length
              ? h('span', { class: 'row wrap' }, problem.knowledge_ids.map((id) => tag(id, 'muted')))
              : '—',
            problem.difficulty === null || problem.difficulty === undefined
              ? '—' : difficultyTag(problem.difficulty, problem.difficulty_band),
            formatDate(problem.created_at),
            button('查看', { variant: 'secondary', small: true, onClick: () => navigate(`problems/${problem.id}`) }),
          ])),
        h('div', { class: 'row' },
          button('上一页', { variant: 'secondary', small: true, disabled: offset === 0,
            onClick: () => { offset = Math.max(0, offset - PAGE_SIZE); load(); } }),
          button('下一页', { variant: 'secondary', small: true, disabled: offset + PAGE_SIZE >= data.total,
            onClick: () => { offset += PAGE_SIZE; load(); } }),
          h('span', { class: 'hint' }, `共 ${data.total} 道题`)));
    } catch (error) {
      mount(host, errorBox(error, load));
    }
  }

  const form = h('form', { class: 'inline-form' },
    h('div', { style: { flex: '2' } }, h('label', { class: 'field-label', for: 'problem-query' }, '关键词'), search),
    button('搜索', { iconName: 'search', type: 'submit' }),
    button('全部', { variant: 'secondary', onClick: () => { query = ''; search.value = ''; offset = 0; load(); } }));
  form.addEventListener('submit', (event) => { event.preventDefault(); query = search.value.trim(); offset = 0; load(); });

  const node = h('div', { class: 'stack' },
    card({ title: '题目检索' }, form),
    card({ title: '题目列表' }, host));
  load();
  return node;
}

async function renderDetail(problemId) {
  await store.ensureKnowledge(api);
  const names = new Map(store.state.knowledge.map((node) => [node.id, node.name]));
  const nameTag = (id, kind = '') => tag(names.get(id) || id, kind, { title: id });

  try {
    const problem = await api.problem(problemId);
    const analysis = problem.analysis;
    const actions = h('div', { class: 'row wrap' },
      button('手工标注', { iconName: 'clipboard-check', onClick: () => navigate(`analysis/${problem.id}`) }),
      button('记录提交', { variant: 'secondary', iconName: 'send', onClick: () => navigate(`submissions/${problem.id}`) }),
      analysis && analysis.review_status === 'pending'
        ? button('去审核', { variant: 'secondary', iconName: 'clipboard-check', onClick: () => navigate('reviews') })
        : null,
      button('返回列表', { variant: 'ghost', onClick: () => navigate('problems') }));

    const history = h('div', { class: 'stack tight' });
    let historyLoaded = false;
    const historyButton = button('查看分析历史', {
      variant: 'secondary', small: true,
      onClick: async () => {
        if (historyLoaded) return;
        historyLoaded = true;
        mount(history, loading('读取历史…'));
        try {
          const data = await api.analysisHistory(problem.id);
          mount(history, data.items.map((item) => h('div', { class: 'list-item' },
            h('div', { class: 'row wrap' },
              h('strong', {}, `#${item.analysis_id}`),
              statusBadge(item.review_status),
              tag(item.origin === 'model' ? '模型' : '人工', 'muted'),
              h('span', { class: 'spacer' }),
              h('span', { class: 'hint' }, formatDate(item.created_at))),
            h('p', { class: 'muted' }, `难度 ${item.difficulty} · 标签 ${[...item.primary_knowledge_ids, ...item.secondary_knowledge_ids].map((id) => names.get(id) || id).join('、') || '无'}`))));
        } catch (error) {
          historyLoaded = false;
          mount(history, errorBox(error, () => historyButton.click()));
        }
      },
    });

    const analysisCard = analysis
      ? card({ title: '当前分析', actions: h('div', { class: 'row' }, statusBadge(analysis.review_status)) },
          h('div', { class: 'meta-row' },
            difficultyTag(analysis.difficulty, analysis.difficulty_band),
            h('span', {}, `整体置信度 ${Math.round((analysis.confidence || 0) * 100)}%`),
            h('span', {}, `来源 ${analysis.model_name || analysis.origin}`),
            h('span', {}, `知识版本 ${analysis.taxonomy_version || '—'}`)),
          h('div', { class: 'row wrap', style: { marginTop: '10px' } },
            analysis.primary_knowledge_ids.map((id) => nameTag(id)),
            analysis.secondary_knowledge_ids.map((id) => nameTag(id, 'muted'))),
          h('div', { class: 'stack tight', style: { marginTop: '12px' } },
            [...analysis.primary_knowledge_ids, ...analysis.secondary_knowledge_ids].map((id) => h('div', { class: 'list-item' },
              h('div', { class: 'row' }, h('strong', {}, names.get(id) || id), h('span', { class: 'spacer' }),
                h('span', { class: 'hint' }, `置信度 ${analysis.knowledge_confidence?.[id] ?? '—'}`)),
              h('p', { class: 'muted' }, analysis.evidence?.[id] || '缺少证据句')))),
          analysis.difficulty_reason ? h('p', { class: 'hint', style: { marginTop: '10px' } }, `难度理由：${analysis.difficulty_reason}`) : null,
          historyButton,
          history)
      : card({ title: '当前分析' }, notice('这道题还没有分析。可以用模型分析，或直接手工标注。', 'warn'),
          h('div', { class: 'row', style: { marginTop: '10px' } },
            button('去手工标注', { iconName: 'clipboard-check', onClick: () => navigate(`analysis/${problem.id}`) })));

    return h('div', { class: 'stack' },
      h('div', { class: 'row wrap' },
        button('← 返回题目列表', { variant: 'ghost', onClick: () => navigate('problems') }),
        h('span', { class: 'spacer' }),
        actions),
      card({ title: `#${problem.id} ${problem.title}` },
        h('div', { class: 'meta-row' },
          sourceLink(problem.source_url) || h('span', { class: 'hint' }, '未标注来源'),
          h('span', { class: 'hint' }, formatDate(problem.created_at))),
        statementHost(problem.description)),
      analysisCard);
  } catch (error) {
    return h('div', { class: 'stack' }, errorBox(error, () => navigate('problems')));
  }
}

/** 题面是 Markdown，用题面样式渲染，而不是代码框。 */
function statementHost(source) {
  const host = h('article', { class: 'markdown-body', style: { marginTop: '12px' } });
  mountMarkdown(host, source);
  return host;
}
