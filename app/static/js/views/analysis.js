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
import { createDraftSession, createDraftView, readCreated, rememberCreated, clearCreated,
  createdVersion, acquireEntrySave } from '../drafts.js';

const RATING_MIN = 100;
const RATING_MAX = 3500;
const RATING_STEP = 100;

const PREVIEW_DEBOUNCE = 500;

export default {
  async render({ param }) {
    const view = createDraftView();
    view.user = store.state.userId || 'demo-user';
    return param ? renderExisting(Number(param), view) : renderEntry(view);
  },
};

function draftIndicator(view, operations = null) {
  const node = h('div', { class: 'analysis-draft-indicator' });
  let session;
  const labels = { pending: '正在保存本地草稿', saved: '本地草稿已保存，尚未提交',
    warning: '本地草稿保存失败，离开前请保存到题库', recovery: '存在旧版本草稿，点击导出后核对' };
  return { node, bind(value) { session = value; }, update(state) {
    if (!view.active) return;
    node.setAttribute('data-state', state);
    const label = labels[state];
    const control = label ? button('', { variant: 'ghost', small: true,
      iconName: state === 'saved' ? 'check' : state === 'pending' ? 'save' : 'alert-triangle', title: label,
      onClick: () => {
        if (!session?.recovery) return;
        try {
          const url = URL.createObjectURL(new Blob([JSON.stringify(session.recovery, null, 2)], {type: 'application/json'}));
          const link = h('a', { href: url, download: 'codepowerplus-draft.json' });
          link.click(); URL.revokeObjectURL(url);
        } catch { node.setAttribute('data-state', 'warning'); }
      } }) : null;
    if (control) control.setAttribute('aria-label', label);
    mount(node, control);
    operations?.sync();
  } };
}

function contentFields(title, source, statement, solution, code) {
  const fields = {title, source_url: source, description: statement, reference_solution: solution, reference_code: code};
  return { read: () => Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.value])),
    restore: data => { if (data) for (const [key, input] of Object.entries(fields)) input.value = data[key]; } };
}

function attachDraft(form, view, options, indicator) {
  const session = createDraftSession({user: view.user, ...options, onState: indicator.update});
  indicator.bind(session);
  form.addEventListener('input', () => session.changed());
  form.addEventListener('change', () => session.changed());
  const dispose = session.dispose;
  const removeCleanup = view.add(() => session.dispose());
  const removeFlush = view.onFlush(() => session.flush());
  session.dispose = () => { dispose(); removeCleanup(); removeFlush(); };
  return session;
}

function ratingOptions() {
  const options = [];
  for (let rating = RATING_MIN; rating <= RATING_MAX; rating += RATING_STEP) options.push(rating);
  return options;
}

function percent(value) {
  return typeof value === 'number' ? `${Math.round(value * 100)}%` : '—';
}

/* ------------------------------------------------------------------ 新建 */

