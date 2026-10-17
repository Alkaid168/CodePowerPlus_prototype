/* 一级领域的几何线稿：统一 240×160 画布，黑色主线、细辅助线，保留经典算法的可读结构。 */
const SVG_NS = 'http://www.w3.org/2000/svg';
const WHITE = '#ffffff';
const FINE = { 'stroke-width': 1, 'stroke-opacity': .3 };

const line = (x1, y1, x2, y2, extra = {}) => ['line', { x1, y1, x2, y2, ...extra }];
const path = (d, extra = {}) => ['path', { d, ...extra }];
const circle = (cx, cy, r, extra = {}) => ['circle', { cx, cy, r, ...extra }];
const rect = (x, y, width, height, extra = {}) => ['rect', { x, y, width, height, ...extra }];
const polygon = (points, extra = {}) => ['polygon', { points, ...extra }];
const text = (x, y, value, extra = {}) => ['text', {
  x, y, fill: 'currentColor', stroke: 'none', 'font-size': 11, 'font-weight': 500,
  'font-family': 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  'text-anchor': 'middle', 'dominant-baseline': 'central', ...extra,
}, value];

function node(x, y, value, extra = {}) {
  return [circle(x, y, 10, { fill: WHITE, ...extra }), text(x, y + .5, value)];
}

function sortingColumns() {
  const heights = [24, 42, 60, 78, 96];
  return [
    line(38, 122, 202, 122, FINE),
    ...heights.flatMap((height, index) => [
      rect(46 + index * 32, 122 - height, 20, height, { rx: 3 }),
      text(56 + index * 32, 140, index + 1, { 'font-size': 10 }),
    ]),
    path('M46 15H191M186 11L191 15L186 19', { 'stroke-width': 1.2 }),
  ];
}

function codeTerminal() {
  const code = { 'text-anchor': 'start', 'font-size': 11 };
  return [
    rect(30, 22, 180, 116, { rx: 5 }),
    line(30, 47, 210, 47, FINE),
    text(44, 35, 'main.c', { ...code, 'font-size': 10, opacity: .55 }),
    text(45, 65, 'int main(void) {', code),
    text(57, 84, 'printf("Hi");', code),
    text(45, 103, '}', code),
    line(30, 114, 210, 114, FINE),
    path('M43 122L47 126L43 130', { 'stroke-width': 1.2 }),
    text(57, 126, 'Hi', { ...code, 'font-size': 10 }),
  ];
}

function queensBoard() {
  const shapes = [rect(52, 12, 136, 136, { rx: 3 }), rect(56, 16, 128, 128, FINE)];
  for (let i = 1; i < 8; i++) {
    shapes.push(line(56 + i * 16, 16, 56 + i * 16, 144, FINE),
      line(56, 16 + i * 16, 184, 16 + i * 16, FINE));
  }
  // 一个有效的八皇后摆放；小冠用相同轮廓，避免细节挤在格子里。
  [0, 4, 7, 5, 2, 6, 1, 3].forEach((column, row) => {
    const x = 64 + column * 16;
    const y = 24 + row * 16;
    shapes.push(path(`M${x - 5} ${y - 3}L${x - 3} ${y + 3}H${x + 3}L${x + 5} ${y - 3}`
      + `L${x + 2} ${y - 1}L${x} ${y - 5}L${x - 2} ${y - 1}Z`,
    { fill: WHITE, 'stroke-width': 1.1 }), line(x - 3, y + 5, x + 3, y + 5, { 'stroke-width': 1.1 }));
  });
  return shapes;
}

function numberTriangle() {
  const rows = [[7], [3, 8], [8, 1, 0], [2, 7, 4, 4], [4, 5, 2, 6, 5]];
  const position = (row, col) => [120 + (col - row / 2) * 38, 18 + row * 30];
  const shapes = [];
  rows.slice(0, -1).forEach((values, row) => values.forEach((_, col) => {
    const [x, y] = position(row, col);
    for (const child of [col, col + 1]) shapes.push(line(x, y, ...position(row + 1, child), FINE));
  }));
  const bestPath = [0, 0, 0, 1, 1];
  for (let row = 0; row < 4; row++) {
    shapes.push(line(...position(row, bestPath[row]), ...position(row + 1, bestPath[row + 1]),
      { 'stroke-width': 2.4 }));
  }
  rows.forEach((values, row) => values.forEach((value, col) => {
    const [x, y] = position(row, col);
    shapes.push(...node(x, y, value, { 'stroke-width': col === bestPath[row] ? 1.8 : 1,
      'stroke-opacity': col === bestPath[row] ? 1 : .45 }));
  }));
  return shapes;
}

function letterTrie() {
  const points = [[120, 20, ''], [76, 58, 'C'], [164, 58, 'D'], [76, 96, 'A'],
    [164, 96, 'O'], [56, 134, 'R'], [96, 134, 'T'], [164, 134, 'G']];
  const shapes = [[0, 1], [0, 2], [1, 3], [2, 4], [3, 5], [3, 6], [4, 7]]
    .map(([a, b]) => line(...points[a].slice(0, 2), ...points[b].slice(0, 2), { 'stroke-width': 1.2 }));
  points.forEach(([x, y, value], index) => {
    shapes.push(...node(x, y, value));
    if (index >= 5) shapes.push(circle(x, y, 13, { 'stroke-width': .7 }));
  });
  return shapes;
}

