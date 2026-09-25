/* The renderer.
 *
 * Every layer owns an offscreen canvas at map resolution. Those are composited
 * into one flat canvas, and the flat canvas is what gets blitted to the screen
 * under the view transform — so panning and zooming never re-run any painting,
 * and a brush stroke only re-composites the rectangle it touched.
 */

import { imageNow, pattern } from './assets.js';
import { LAYER_KINDS, gridStepPx, layerAlpha, layerVisible } from './doc.js';
import * as hex from './hex.js';
import * as light from './light.js';
import { clamp, makeCanvas, rng } from './util.js';

export const view = {
  canvas: null, ctx: null, dpr: 1,
  x: 0, y: 0, zoom: 1,
  doc: null,
  flat: null, flatCtx: null,
  live: null, liveCtx: null,          // the stroke in progress
  liveLayer: null, liveErase: false,
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
  }
  const ctx = c.getContext('2d');
  // Reset the transform before clearing, not after: a pooled canvas that came
  // back with a translate on it cleared the wrong rectangle and left the
  // previous user's pixels behind.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
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
  coastReach.clear();
  view.flat = makeCanvas(doc.width, doc.height);
  view.flatCtx = view.flat.getContext('2d');
  view.live = makeCanvas(doc.width, doc.height);
  view.liveCtx = view.live.getContext('2d');
  // The landmass first: a terrain fill bound to it reads its mask, and a map
  // with the terrain layer below the landmass rebuilt that fill against an
  // empty mask and opened with the fill gone.
  for (const layer of doc.layers) if (layer.kind === 'land') rebuildLayer(layer);
  for (const layer of doc.layers) if (layer.kind !== 'land') rebuildLayer(layer);
  compositeAll();
}

/* How far the coast reached the last time each land layer was painted.
 *
 * repaintLand clears only the rectangle it is about to draw, and that
 * rectangle is grown from the *current* shelf and ink widths. Narrow them --
 * or turn the shallow water off -- and the wider band painted a moment ago
 * falls outside the clear and stays on the canvas, in 64-px steps, until
 * something forces a full rebuild. A rebuild clears the whole canvas, so the
 * map came back from disk without the band that was on screen, which is
 * invariant (a). Clearing as far as the widest reach so far costs one number
 * a layer.
 */
const coastReach = new Map();

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

