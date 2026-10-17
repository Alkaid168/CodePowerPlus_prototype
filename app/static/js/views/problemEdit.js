/* 独立题目编辑：复用版本化保存与本地草稿，不触发模型分析。 */
import { api } from '../api.js';
import { h, mount } from '../dom.js';
import { store } from '../store.js';
import { navigate } from '../router.js';
import { statementHost } from '../problemStatement.js';
import { attachCodeCopy } from '../codeCopy.js';
import { createDraftSession, createDraftView } from '../drafts.js';
import { button, card, errorBox, field, notice, toast } from '../components.js';

const KEYS = ['title', 'source_url', 'description', 'reference_solution', 'reference_code'];

export default {
  async render({ problemId }) {
    const view = createDraftView();
    view.user = store.state.userId || 'demo-user';
    let saved;
    try { saved = await api.problem(problemId); }
    catch (error) { return errorBox(error, () => navigate(`problems/${problemId}/edit`)); }
    if (!view.active) return h('div');

    const inputs = {
      title: h('input', { class: 'input', required: true, maxlength: 300, 'aria-label': '题目标题' }),
      source_url: h('input', { class: 'input', type: 'url', 'aria-label': '来源链接', placeholder: 'https://' }),
      description: h('textarea', { class: 'input mono', required: true, spellcheck: false, 'aria-label': '题面内容', placeholder: '支持 Markdown 与 LaTeX' }),
      reference_solution: h('textarea', { class: 'input', rows: 4, 'aria-label': '参考题解', placeholder: '支持 Markdown' }),
      reference_code: h('textarea', { class: 'input mono', rows: 4, spellcheck: false, 'aria-label': '参考代码', placeholder: '粘贴参考代码' }),
    };
    const read = () => Object.fromEntries(KEYS.map(key => [key, inputs[key].value]));
    const restore = data => { for (const key of KEYS) inputs[key].value = data[key] || ''; };
    restore(saved);
    let busy = false, draft, previewTimer;
    let previewKind = 'description';
    const base = { revision: saved.revision, analysisId: null };
    const feedback = h('div', { class: 'problem-edit-feedback', 'aria-live': 'polite' });
    const indicator = h('div', { class: 'analysis-draft-indicator' });
    const preview = h('div', { class: 'problem-edit-preview' });
    const tabs = h('div', { class: 'tabs', role: 'group', 'aria-label': '预览内容' });
    const controls = [];

    function exportRecovery() {
      if (!draft?.recovery) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(draft.recovery, null, 2)], { type: 'application/json' }));
      const link = h('a', { href: url, download: `problem-${problemId}-draft.json` });
      link.click(); URL.revokeObjectURL(url);
    }
    function draftState(state) {
      if (!view.active) return;
      const labels = { pending: '正在保存本地草稿', saved: '本地草稿已保存，尚未提交',
        warning: '草稿保存失败，请及时保存修改', recovery: '存在其他版本草稿，点击导出' };
      const label = labels[state];
      const control = label ? button('', { variant: 'ghost', small: true,
        iconName: state === 'saved' ? 'check' : state === 'pending' ? 'save' : 'alert-triangle',
        title: label, onClick: exportRecovery }) : null;
      if (control) { control.disabled = busy; control.setAttribute('aria-label', label); }
      indicator.setAttribute('data-state', state);
      mount(indicator, control);
    }
    function paintPreview() {
      if (!view.active) return;
      window.clearTimeout(previewTimer);
      const value = inputs[previewKind].value;
      const article = previewKind === 'reference_code'
        ? h('article', { class: 'problem-statement' }, h('pre', { class: 'problem-edit-code', tabindex: 0 }, h('code', {}, value)))
        : statementHost(value, inputs.title.value);
      if (previewKind === 'reference_code') attachCodeCopy(article);
      mount(preview, previewKind === 'description' && inputs.title.value.trim()
        ? h('h2', { class: 'problem-edit-preview-title' }, inputs.title.value.trim()) : null,
      value.trim() ? article : h('div', { class: 'problem-edit-empty' }, '暂无内容'));
    }
    for (const [kind, label] of [['description', '题面'], ['reference_solution', '参考题解'], ['reference_code', '参考代码']]) {
      const tab = button(label, { variant: 'tab', onClick: () => {
        previewKind = kind;
        for (const [key, control] of controls) { control.classList.toggle('active', key === kind); control.setAttribute('aria-pressed', String(key === kind)); }
        paintPreview();
      } });
      tab.classList.toggle('active', kind === previewKind);
      tab.setAttribute('aria-pressed', String(kind === previewKind));
      controls.push([kind, tab]); tabs.append(tab);
    }

    const save = button('保存修改', { iconName: 'save', type: 'submit' });
    const formId = `problem-edit-${problemId}`;
    save.setAttribute('form', formId);
    const showProblem = button('查看题目', { variant: 'secondary', onClick: () => navigate(`problems/${problemId}`) });
    const form = h('form', { class: 'problem-edit-form', id: formId },
      h('div', { class: 'problem-edit-basics' }, field('题目标题', inputs.title), field('来源链接（可选）', inputs.source_url)),
      h('div', { class: 'problem-edit-statement-field' }, field('题面（Markdown）', inputs.description)),
      h('div', { class: 'problem-edit-references' }, field('参考题解（可选）', inputs.reference_solution), field('参考代码（可选）', inputs.reference_code)),
      feedback);
    const page = h('div', { class: 'problem-editor' },
      h('header', { class: 'problem-edit-header' },
        h('h1', { class: 'problem-heading' }, h('span', { class: 'problem-number' }, `#${problemId} `), h('span', { class: 'problem-title' }, '编辑题目')),
        h('div', { class: 'problem-edit-actions' }, showProblem, save)),
      h('div', { class: 'problem-edit-workspace' },
        card({ title: '题目信息', actions: indicator, className: 'problem-edit-card' }, form),
        card({ title: '预览', actions: tabs, className: 'problem-edit-preview-card' }, preview)));
    draft = createDraftSession({ user: view.user, kind: 'problem', id: problemId,
      base, baseline: read(), read, onState: draftState });
    if (draft.restored) restore(draft.restored);
    view.add(() => { window.clearTimeout(previewTimer); draft.dispose(); });
    view.onFlush(() => draft.flush());
    form.addEventListener('input', () => {
      draft.changed();
      window.clearTimeout(previewTimer);
      previewTimer = window.setTimeout(paintPreview, 450);
    });
    form.addEventListener('change', () => draft.changed());
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy) return;
      if (!inputs.title.value.trim() || !inputs.description.value.trim()) {
        mount(feedback, notice('请填写题目标题和题面。', 'warn')); return;
      }
      draft.flush();
      const submitted = read();
      busy = true;
      for (const node of page.querySelectorAll('input, textarea, button')) node.disabled = true;
      mount(feedback);
      try {
        saved = await api.updateProblem(problemId, { ...submitted, expected_revision: saved.revision });
        base.revision = saved.revision;
        draft.clean(Object.fromEntries(KEYS.map(key => [key, saved[key] || ''])));
        if (!view.active) return;
        restore(saved); paintPreview();
        mount(feedback, saved.analysis_stale
          ? h('div', { class: 'problem-edit-saved' }, h('span', {}, '已保存，分析需要更新'),
            button('去分析', { variant: 'ghost', small: true, onClick: () => navigate(`analysis/${problemId}`) })) : null);
        toast('题目已保存', 'ok');
      } catch (error) {
        if (!view.active) return;
        mount(feedback, errorBox(error), error.status === 409
          ? button('加载最新版本', { variant: 'secondary', small: true, onClick: () => {
            draft.flush(); navigate(`problems/${problemId}/edit`);
          } }) : null);
      } finally {
        busy = false;
        if (view.active) for (const node of page.querySelectorAll('input, textarea, button')) node.disabled = false;
      }
    });
    paintPreview();
    return page;
  },
};
