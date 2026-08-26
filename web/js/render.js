/* The renderer.
 *
 * Every layer owns an offscreen canvas at map resolution. Those are composited
 * into one flat canvas, and the flat canvas is what gets blitted to the screen
 * under the view transform — so panning and zooming never re-run any painting,
 * and a brush stroke only re-composites the rectangle it touched.
 */

import { imageNow, pattern } from './assets.js';
import { LAYER_KINDS } from './doc.js';
import { clamp, makeCanvas, rng } from './util.js';

export const view = {
  canvas: null, ctx: null, dpr: 1,
  x: 0, y: 0, zoom: 1,
  doc: null,
  flat: null, flatCtx: null,
  live: null, liveCtx: null,          // the stroke in progress
  liveMask: null, liveMaskCtx: null,
  liveLayer: null, liveBox: null,
  cursor: null,                        // {x, y, r} in map space, for the brush ring
  onAfterDraw: null,
};

const layerCanvases = new Map();
let drawQueued = false;

/* Scratch canvases, kept and reused. Allocating a two-megapixel canvas costs
   more than most of the drawing done on it, and the coastline needs several
   per repaint. */
const scratchPool = new Map();
function scratch(slot, w, h) {
  const key = slot + ':' + w + 'x' + h;
  let c = scratchPool.get(key);
  if (!c) {
    c = makeCanvas(w, h);
    scratchPool.set(key, c);
    if (scratchPool.size > 24) scratchPool.delete(scratchPool.keys().next().value);
  } else {
    c.getContext('2d').clearRect(0, 0, w, h);
  }
  const ctx = c.getContext('2d');
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  return c;
}

/** Round a rectangle out to a grid. Two things fall out of this: scratch
 *  canvases come in repeatable sizes so the pool actually hits, and the
 *  downscaled shelf lands on whole source pixels, which is what keeps a
 *  partial repaint identical to a full one. */
function snapBox(box, grid) {
  return {
    x: Math.max(0, Math.floor(box.x / grid) * grid),
    y: Math.max(0, Math.floor(box.y / grid) * grid),
    x1: Math.min(view.doc.width, Math.ceil(box.x1 / grid) * grid),
    y1: Math.min(view.doc.height, Math.ceil(box.y1 / grid) * grid),
  };
}

/* ------------------------------------------------------------------ set-up */

export function initRender(canvasEl) {
  view.canvas = canvasEl;
  view.ctx = canvasEl.getContext('2d');
  resize();
  window.addEventListener('resize', () => { resize(); requestDraw(); });
}

export function resize() {
  const c = view.canvas;
  const rect = c.parentElement.getBoundingClientRect();
  view.dpr = Math.min(window.devicePixelRatio || 1, 2);
  c.width = Math.max(1, Math.round(rect.width * view.dpr));
  c.height = Math.max(1, Math.round(rect.height * view.dpr));
}

export function setDocument(doc) {
  view.doc = doc;
  layerCanvases.clear();
  view.flat = makeCanvas(doc.width, doc.height);
  view.flatCtx = view.flat.getContext('2d');
  view.live = makeCanvas(doc.width, doc.height);
  view.liveCtx = view.live.getContext('2d');
  view.liveMask = makeCanvas(doc.width, doc.height);
  view.liveMaskCtx = view.liveMask.getContext('2d');
  for (const layer of doc.layers) rebuildLayer(layer);
  compositeAll();
}

export function canvasFor(layer) {
  let c = layerCanvases.get(layer.id);
  if (!c) {
    c = makeCanvas(view.doc.width, view.doc.height);
    layerCanvases.set(layer.id, c);
  }
  return c;
}

export function maskFor(layer) {
  const key = layer.id + ':mask';
  let c = layerCanvases.get(key);
  if (!c) {
    c = makeCanvas(view.doc.width, view.doc.height);
    layerCanvases.set(key, c);
  }
  return c;
}

/* --------------------------------------------------------------- view maths */

export function screenToMap(sx, sy) {
  return { x: (sx - view.x) / view.zoom, y: (sy - view.y) / view.zoom };
}

export function mapToScreen(mx, my) {
  return { x: mx * view.zoom + view.x, y: my * view.zoom + view.y };
}

export function fitView(margin = 28) {
  const w = view.canvas.width / view.dpr, h = view.canvas.height / view.dpr;
  const z = Math.min((w - margin * 2) / view.doc.width, (h - margin * 2) / view.doc.height);
  view.zoom = z;
  view.x = (w - view.doc.width * z) / 2;
  view.y = (h - view.doc.height * z) / 2;
  requestDraw();
}

export function zoomAt(sx, sy, factor) {
  const before = screenToMap(sx, sy);
  view.zoom = clamp(view.zoom * factor, 0.03, 16);
  const after = screenToMap(sx, sy);
  view.x += (after.x - before.x) * view.zoom;
  view.y += (after.y - before.y) * view.zoom;
  requestDraw();
}

/* -------------------------------------------------------------- brush paths */

function strokePath(ctx, points, width, softness) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = width;
  ctx.strokeStyle = '#fff';
  ctx.fillStyle = '#fff';
  if (softness > 0.01) ctx.filter = `blur(${(softness * width * 0.25).toFixed(2)}px)`;
  if (points.length === 1) {
    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, width / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length - 1; i++) {
      const mx = (points[i].x + points[i + 1].x) / 2;
      const my = (points[i].y + points[i + 1].y) / 2;
      ctx.quadraticCurveTo(points[i].x, points[i].y, mx, my);
    }
    const last = points[points.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
  }
  ctx.restore();
}

/** Every brush here is the same pipeline — draw a shape, pour a texture into
 *  it — and they differ only in the shape. This is that shape. */
function drawBrushMask(ctx, op) {
  const soft = op.hardness != null ? 1 - op.hardness : 0.35;
  if (op.mode === 'dabs') return dabMask(ctx, op, soft);
  if (op.mode === 'shape') return shapeMask(ctx, op, soft);
  return strokePath(ctx, op.points, op.size, soft);
}

