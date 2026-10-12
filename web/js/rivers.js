/* Rivers from a seed, drawn to fit the land that is already on the map.
 *
 * Azgaar's generator runs its rivers downhill over a height map and Wonderdraft
 * leaves them to the hand; Cartograph had the hand and no downhill. The land
 * here has no heights -- a Landmass layer is a shape, painted or generated --
 * so the height is made up: how far each point is from the sea, roughened by
 * seeded noise so a river wanders rather than marching straight to the nearest
 * beach. Water then runs downhill over that, every river reaches the sea, and
 * the biggest basins become the rivers.
 *
 * What lands in the document is ordinary river paths -- points, a width and a
 * colour -- never the height field, for the reason generated land keeps its
 * rings: a map must reopen pixel-identical even after this file changes how a
 * seed is drawn. Each carries `gen: 'rivers'` so generating again can replace
 * them; a river copied and pasted loses the tag (clipboard.js) and is kept.
 */

import { app, emit, markDirty, scheduleAutosave } from './app.js';
import { fbm, randomSeed } from './generate.js';
import { pushEntry } from './history.js';
import * as R from './render.js';
import { field } from './ui.js';
import { el, hashString, makeCanvas, modal, throttleFrame, toast, uid } from './util.js';


/* ------------------------------------------------------------------ settings */

export const RIVER_DEFAULTS = {
  seed: '',
  count: 4,          // main rivers, each reaching the sea on its own
  branches: 0.5,     // how readily a tributary is drawn: none at 0
  meander: 0.5,      // how far the noise may pull a river off the shortest way down
  width: 14,         // at the mouth of the largest river, in map pixels
  color: '#4d7fa0',
};

export function normaliseRivers(params) {
  const p = Object.assign({}, RIVER_DEFAULTS, params || {});
  p.seed = String(p.seed || '').trim() || randomSeed();
  p.count = Math.round(clampNum(p.count, 1, 12, RIVER_DEFAULTS.count));
  p.branches = clampNum(p.branches, 0, 1, RIVER_DEFAULTS.branches);
  p.meander = clampNum(p.meander, 0, 1, RIVER_DEFAULTS.meander);
  p.width = clampNum(p.width, 2, 60, RIVER_DEFAULTS.width);
  if (!/^#[0-9a-f]{6}$/i.test(String(p.color))) p.color = RIVER_DEFAULTS.color;
  return p;
}

function clampNum(v, lo, hi, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}


/* ------------------------------------------------------------- the land grid */

/** The sample spacing, in map pixels. A few hundred cells on the long side is
 *  finer than any river is drawn and keeps the whole run to a few milliseconds. */
export function riverCell(w, h) {
  return Math.max(4, Math.ceil(Math.max(w, h) / 320));
}

/** The Landmass layer's mask sampled to a grid: 1 for land, 0 for sea.
 *  Read from the mask rather than the ops so painted land, carved bays and
 *  generated coasts all count the same way the coastline drawn round them does. */
export function landGrid(layer, w, h) {
  const cell = riverCell(w, h);
  const cols = Math.ceil(w / cell), rows = Math.ceil(h / cell);
  const small = makeCanvas(cols, rows);
  const ctx = small.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(R.maskFor(layer), 0, 0, cols * cell, rows * cell, 0, 0, cols, rows);
  const data = ctx.getImageData(0, 0, cols, rows).data;
  const land = new Uint8Array(cols * rows);
  for (let i = 0; i < land.length; i++) land[i] = data[i * 4 + 3] >= 128 ? 1 : 0;
  return { cols, rows, cell, land };
}


/* -------------------------------------------------------------- downhill */

// Eight neighbours, the four square ones first: a mouth is found across a
// side before a corner, so a river meets the coast face on, not at a slant.
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];

/** A binary min-heap of cell indices keyed on a Float64Array. Ties go to the
 *  lower index, so the order cells come out in -- and so every river -- is
 *  the same on every machine. */