function strokePath(ctx, points, width, softness, widths) {
  if (widths && widths.length === points.length) return taperedPath(ctx, points, widths, softness);
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

/** A stroke whose width changes along its length.
 *
 * It cannot be one stroked polyline, so it is stamped: overlapping discs whose
 * radius follows the recorded width. They go down opaque into a buffer and the
 * buffer is blurred once on the way in — blurring each disc as it is drawn
 * instead makes their soft edges add up, and a soft brush comes out hard. */
function taperedPath(ctx, points, widths, softness) {
  const src = ctx.canvas;
  const tmp = makeCanvas(src.width, src.height);
  const t = tmp.getContext('2d');
  t.setTransform(ctx.getTransform());
  t.fillStyle = '#fff';
  const dab = (x, y, w) => {
    t.beginPath();
    t.arc(x, y, Math.max(0.5, w / 2), 0, Math.PI * 2);
    t.fill();
  };
  if (points.length === 1) {
    dab(points[0].x, points[0].y, widths[0]);
  } else {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const wa = widths[i - 1], wb = widths[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      // A fifth of the narrower radius keeps the run smooth at any width.
      const step = Math.max(0.8, Math.min(wa, wb) * 0.2);
      const n = Math.max(1, Math.ceil(len / step));
      for (let k = 0; k <= n; k++) {
        const u = k / n;
        dab(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, wa + (wb - wa) * u);
      }
    }
  }
  const widest = Math.max.apply(null, widths);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (softness > 0.01) ctx.filter = `blur(${(softness * widest * 0.25).toFixed(2)}px)`;
  ctx.drawImage(tmp, 0, 0);
  ctx.restore();
}

/** Every brush here is the same pipeline — draw a shape, pour a texture into
 *  it — and they differ only in the shape. This is that shape. */
function drawBrushMask(ctx, op) {
  const soft = op.hardness != null ? 1 - op.hardness : 0.35;
  if (op.mode === 'dabs') return dabMask(ctx, op, soft);
  if (op.mode === 'shape') return shapeMask(ctx, op, soft);
  return strokePath(ctx, op.points, op.size, soft, op.widths);
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

/** The reach of a stroke. Any box function must agree with this one, or a
 *  full rebuild clips what the incremental repaint drew. A tapered stroke is
 *  measured by its widest point, which is the only width that reaches. */
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
  if (op.rings) {
    // Generated land (generate.js): closed polygons, filled even-odd so a lake
    // inside a continent, and an island inside the lake, come out as holes and
    // land again without anyone having to say which ring is which.
    maskCtx.fillStyle = '#fff';
    maskCtx.beginPath();
    for (const ring of op.rings) {
      for (let i = 0; i + 1 < ring.length; i += 2) {
        if (i === 0) maskCtx.moveTo(ring[0], ring[1]); else maskCtx.lineTo(ring[i], ring[i + 1]);
      }
      maskCtx.closePath();
    }
    maskCtx.fill('evenodd');
    maskCtx.restore();
    return;
  }
  // op.widths, like drawBrushMask: without them the mask was always stroked
  // at a uniform op.size, so a tapered coastline under the cursor snapped to
  // full width the instant the button came up.
  strokePath(maskCtx, op.points, op.size, op.hardness != null ? 1 - op.hardness : 0.2, op.widths);
  maskCtx.restore();
}

/* ------------------------------------------------------------ scatter brush */

export function applyScatter(ctx, op, style) {
  const rand = rng(op.seed || 1);
  for (const item of scatterItems(op, rand)) {
    const img = imageNow(item.asset);
    if (!img) continue;
    // The style is the layer: drop shadow and tint live there, and leaving it
    // off here meant a scatter previewed flat and then gained every shadow at
    // once on release. renderObjects has always passed it.
    drawSprite(ctx, img, item, style);
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

/* A silhouette of a sprite in one flat colour, which is all both the shadow
   and the tint need. Cached, because a forest is hundreds of stamps drawn from
   a handful of images, and rebuilding the silhouette for each one is the
   difference between instant and noticeable. */
const spriteFx = new Map();

function silhouette(img, key, colour) {
  const cached = spriteFx.get(key);
  if (cached) return cached;
  const c = makeCanvas(img.width, img.height);
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = colour;
  x.fillRect(0, 0, c.width, c.height);
  spriteFx.set(key, c);
  if (spriteFx.size > 160) spriteFx.delete(spriteFx.keys().next().value);
  return c;
}

/** Rescanning the asset folder can put different art behind the same id. */
export function forgetSpriteFx() { spriteFx.clear(); }

export function drawSprite(ctx, img, item, style) {
  const w = img.width * item.scale;
  const h = img.height * item.scale;
  const alpha = item.opacity != null ? item.opacity : 1;
  const shadow = style && style.shadow > 0 ? style.shadow : 0;
  const tint = style && style.tintStrength > 0 && style.tint ? style.tintStrength : 0;

  if (shadow && item.asset) {
    const colour = style.shadowColor || '#241c10';
    const ang = ((style.shadowAngle != null ? style.shadowAngle : 55) * Math.PI) / 180;
    const dist = h * (style.shadowLength != null ? style.shadowLength : 0.16);
    const blur = h * (style.shadowBlur != null ? style.shadowBlur : 0.05);
    ctx.save();
    ctx.globalAlpha = alpha * shadow;
    if (blur > 0.3) ctx.filter = `blur(${blur.toFixed(2)}px)`;
    ctx.translate(item.x + Math.cos(ang) * dist, item.y + Math.sin(ang) * dist);
    if (item.rot) ctx.rotate(item.rot);
    if (item.flip) ctx.scale(-1, 1);
    ctx.drawImage(silhouette(img, item.asset + '|s|' + colour, colour), -w / 2, -h, w, h);
    ctx.restore();
  }

  ctx.save();
  ctx.translate(item.x, item.y);
  if (item.rot) ctx.rotate(item.rot);
  if (item.flip) ctx.scale(-1, 1);
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, -w / 2, -h, w, h);      // anchored at the foot, like a map symbol
  if (tint && item.asset) {
    // A wash of colour over the symbol rather than a replacement of it: the
    // linework has to stay readable, or a tinted forest is a green blob.
    ctx.globalAlpha = alpha * tint;
    ctx.drawImage(silhouette(img, item.asset + '|t|' + style.tint, style.tint), -w / 2, -h, w, h);
  }
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
    case 'regions': return renderRegions(layer, ctx);
    case 'walls':   return renderWalls(layer, ctx);
    case 'lights':  return renderLights(layer, ctx);
    case 'labels':  return renderLabels(layer, ctx);
    case 'group':   return undefined;              // a folder draws nothing
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
  // The soften brush is a live drag tool, so this box grows with the stroke
  // and would churn the scratch pool a frame at a time. See compositeAll.
  const blurred = makeCanvas(bw, bh);
  const bctx = blurred.getContext('2d');
  bctx.filter = 'blur(' + Math.max(0.5, (op.strength || 0.5) * 10).toFixed(1) + 'px)';
  bctx.drawImage(canvas, box.x, box.y, bw, bh, 0, 0, bw, bh);
  bctx.filter = 'none';
  const mask = makeCanvas(bw, bh);
  const mctx = mask.getContext('2d');
  mctx.save();
  mctx.translate(-box.x, -box.y);
  strokePath(mctx, op.points, op.size, 0.7);
  mctx.restore();
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
  // rebuildLayer has just cleared the whole canvas, so nothing older survives
  // and the reach starts again from this one.
  coastReach.set(layer.id, pad);
  // The cached ink is wiped first so nothing survives from a shape that has
  // since been undone -- and before the early return, not after it: a cleared
  // landmass has no box, so the old coast's ink stayed cached under an
  // unchanged geometry key and came back in pieces round the next thing
  // painted near it, or everywhere at the next colour change.
  const shape = layerCanvases.get(layer.id + ':shape');
  if (shape && shape.ink) shape.ink.getContext('2d').clearRect(0, 0, shape.ink.width, shape.ink.height);
  const box = opsBox(layer, pad);
  if (!box) return;
  // A full rebuild only has to regrow the coast where there is any coast.
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
  // Cleared as far as the coast has ever reached on this layer, drawn as far
  // as it reaches now -- see coastReach. The box is still snapped to
  // SHELF_GRID inside paintLand, so widening it by whole grid steps moves
  // nothing the shelf downscale depends on.
  const reach = Math.max(pad, coastReach.get(layer.id) || 0);
  coastReach.set(layer.id, pad);
  const box = opsBox(layer, reach);
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
    if (img) drawSprite(ctx, img, item, layer);
  }
}

export function pathGeometry(item) {
  const pts = item.points;
  if (pts.length < 2) return null;
  return pts;
}

/* --------------------------------------------------------------- regions */

/* A region is a closed area with a name: a kingdom, a duchy, a wood, a
 * territory. It is a tint over what is already there rather than paint of its
 * own, which is why the fill is drawn at a low alpha and the border carries
 * most of the reading. Every other map maker of this kind has some form of it
 * and Cartograph had none. */

export const REGION_BORDERS = {
  solid:  { label: 'Solid',  dash: null },
  dashed: { label: 'Dashed', dash: [14, 9] },
  dotted: { label: 'Dotted', dash: [2, 7] },
  none:   { label: 'None',   dash: null },
};

export const REGION_DEFAULTS = { color: '#8a3b3b', opacity: 0.28, width: 3, border: 'dashed' };

/** Close the quadratic-midpoint spline renderPaths uses, so a territory's
 *  outline curves through its own first point instead of showing the corner
 *  where the drawing started. */
function traceClosedSpline(ctx, pts) {
  const n = pts.length;
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  ctx.beginPath();
  if (n < 3) {
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < n; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    return;
  }
  const start = mid(pts[n - 1], pts[0]);
  ctx.moveTo(start.x, start.y);
  for (let i = 0; i < n; i++) {
    const m = mid(pts[i], pts[(i + 1) % n]);
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, m.x, m.y);
  }
  ctx.closePath();
}