/** Separate dabs rather than a continuous line: broken, mottled coverage, the
 *  way ground cover actually reads on a map. */
function dabMask(ctx, op, soft) {
  const rand = rng(op.seed || 1);
  const spacing = Math.max(2, op.size * (op.spacing != null ? op.spacing : 0.5));
  const jitter = op.jitter != null ? op.jitter : 0.7;
  ctx.save();
  ctx.fillStyle = '#fff';
  if (soft > 0.01) ctx.filter = 'blur(' + (soft * op.size * 0.16).toFixed(2) + 'px)';
  const dab = (x, y) => {
    const r = (op.size / 2) * (0.3 + rand() * 0.5) * (1 + (op.sizeJitter || 0) * (rand() - 0.5) * 2);
    ctx.beginPath();
    ctx.arc(x + (rand() - 0.5) * op.size * jitter, y + (rand() - 0.5) * op.size * jitter,
            Math.max(1, r), 0, Math.PI * 2);
    ctx.fill();
  };
  const pts = op.points;
  const density = Math.max(1, op.density || 3);
  if (pts.length === 1) for (let i = 0; i < density * 3; i++) dab(pts[0].x, pts[0].y);
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    let t = carry;
    while (t < seg) {
      const f = t / (seg || 1);
      for (let k = 0; k < density; k++) dab(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f);
      t += spacing;
    }
    carry = t - seg;
  }
  ctx.restore();
}

function shapeMask(ctx, op, soft) {
  const pts = op.points;
  ctx.save();
  ctx.fillStyle = '#fff';
  if (soft > 0.01) ctx.filter = 'blur(' + (soft * 14).toFixed(2) + 'px)';
  ctx.beginPath();
  if (op.shape === 'ellipse' && pts.length >= 2) {
    ctx.ellipse((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2,
                Math.abs(pts[1].x - pts[0].x) / 2, Math.abs(pts[1].y - pts[0].y) / 2,
                0, 0, Math.PI * 2);
  } else if (op.shape === 'rect' && pts.length >= 2) {
    ctx.rect(Math.min(pts[0].x, pts[1].x), Math.min(pts[0].y, pts[1].y),
             Math.abs(pts[1].x - pts[0].x), Math.abs(pts[1].y - pts[0].y));
  } else if (op.shape === 'land' || op.shape === 'sea') {
    // Bound to the landmass rather than to a frozen outline: redraw the coast
    // and the fill follows it, which is what you want when the whole point of
    // the fill was "this continent is grassland".
    const land = view.doc.layers.find((l) => l.kind === 'land');
    ctx.restore();
    if (!land) return;
    const mask = maskFor(land);
    if (op.shape === 'land') {
      ctx.drawImage(mask, 0, 0);
    } else {
      ctx.save();
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, view.doc.width, view.doc.height);
      ctx.globalCompositeOperation = 'destination-out';
      ctx.drawImage(mask, 0, 0);
      ctx.restore();
    }
    return;
  } else if (op.shape === 'all') {
    ctx.rect(0, 0, view.doc.width, view.doc.height);
  } else {
    pts.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
    ctx.closePath();
  }
  ctx.fill();
  ctx.restore();
}

export function shapeBox(op, pad = 30) {
  if (op.shape === 'land' || op.shape === 'sea' || op.shape === 'all' || !op.points.length) {
    return { x: 0, y: 0, x1: view.doc.width, y1: view.doc.height };
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const pt of op.points) {
    x0 = Math.min(x0, pt.x); x1 = Math.max(x1, pt.x);
    y0 = Math.min(y0, pt.y); y1 = Math.max(y1, pt.y);
  }
  return {
    x: Math.max(0, Math.floor(x0 - pad)), y: Math.max(0, Math.floor(y0 - pad)),
    x1: Math.min(view.doc.width, Math.ceil(x1 + pad)),
    y1: Math.min(view.doc.height, Math.ceil(y1 + pad)),
  };
}

export function strokeBox(points, width, softness, pad = 4) {
  const grow = width / 2 + softness * width * 0.5 + pad;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of points) {
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
  }
  return {
    x: Math.max(0, Math.floor(x0 - grow)),
    y: Math.max(0, Math.floor(y0 - grow)),
    w: 0, h: 0,
    x1: Math.min(view.doc.width, Math.ceil(x1 + grow)),
    y1: Math.min(view.doc.height, Math.ceil(y1 + grow)),
  };
}

/** Paint one stroke op onto a context, textured and soft-edged.
 *  The mask is drawn first and the texture poured into it, so overlapping
 *  segments inside a single stroke never darken each other. */
export function applyStroke(targetCtx, op, box) {
  const w = view.doc.width, h = view.doc.height;
  const bx = box ? box.x : 0, by = box ? box.y : 0;
  const bw = box ? box.x1 - box.x : w, bh = box ? box.y1 - box.y : h;
  if (bw <= 0 || bh <= 0) return;

  const mask = makeCanvas(bw, bh);
  const mctx = mask.getContext('2d');
  mctx.translate(-bx, -by);
  drawBrushMask(mctx, op);

  if (op.erase) {
    targetCtx.save();
    targetCtx.globalCompositeOperation = 'destination-out';
    targetCtx.globalAlpha = op.opacity != null ? op.opacity : 1;
    targetCtx.drawImage(mask, bx, by);
    targetCtx.restore();
    return;
  }

  const paint = makeCanvas(bw, bh);
  const pctx = paint.getContext('2d');
  const pat = op.tex ? pattern(pctx, op.tex, op.scale || 1) : null;
  if (pat) {
    pctx.save();
    pctx.translate(-bx, -by);
    pctx.fillStyle = pat;
    pctx.fillRect(bx, by, bw, bh);
    pctx.restore();
  } else {
    pctx.fillStyle = op.color || '#888';
    pctx.fillRect(0, 0, bw, bh);
  }
  pctx.globalCompositeOperation = 'destination-in';
  pctx.drawImage(mask, 0, 0);

  targetCtx.save();
  targetCtx.globalCompositeOperation = op.blend || 'source-over';
  targetCtx.globalAlpha = op.opacity != null ? op.opacity : 1;
  targetCtx.drawImage(paint, bx, by);
  targetCtx.restore();
}

