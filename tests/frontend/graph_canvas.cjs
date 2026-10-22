/* Exercise real gesture methods without creating a browser or substituting the camera math. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const toModule = content => `data:text/javascript;base64,${Buffer.from(content).toString('base64')}`;
const mathUrl = toModule(fs.readFileSync('app/static/js/graph/math.js', 'utf8'));
const scaleUrl = toModule(fs.readFileSync('app/static/js/knowledgeWeightScale.js', 'utf8'));
const canvasUrl = toModule(fs.readFileSync('app/static/js/graph/canvas.js', 'utf8')
  .replace("from './math.js'", `from '${mathUrl}'`)
  .replace("from '../knowledgeWeightScale.js'", `from '${scaleUrl}'`));

async function scene() {
  const { GraphCanvas } = await import(canvasUrl);
  const captures = new Set();
  return Object.assign(Object.create(GraphCanvas.prototype), {
    mode: 'force', camera: { x: 0, y: 0, scale: 1 },
    cameraVelocity: { x: 0, y: 0 }, pointers: new Map(), drag: null, pinch: null,
    selectedId: null, hoverId: null, related: new Set(), paused: false, reducedMotion: false,
    sim: { nodes: [], edges: [] }, data: { nodes: [], edges: [] },
    onSelect() {}, requestDraw() {}, changed() {},
    canvas: {
      style: {}, focus() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }),
      setPointerCapture: id => captures.add(id),
      hasPointerCapture: id => captures.has(id),
      releasePointerCapture: id => captures.delete(id),
    },
  });
}

const pointer = (id, x, y, time) => ({
  pointerId: id, pointerType: 'touch', button: 0, clientX: x, clientY: y,
  timeStamp: time, preventDefault() {},
});

test('lifting either finger after pinch continues panning with the remaining finger', async () => {
  for (const lifted of [1, 2]) {
    const controller = await scene();
    controller.pointerDown(pointer(1, 100, 100, 0));
    controller.pointerDown(pointer(2, 200, 100, 10));
    controller.pointerMove(pointer(2, 240, 100, 20));
    assert.equal(controller.camera.scale, 1.4);
    controller.pointerUp(pointer(lifted, lifted === 1 ? 100 : 240, 100, 30));
    const before = { ...controller.camera };
    const remaining = lifted === 1 ? 2 : 1;
    const x = remaining === 1 ? 100 : 240;
    controller.pointerMove(pointer(remaining, x + 40, 120, 50));
    assert.equal(controller.camera.x, before.x + 40);
    assert.equal(controller.camera.y, before.y + 20);
    assert.equal(controller.camera.scale, before.scale);
    assert.equal(controller.drag.node, null, 'pinch continuation pans instead of grabbing a random node');
  }
});

test('pointer cancellation releases capture and never launches camera inertia', async () => {
  const controller = await scene();
  controller.pointerDown(pointer(1, 100, 100, 0));
  controller.pointerMove(pointer(1, 150, 100, 20));
  controller.pointerUp(pointer(1, 150, 100, 25), true);
  assert.equal(controller.pointers.size, 0);
  assert.equal(controller.drag, null);
  assert.equal(controller.canvas.hasPointerCapture(1), false);
  assert.equal(controller.cameraVelocity.x, 0);
  assert.equal(controller.cameraVelocity.y, 0);
});

test('search focus keeps the whole node left of the side inspector at intermediate widths', async () => {
  for (const width of [521, 540, 620, 799, 800, 1000]) {
    const controller = await scene();
    const node = { id: 'selected', x: 400, y: 300, radius: 34 };
    Object.assign(controller, {
      width, height: 600, sim: { nodes: [node] }, data: { nodes: [node], edges: [] },
    });
    controller.focusNode(node.id);
    const center = node.x * controller.camera.scale + controller.camera.x;
    const radius = node.radius * controller.camera.scale;
    // Conservative desktop side panel: 284px wide, 18px from the right edge.
    // Narrow outer viewports use a smaller panel, so this bounds both variants.
    assert.ok(center - radius > 0, `focused node stays inside canvas width ${width}`);
    assert.ok(center + radius < width - 284 - 18,
      `focused node must not be covered by the side inspector at width ${width}`);
  }
});