/** The area-weighted centroid, which is where a person would write the name.
 *  The mean of the vertices is not: it drags towards whichever stretch of
 *  coast was clicked most finely, and lands outside anything crescent-shaped. */
export function regionCentroid(pts) {
  let a2 = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const cross = p.x * q.y - q.x * p.y;
    a2 += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  if (Math.abs(a2) < 1e-6) {
    // A degenerate outline has no area to weight by; the mean is all there is.
    return { x: pts.reduce((t, p) => t + p.x, 0) / pts.length,
             y: pts.reduce((t, p) => t + p.y, 0) / pts.length };
  }
  return { x: cx / (3 * a2), y: cy / (3 * a2) };
}

function renderRegions(layer, ctx) {
  const items = layer.ops.filter((it) => it.points && it.points.length >= 3);

  for (const item of items) {
    const colour = item.color || REGION_DEFAULTS.color;
    ctx.save();
    traceClosedSpline(ctx, item.points);
    if (item.fill !== false) {
      ctx.globalAlpha = item.opacity != null ? item.opacity : REGION_DEFAULTS.opacity;
      ctx.fillStyle = colour;
      ctx.fill();
    }
    const border = REGION_BORDERS[item.border] || REGION_BORDERS.dashed;
    if (item.border !== 'none') {
      ctx.globalAlpha = 1;
      ctx.lineWidth = item.width || REGION_DEFAULTS.width;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = colour;
      if (border.dash) ctx.setLineDash(border.dash.map((d) => d * Math.max(1, ctx.lineWidth / 3)));
      ctx.lineCap = item.border === 'dotted' ? 'round' : 'butt';
      ctx.stroke();
    }
    ctx.restore();
  }

  // Names go on after every fill, or a neighbour drawn later sits over the
  // name of the one drawn before it.
  if (layer.showNames === false) return;
  for (const item of items) {
    if (!item.name) continue;
    const at = item.at || regionCentroid(item.points);
    const size = item.nameSize || layer.nameSize || 34;
    const style = LABEL_STYLES.region;
    ctx.save();
    ctx.font = style.font.replace('%s', size);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.translate(at.x, at.y);
    const spaced = spaceOut(item.name, size * style.spacing);
    ctx.lineWidth = Math.max(2, size * 0.16);
    ctx.strokeStyle = 'rgba(244,236,216,.85)';
    ctx.lineJoin = 'round';
    drawSpaced(ctx, spaced, true);
    ctx.fillStyle = item.nameColor || '#3a2c1e';
    drawSpaced(ctx, spaced, false);
    ctx.restore();
  }
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

/* ----------------------------------------------------------------- lighting */

/** The segments a light can be stopped by.
 *
 * `blocks` on WALL_KINDS already knows which ones those are: a window is a
 * wall you can see through, and it should light the room behind it. */
export function wallSegments(doc) {
  const target = doc || view.doc;
  const layer = target.layers.find((l) => l.kind === 'walls');
  // layerVisible, never layer.visible: a group vetoes what its members draw,
  // and a wall nobody can see must not go on casting a shadow either.
  if (!layer || !layerVisible(target, layer)) return [];
  const out = [];
  for (const item of layer.ops) {
    if (!(WALL_KINDS[item.kind] || WALL_KINDS.wall).blocks) continue;
    const pts = item.points || [];
    for (let i = 1; i < pts.length; i++) out.push({ a: pts[i - 1], b: pts[i] });
  }
  return out;
}

export function lightRadii(op) {
  const bright = Math.max(1, op.bright || 120);
  return { bright, dim: Math.max(bright, op.dim || bright * 2) };
}

/** Lighting is one layer of darkness that every light cuts a hole in.
 *
 * Doing it this way rather than additively is what keeps it composable with
 * the rest of the stack: the result is an ordinary RGBA layer with an ordinary
 * blend mode, so it exports, flattens and reorders like any other. */
function renderLights(layer, ctx) {
  const doc = view.doc;
  const ambient = layer.ambient != null ? layer.ambient : 0;
  const glow = layer.glow != null ? layer.glow : 0.15;
  const segs = layer.shadows === false ? [] : wallSegments(doc);

  if (ambient > 0) {
    ctx.save();
    ctx.globalAlpha = ambient;
    ctx.fillStyle = layer.color || '#060912';
    ctx.fillRect(0, 0, doc.width, doc.height);
    ctx.restore();
  }

  // Pass one: erase the darkness inside each light's reach.
  for (const op of layer.ops) {
    if (op.on === false) continue;
    const { bright, dim } = lightRadii(op);
    const k = op.intensity != null ? op.intensity : 1;
    if (k <= 0) continue;
    ctx.save();
    clipLight(ctx, op, dim, segs);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = falloff(ctx, op, bright, dim, '0,0,0', k);
    ctx.fillRect(op.x - dim, op.y - dim, dim * 2, dim * 2);
    ctx.restore();
  }

  // Pass two: the colour of the light itself. Without this every lamp is a
  // grey hole, and a torch and a moonbeam look identical.
  if (glow > 0) {
    for (const op of layer.ops) {
      if (op.on === false) continue;
      const { bright, dim } = lightRadii(op);
      const k = (op.intensity != null ? op.intensity : 1) * glow;
      if (k <= 0) continue;
      ctx.save();
      clipLight(ctx, op, dim, segs);
      ctx.fillStyle = falloff(ctx, op, bright, dim, rgbTriplet(op.color || '#ffd9a0'), k);
      ctx.fillRect(op.x - dim, op.y - dim, dim * 2, dim * 2);
      ctx.restore();
    }
  }
}

/** Full strength out to the bright radius, then down to nothing at the dim
 *  one — the two-radius falloff every tabletop rulebook describes. */
function falloff(ctx, op, bright, dim, triplet, alpha) {
  const g = ctx.createRadialGradient(op.x, op.y, 0, op.x, op.y, dim);
  const inner = Math.min(0.995, bright / dim);
  g.addColorStop(0, `rgba(${triplet},${alpha})`);
  g.addColorStop(inner, `rgba(${triplet},${alpha})`);
  g.addColorStop(1, `rgba(${triplet},0)`);
  return g;
}

function clipLight(ctx, op, radius, segs) {
  light.litPath(ctx, op, radius, segs);
  ctx.clip();
  // A second clip intersects the first, so a shuttered lantern is the wedge of
  // what it faces and the walls, not one or the other.
  if (light.isCone(op)) { light.conePath(ctx, op, radius); ctx.clip(); }
}

function rgbTriplet(hex) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex || '');
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)].join(',') : '255,217,160';
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
    const gap = style.spacing > 0.01 ? size * style.spacing : 0;
    const text = item.text || '';
    // A label with points follows them; one without sits on a straight
    // baseline at x,y, exactly as it always has.
    const curve = item.points && item.points.length > 1 ? readable(item.points) : null;
    const halo = item.halo !== false;

    ctx.save();
    ctx.font = style.font.replace('%s', size);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (halo) {
      ctx.lineWidth = Math.max(2, size * 0.16);
      ctx.strokeStyle = item.haloColor || 'rgba(244,236,216,.85)';
      ctx.lineJoin = 'round';
    }
    if (curve) {
      if (halo) drawOnPath(ctx, text, gap, curve, size, true);
      ctx.fillStyle = item.color || '#3a2c1e';
      drawOnPath(ctx, text, gap, curve, size, false);
    } else {
      ctx.translate(item.x, item.y);
      if (item.rot) ctx.rotate(item.rot);
      const spaced = gap ? spaceOut(text, gap) : text;
      if (halo) drawSpaced(ctx, spaced, true);
      ctx.fillStyle = item.color || '#3a2c1e';
      drawSpaced(ctx, spaced, false);
    }
    ctx.restore();
  }
}