async function renderEntry(view) {
  const checkpoint = readCreated(view.user);
  let recoveredProblem = null;
  if (checkpoint) {
    try { recoveredProblem = await api.problem(checkpoint.id); }
    catch (error) { return card({title: '恢复已录入题目'}, errorBox(error, () => navigate('analysis')),
      button('清空', {variant: 'secondary', onClick: () => { clearCreated(view.user); navigate('analysis'); }})); }
  }
  if (!view.active) return h('div');
  const title = h('input', { class: 'input', maxlength: 300, placeholder: '例如：区间求和' });
  const source = h('input', { class: 'input', type: 'url',
    placeholder: '粘贴学校 OJ 或其他题目链接（可以留空）' });
  const referenceSolution = h('textarea', { class: 'input', rows: 4, placeholder: '参考题解，可使用 Markdown' });
  const referenceCode = h('textarea', { class: 'input mono', rows: 5, spellcheck: false,
    placeholder: '粘贴参考代码，用于辅助理解，不执行代码' });
  const statement = h('textarea', { class: 'input markdown-input', spellcheck: 'false',
    placeholder: '粘贴 Markdown 题面。公式用 LaTeX：行内 $a_i$，独立一行 $$\\sum_{i=l}^{r} a_i$$' });

  const status = h('div', { class: 'analysis-status' });
  const submit = button('保存并分析', { iconName: 'sparkles', type: 'submit' });
  const saveOnly = button('保存后手工标注', { variant: 'secondary', type: 'submit' });
  let busy = false;

  // 建题成功但分析失败时记住编号，重试时只重新分析，不会产生第二道题。
  let savedProblem = recoveredProblem;
  const fields = contentFields(title, source, statement, referenceSolution, referenceCode);
  fields.restore(recoveredProblem);
  const base = {revision: recoveredProblem?.revision ?? null, analysisId: null};
  const indicator = draftIndicator(view);
  let draft;

  const reset = button('清空', { variant: 'secondary', onClick: () => {
    title.value = ''; source.value = ''; statement.value = ''; referenceSolution.value = '';
    referenceCode.value = ''; savedProblem = null;
    base.revision = null;
    clearCreated(view.user);
    draft.clear(fields.read());
    mount(status, ''); schedulePreview();
  } });

  const previewHost = h('article', { class: 'markdown-body' });
  const previewMeta = h('div', { class: 'analysis-preview-meta' });
  let previewTimer = null;

  function schedulePreview() {
    if (!view.active) return;
    window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(refreshPreview, PREVIEW_DEBOUNCE);
  }

  async function refreshPreview() {
    if (!view.active) return;
    const text = statement.value.trim();
    mount(previewMeta, text
      ? h('span', { class: 'hint' }, `${text.length} 字符 · Markdown 渲染预览`)
      : null);
    if (!text) {
      mount(previewHost, h('div', { class: 'analysis-placeholder' },
        h('p', {}, '右侧预览会按 Markdown 渲染题面，公式用 LaTeX 排版。')));
      return;
    }
    const { mathRendered } = await mountMarkdown(previewHost, text);
    if (!view.active) return;
    if (statement.value.trim() && !mathRendered && /\$|\\\(|\\\[/.test(statement.value)) {
      previewMeta.append(h('span', { class: 'hint' }, '公式引擎未加载，公式暂以原文显示'));
    }
  }

  statement.addEventListener('input', schedulePreview);
  view.add(() => window.clearTimeout(previewTimer));
  schedulePreview();

  const form = h('form', { class: 'analysis-form analysis-entry-form' },
    field('题目标题', title),
    field('来源链接（可选）', source, '只接受 http:// 或 https:// 开头的链接。'),
    h('div', { class: 'analysis-statement-field' },
      h('label', { class: 'field-label' }, '题面（Markdown）'),
      statement),
    field('参考题解（可选）', referenceSolution),
    field('参考代码（可选）', referenceCode),
    h('div', { class: 'analysis-actions' }, submit, saveOnly, reset),
    status);

  draft = attachDraft(form, view, {kind: 'entry', base, createdRevision: checkpoint?.revision ?? null,
    baseline: fields.read(), read: fields.read}, indicator);
  fields.restore(draft.restored);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    const body = {
      title: title.value.trim(),
      description: statement.value.trim(),
      source_url: source.value.trim(),
      reference_solution: referenceSolution.value.trim(),
      reference_code: referenceCode.value.trim(),
    };
    if (!body.title) { mount(status, notice('请先填写题目标题。', 'warn')); title.focus(); return; }
    if (!body.description) { mount(status, notice('请先粘贴题面。', 'warn')); statement.focus(); return; }

    const release = acquireEntrySave(view.user);
    if (!release) { indicator.update('pending'); return; }
    busy = true;
    for (const node of form.querySelectorAll('input, textarea, button')) node.disabled = true;
    let pointerVersion = createdVersion(view.user);
    let pointerOwned = false;
    try {
      // 旧视图的建题请求可能刚刚返回；重入页面提交前重新核对编号，禁止重复建题。
      if (!savedProblem) {
        const latest = readCreated(view.user);
        if (latest) savedProblem = await api.problem(latest.id);
      }
      draft.flush();
      if (!savedProblem) {
        mount(status, loading('正在保存题目…'));
        savedProblem = await api.createProblem(body);
        pointerOwned = rememberCreated(view.user, savedProblem, undefined, pointerVersion);
        if (!pointerOwned) {
          indicator.update('warning');
          // 存储不可用时，把已创建题号写入地址，刷新也只能更新同一道题。
          if (view.active && createdVersion(view.user) === pointerVersion) {
            window.history?.replaceState(null, '', `#/analysis/${savedProblem.id}`);
            view.route = window.location.hash;
          }
        }
        if (view.active) mount(status, notice(`已保存为 #${savedProblem.id}，正在调用模型分析（通常 10–30 秒）…`, 'ok'));
      } else {
        mount(status, loading(`正在保存 #${savedProblem.id} 的最新输入…`));
        savedProblem = await api.updateProblem(savedProblem.id, { ...body, expected_revision: savedProblem.revision });
        pointerOwned = rememberCreated(view.user, savedProblem, undefined, pointerVersion);
      }
      if (pointerOwned) pointerVersion = createdVersion(view.user);
      base.revision = savedProblem.revision;
      const cleaned = draft.clean(fields.read());
      if (event.submitter === saveOnly) {
        if (view.active) {
          if (cleaned && pointerOwned) clearCreated(view.user, undefined, pointerVersion);
          navigate(`analysis/${savedProblem.id}`);
        }
        return;
      }
      const result = await api.analyzeProblem(savedProblem.id);
      if (view.active) {
        if (cleaned && pointerOwned) clearCreated(view.user, undefined, pointerVersion);
        toast(`#${result.problem.id} 已录入并完成模型分析`, 'ok');
        navigate(`analysis/${result.problem.id}`);
      }
    } catch (error) {
      if (!view.active) return;
      const hint = savedProblem
        ? h('div', { class: 'analysis-actions' },
            button('重试分析', { iconName: 'refresh-cw', onClick: () => form.requestSubmit() }),
            button('去手工标注', { variant: 'secondary', iconName: 'clipboard-check',
              onClick: () => form.requestSubmit(saveOnly) }))
        : null;
      mount(status, errorBox(error), hint,
        savedProblem ? h('p', { class: 'hint' },
          `题目 #${savedProblem.id} 已经保存，题面不会丢失；分析失败不影响重新分析或手工标注。`) : null);
    } finally {
      busy = false;
      release();
      if (view.active) for (const node of form.querySelectorAll('input, textarea, button')) node.disabled = false;
    }
  });

  return h('div', { class: 'analysis-workspace' },
    h('div', { class: 'analysis-column analysis-column-left analysis-entry-column' },
      card({ title: '录入题目', actions: indicator.node }, form)),
    h('div', { class: 'analysis-column analysis-column-right' },
      card({ title: '题面预览', actions: previewMeta }, previewHost)));
}

