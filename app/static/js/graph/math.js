// Pure geometry: no DOM, global animation loop, network, or external dependency.
const RADIUS = 34;
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const compareIds = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const domain = node => String(node.domain_id || '');

function graphCopy(inputNodes, inputEdges) {
  const nodes = inputNodes.map(node => ({ ...node, id: String(node.id), radius: RADIUS }));
  const byId = new Map(nodes.map(node => [node.id, node]));
  if (byId.size !== nodes.length) throw new Error('Graph node IDs must be unique');
  const edges = inputEdges.map(edge => ({
    ...edge, source: String(edge.source), target: String(edge.target),
  }));
  for (const edge of edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) {
      throw new Error(`Graph edge references missing node: ${edge.source} → ${edge.target}`);
    }
  }
  const neighbors = new Map(nodes.map(node => [node.id, []]));
  for (const edge of edges) {
    neighbors.get(edge.source).push(edge.target);
    neighbors.get(edge.target).push(edge.source);
  }
  return { nodes, edges, byId, neighbors };
}

function connectedComponents(graph) {
  const seen = new Set();
  const components = [];
  for (const first of [...graph.nodes].sort(compareIds)) {
    if (seen.has(first.id)) continue;
    const component = [first];
    seen.add(first.id);
    for (let i = 0; i < component.length; i++) {
      for (const id of graph.neighbors.get(component[i].id)) {
        if (seen.has(id)) continue;
        seen.add(id);
        component.push(graph.byId.get(id));
      }
    }
    components.push(component);
  }
  return components;
}

function compactDomainBlocks(domains) {
  const pitch = 92;
  const rowPitch = pitch * Math.sqrt(3) / 2;
  let best;
  // Ten domain rectangles are cheap to pack several ways. Choose the shape
  // closest to the intended wide canvas instead of giving tiny domains the
  // footprint of the largest one.
  for (const aspect of [0.85, 1, 1.2, 1.45, 1.7, 2]) {
    const blocks = [...domains.entries()].map(([key, nodes]) => {
      const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length * aspect)));
      const rows = Math.ceil(nodes.length / columns);
      return { key, nodes, columns, rows,
        width: (columns - 1) * pitch + (rows > 1 ? pitch / 2 : 0) + 108,
        height: (rows - 1) * rowPitch + 148 };
    }).sort((a, b) => b.height - a.height || b.width - a.width ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    for (const targetWidth of [2200, 2400, 2500, 2600, 2700]) {
      const placed = [];
      for (const block of blocks) {
        const candidates = new Set([0, Math.max(0, targetWidth - block.width)]);
        for (const other of placed) {
          candidates.add(other.x);
          candidates.add(other.x + other.width + 20);
          candidates.add(other.x - block.width - 20);
        }
        let position;
        for (const x of candidates) {
          if (x < 0 || (x + block.width > targetWidth && x > 0)) continue;
          let y = 0;
          for (const other of placed) {
            if (x < other.x + other.width + 20 && x + block.width + 20 > other.x) {
              y = Math.max(y, other.y + other.height + 20);
            }
          }
          if (!position || y < position.y || (y === position.y && x < position.x)) {
            position = { x, y };
          }
        }
        placed.push({ ...block, ...position });
      }
      const width = Math.max(0, ...placed.map(block => block.x + block.width));
      const height = Math.max(0, ...placed.map(block => block.y + block.height));
      const score = Math.max(width / 2500, height / 1600) + width * height / 1e9;
      if (!best || score < best.score) best = { blocks: placed, score };
    }
  }
  return { blocks: best.blocks, pitch, rowPitch };
}

function stableJitter(id, seed) {
  let hash = seed;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return ((hash >>> 0) % 1000 / 999 - 0.5) * 2.4;
}

/**
 * Deterministic compact domain clusters. Within a domain, breadth-first
 * neighbors occupy adjacent cells; untouched initial layouts remain at rest.
 * Positions and velocities are world pixels and world pixels per second.
 */