/* ------------------------------------------------------- text along a path */

/** A curve drawn right to left would set its text upside down. Nobody wants
 *  that, and nobody wants to have to draw their curves in a particular
 *  direction either, so it is turned round here. */
function readable(points) {
  const a = points[0], b = points[points.length - 1];
  return b.x < a.x ? points.slice().reverse() : points;
}

/** Walk a polyline by distance travelled rather than by index, which is what
 *  spaces letters evenly regardless of how the points happen to fall. */
function pathWalker(points) {
  const segs = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) continue;
    segs.push({ a, b, len, at: total });
    total += len;
  }
  const at = (d) => {
    if (!segs.length) return null;
    if (d <= 0) return { x: segs[0].a.x, y: segs[0].a.y };
    for (const s of segs) {
      if (d <= s.at + s.len) {
        const t = (d - s.at) / s.len;
        return { x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t };
      }
    }
    const last = segs[segs.length - 1];
    return { x: last.b.x, y: last.b.y };
  };
  return {
    total,
    at,
    /** The tangent, measured across a span rather than at a point. Taking it
     *  from one segment makes every letter jitter wherever a hand-drawn curve
     *  has a kink in it. */
    angleAt(d, span) {
      const a = at(Math.max(0, d - span)), b = at(Math.min(total, d + span));
      return a && b ? Math.atan2(b.y - a.y, b.x - a.x) : 0;
    },
  };
}