/** A mask-only stroke, for the landmass layer. */
export function applyMaskStroke(maskCtx, op, box) {
  const bx = box ? box.x : 0, by = box ? box.y : 0;
  maskCtx.save();
  maskCtx.globalCompositeOperation = op.erase ? 'destination-out' : 'source-over';
  maskCtx.globalAlpha = op.opacity != null ? op.opacity : 1;
  strokePath(maskCtx, op.points, op.size, op.hardness != null ? 1 - op.hardness : 0.2);
  maskCtx.restore();
}

/* ------------------------------------------------------------ scatter brush */

export function applyScatter(ctx, op) {
  const rand = rng(op.seed || 1);
  for (const item of scatterItems(op, rand)) {
    const img = imageNow(item.asset);
    if (!img) continue;
    drawSprite(ctx, img, item);
  }
}

export function scatterItems(op, rand = rng(op.seed || 1)) {
  const out = [];
  const spacing = Math.max(4, op.spacing || op.size * 0.5);
  let carry = 0;
  const pts = op.points;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    let t = carry;
    while (t < seg) {
      const f = t / (seg || 1);
      const jitter = (op.jitter || 0) * op.size;
      out.push({
        asset: op.assets[(rand() * op.assets.length) | 0],
        x: a.x + (b.x - a.x) * f + (rand() - 0.5) * jitter,
        y: a.y + (b.y - a.y) * f + (rand() - 0.5) * jitter,
        scale: (op.scale || 1) * (1 + (rand() - 0.5) * (op.sizeJitter || 0)),
        rot: (rand() - 0.5) * (op.rotJitter || 0),
        flip: op.flip && rand() < 0.5,
      });
      t += spacing * (0.7 + rand() * 0.6);
    }
    carry = t - seg;
  }
  if (!out.length && pts.length) {
    out.push({ asset: op.assets[0], x: pts[0].x, y: pts[0].y, scale: op.scale || 1, rot: 0 });
  }
  return out;
}

export function drawSprite(ctx, img, item) {
  const w = img.width * item.scale;
  const h = img.height * item.scale;
  ctx.save();
  ctx.translate(item.x, item.y);
  if (item.rot) ctx.rotate(item.rot);
  if (item.flip) ctx.scale(-1, 1);
  if (item.opacity != null) ctx.globalAlpha = item.opacity;
  ctx.drawImage(img, -w / 2, -h, w, h);      // anchored at the foot, like a map symbol
  ctx.restore();
}

/* ------------------------------------------------------------ layer drawing */

export function rebuildLayer(layer) {
  const c = canvasFor(layer);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);

  switch (layer.kind) {
    case 'water':
    case 'floor':   return renderFill(layer, ctx);
    case 'land':    return renderLand(layer, ctx);
    case 'raster':  return renderRaster(layer, ctx);
    case 'objects': return renderObjects(layer, ctx);
    case 'paths':   return renderPaths(layer, ctx);
    case 'walls':   return renderWalls(layer, ctx);
    case 'labels':  return renderLabels(layer, ctx);
    case 'grid':    return renderGrid(layer, ctx);
    case 'paper':   return renderPaper(layer, ctx);
    default:
      // A kind an extension taught us about.
      if (view.renderCustomLayer) view.renderCustomLayer(layer, ctx);
      return undefined;
  }
}

function renderFill(layer, ctx) {
  const pat = layer.texture ? pattern(ctx, layer.texture, layer.scale || 1) : null;
  ctx.fillStyle = pat || layer.color || '#2a4f74';
  ctx.fillRect(0, 0, view.doc.width, view.doc.height);
}

export function opBox(op) {
  if (op.mode === 'shape') return shapeBox(op);
  return strokeBox(op.points, op.size, 1 - (op.hardness || 0));
}

/** Blur what is already on the layer, under the brush. Unlike every other
 *  brush this one reads the layer it draws on, which is why it has to be
 *  replayed in order when a layer is rebuilt from its ops. */
export function applySoften(targetCtx, canvas, op, box) {
  const bw = box.x1 - box.x, bh = box.y1 - box.y;
  if (bw <= 0 || bh <= 0) return;
  const blurred = scratch('soften', bw, bh);
  const bctx = blurred.getContext('2d');
  bctx.filter = 'blur(' + Math.max(0.5, (op.strength || 0.5) * 10).toFixed(1) + 'px)';
  bctx.drawImage(canvas, box.x, box.y, bw, bh, 0, 0, bw, bh);
  bctx.filter = 'none';
  const mask = scratch('softenmask', bw, bh);
  const mctx = mask.getContext('2d');
  mctx.translate(-box.x, -box.y);
  strokePath(mctx, op.points, op.size, 0.7);
  bctx.globalCompositeOperation = 'destination-in';
  bctx.drawImage(mask, 0, 0);
  targetCtx.drawImage(blurred, box.x, box.y);
}

function renderRaster(layer, ctx) {
  for (const op of layer.ops) {
    if (op.t === 'soften') applySoften(ctx, ctx.canvas, op, opBox(op));
    else if (op.t === 'stroke') applyStroke(ctx, op, opBox(op));
    else if (op.t === 'scatter') applyScatter(ctx, op);
    else if (op.t === 'fill') {
      ctx.save();
      ctx.fillStyle = pattern(ctx, op.tex, op.scale || 1) || op.color || '#888';
      ctx.globalAlpha = op.opacity != null ? op.opacity : 1;
      ctx.fillRect(0, 0, view.doc.width, view.doc.height);
      ctx.restore();
    } else if (op.t === 'clear') {
      ctx.clearRect(0, 0, view.doc.width, view.doc.height);
    }
  }
}

