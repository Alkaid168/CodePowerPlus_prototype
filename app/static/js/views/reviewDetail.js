/* 单题审核：核对题面和标注，纠正与审核沿用现有接口。 */
import { api } from '../api.js';
import { h, mount } from '../dom.js';
import { store } from '../store.js';
import { navigate } from '../router.js';
import { statementHost } from '../problemStatement.js';
import { mountMarkdown } from '../markdown.js';
import { attachCodeCopy } from '../codeCopy.js';
import { createTagEditor } from '../tagEditor.js';
import { button, card, difficultyTag, emptyState, errorBox, field, formatDate, loading, notice,
  sourceLink, statusBadge, tag, toast } from '../components.js';

export async function renderReviewDetail(problemId) {
  const problem = await api.problem(problemId);
  let analysis = problem.analysis;
  const names = new Map(store.state.knowledge.map(node => [node.id, node.name]));
  let busy = false, editorLoading = false, editing = false, editor = null, panel = 'labels', historyRequest = 0;
  const feedback = h('div', { class: 'review-feedback', role: 'status' });
  const rightTabs = h('div', { class: 'tabs review-analysis-tabs', role: 'group', 'aria-label': '审核资料' });
  const content = h('div', { class: 'review-analysis-content' });
  const status = h('span');
  const reviewer = h('input', { class: 'input', 'aria-label': '审核人', value: store.state.userId, maxLength: 100 });
  const comment = h('textarea', { class: 'input', 'aria-label': '审核意见', placeholder: '填写审核意见（可选）', rows: 2, maxLength: 4000 });
  const difficulty = h('select', { 'aria-label': '纠正难度' }, Array.from({ length: 35 }, (_, i) => 100 + i * 100)
    .map(value => h('option', { value: String(value), selected: value === analysis?.difficulty }, value)));
  const reason = h('textarea', { class: 'input', rows: 3, maxLength: 2000 }, analysis?.difficulty_reason || '');
  const idea = h('textarea', { class: 'input', rows: 5, maxLength: 20000 }, analysis?.solution_idea || '');
  const operationHost = h('div', { class: 'review-operation-host' });
  const root = h('div', { class: 'review-detail' },
    h('header', { class: 'review-detail-header' },
      h('h1', { class: 'review-heading' }, h('span', { class: 'review-number' }, `#${problem.id}`), problem.title)),
    h('div', { class: 'review-workspace' }, createMaterials(problem),
      h('aside', { class: 'review-column', 'aria-label': '分析与审核' },
        card({ title: '分析标注', actions: status, className: 'review-analysis-card' }, rightTabs, content), operationHost)));
  function canReview() { return analysis?.review_status === 'pending' && !analysis.is_stale; }
  function paintTabs() {
    mount(rightTabs, [['labels', '知识与难度'], ['idea', '解题思路'], ['history', '审核记录']].map(([key, label]) => h('button', {
      type: 'button', class: `tab${panel === key ? ' active' : ''}`, 'aria-pressed': String(panel === key),
      onClick: () => { if (busy || editorLoading) return; panel = key; paintTabs(); paintContent(); },
    }, label)));
  }
  function paintContent() {
    ++historyRequest;
    if (!analysis) { mount(content, emptyState('暂无分析')); return; }
    if (editing) {
      mount(content, h('div', { class: 'review-correction' },
        field('难度评分', difficulty), field('难度说明', reason), editor.node, field('解题思路', idea))); return;
    }
    if (panel === 'history') { loadHistory(); return; }
    if (panel === 'idea') {
      const solution = h('article', { class: 'markdown-body review-solution' });
      mountMarkdown(solution, analysis.solution_idea || '暂无解题思路'); attachCodeCopy(solution); mount(content, solution); return;
    }
    const knowledgeGroup = (label, ids) => ids?.length ? h('section', { class: 'review-knowledge-group' }, h('h3', {}, label),
      ids.map(id => h('div', { class: 'review-evidence' }, tag(names.get(id) || '旧版标签', 'muted'),
        h('p', {}, analysis.evidence?.[id] || '缺少判断证据')))) : null;
    mount(content, analysis.is_stale ? notice('题目已修改，请更新分析。', 'warn') : null,
      h('section', { class: 'review-rating' }, h('div', { class: 'row' }, h('h3', {}, '难度'),
        difficultyTag(analysis.difficulty, analysis.difficulty_band)),
      analysis.difficulty_reason ? h('p', {}, analysis.difficulty_reason) : null),
      knowledgeGroup('核心考点', analysis.primary_knowledge_ids), knowledgeGroup('也涉及', analysis.secondary_knowledge_ids));
  }
  async function loadHistory() {
    const request = ++historyRequest; mount(content, loading('读取审核记录…'));
    try {
      const data = await api.reviewHistory(problemId);
      if (request !== historyRequest || panel !== 'history' || editing) return;
      mount(content, data.items.length ? h('div', { class: 'review-history' }, data.items.map(row => h('article', {},
        h('div', { class: 'row' }, statusBadge(row.action === 'approve' ? 'approved' : 'rejected'), h('strong', {}, row.reviewer)),
        h('p', {}, row.comment || '未填写意见'), h('time', { class: 'hint' }, formatDate(row.created_at))))) : emptyState('暂无审核记录'));
    } catch (error) { if (request === historyRequest) mount(content, errorBox(error, loadHistory)); }
  }
  function paintOperations() {
    mount(status, analysis ? statusBadge(analysis.review_status) : null);
    rightTabs.hidden = editing;
    if (!canReview()) {
      const needsUpdate = analysis?.is_stale || !analysis;
      mount(operationHost, needsUpdate || feedback.children.length ? card({ className: 'review-operations' }, feedback,
        needsUpdate ? button('更新分析', { variant: 'secondary', onClick: () => navigate(`analysis/${problemId}`) }) : null) : null); return;
    }
    mount(operationHost, card({ title: '审核操作', className: 'review-operations',
      actions: button(editing ? '取消修改' : '修改标注', { variant: 'ghost', small: true, onClick: toggleEditor }) },
    field('审核人', reviewer), field('审核意见（可选）', comment), feedback,
    h('div', { class: 'review-actions' }, button('驳回', { variant: 'secondary', iconName: 'x', onClick: () => submit('reject') }),
      button(editing ? '保存并通过' : '通过', { iconName: 'check', onClick: () => submit('approve') }))));
  }
  function lock() {
    const states = [...root.querySelectorAll('button, input, textarea, select')].map(control => [control, control.disabled]);
    for (const [control] of states) control.disabled = true;
    return () => { for (const [control, disabled] of states) control.disabled = disabled; };
  }
  async function toggleEditor() {
    if (busy || editorLoading || !canReview()) return;
    if (editing) { editing = false; paintTabs(); paintContent(); paintOperations(); return; }
    editorLoading = true; const unlock = lock(); mount(feedback);
    try {
      const ids = [...analysis.primary_knowledge_ids, ...analysis.secondary_knowledge_ids];
      editor = await createTagEditor(ids.map(id => ({ id,
        role: analysis.primary_knowledge_ids.includes(id) ? 'primary' : 'secondary',
        evidence: analysis.evidence?.[id] || '', confidence: analysis.knowledge_confidence?.[id] ?? 0.8,
      })), { compact: true });
      difficulty.value = String(analysis.difficulty); reason.value = analysis.difficulty_reason || ''; idea.value = analysis.solution_idea || '';
      editing = true; ++historyRequest;
    } catch (error) { mount(feedback, errorBox(error)); }
    finally { editorLoading = false; unlock(); }
    paintContent(); paintOperations();
  }
  async function submit(action) {
    if (busy || editorLoading || !canReview()) return;
    const body = { action, reviewer: reviewer.value.trim() || store.state.userId, comment: comment.value.trim(),
      expected_analysis_id: analysis.analysis_id };
    try {
      if (action === 'approve' && editing) body.correction = { title: problem.title,
        difficulty: Number(difficulty.value), difficulty_reason: reason.value.trim(), solution_idea: idea.value.trim(),
        confidence: analysis.confidence, taxonomy_version: store.state.knowledgeVersion, ...editor.read() };
    } catch (error) { mount(feedback, errorBox(error)); return; }
    busy = true; const unlock = lock(); mount(feedback, notice('正在保存…'));
    try {
      const result = await api.reviewProblem(problemId, body);
      analysis = result.analysis; editing = false; panel = 'labels';
      toast(action === 'approve' ? '已通过审核' : '已驳回', 'ok');
      mount(feedback, notice(action === 'approve' ? '已通过审核' : '已驳回', 'ok'));
      paintTabs(); paintContent(); paintOperations();
    } catch (error) { mount(feedback, errorBox(error), error.status === 409
      ? button('重新加载', { variant: 'secondary', small: true, onClick: () => navigate(`reviews/${problemId}`) }) : null); }
    finally { busy = false; unlock(); }
  }
  paintTabs(); paintContent(); paintOperations(); return root;
}