/* ------------------------------------------------------------ 已有题目 */

async function renderExisting(problemId, view) {
  const names = new Map((await store.ensureKnowledge(api)).map((node) => [node.id, node.name]));
  const left = h('div', { class: 'analysis-column analysis-column-left' });
  const right = h('div', { class: 'analysis-column analysis-column-right' });
  const workspace = h('div', { class: 'analysis-workspace' }, left, right);
  let mutating = false;
  let disposePanels = () => {};
  view.add(() => disposePanels());
  const lockedControls = new Map();
  const operations = {
    isBusy: () => mutating,
    sync() {
      if (!mutating || !view.active) return;
      for (const node of workspace.querySelectorAll('input, textarea, select, button')) {
        if (!lockedControls.has(node)) lockedControls.set(node, node.disabled);
        node.disabled = true;
      }
    },
    setBusy(value) {
      mutating = value;
      if (value) {
        this.sync();
      } else {
        if (view.active) for (const [node, disabled] of lockedControls) node.disabled = disabled;
        lockedControls.clear();
      }
    },
  };

  async function refresh() {
    if (!view.active) return;
    disposePanels();
    mount(left, loading('读取题目…'));
    mount(right, '');
    let problem;
    try {
      problem = await api.problem(problemId);
    } catch (error) {
      if (!view.active) return;
      mount(left, errorBox(error, refresh));
      return;
    }
    if (!view.active) return;
    const info = leftPanel(problem, refresh, operations, view);
    mount(left, info.node);
    const result = rightPanel(problem, names, refresh, info.hasUnsavedChanges, operations, view);
    mount(right, result.node);
    disposePanels = () => { info.dispose(); result.dispose(); };
    operations.sync();
  }

  await refresh();
  return workspace;
}