function drawOnPath(ctx, text, gap, points, size, stroke) {
  const walk = pathWalker(points);
  if (!walk.total) return;
  const chars = Array.from(text);
  const widths = chars.map((ch) => ctx.measureText(ch).width);
  const run = widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, chars.length - 1);
  // Centred on the curve, so a name sits in the middle of the coast it names
  // rather than starting wherever the drag happened to begin.
  let d = (walk.total - run) / 2;
  const span = Math.max(4, size * 0.4);
  for (let i = 0; i < chars.length; i++) {
    const mid = d + widths[i] / 2;
    const pos = walk.at(mid);
    if (!pos) break;
    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.rotate(walk.angleAt(mid, span));
    if (stroke) ctx.strokeText(chars[i], 0, 0); else ctx.fillText(chars[i], 0, 0);
    ctx.restore();
    d += widths[i] + gap;
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
  // No globalAlpha here. compositeAll applies layerAlpha to this canvas, so
  // baking the opacity in as well squared it -- a grid set to 34% drew at 12%,
  // and the Opacity slider changed only one of the two factors, so the map
  // came back looking different after a reload.
  ctx.lineWidth = layer.lineWidth || 1;
  const ox = layer.offsetX || 0, oy = layer.offsetY || 0;
  ctx.beginPath();
  if (layer.type === 'square') {
    for (let x = ox % size; x <= w; x += size) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h); }
    for (let y = oy % size; y <= h; y += size) { ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); }
  } else {
    // The geometry lives in hex.js so that what is drawn here and what the
    // snapping picks can never drift apart.
    hex.forEach(layer, w, h, (cx, cy, col, row, q, r) => {
      const pts = hex.corners(layer, q, r);
      for (let i = 0; i < 6; i++) {
        if (i === 0) ctx.moveTo(pts[i].x, pts[i].y); else ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.closePath();
    });
  }
  ctx.stroke();
  ctx.restore();
}

