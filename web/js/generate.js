/* Seeded landmass generation.
 *
 * Every comparable tool starts you at something to push around -- Wonderdraft's
 * Landmass Wizard, Inkarnate's World Generator, Azgaar's heightmap templates --
 * and Cartograph started you at a blank page. This grows a coastline from a
 * seed and hands it to the Landmass layer as one ordinary op, so the shelf, the
 * ink line, the texture, undo and the eraser all treat it like painted land.
 *
 * The one design problem is that the document is ops, not a raster. A height
 * field is not an op, so it is thresholded at sea level, traced into closed
 * rings with marching squares, simplified, and stored as polygons. The rings go
 * into project.json, not just the seed: a map must reload pixel-identical, and
 * a map made today must still reload the same after this file changes. The
 * settings are stored beside them so the result can be read, and re-rolled.
 */

import { app, emit, markDirty, scheduleAutosave } from './app.js';
import { pushEntry } from './history.js';
import * as R from './render.js';
import { field } from './ui.js';
import { el, hashString, makeCanvas, modal, throttleFrame, toast } from './util.js';


/* ------------------------------------------------------------------ settings */

/* How the land is arranged. `bias` is a height added before the threshold, in
   map-normalised coordinates (u, v run -1..1 across the map); `weight` is how
   hard it pulls against the noise. A coast is land along one side, so it is the
   one arrangement that is meant to run off the edge of the map. */
/* `land` is the share of the map the shape suggests when it is picked, and
   `grain` scales the feature size: an archipelago is many small things. */
export const GEN_SHAPES = {
  continent:   { label: 'One continent',      land: 0.38, grain: 1,    weight: 1,   bias: (u, v) => 0.5 - (u * u + v * v) },
  island:      { label: 'A single island',    land: 0.2,  grain: 0.8,  weight: 2.2, bias: (u, v) => 0.3 - (u * u + v * v) },
  archipelago: { label: 'Archipelago',        land: 0.24, grain: 0.45, weight: 0.8, bias: (u, v) => 0.3 - (u * u + v * v) },
  scattered:   { label: 'Scattered lands',    land: 0.35, grain: 0.7,  weight: 0,   bias: () => 0 },
  west:        { label: 'Coast to the west',  land: 0.45, grain: 1,    weight: 1,   bias: (u) => -u, coast: true },
  east:        { label: 'Coast to the east',  land: 0.45, grain: 1,    weight: 1,   bias: (u) => u, coast: true },
  north:       { label: 'Coast to the north', land: 0.45, grain: 1,    weight: 1,   bias: (u, v) => -v, coast: true },
  south:       { label: 'Coast to the south', land: 0.45, grain: 1,    weight: 1,   bias: (u, v) => v, coast: true },
};

export const GEN_DEFAULTS = {
  seed: '',
  shape: 'continent',
  land: 0.38,        // share of the map above sea level -- exact, see seaLevel()
  scale: 0.55,       // the largest feature, as a fraction of the map's long side
  rough: 0.55,       // how much each finer octave counts: a smooth or ragged coast
  edges: true,       // keep the land off the frame (ignored by the coast shapes)
};

/** A fresh seed that a person can read back and type in again. */
export function randomSeed() {
  const words = ['amber', 'ash', 'brine', 'cairn', 'dusk', 'ember', 'fen', 'gale',
                 'harrow', 'isle', 'kestrel', 'loam', 'mire', 'north', 'oak', 'pike',
                 'quill', 'reach', 'salt', 'thorn', 'umber', 'vale', 'wold', 'yarrow'];
  const pick = () => words[Math.floor(Math.random() * words.length)];
  return pick() + '-' + pick() + '-' + Math.floor(Math.random() * 100);
}

/** The settings with every field present and in range. A seed nobody typed
 *  is not left empty: it is what makes the op reproducible. */
export function normalise(params) {
  const p = Object.assign({}, GEN_DEFAULTS, params || {});
  if (!GEN_SHAPES[p.shape]) p.shape = GEN_DEFAULTS.shape;
  p.seed = String(p.seed || '').trim() || randomSeed();
  p.land = clamp01(+p.land, 0.05, 0.9, GEN_DEFAULTS.land);
  p.scale = clamp01(+p.scale, 0.15, 1, GEN_DEFAULTS.scale);
  p.rough = clamp01(+p.rough, 0.3, 0.75, GEN_DEFAULTS.rough);
  p.edges = p.edges !== false;
  return p;
}

function clamp01(v, lo, hi, fallback) {
  if (!isFinite(v)) return fallback;
  return v < lo ? lo : v > hi ? hi : v;
}


