/* Markdown + LaTeX 渲染。

题面是用户自己录入的 Markdown，必须能渲染成题面样式而不是代码块，所以这里做了三件事：
1. 用 marked 解析 Markdown，但把原生 HTML 全部转义（renderer.html），链接只允许 http(s)，
   相当于把 h() 的安全边界搬到 Markdown 上；
2. 解析前先把数学公式抽成占位符，避免 MathJax 的 $..$ 和 Markdown 的 _ * 互相破坏；
3. 只在真的出现公式时才按需加载 MathJax（2MB），并跳过 code/pre 里的 $ 符号。

挂载字符串生成的 HTML 需要 createContextualFragment；这是本项目唯一允许的例外，
因为 Markdown 必须由解析器产出 HTML，而上面的转义保证了它不包含任何用户 HTML。
*/
import { marked } from '../vendor/marked.esm.js';

const MATHJAX_SRC = '/static/vendor/tex-svg.js';
const PLACEHOLDER = (index) => `xMATHTOKENx${index}xENDx`;
const PLACEHOLDER_RE = /xMATHTOKENx(\d+)xENDx/g;

// 代码区在前、公式在后：先匹配到的优先，保证代码里的 $ 不会被当成公式。
const TOKEN_RE = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)|(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$[^$\n]+?\$)/g;

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ESCAPES[character]);
}

/** 只放行 http(s)：题面里的 javascript: / data: 链接不能变成可点击入口。 */
export function safeUrl(value) {
  const text = String(value ?? '').trim();
  return /^https?:\/\//i.test(text) ? text : '';
}

function createRenderer() {
  // marked 12 的 Renderer 方法接收字符串（如 html(html, block)），不是 token 对象。
  const renderer = new marked.Renderer();
  // Markdown 里的原生 HTML 一律当纯文本，杜绝题面注入。
  renderer.html = (html) => escapeHtml(html);
  renderer.link = (href, title, text) => {
    const target = safeUrl(href);
    if (!target) return text;
    const attrs = [`href="${escapeHtml(target)}"`, 'target="_blank"', 'rel="noopener noreferrer"'];
    if (title) attrs.push(`title="${escapeHtml(title)}"`);
    return `<a ${attrs.join(' ')}>${text}</a>`;
  };
  renderer.image = (href, title, text) => {
    const src = safeUrl(href);
    if (!src) return escapeHtml(text || '');
    const attrs = [`src="${escapeHtml(src)}"`, `alt="${escapeHtml(text || '')}"`, 'loading="lazy"'];
    if (title) attrs.push(`title="${escapeHtml(title)}"`);
    return `<img ${attrs.join(' ')}>`;
  };
  return renderer;
}

marked.setOptions({ gfm: true, breaks: false, renderer: createRenderer() });

/** 抽出公式并换成占位符，返回替换后的文本与公式原文。 */
export function extractMath(source) {
  const formulas = [];
  const text = String(source ?? '').replace(TOKEN_RE, (match, code, math) => {
    if (code || !math) return match;
    formulas.push(math);
    return PLACEHOLDER(formulas.length - 1);
  });
  return { text, formulas };
}

/** Markdown → DocumentFragment；公式先以原文放回，由 MathJax 负责排版。 */
export function renderMarkdown(source) {
  const { text, formulas } = extractMath(source);
  const html = marked.parse(text).replace(PLACEHOLDER_RE,
    (_, index) => escapeHtml(formulas[Number(index)] ?? ''));
  const range = document.createRange();
  range.selectNode(document.body);
  return range.createContextualFragment(html);
}

let mathJaxPromise = null;

/** 按需加载 MathJax；失败不影响题面文本渲染。 */
export function loadMathJax() {
  if (mathJaxPromise) return mathJaxPromise;
  mathJaxPromise = new Promise((resolve, reject) => {
    window.MathJax = {
      tex: {
        inlineMath: [['$', '$'], ['\\(', '\\)']],
        displayMath: [['$$', '$$'], ['\\[', '\\]']],
        processEscapes: true,
      },
      svg: { fontCache: 'global' },
      options: { skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'] },
      startup: { typeset: false },
    };
    const script = document.createElement('script');
    script.src = MATHJAX_SRC;
    script.async = true;
    script.onload = () => {
      const startup = window.MathJax?.startup?.promise;
      if (startup) startup.then(() => resolve(window.MathJax)).catch(reject);
      else reject(new Error('MathJax 未正确初始化'));
    };
    script.onerror = () => reject(new Error('MathJax 资源加载失败'));
    document.head.append(script);
  }).catch((error) => {
    mathJaxPromise = null;
    throw error;
  });
  return mathJaxPromise;
}

export function hasMath(source) {
  return extractMath(source).formulas.length > 0;
}

/**
 * 把 Markdown 渲染进容器，并在需要时排版公式。
 * 返回 { mathRendered }，方便界面提示“公式引擎加载失败”而不阻断阅读。
 */
export async function mountMarkdown(host, source) {
  host.replaceChildren(renderMarkdown(source));
  if (!hasMath(source)) return { mathRendered: false };
  try {
    const MathJax = await loadMathJax();
    await MathJax.typesetPromise([host]);
    return { mathRendered: true };
  } catch {
    return { mathRendered: false };
  }
}
