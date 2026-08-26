/* The tools.
 *
 * Each one owns its option schema (which builds its panel), the asset kind it
 * draws from, and its pointer behaviour. Painting happens on a scratch canvas
 * while the button is down and is merged into the layer on release, which is
 * what keeps a long stroke from compounding its own opacity.
 */

import { imageNow, library, warm } from './assets.js';
import { app, activeLayer, emit, markDirty, scheduleAutosave, setToolSetting, toolSetting } from './app.js';
import { LAYER_KINDS, distanceLabel } from './doc.js';
import { pushEntry, restore, snapBytes, snapshot } from './history.js';
import * as R from './render.js';
import { modal, el, toast, uid } from './util.js';

const BLENDS = [
  ['source-over', 'Normal'], ['multiply', 'Multiply'], ['overlay', 'Overlay'],
  ['screen', 'Screen'], ['soft-light', 'Soft light'], ['darken', 'Darken'], ['lighten', 'Lighten'],
];

const S = (tool, key, fallback) => toolSetting(tool, key, fallback);

const PATH_PRESETS = {
  river:  { width: 14, color: '#4d7fa0' },
  road:   { width: 8,  color: '#c8ab74' },
  trail:  { width: 4,  color: '#6b5334' },
  border: { width: 5,  color: '#8a3b3b' },
};

/* ------------------------------------------------------------ shared paint */

const live = {
  active: false, layer: null, points: [], op: null, box: null, snap: null, kind: null,
};

function boxOf(points, size, softness) {
  return R.strokeBox(points, size, softness);
}

