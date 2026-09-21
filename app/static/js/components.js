/* 共享组件：所有页面用同一套按钮、卡片、标签、表格与提示。 */
import { h } from './dom.js';
import { icon } from './icons.js';

export const STATUS_LABEL = { pending: '待审核', approved: '已通过', rejected: '已驳回', legacy: '旧版未迁移' };

export function button(label, { variant = '', iconName = '', onClick, type = 'button', disabled = false,
  small = false, title = '' } = {}) {
  const classes = ['btn', variant, small ? 'small' : ''].filter(Boolean).join(' ');
  return h('button', {
    type, class: classes, disabled, title: title || label || '', 'aria-label': title || label || '',
    onClick,
  }, iconName ? icon(iconName) : null, label ? h('span', {}, label) : null);
}

export function card({ title = '', actions = null, className = '' } = {}, ...children) {
  return h('section', { class: ['card', className].filter(Boolean).join(' ') },
    (title || actions) ? h('div', { class: 'card-head' },
      title ? h('h2', {}, title) : h('span', {}),
      actions || null) : null,
    ...children);
}

export function tile(label, value, foot = '') {
  return h('div', { class: 'card tile' },
    h('div', { class: 'tile-label' }, label),
    h('div', { class: 'tile-value' }, String(value)),
    foot ? h('div', { class: 'tile-foot' }, foot) : null);
}

export function tag(text, kind = '', { onClick, title = '' } = {}) {
  const className = ['tag', kind].filter(Boolean).join(' ');
  if (!onClick) return h('span', { class: className, title: title || text }, text);
  return h('span', { class: className }, h('button', { type: 'button', onClick, title: title || text }, text));
}

export function statusBadge(status) {
  return h('span', { class: `badge ${status || 'muted'}` }, STATUS_LABEL[status] || status || '未知');
}

export function verdictBadge(verdict) {
  const kind = verdict === 'AC' ? 'approved' : (verdict === 'CE' ? 'muted' : 'rejected');
  return h('span', { class: `badge ${kind}` }, verdict);
}

/** 难度只显示 Codeforces 风格的 800–3500 评分，档位名作为补充。 */
export function difficultyTag(rating, band = '') {
  if (rating === null || rating === undefined) return h('span', { class: 'tag' }, '未评估');
  const text = band ? `${rating} · ${band}` : String(rating);
  return h('span', { class: 'tag difficulty', title: `Codeforces 风格评分 ${rating}` }, text);
}

export function sourceLink(sourceUrl, label = '') {
  if (!sourceUrl) return null;
  return h('a', { class: 'source-link', href: sourceUrl, target: '_blank', rel: 'noopener noreferrer',
    title: sourceUrl }, icon('external-link'), h('span', {}, label || sourceHost(sourceUrl)));
}

export function sourceHost(sourceUrl) {
  try {
    return new URL(sourceUrl).host.replace(/^www\./, '');
  } catch {
    return sourceUrl;
  }
}

export function table(headers, rows) {
  return h('table', { class: 'table' },
    h('thead', {}, h('tr', {}, headers.map((header) => h('th', {}, header)))),
    h('tbody', {}, rows.map((cells) => h('tr', {}, cells.map((cell) => h('td', {}, cell))))));
}

export function emptyState(message, action = null) {
  return h('div', { class: 'empty' }, h('p', {}, message), action ? h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '10px' } }, action) : null);
}

export function loading(message = '正在加载…') {
  return h('div', { class: 'empty row', style: { justifyContent: 'center', gap: '10px' } },
    h('span', { class: 'spinner' }), h('span', {}, message));
}

export function notice(message, kind = '') {
  return h('div', { class: ['notice', kind].filter(Boolean).join(' ') }, message);
}

export function errorBox(error, retry = null) {
  return h('div', { class: 'notice danger row' },
    h('span', {}, error?.message || '请求失败'),
    retry ? button('重试', { variant: 'secondary', small: true, iconName: 'refresh-cw', onClick: retry }) : null);
}

export function progress(value) {
  const percent = value === null || value === undefined ? null : Math.round(value * 100);
  const kind = percent === null ? '' : (value >= 0.75 ? 'ok' : value < 0.4 ? 'warn' : '');
  return h('div', { class: 'row', style: { gap: '8px' } },
    h('div', { class: `bar ${kind}`, style: { flex: '1' } },
      h('i', { style: { width: `${percent ?? 0}%` } })),
    h('span', { class: 'mono nowrap' }, percent === null ? '无证据' : `${percent}%`));
}

export function field(label, control, hint = '') {
  return h('div', { class: 'field' },
    h('label', { class: 'field-label', for: control.id || undefined }, label),
    control,
    hint ? h('p', { class: 'hint' }, hint) : null);
}

export function formatPercent(value) {
  return value === null || value === undefined ? '未知' : `${Math.round(value * 100)}%`;
}

export function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

export function toast(message, kind = '') {
  const container = document.getElementById('toasts');
  if (!container) return;
  const node = h('div', { class: ['toast', kind].filter(Boolean).join(' ') }, message);
  container.append(node);
  setTimeout(() => node.remove(), 4200);
}