function renderPaper(layer, ctx) {
  const w = view.doc.width, h = view.doc.height;
  const pat = layer.texture ? pattern(ctx, layer.texture, layer.scale || 1) : null;
  if (pat) {
    ctx.save();
    // See renderGrid: the layer's opacity belongs to compositeAll alone.
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
    if (layer.kind === 'group') continue;            // a folder draws nothing
    if (!layerVisible(view.doc, layer)) continue;
    ctx.globalAlpha = layerAlpha(view.doc, layer);
    ctx.globalCompositeOperation = layer.blend || 'source-over';
    const liveHere = view.liveLayer === layer.id && view.live;
    if (liveHere && view.liveErase) {
      // An erase cannot be laid over the layer it is erasing from: source-over
      // does not subtract, so drawing the live canvas on top showed nothing
      // and the eraser appeared to do nothing until the button came up. The
      // box is copied, the stroke is cut out of the copy, and the copy is what
      // gets drawn.
      // makeCanvas, not scratch: this box is the live repaint box and its
      // size changes every frame, so the pool would mint an entry per frame
      // and evict the coastline's, which are what it exists for.
      const cut = makeCanvas(w, h);
      const cctx = cut.getContext('2d');
      cctx.drawImage(canvasFor(layer), x, y, w, h, 0, 0, w, h);
      cctx.save();
      cctx.globalCompositeOperation = 'destination-out';
      cctx.drawImage(view.live, x, y, w, h, 0, 0, w, h);
      cctx.restore();
      ctx.drawImage(cut, 0, 0, w, h, x, y, w, h);
    } else {
      ctx.drawImage(canvasFor(layer), x, y, w, h, x, y, w, h);
      if (liveHere) ctx.drawImage(view.live, x, y, w, h, x, y, w, h);
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

export function invalidate(layer, box) {
  if (layer) rebuildLayer(layer);
  if (layer && layer.kind === 'land' && followLand()) box = undefined;
  // A shadow reaches as far as the light that casts it, which is nothing like
  // the box the caller just edited, so a relight has to composite the lot.
  if (relight(layer)) box = undefined;
  compositeAll(box);
  requestDraw();
}

/* A Fill with Region "Inside" or "Outside the landmass" is bound to the land
 * mask rather than to a frozen outline -- see shapeMask -- but it is baked into
 * its raster layer's pixels like any other stroke. Nothing redrew that layer
 * when the mask changed, so painting more land left the old fill on screen
 * while a reload drew the new one: invariant (a). Every route that changes the
 * mask calls this afterwards. */
function boundToLand(layer) {
  return layer.kind === 'raster' && layer.ops.some((op) =>
    op.mode === 'shape' && (op.shape === 'land' || op.shape === 'sea'));
}

export function followsLand(layer) {
  return !!layer && boundToLand(layer);
}

/** Rebuild every raster layer bound to the landmass. True if there was one,
 *  in which case the caller has to composite the whole map. */
export function followLand() {
  const doc = view.doc;
  if (!doc) return false;
  let did = false;
  for (const l of doc.layers) if (boundToLand(l)) { rebuildLayer(l); did = true; }
  return did;
}

/** Rebuild the lighting if `layer` is something the shadows are derived from.
 *
 * Shadows come from the walls, so a wall that moves -- or is merely hidden --
 * without the lighting following it leaves light spilling through a wall that
 * is no longer there. Every route that can change that has to come through
 * here; hiding the layer from the Layers panel is one, and used to not be.
 */
export function relight(layer) {
  const doc = view.doc;
  if (!doc || !layer) return false;
  const touchesWalls = layer.kind === 'walls'
    || (layer.kind === 'group' && doc.layers.some((l) => l.group === layer.id && l.kind === 'walls'));
  return touchesWalls ? relightAll() : false;
}

/** Rebuild every lighting layer, no questions asked.
 *
 * `relight` decides from the layer in front of it, which is no use to a caller
 * that has already done the thing -- deleting a group frees its members first,
 * so by the time it could ask, nothing points at the group any more. Such a
 * caller works out whether the walls were involved before it mutates, and
 * calls this afterwards.
 */
export function relightAll() {
  const doc = view.doc;
  if (!doc) return false;
  let did = false;
  for (const lit of doc.layers) {
    if (lit.kind === 'lights' && lit.ops.length) { rebuildLayer(lit); did = true; }
  }
  return did;
}

/** Drop the offscreen canvases a layer owns. A deleted layer used to leave
 *  every one of them in the map, which at a full canvas each is megabytes a
 *  time on a session where somebody tries a few compositions. */
export function forgetLayer(id) {
  const kept = new Map();
  for (const key of [id, id + ':mask', id + ':shape', id + ':small']) {
    if (layerCanvases.has(key)) kept.set(key, layerCanvases.get(key));
    layerCanvases.delete(key);
  }
  coastReach.delete(id);
  return kept;
}

/** Put back the canvases forgetLayer returned. An undo of a layer delete needs
 *  the *same* canvas objects, not fresh ones: every paint entry for that layer
 *  further down the stack is a closure over the canvas it snapshotted, and
 *  restoring into one that is no longer drawn leaves the stroke on screen
 *  while taking its op out of the document. */
export function adoptLayer(kept) {
  for (const [key, canvas] of kept) layerCanvases.set(key, canvas);
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
  const unitsPerPx = scale.perCell / (gridStepPx(doc) || 64);

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

export function flatten({ scale = 1, grid = true, paper = true, lights = true } = {}) {
  const w = Math.round(view.doc.width * scale);
  const h = Math.round(view.doc.height * scale);
  const out = makeCanvas(w, h);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  for (const layer of view.doc.layers) {
    if (layer.kind === 'group') continue;
    if (!layerVisible(view.doc, layer)) continue;
    if (layer.kind === 'grid' && !grid) continue;
    if (layer.kind === 'paper' && !paper) continue;
    if (layer.kind === 'lights' && !lights) continue;
    ctx.globalAlpha = layerAlpha(view.doc, layer);
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
export function toUVTT(dataUrl, { bakedLighting = true } = {}) {
  const doc = view.doc;
  const cell = gridStepPx(doc) || 64;
  const wallLayer = doc.layers.find((l) => l.kind === 'walls');
  const lightLayer = doc.layers.find((l) => l.kind === 'lights');
  const toCell = (pt) => ({ x: +(pt.x / cell).toFixed(4), y: +(pt.y / cell).toFixed(4) });

  const sight = [];
  const portals = [];
  // layerVisible, as the lights loop below and ambientArgb already do: the
  // picture half of this export goes through flatten, which drops a hidden
  // layer, so exporting sight lines for walls that are not in the image
  // stops tokens dead at a barrier nobody can see.
  const wallsShown = wallLayer && layerVisible(doc, wallLayer);
  for (const item of (wallsShown ? wallLayer.ops : [])) {
    const kind = WALL_KINDS[item.kind] || WALL_KINDS.wall;
    // Guarded as renderWalls and wallSegments already guard: the wall tool
    // cannot make a one-point wall, but a hand-edited map or an extension can,
    // and this is the one of the three that threw rather than skipped.
    if (!item.points || item.points.length < 2) continue;
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

  // The format takes ranges in grid cells like everything else, and colours as
  // eight hex digits with the alpha first.
  const lights = [];
  for (const op of (lightLayer && layerVisible(doc, lightLayer) ? lightLayer.ops : [])) {
    if (op.on === false) continue;
    const { dim } = lightRadii(op);
    lights.push({
      position: toCell(op),
      range: +(dim / cell).toFixed(4),
      intensity: +(op.intensity != null ? op.intensity : 1).toFixed(3),
      color: argb(op.color || '#ffd9a0'),
      shadows: !lightLayer || lightLayer.shadows !== false,
    });
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
    // If the darkness is painted into the image AND the lights are sent as
    // data, a tabletop lights the map twice and it comes out washed out. The
    // caller decides which, and says so here.
    environment: {
      baked_lighting: bakedLighting,
      ambient_light: ambientArgb(doc, lightLayer),
    },
    lights,
    image: dataUrl.split(',')[1],
  };
}

function argb(hex) {
  const m = /^#?([\da-f]{6})$/i.exec(hex || '');
  return 'ff' + (m ? m[1].toLowerCase() : 'ffffff');
}

/** What an unlit part of the map should look like to the tabletop. With no
 *  lighting layer that is plain white, which is what it has always been. */
function ambientArgb(doc, layer) {
  // The picture half of this export goes through flatten, which honours a
  // group's visibility. The data half has to agree with it, or the tabletop
  // is handed lights for a layer the map was deliberately exported without.
  const ambient = layer && layerVisible(doc, layer) ? (layer.ambient || 0) : 0;
  if (ambient <= 0) return 'ffffffff';
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(layer.color || '#060912');
  const dark = m ? [1, 2, 3].map((i) => parseInt(m[i], 16)) : [6, 9, 18];
  const mix = dark.map((c) => Math.round(255 + (c - 255) * ambient));
  return 'ff' + mix.map((c) => c.toString(16).padStart(2, '0')).join('');
}