function unionBox(a, b) {
  if (!a) return b;
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

function beginPaint(layer, op, kind) {
  live.active = true;
  live.layer = layer;
  live.op = op;
  live.kind = kind;
  live.box = null;
  R.view.liveLayer = layer.id;
  R.view.liveCtx.clearRect(0, 0, R.view.live.width, R.view.live.height);
  R.view.liveMaskCtx.clearRect(0, 0, R.view.liveMask.width, R.view.liveMask.height);
}

const LABELS = { stroke: 'Paint', shape: 'Fill', soften: 'Soften' };

function paintLive() {
  const op = live.op;
  const box = live.kind === 'shape'
    ? R.opBox(op)
    : boxOf(op.points, op.size, 1 - (op.hardness || 0));
  live.box = unionBox(live.box, box);
  const ctx = R.view.liveCtx;
  ctx.clearRect(box.x, box.y, box.x1 - box.x, box.y1 - box.y);
  // Only the rectangle this frame touched is re-composited. Compositing the
  // whole stroke every frame makes a long drag get slower the longer it gets.
  if (live.kind === 'mask') {
    // landmass preview: the texture poured into the shape, coastline deferred
    const preview = Object.assign({}, op, { tex: live.layer.texture, scale: live.layer.scale });
    R.applyStroke(ctx, preview, box);
  } else if (live.kind === 'scatter') {
    ctx.clearRect(0, 0, R.view.live.width, R.view.live.height);
    R.applyScatter(ctx, op);
  } else if (live.kind === 'soften') {
    ctx.clearRect(box.x, box.y, box.x1 - box.x, box.y1 - box.y);
    R.applySoften(ctx, R.canvasFor(live.layer), op, box);
  } else if (live.kind === 'shape') {
    ctx.clearRect(0, 0, R.view.live.width, R.view.live.height);
    R.applyStroke(ctx, op, R.opBox(op));
  } else {
    R.applyStroke(ctx, op, box);
  }
  R.compositeAll(live.kind === 'scatter' || live.kind === 'shape' ? live.box : box);
  R.requestDraw();
}

function endPaint() {
  if (!live.active) return;
  const { layer, op } = live;
  live.active = false;
  R.view.liveLayer = null;
  R.view.liveCtx.clearRect(0, 0, R.view.live.width, R.view.live.height);

  if (!op.points.length) { R.compositeAll(); R.requestDraw(); return; }

  if (live.kind === 'mask') {
    // The coastline is derived from the mask, so both the mask and the drawn
    // layer have to be remembered — but only inside the rectangle the stroke
    // reached, widened by the shelf and the ink line it will grow.
    const coast = layer.coast || {};
    const pad = (coast.shallow ? (coast.shallowWidth || 26) : 0) + (coast.inkWidth || 0) + 10;
    const raw = boxOf(op.points, op.size, 1 - (op.hardness || 0));
    const box = {
      x: Math.max(0, raw.x - pad), y: Math.max(0, raw.y - pad),
      x1: Math.min(app.doc.width, raw.x1 + pad), y1: Math.min(app.doc.height, raw.y1 + pad),
    };
    const canvas = R.canvasFor(layer);
    const mask = R.maskFor(layer);
    const beforeLand = snapshot(canvas, box);
    const beforeMask = snapshot(mask, box);
    R.applyLandOp(layer, op);
    layer.ops.push(op);
    R.paintLand(layer, canvas.getContext('2d'), box, raw);
    R.compositeAll(box);
    R.requestDraw();
    pushEntry({
      label: 'Landmass',
      bytes: snapBytes(beforeLand) + snapBytes(beforeMask),
      undo() {
        restore(canvas, beforeLand);
        restore(mask, beforeMask);
        const i = layer.ops.indexOf(op); if (i >= 0) layer.ops.splice(i, 1);
        R.invalidateCoast(layer, raw);
        R.compositeAll(box); R.requestDraw();
      },
      redo() {
        R.applyLandOp(layer, op);
        layer.ops.push(op);
        R.paintLand(layer, canvas.getContext('2d'), box, raw);
        R.compositeAll(box); R.requestDraw();
      },
    });
  } else if (live.kind === 'scatter') {
    const target = layer;
    const items = R.scatterItems(op).map((it) => Object.assign({ id: uid('o') }, it));
    const before = target.ops.slice();
    target.ops.push(...items);
    R.invalidate(target);
    pushEntry({
      label: 'Stamp',
      bytes: 0,
      undo() { target.ops = before.slice(); R.invalidate(target); },
      redo() { target.ops = before.concat(items); R.invalidate(target); },
    });
  } else {
    const canvas = R.canvasFor(layer);
    const box = live.box || R.opBox(op);
    const before = snapshot(canvas, box);
    const draw = () => {
      if (op.t === 'soften') R.applySoften(canvas.getContext('2d'), canvas, op, box);
      else R.applyStroke(canvas.getContext('2d'), op, box);
    };
    draw();
    layer.ops.push(op);
    R.compositeAll(box);
    R.requestDraw();
    pushEntry({
      label: LABELS[op.t] || (op.erase ? 'Erase' : 'Paint'),
      bytes: snapBytes(before),
      undo() {
        restore(canvas, before);
        const i = layer.ops.indexOf(op); if (i >= 0) layer.ops.splice(i, 1);
        R.compositeAll(box); R.requestDraw();
      },
      redo() { draw(); layer.ops.push(op); R.compositeAll(box); R.requestDraw(); },
    });
  }
  markDirty();
  scheduleAutosave();
  emit('layers');
}

function targetLayer(kinds) {
  const current = activeLayer();
  if (current && kinds.includes(current.kind) && !current.locked) return current;
  const found = app.doc.layers.find((l) => kinds.includes(l.kind) && !l.locked);
  return found || null;
}

function requireAsset(kind) {
  const id = app.settings[kind === 'terrain' ? 'activeTexture' : 'activeStamp'];
  return id || null;
}

/* --------------------------------------------------------------- the tools */

export const TOOLS = {};

function define(tool) { TOOLS[tool.id] = tool; return tool; }

define({
  id: 'brush',
  label: 'Terrain',
  icon: 'brush',
  assetKind: 'terrain',
  hint: 'Paint terrain. [ and ] change the size.',
  options: () => ([
    { key: 'size', type: 'range', label: 'Size', min: 4, max: 600, step: 1, value: S('brush', 'size', 90), suffix: 'px' },
    { key: 'hardness', type: 'range', label: 'Hardness', min: 0, max: 1, step: 0.01, value: S('brush', 'hardness', 0.55), percent: true },
    { key: 'opacity', type: 'range', label: 'Opacity', min: 0.02, max: 1, step: 0.01, value: S('brush', 'opacity', 1), percent: true },
    { key: 'texScale', type: 'range', label: 'Texture scale', min: 0.25, max: 3, step: 0.05, value: S('brush', 'texScale', 1), suffix: '×' },
    { key: 'blend', type: 'select', label: 'Blend', options: BLENDS, value: S('brush', 'blend', 'source-over') },
  ]),
  writesTo: ['raster'],
  down(pt) {
    const layer = targetLayer(['raster']);
    if (!layer) return toast('The terrain brush needs a paint layer — add one with + in the Layers panel', 'bad');
    const tex = requireAsset('terrain');
    if (!tex) return toast('Pick a terrain texture first', 'bad');
    beginPaint(layer, {
      t: 'stroke', tex, scale: S('brush', 'texScale', 1),
      size: S('brush', 'size', 90), hardness: S('brush', 'hardness', 0.55),
      opacity: S('brush', 'opacity', 1), blend: S('brush', 'blend', 'source-over'),
      points: [pt],
    }, 'paint');
    paintLive();
  },
  move(pt) { if (live.active) { pushPoint(pt, S('brush', 'size', 90)); paintLive(); } },
  up() { endPaint(); },
});

define({
  id: 'erase',
  label: 'Erase',
  icon: 'erase',
  assetKind: null,
  hint: 'Rub out paint on the selected layer.',
  options: () => ([
    { key: 'size', type: 'range', label: 'Size', min: 4, max: 600, step: 1, value: S('erase', 'size', 120), suffix: 'px' },
    { key: 'hardness', type: 'range', label: 'Hardness', min: 0, max: 1, step: 0.01, value: S('erase', 'hardness', 0.6), percent: true },
    { key: 'opacity', type: 'range', label: 'Strength', min: 0.05, max: 1, step: 0.01, value: S('erase', 'opacity', 1), percent: true },
  ]),
  writesTo: ['raster', 'land'],
  down(pt) {
    const layer = targetLayer(['raster', 'land']);
    if (!layer) return toast('Nothing to erase on this layer', 'bad');
    beginPaint(layer, {
      t: 'stroke', erase: true, size: S('erase', 'size', 120),
      hardness: S('erase', 'hardness', 0.6), opacity: S('erase', 'opacity', 1), points: [pt],
    }, layer.kind === 'land' ? 'mask' : 'paint');
    paintLive();
  },
  move(pt) { if (live.active) { pushPoint(pt, S('erase', 'size', 120)); paintLive(); } },
  up() { endPaint(); },
});

define({
  id: 'land',
  label: 'Landmass',
  icon: 'land',
  assetKind: 'terrain',
  // The texture list under this tool sets the ground the whole continent is
  // made of, not a brush colour. Picking one used to look like it did nothing,
  // because the landmass brush paints a shape and the shape is filled from the
  // layer — so now the picker says what it is for and writes there directly.
  assetTarget: 'layer',
  assetLabel: 'Ground for this landmass',
  writesTo: ['land'],
  applyAsset(id) {
    const layer = app.doc.layers.find((l) => l.kind === 'land');
    if (!layer) return;
    layer.texture = id;
    warm([id]).then(() => { R.repaintLand(layer); markDirty(); });
  },
  currentAsset() {
    const layer = app.doc.layers.find((l) => l.kind === 'land');
    return layer ? layer.texture : null;
  },
  hint: 'Paint continents. The coastline and shallows are drawn for you.',
  options: () => ([
    { key: 'size', type: 'range', label: 'Size', min: 10, max: 900, step: 1, value: S('land', 'size', 260), suffix: 'px' },
    { key: 'hardness', type: 'range', label: 'Edge', min: 0, max: 1, step: 0.01, value: S('land', 'hardness', 0.85), percent: true },
    { key: 'erase', type: 'toggle', label: 'Carve sea instead', value: S('land', 'erase', false) },
  ]),
  down(pt) {
    const layer = app.doc.layers.find((l) => l.kind === 'land');
    if (!layer) return toast('This map has no landmass layer', 'bad');
    if (layer.locked) return toast('The landmass layer is locked', 'bad');
    beginPaint(layer, {
      t: 'stroke', size: S('land', 'size', 260), hardness: S('land', 'hardness', 0.85),
      opacity: 1, erase: !!S('land', 'erase', false), points: [pt],
    }, 'mask');
    paintLive();
  },
  move(pt) { if (live.active) { pushPoint(pt, S('land', 'size', 260)); paintLive(); } },
  up() { endPaint(); },
});

define({
  id: 'stamp',
  snaps: true,
  snapTo: 'centre',
  writesTo: ['objects'],
  label: 'Stamp',
  icon: 'stamp',
  assetKind: 'stamp',
  hint: 'Click to place a symbol, drag to scatter a row of them.',
  options: () => ([
    { key: 'scale', type: 'range', label: 'Size', min: 0.2, max: 6, step: 0.05, value: S('stamp', 'scale', 1), suffix: '×' },
    { key: 'spacing', type: 'range', label: 'Spacing', min: 6, max: 200, step: 1, value: S('stamp', 'spacing', 46), suffix: 'px' },
    { key: 'jitter', type: 'range', label: 'Scatter', min: 0, max: 2, step: 0.02, value: S('stamp', 'jitter', 0.35), percent: true },
    { key: 'sizeJitter', type: 'range', label: 'Size variation', min: 0, max: 1, step: 0.02, value: S('stamp', 'sizeJitter', 0.35), percent: true },
    { key: 'rotJitter', type: 'range', label: 'Tilt', min: 0, max: 0.6, step: 0.01, value: S('stamp', 'rotJitter', 0.06) },
    { key: 'flip', type: 'toggle', label: 'Mirror some', value: S('stamp', 'flip', true) },
    { key: 'useVariants', type: 'toggle', label: 'Mix the variants', value: S('stamp', 'useVariants', true) },
  ]),
  down(pt) {
    const layer = targetLayer(['objects']);
    if (!layer) return toast('This map has no objects layer', 'bad');
    const asset = requireAsset('stamp');
    if (!asset) return toast('Pick a stamp first', 'bad');
    const assets = S('stamp', 'useVariants', true) ? variantsOf(asset) : [asset];
    warm(assets).then(() => R.requestDraw());
    beginPaint(layer, {
      t: 'scatter', assets, points: [pt],
      size: 40 * S('stamp', 'scale', 1),
      spacing: S('stamp', 'spacing', 46),
      scale: S('stamp', 'scale', 1),
      jitter: S('stamp', 'jitter', 0.35),
      sizeJitter: S('stamp', 'sizeJitter', 0.35),
      rotJitter: S('stamp', 'rotJitter', 0.06),
      flip: S('stamp', 'flip', true),
      seed: (Math.random() * 4294967295) >>> 0,
    }, 'scatter');
    paintLive();
  },
  move(pt) { if (live.active) { pushPoint(pt, 8); paintLive(); } },
  up() { endPaint(); },
});

/** starter/pine, starter/pine-2, starter/pine-3 are the same symbol drawn three
 *  times. Scattering a mix of them is what stops a forest looking stencilled. */
function variantsOf(id) {
  const base = id.replace(/-\d+$/, '');
  const found = [];
  for (const key of library.byId.keys()) {
    if (key === base || key.startsWith(base + '-')) {
      const tail = key.slice(base.length);
      if (tail === '' || /^-\d+$/.test(tail)) found.push(key);
    }
  }
  return found.length ? found : [id];
}

define({
  id: 'scatter',
  label: 'Scatter',
  icon: 'scatter',
  assetKind: 'terrain',
  writesTo: ['raster'],
  hint: 'Dabs of texture instead of a solid stroke — for broken ground, scrub, gravel.',
  options: () => ([
    { key: 'size', type: 'range', label: 'Size', min: 8, max: 500, step: 1, value: S('scatter', 'size', 120), suffix: 'px' },
    { key: 'density', type: 'range', label: 'Density', min: 1, max: 12, step: 1, value: S('scatter', 'density', 3) },
    { key: 'spacing', type: 'range', label: 'Spacing', min: 0.05, max: 2, step: 0.05, value: S('scatter', 'spacing', 0.45), percent: true },
    { key: 'jitter', type: 'range', label: 'Spread', min: 0, max: 1.6, step: 0.02, value: S('scatter', 'jitter', 0.7), percent: true },
    { key: 'sizeJitter', type: 'range', label: 'Dab variation', min: 0, max: 1, step: 0.02, value: S('scatter', 'sizeJitter', 0.5), percent: true },
    { key: 'opacity', type: 'range', label: 'Opacity', min: 0.05, max: 1, step: 0.01, value: S('scatter', 'opacity', 0.85), percent: true },
    { key: 'texScale', type: 'range', label: 'Texture scale', min: 0.25, max: 3, step: 0.05, value: S('scatter', 'texScale', 1), suffix: '×' },
  ]),
  down(pt) {
    const layer = targetLayer(['raster']);
    if (!layer) return toast('The scatter brush needs a paint layer', 'bad');
    const tex = requireAsset('terrain');
    if (!tex) return toast('Pick a terrain texture first', 'bad');
    beginPaint(layer, {
      t: 'stroke', mode: 'dabs', tex, scale: S('scatter', 'texScale', 1),
      size: S('scatter', 'size', 120), density: S('scatter', 'density', 3),
      spacing: S('scatter', 'spacing', 0.45), jitter: S('scatter', 'jitter', 0.7),
      sizeJitter: S('scatter', 'sizeJitter', 0.5), hardness: 0.5,
      opacity: S('scatter', 'opacity', 0.85),
      seed: (Math.random() * 4294967295) >>> 0, points: [pt],
    }, 'paint');
    paintLive();
  },
  move(pt) { if (live.active) { pushPoint(pt, S('scatter', 'size', 120) * 0.25); paintLive(); } },
  up() { endPaint(); },
});

define({
  id: 'soften',
  label: 'Soften',
  icon: 'soften',
  assetKind: null,
  writesTo: ['raster'],
  hint: 'Blur what is already there — for feathering a hard edge between two grounds.',
  options: () => ([
    { key: 'size', type: 'range', label: 'Size', min: 8, max: 400, step: 1, value: S('soften', 'size', 140), suffix: 'px' },
    { key: 'strength', type: 'range', label: 'Strength', min: 0.05, max: 1, step: 0.01, value: S('soften', 'strength', 0.5), percent: true },
  ]),
  down(pt) {
    const layer = targetLayer(['raster']);
    if (!layer) return toast('The soften brush needs a paint layer', 'bad');
    beginPaint(layer, {
      t: 'soften', size: S('soften', 'size', 140),
      strength: S('soften', 'strength', 0.5), points: [pt],
    }, 'soften');
    paintLive();
  },
  move(pt) { if (live.active) { pushPoint(pt, S('soften', 'size', 140)); paintLive(); } },
  up() { endPaint(); },
});

define({
  id: 'fill',
  wantsHover: true,
  label: 'Fill',
  icon: 'fill',
  assetKind: 'terrain',
  writesTo: ['raster'],
  hint: 'Flood a whole region with one texture. "Inside the landmass" tracks the coast if you redraw it.',
  options: () => ([
    { key: 'region', type: 'select', label: 'Region', value: S('fill', 'region', 'land'),
      options: [['land', 'Inside the landmass'], ['sea', 'Outside the landmass'],
                ['all', 'The whole layer'], ['poly', 'An outline I draw']] },
    { key: 'opacity', type: 'range', label: 'Opacity', min: 0.05, max: 1, step: 0.01, value: S('fill', 'opacity', 1), percent: true },
    { key: 'feather', type: 'range', label: 'Feather', min: 0, max: 1, step: 0.01, value: S('fill', 'feather', 0.1), percent: true },
    { key: 'texScale', type: 'range', label: 'Texture scale', min: 0.25, max: 3, step: 0.05, value: S('fill', 'texScale', 1), suffix: '×' },
    { key: 'blend', type: 'select', label: 'Blend', options: BLENDS, value: S('fill', 'blend', 'source-over') },
  ]),
  state: { points: [] },
  down(pt, ev) {
    const region = S('fill', 'region', 'land');
    if (region === 'poly') {
      if (ev.detail >= 2) return this.finish();
      this.state.points.push(pt);
      R.requestDraw();
      return;
    }
    this.commit(region, []);
  },
  move(pt) { this.state.hover = pt; if (this.state.points.length) R.requestDraw(); },
  up() {},
  key(ev) {
    if (!this.state.points.length) return false;
    if (ev.key === 'Enter') { this.finish(); return true; }
    if (ev.key === 'Escape') { this.state.points = []; R.requestDraw(); return true; }
    if (ev.key === 'Backspace') { this.state.points.pop(); R.requestDraw(); return true; }
    return false;
  },
  finish() {
    const pts = this.state.points;
    this.state.points = [];
    if (pts.length >= 3) this.commit('poly', pts);
    R.requestDraw();
  },
  commit(region, points) {
    const layer = targetLayer(['raster']);
    if (!layer) return toast('The fill tool needs a paint layer', 'bad');
    const tex = requireAsset('terrain');
    if (!tex) return toast('Pick a terrain texture first', 'bad');
    const op = {
      t: 'stroke', mode: 'shape', shape: region, tex,
      scale: S('fill', 'texScale', 1), opacity: S('fill', 'opacity', 1),
      blend: S('fill', 'blend', 'source-over'),
      hardness: 1 - S('fill', 'feather', 0.1), size: 0, points,
    };
    const canvas = R.canvasFor(layer);
    const box = R.opBox(op);
    const before = snapshot(canvas, box);
    R.applyStroke(canvas.getContext('2d'), op, box);
    layer.ops.push(op);
    R.compositeAll(box); R.requestDraw();
    pushEntry({
      label: 'Fill',
      bytes: snapBytes(before),
      undo() {
        restore(canvas, before);
        const i = layer.ops.indexOf(op); if (i >= 0) layer.ops.splice(i, 1);
        R.compositeAll(box); R.requestDraw();
      },
      redo() {
        R.applyStroke(canvas.getContext('2d'), op, box);
        layer.ops.push(op);
        R.compositeAll(box); R.requestDraw();
      },
    });
    markDirty(); scheduleAutosave(); emit('layers');
  },
  overlay(ctx) {
    const pts = this.state.points;
    if (!pts.length) return;
    const all = this.state.hover ? pts.concat([this.state.hover]) : pts;
    ctx.save();
    ctx.beginPath();
    all.forEach((pt, i) => {
      const sp = R.mapToScreen(pt.x, pt.y);
      if (i === 0) ctx.moveTo(sp.x, sp.y); else ctx.lineTo(sp.x, sp.y);
    });
    ctx.closePath();
    ctx.fillStyle = 'rgba(217,164,65,.16)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(217,164,65,.95)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.restore();
  },
});

define({
  id: 'shape',
  snaps: true,
  wantsHover: true,
  label: 'Shape',
  icon: 'shape',
  assetKind: 'terrain',
  writesTo: ['raster'],
  hint: 'Drag out a rectangle or an ellipse of texture. Hold Shift to keep it square.',
  options: () => ([
    { key: 'shape', type: 'select', label: 'Shape', value: S('shape', 'shape', 'rect'),
      options: [['rect', 'Rectangle'], ['ellipse', 'Ellipse']] },
    { key: 'feather', type: 'range', label: 'Feather', min: 0, max: 1, step: 0.01, value: S('shape', 'feather', 0.06), percent: true },
    { key: 'opacity', type: 'range', label: 'Opacity', min: 0.05, max: 1, step: 0.01, value: S('shape', 'opacity', 1), percent: true },
    { key: 'texScale', type: 'range', label: 'Texture scale', min: 0.25, max: 3, step: 0.05, value: S('shape', 'texScale', 1), suffix: '×' },
    { key: 'blend', type: 'select', label: 'Blend', options: BLENDS, value: S('shape', 'blend', 'source-over') },
  ]),
  down(pt) {
    const layer = targetLayer(['raster']);
    if (!layer) return toast('The shape tool needs a paint layer', 'bad');
    const tex = requireAsset('terrain');
    if (!tex) return toast('Pick a terrain texture first', 'bad');
    beginPaint(layer, {
      t: 'stroke', mode: 'shape', shape: S('shape', 'shape', 'rect'), tex,
      scale: S('shape', 'texScale', 1), opacity: S('shape', 'opacity', 1),
      blend: S('shape', 'blend', 'source-over'),
      hardness: 1 - S('shape', 'feather', 0.06), size: 0,
      points: [pt, pt],
    }, 'shape');
  },
  move(pt, ev) {
    if (!live.active) return;
    const a = live.op.points[0];
    let b = { x: pt.x, y: pt.y };
    if (ev && ev.shiftKey) {
      const d = Math.max(Math.abs(pt.x - a.x), Math.abs(pt.y - a.y));
      b = { x: a.x + Math.sign(pt.x - a.x) * d, y: a.y + Math.sign(pt.y - a.y) * d };
    }
    live.op.points[1] = b;
    paintLive();
  },
  up() { endPaint(); },
});

define({
  id: 'path',
  snaps: true,
  wantsHover: true,
  writesTo: ['paths'],
  label: 'Path',
  icon: 'path',
  assetKind: null,
  hint: 'Click along the route. Enter or double-click finishes it, Esc cancels.',
  options() {
    // Colour and width are remembered per kind: a road should not inherit the
    // blue you last picked for a river.
    const style = S('path', 'style', 'river');
    const preset = PATH_PRESETS[style];
    return [
      { key: 'style', type: 'select', label: 'Kind', value: style, rerender: true,
        options: [['river', 'River'], ['road', 'Road'], ['trail', 'Trail'], ['border', 'Border']] },
      { key: 'width_' + style, type: 'range', label: 'Width', min: 1, max: 60, step: 0.5,
        value: S('path', 'width_' + style, preset.width), suffix: 'px' },
      { key: 'color_' + style, type: 'color', label: 'Colour',
        value: S('path', 'color_' + style, preset.color) },
    ];
  },
  state: { points: [] },
  down(pt, ev) {
    const layer = targetLayer(['paths']);
    if (!layer) return toast('This map has no paths layer', 'bad');
    if (ev.detail >= 2) return this.finish();
    this.state.points.push(pt);
    R.requestDraw();
  },
  move(pt) { this.state.hover = pt; if (this.state.points.length) R.requestDraw(); },
  up() {},
  key(ev) {
    if (ev.key === 'Enter') { this.finish(); return true; }
    if (ev.key === 'Escape') { this.state.points = []; R.requestDraw(); return true; }
    if (ev.key === 'Backspace' && this.state.points.length) { this.state.points.pop(); R.requestDraw(); return true; }
    return false;
  },
  finish() {
    const pts = this.state.points;
    this.state.points = [];
    if (pts.length < 2) { R.requestDraw(); return; }
    const layer = targetLayer(['paths']);
    const style = S('path', 'style', 'river');
    const preset = PATH_PRESETS[style];
    const item = {
      id: uid('p'), style,
      width: S('path', 'width_' + style, preset.width),
      color: S('path', 'color_' + style, preset.color),
      points: pts,
    };
    const before = layer.ops.slice();
    layer.ops.push(item);
    R.invalidate(layer);
    pushEntry({
      label: 'Path',
      undo() { layer.ops = before.slice(); R.invalidate(layer); },
      redo() { layer.ops = before.concat([item]); R.invalidate(layer); },
    });
    markDirty(); scheduleAutosave(); emit('layers');
  },
  overlay(ctx) {
    const pts = this.state.points;
    if (!pts.length) return;
    const all = this.state.hover ? pts.concat([this.state.hover]) : pts;
    ctx.save();
    ctx.beginPath();
    all.forEach((p, i) => {
      const s = R.mapToScreen(p.x, p.y);
      if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
    });
    ctx.strokeStyle = 'rgba(217,164,65,.95)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const p of pts) {
      const s = R.mapToScreen(p.x, p.y);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#d9a441';
      ctx.fill();
    }
    ctx.restore();
  },
});