/* --------------------------------------------------------------------- noise */

/* Value noise on an integer lattice, hashed rather than tabled so the field has
   no period and needs no memory. Only integer maths and + - * / -- nothing an
   engine is free to round differently -- although the rings, not the noise,
   are what is saved, so that is tidiness rather than a load-bearing promise. */
function hash(ix, iy, seed) {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function valueNoise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, seed), b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed), d = hash(ix + 1, iy + 1, seed);
  const top = a + (b - a) * fx, bottom = c + (d - c) * fx;
  return top + (bottom - top) * fy;
}

/* Each octave is turned a little against the last. Value noise on a square
   lattice has a grain that runs along the axes, and stacking octaves on the
   same axes adds it up into coastlines that are suspiciously north-south. */
const TURN_C = 0.8775825618903728, TURN_S = 0.479425538604203;   // cos, sin 0.5

function fbm(x, y, seed, octaves, gain) {
  let sum = 0, norm = 0, amp = 1;
  // Turned before the first octave as well: at the largest scale there are
  // only three or four lattice cells across the map, and an unturned one left
  // a long ruler-straight north-south coast often enough to notice.
  let t = x * TURN_C - y * TURN_S; y = x * TURN_S + y * TURN_C; x = t;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x, y, (seed + Math.imul(o, 1013904223)) | 0);
    norm += amp;
    amp *= gain;
    const nx = (x * TURN_C - y * TURN_S) * 2, ny = (x * TURN_S + y * TURN_C) * 2;
    x = nx + 17.31; y = ny - 9.17;
  }
  return sum / norm;
}


/* -------------------------------------------------------------- height field */

/** The spacing of the samples the coast is traced from, in map pixels. Fine
 *  enough that the traced line is smoother than the ink drawn over it. */
export function traceCell(w, h) {
  return Math.max(3, Math.round(Math.max(w, h) / 400));
}

/** Enough octaves that the finest one is about the size of a trace sample:
 *  more is detail nobody can see, fewer is a coast that goes smooth close up.
 *  The caller passes the map's trace cell, not the grid it is sampling, so the
 *  coarse preview in the dialog is the same land as the one it previews. */
function octavesFor(period, cell) {
  let n = 1;
  while (n < 10 && period / 2 ** n > cell) n++;
  return n;
}

/* Tuned by eye against a sheet of seeds for every shape, not derived. Much
   more warp smears the coast into streaks; much less noise and every shape
   comes out as the bias's own ellipse with a ragged edge. */
const WARP = 0.7;
const NOISE_GAIN = 3;

/** Heights at every sample of a (cols+1) x (rows+1) lattice, `cell` apart. */
export function heightField(params, w, h, cell) {
  const p = normalise(params);
  const shape = GEN_SHAPES[p.shape];
  const seed = hashString(p.seed) | 0;
  const period = Math.max(w, h) * p.scale * shape.grain * 0.6;
  const octaves = octavesFor(period, traceCell(w, h));
  const cols = Math.ceil(w / cell), rows = Math.ceil(h / cell);
  const field = new Float32Array((cols + 1) * (rows + 1));
  const margin = Math.max(w, h) * 0.1;
  const fade = p.edges && !shape.coast;

  for (let j = 0; j <= rows; j++) {
    const y = Math.min(h, j * cell);
    for (let i = 0; i <= cols; i++) {
      const x = Math.min(w, i * cell);
      const nx = x / period, ny = y / period;
      // A domain warp: the sample point is pushed about by two slower fields
      // first, which is what turns the blobs of plain fBm into peninsulas,
      // bays and the odd long spit.
      const wx = fbm(nx * 0.7 + 5.2, ny * 0.7 + 1.3, seed ^ 0x51ed27, 4, 0.5) - 0.5;
      const wy = fbm(nx * 0.7 + 9.7, ny * 0.7 + 2.8, seed ^ 0x2c1b3f, 4, 0.5) - 0.5;
      // fBm of value noise huddles round 0.5 with a spread of about a tenth;
      // centred and stretched here so that the shape's bias, which runs over
      // a whole unit, is a pull on the land rather than the whole of it.
      let v = (fbm(nx + wx * WARP, ny + wy * WARP, seed, octaves, p.rough) - 0.5) * NOISE_GAIN;
      const u = (x / w) * 2 - 1, t = (y / h) * 2 - 1;
      v += shape.weight * shape.bias(u, t);
      if (fade) {
        const d = Math.min(x, w - x, y, h - y) / margin;
        if (d < 1) v -= (1 - d) * (1 - d) * 2;
      }
      field[j * (cols + 1) + i] = v;
    }
  }
  return { field, cols, rows, cell, level: seaLevel(field, p.land) };
}