export function createSimulation(inputNodes, inputEdges) {
  const graph = graphCopy(inputNodes, inputEdges);
  const domains = new Map();
  for (const node of [...graph.nodes].sort(compareIds)) {
    const key = domain(node);
    if (!domains.has(key)) domains.set(key, []);
    domains.get(key).push(node);
  }
  const { blocks, pitch, rowPitch } = compactDomainBlocks(domains);
  const groups = [];
  for (const block of blocks) {
    const list = block.nodes;
    const available = new Set(list.map(node => node.id));
    const ordered = [];
    for (const first of list) {
      if (!available.delete(first.id)) continue;
      const queue = [first];
      for (let q = 0; q < queue.length; q++) {
        const node = queue[q];
        ordered.push(node);
        const neighbors = [...graph.neighbors.get(node.id)].sort();
        for (const id of neighbors) {
          if (available.delete(id)) queue.push(graph.byId.get(id));
        }
      }
    }
    ordered.forEach((node, i) => {
      const row = Math.floor(i / block.columns);
      const x = block.x + 54 + (i % block.columns) * pitch +
        (row % 2) * pitch / 2 + stableJitter(node.id, 2166136261);
      const y = block.y + 90 + row * rowPitch + stableJitter(node.id, 16843009);
      Object.assign(node, { x, y, vx: 0, vy: 0, anchorX: x, anchorY: y });
    });
    groups.push({ label: list[0].domain_name || block.key || '知识点',
      x: block.x, y: block.y, width: block.width, height: block.height });
  }
  const springs = graph.edges.map(edge => {
    const source = graph.byId.get(edge.source);
    const target = graph.byId.get(edge.target);
    return { source, target, length: Math.hypot(target.x - source.x, target.y - source.y) };
  });
  return { nodes: graph.nodes, edges: graph.edges, springs, groups };
}

/**
 * Semi-implicit damped springs, bounded timestep and a spatial collision grid.
 * The caller owns pointer updates, fling velocity and requestAnimationFrame.
 * Returns total squared velocity; zero means it is safe to stop scheduling.
 */