define({
  id: 'wall',
  snaps: true,
  wantsHover: true,
  label: 'Wall',
  icon: 'wall',
  assetKind: null,
  writesTo: ['walls'],
  hint: 'Click along a run of wall; Enter finishes it, Esc cancels. Snapping keeps it on the grid.',
  options: () => ([
    { key: 'kind', type: 'select', label: 'Kind', value: S('wall', 'kind', 'wall'),
      options: [['wall', 'Wall'], ['door', 'Door'], ['secret', 'Secret door'], ['window', 'Window']] },
    { key: 'thickness', type: 'range', label: 'Thickness', min: 2, max: 20, step: 0.5,
      value: S('wall', 'thickness', 7), suffix: 'px' },
  ]),
  state: { points: [] },
  down(pt, ev) {
    const layer = targetLayer(['walls']);
    if (!layer) return toast('This map has no walls layer — start a battle map, or add one', 'bad');
    if (ev && ev.detail >= 2) return this.finish();
    this.state.points.push(pt);
    // a door or a window is one segment: two clicks and it is placed
    if (S('wall', 'kind', 'wall') !== 'wall' && this.state.points.length === 2) this.finish();
    R.requestDraw();
  },
  move(pt) { this.state.hover = pt; if (this.state.points.length) R.requestDraw(); },
  up() {},
  key(ev) {
    if (!this.state.points.length) return false;
    if (ev.key === 'Enter') { this.finish(); return true; }
    if (ev.key === 'Escape') { this.state.points = []; R.requestDraw(); return true; }
    if (ev.key === 'Backspace') { this.state.points.pop(); R.requestDraw(); return true; }
    return false;
  },
  finish() {
    const pts = this.state.points;
    this.state.points = [];
    if (pts.length < 2) { R.requestDraw(); return; }
    const layer = targetLayer(['walls']);
    if (!layer) return;
    const item = { id: uid('w'), kind: S('wall', 'kind', 'wall'), points: pts };
    layer.thickness = S('wall', 'thickness', 7);
    const before = layer.ops.slice();
    layer.ops.push(item);
    R.invalidate(layer);
    pushEntry({
      label: 'Wall',
      undo() { layer.ops = before.slice(); R.invalidate(layer); },
      redo() { layer.ops = before.concat([item]); R.invalidate(layer); },
    });
    markDirty(); scheduleAutosave(); emit('layers');
  },
  overlay(ctx) {
    const pts = this.state.points;
    if (!pts.length) return;
    const all = this.state.hover ? pts.concat([this.state.hover]) : pts;
    ctx.save();
    ctx.beginPath();
    all.forEach((pt, i) => {
      const sp = R.mapToScreen(pt.x, pt.y);
      if (i === 0) ctx.moveTo(sp.x, sp.y); else ctx.lineTo(sp.x, sp.y);
    });
    ctx.strokeStyle = 'rgba(217,164,65,.95)';
    ctx.lineWidth = 2;
    ctx.stroke();
    for (const pt of pts) {
      const sp = R.mapToScreen(pt.x, pt.y);
      ctx.fillStyle = '#d9a441';
      ctx.fillRect(sp.x - 3, sp.y - 3, 6, 6);
    }
    ctx.restore();
  },
});

