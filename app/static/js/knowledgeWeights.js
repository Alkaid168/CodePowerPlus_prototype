import { h } from './dom.js';
import { difficultyColor } from './knowledgeWeightScale.js';

export function difficultyBadge(weight) {
  const color = difficultyColor(weight);
  if (!color) return null;
  const label = `难度权重：${color.name}色（${weight}/8）`;
  return h('span', {
    class: 'knowledge-difficulty', role: 'img', title: label, 'aria-label': label,
    dataset: { weight: String(weight) }, style: `--difficulty-color: ${color.hex}`,
  }, h('span', { class: 'knowledge-difficulty-core', 'aria-hidden': 'true' }));
}

export function importanceStars(weight) {
  if (!Number.isInteger(weight) || weight < 1 || weight > 5) return null;
  return h('span', {
    class: 'knowledge-importance', role: 'img', title: `重要权重：${weight}/5`,
    'aria-label': `重要度：${weight}星`, dataset: { weight: String(weight) },
  }, h('span', { class: 'knowledge-importance-label', 'aria-hidden': 'true' }, '重要度：'),
  h('span', { class: 'knowledge-stars', 'aria-hidden': 'true' },
    Array.from({ length: weight }, () => h('span', { class: 'knowledge-star' }))));
}

export function knowledgeTitle(node, { titleClass = '' } = {}) {
  return h('div', { class: 'knowledge-title-row' },
    h('h2', { class: titleClass },
      h('span', { class: 'knowledge-title-name' }, node.name), difficultyBadge(node.difficulty_weight)),
    importanceStars(node.importance_weight));
}