/** The height that leaves exactly `land` of the samples above it. Picking sea
 *  level by rank rather than by value is what lets "Land 40%" mean forty per
 *  cent whatever the seed and the shape did to the heights. */
function seaLevel(field, land) {
  const sorted = Float32Array.from(field).sort();
  const k = Math.min(sorted.length - 1, Math.max(0, Math.floor((1 - land) * sorted.length)));
  return sorted[k];
}


/* ----------------------------------------------------------- tracing the coast */

/* Marching squares, then the segments chained into closed rings.
 *
 * The lattice is surrounded by two extra rings of samples before it is traced:
 * the first copies the edge heights a little way outside the map, the second is
 * deep sea further out. Every contour therefore closes, and land that meets the
 * frame carries on past it -- so the ink line and the shelf, which are grown
 * from the mask, are not drawn along the map's own border. */
const OUTSIDE = 24;          // px beyond the frame that edge land is carried to

// For each of the 16 corner cases (tl=8, tr=4, br=2, bl=1), the pairs of cell
// edges (0 top, 1 right, 2 bottom, 3 left) a contour joins. 5 and 10 are the
// saddles; they are settled by the height at the centre of the cell.
const CASES = [
  [], [[3, 2]], [[2, 1]], [[3, 1]], [[0, 1]], null, [[0, 2]], [[0, 3]],
  [[0, 3]], [[0, 2]], null, [[0, 1]], [[3, 1]], [[2, 1]], [[3, 2]], [],
];