function heap(key) {
  const a = [];
  const less = (i, j) => key[a[i]] < key[a[j]] || (key[a[i]] === key[a[j]] && a[i] < a[j]);
  const swap = (i, j) => { const t = a[i]; a[i] = a[j]; a[j] = t; };
  return {
    get size() { return a.length; },
    push(v) {
      a.push(v);
      let i = a.length - 1;
      while (i > 0) { const p = (i - 1) >> 1; if (!less(i, p)) break; swap(i, p); i = p; }
    },
    pop() {
      const top = a[0], last = a.pop();
      if (a.length) {
        a[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1, r = l + 1;
          let m = i;
          if (l < a.length && less(l, m)) m = l;
          if (r < a.length && less(r, m)) m = r;
          if (m === i) break;
          swap(i, m); i = m;
        }
      }
      return top;
    },
  };
}

/** Distance from the sea in cells, by a two-pass chamfer. The map's edge is
 *  not sea: land that runs off the frame carries on beyond it, and a river
 *  should find the coast that is drawn rather than leave by the side. */
function seaDistance(g) {
  const { cols, rows, land } = g;
  const d = new Float64Array(cols * rows);
  const BIG = 1e9, D = Math.SQRT2;
  for (let i = 0; i < d.length; i++) d[i] = land[i] ? BIG : 0;
  const relax = (i, x, y, dx, dy, cost) => {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) return;
    const v = d[ny * cols + nx] + cost;
    if (v < d[i]) d[i] = v;
  };
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (!land[i]) continue;
      relax(i, x, y, -1, 0, 1); relax(i, x, y, 0, -1, 1);
      relax(i, x, y, -1, -1, D); relax(i, x, y, 1, -1, D);
    }
  }
  for (let y = rows - 1; y >= 0; y--) {
    for (let x = cols - 1; x >= 0; x--) {
      const i = y * cols + x;
      if (!land[i]) continue;
      relax(i, x, y, 1, 0, 1); relax(i, x, y, 0, 1, 1);
      relax(i, x, y, 1, 1, D); relax(i, x, y, -1, 1, D);
    }
  }
  return d;
}

/** Which way water leaves every land cell, and how much land drains through it.
 *
 * A priority flood (Barnes, Lehman and Mulla, 2014) outward from the coast:
 * the lowest cell not yet reached is always taken next, and drains into the
 * cell it was reached from. Every cell therefore has a way to the sea --
 * no river stops in a hollow of the noise -- and the order cells were taken
 * in runs from the sea upstream, which is the order to add the drainage in
 * reversed. */