function createMaterials(problem) {
  const tabs = h('div', { class: 'tabs review-material-tabs', role: 'group', 'aria-label': '题目资料' });
  const host = h('div', { class: 'review-material-content' });
  const choices = [['statement', '题面'], ...(problem.reference_solution ? [['solution', '参考题解']] : []),
    ...(problem.reference_code ? [['code', '参考代码']] : [])];
  let active = 'statement';
  function paint() {
    mount(tabs, choices.map(([key, label]) => h('button', { type: 'button', class: `tab${active === key ? ' active' : ''}`,
      'aria-pressed': String(active === key), onClick: () => { active = key; paint(); } }, label)));
    if (active === 'statement') mount(host, statementHost(problem.description, problem.title));
    else if (active === 'solution') {
      const article = h('article', { class: 'markdown-body problem-statement' });
      mountMarkdown(article, problem.reference_solution); attachCodeCopy(article); mount(host, article);
    } else {
      const article = h('article', { class: 'markdown-body problem-statement' }, h('pre', {}, h('code', {}, problem.reference_code)));
      attachCodeCopy(article); mount(host, article);
    }
    host.scrollTop = 0;
  }
  paint();
  return card({ className: 'review-material-card' }, h('header', { class: 'review-material-header' }, tabs, sourceLink(problem.source_url)), host);
}