function leftPanel(problem, refresh, operations, view) {
  const title = h('input', { class: 'input', value: problem.title, required: true, maxlength: 300 });
  const source = h('input', { class: 'input', type: 'url', value: problem.source_url });
  const statement = h('textarea', { class: 'input markdown-input', required: true }, problem.description);
  const solution = h('textarea', { class: 'input', rows: 4 }, problem.reference_solution || '');
  const code = h('textarea', { class: 'input mono', rows: 5 }, problem.reference_code || '');
  const feedback = h('div', { class: 'analysis-status' });
  let busy = false;
  let saved = problem;
  const fields = contentFields(title, source, statement, solution, code);
  const indicator = draftIndicator(view, operations);
  const read = () => ({ title: title.value.trim(), description: statement.value.trim(),
    source_url: source.value.trim(), reference_solution: solution.value.trim(), reference_code: code.value.trim() });
  const hasUnsavedChanges = () => Object.entries(read()).some(([key, value]) => value !== (saved[key] || ''));
  const save = button('保存修改', { iconName: 'save', type: 'submit' });
  const reanalyze = button('保存并重新分析', { variant: 'secondary', iconName: 'sparkles', type: 'submit' });
  const form = h('form', { class: 'analysis-form' },
    field('题目标题', title), field('来源链接（可选）', source), field('题面（Markdown）', statement),
    field('参考题解（可选）', solution), field('参考代码（可选）', code),
    notice('修改后请保存，再进行分析或手工标注。旧分析和审核记录会保留。'),
    h('div', { class: 'analysis-actions' }, save, reanalyze), feedback);
  const draft = attachDraft(form, view, {kind: 'problem', id: problem.id,
    base: {revision: problem.revision, analysisId: null}, baseline: fields.read(), read: fields.read}, indicator);
  fields.restore(draft.restored);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || operations.isBusy()) return;
    busy = true;
    operations.setBusy(true);
    try {
      saved = await api.updateProblem(problem.id, { ...read(), expected_revision: saved.revision });
      draft.clean(fields.read());
      if (event.submitter === reanalyze) {
        if (view.active) mount(feedback, loading('模型分析中…'));
        await api.analyzeProblem(problem.id);
        if (!view.active) return;
        toast('已生成新的待审核分析', 'ok');
      } else if (view.active) { toast('题目已保存', 'ok'); }
      await refresh();
    } catch (error) {
      if (!view.active) return;
      mount(feedback, errorBox(error), notice('已保存的内容不会丢失；输入仍在当前页面，核对后可以重试。'));
      if (saved.revision !== problem.revision) {
        toast(`题目修改已保存，分析未完成：${error.message}`, 'warn');
        await refresh();
      }
    } finally {
      busy = false;
      operations.setBusy(false);
    }
  });

  const meta = h('div', { class: 'analysis-meta' },
    h('span', { class: 'analysis-number' }, `#${problem.id} · 题目版本 ${problem.revision}`),
    sourceLink(problem.source_url),
    h('span', { class: 'hint' }, problem.created_at ? `录入于 ${problem.created_at}` : ''));

  return { hasUnsavedChanges, dispose: () => draft.dispose(), node: card({ title: '题目信息',
    actions: h('div', {class: 'analysis-meta'}, indicator.node, button('返回录入', { variant: 'ghost', small: true,
    iconName: 'plus', onClick: () => { clearCreated(view.user); navigate('analysis'); } })) },
    meta,
    problem.analysis_stale ? notice('题目已修订，当前分析需要更新。请重新分析或保存新的手工标注。', 'warn') : null,
    form) };
}