define({
  id: 'measure',
  snaps: true,
  wantsHover: true,
  label: 'Measure',
  icon: 'measure',
  assetKind: null,
  hint: 'Drag to measure. Distances use the map scale set in the Map panel.',
  options: () => ([]),
  state: { from: null, to: null },
  down(pt) { this.state.from = pt; this.state.to = pt; R.requestDraw(); },
  move(pt) { if (this.state.from) { this.state.to = pt; R.requestDraw(); } },
  up() {},
  key(ev) {
    if (ev.key === 'Escape' && this.state.from) { this.state.from = null; R.requestDraw(); return true; }
    return false;
  },
  overlay(ctx) {
    const { from, to } = this.state;
    if (!from || !to) return;
    const a = R.mapToScreen(from.x, from.y), b = R.mapToScreen(to.x, to.y);
    const pixels = Math.hypot(to.x - from.x, to.y - from.y);
    ctx.save();
    ctx.strokeStyle = '#d9a441';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const pt of [a, b]) {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#d9a441';
      ctx.fill();
    }
    const text = distanceLabel(app.doc, pixels);
    ctx.font = '600 12px ui-monospace, monospace';
    const w = ctx.measureText(text).width + 14;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    ctx.fillStyle = 'rgba(16,18,22,.9)';
    ctx.strokeStyle = '#3d4450';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(mx - w / 2, my - 22, w, 20, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#e7eaf0';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, mx, my - 12);
    ctx.restore();
  },
});

