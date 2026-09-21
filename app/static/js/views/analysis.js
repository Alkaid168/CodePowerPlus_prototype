/* 题目录入与分析：左边录入或查看题面，右边预览题面、看分析、手工纠正。

录入流程是两步：先 POST /api/problems 拿到 OJ 编号（从 1000 开始），
再 POST /api/problems/{id}/analyze 调用模型。拆开的原因是模型失败时题目已经存在，
用户可以重试分析或改手工标注，不会丢掉刚粘贴的题面。
 */
import { api } from '../api.js';
import { h, mount } from '../dom.js';
import { mountMarkdown } from '../markdown.js';
import { navigate } from '../router.js';
import { store } from '../store.js';
import { button, card, difficultyTag, errorBox, field, loading, notice, sourceLink, statusBadge, toast }
  from '../components.js';
import { createTagEditor } from '../tagEditor.js';

const RATING_MIN = 800;
const RATING_MAX = 3500;
const RATING_STEP = 100;

const PREVIEW_DEBOUNCE = 500;

export default {
  async render({ param }) {
    return param ? renderExisting(Number(param)) : renderEntry();
  },
};

function ratingOptions() {
  const options = [];
  for (let rating = RATING_MIN; rating <= RATING_MAX; rating += RATING_STEP) options.push(rating);
  return options;
}

function percent(value) {
  return typeof value === 'number' ? `${Math.round(value * 100)}%` : '—';
}

/* ------------------------------------------------------------------ 新建 */

function renderEntry() {
  const title = h('input', { class: 'input', maxlength: 300, placeholder: '例如：区间求和' });
  const source = h('input', { class: 'input', type: 'url',
    placeholder: 'https://codeforces.com/problemset/problem/1/A（可以留空）' });
  const statement = h('textarea', { class: 'input markdown-input', spellcheck: 'false',
    placeholder: '粘贴 Markdown 题面。公式用 LaTeX：行内 $a_i$，独立一行 $$\\sum_{i=l}^{r} a_i$$' });

  const status = h('div', { class: 'analysis-status' });
  const submit = button('保存并分析', { iconName: 'sparkles', type: 'submit' });

  // 建题成功但分析失败时记住编号，重试时只重新分析，不会产生第二道题。
  let savedProblem = null;

  const reset = button('清空', { variant: 'secondary', onClick: () => {
    title.value = ''; source.value = ''; statement.value = ''; savedProblem = null;
    mount(status, ''); schedulePreview();
  } });

  const previewHost = h('article', { class: 'markdown-body' });
  const previewMeta = h('div', { class: 'analysis-preview-meta' });
  let previewTimer = null;

  function schedulePreview() {
    window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(refreshPreview, PREVIEW_DEBOUNCE);
  }

  async function refreshPreview() {
    const text = statement.value.trim();
    mount(previewMeta, text
      ? h('span', { class: 'hint' }, `${text.length} 字符 · Markdown 渲染预览`)
      : h('span', { class: 'hint' }, '开始输入题面后这里会实时渲染 Markdown 与 LaTeX 公式'));
    if (!text) {
      mount(previewHost, h('div', { class: 'analysis-placeholder' },
        h('p', {}, '右侧预览会按 Markdown 渲染题面，公式用 LaTeX 排版。')));
      return;
    }
    const { mathRendered } = await mountMarkdown(previewHost, text);
    if (statement.value.trim() && !mathRendered && /\$|\\\(|\\\[/.test(statement.value)) {
      previewMeta.append(h('span', { class: 'hint' }, '公式引擎未加载，公式暂以原文显示'));
    }
  }

  statement.addEventListener('input', schedulePreview);
  schedulePreview();

  const form = h('form', { class: 'analysis-form' },
    field('题目标题', title),
    field('来源链接（可选）', source, '只接受 http:// 或 https:// 开头的链接。'),
    h('div', { class: 'analysis-statement-field' },
      h('label', { class: 'field-label' }, '题面（Markdown）'),
      statement),
    h('div', { class: 'analysis-actions' }, submit, reset),
    status);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = {
      title: title.value.trim(),
      description: statement.value.trim(),
      source_url: source.value.trim(),
    };
    if (!body.title) { mount(status, notice('请先填写题目标题。', 'warn')); title.focus(); return; }
    if (!body.description) { mount(status, notice('请先粘贴题面。', 'warn')); statement.focus(); return; }

    submit.disabled = true;
    try {
      if (!savedProblem) {
        mount(status, loading('正在保存题目…'));
        savedProblem = await api.createProblem(body);
        mount(status, notice(`已保存为 #${savedProblem.id}，正在调用模型分析（通常 10–30 秒）…`, 'ok'));
      } else {
        mount(status, loading(`正在重新分析 #${savedProblem.id}…`));
      }
      const result = await api.analyzeProblem(savedProblem.id);
      toast(`#${result.problem.id} 已录入并完成模型分析`, 'ok');
      navigate(`analysis/${result.problem.id}`);
    } catch (error) {
      const hint = savedProblem
        ? h('div', { class: 'analysis-actions' },
            button('重试分析', { iconName: 'refresh-cw', onClick: () => form.requestSubmit() }),
            button('去手工标注', { variant: 'secondary', iconName: 'clipboard-check',
              onClick: () => navigate(`analysis/${savedProblem.id}`) }))
        : null;
      mount(status, errorBox(error), hint,
        savedProblem ? h('p', { class: 'hint' },
          `题目 #${savedProblem.id} 已经保存，题面不会丢失；分析失败不影响重新分析或手工标注。`) : null);
      submit.disabled = false;
    }
  });

  return h('div', { class: 'analysis-workspace' },
    h('div', { class: 'analysis-column analysis-column-left' },
      card({ title: '录入题目' }, form)),
    h('div', { class: 'analysis-column analysis-column-right' },
      card({ title: '题面预览', actions: previewMeta }, previewHost)));
}

