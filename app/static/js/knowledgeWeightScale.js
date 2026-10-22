/* Numeric content scale shared by detail badges and Canvas node halos. */
export const DIFFICULTY_COLORS = Object.freeze([
  null,
  Object.freeze({ name: '红', hex: '#ef495d', rgb: '239,73,93' }),
  Object.freeze({ name: '橙', hex: '#ef9319', rgb: '239,147,25' }),
  Object.freeze({ name: '黄', hex: '#e9b91b', rgb: '233,185,27' }),
  Object.freeze({ name: '绿', hex: '#52ad43', rgb: '82,173,67' }),
  Object.freeze({ name: '青', hex: '#20b7b7', rgb: '32,183,183' }),
  Object.freeze({ name: '蓝', hex: '#438bd6', rgb: '67,139,214' }),
  Object.freeze({ name: '紫', hex: '#9960c8', rgb: '153,96,200' }),
  Object.freeze({ name: '黑', hex: '#202124', rgb: '32,33,36' }),
]);

export function difficultyColor(weight) {
  return Number.isInteger(weight) ? DIFFICULTY_COLORS[weight] || null : null;
}