define({
  id: 'label',
  writesTo: ['labels'],
  label: 'Label',
  icon: 'text',
  assetKind: null,
  hint: 'Click where the name goes.',
  options: () => ([
    { key: 'style', type: 'select', label: 'Style', value: S('label', 'style', 'settlement'),
      options: [['title', 'Map title'], ['region', 'Region'], ['settlement', 'Settlement'], ['water', 'Water']] },
    { key: 'size', type: 'range', label: 'Size', min: 8, max: 160, step: 1, value: S('label', 'size', 24), suffix: 'px' },
    { key: 'color', type: 'color', label: 'Colour', value: S('label', 'color', '#3a2c1e') },
    { key: 'halo', type: 'toggle', label: 'Halo behind text', value: S('label', 'halo', true) },
  ]),
  async down(pt) {
    const layer = targetLayer(['labels']);
    if (!layer) return toast('This map has no labels layer', 'bad');
    const input = el('input', { type: 'text', placeholder: 'Name', value: '' });
    const body = el('div', {}, [el('div', { class: 'field' }, [el('label', { text: 'Text' }), input])]);
    let text = null;
    await modal({
      title: 'Add a label', body,
      buttons: [
        { label: 'Cancel' },
        { label: 'Place', class: 'btn-primary', onClick: () => { text = input.value.trim(); } },
      ],
    });
    if (!text) return;
    const item = {
      id: uid('t'), text, x: pt.x, y: pt.y,
      style: S('label', 'style', 'settlement'), size: S('label', 'size', 24),
      color: S('label', 'color', '#3a2c1e'), halo: S('label', 'halo', true), rot: 0,
    };
    const before = layer.ops.slice();
    layer.ops.push(item);
    R.invalidate(layer);
    pushEntry({
      label: 'Label',
      undo() { layer.ops = before.slice(); R.invalidate(layer); },
      redo() { layer.ops = before.concat([item]); R.invalidate(layer); },
    });
    markDirty(); scheduleAutosave(); emit('layers');
  },
  move() {}, up() {},
});