/* The coastline is expensive to grow and cheap to recolour, so the two are
   separated: the shelf and the ink line are cached as plain alpha, keyed to the
   geometry that produced them, and colour is applied when they are drawn. That
   is why dragging a colour picker is instant while dragging a width slider is
   not. */
function geometryKey(layer) {
  const c = layer.coast || {};
  return [c.shallow ? 1 : 0, c.shallowWidth || 0, c.shallowSteps || 0,
          c.ink ? 1 : 0, c.inkWidth || 0].join('/');
}

/* The shelf and the ink line are kept as plain alpha, and colour is applied
   when they are drawn. Three different things can invalidate them, and they
   cost very different amounts:
     - a coast colour changed        nothing to rebuild
     - a stroke was painted          the shelf, and the ink under that stroke
     - a width or the whole map      everything
   Treating those as one case is what made dragging a colour picker crawl. */
function coastShape(layer, mask, dirty) {
  const slot = layer.id + ':shape';
  let shape = layerCanvases.get(slot);
  const key = geometryKey(layer);
  const coast = layer.coast || {};

  if (!shape || shape.key !== key || shape.width !== mask.width) {
    shape = {
      key,
      width: mask.width,
      shelf: makeCanvas(Math.ceil(mask.width * SHELF_SCALE), Math.ceil(mask.height * SHELF_SCALE)),
      ink: makeCanvas(mask.width, mask.height),
    };
    layerCanvases.set(slot, shape);
    dirty = { x: 0, y: 0, x1: mask.width, y1: mask.height };
  }
  if (!dirty) return shape;

  if (coast.shallow) growShelf(layer, mask, coast, shape.shelf);
  else shape.shelf.getContext('2d').clearRect(0, 0, shape.shelf.width, shape.shelf.height);

  if (coast.ink) growInk(mask, coast, shape.ink, dirty);
  else shape.ink.getContext('2d').clearRect(0, 0, shape.ink.width, shape.ink.height);

  return shape;
}

/** Concentric dilations of the mask, stacked. A sea chart shows depth in steps,
 *  and the banding is what reads as shallow water rather than as a halo. Always
 *  whole-canvas: it is small enough that partial work would not pay, and the
 *  fixed grid is what keeps a repaint identical to a fresh load. */
function growShelf(layer, mask, coast, out) {
  const ctx = out.getContext('2d');
  ctx.clearRect(0, 0, out.width, out.height);
  const small = smallMask(layer, mask);
  const width = coast.shallowWidth || 26;
  const steps = Math.max(1, coast.shallowSteps || 3);
  for (let i = steps; i >= 1; i--) {
    const grown = dilate(small, width * (i / steps) * SHELF_SCALE, 12, 'band');
    ctx.globalAlpha = 0.34;
    ctx.drawImage(grown, 0, 0);
  }
  ctx.globalAlpha = 1;
}

/** The ring between the mask and itself grown by the line width, rebuilt only
 *  inside the rectangle the mask actually changed. The crop carries a margin
 *  the width of the line, so the ring inside that rectangle is what a
 *  whole-canvas rebuild would have produced. */
function growInk(mask, coast, out, dirty) {
  const r = coast.inkWidth || 2.5;
  const box = snapBox(dirty, SHELF_GRID);
  const m = SHELF_GRID;
  const wide = snapBox({ x: box.x - m, y: box.y - m, x1: box.x1 + m, y1: box.y1 + m }, SHELF_GRID);
  const bw = box.x1 - box.x, bh = box.y1 - box.y;
  if (bw <= 0 || bh <= 0) return;
  const crop = region(mask, wide, 1, 'inkcrop');
  const ring = dilate(crop, r, 8, 'ink');
  const rctx = ring.getContext('2d');
  rctx.globalCompositeOperation = 'destination-out';
  rctx.drawImage(crop, 0, 0);
  const ctx = out.getContext('2d');
  ctx.clearRect(box.x, box.y, bw, bh);
  ctx.drawImage(ring, box.x - wide.x, box.y - wide.y, bw, bh, box.x, box.y, bw, bh);
}

/** Draw a region of a cached alpha mask, tinted. */
function tintInto(ctx, alpha, srcScale, colour, box, bw, bh) {
  const tint = scratch('tint', bw, bh);
  const tctx = tint.getContext('2d');
  tctx.drawImage(alpha,
                 box.x * srcScale, box.y * srcScale, bw * srcScale, bh * srcScale,
                 0, 0, bw, bh);
  tctx.globalCompositeOperation = 'source-in';
  tctx.fillStyle = colour;
  tctx.fillRect(0, 0, bw, bh);
  ctx.drawImage(tint, box.x, box.y);
}

export function rebuildLandMask(layer) {
  const mask = maskFor(layer);
  const mctx = mask.getContext('2d');
  mctx.clearRect(0, 0, mask.width, mask.height);
  for (const op of layer.ops) {
    if (op.t === 'stroke') applyMaskStroke(mctx, op, null);
    else if (op.t === 'clear') mctx.clearRect(0, 0, mask.width, mask.height);
  }
  layer.__maskVersion = (layer.__maskVersion | 0) + 1;
  return mask;
}

/** The area a layer's strokes actually cover, so none of the coastline work
 *  touches the empty half of a 2048-pixel canvas. */
function opsBox(layer, pad) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const op of layer.ops) {
    // The same reach strokeBox uses. A soft brush lays down alpha well beyond
    // half its width, and a box that stops at the nominal edge clips the mask —
    // which showed up as a map that changed slightly when it was reloaded.
    const soft = 1 - (op.hardness || 0);
    const grow = (op.size || 0) / 2 + soft * (op.size || 0) * 0.5 + 4;
    for (const pt of op.points || []) {
      if (pt.x - grow < x0) x0 = pt.x - grow;
      if (pt.x + grow > x1) x1 = pt.x + grow;
      if (pt.y - grow < y0) y0 = pt.y - grow;
      if (pt.y + grow > y1) y1 = pt.y + grow;
    }
  }
  if (x1 < x0) return null;
  return {
    x: Math.max(0, Math.floor(x0 - pad)),
    y: Math.max(0, Math.floor(y0 - pad)),
    x1: Math.min(view.doc.width, Math.ceil(x1 + pad)),
    y1: Math.min(view.doc.height, Math.ceil(y1 + pad)),
  };
}

