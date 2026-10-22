/* Graph drawing and interruptible gestures. The static tree and force view share IDs and edges. */
import {
  createSimulation, stepSimulation, layoutTechTree, fitCamera, zoomCamera, screenToWorld,
} from './math.js';
import { difficultyColor } from '../knowledgeWeightScale.js';

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export class GraphCanvas {
  constructor(host, data, { onSelect = () => {}, onChange = () => {} } = {}) {
    this.host = host;
    this.data = data;
    this.onSelect = onSelect;
    this.onChange = onChange;
    this.mode = 'force';
    this.domain = 'all';
    this.paused = false;
    this.selectedId = null;
    this.hoverId = null;
    this.width = 0;
    this.height = 0;
    this.camera = { x: 0, y: 0, scale: 1 };
    this.treeScale = 1;
    this.cameraVelocity = { x: 0, y: 0 };
    this.pointers = new Map();
    this.drag = null;
    this.pinch = null;
    this.frame = 0;
    this.lastFrame = 0;
    this.awake = false;
    this.destroyed = false;
    this.textLines = new Map();
    this.halos = new Map();
    this.abort = new AbortController();
    this.media = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reducedMotion = this.media.matches;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'kg-canvas';
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', '知识图谱画布，可拖动节点、平移和缩放；也可通过搜索或知识点选择器浏览。');
    this.spacer = document.createElement('div');
    this.spacer.className = 'kg-scroll-space';
    this.spacer.append(this.canvas);
    host.replaceChildren(this.spacer);
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.rebuild();
    this.bind();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
  }

  bind() {
    const options = { signal: this.abort.signal };
    this.canvas.addEventListener('pointerdown', event => this.pointerDown(event), options);
    this.canvas.addEventListener('pointermove', event => this.pointerMove(event), options);
    this.canvas.addEventListener('pointerup', event => this.pointerUp(event), options);
    this.canvas.addEventListener('pointercancel', event => this.pointerUp(event, true), options);
    this.canvas.addEventListener('lostpointercapture', event => {
      if (this.pointers.has(event.pointerId)) this.pointerUp(event, true);
    }, options);
    this.canvas.addEventListener('pointerleave', () => {
      if (!this.pointers.size) { this.hoverId = null; this.requestDraw(); }
    }, options);
    this.canvas.addEventListener('wheel', event => {
      if (this.mode === 'tree' && !event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      this.zoom(Math.exp(-event.deltaY * (event.deltaMode === 1 ? .035 : .0015)), this.point(event));
    }, { ...options, passive: false });
    this.canvas.addEventListener('dblclick', event => {
      if (!this.hit(this.point(event)) && this.mode === 'force') this.zoom(1.45, this.point(event));
    }, options);
    this.canvas.addEventListener('keydown', event => {
      const keys = ['+', '=', '-', '_', '0', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Escape', ' '];
      if (!keys.includes(event.key)) return;
      event.preventDefault();
      if (event.key === '+' || event.key === '=') this.zoom(1.2);
      else if (event.key === '-' || event.key === '_') this.zoom(1 / 1.2);
      else if (event.key === '0') this.reset();
      else if (event.key === 'Escape') this.selectNode(null);
      else if (event.key === ' ') this.togglePause();
      else if (this.mode === 'tree') {
        this.host.scrollBy({
          top: event.key === 'ArrowUp' ? -100 : event.key === 'ArrowDown' ? 100 : 0,
          left: event.key === 'ArrowLeft' ? -100 : event.key === 'ArrowRight' ? 100 : 0,
        });
      } else {
        const delta = event.shiftKey ? 160 : 60;
        this.camera.x += event.key === 'ArrowLeft' ? delta : event.key === 'ArrowRight' ? -delta : 0;
        this.camera.y += event.key === 'ArrowUp' ? delta : event.key === 'ArrowDown' ? -delta : 0;
        this.cameraVelocity.x = this.cameraVelocity.y = 0;
        this.requestDraw();
      }
    }, options);
    this.host.addEventListener('scroll', () => this.requestDraw(), { ...options, passive: true });
    this.media.addEventListener('change', () => {
      this.reducedMotion = this.media.matches;
      this.cameraVelocity.x = this.cameraVelocity.y = 0;
      if (this.reducedMotion) {
        this.sim.nodes.forEach(node => { node.vx = node.vy = 0; });
        this.awake = false;
      }
      this.changed();
      this.requestDraw();
    }, options);
    document.addEventListener('visibilitychange', () => {
      this.lastFrame = 0;
      if (document.hidden && this.frame) {
        cancelAnimationFrame(this.frame);
        this.frame = 0;
      } else this.requestDraw();
    }, options);
  }

  rebuild() {
    const nodes = this.domain === 'all' ? this.data.nodes : this.data.nodes.filter(node => node.domain_id === this.domain);
    const ids = new Set(nodes.map(node => node.id));
    this.edges = this.data.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target));
    this.sim = createSimulation(nodes, this.edges);
    this.awake = false;
    this.drag = null;
    this.pointers.clear();
    this.cameraVelocity.x = this.cameraVelocity.y = 0;
    this.relate();
    if (this.width) this.layout(true);
    this.changed();
  }

  resize() {
    if (this.destroyed) return;
    const box = this.host.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const oldWidth = this.width;
    const oldHeight = this.height;
    this.width = Math.round(box.width);
    this.height = Math.round(box.height);
    this.fontFamily = getComputedStyle(this.host).fontFamily;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.width * ratio);
    this.canvas.height = Math.round(this.height * ratio);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.ratio = ratio;
    if (this.mode === 'tree') this.layout();
    else if (!oldWidth) this.layout(true);
    else {
      this.camera.x += (this.width - oldWidth) / 2;
      this.camera.y += (this.height - oldHeight) / 2;
    }
    if (this.pendingFocusId) {
      const id = this.pendingFocusId;
      this.pendingFocusId = null;
      this.focusNode(id);
    } else if (this.selectedId) this.focusNode(this.selectedId);
    this.requestDraw();
  }

  layout(reset = false) {
    this.host.dataset.mode = this.mode;
    if (this.mode === 'tree') {
      const previousHeight = this.tree?.height || 1;
      const progress = this.host.scrollTop / previousHeight;
      this.tree = layoutTechTree(this.sim.nodes, this.edges, this.width);
      this.spacer.style.height = `${Math.max(this.height, this.tree.height * this.treeScale + 60)}px`;
      this.spacer.style.width = `${Math.max(this.width, this.tree.width * this.treeScale + this.detailReserve())}px`;
      this.host.scrollTop = reset ? 0 : progress * this.tree.height;
    } else {
      this.spacer.style.height = `${this.height}px`;
      this.spacer.style.width = `${this.width}px`;
      this.host.scrollTop = 0;
      if (reset) this.camera = fitCamera(this.sim.nodes, this.width, this.height, Math.min(62, this.width * .08));
    }
    this.changed();
    this.requestDraw();
  }

  setDomain(id = 'all') {
    if (id !== 'all' && !this.data.domains.some(domain => domain.id === id)) return;
    if (this.domain === id) return;
    this.domain = id;
    this.selectNode(null);
    this.treeScale = 1;
    this.rebuild();
  }

  setMode(mode) {
    if (!['force', 'tree'].includes(mode) || mode === this.mode) return;
    this.mode = mode;
    this.drag = null;
    this.pointers.clear();
    this.pinch = null;
    this.cameraVelocity.x = this.cameraVelocity.y = 0;
    this.layout(true);
    if (this.selectedId && mode === 'tree') this.focusNode(this.selectedId);
  }

  getState() {
    return {
      mode: this.mode, domain: this.domain, paused: this.paused,
      scale: this.mode === 'tree' ? this.treeScale : this.camera.scale,
      nodeCount: this.sim.nodes.length, edgeCount: this.edges.length,
      totalNodes: this.data.nodes.length, totalEdges: this.data.edges.length,
      reducedMotion: this.reducedMotion,
    };
  }

  changed() {
    const state = this.getState();
    this.canvas.dataset.nodeCount = String(state.nodeCount);
    this.canvas.dataset.edgeCount = String(state.edgeCount);
    this.canvas.dataset.mode = state.mode;
    this.onChange(state);
  }

  selectNode(id) {
    this.selectedId = id;
    if (this.mode === 'tree' && this.tree) {
      this.spacer.style.width = `${Math.max(this.width, this.tree.width * this.treeScale + this.detailReserve())}px`;
    }
    this.relate();
    this.onSelect(id);
    this.requestDraw();
  }

  relate() {
    this.related = new Set(this.selectedId ? [this.selectedId] : []);
    if (!this.selectedId) return;
    // Highlight actual prerequisite chains in either direction, never a fabricated taxonomy path.
    for (const direction of ['source', 'target']) {
      const queue = [this.selectedId];
      const seen = new Set(queue);
      for (let i = 0; i < queue.length; i++) {
        for (const edge of this.data.edges) {
          if (edge[direction] !== queue[i]) continue;
          const id = edge[direction === 'source' ? 'target' : 'source'];
          if (!seen.has(id)) { seen.add(id); queue.push(id); this.related.add(id); }
        }
      }
    }
  }

  focusNode(id) {
    if (!this.data.nodes.some(node => node.id === id)) return;
    if (!this.sim.nodes.some(node => node.id === id)) {
      this.domain = 'all';
      this.rebuild();
    }
    this.selectNode(id);
    if (!this.width || !this.height) { this.pendingFocusId = id; return; }
    const nodes = this.mode === 'tree' ? this.tree.nodes : this.sim.nodes;
    const node = nodes.find(item => item.id === id);
    if (!node) return;
    if (this.mode === 'tree') {
      this.host.scrollTo({ top: Math.max(0, node.y * this.treeScale - this.height * (this.width <= 520 ? .25 : .38)), behavior: 'instant' });
      this.host.scrollLeft = Math.max(0, node.x * this.treeScale - (this.width - this.detailReserve()) / 2);
    } else {
      const reserve = this.detailReserve();
      this.camera = { scale: 1.12, x: (this.width - reserve) / 2 - node.x * 1.12, y: this.height * (this.width <= 520 ? .27 : .46) - node.y * 1.12 };
      this.cameraVelocity.x = this.cameraVelocity.y = 0;
    }
    this.changed();
    this.requestDraw();
  }

  zoom(factor, anchor = { x: this.width / 2, y: this.height / 2 }) {
    if (this.mode === 'tree') {
      const oldScale = this.treeScale;
      const anchorY = (this.host.scrollTop + anchor.y) / oldScale;
      const anchorX = (this.host.scrollLeft + anchor.x) / oldScale;
      this.treeScale = clamp(oldScale * factor, .55, 1.6);
      this.layout();
      this.host.scrollTop = Math.max(0, anchorY * this.treeScale - anchor.y);
      this.host.scrollLeft = Math.max(0, anchorX * this.treeScale - anchor.x);
    } else this.camera = zoomCamera(this.camera, factor, anchor, .06, 2.5);
    this.changed();
    this.requestDraw();
  }

  detailReserve() {
    return this.selectedId && this.width > 520 ? 320 : 0;
  }

  reset() {
    this.drag = null;
    this.pointers.clear();
    this.pinch = null;
    this.treeScale = 1;
    this.sim = createSimulation(this.sim.nodes, this.edges);
    this.cameraVelocity.x = this.cameraVelocity.y = 0;
    this.awake = false;
    this.layout(true);
  }

  togglePause() {
    if (this.mode !== 'force' || this.reducedMotion) return;
    this.paused = !this.paused;
    this.awake = !this.paused;
    this.changed();
    this.requestDraw();
  }

  point(event) {
    const box = this.canvas.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  worldCamera() {
    return this.mode === 'tree' ? { x: -this.host.scrollLeft, y: -this.host.scrollTop, scale: this.treeScale } : this.camera;
  }

  hit(point) {
    const world = screenToWorld(this.worldCamera(), point);
    const nodes = this.mode === 'tree' ? this.tree?.nodes || [] : this.sim.nodes;
    return [...nodes].reverse().find(node => distance(node, world) <= Math.max(node.radius, 10 / this.worldCamera().scale));
  }

  pointerDown(event) {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    const point = this.point(event);
    this.pointers.set(event.pointerId, point);
    if (this.mode === 'tree') {
      this.treeClick = { point, node: this.hit(point)?.id, top: this.host.scrollTop, left: this.host.scrollLeft, pointer: event.pointerType };
      if (event.pointerType === 'mouse') {
        this.canvas.setPointerCapture(event.pointerId);
        this.canvas.style.cursor = 'grabbing';
      }
      return;
    }
    event.preventDefault();
    this.canvas.focus({ preventScroll: true });
    this.canvas.setPointerCapture(event.pointerId);
    this.cameraVelocity.x = this.cameraVelocity.y = 0;
    if (this.pointers.size > 1) {
      this.drag = null;
      const points = [...this.pointers.values()];
      this.pinch = { distance: distance(points[0], points[1]), middle: midpoint(points[0], points[1]) };
      return;
    }
    const node = this.hit(point);
    const world = screenToWorld(this.camera, point);
    this.drag = {
      id: event.pointerId, node, start: point, previous: point, time: event.timeStamp,
      offset: node ? { x: node.x - world.x, y: node.y - world.y } : null,
      moved: false, vx: 0, vy: 0,
    };
    if (node) {
      node.vx = node.vy = 0;
      this.selectNode(node.id);
    }
    this.canvas.style.cursor = 'grabbing';
    this.requestDraw();
  }

  pointerMove(event) {
    const point = this.point(event);
    if (this.pointers.has(event.pointerId)) this.pointers.set(event.pointerId, point);
    if (this.mode === 'tree') {
      if (this.treeClick?.pointer === 'mouse' && this.pointers.has(event.pointerId)) {
        this.host.scrollTop = this.treeClick.top - (point.y - this.treeClick.point.y);
        this.host.scrollLeft = this.treeClick.left - (point.x - this.treeClick.point.x);
        return;
      }
      const hit = this.hit(point);
      this.canvas.style.cursor = hit ? 'pointer' : 'default';
      if (this.hoverId !== hit?.id) { this.hoverId = hit?.id || null; this.requestDraw(); }
      return;
    }
    if (this.pointers.size >= 2) {
      const points = [...this.pointers.values()];
      const current = { distance: distance(points[0], points[1]), middle: midpoint(points[0], points[1]) };
      if (this.pinch) {
        this.camera = zoomCamera(this.camera, current.distance / Math.max(1, this.pinch.distance), this.pinch.middle, .06, 2.5);
        this.camera.x += current.middle.x - this.pinch.middle.x;
        this.camera.y += current.middle.y - this.pinch.middle.y;
      }
      this.pinch = current;
      this.changed();
      this.requestDraw();
      return;
    }
    if (!this.drag || this.drag.id !== event.pointerId) {
      const hit = this.hit(point);
      this.canvas.style.cursor = hit ? 'grab' : 'grab';
      if (this.hoverId !== hit?.id) { this.hoverId = hit?.id || null; this.requestDraw(); }
      return;
    }
    const dt = clamp((event.timeStamp - this.drag.time) / 1000, .008, .08);
    const dx = point.x - this.drag.previous.x;
    const dy = point.y - this.drag.previous.y;
    this.drag.moved ||= distance(point, this.drag.start) > 4;
    this.drag.vx = this.drag.vx * .35 + dx / dt * .65;
    this.drag.vy = this.drag.vy * .35 + dy / dt * .65;
    if (this.drag.node) {
      const world = screenToWorld(this.camera, point);
      Object.assign(this.drag.node, {
        x: world.x + this.drag.offset.x, y: world.y + this.drag.offset.y,
        vx: clamp(this.drag.vx / this.camera.scale, -1500, 1500),
        vy: clamp(this.drag.vy / this.camera.scale, -1500, 1500),
      });
      this.drag.node.anchorX = this.drag.node.x;
      this.drag.node.anchorY = this.drag.node.y;
      this.awake = true;
    } else {
      this.camera.x += dx;
      this.camera.y += dy;
    }
    this.drag.previous = point;
    this.drag.time = event.timeStamp;
    this.requestDraw();
  }

  pointerUp(event, cancelled = false) {
    if (!this.pointers.has(event.pointerId)) return;
    this.pointers.delete(event.pointerId);
    if (this.mode === 'tree') {
      if (!cancelled && this.treeClick && distance(this.treeClick.point, this.point(event)) < 6) this.selectNode(this.treeClick.node || null);
      this.treeClick = null;
      if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
      this.canvas.style.cursor = 'default';
      return;
    }
    if (this.drag?.id === event.pointerId) {
      const drag = this.drag;
      const stale = event.timeStamp - drag.time > 100;
      if (drag.node) {
        if (cancelled || stale || this.reducedMotion || this.paused) drag.node.vx = drag.node.vy = 0;
        this.awake = !this.paused && !this.reducedMotion;
      } else if (drag.moved && !cancelled && !stale && !this.reducedMotion) {
        this.cameraVelocity = { x: clamp(drag.vx, -1600, 1600), y: clamp(drag.vy, -1600, 1600) };
      } else if (!cancelled && !drag.moved) this.selectNode(null);
      this.drag = null;
    }
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    this.pinch = null;
    if (!cancelled && this.pointers.size === 1) {
      const [id, point] = this.pointers.entries().next().value;
      this.drag = {
        id, node: null, start: point, previous: point, time: event.timeStamp,
        offset: null, moved: true, vx: 0, vy: 0,
      };
    }
    this.canvas.style.cursor = this.pointers.size ? 'grabbing' : 'grab';
    this.requestDraw();
  }

  requestDraw() {
    if (this.frame || this.destroyed || document.hidden) return;
    this.frame = requestAnimationFrame(time => this.tick(time));
  }

  tick(time) {
    this.frame = 0;
    if (this.destroyed || !this.canvas.isConnected) { this.lastFrame = 0; return; }
    const dt = clamp(this.lastFrame ? (time - this.lastFrame) / 1000 : 1 / 60, 1 / 240, 1 / 30);
    this.lastFrame = time;
    if (this.mode === 'force') {
      if ((this.awake || this.drag?.node) && !this.paused && !this.reducedMotion) {
        const energy = stepSimulation(this.sim, dt, { draggedId: this.drag?.node?.id || null });
        this.awake = energy > .05;
      }
      if (!this.drag && !this.reducedMotion && Math.hypot(this.cameraVelocity.x, this.cameraVelocity.y) > 2) {
        this.camera.x += this.cameraVelocity.x * dt;
        this.camera.y += this.cameraVelocity.y * dt;
        this.cameraVelocity.x *= Math.exp(-6 * dt);
        this.cameraVelocity.y *= Math.exp(-6 * dt);
      } else if (!this.drag) this.cameraVelocity.x = this.cameraVelocity.y = 0;
    }
    this.draw();
    if (this.mode === 'force' && ((!this.paused && !this.reducedMotion && (this.awake || this.drag?.node)) || Math.hypot(this.cameraVelocity.x, this.cameraVelocity.y) > 2)) this.requestDraw();
    else this.lastFrame = 0;
  }

  draw() {
    if (!this.width || !this.height) return;
    const ctx = this.ctx;
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, this.width, this.height);
    const camera = this.worldCamera();
    if (this.mode === 'force') {
      ctx.fillStyle = '#e0e0e0';
      const spacing = 28;
      for (let x = ((camera.x % spacing) + spacing) % spacing; x < this.width; x += spacing) {
        for (let y = ((camera.y % spacing) + spacing) % spacing; y < this.height; y += spacing) {
          ctx.beginPath(); ctx.arc(x, y, .65, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
    ctx.translate(camera.x, camera.y);
    ctx.scale(camera.scale, camera.scale);
    const nodes = this.mode === 'tree' ? this.tree.nodes : this.sim.nodes;
    const index = new Map(nodes.map(node => [node.id, node]));
    const groups = this.mode === 'tree' ? this.tree.groups : this.sim.groups || this.domainGroups();
    for (const group of groups) this.drawGroup(group, camera);
    for (const edge of this.mode === 'tree' ? this.tree.edges : this.edges) {
      this.drawEdge(index.get(edge.source), index.get(edge.target), camera, edge);
    }
    for (const node of nodes) this.drawNode(node, camera);
    const active = index.get(this.hoverId);
    if (active && camera.scale < .65) this.drawTooltip(active, camera);
  }

  domainGroups() {
    const domains = new Map();
    for (const node of this.sim.nodes) {
      if (!domains.has(node.domain_id)) domains.set(node.domain_id, []);
      domains.get(node.domain_id).push(node);
    }
    return [...domains.values()].map(nodes => {
      const left = Math.min(...nodes.map(node => node.anchorX)) - 64;
      const top = Math.min(...nodes.map(node => node.anchorY)) - 100;
      return {
        x: left, y: top,
        width: Math.max(...nodes.map(node => node.anchorX)) + 64 - left,
        height: Math.max(...nodes.map(node => node.anchorY)) + 64 - top,
        label: nodes[0].domain_name,
      };
    });
  }

  drawGroup(group, camera) {
    const ctx = this.ctx;
    const { scale } = camera;
    if (this.mode === 'tree') {
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#e5e5e5';
      ctx.lineWidth = 1 / scale;
      ctx.beginPath(); ctx.roundRect(group.x, group.y, group.width, group.height, 14); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#999';
      ctx.font = `500 11px ${this.fontFamily}`;
      ctx.textAlign = 'left';
      ctx.fillText(group.label, group.x + 20, group.y + 29);
    } else {
      ctx.fillStyle = '#999';
      ctx.font = `500 ${Math.min(28, 11 / scale)}px ${this.fontFamily}`;
      ctx.textAlign = 'left';
      ctx.fillText(group.label, group.x + 18, group.y + 24);
    }
  }

  drawEdge(source, target, camera, edge) {
    if (!source || !target) return;
    const ctx = this.ctx;
    const { scale } = camera;
    const focused = this.selectedId && this.related.has(source.id) && this.related.has(target.id);
    ctx.globalAlpha = this.selectedId ? (focused ? .9 : .1) : .65;
    ctx.lineWidth = (focused ? 1.6 : .85) / scale;
    ctx.strokeStyle = focused ? '#333' : '#a8a8a8';
    ctx.fillStyle = ctx.strokeStyle;
    let start, end, angle;
    ctx.beginPath();
    if (this.mode === 'tree') {
      start = { x: source.x, y: source.y + source.radius + 3 };
      end = { x: target.x, y: target.y - target.radius - 5 };
      const y = (start.y + end.y) / 2;
      ctx.moveTo(start.x, start.y);
      if (Number.isFinite(edge.routeX)) {
        const escapeY = source.y + source.radius + 20;
        const approachY = target.y - target.radius - 20;
        const corner = Math.min(10, Math.max(0, (approachY - escapeY) / 2));
        ctx.bezierCurveTo(start.x, escapeY, edge.routeX, escapeY, edge.routeX, escapeY + corner);
        ctx.lineTo(edge.routeX, approachY - corner);
        ctx.bezierCurveTo(edge.routeX, approachY, end.x, approachY, end.x, end.y);
      } else ctx.bezierCurveTo(start.x, y, end.x, y, end.x, end.y);
      angle = Math.PI / 2;
    } else {
      angle = Math.atan2(target.y - source.y, target.x - source.x);
      start = { x: source.x + Math.cos(angle) * (source.radius + 3), y: source.y + Math.sin(angle) * (source.radius + 3) };
      end = { x: target.x - Math.cos(angle) * (target.radius + 5), y: target.y - Math.sin(angle) * (target.radius + 5) };
      if (distance(source, target) < source.radius + target.radius + 12) { ctx.globalAlpha = 1; return; }
      ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y);
    }
    ctx.stroke();
    const head = Math.min(8 / scale, 12);
    ctx.beginPath();
    ctx.moveTo(end.x, end.y);
    ctx.lineTo(end.x - head * Math.cos(angle - .43), end.y - head * Math.sin(angle - .43));
    ctx.lineTo(end.x - head * Math.cos(angle + .43), end.y - head * Math.sin(angle + .43));
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
  }

  drawNode(node, camera) {
    const px = node.x * camera.scale + camera.x;
    const py = node.y * camera.scale + camera.y;
    const r = node.radius;
    const margin = r * camera.scale + 32;
    if (px < -margin || px > this.width + margin || py < -margin || py > this.height + margin) return;
    const ctx = this.ctx;
    const selected = this.selectedId === node.id;
    const hovered = this.hoverId === node.id;
    ctx.globalAlpha = this.selectedId && !this.related.has(node.id) && !hovered ? .32 : 1;
    // One cached small texture per difficulty; no per-frame blur or gradient allocation.
    const color = difficultyColor(node.difficulty_weight);
    if (color) {
      const size = r + 15;
      const key = `${node.difficulty_weight}:${r}`;
      let halo = this.halos.get(key);
      if (!halo) {
        halo = document.createElement('canvas');
        halo.width = halo.height = size * 4;
        const paint = halo.getContext('2d');
        paint.scale(2, 2);
        const fade = paint.createRadialGradient(size, size, r - 1, size, size, size);
        fade.addColorStop(0, `rgba(${color.rgb},.23)`);
        fade.addColorStop(.2, `rgba(${color.rgb},.15)`);
        fade.addColorStop(.55, `rgba(${color.rgb},.055)`);
        fade.addColorStop(1, `rgba(${color.rgb},0)`);
        paint.fillStyle = fade;
        paint.fillRect(0, 0, size * 2, size * 2);
        this.halos.set(key, halo);
      }
      ctx.drawImage(halo, node.x - size, node.y - size, size * 2, size * 2);
    }
    if (camera.scale > .4) {
      ctx.shadowColor = selected ? 'rgba(0,0,0,.12)' : 'rgba(0,0,0,.06)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 3;
    }
    ctx.beginPath(); ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
    ctx.fillStyle = selected ? '#111' : '#fff';
    ctx.fill();
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.lineWidth = (hovered || selected ? 1.6 : .85) / camera.scale;
    ctx.strokeStyle = selected || hovered ? '#111' : '#c6c6c6';
    ctx.stroke();
    if (!selected && camera.scale > .45) {
      ctx.beginPath(); ctx.arc(node.x, node.y, r - 3, .18, Math.PI * .8);
      ctx.lineWidth = 3; ctx.strokeStyle = '#f1f1f1'; ctx.stroke();
      ctx.beginPath(); ctx.arc(node.x - 2, node.y - 2, r - 7, Math.PI * 1.04, Math.PI * 1.48);
      ctx.lineWidth = 1.2; ctx.strokeStyle = '#fafafa'; ctx.stroke();
    }
    if (camera.scale >= .65) {
      ctx.fillStyle = selected ? '#fff' : '#333';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const fontSize = Math.round(Math.max(11, 9.5 / camera.scale) * 10) / 10;
      const lineHeight = fontSize + 2;
      ctx.font = `500 ${fontSize}px ${this.fontFamily}`;
      const textKey = `${fontSize}:${node.name}`;
      let lines = this.textLines.get(textKey);
      if (!lines) {
        lines = [];
        let line = '';
        const tokens = node.name.match(/[A-Za-z0-9*]+|\s+|./gu) || [];
        for (const token of tokens) {
          if (line && ctx.measureText(line + token).width > 54) {
            lines.push(line.trim());
            line = token.trimStart();
          } else line += token;
        }
        if (line.trim()) lines.push(line.trim());
        const maxLines = Math.floor(55 / lineHeight);
        if (lines.length > maxLines) {
          lines = lines.slice(0, maxLines);
          lines[maxLines - 1] = lines[maxLines - 1].replace(/[（(]?\s*$/, '') + '…';
        }
        this.textLines.set(textKey, lines);
      }
      const top = node.y - (lines.length - 1) * lineHeight / 2;
      lines.forEach((line, i) => ctx.fillText(line, node.x, top + i * lineHeight, 58));
    } else if (camera.scale >= .23) {
      // Semantic zoom keeps the overview identifiable without painting unreadable full labels.
      const abbreviation = node.name.match(/[（(]([A-Za-z0-9*]{1,4})[)）]/)?.[1]
        || node.name.match(/^[A-Za-z0-9*]{1,4}(?=\s|$)/)?.[0]
        || [...node.name].slice(0, 2).join('');
      ctx.fillStyle = selected ? '#fff' : '#666';
      ctx.font = `500 ${9 / camera.scale}px ${this.fontFamily}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(abbreviation, node.x, node.y, r * 1.65);
    } else {
      ctx.fillStyle = '#d3d3d3';
      ctx.beginPath(); ctx.arc(node.x, node.y, 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawTooltip(node, camera) {
    const ctx = this.ctx;
    const { scale } = camera;
    ctx.font = `500 ${12 / scale}px ${this.fontFamily}`;
    const width = ctx.measureText(node.name).width + 24 / scale;
    const x = node.x - width / 2;
    const y = node.y - node.radius - 34 / scale;
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.roundRect(x, y, width, 28 / scale, 6 / scale); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(node.name, node.x, y + 14 / scale);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.abort.abort();
    this.observer.disconnect();
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.pointers.clear();
    this.drag = null;
    this.halos.clear();
    this.textLines.clear();
  }
}