define({
  id: 'select',
  label: 'Select',
  icon: 'select',
  assetKind: null,
  hint: 'Drag a stamp, path or label to move it. Delete removes it.',
  options: () => ([]),
  state: { grabbed: null, offset: null, layer: null },
  down(pt) {
    const hit = hitTest(pt);
    this.state.grabbed = hit ? hit.item : null;
    this.state.layer = hit ? hit.layer : null;
    if (hit) {
      this.state.offset = { x: pt.x - (hit.item.x ?? hit.item.points[0].x), y: pt.y - (hit.item.y ?? hit.item.points[0].y) };
      this.state.before = JSON.parse(JSON.stringify(hit.item));
    }
    R.requestDraw();
  },
  move(pt) {
    const { grabbed, offset, layer } = this.state;
    if (!grabbed || !offset) return;
    if (grabbed.points) {
      const dx = pt.x - offset.x - grabbed.points[0].x;
      const dy = pt.y - offset.y - grabbed.points[0].y;
      for (const p of grabbed.points) { p.x += dx; p.y += dy; }
    } else {
      grabbed.x = pt.x - offset.x;
      grabbed.y = pt.y - offset.y;
    }
    R.invalidate(layer);
  },
  up() {
    const { grabbed, layer, before } = this.state;
    if (grabbed && before) {
      const after = JSON.parse(JSON.stringify(grabbed));
      pushEntry({
        label: 'Move',
        undo() { Object.assign(grabbed, before); R.invalidate(layer); },
        redo() { Object.assign(grabbed, after); R.invalidate(layer); },
      });
      markDirty(); scheduleAutosave();
    }
    this.state.offset = null;
  },
  key(ev) {
    const { grabbed, layer } = this.state;
    if (!grabbed || (ev.key !== 'Delete' && ev.key !== 'Backspace')) return false;
    const before = layer.ops.slice();
    layer.ops = layer.ops.filter((o) => o !== grabbed);
    const after = layer.ops.slice();
    this.state.grabbed = null;
    R.invalidate(layer);
    pushEntry({
      label: 'Delete',
      undo() { layer.ops = before.slice(); R.invalidate(layer); },
      redo() { layer.ops = after.slice(); R.invalidate(layer); },
    });
    markDirty(); scheduleAutosave();
    return true;
  },
  overlay(ctx) {
    const g = this.state.grabbed;
    if (!g) return;
    ctx.save();
    ctx.strokeStyle = '#d9a441';
    ctx.lineWidth = 1.5;
    if (g.points) {
      ctx.beginPath();
      g.points.forEach((p, i) => {
        const s = R.mapToScreen(p.x, p.y);
        if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
      });
      ctx.stroke();
    } else {
      const s = R.mapToScreen(g.x, g.y);
      ctx.strokeRect(s.x - 14, s.y - 26, 28, 28);
    }
    ctx.restore();
  },
});