/** Copy a rectangle of a mask into its own canvas, optionally shrunk. Working
 *  small is what makes the shelf affordable: it is a soft, large-scale feature
 *  and nobody can tell it was computed at a third of the resolution. */
function region(mask, box, scale, slot) {
  const bw = box.x1 - box.x, bh = box.y1 - box.y;
  const c = scratch(slot || 'region', Math.max(1, Math.ceil(bw * scale)), Math.max(1, Math.ceil(bh * scale)));
  c.getContext('2d').drawImage(mask, box.x, box.y, bw, bh, 0, 0, c.width, c.height);
  return c;
}

const SHELF_SCALE = 0.25;
const SHELF_GRID = 64;      // boxes snap to this, so 0.25 lands on whole pixels

/** A whole-canvas copy of the land mask at shelf resolution, refreshed in one
 *  draw whenever the coastline is repainted. */
function smallMask(layer, mask) {
  const key = layer.id + ':small';
  let c = layerCanvases.get(key);
  if (!c || c.width !== Math.ceil(mask.width * SHELF_SCALE)) {
    c = makeCanvas(Math.ceil(mask.width * SHELF_SCALE), Math.ceil(mask.height * SHELF_SCALE));
    layerCanvases.set(key, c);
  }
  const cx = c.getContext('2d');
  cx.clearRect(0, 0, c.width, c.height);
  cx.drawImage(mask, 0, 0, c.width, c.height);
  return c;
}

/** Grow a mask by r pixels by stamping it round a circle. */
function dilate(src, r, steps, slot) {
  const out = scratch(slot || 'dilate', src.width, src.height);
  const ctx = out.getContext('2d');
  ctx.drawImage(src, 0, 0);
  if (r <= 0.4) return out;
  const n = steps || Math.max(8, Math.min(20, Math.ceil(r * 2)));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    ctx.drawImage(src, Math.cos(a) * r, Math.sin(a) * r);
  }
  return out;
}

/** The landmass layer is the reason maps made here look like maps: a painted
 *  mask, a banded shallow-water shelf derived from it, the land texture poured
 *  into it, and an ink line traced round the edge. */
function renderLand(layer, ctx) {
  rebuildLandMask(layer);
  const coast = layer.coast || {};
  const pad = (coast.shallow ? (coast.shallowWidth || 26) : 0) + (coast.inkWidth || 0) + 8;
  const box = opsBox(layer, pad);
  if (!box) return;
  // A full rebuild only has to regrow the coast where there is any coast. The
  // cached ink is wiped first so nothing survives from a shape that has since
  // been undone.
  const shape = layerCanvases.get(layer.id + ':shape');
  if (shape && shape.ink) shape.ink.getContext('2d').clearRect(0, 0, shape.ink.width, shape.ink.height);
  paintLand(layer, ctx, box, opsBox(layer, (layer.coast || {}).inkWidth || 4));
}

/** Redraw the land layer inside one rectangle. Releasing a brush only changes
 *  the ground under that stroke, so rebuilding the whole coastline — shelf,
 *  ink and all — for every dab is work nobody asked for. */
export function paintLand(layer, ctx, box, dirty) {
  const mask = maskFor(layer);
  const coast = layer.coast || {};
  box = snapBox(box, SHELF_GRID);
  const bw = box.x1 - box.x, bh = box.y1 - box.y;
  if (bw <= 0 || bh <= 0) return;
  const shape = coastShape(layer, mask, dirty);
  ctx.clearRect(box.x, box.y, bw, bh);

  if (shape.shelf) {
    tintInto(ctx, shape.shelf, SHELF_SCALE, coast.shallowColor || '#7fb4cd', box, bw, bh);
  }

  const land = scratch('land', bw, bh);
  const lctx = land.getContext('2d');
  const pat = layer.texture ? pattern(lctx, layer.texture, layer.scale || 1) : null;
  lctx.save();
  lctx.translate(-box.x, -box.y);
  lctx.fillStyle = pat || layer.color || '#7c9a52';
  lctx.fillRect(box.x, box.y, bw, bh);
  lctx.restore();
  lctx.globalCompositeOperation = 'destination-in';
  lctx.drawImage(mask, box.x, box.y, bw, bh, 0, 0, bw, bh);
  ctx.drawImage(land, box.x, box.y);

  if (shape.ink) {
    tintInto(ctx, shape.ink, 1, coast.inkColor || '#4a3a24', box, bw, bh);
  }
}

/** Redraw the landmass from the mask it already has.
 *
 * Changing a coast colour, a shelf width or the ground texture does not change
 * the shape anyone painted, so there is no reason to replay every stroke to
 * find out what that shape was. Colour changes hit the cached alpha and cost
 * two tint passes; width changes regrow the shape but still skip the mask. */
export function repaintLand(layer) {
  const coast = layer.coast || {};
  const pad = (coast.shallow ? (coast.shallowWidth || 26) : 0) + (coast.inkWidth || 0) + 8;
  const box = opsBox(layer, pad);
  if (!box) return;
  paintLand(layer, canvasFor(layer).getContext('2d'), box);
  compositeAll(snapBox(box, SHELF_GRID));
  requestDraw();
}

/** Undo restored mask pixels behind the renderer's back; tell the coast cache
 *  which rectangle it can no longer trust. */
export function invalidateCoast(layer, dirty) {
  const mask = maskFor(layer);
  coastShape(layer, mask, dirty || { x: 0, y: 0, x1: mask.width, y1: mask.height });
}

