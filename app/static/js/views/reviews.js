/* 审核队列：把待审核分析变成已通过或已驳回，并保留审计记录。 */
import { api } from '../api.js';
import { h, mount } from '../dom.js';
import { navigate } from '../router.js';
import { store } from '../store.js';
import { button, card, emptyState, errorBox, formatDate, loading, notice, statusBadge, toast } from '../components.js';
import { createTagEditor } from '../tagEditor.js';

const STATUSES = [['pending', '待审核'], ['approved', '已通过'], ['rejected', '已驳回'], ['legacy', '旧版遗留']];

export default {
  async render() {
    await store.ensureKnowledge(api);
    const names = new Map(store.state.knowledge.map((node) => [node.id, node.name]));
    let status = 'pending';

    const tabsHost = h('div', { class: 'tabs' });
    const listHost = h('div', { class: 'stack' });

    const paintTabs = () => mount(tabsHost, STATUSES.map(([value, label]) => h('button', {
      type: 'button',
      class: `tab${value === status ? ' active' : ''}`,
      onClick: () => { status = value; paintTabs(); load(); },
    }, label)));

    async function load() {
      mount(listHost, loading('读取队列…'));
      try {
        const data = await api.reviewQueue(status);
        mount(listHost, data.items.length
          ? data.items.map(itemCard)
          : emptyState(status === 'pending' ? '没有待审核的分析。' : '这个状态下没有题目。'));
      } catch (error) {
        mount(listHost, errorBox(error, load));
      }
    }

    function itemCard(problem) {
      const analysis = problem.analysis;
      const ids = [...analysis.primary_knowledge_ids, ...analysis.secondary_knowledge_ids];
      const reviewer = h('input', { class: 'input', value: store.state.userId });
      const comment = h('input', { class: 'input', placeholder: '审核意见（可选）' });
      const result = h('div', {});
      const correctionHost = h('div', { hidden: true });
      let correctionEditor = null;

      const head = h('div', { class: 'row wrap' },
        h('button', { class: 'btn link', onClick: () => navigate(`problems/${problem.id}`) }, `#${problem.id} ${problem.title}`),
        statusBadge(analysis.review_status),
        h('span', { class: 'hint' },
          `分析 #${analysis.analysis_id} · 难度 ${analysis.difficulty} · ${formatDate(analysis.created_at)}`));

      const tags = h('div', { class: 'stack tight', style: { marginTop: '10px' } }, ids.map((id) => h('div', {},
        h('div', { class: 'row' }, h('strong', {}, names.get(id) || id),
          h('span', { class: 'hint' }, analysis.primary_knowledge_ids.includes(id) ? '主知识点' : '辅助知识点')),
        h('p', { class: 'muted' }, analysis.evidence?.[id] || '缺少证据句'))));

      if (analysis.review_status !== 'pending') {
        return card({}, head, tags);
      }

      const actions = h('div', { class: 'row wrap', style: { marginTop: '12px' } },
        h('div', { style: { flex: '1 1 160px' } },
          h('label', { class: 'field-label' }, '审核人'), reviewer),
        h('div', { style: { flex: '2 1 220px' } },
          h('label', { class: 'field-label' }, '审核意见'), comment),
        button('通过', { iconName: 'check', onClick: () => submit('approve') }),
        button('驳回', { variant: 'danger', iconName: 'x', onClick: () => submit('reject') }),
        button('带纠正通过', {
          variant: 'secondary', iconName: 'save',
          onClick: async () => {
            if (!correctionEditor) {
              correctionEditor = await createTagEditor(ids.map((id) => ({
                id, role: analysis.primary_knowledge_ids.includes(id) ? 'primary' : 'secondary',
                evidence: analysis.evidence?.[id] || '', confidence: analysis.knowledge_confidence?.[id] ?? 0.8,
              })));
              mount(correctionHost, h('div', { class: 'stack' },
                notice('修改后保存的是新版本，原分析仍保留在历史里。', 'warn'),
                correctionEditor.node));
            }
            correctionHost.hidden = !correctionHost.hidden;
          },
        }));

      async function submit(action) {
        try {
          const body = {
            action,
            reviewer: reviewer.value.trim() || store.state.userId,
            comment: comment.value.trim(),
            expected_analysis_id: analysis.analysis_id,
          };
          if (action === 'approve' && !correctionHost.hidden && correctionEditor) {
            body.correction = {
              difficulty: analysis.difficulty,
              confidence: analysis.confidence,
              difficulty_reason: analysis.difficulty_reason || '',
              taxonomy_version: store.state.knowledgeVersion,
              ...correctionEditor.read(),
            };
          }
          await api.reviewProblem(problem.id, body);
          toast('审核已记录', 'ok');
          load();
        } catch (error) {
          mount(result, errorBox(error));
        }
      }

      return card({}, head, tags, actions, correctionHost, result);
    }

    paintTabs();
    load();
    return h('div', { class: 'stack' },
      card({ title: '审核状态' }, tabsHost, h('p', { class: 'hint', style: { marginTop: '8px' } },
        '只有「已通过」且知识版本一致的分析，才会在记录提交时成为知识证据。')),
      listHost);
  },
};