define({
  id: 'pan',
  label: 'Pan',
  icon: 'pan',
  assetKind: null,
  hint: 'Drag to move the map. Space does this from any tool.',
  options: () => ([]),
  down() {}, move() {}, up() {},
});

/* ------------------------------------------------------------- hit testing */

function hitTest(pt) {
  for (let i = app.doc.layers.length - 1; i >= 0; i--) {
    const layer = app.doc.layers[i];
    if (!layer.visible || layer.locked) continue;
    if (layer.kind === 'objects') {
      for (let j = layer.ops.length - 1; j >= 0; j--) {
        const item = layer.ops[j];
        const img = imageNow(item.asset);
        const w = (img ? img.width : 40) * item.scale, h = (img ? img.height : 40) * item.scale;
        if (pt.x >= item.x - w / 2 && pt.x <= item.x + w / 2 && pt.y >= item.y - h && pt.y <= item.y) {
          return { layer, item };
        }
      }
    } else if (layer.kind === 'labels') {
      for (let j = layer.ops.length - 1; j >= 0; j--) {
        const item = layer.ops[j];
        const w = (item.text || '').length * (item.size || 24) * 0.62;
        if (Math.abs(pt.x - item.x) < w / 2 && Math.abs(pt.y - item.y) < (item.size || 24) * 0.8) {
          return { layer, item };
        }
      }
    } else if (layer.kind === 'paths') {
      for (let j = layer.ops.length - 1; j >= 0; j--) {
        const item = layer.ops[j];
        for (const p of item.points) {
          if (Math.hypot(p.x - pt.x, p.y - pt.y) < Math.max(10, item.width)) return { layer, item };
        }
      }
    }
  }
  return null;
}

