const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '../../app/static/js/graph/math.js');
const math = readFile(modulePath, 'utf8').then(source =>
  import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`));
const node = (id, domain_id = 'graph') => ({ id, name: id, domain_id });
const edge = (source, target) => ({ source, target, relation: 'prerequisite' });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

function assertSeparated(nodes) {
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      assert.ok(Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y) >= 80,
        `${nodes[i].id} overlaps ${nodes[j].id}`);
    }
  }
}

function cubicPoint(a, b, c, d, t) {
  const u = 1 - t;
  return { x: u ** 3 * a.x + 3 * u ** 2 * t * b.x + 3 * u * t ** 2 * c.x + t ** 3 * d.x,
    y: u ** 3 * a.y + 3 * u ** 2 * t * b.y + 3 * u * t ** 2 * c.y + t ** 3 * d.y };
}

function edgeCurvePoints(layout, edge) {
  const source = layout.nodes.find(n => n.id === edge.source);
  const target = layout.nodes.find(n => n.id === edge.target);
  const start = { x: source.x, y: source.y + source.radius + 3 };
  const end = { x: target.x, y: target.y - target.radius - 5 };
  const segments = [];
  if (Number.isFinite(edge.routeX)) {
    const escapeY = source.y + source.radius + 20;
    const approachY = target.y - target.radius - 20;
    const corner = Math.min(10, Math.max(0, (approachY - escapeY) / 2));
    const first = { x: edge.routeX, y: escapeY + corner };
    const last = { x: edge.routeX, y: approachY - corner };
    segments.push([start, { x: start.x, y: escapeY }, { x: edge.routeX, y: escapeY }, first]);
    segments.push([first, first, last, last]);
    segments.push([last, { x: edge.routeX, y: approachY }, { x: end.x, y: approachY }, end]);
  } else {
    const y = (start.y + end.y) / 2;
    segments.push([start, { x: start.x, y }, { x: end.x, y }, end]);
  }
  return segments.flatMap(segment => Array.from({ length: 129 }, (_, i) =>
    cubicPoint(...segment, i / 128)));
}

function assertEdgesAvoidNodes(layout) {
  for (const edge of layout.edges) {
    const points = edgeCurvePoints(layout, edge);
    const blockers = layout.nodes.filter(n => n.id !== edge.source && n.id !== edge.target);
    for (const point of points) {
      const blocked = blockers.find(n => Math.hypot(point.x - n.x, point.y - n.y) < n.radius + 3);
      assert.ok(!blocked, `${edge.source}→${edge.target} runs through ${blocked?.id}`);
    }
  }
}

async function realTaxonomyLeaves() {
  const taxonomy = JSON.parse(await readFile(path.resolve(__dirname,
    '../../data/knowledge_taxonomy.json'), 'utf8'));
  const byId = new Map(taxonomy.nodes.map(n => [n.id, n]));
  const parents = new Set(taxonomy.nodes.map(n => n.parent_id));
  return taxonomy.nodes.filter(n => !parents.has(n.id)).map(n => {
    let top = n;
    while (top.parent_id) top = byId.get(top.parent_id);
    return { ...n, domain_id: top.id, domain_name: top.name };
  });
}

test('tech tree preserves isolated nodes, cross-domain edges and immutable inputs', async () => {
  const { layoutTechTree } = await math;
  const nodes = [node('a'), node('b', 'math'), node('alone', 'syntax')];
  const edges = [edge('a', 'b')];
  const snapshot = JSON.stringify({ nodes, edges });
  const result = layoutTechTree(nodes, edges, 1100);
  assert.deepEqual(new Set(result.nodes.map(n => n.id)), new Set(['a', 'b', 'alone']));
  assert.deepEqual(result.edges, edges);
  assert.ok(result.nodes.every(n => n.radius === 34 && Number.isFinite(n.x + n.y)));
  assert.ok(result.groups.length >= 2);
  assert.equal(JSON.stringify({ nodes, edges }), snapshot);
  assertSeparated(result.nodes);
});

test('wide root ranks wrap before descendants, and every DAG edge points down', async () => {
  const { layoutTechTree } = await math;
  const roots = Array.from({ length: 33 }, (_, i) => node(`r${i}`));
  const nodes = [...roots, node('join'), node('end')];
  const edges = [...roots.map(n => edge(n.id, 'join')), edge('join', 'end')];
  for (const width of [320, 900, 1500]) {
    const result = layoutTechTree(nodes, edges, width);
    const byId = new Map(result.nodes.map(n => [n.id, n]));
    for (const e of edges) {
      assert.ok(byId.get(e.target).y - byId.get(e.source).y >= 100);
    }
    assert.ok(result.nodes.every(n => n.x >= 34 && n.x + 34 <= result.width));
    assert.ok(result.height > byId.get('end').y + 34);
    assertSeparated(result.nodes);
  }
});

test('tech tree uses longest prerequisite path and rejects impossible directed cycles', async () => {
  const { layoutTechTree } = await math;
  const result = layoutTechTree(['a', 'b', 'c', 'd'].map(id => node(id)),
    [edge('a', 'b'), edge('b', 'c'), edge('a', 'c'), edge('c', 'd')], 800);
  const byId = new Map(result.nodes.map(n => [n.id, n]));
  assert.ok(byId.get('c').y > byId.get('b').y);
  assert.throws(() => layoutTechTree([node('a'), node('b')],
    [edge('a', 'b'), edge('b', 'a')], 800), /cycl/i);
});

test('one-column prerequisite arrow detours around an unrelated intervening root', async () => {
  const { layoutTechTree } = await math;
  const layout = layoutTechTree([node('A'), node('B'), node('C')],
    [edge('A', 'C'), edge('B', 'C')], 272);
  assertEdgesAvoidNodes(layout);
});

test('real prerequisite curves avoid every non-endpoint circle at phone and desktop widths', async () => {
  const { layoutTechTree } = await math;
  const leaves = await realTaxonomyLeaves();
  const graph = JSON.parse(await readFile(path.resolve(__dirname,
    '../../data/knowledge_graph.json'), 'utf8'));
  const snapshot = JSON.stringify(graph.edges);
  for (const width of [272, 876, 1290]) {
    const layout = layoutTechTree(leaves, graph.edges, width);
    assert.equal(layout.nodes.length, 337);
    assert.equal(layout.edges.length, graph.edges.length);
    assertEdgesAvoidNodes(layout);
  }
  assert.equal(JSON.stringify(graph.edges), snapshot, 'route planning does not mutate original edges');
});

test('simulation starts deterministically, keeps all 337 nodes and does not mutate graph', async () => {
  const { createSimulation } = await math;
  const nodes = Array.from({ length: 337 }, (_, i) => node(`n${i}`, `d${i % 10}`));
  const edges = Array.from({ length: 300 }, (_, i) => edge(`n${i}`, `n${i + 1}`));
  const snapshot = JSON.stringify({ nodes, edges });
  const first = createSimulation(nodes, edges);
  const second = createSimulation(nodes, edges);
  assert.equal(new Set(first.nodes.map(n => n.id)).size, 337);
  assert.deepEqual(first.nodes, second.nodes);
  assert.equal(JSON.stringify({ nodes, edges }), snapshot);
  assertSeparated(first.nodes);
});

test('real 337-leaf domain clusters fit compactly and expose named enclosing groups', async () => {
  const { createSimulation, fitCamera } = await math;
  const leaves = await realTaxonomyLeaves();
  assert.equal(leaves.length, 337);
  const sim = createSimulation(leaves, []);
  assert.equal(sim.groups.length, 10);
  for (const group of sim.groups) {
    const members = sim.nodes.filter(n => n.domain_name === group.label);
    assert.ok(members.length > 0, 'group uses the Chinese domain_name');
    for (const n of members) {
      assert.ok(n.x - n.radius >= group.x && n.x + n.radius <= group.x + group.width);
      assert.ok(n.y - n.radius >= group.y && n.y + n.radius <= group.y + group.height);
    }
  }
  for (let i = 0; i < sim.groups.length; i++) {
    for (let j = i + 1; j < sim.groups.length; j++) {
      const a = sim.groups[i], b = sim.groups[j];
      assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x ||
        a.y + a.height <= b.y || b.y + b.height <= a.y, 'domain groups do not overlap');
    }
  }
  assertSeparated(sim.nodes);
  const minX = Math.min(...sim.nodes.map(n => n.x - n.radius));
  const minY = Math.min(...sim.nodes.map(n => n.y - n.radius));
  const worldWidth = Math.max(...sim.nodes.map(n => n.x + n.radius)) - minX;
  const worldHeight = Math.max(...sim.nodes.map(n => n.y + n.radius)) - minY;
  assert.ok(worldWidth <= 2700, `world width=${worldWidth}`);
  assert.ok(worldHeight <= 1750, `world height=${worldHeight}`);
  assert.ok(fitCamera(sim.nodes, 1280, 600).scale >= 0.26);
});

test('337-node physics remains finite through long steps and converges after disturbance', async () => {
  const { createSimulation, stepSimulation } = await math;
  const nodes = Array.from({ length: 337 }, (_, i) => node(`n${i}`, `d${i % 10}`));
  const edges = Array.from({ length: 300 }, (_, i) => edge(`n${i}`, `n${i + 1}`));
  const sim = createSimulation(nodes, edges);
  sim.nodes[0].vx = 900;
  let energy;
  for (let i = 0; i < 1000; i++) {
    energy = stepSimulation(sim, i === 10 ? 60 : 1 / 60);
    assert.ok(Number.isFinite(energy));
  }
  assert.ok(sim.nodes.every(n => [n.x, n.y, n.vx, n.vy].every(Number.isFinite)));
  assert.ok(energy < 0.05, `should settle, energy=${energy}`);
});

test('undisturbed simulation remains exactly still and long frames are clamped', async () => {
  const { createSimulation, stepSimulation } = await math;
  const nodes = [node('a'), node('b')];
  const edges = [edge('a', 'b')];
  const sim = createSimulation(nodes, edges);
  const positions = sim.nodes.map(n => [n.x, n.y]);
  for (let i = 0; i < 120; i++) assert.equal(stepSimulation(sim, 1 / 60), 0);
  assert.deepEqual(sim.nodes.map(n => [n.x, n.y]), positions);
  const normal = createSimulation(nodes, edges);
  const delayed = createSimulation(nodes, edges);
  normal.nodes[0].vx = delayed.nodes[0].vx = 700;
  stepSimulation(normal, 1 / 30);
  stepSimulation(delayed, 60);
  assert.deepEqual(delayed.nodes, normal.nodes);
});

test('dragged node stays at pointer, release inherits outward fling velocity', async () => {
  const { createSimulation, stepSimulation } = await math;
  const sim = createSimulation([node('a'), node('b')], [edge('a', 'b')]);
  const dragged = sim.nodes[0];
  dragged.x += 500;
  dragged.vx = 800;
  const x = dragged.x;
  const y = dragged.y;
  stepSimulation(sim, 1 / 60, { draggedId: 'a' });
  close(dragged.x, x);
  close(dragged.y, y);
  assert.equal(dragged.vx, 800);
  stepSimulation(sim, 1 / 60);
  assert.ok(dragged.x > x + 5, 'first released frame must retain fling direction');
});

test('collision separates coincident nodes without NaN or moving the dragged node', async () => {
  const { createSimulation, stepSimulation } = await math;
  const sim = createSimulation([node('a'), node('b')], []);
  sim.nodes[1].x = sim.nodes[0].x;
  sim.nodes[1].y = sim.nodes[0].y;
  const fixed = { x: sim.nodes[0].x, y: sim.nodes[0].y };
  for (let i = 0; i < 120; i++) stepSimulation(sim, 1 / 60, { draggedId: 'a' });
  close(sim.nodes[0].x, fixed.x);
  close(sim.nodes[0].y, fixed.y);
  assert.ok(Math.hypot(sim.nodes[0].x - sim.nodes[1].x,
    sim.nodes[0].y - sim.nodes[1].y) >= 68);
});

test('reduced motion freezes layout and stops inertial velocity', async () => {
  const { createSimulation, stepSimulation } = await math;
  const sim = createSimulation([node('a')], []);
  sim.nodes[0].vx = 500;
  const x = sim.nodes[0].x;
  assert.equal(stepSimulation(sim, 1 / 60, { reducedMotion: true }), 0);
  assert.equal(sim.nodes[0].x, x);
  assert.equal(sim.nodes[0].vx, 0);
});

test('invalid step and poisoned velocity never propagate non-finite coordinates', async () => {
  const { createSimulation, stepSimulation } = await math;
  const sim = createSimulation([node('a')], []);
  sim.nodes[0].vx = NaN;
  sim.nodes[0].x = Infinity;
  for (const dt of [NaN, Infinity, -1, 0, 100]) {
    assert.ok(Number.isFinite(stepSimulation(sim, dt)));
    assert.ok([sim.nodes[0].x, sim.nodes[0].y, sim.nodes[0].vx].every(Number.isFinite));
  }
});

test('camera fit contains full circles and stays finite for empty and zero-sized views', async () => {
  const { fitCamera } = await math;
  const nodes = [{ x: -500, y: -300, radius: 34 }, { x: 800, y: 500, radius: 34 }];
  const camera = fitCamera(nodes, 1000, 700, 72);
  for (const n of nodes) {
    assert.ok((n.x - 34) * camera.scale + camera.x >= 71.999);
    assert.ok((n.x + 34) * camera.scale + camera.x <= 928.001);
    assert.ok((n.y - 34) * camera.scale + camera.y >= 71.999);
    assert.ok((n.y + 34) * camera.scale + camera.y <= 628.001);
  }
  assert.ok(Object.values(fitCamera([], 0, 0)).every(Number.isFinite));
});

test('pointer-centered zoom preserves world anchor at both zoom limits', async () => {
  const { zoomCamera, screenToWorld } = await math;
  const camera = { x: -140, y: 83, scale: 0.7 };
  const point = { x: 345, y: 260 };
  const expected = screenToWorld(camera, point);
  for (const factor of [1.25, 0.01, 100]) {
    const next = zoomCamera(camera, factor, point);
    const actual = screenToWorld(next, point);
    close(actual.x, expected.x);
    close(actual.y, expected.y);
    assert.ok(next.scale >= 0.18 && next.scale <= 2.5);
  }
  assert.deepEqual(camera, { x: -140, y: 83, scale: 0.7 });
});