/** Add one stroke to the persistent land mask, without replaying the rest. */
export function applyLandOp(layer, op) {
  applyMaskStroke(maskFor(layer).getContext('2d'), op, null);
  layer.__maskVersion = (layer.__maskVersion | 0) + 1;
}

function renderObjects(layer, ctx) {
  const items = layer.ops.slice().sort((a, b) => a.y - b.y);   // painter's order
  for (const item of items) {
    const img = imageNow(item.asset);
    if (img) drawSprite(ctx, img, item);
  }
}

export function pathGeometry(item) {
  const pts = item.points;
  if (pts.length < 2) return null;
  return pts;
}

function renderPaths(layer, ctx) {
  for (const item of layer.ops) {
    const pts = pathGeometry(item);
    if (!pts) continue;
    const style = PATH_STYLES[item.style] || PATH_STYLES.river;
    style.draw(ctx, item, pts);
  }
}

function traceSpline(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  if (pts.length === 2) { ctx.lineTo(pts[1].x, pts[1].y); return; }
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
}

/** Rivers widen as they run: draw the spline in slices, each a little fatter. */
function taperedStroke(ctx, pts, from, to, colour) {
  const slices = Math.max(2, Math.min(48, pts.length * 2));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = colour;
  for (let s = 0; s < slices; s++) {
    const a = s / slices, b = (s + 1) / slices;
    const i0 = Math.floor(a * (pts.length - 1));
    const i1 = Math.min(pts.length - 1, Math.ceil(b * (pts.length - 1)));
    ctx.lineWidth = from + (to - from) * ((a + b) / 2);
    ctx.beginPath();
    ctx.moveTo(pts[i0].x, pts[i0].y);
    for (let i = i0 + 1; i <= i1; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }
}

export const PATH_STYLES = {
  river: {
    label: 'River',
    draw(ctx, item, pts) {
      const w = item.width || 10;
      ctx.save();
      taperedStroke(ctx, pts, Math.max(1, w * 0.18), w, item.color || '#4d7fa0');
      ctx.globalAlpha = 0.5;
      taperedStroke(ctx, pts, Math.max(0.6, w * 0.09), w * 0.45, item.highlight || '#8fc0d8');
      ctx.restore();
    },
  },
  road: {
    label: 'Road',
    draw(ctx, item, pts) {
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      traceSpline(ctx, pts);
      ctx.lineWidth = (item.width || 7) + 2.5;
      ctx.strokeStyle = item.edge || '#4a3a24';
      ctx.stroke();
      ctx.lineWidth = item.width || 7;
      ctx.strokeStyle = item.color || '#c8ab74';
      ctx.stroke();
      ctx.restore();
    },
  },
  trail: {
    label: 'Trail',
    draw(ctx, item, pts) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.setLineDash([(item.width || 4) * 1.4, (item.width || 4) * 1.9]);
      traceSpline(ctx, pts);
      ctx.lineWidth = item.width || 4;
      ctx.strokeStyle = item.color || '#6b5334';
      ctx.stroke();
      ctx.restore();
    },
  },
  border: {
    label: 'Border',
    draw(ctx, item, pts) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.globalAlpha = 0.85;
      ctx.setLineDash([(item.width || 5) * 2.4, (item.width || 5) * 1.2, 0.1, (item.width || 5) * 1.2]);
      traceSpline(ctx, pts);
      ctx.lineWidth = item.width || 5;
      ctx.strokeStyle = item.color || '#8a3b3b';
      ctx.stroke();
      ctx.restore();
    },
  },
};

/* Walls, doors and windows.
 *
 * These are the one part of a map that a virtual tabletop cares about as data
 * rather than as pixels: exported to Universal VTT they become line-of-sight
 * blockers and openable portals in Foundry or Roll20. So they are stored as
 * segments with a kind, not painted, and drawn from that. */
export const WALL_KINDS = {
  wall:   { label: 'Wall',        blocks: true,  portal: false },
  door:   { label: 'Door',        blocks: true,  portal: true },
  secret: { label: 'Secret door', blocks: true,  portal: true },
  window: { label: 'Window',      blocks: false, portal: false },
};

function renderWalls(layer, ctx) {
  const thick = layer.thickness || 7;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const item of layer.ops) {
    const pts = item.points;
    if (!pts || pts.length < 2) continue;
    const kind = item.kind || 'wall';
    if (kind === 'wall') {
      ctx.setLineDash([]);
      ctx.strokeStyle = layer.color || '#20242c';
      ctx.lineWidth = thick;
      strokeRun(ctx, pts);
      ctx.strokeStyle = 'rgba(255,255,255,.10)';
      ctx.lineWidth = Math.max(1, thick * 0.3);
      strokeRun(ctx, pts);
    } else if (kind === 'window') {
      ctx.setLineDash([]);
      ctx.strokeStyle = layer.color || '#20242c';
      ctx.lineWidth = thick;
      strokeRun(ctx, pts);
      ctx.strokeStyle = '#9fd0e8';
      ctx.lineWidth = Math.max(1, thick * 0.45);
      strokeRun(ctx, pts);
    } else {
      // a door: the wall is cut and a leaf drawn across the gap
      ctx.setLineDash(kind === 'secret' ? [6, 5] : []);
      ctx.strokeStyle = layer.doorColor || '#a8763c';
      ctx.lineWidth = thick * 0.9;
      strokeRun(ctx, pts);
      ctx.setLineDash([]);
      const a = pts[0], b = pts[pts.length - 1];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(ang);
      ctx.strokeStyle = layer.color || '#20242c';
      ctx.lineWidth = Math.max(1, thick * 0.35);
      ctx.strokeRect(-len / 2, -thick * 0.6, len, thick * 1.2);
      ctx.restore();
    }
  }
  ctx.setLineDash([]);
  ctx.restore();
}

function strokeRun(ctx, pts) {
  ctx.beginPath();
  pts.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
  ctx.stroke();
}