/* ------------------------------------------------------------------ helper */

function pushPoint(pt, size) {
  const pts = live.op.points;
  const last = pts[pts.length - 1];
  const min = Math.max(1.2, size * 0.06);
  if (!last || Math.hypot(pt.x - last.x, pt.y - last.y) >= min) pts.push(pt);
}

export function currentTool() { return TOOLS[app.tool] || TOOLS.brush; }

/** The layer a tool will actually write to, given what is selected. */
export function toolTarget(tool) {
  if (!tool.writesTo || !app.doc) return null;
  const current = activeLayer();
  if (current && tool.writesTo.includes(current.kind)) return current;
  return app.doc.layers.find((l) => tool.writesTo.includes(l.kind)) || null;
}

/** Given a layer, the tool that edits it. Used when selecting a layer whose
 *  contents the current tool cannot touch. */
export function toolForLayer(layer) {
  if (!layer) return null;
  for (const tool of Object.values(TOOLS)) {
    if (tool.writesTo && tool.writesTo[0] === layer.kind) return tool.id;
  }
  return null;
}

export function setTool(id) {
  const previous = TOOLS[app.tool];
  if (previous && previous.finish && previous.state && previous.state.points && previous.state.points.length) {
    previous.finish();
  }
  app.tool = TOOLS[id] ? id : 'brush';
  emit('tool');
  R.requestDraw();
}

export { live, endPaint };