export function stepSimulation(sim, dtSeconds, { draggedId = null, reducedMotion = false } = {}) {
  const dt = clamp(finite(dtSeconds), 0, 1 / 30);
  const fixed = draggedId === null ? null : String(draggedId);
  for (const node of sim.nodes) {
    node.anchorX = finite(node.anchorX);
    node.anchorY = finite(node.anchorY);
    node.x = finite(node.x, node.anchorX);
    node.y = finite(node.y, node.anchorY);
    node.vx = clamp(finite(node.vx), -1800, 1800);
    node.vy = clamp(finite(node.vy), -1800, 1800);
    if (node.id === fixed) {
      // The user establishes a new resting position instead of being snapped back.
      node.anchorX = node.x;
      node.anchorY = node.y;
    }
    if (reducedMotion) node.vx = node.vy = 0;
  }
  if (reducedMotion) return 0;
  if (!dt) return sim.nodes.reduce((energy, node) => energy + node.vx ** 2 + node.vy ** 2, 0);

  for (const spring of sim.springs) {
    const { source, target, length } = spring;
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 0.001) continue;
    // Bounded acceleration lets a large pointer fling continue in its direction.
    const force = clamp((distance - length) * 1.8, -360, 360);
    const fx = dx / distance * force * dt;
    const fy = dy / distance * force * dt;
    if (source.id !== fixed) { source.vx += fx; source.vy += fy; }
    if (target.id !== fixed) { target.vx -= fx; target.vy -= fy; }
  }
  const damping = Math.exp(-3.2 * dt);
  for (const node of sim.nodes) {
    if (node.id === fixed) continue;
    node.vx = (node.vx + clamp((node.anchorX - node.x) * 1.2, -200, 200) * dt) * damping;
    node.vy = (node.vy + clamp((node.anchorY - node.y) * 1.2, -200, 200) * dt) * damping;
    node.x += node.vx * dt;
    node.y += node.vy * dt;
  }

  // Only nearby circles participate, keeping typical 337-node frames O(V + E).
  const cells = new Map();
  const spacing = RADIUS * 2 + 18;
  for (const node of sim.nodes) {
    const cx = Math.floor(node.x / spacing);
    const cy = Math.floor(node.y / spacing);
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        for (const other of cells.get(`${cx + ox},${cy + oy}`) || []) {
          let dx = node.x - other.x;
          let dy = node.y - other.y;
          let distance = Math.hypot(dx, dy);
          if (distance >= spacing) continue;
          if (distance < 0.001) { dx = 1; dy = 0; distance = 1; }
          const correction = (spacing - distance) * 0.8;
          const share = node.id === fixed || other.id === fixed ? 1 : 0.5;
          const px = dx / distance * correction * share;
          const py = dy / distance * correction * share;
          if (node.id !== fixed) { node.x += px; node.y += py; }
          if (other.id !== fixed) { other.x -= px; other.y -= py; }
        }
      }
    }
    const key = `${cx},${cy}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(node);
  }
  let energy = 0;
  for (const node of sim.nodes) {
    if (node.id === fixed) continue;
    if (Math.abs(node.vx) < 0.006) node.vx = 0;
    if (Math.abs(node.vy) < 0.006) node.vy = 0;
    energy += node.vx * node.vx + node.vy * node.vy;
  }
  return energy;
}

function curveTouchesCircle(points, node, depth = 0) {
  // A cubic lies inside its control polygon's box. Recursive subdivision gives
  // a conservative continuous collision test, including very long narrow edges
  // which a fixed number of t samples can jump over.
  const minX = Math.min(...points.map(point => point.x));
  const maxX = Math.max(...points.map(point => point.x));
  const minY = Math.min(...points.map(point => point.y));
  const maxY = Math.max(...points.map(point => point.y));
  const distance = Math.hypot(node.x - clamp(node.x, minX, maxX),
    node.y - clamp(node.y, minY, maxY));
  if (distance >= node.radius + 8) return false;
  if (depth >= 18 || Math.max(maxX - minX, maxY - minY) < 0.5) return true;
  const middle = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const [a, b, c, d] = points;
  const ab = middle(a, b), bc = middle(b, c), cd = middle(c, d);
  const abc = middle(ab, bc), bcd = middle(bc, cd), center = middle(abc, bcd);
  return curveTouchesCircle([a, ab, abc, center], node, depth + 1) ||
    curveTouchesCircle([center, bcd, cd, d], node, depth + 1);
}

function routeTreeEdges(graph, frames) {
  for (const edge of graph.edges) {
    // Input may be an earlier layout. Always derive routes from this layout.
    delete edge.routeX;
    const source = graph.byId.get(edge.source);
    const target = graph.byId.get(edge.target);
    const start = { x: source.x, y: source.y + source.radius + 3 };
    const end = { x: target.x, y: target.y - target.radius - 5 };
    const middleY = (start.y + end.y) / 2;
    const direct = [start, { x: start.x, y: middleY }, { x: end.x, y: middleY }, end];
    const blocked = graph.nodes.some(node => node !== source && node !== target &&
      curveTouchesCircle(direct, node));
    if (!blocked) continue;
    const frame = frames.get(source.id);
    const left = frame.x + 8;
    const right = frame.x + frame.width - 8;
    edge.routeX = Math.abs(source.x - left) + Math.abs(target.x - left) <=
      Math.abs(source.x - right) + Math.abs(target.x - right) ? left : right;
  }
}

/**
 * Weak components are indivisible (including cross-domain edges). Connected
 * blocks come first, isolated knowledge points are grouped by domain last.
 * Longest-path ranks guarantee every prerequisite arrow points down.
 */
export function layoutTechTree(inputNodes, inputEdges, viewportWidth) {
  const graph = graphCopy(inputNodes, inputEdges);
  const width = Math.max(240, finite(viewportWidth, 1000));
  const padding = 28;
  const gap = 32;
  const columnCount = width >= 1440 ? 3 : width >= 900 ? 2 : 1;
  const columnWidth = (width - padding * 2 - gap * (columnCount - 1)) / columnCount;
  const levels = Array(columnCount).fill(padding);
  const connected = [];
  const isolated = new Map();
  for (const component of connectedComponents(graph)) {
    if (component.length > 1 || graph.neighbors.get(component[0].id).length) {
      connected.push(component);
    } else {
      const key = domain(component[0]);
      if (!isolated.has(key)) isolated.set(key, []);
      isolated.get(key).push(component[0]);
    }
  }
  connected.sort((a, b) => b.length - a.length || compareIds(a[0], b[0]));
  const blocks = [...connected, ...[...isolated.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0).map(([, nodes]) => nodes)];
  const groups = [];
  const frames = new Map();
  for (const component of blocks) {
    const ids = new Set(component.map(node => node.id));
    const outgoing = new Map(component.map(node => [node.id, []]));
    const incoming = new Map(component.map(node => [node.id, 0]));
    const ranks = new Map(component.map(node => [node.id, 0]));
    for (const edge of graph.edges) {
      if (!ids.has(edge.source)) continue;
      outgoing.get(edge.source).push(edge.target);
      incoming.set(edge.target, incoming.get(edge.target) + 1);
    }
    const queue = component.filter(node => incoming.get(node.id) === 0).sort(compareIds);
    for (let q = 0; q < queue.length; q++) {
      const node = queue[q];
      for (const target of outgoing.get(node.id)) {
        ranks.set(target, Math.max(ranks.get(target), ranks.get(node.id) + 1));
        incoming.set(target, incoming.get(target) - 1);
        if (!incoming.get(target)) queue.push(graph.byId.get(target));
      }
    }
    if (queue.length !== component.length) throw new Error('Directed cycle in knowledge prerequisites');
    const layers = new Map();
    for (const node of component) {
      const rank = ranks.get(node.id);
      if (!layers.has(rank)) layers.set(rank, []);
      layers.get(rank).push(node);
    }
    const column = levels.indexOf(Math.min(...levels));
    const x = padding + column * (columnWidth + gap);
    const y = levels[column];
    const slots = Math.max(1, Math.floor((columnWidth - 24) / 112));
    let rowY = y + 76;
    for (const [, layer] of [...layers.entries()].sort(([a], [b]) => a - b)) {
      layer.sort(compareIds);
      const rows = Math.ceil(layer.length / slots);
      layer.forEach((node, i) => {
        const row = Math.floor(i / slots);
        const rowSize = Math.min(slots, layer.length - row * slots);
        node.x = x + columnWidth / 2 + ((i % slots) - (rowSize - 1) / 2) * 112;
        node.y = rowY + row * 120;
      });
      rowY += rows * 120 + 40;
    }
    const height = rowY - y - 20;
    const domains = [...new Set(component.map(domain))];
    const representative = component[0];
    const label = domains.length === 1
      ? representative.domain_name || domains[0] || '知识点'
      : representative.name || '跨领域知识';
    const frame = { label, x, y, width: columnWidth, height };
    groups.push(frame);
    for (const node of component) frames.set(node.id, frame);
    levels[column] = y + height + gap;
  }
  routeTreeEdges(graph, frames);
  return { nodes: graph.nodes, edges: graph.edges, width, height: Math.max(...levels) + padding, groups };
}

/** screen = world * scale + offset. Fit includes full node circles. */
export function fitCamera(nodes, width, height, padding = 72) {
  const w = Math.max(1, finite(width, 1));
  const h = Math.max(1, finite(height, 1));
  if (!nodes.length) return { x: w / 2, y: h / 2, scale: 1 };
  const p = clamp(finite(padding, 72), 0, Math.min(w, h) / 2 - 0.5);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const node of nodes) {
    const r = Math.max(0, finite(node.radius, RADIUS));
    const x = finite(node.x), y = finite(node.y);
    minX = Math.min(minX, x - r); maxX = Math.max(maxX, x + r);
    minY = Math.min(minY, y - r); maxY = Math.max(maxY, y + r);
  }
  const scale = Math.min(1.25, (w - p * 2) / Math.max(1, maxX - minX),
    (h - p * 2) / Math.max(1, maxY - minY));
  return { x: w / 2 - (minX + maxX) / 2 * scale,
    y: h / 2 - (minY + maxY) / 2 * scale, scale };
}

export function screenToWorld(camera, point) {
  const scale = Math.max(0.000001, finite(camera.scale, 1));
  return { x: (point.x - finite(camera.x)) / scale, y: (point.y - finite(camera.y)) / scale };
}

export function zoomCamera(camera, factor, point, min = 0.18, max = 2.5) {
  const anchor = screenToWorld(camera, point);
  const scale = clamp(Math.max(0.000001, finite(camera.scale, 1)) *
    Math.max(0.000001, finite(factor, 1)), min, max);
  return { x: point.x - anchor.x * scale, y: point.y - anchor.y * scale, scale };
}