export function drainage(g, params) {
  const p = normaliseRivers(params);
  const { cols, rows, land } = g;
  const n = cols * rows;
  const dist = seaDistance(g);
  let far = 1;
  for (let i = 0; i < n; i++) if (land[i] && dist[i] < 1e9 && dist[i] > far) far = dist[i];
  const seed = hashString(p.seed) | 0;
  const period = Math.max(cols, rows) * 0.12;
  const height = new Float64Array(n);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (!land[i]) continue;
      // The noise is scaled against the land's own depth, so meander means
      // the same thing on a thin island as on a broad continent. The floor
      // keeps a river off the ruler-straight line a bare distance field draws,
      // and keeps the seed doing something with meander at nought.
      // fBm huddles round 0.5 with a spread of about a tenth, so it is
      // centred and stretched as the land generator's is.
      const wobble = (fbm(x / period + 3.1, y / period - 7.7, seed, 4, 0.55) - 0.5) * 3;
      height[i] = dist[i] / far + wobble * (0.2 + p.meander * 0.8);
    }
  }

  const down = new Int32Array(n).fill(-1);
  const mouthTo = new Int32Array(n).fill(-1);
  const key = new Float64Array(n);
  const seen = new Uint8Array(n);
  const order = [];
  const q = heap(key);
  let anySea = false;
  for (let i = 0; i < n; i++) if (!land[i]) { anySea = true; break; }

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (!land[i]) continue;
      for (let k = 0; k < 8; k++) {
        const nx = x + DX[k], ny = y + DY[k];
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        if (land[ny * cols + nx]) continue;
        mouthTo[i] = ny * cols + nx;
        break;
      }
      // With no sea anywhere the frame has to do: the whole map is land.
      if (mouthTo[i] >= 0 || (!anySea && (x === 0 || y === 0 || x === cols - 1 || y === rows - 1))) {
        key[i] = height[i];
        seen[i] = 1;
        q.push(i);
      }
    }
  }
  while (q.size) {
    const c = q.pop();
    order.push(c);
    const cx = c % cols, cy = (c - cx) / cols;
    for (let k = 0; k < 8; k++) {
      const nx = cx + DX[k], ny = cy + DY[k];
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const j = ny * cols + nx;
      if (!land[j] || seen[j]) continue;
      seen[j] = 1;
      down[j] = c;
      // A hollow is filled to its rim plus a hair, so water keeps moving.
      key[j] = Math.max(height[j], key[c] + 1e-7);
      q.push(j);
    }
  }

  const acc = new Float64Array(n);
  for (let k = order.length - 1; k >= 0; k--) {
    const c = order[k];
    acc[c] += 1;
    if (down[c] >= 0) acc[down[c]] += acc[c];
  }
  // Upstream neighbours of every cell, for tracing a river back to its source.
  const ups = new Map();
  for (const c of order) {
    if (down[c] < 0) continue;
    let list = ups.get(down[c]);
    if (!list) ups.set(down[c], list = []);
    list.push(c);
  }
  return { down, mouthTo, acc, ups, order, landCells: order.length };
}


/* ------------------------------------------------------------- the rivers */

/** A small seeded generator for the choices that are not geography. */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Follow the biggest stream upstream from `start` until it is a trickle, or
 *  until the next step would come too close to another river's water
 *  (`blocked`). Returns the cells source first. */
function upstream(d, start, trickle, blocked) {
  const run = [start];
  let c = start;
  for (;;) {
    const list = d.ups.get(c);
    if (!list) break;
    let best = -1;
    for (const u of list) if (best < 0 || d.acc[u] > d.acc[best] || (d.acc[u] === d.acc[best] && u < best)) best = u;
    if (best < 0 || d.acc[best] < trickle || blocked(best, run.length)) break;
    run.push(best);
    c = best;
  }
  return run.reverse();
}

/** The rivers for a land grid, as path items without ids: source first, so the
 *  renderer's widening runs the right way. Pure, so a test can hold it to the
 *  same-seed, same-rivers promise without a dialog in the way. */