function rightPanel(problem, names, refresh, hasUnsavedChanges, operations, view) {
  const analysis = problem.analysis;
  const definitions = [
    { id: 'result', label: '分析结果', render: (host) => analysis
      ? mount(host, analysisPanel(analysis, names))
      : mount(host, card({ title: '当前分析' },
          notice('这道题还没有分析。用模型分析，或在“手工标注”里自己填。', 'warn'))) },
    { id: 'preview', label: '题面预览',
      render: (host) => mount(host, statementPanel(problem)) },
    { id: 'manual', label: '手工标注',
      render: (host) => manualPanel(host, problem, analysis, refresh, hasUnsavedChanges, operations, view) },
    { id: 'history', label: '版本历史', render: (host) => historyPanel(host, problem, view) },
  ];
  return createTabbed(definitions, 'result');
}

function createTabbed(definitions, initialId) {
  const bar = h('div', { class: 'analysis-tabs', role: 'tablist' });
  const panel = h('div', { class: 'analysis-tab-panel' });
  const buttons = new Map();
  let current = null;
  let cleanup = () => {};

  const show = (id) => {
    const definition = definitions.find((item) => item.id === id);
    if (!definition || current === id) return;
    cleanup(); cleanup = () => {};
    current = id;
    for (const [key, node] of buttons) {
      node.classList.toggle('active', key === id);
      node.setAttribute('aria-selected', String(key === id));
    }
    mount(panel, loading('读取中…'));
    const result = definition.render(panel);
    if (typeof result === 'function') cleanup = result;
  };

  for (const definition of definitions) {
    const node = h('button', { type: 'button', role: 'tab', class: 'analysis-tab',
      onClick: () => show(definition.id) }, definition.label);
    buttons.set(definition.id, node);
    bar.append(node);
  }
  show(initialId);
  return {node: h('div', { class: 'analysis-tabbed' }, bar, panel), dispose: () => cleanup()};
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
    analysis.is_stale ? notice('此分析对应旧题目版本，需更新后再审核和使用。', 'warn') : null,
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
      analysis.review_status === 'pending' && !analysis.is_stale
        ? button('去审核', { variant: 'secondary', small: true, iconName: 'clipboard-check',
            onClick: () => navigate(`reviews/${analysis.problem_id}`) })
        : null));
}