/* ------------------------------------------------------------ 已有题目 */

async function renderExisting(problemId) {
  const names = new Map((await store.ensureKnowledge(api)).map((node) => [node.id, node.name]));
  const left = h('div', { class: 'analysis-column analysis-column-left' });
  const right = h('div', { class: 'analysis-column analysis-column-right' });

  async function refresh() {
    mount(left, loading('读取题目…'));
    mount(right, '');
    let problem;
    try {
      problem = await api.problem(problemId);
    } catch (error) {
      mount(left, errorBox(error, refresh));
      return;
    }
    mount(left, leftPanel(problem, refresh));
    mount(right, rightPanel(problem, names, refresh));
  }

  await refresh();
  return h('div', { class: 'analysis-workspace' }, left, right);
}

function leftPanel(problem, refresh) {
  const reanalyze = button('重新调用模型分析', { variant: 'secondary', iconName: 'sparkles',
    onClick: async () => {
      reanalyze.disabled = true;
      mount(feedback, loading('模型分析中，通常 10–30 秒…'));
      try {
        await api.analyzeProblem(problem.id);
        toast(`#${problem.id} 已生成新的待审核分析`, 'ok');
        await refresh();
      } catch (error) {
        mount(feedback, errorBox(error, () => reanalyze.click()));
        reanalyze.disabled = false;
      }
    } });
  const feedback = h('div', { class: 'analysis-status' });

  const meta = h('div', { class: 'analysis-meta' },
    h('span', { class: 'analysis-number' }, `#${problem.id}`),
    sourceLink(problem.source_url),
    h('span', { class: 'hint' }, problem.created_at ? `录入于 ${problem.created_at}` : ''));

  return card({ title: '题目信息', actions: button('返回录入', { variant: 'ghost', small: true,
    iconName: 'plus', onClick: () => navigate('analysis') }) },
    meta,
    h('h2', { class: 'analysis-title' }, problem.title),
    h('div', { class: 'analysis-source' },
      h('div', { class: 'field-label' }, '题面原文（Markdown）'),
      h('pre', { class: 'statement-source' }, problem.description)),
    h('div', { class: 'analysis-actions' }, reanalyze),
    feedback);
}

function rightPanel(problem, names, refresh) {
  const analysis = problem.analysis;
  const definitions = [
    { id: 'result', label: '分析结果', render: (host) => analysis
      ? mount(host, analysisPanel(analysis, names))
      : mount(host, card({ title: '当前分析' },
          notice('这道题还没有分析。用模型分析，或在“手工标注”里自己填。', 'warn'))) },
    { id: 'preview', label: '题面预览',
      render: (host) => mount(host, statementPanel(problem)) },
    { id: 'manual', label: '手工标注',
      render: (host) => manualPanel(host, problem, analysis) },
    { id: 'history', label: '版本历史', render: (host) => historyPanel(host, problem) },
  ];
  return createTabbed(definitions, 'result');
}