export function traceRivers(g, params) {
  const p = normaliseRivers(params);
  const { cols, rows, cell } = g;
  const d = drainage(g, p);
  if (!d.landCells) return [];
  const long = Math.max(cols, rows);
  // A river shorter than this is a stream nobody would name.
  const minLen = Math.max(6, Math.round(long * 0.06));
  const trickle = Math.max(3, Math.round(d.landCells * 0.0006));
  const spacing = long * 0.07;

  // The mouths worth having, biggest basin first, with a seeded nudge so two
  // seeds on the same island do not always pick the same three rivers.
  const pick = rng(hashString(p.seed + '/mouths'));
  const mouths = [];
  for (const c of d.order) if (d.mouthTo[c] >= 0 && d.acc[c] >= minLen * 2) mouths.push({ c, score: d.acc[c] * (0.6 + 0.8 * pick()) });
  mouths.sort((a, b) => b.score - a.score || a.c - b.c);

  // Two rivers draining opposite sides of a ridge rise on either side of it,
  // a cell apart, and drawn that close they read as one river crossing the
  // land. So every river system claims a margin round its water, and another
  // system's sources stop short of it.
  const owner = new Int16Array(cols * rows).fill(-1);
  const gap = Math.max(2, Math.round(long * 0.04));
  // Within one system a tributary must not hug its parent or a sibling
  // either, once it is clear of the junction it leaves from.
  const near = new Uint8Array(cols * rows);
  const close = Math.max(1, Math.round(gap * 0.5));
  const mark = (cells) => {
    for (const c of cells) {
      const cx = c % cols, cy = (c - cx) / cols;
      for (let y = Math.max(0, cy - close); y <= Math.min(rows - 1, cy + close); y++) {
        for (let x = Math.max(0, cx - close); x <= Math.min(cols - 1, cx + close); x++) near[y * cols + x] = 1;
      }
    }
  };
  const claim = (cells, sys) => {
    for (const c of cells) {
      const cx = c % cols, cy = (c - cx) / cols;
      for (let y = Math.max(0, cy - gap); y <= Math.min(rows - 1, cy + gap); y++) {
        for (let x = Math.max(0, cx - gap); x <= Math.min(cols - 1, cx + gap); x++) {
          if ((x - cx) ** 2 + (y - cy) ** 2 <= gap * gap && owner[y * cols + x] < 0) owner[y * cols + x] = sys;
        }
      }
    }
  };

  const xy = (c) => ({ x: c % cols, y: Math.floor(c / cols) });
  const chosen = [];
  const rivers = [];
  let biggest = 0;
  // Tributaries: any other stream feeding a river that carries enough of the
  // river's water, traced to its own source and ending where it joins. Two
  // levels deep at most -- a third is a map of ditches.
  const share = 0.3 - 0.27 * p.branches;
  for (const m of mouths) {
    if (chosen.length >= p.count) break;
    const at = xy(m.c);
    if (chosen.some((o) => Math.hypot(o.x - at.x, o.y - at.y) < spacing)) continue;
    const sys = chosen.length;
    const blocked = (c) => owner[c] >= 0 && owner[c] !== sys;
    const stem = upstream(d, m.c, trickle, blocked);
    if (stem.length < minLen) continue;
    chosen.push(at);
    if (!biggest) biggest = d.acc[m.c];
    const system = [{ cells: stem, end: d.mouthTo[m.c], flow: d.acc[m.c], main: true }];
    mark(stem);
    const tribBlocked = (c, step) => blocked(c) || (step > close + 2 && near[c] === 1);
    if (p.branches > 0) {
      const queue = [{ r: system[0], depth: 1 }];
      while (queue.length) {
        const { r, depth } = queue.shift();
        if (depth > 2) continue;
        const on = new Set(r.cells);
        for (let k = r.cells.length - 1; k >= 0; k--) {
          const list = d.ups.get(r.cells[k]);
          if (!list) continue;
          for (const u of list) {
            if (on.has(u) || blocked(u) || d.acc[u] < r.flow * share * (depth === 1 ? 1 : 1.6)) continue;
            const cells = upstream(d, u, trickle, tribBlocked);
            if (cells.length < Math.round(minLen * 0.6)) continue;
            const t = { cells, end: r.cells[k], flow: d.acc[u], main: false };
            system.push(t);
            mark(cells);
            queue.push({ r: t, depth: depth + 1 });
          }
        }
      }
    }
    for (const r of system) { claim(r.cells, sys); rivers.push(r); }
  }

  return rivers.map((r) => {
    const pts = r.cells.map((c) => { const q = xy(c); return { x: (q.x + 0.5) * cell, y: (q.y + 0.5) * cell }; });
    const e = xy(r.end);
    if (r.main) {
      // Out to the line between the last land cell and the sea, where the
      // coast's ink is drawn, so the river meets the coast rather than
      // stopping a few pixels short of it.
      const last = pts[pts.length - 1];
      pts.push({ x: (last.x + (e.x + 0.5) * cell) / 2, y: (last.y + (e.y + 0.5) * cell) / 2 });
    } else {
      pts.push({ x: (e.x + 0.5) * cell, y: (e.y + 0.5) * cell });
    }
    const width = r.main
      ? p.width * Math.max(0.55, Math.sqrt(r.flow / biggest))
      : p.width * Math.max(0.3, Math.min(0.8, Math.sqrt(r.flow / biggest)));
    return {
      style: 'river',
      width: Math.round(width * 10) / 10,
      color: p.color,
      points: smoothRun(pts, cell),
      gen: 'rivers',
    };
  });
}