export function traceRings(hf, w, h) {
  const { field, cols, rows, cell, level } = hf;
  // Padded lattice: index 0 and C are deep sea, 1 and C-1 are the edge copies.
  const C = cols + 5, R2 = rows + 5;
  const X = (i) => (i <= 0 ? -OUTSIDE - cell : i === 1 ? -OUTSIDE
    : i >= C - 1 ? w + OUTSIDE + cell : i === C - 2 ? w + OUTSIDE : Math.min(w, (i - 2) * cell));
  const Y = (j) => (j <= 0 ? -OUTSIDE - cell : j === 1 ? -OUTSIDE
    : j >= R2 - 1 ? h + OUTSIDE + cell : j === R2 - 2 ? h + OUTSIDE : Math.min(h, (j - 2) * cell));
  const at = (i, j) => {
    if (i <= 0 || j <= 0 || i >= C - 1 || j >= R2 - 1) return level - 1e6;
    const si = Math.min(cols, Math.max(0, i - 2)), sj = Math.min(rows, Math.max(0, j - 2));
    return field[sj * (cols + 1) + si];
  };

  // Where a contour crosses an edge of the lattice, by a numeric edge id: even
  // ids are horizontal edges (i,j)-(i+1,j), odd ones vertical (i,j)-(i,j+1).
  const points = new Map();
  const cross = (id) => {
    let p = points.get(id);
    if (p) return p;
    const horiz = (id & 1) === 0, k = id >> 1;
    const i = k % (C + 1), j = (k - i) / (C + 1);
    const a = at(i, j), b = horiz ? at(i + 1, j) : at(i, j + 1);
    const t = Math.abs(b - a) < 1e-12 ? 0.5 : (level - a) / (b - a);
    p = horiz ? [X(i) + (X(i + 1) - X(i)) * t, Y(j)]
              : [X(i), Y(j) + (Y(j + 1) - Y(j)) * t];
    points.set(id, p);
    return p;
  };
  const edgeId = (i, j, side) => {
    if (side === 0) return ((j * (C + 1) + i) << 1);
    if (side === 2) return (((j + 1) * (C + 1) + i) << 1);
    if (side === 3) return ((j * (C + 1) + i) << 1) | 1;
    return ((j * (C + 1) + i + 1) << 1) | 1;
  };

  // Every crossing is shared by exactly two cells (the padding guarantees no
  // contour reaches the outside of the lattice), so the segments form an
  // undirected graph in which every node has two neighbours.
  const links = new Map();
  const link = (a, b) => {
    (links.get(a) || links.set(a, []).get(a)).push(b);
    (links.get(b) || links.set(b, []).get(b)).push(a);
  };
  for (let j = 0; j < R2 - 1; j++) {
    for (let i = 0; i < C - 1; i++) {
      const tl = at(i, j) >= level, tr = at(i + 1, j) >= level;
      const br = at(i + 1, j + 1) >= level, bl = at(i, j + 1) >= level;
      const index = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
      let pairs = CASES[index];
      if (!pairs) {
        const centre = (at(i, j) + at(i + 1, j) + at(i + 1, j + 1) + at(i, j + 1)) / 4 >= level;
        if (index === 5) pairs = centre ? [[0, 3], [2, 1]] : [[3, 2], [0, 1]];
        else pairs = centre ? [[0, 1], [3, 2]] : [[0, 3], [2, 1]];
      }
      for (const [s, e] of pairs) link(edgeId(i, j, s), edgeId(i, j, e));
    }
  }

  const rings = [];
  const seen = new Set();
  for (const start of links.keys()) {
    if (seen.has(start)) continue;
    const ring = [];
    let prev = -1, cur = start;
    while (!seen.has(cur)) {
      seen.add(cur);
      ring.push(cross(cur));
      const [a, b] = links.get(cur);
      const next = a !== prev ? a : b;
      prev = cur; cur = next;
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

function ringArea(ring) {
  let s = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}

/** Douglas-Peucker on an open run of points. */
function simplifyRun(pts, tol, out) {
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  const tol2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    let worst = -1, far = 0;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      let d;
      if (len2 < 1e-9) d = (px - ax) ** 2 + (py - ay) ** 2;
      else {
        const c = (px - ax) * dy - (py - ay) * dx;
        d = (c * c) / len2;
      }
      if (d > far) { far = d; worst = i; }
    }
    if (worst > 0 && far > tol2) { keep[worst] = 1; stack.push([a, worst], [worst, b]); }
  }
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
}

/** A closed ring, simplified: split at the point furthest from the first so
 *  that each half is an open run the usual algorithm can take. */
function simplifyRing(ring, tol) {
  let far = 0, k = 0;
  const [x0, y0] = ring[0];
  for (let i = 1; i < ring.length; i++) {
    const d = (ring[i][0] - x0) ** 2 + (ring[i][1] - y0) ** 2;
    if (d > far) { far = d; k = i; }
  }
  const out = [];
  simplifyRun(ring.slice(0, k + 1), tol, out);
  out.pop();
  simplifyRun(ring.slice(k).concat([ring[0]]), tol, out);
  out.pop();
  return out;
}


/* -------------------------------------------------------------------- the op */

/** Generate the land for a map `w` x `h`. Returns the op the Landmass layer
 *  stores: polygons as flat [x, y, x, y, ...] lists to one decimal place, the
 *  settings they came from, and the corners of their extent in `points`, which
 *  is what every box function in the renderer already reads. */
export function generateLand(params, w, h) {
  const p = normalise(params);
  const cell = traceCell(w, h);
  const hf = heightField(p, w, h, cell);
  // Specks and puddles smaller than about a hundredth of the map across are
  // noise rather than geography, and each would get its own ring of ink.
  const minArea = (Math.max(w, h) * 0.012) ** 2;
  const rings = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const ring of traceRings(hf, w, h)) {
    if (ringArea(ring) < minArea) continue;
    const simple = simplifyRing(ring, cell * 0.3);
    if (simple.length < 3) continue;
    const flat = [];
    for (const [x, y] of simple) {
      const rx = Math.round(x * 10) / 10, ry = Math.round(y * 10) / 10;
      flat.push(rx, ry);
      if (rx < x0) x0 = rx; if (rx > x1) x1 = rx;
      if (ry < y0) y0 = ry; if (ry > y1) y1 = ry;
    }
    rings.push(flat);
  }
  return {
    t: 'stroke', mode: 'shape', shape: 'generated',
    gen: { seed: p.seed, shape: p.shape, land: p.land, scale: p.scale, rough: p.rough, edges: p.edges },
    rings,
    size: 0, hardness: 1,
    points: rings.length ? [{ x: x0, y: y0 }, { x: x1, y: y1 }] : [],
  };
}

/** Put the generated land on the map as one undoable step.
 *
 * `replace` starts the layer again -- a `clear` op, which the mask replay has
 * always honoured -- so the step can be undone to exactly the land that was
 * there. The whole layer is rebuilt either way: a generated coast reaches
 * across the map, and invalidate is also the route that brings a terrain fill
 * bound to the landmass along with it. */
export function commitLand(layer, op, replace) {
  const before = layer.ops.slice();
  if (replace && layer.ops.length) layer.ops.push({ t: 'clear' });
  layer.ops.push(op);
  const after = layer.ops.slice();
  R.invalidate(layer);
  pushEntry({
    label: 'Generate land',
    bytes: 0,
    undo() { layer.ops = before.slice(); R.invalidate(layer); emit('layers'); },
    redo() { layer.ops = after.slice(); R.invalidate(layer); emit('layers'); },
  });
  markDirty(); scheduleAutosave();
  emit('layers');
}