function createTabbed(definitions, initialId) {
  const bar = h('div', { class: 'analysis-tabs', role: 'tablist' });
  const panel = h('div', { class: 'analysis-tab-panel' });
  const buttons = new Map();
  let current = null;

  const show = (id) => {
    const definition = definitions.find((item) => item.id === id);
    if (!definition || current === id) return;
    current = id;
    for (const [key, node] of buttons) node.classList.toggle('active', key === id);
    mount(panel, loading('读取中…'));
    definition.render(panel);
  };

  for (const definition of definitions) {
    const node = h('button', { type: 'button', role: 'tab', class: 'analysis-tab',
      onClick: () => show(definition.id) }, definition.label);
    buttons.set(definition.id, node);
    bar.append(node);
  }
  show(initialId);
  return h('div', { class: 'analysis-tabbed' }, bar, panel);
}

function statementPanel(problem) {
  const host = h('article', { class: 'markdown-body' });
  mountMarkdown(host, problem.description).then(({ mathRendered }) => {
    if (!mathRendered && /\$|\\\(|\\\[/.test(problem.description)) {
      host.prepend(notice('公式渲染引擎没有加载，公式暂以原文显示。', 'warn'));
    }
  });
  return card({ title: '题面', actions: h('div', { class: 'analysis-meta' },
    h('span', { class: 'mono muted' }, `#${problem.id}`), sourceLink(problem.source_url)) }, host);
}

function knowledgeRows(ids, analysis, names) {
  return ids.map((id) => {
    const evidence = analysis.evidence?.[id] || '缺少证据句';
    const confidence = analysis.knowledge_confidence?.[id];
    return h('div', { class: 'analysis-knowledge' },
      h('div', { class: 'analysis-knowledge-head' },
        h('strong', {}, names.get(id) || id),
        h('span', { class: 'mono muted' }, id),
        h('span', { class: 'spacer' }),
        h('span', { class: 'hint' }, `置信度 ${percent(confidence)}`)),
      h('p', { class: 'muted' }, evidence));
  });
}

function analysisPanel(analysis, names) {
  const solutionHost = h('div', { class: 'markdown-body compact' });
  mountMarkdown(solutionHost, analysis.solution_idea || '（模型未给出解题思路）');

  return card({ title: '当前分析', actions: h('div', { class: 'analysis-meta' },
      statusBadge(analysis.review_status),
      h('span', { class: 'tag' }, analysis.origin === 'model' ? '模型分析' : '人工标注')) },
    h('div', { class: 'analysis-score' },
      difficultyTag(analysis.difficulty, analysis.difficulty_band),
      h('span', { class: 'hint' }, `整体置信度 ${percent(analysis.confidence)}`),
      h('span', { class: 'hint' }, `分析 #${analysis.analysis_id}`)),
    analysis.difficulty_reason
      ? h('p', { class: 'muted analysis-reason' }, `难度理由：${analysis.difficulty_reason}`)
      : null,
    h('h3', { class: 'analysis-section' }, `核心考点（${analysis.primary_knowledge_ids.length}）`),
    analysis.primary_knowledge_ids.length
      ? knowledgeRows(analysis.primary_knowledge_ids, analysis, names)
      : h('p', { class: 'hint' }, '没有主知识点。'),
    analysis.secondary_knowledge_ids.length
      ? h('div', {},
          h('h3', { class: 'analysis-section' }, `也涉及（${analysis.secondary_knowledge_ids.length}）`),
          knowledgeRows(analysis.secondary_knowledge_ids, analysis, names))
      : null,
    h('h3', { class: 'analysis-section' }, '解题思路'),
    solutionHost,
    h('div', { class: 'analysis-foot' },
      h('span', { class: 'mono muted' }, analysis.model_name || analysis.origin),
      h('span', { class: 'mono muted' }, analysis.prompt_version || ''),
      h('span', { class: 'mono muted' }, `词表 ${analysis.taxonomy_version || '—'}`),
      h('span', { class: 'spacer' }),
      analysis.review_status === 'pending'
        ? button('去审核', { variant: 'secondary', small: true, iconName: 'clipboard-check',
            onClick: () => navigate('reviews') })
        : null));
}

function manualPanel(host, problem, analysis) {
  const difficulty = h('select', { class: 'input' }, ratingOptions().map((rating) =>
    h('option', { value: String(rating), selected: rating === (analysis?.difficulty ?? 1200) },
      String(rating))));
  const confidence = h('input', { class: 'input', type: 'number', min: '0', max: '1', step: '0.05',
    value: String(analysis?.confidence ?? 0.8) });
  const reason = h('input', { class: 'input', placeholder: '难度判断理由（可选）',
    value: analysis?.difficulty_reason || '' });
  const idea = h('textarea', { rows: 3, placeholder: '解题思路（可选）' }, analysis?.solution_idea || '');
  const result = h('div', { class: 'analysis-status' });
  const save = button('保存标注（进入待审核）', { iconName: 'save', type: 'submit', disabled: true });

  mount(host, loading('准备标签编辑器…'));
  createTagEditor([
    ...(analysis?.primary_knowledge_ids || []).map((id) => ({ id, role: 'primary',
      evidence: analysis?.evidence?.[id] || '', confidence: analysis?.knowledge_confidence?.[id] ?? 0.8 })),
    ...(analysis?.secondary_knowledge_ids || []).map((id) => ({ id, role: 'secondary',
      evidence: analysis?.evidence?.[id] || '', confidence: analysis?.knowledge_confidence?.[id] ?? 0.8 })),
  ]).then((editor) => {
    save.disabled = false;
    const form = h('form', { class: 'analysis-form' },
      analysis
        ? notice(`当前分析 #${analysis.analysis_id}。保存会生成一条新的待审核版本，旧版本与审核记录都会保留。`)
        : notice('这道题还没有分析，保存即创建第一版。', 'warn'),
      editor.node,
      h('div', { class: 'analysis-grid' },
        field('题目难度（Codeforces 评分）', difficulty),
        field('整体置信度（0–1）', confidence)),
      field('难度判断理由', reason),
      field('解题思路', idea),
      h('div', { class: 'analysis-actions' }, save),
      result);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const data = await api.saveAnalysis(problem.id, {
          difficulty: Number(difficulty.value),
          confidence: Number(confidence.value),
          difficulty_reason: reason.value.trim(),
          solution_idea: idea.value.trim(),
          taxonomy_version: store.state.knowledgeVersion,
          ...editor.read(),
        });
        mount(result, notice(`已保存分析 #${data.analysis.analysis_id}（待审核）。`, 'ok'));
        toast('标注已保存，等待人工审核', 'ok');
      } catch (error) {
        mount(result, errorBox(error));
      }
    });
    mount(host, card({ title: '手工标注或纠正' }, form));
  }).catch((error) => {
    mount(host, errorBox(error, () => navigate('analysis')));
  });
}

function historyPanel(host, problem) {
  mount(host, loading('读取版本历史…'));
  api.analysisHistory(problem.id).then((data) => {
    if (!data.items.length) {
      mount(host, card({ title: '版本历史' }, notice('还没有任何分析版本。', 'warn')));
      return;
    }
    mount(host, card({ title: `版本历史（${data.items.length}）` },
      h('div', { class: 'analysis-history' }, data.items.map((item) =>
        h('div', { class: 'analysis-history-item' },
          h('div', { class: 'analysis-meta' },
            h('strong', {}, `#${item.analysis_id}`),
            statusBadge(item.review_status),
            h('span', { class: 'tag' }, item.origin === 'model' ? '模型' : '人工'),
            difficultyTag(item.difficulty, item.difficulty_band),
            h('span', { class: 'spacer' }),
            h('span', { class: 'hint' }, item.created_at)),
          h('p', { class: 'muted' },
            `核心：${item.primary_knowledge_ids.map((id) => id).join('、') || '无'}`
            + `${item.secondary_knowledge_ids.length ? ` · 涉及：${item.secondary_knowledge_ids.join('、')}` : ''}`))))));
  }).catch((error) => {
    mount(host, errorBox(error, () => historyPanel(host, problem)));
  });
}
