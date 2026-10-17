/* 题面代码块复制：只复制原始代码文本，保留换行，不包含按钮文字。 */
import { h, mount } from './dom.js';
import { icon } from './icons.js';
import { toast } from './components.js';

export async function copyCodeText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const previousFocus = document.activeElement;
  const control = h('textarea', { class: 'visually-hidden', readonly: true, value: text });
  document.body.append(control);
  try {
    control.select();
    if (!document.execCommand('copy')) throw new Error('Clipboard unavailable');
  } finally {
    control.remove();
    previousFocus?.focus({ preventScroll: true });
  }
}

export function attachCodeCopy(host) {
  for (const pre of host.querySelectorAll('pre')) {
    const code = pre.querySelector('code');
    if (!code || pre.closest('.code-block')) continue;
    const text = code.textContent;
    pre.tabIndex = 0;
    const block = h('div', { class: 'code-block' });
    const glyph = () => h('span', { class: 'code-copy-glyph', 'aria-hidden': 'true' });
    let resetTimer = null;
    const copy = h('button', { class: 'code-copy', type: 'button', title: '复制代码',
      'aria-label': '复制代码', onClick: async () => {
        copy.disabled = true;
        window.clearTimeout(resetTimer);
        try {
          await copyCodeText(text);
          copy.classList.add('copied');
          copy.setAttribute('aria-label', '已复制');
          copy.title = '已复制';
          mount(copy, icon('check'));
          toast('已复制到剪贴板', 'ok');
        } catch {
          toast('复制失败，请选择代码后手动复制。', 'error');
        } finally {
          copy.disabled = false;
          resetTimer = window.setTimeout(() => {
            copy.classList.remove('copied');
            copy.setAttribute('aria-label', '复制代码');
            copy.title = '复制代码';
            mount(copy, glyph());
          }, 1600);
        }
      } }, glyph());
    pre.before(block);
    block.append(pre, copy);
  }
}