export const LABEL_STYLES = {
  title:      { font: '600 %spx Georgia, "Times New Roman", serif', spacing: 0.14, size: 64 },
  region:     { font: 'italic 500 %spx Georgia, "Times New Roman", serif', spacing: 0.3, size: 38 },
  settlement: { font: '500 %spx Georgia, "Times New Roman", serif', spacing: 0.06, size: 22 },
  water:      { font: 'italic 400 %spx Georgia, "Times New Roman", serif', spacing: 0.22, size: 28 },
};

function renderLabels(layer, ctx) {
  for (const item of layer.ops) {
    const style = LABEL_STYLES[item.style] || LABEL_STYLES.settlement;
    const size = item.size || style.size;
    ctx.save();
    ctx.translate(item.x, item.y);
    if (item.rot) ctx.rotate(item.rot);
    ctx.font = style.font.replace('%s', size);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const text = (item.text || '').toUpperCase() === item.text && style.spacing > 0.1
      ? item.text : item.text;
    const spaced = style.spacing > 0.01 ? spaceOut(text, size * style.spacing) : text;
    if (item.halo !== false) {
      ctx.lineWidth = Math.max(2, size * 0.16);
      ctx.strokeStyle = item.haloColor || 'rgba(244,236,216,.85)';
      ctx.lineJoin = 'round';
      drawSpaced(ctx, spaced, true);
    }
    ctx.fillStyle = item.color || '#3a2c1e';
    drawSpaced(ctx, spaced, false);
    ctx.restore();
  }
}

function spaceOut(text, px) {
  return { text, px };
}

function drawSpaced(ctx, spaced, stroke) {
  const { text, px } = spaced.px != null ? spaced : { text: spaced, px: 0 };
  if (!px) {
    if (stroke) ctx.strokeText(text, 0, 0); else ctx.fillText(text, 0, 0);
    return;
  }
  const widths = Array.from(text).map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + px * (text.length - 1);
  let x = -total / 2;
  Array.from(text).forEach((ch, i) => {
    const w = widths[i];
    if (stroke) ctx.strokeText(ch, x + w / 2, 0); else ctx.fillText(ch, x + w / 2, 0);
    x += w + px;
  });
}

function renderGrid(layer, ctx) {
  if (!layer.type || layer.type === 'none') return;
  const w = view.doc.width, h = view.doc.height;
  const size = Math.max(4, layer.size || 64);
  ctx.save();
  ctx.strokeStyle = layer.color || '#3a2c1e';
  ctx.globalAlpha = layer.opacity != null ? layer.opacity : 0.25;
  ctx.lineWidth = layer.lineWidth || 1;
  const ox = layer.offsetX || 0, oy = layer.offsetY || 0;
  ctx.beginPath();
  if (layer.type === 'square') {
    for (let x = ox % size; x <= w; x += size) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h); }
    for (let y = oy % size; y <= h; y += size) { ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); }
  } else {
    const r = size / 2;
    const dx = r * 1.5, dy = r * Math.sqrt(3);
    for (let col = -1; col * dx <= w + dx; col++) {
      for (let row = -1; row * dy <= h + dy; row++) {
        const cx = ox + col * dx, cy = oy + row * dy + (col % 2 ? dy / 2 : 0);
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i;
          const px = cx + r * Math.cos(a), py = cy + r * Math.sin(a);
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
      }
    }
  }
  ctx.stroke();
  ctx.restore();
}