function manualPanel(host, problem, analysis, refresh, hasUnsavedChanges, operations, view) {
  let active = true;
  let draft = null;
  let removeCleanup = () => {};
  const cleanup = () => { active = false; draft?.dispose(); removeCleanup(); };
  removeCleanup = view.add(cleanup);
  const indicator = draftIndicator(view, operations);
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
  ], {onChange: () => draft?.changed()}).then((editor) => {
    if (!active || !view.active) return;
    save.disabled = false;
    const form = h('form', { class: 'analysis-form' },
      analysis
        ? notice(`当前分析 #${analysis.analysis_id}。保存会生成一条新的待审核版本，旧版本与审核记录都会保留。`)
        : notice('这道题还没有分析，保存即创建第一版。', 'warn'),
      editor.node,
      h('div', { class: 'analysis-grid' },
        field('题目难度（100–3500）', difficulty),
        field('整体置信度（0–1）', confidence)),
      field('难度判断理由', reason),
      field('解题思路', idea),
      h('div', { class: 'analysis-actions' }, save),
      result);
    const read = () => ({rows: (editor.rows || []).map(row => ({...row})), difficulty: difficulty.value,
      confidence: confidence.value, difficulty_reason: reason.value, solution_idea: idea.value});
    draft = attachDraft(form, view, {kind: 'manual', id: problem.id,
      base: {revision: problem.revision, analysisId: analysis?.analysis_id ?? null}, baseline: read(), read}, indicator);
    if (draft.restored) {
      difficulty.value = draft.restored.difficulty; confidence.value = draft.restored.confidence;
      reason.value = draft.restored.difficulty_reason; idea.value = draft.restored.solution_idea;
      editor.reset(draft.restored.rows);
    }
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (save.disabled || operations.isBusy()) return;
      if (hasUnsavedChanges()) { mount(result, notice('请先保存左侧题目信息的修改，再进行手工标注。', 'warn')); return; }
      operations.setBusy(true);
      try {
        const data = await api.saveAnalysis(problem.id, {
          difficulty: Number(difficulty.value),
          confidence: Number(confidence.value),
          difficulty_reason: reason.value.trim(),
          solution_idea: idea.value.trim(),
          taxonomy_version: store.state.knowledgeVersion,
          expected_revision: problem.revision,
          ...editor.read(),
        });
        draft.clean(read());
        if (!active || !view.active) return;
        mount(result, notice(`已保存分析 #${data.analysis.analysis_id}（待审核）。`, 'ok'));
        toast('标注已保存，等待人工审核', 'ok');
        await refresh();
      } catch (error) {
        if (!active || !view.active) return;
        mount(result, errorBox(error));
      } finally {
        operations.setBusy(false);
      }
    });
    mount(host, card({ title: '手工标注或纠正', actions: indicator.node }, form));
    operations.sync();
  }).catch((error) => {
    if (!active || !view.active) return;
    mount(host, errorBox(error, () => navigate('analysis')));
  });
  return cleanup;
}

function historyPanel(host, problem, view) {
  let active = true;
  function load() {
  if (!active || !view.active) return;
  mount(host, loading('读取版本历史…'));
  api.analysisHistory(problem.id).then((data) => {
    if (!active || !view.active) return;
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
            item.is_stale ? h('span', { class: 'tag' }, '需要更新') : null,
            h('span', { class: 'hint' }, `题目版本 ${item.problem_revision}`),
            h('span', { class: 'tag' }, item.origin === 'model' ? '模型' : '人工'),
            difficultyTag(item.difficulty, item.difficulty_band),
            h('span', { class: 'spacer' }),
            h('span', { class: 'hint' }, item.created_at)),
          h('p', { class: 'muted' },
            `核心：${item.primary_knowledge_ids.map((id) => id).join('、') || '无'}`
            + `${item.secondary_knowledge_ids.length ? ` · 涉及：${item.secondary_knowledge_ids.join('、')}` : ''}`),
          h('details', {}, h('summary', {}, '查看本版分析与输入'),
            h('p', { class: 'muted' }, `难度理由：${item.difficulty_reason || '未填写'}`),
            h('pre', { class: 'statement-source' }, item.solution_idea || '未填写解题思路'),
            Object.keys(item.input_snapshot || {}).length ? Object.entries(item.input_snapshot)
              .map(([key, value]) => h('div', {}, h('strong', {}, ({title:'标题',description:'题面',source_url:'来源',
                reference_solution:'参考题解',reference_code:'参考代码'})[key] || key),
                h('pre', { class: 'statement-source' }, value || '未提供')))
              : notice('此记录创建于输入快照功能之前，没有可核验的历史输入。')))))));
  }).catch((error) => {
    if (!active || !view.active) return;
    mount(host, errorBox(error, load));
  });
  }
  load();
  return () => { active = false; };
}