function unitCircle() {
  return [
    path('M36 82H207M202 78L207 82L202 86M112 137V12M108 17L112 12L116 17', FINE),
    circle(112, 82, 48),
    path('M112 82L150.4 53.2V82Z', { 'stroke-width': 1.3 }),
    path('M137 82A25 25 0 0 0 132 67', { 'stroke-width': 1.1 }),
    path('M143 82V75H150.4', { 'stroke-width': .9 }),
    circle(150.4, 53.2, 2.5, { fill: 'currentColor', stroke: 'none' }),
    text(165, 47, '(x,y)', { 'font-size': 10 }), text(129, 75, 'θ', { 'font-size': 10 }),
    text(131, 58, 'r', { 'font-size': 10 }), text(112, 150, 'x² + y² = r²', { 'font-size': 10 }),
  ];
}

function binaryTree() {
  const positions = [[120, 24], [76, 68], [164, 68], [48, 116], [104, 116], [136, 116], [192, 116]];
  const values = [4, 2, 6, 1, 3, 5, 7];
  return [
    ...[[0, 1], [0, 2], [1, 3], [1, 4], [2, 5], [2, 6]]
      .map(([a, b]) => line(...positions[a], ...positions[b], { 'stroke-width': 1.2 })),
    ...positions.flatMap(([x, y], index) => node(x, y, values[index])),
    path('M38 137H202', FINE),
    ...[48, 104, 136, 192].map(x => line(x, 133, x, 141, FINE)),
  ];
}

function weightedGraph() {
  const positions = [[34, 80], [88, 30], [88, 130], [152, 30], [152, 130], [206, 80]];
  const shapes = [[0, 1], [0, 2], [1, 2], [1, 3], [2, 4], [3, 4], [3, 5], [4, 5], [1, 4]]
    .map(([a, b]) => line(...positions[a], ...positions[b], FINE));
  shapes.push(path('M34 80L88 30H152L206 80', { 'stroke-width': 2.4 }));
  shapes.push(...positions.flatMap(([x, y], index) => node(x, y, index === 0 ? 's' : index === 5 ? 't' : '')));
  for (const [x, y, value] of [[57, 46, 2], [120, 21, 3], [183, 46, 1], [120, 142, 7]]) {
    shapes.push(text(x, y, value, { 'font-size': 10 }));
  }
  return shapes;
}

function geometricHull() {
  const hull = [[42, 112], [60, 48], [126, 20], [190, 62], [200, 116], [112, 140]];
  return [
    line(28, 144, 216, 144, FINE), line(28, 144, 28, 12, FINE),
    line(42, 112, 126, 20, { ...FINE, 'stroke-dasharray': '3 4' }),
    line(126, 20, 200, 116, { ...FINE, 'stroke-dasharray': '3 4' }),
    polygon(hull.map(point => point.join(',')).join(' ')),
    ...[[86, 68], [128, 72], [74, 102], [146, 104], [112, 112], [166, 84]]
      .map(([x, y]) => circle(x, y, 2, { fill: 'currentColor', stroke: 'none' })),
    ...hull.map(([x, y]) => circle(x, y, 3, { fill: WHITE, 'stroke-width': 1.3 })),
  ];
}

function slidingWindow() {
  const shapes = [rect(26, 61, 188, 36, { rx: 3, 'stroke-width': 1.2 })];
  for (let i = 1; i < 8; i++) shapes.push(line(26 + i * 23.5, 61, 26 + i * 23.5, 97, FINE));
  shapes.push(rect(73, 61, 94, 36, { 'stroke-width': 2 }));
  [1, 3, 4, 7, 9, 12, 15, 19].forEach((value, i) => shapes.push(text(37.75 + i * 23.5, 79, value)));
  shapes.push(path('M84.75 52V30M80.75 48L84.75 52L88.75 48M155.25 106V128'
    + 'M151.25 110L155.25 106L159.25 110', { 'stroke-width': 1.4 }),
  text(84.75, 20, 'L', { 'font-size': 10 }), text(155.25, 139, 'R', { 'font-size': 10 }),
  path('M104 39H144M139 35L144 39L139 43', FINE));
  return shapes;
}

const DRAWINGS = {
  'syntax': codeTerminal(),
  'basic': sortingColumns(),
  'search': queensBoard(),
  'dp': numberTriangle(),
  'string': letterTrie(),
  'math': unitCircle(),
  'ds': binaryTree(),
  'graph': weightedGraph(),
  'geometry': geometricHull(),
  'misc': slidingWindow(),
};

export function knowledgeIllustration(id, { label = '', className = '' } = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  const attributes = { viewBox: '0 0 240 160', fill: 'none', stroke: 'currentColor',
    'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', role: 'img',
    'aria-label': label || '知识示意图', class: ['knowledge-illustration', className].filter(Boolean).join(' ') };
  for (const [key, value] of Object.entries(attributes)) svg.setAttribute(key, value);
  for (const [tag, attributes, value] of DRAWINGS[id] || DRAWINGS.ds) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, attribute] of Object.entries(attributes)) node.setAttribute(key, String(attribute));
    if (value !== undefined) node.textContent = value;
    svg.append(node);
  }
  return svg;
}