function renderPaper(layer, ctx) {
  const w = view.doc.width, h = view.doc.height;
  const pat = layer.texture ? pattern(ctx, layer.texture, layer.scale || 1) : null;
  if (pat) {
    ctx.save();
    ctx.globalAlpha = layer.opacity != null ? layer.opacity : 0.5;
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
  if (layer.vignette > 0) {
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32,
                                       w / 2, h / 2, Math.max(w, h) * 0.72);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(38,26,10,${layer.vignette})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  if (layer.edge > 0) {
    const inset = Math.min(w, h) * 0.02;
    ctx.save();
    ctx.globalAlpha = layer.edge;
    ctx.strokeStyle = 'rgba(58,44,30,.9)';
    ctx.lineWidth = Math.max(2, Math.min(w, h) * 0.004);
    ctx.strokeRect(inset, inset, w - inset * 2, h - inset * 2);
    ctx.lineWidth = Math.max(1, ctx.lineWidth * 0.34);
    ctx.strokeRect(inset * 1.9, inset * 1.9, w - inset * 3.8, h - inset * 3.8);
    ctx.restore();
  }
}

/* ------------------------------------------------------------- compositing */

export function compositeAll(box) {
  const ctx = view.flatCtx;
  const x = box ? box.x : 0, y = box ? box.y : 0;
  const w = box ? box.x1 - box.x : view.doc.width;
  const h = box ? box.y1 - box.y : view.doc.height;
  if (w <= 0 || h <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.clearRect(x, y, w, h);
  for (const layer of view.doc.layers) {
    if (!layer.visible) continue;
    ctx.globalAlpha = layer.opacity != null ? layer.opacity : 1;
    ctx.globalCompositeOperation = layer.blend || 'source-over';
    ctx.drawImage(canvasFor(layer), x, y, w, h, x, y, w, h);
    if (view.liveLayer === layer.id && view.live) {
      ctx.drawImage(view.live, x, y, w, h, x, y, w, h);
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

export function invalidate(layer, box) {
  if (layer) rebuildLayer(layer);
  compositeAll(box);
  requestDraw();
}

/* ------------------------------------------------------------------ display */

export function requestDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => { drawQueued = false; draw(); });
}

export function draw() {
  const ctx = view.ctx;
  if (!ctx || !view.doc) return;
  const W = view.canvas.width, H = view.canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.scale(view.dpr, view.dpr);

  const z = view.zoom;
  ctx.imageSmoothingEnabled = z < 3;
  ctx.imageSmoothingQuality = 'high';

  // paper drop-shadow so the sheet reads as an object on the desk
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.55)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = '#0b0d10';
  ctx.fillRect(view.x, view.y, view.doc.width * z, view.doc.height * z);
  ctx.restore();

  ctx.drawImage(view.flat, view.x, view.y, view.doc.width * z, view.doc.height * z);

  ctx.strokeStyle = 'rgba(255,255,255,.10)';
  ctx.lineWidth = 1;
  ctx.strokeRect(view.x + 0.5, view.y + 0.5, view.doc.width * z - 1, view.doc.height * z - 1);

  if (view.cursor && view.cursor.r > 0) {
    const s = mapToScreen(view.cursor.x, view.cursor.y);
    ctx.beginPath();
    ctx.arc(s.x, s.y, Math.max(2, view.cursor.r * z), 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,.75)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  if (view.overlay) view.overlay(ctx);
  if (view.showScaleBar !== false) drawScaleBar(ctx, W / view.dpr, H / view.dpr);
  ctx.restore();
  if (view.onAfterDraw) view.onAfterDraw();
}

/* A scale bar, the thing that makes a picture of a place into a map.
 *
 * It picks the roundest distance whose on-screen length lands in a sensible
 * band, so it stays readable at every zoom instead of reading "43.7 miles". */
const NICE = [1, 2, 2.5, 5];

function drawScaleBar(ctx, w, h) {
  const doc = view.doc;
  const scale = doc && doc.scale;
  if (!scale || !scale.perCell) return;
  const unitsPerPx = scale.perCell / (scale.cellPx || 64);

  // Aim for ~150 screen pixels, then round the distance it represents up to a
  // 1 / 2 / 2.5 / 5 times a power of ten.
  const rawUnits = 150 / view.zoom * unitsPerPx;
  const mag = Math.pow(10, Math.floor(Math.log10(rawUnits)));
  let units = NICE[NICE.length - 1] * mag;
  for (const n of NICE) if (n * mag >= rawUnits) { units = n * mag; break; }
  const px = units / unitsPerPx * view.zoom;
  if (!isFinite(px) || px < 24 || px > w - 60) return;

  const label = (units >= 1 ? (Math.round(units * 100) / 100) : units.toPrecision(2))
    + ' ' + (scale.unit || 'units');
  const x = w - px - 22;
  const y = h - 26;

  ctx.save();
  ctx.font = '11px ui-monospace, Menlo, Consolas, monospace';
  const tw = ctx.measureText(label).width;
  ctx.fillStyle = 'rgba(12,14,18,.66)';
  roundRect(ctx, x - 10, y - 17, Math.max(px, tw) + 20, 32, 5);
  ctx.fill();

  // A checkered bar: five alternating segments read as a ruler at a glance.
  const segs = 5, sw = px / segs;
  for (let i = 0; i < segs; i++) {
    ctx.fillStyle = i % 2 ? 'rgba(255,255,255,.92)' : 'rgba(0,0,0,.55)';
    ctx.fillRect(x + i * sw, y, sw, 5);
  }
  ctx.strokeStyle = 'rgba(255,255,255,.92)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, px - 1, 4);

  ctx.fillStyle = 'rgba(255,255,255,.92)';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(label, x, y - 5);
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* --------------------------------------------------------------- exporting */

export function flatten({ scale = 1, grid = true, paper = true } = {}) {
  const w = Math.round(view.doc.width * scale);
  const h = Math.round(view.doc.height * scale);
  const out = makeCanvas(w, h);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  for (const layer of view.doc.layers) {
    if (!layer.visible) continue;
    if (layer.kind === 'grid' && !grid) continue;
    if (layer.kind === 'paper' && !paper) continue;
    ctx.globalAlpha = layer.opacity != null ? layer.opacity : 1;
    ctx.globalCompositeOperation = layer.blend || 'source-over';
    ctx.drawImage(canvasFor(layer), 0, 0, w, h);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  return out;
}

/* ------------------------------------------------------- virtual tabletop */

/** Universal VTT: the interchange format Foundry and Roll20 modules read.
 *
 * The point of it is that the walls travel with the picture. A map exported
 * here drops into a virtual tabletop with its line of sight and its doors
 * already built, instead of someone tracing them by hand for half an hour.
 *
 * Coordinates are in grid cells, not pixels, which is why the map needs a real
 * scale before this means anything.
 */
export function toUVTT(dataUrl) {
  const doc = view.doc;
  const grid = doc.layers.find((l) => l.kind === 'grid');
  const cell = (grid && grid.size) || (doc.scale && doc.scale.cellPx) || 64;
  const wallLayer = doc.layers.find((l) => l.kind === 'walls');
  const toCell = (pt) => ({ x: +(pt.x / cell).toFixed(4), y: +(pt.y / cell).toFixed(4) });

  const sight = [];
  const portals = [];
  for (const item of (wallLayer ? wallLayer.ops : [])) {
    const kind = WALL_KINDS[item.kind] || WALL_KINDS.wall;
    const pts = item.points.map(toCell);
    if (kind.portal) {
      const a = pts[0], b = pts[pts.length - 1];
      portals.push({
        position: { x: +((a.x + b.x) / 2).toFixed(4), y: +((a.y + b.y) / 2).toFixed(4) },
        bounds: [a, b],
        rotation: +Math.atan2(b.y - a.y, b.x - a.x).toFixed(4),
        closed: true,
        freestanding: false,
      });
    } else if (kind.blocks) {
      sight.push(pts);
    }
  }

  return {
    format: 0.3,
    resolution: {
      map_origin: { x: 0, y: 0 },
      map_size: { x: Math.round(doc.width / cell), y: Math.round(doc.height / cell) },
      pixels_per_grid: Math.round(cell),
    },
    line_of_sight: sight,
    objects_line_of_sight: [],
    portals,
    environment: { baked_lighting: true, ambient_light: 'ffffffff' },
    lights: [],
    image: dataUrl.split(',')[1],
  };
}