/* ------------------------------------------------------------------- dialog */

/* The last settings used, for this session. Not in the settings bag: a seed is
   about one map, and carrying last week's into a new one would be a surprise. */
let lastParams = null;

export function landLayer() {
  return app.doc ? app.doc.layers.find((l) => l.kind === 'land') || null : null;
}

/** Draw a thresholded preview of `params` into `canvas`. Coarser than the real
 *  trace, but the same height field, so it is the same land. */
function drawPreview(canvas, params) {
  const doc = app.doc;
  const cell = Math.max(traceCell(doc.width, doc.height), Math.max(doc.width, doc.height) / 240);
  const hf = heightField(params, doc.width, doc.height, cell);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(hf.cols + 1, hf.rows + 1);
  for (let i = 0; i < hf.field.length; i++) {
    const land = hf.field[i] >= hf.level;
    img.data[i * 4] = land ? 124 : 58;
    img.data[i * 4 + 1] = land ? 154 : 96;
    img.data[i * 4 + 2] = land ? 82 : 128;
    img.data[i * 4 + 3] = 255;
  }
  const small = makeCanvas(hf.cols + 1, hf.rows + 1);
  small.getContext('2d').putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
}

export async function generateDialog() {
  const layer = landLayer();
  if (!layer) return toast('This map has no Landmass layer to generate into', 'bad');
  if (layer.locked) return toast('The Landmass layer is locked', 'bad');

  const p = normalise(Object.assign({}, lastParams || {}, { seed: randomSeed() }));
  let replace = layer.ops.length > 0;

  const doc = app.doc;
  const pw = 360, ph = Math.max(120, Math.round(pw * doc.height / doc.width));
  const preview = el('canvas', { class: 'gen-preview', width: pw, height: ph });
  const redraw = throttleFrame(() => drawPreview(preview, p));

  const seedInput = el('input', { type: 'text', value: p.seed, 'data-gen': 'seed', spellcheck: 'false' });
  seedInput.addEventListener('input', () => { p.seed = seedInput.value; redraw(); });
  const reroll = el('button', {
    class: 'btn', text: 'Re-roll', 'data-gen': 'reroll', type: 'button',
    onclick: () => { p.seed = seedInput.value = randomSeed(); redraw(); },
  });

  const set = (key) => (v) => { p[key] = v; redraw(); };
  // Picking a shape also picks the amount of land it reads best at -- an
  // island is not 38% of the map -- and the slider is rebuilt to say so.
  const landField = () => field({ type: 'range', label: 'Land', min: 0.05, max: 0.9, step: 0.01,
                                  value: p.land, percent: true }, set('land'));
  let landNode = landField();
  const pickShape = (v) => {
    p.shape = v;
    p.land = GEN_SHAPES[v].land;
    const next = landField();
    landNode.replaceWith(next);
    landNode = next;
    redraw();
  };
  const body = el('div', { class: 'gen' }, [
    preview,
    el('div', { class: 'field' }, [el('label', {}, [el('span', { text: 'Seed' })]),
      el('div', { class: 'gen-seed' }, [seedInput, reroll])]),
    field({ type: 'select', label: 'Shape', value: p.shape,
            options: Object.entries(GEN_SHAPES).map(([id, s]) => [id, s.label]) }, pickShape),
    landNode,
    field({ type: 'range', label: 'Feature size', min: 0.15, max: 1, step: 0.01, value: p.scale, percent: true }, set('scale')),
    field({ type: 'range', label: 'Ragged coast', min: 0.3, max: 0.75, step: 0.01, value: p.rough, percent: true }, set('rough')),
    field({ type: 'toggle', label: 'Keep clear of the map edge', value: p.edges }, set('edges')),
    layer.ops.length
      ? field({ type: 'select', label: 'Existing land', value: 'replace',
                options: [['replace', 'Replace it'], ['add', 'Add to it']] }, (v) => { replace = v === 'replace'; })
      : null,
    el('p', { class: 'empty', text:
      'The same seed and settings always give the same land. The coastline is written into the map ' +
      'as ordinary landmass, so the eraser, the brush and undo all work on it afterwards.' }),
  ]);
  drawPreview(preview, p);

  const go = await modal({
    title: 'Generate land',
    body,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Generate', class: 'btn-primary', value: true }],
  });
  if (!go) return;
  const params = normalise(p);
  lastParams = params;
  const op = generateLand(params, doc.width, doc.height);
  if (!op.rings.length) return toast('That left no land above the sea -- try more land', 'bad');
  commitLand(layer, op, replace);
  toast('Generated land from seed "' + params.seed + '"', 'good');
}