/** Take the staircase out of a run of grid cells: a moving average with the
 *  ends pinned, then the points the curve does not need dropped. */
function smoothRun(pts, cell) {
  let a = pts;
  for (let pass = 0; pass < 2; pass++) {
    a = a.map((q, i) => (i === 0 || i === a.length - 1) ? q : {
      x: (a[i - 1].x + q.x * 2 + a[i + 1].x) / 4,
      y: (a[i - 1].y + q.y * 2 + a[i + 1].y) / 4,
    });
  }
  const keep = new Uint8Array(a.length);
  keep[0] = keep[a.length - 1] = 1;
  const tol = cell * 0.3;
  const stack = [[0, a.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop();
    const A = a[i0], B = a[i1];
    const len = Math.hypot(B.x - A.x, B.y - A.y) || 1;
    let worst = -1, far = tol;
    for (let i = i0 + 1; i < i1; i++) {
      const off = Math.abs((B.x - A.x) * (A.y - a[i].y) - (A.x - a[i].x) * (B.y - A.y)) / len;
      if (off > far) { far = off; worst = i; }
    }
    if (worst >= 0) { keep[worst] = 1; stack.push([i0, worst], [worst, i1]); }
  }
  const out = [];
  for (let i = 0; i < a.length; i++) {
    if (keep[i]) out.push({ x: Math.round(a[i].x * 10) / 10, y: Math.round(a[i].y * 10) / 10 });
  }
  return out;
}


/* ------------------------------------------------------------- committing */

export const isGeneratedRiver = (item) => !!(item && item.gen === 'rivers');

/** Put rivers on a paths layer as one undoable step. `replace` takes away
 *  the rivers generated before and leaves every hand-drawn path alone. */
export function commitRivers(layer, items, replace) {
  const before = layer.ops.slice();
  const kept = replace ? before.filter((o) => !isGeneratedRiver(o)) : before;
  const after = kept.concat(items.map((it) => Object.assign({ id: uid('p') }, it)));
  layer.ops = after.slice();
  R.invalidate(layer);
  pushEntry({
    label: 'Generate rivers',
    undo() { layer.ops = before.slice(); R.invalidate(layer); emit('layers'); },
    redo() { layer.ops = after.slice(); R.invalidate(layer); emit('layers'); },
  });
  markDirty(); scheduleAutosave();
  emit('layers');
}


/* ------------------------------------------------------------------ dialog */

// The last settings used, for this session only, as the land dialog keeps them.
let lastParams = null;

function drawPreview(canvas, g, items) {
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(g.cols, g.rows);
  for (let i = 0; i < g.land.length; i++) {
    const on = g.land[i];
    img.data[i * 4] = on ? 124 : 58;
    img.data[i * 4 + 1] = on ? 154 : 96;
    img.data[i * 4 + 2] = on ? 82 : 128;
    img.data[i * 4 + 3] = 255;
  }
  const small = makeCanvas(g.cols, g.rows);
  small.getContext('2d').putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
  const k = canvas.width / (g.cols * g.cell);
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = '#1f4f7a';
  for (const it of items) {
    ctx.lineWidth = Math.max(1, it.width * k * 1.6);
    ctx.beginPath();
    it.points.forEach((q, i) => (i ? ctx.lineTo(q.x * k, q.y * k) : ctx.moveTo(q.x * k, q.y * k)));
    ctx.stroke();
  }
  ctx.restore();
}

export async function riversDialog() {
  const doc = app.doc;
  if (!doc) return;
  const paths = doc.layers.find((l) => l.kind === 'paths');
  if (!paths) return toast('This map has no Paths layer to draw rivers on', 'bad');
  if (paths.locked) return toast('The Paths layer is locked', 'bad');
  const landLayer = doc.layers.find((l) => l.kind === 'land');
  if (!landLayer || !landLayer.ops.length) {
    return toast('Rivers need land to run over -- paint some, or generate it, first', 'bad');
  }
  const g = landGrid(landLayer, doc.width, doc.height);
  if (!g.land.some((v) => v)) return toast('There is no land on the Landmass layer for rivers to run over', 'bad');

  const p = normaliseRivers(Object.assign({}, lastParams || {}, { seed: randomSeed() }));
  const earlier = paths.ops.filter(isGeneratedRiver).length;
  let replace = earlier > 0;
  let items = [];

  const pw = 360, ph = Math.max(120, Math.round(pw * doc.height / doc.width));
  const preview = el('canvas', { class: 'gen-preview', width: pw, height: ph, 'data-rivers': 'preview' });
  const note = el('p', { class: 'empty', 'data-rivers': 'count' });
  const redraw = throttleFrame(() => {
    items = traceRivers(g, p);
    drawPreview(preview, g, items);
    note.textContent = items.length
      ? `${items.length} river${items.length === 1 ? '' : 's'} on the map.`
      : 'No river long enough to draw on land this size -- try more land, or another seed.';
  });

  const seedInput = el('input', { type: 'text', value: p.seed, placeholder: p.seed,
                                  'data-rivers': 'seed', spellcheck: 'false' });
  seedInput.addEventListener('input', () => { p.seed = seedInput.value.trim() || seedInput.placeholder; redraw(); });
  const reroll = el('button', {
    class: 'btn', text: 'Re-roll', 'data-rivers': 'reroll', type: 'button',
    onclick: () => { p.seed = seedInput.value = seedInput.placeholder = randomSeed(); redraw(); },
  });
  const set = (key) => (v) => { p[key] = v; redraw(); };
  const body = el('div', { class: 'gen' }, [
    preview,
    el('div', { class: 'field' }, [el('label', {}, [el('span', { text: 'Seed' })]),
      el('div', { class: 'gen-seed' }, [seedInput, reroll])]),
    field({ type: 'range', label: 'Rivers', min: 1, max: 12, step: 1, value: p.count }, set('count')),
    field({ type: 'range', label: 'Tributaries', min: 0, max: 1, step: 0.01, value: p.branches, percent: true }, set('branches')),
    field({ type: 'range', label: 'Meander', min: 0, max: 1, step: 0.01, value: p.meander, percent: true }, set('meander')),
    field({ type: 'range', label: 'Width at the mouth', min: 2, max: 60, step: 0.5, value: p.width, suffix: 'px' }, set('width')),
    field({ type: 'color', label: 'Colour', value: p.color }, set('color')),
    earlier
      ? field({ type: 'select', label: 'Rivers generated before', value: 'replace',
                options: [['replace', 'Replace them'], ['add', 'Keep them']] }, (v) => { replace = v === 'replace'; })
      : null,
    note,
    el('p', { class: 'empty', text:
      'Rivers run downhill from the middle of the land to the coast, the largest basins first. ' +
      'They are ordinary river paths: Select moves or reshapes one, and a road drawn by hand is never touched. ' +
      'Change the land afterwards and the rivers stay where they are -- generate them again to follow it.' }),
  ]);
  items = traceRivers(g, p);
  redraw();

  const go = await modal({
    title: 'Generate rivers',
    body,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Generate', class: 'btn-primary', value: true }],
  });
  if (!go) return;
  const params = normaliseRivers(p);
  lastParams = params;
  const made = traceRivers(g, params);
  if (!made.length) return toast('No river long enough to draw on that land -- try another seed', 'bad');
  commitRivers(paths, made, replace);
  toast(`Generated ${made.length} river${made.length === 1 ? '' : 's'} from seed "${params.seed}"`, 'good');
}
