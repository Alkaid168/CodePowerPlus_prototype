import { h } from './dom.js';
import { mountMarkdown } from './markdown.js';
import { attachCodeCopy } from './codeCopy.js';

export function statementHost(source, title) {
  const host = h('article', { class: 'markdown-body problem-statement' });
  mountMarkdown(host, source);
  const firstHeading = host.firstElementChild;
  if (/^H[1-3]$/.test(firstHeading?.tagName) && firstHeading.textContent.trim()
      && title.startsWith(firstHeading.textContent.trim())) firstHeading.textContent = '题目描述';
  const sections = { '任务': '题目描述', '题目定义': '题目描述', '输入': '输入格式',
    '输出': '输出格式', '约束': '数据范围', '示例': '样例' };
  for (const heading of host.querySelectorAll('h1, h2, h3')) {
    const label = heading.textContent.trim();
    if (sections[label]) heading.textContent = sections[label];
  }
  for (const paragraph of host.querySelectorAll('p')) {
    if (/^(官方样例，已逐字核对。|独立构造样例，非官方样例。)$/.test(paragraph.textContent.trim())) {
      paragraph.classList.add('problem-sample-note');
    }
  }
  attachCodeCopy(host);
  pairSamples(host);
  return host;
}

/** 相邻的输入/输出代码块并排展示；只调整渲染结构，不更改录入的题面原文。 */
function pairSamples(host) {
  for (const label of host.querySelectorAll('p')) {
    if (!/^(?:样例)?输入[：:]?$/.test(label.textContent.trim())) continue;
    const input = label.nextElementSibling;
    const outputLabel = input?.nextElementSibling;
    const output = outputLabel?.nextElementSibling;
    if (!input?.classList.contains('code-block') || outputLabel?.tagName !== 'P'
        || !/^(?:样例)?输出[：:]?$/.test(outputLabel.textContent.trim())
        || !output?.classList.contains('code-block')) continue;
    const samples = h('div', { class: 'problem-samples' });
    label.before(samples);
    samples.append(
      h('section', { class: 'problem-sample' }, h('h4', {}, '样例输入'), input),
      h('section', { class: 'problem-sample' }, h('h4', {}, '样例输出'), output));
    label.remove(); outputLabel.remove();
  }
}
