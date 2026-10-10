/* Grid references on a map frame, and the art that came the same day (art
 * version 6).
 *
 * A frame can letter the map round its inside edge -- letters across, numbers
 * down -- either by dividing the sheet into squares of its own or by following
 * the map's grid, square or hex. In grid mode the references are read from the
 * grid when the frame draws, so changing the grid has to redraw the frame.
 * This suite checks where the references land, that they are the grid's own
 * cell numbers (so widening the frame never renames a square), that each
 * change is one undo step, that a grid change carries the frame with it, that
 * an export without the paper leaves them off, and that a map with them
 * reloads pixel-identical. Then the three textures and eight coast symbols.
 *
 * Start the server first:  python3 app.py --no-browser --port 7871
 * Then:                    node test/refs.mjs [http://127.0.0.1:7871]
 */

import { launch, base, ready, newMap } from './browser.mjs';

const out = [];
let fails = 0;
function t(name, pass, note) {
  out.push([pass ? 'PASS' : 'FAIL', name, note == null ? '' : String(note)]);
  if (!pass) fails++;
}
function report() {
  for (const [status, name, note] of out) console.log(status.padEnd(5), name, note ? ' [' + note + ']' : '');
  console.log(`\n${out.length - fails}/${out.length} passed`);
}
process.on('unhandledRejection', (err) => {
  report();
  console.log('\nthrew: ' + (err && err.message));
  process.exit(1);
});

const TEXTURES = [['mosaic', 'floor'], ['shingle', 'land'], ['coral-reef', 'water']];
const STAMPS = ['rowboat', 'jetty', 'anchor', 'fishing-net', 'buoy', 'reef', 'sea-cliff', 'shipwreck'];
const LABELS = ['Rowing Boat', 'Jetty', 'Anchor', 'Fishing Net', 'Buoy', 'Reef', 'Sea Cliff', 'Shipwreck'];

const b = await launch();
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = [];
const external = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
p.on('request', (r) => {
  const u = new URL(r.url());
  if (!['127.0.0.1', 'localhost'].includes(u.hostname) && !['data:', 'blob:'].includes(u.protocol)) external.push(r.url());
});
await p.goto(base('http://127.0.0.1:7871/'), { waitUntil: 'networkidle' });
await ready(p);
await newMap(p, { name: 'References Check', kind: 'region' });

/* ---- helpers ---------------------------------------------------------------- */

const frame = () => p.evaluate(() => {
  const l = window.__cg.app.doc.layers.find((x) => x.kind === 'frame');
  return l ? Object.assign({}, l, { ops: undefined }) : null;
});
const refs = () => p.evaluate(() => {
  const doc = window.__cg.app.doc;
  const l = doc.layers.find((x) => x.kind === 'frame');
  return l ? window.__cg.R.frameRefs(l, doc) : null;
});
const band = () => p.evaluate(() => {
  const doc = window.__cg.app.doc;
  return window.__cg.R.frameBand(doc.layers.find((x) => x.kind === 'frame'), doc.width, doc.height);
});
const hashOf = (r) => p.evaluate((r) => {
  const l = window.__cg.app.doc.layers.find((x) => x.kind === 'frame');
  const c = window.__cg.R.canvasFor(l);
  const box = r ? [Math.floor(r.x), Math.floor(r.y), Math.ceil(r.w), Math.ceil(r.h)] : [0, 0, c.width, c.height];
  const d = c.getContext('2d').getImageData(...box).data;
  let h = 0; for (let i = 0; i < d.length; i += 3) h = (h * 31 + d[i]) >>> 0;
  return h;
}, r || null);
const rebuiltHash = () => p.evaluate(() => {
  const R = window.__cg.R;
  const l = window.__cg.app.doc.layers.find((x) => x.kind === 'frame');
  const c = R.canvasFor(l);
  const before = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let a = 0; for (let i = 0; i < before.length; i += 3) a = (a * 31 + before[i]) >>> 0;
  R.rebuildLayer(l);
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let h = 0; for (let i = 0; i < d.length; i += 3) h = (h * 31 + d[i]) >>> 0;
  return [a, h];
});
// Pixels near the frame's ink inside a rectangle of the frame layer.
const inkIn = (r) => p.evaluate((r) => {
  const l = window.__cg.app.doc.layers.find((x) => x.kind === 'frame');
  const ink = [1, 3, 5].map((i) => parseInt(window.__cg.R.frameValue(l, 'color').slice(i, i + 2), 16));
  const c = window.__cg.R.canvasFor(l);
  const d = c.getContext('2d').getImageData(Math.floor(r.x), Math.floor(r.y), Math.ceil(r.w), Math.ceil(r.h)).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] > 200 && Math.abs(d[i] - ink[0]) + Math.abs(d[i + 1] - ink[1]) + Math.abs(d[i + 2] - ink[2]) < 40) n++;
  }
  return n;
}, r);
const fp = () => p.evaluate(() => {
  const c = window.__cg.R.flatten({ scale: 0.5, grid: false, lights: false });
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let h = 0; for (let i = 0; i < d.length; i += 7) h = (h * 31 + d[i]) >>> 0;
  return h;
});
const strip = (x, y, w, h, opts = {}) => p.evaluate(([x, y, w, h, opts]) => {
  const c = window.__cg.R.flatten(Object.assign({ scale: 1, rect: { x, y, w, h } }, opts));
  const d = c.getContext('2d').getImageData(0, 0, w, h).data;
  let s = 0; for (let i = 0; i < d.length; i += 3) s = (s * 31 + d[i]) >>> 0;
  return s;
}, [x, y, w, h, opts]);
const undo = () => p.evaluate(async () => { const H = await import('/js/history.js'); H.undo(); });
const redo = () => p.evaluate(async () => { const H = await import('/js/history.js'); H.redo(); });
const choose = async (mode) => {
  await p.selectOption('[data-frame="refs"] select', mode);
  await p.waitForTimeout(250);
};
const addFrame = async () => {
  await p.evaluate(async () => { const ui = await import('/js/ui.js'); ui.addFrame(); });
  await p.waitForTimeout(400);
};
const toFrame = () => p.evaluate(async () => {
  const A = await import('/js/app.js');
  A.setActiveLayer(A.app.doc.layers.find((l) => l.kind === 'frame').id);
});
const setRange = async (sel, value) => {
  await p.evaluate(([sel, v]) => {
    const i = document.querySelector(sel);
    i.value = String(v); i.dispatchEvent(new Event('input')); i.dispatchEvent(new Event('change'));
  }, [sel, value]);
  await p.waitForTimeout(300);
};
// The range input in the layer panel whose label reads `label`.
const rangeLabelled = (label) => p.evaluate((label) => {
  const f = [...document.querySelectorAll('.field')].find((x) => {
    const s = x.querySelector('label span');
    return s && s.textContent === label && x.querySelector('input[type=range]');
  });
  if (!f) return null;
  f.querySelector('input[type=range]').id = 'cg-test-range';
  return '#cg-test-range';
}, label);

/* ---- the letters themselves -------------------------------------------------------- */

const letters = await p.evaluate(() => [0, 1, 25, 26, 27, 51, 52, 701, 702].map((n) => window.__cg.R.refLetters(n)));
t('columns are lettered as a spreadsheet letters them',
  letters.join(',') === 'A,B,Z,AA,AB,AZ,BA,ZZ,AAA', letters.join(','));

/* ---- a frame starts without them ---------------------------------------------------- */

const bare0 = await strip(900, 60, 200, 60, { paper: false });
await addFrame();
const plain = await hashOf();
t('a new frame has no references', (await refs()) === null && (await frame()).refs === 'none');
const modes = await p.evaluate(() => [...document.querySelectorAll('[data-frame="refs"] option')].map((o) => o.value));
t('the panel offers none, a divided sheet and the map\'s grid', modes.join(',') === 'none,sheet,grid', modes.join(','));
const legacy = await p.evaluate(() => {
  const R = window.__cg.R;
  const l = window.__cg.app.doc.layers.find((x) => x.kind === 'frame');
  delete l.refs; delete l.refCols;
  R.rebuildLayer(l);
  const c = R.canvasFor(l);
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let h = 0; for (let i = 0; i < d.length; i += 3) h = (h * 31 + d[i]) >>> 0;
  l.refs = 'none'; l.refCols = 8;
  return h;
});
t('a frame from before references draws exactly as it did', legacy === plain);

/* ---- dividing the sheet ------------------------------------------------------------ */

await choose('sheet');
const sheet = await refs();
const g = await band();
const doc = await p.evaluate(() => ({ w: window.__cg.app.doc.width, h: window.__cg.app.doc.height }));
t('dividing the sheet letters eight columns, A to H', sheet && sheet.mode === 'sheet'
  && sheet.cols.map((c) => c.label).join('') === 'ABCDEFGH', sheet && sheet.cols.map((c) => c.label).join(''));
const cw = (doc.w - 2 * g.inner) / 8;
t('the columns run from one side of the band to the other',
  Math.abs(sheet.cols[0].a - g.inner) < 1e-6 && Math.abs(sheet.cols[7].b - (doc.w - g.inner)) < 1e-6);
t('the rows are as near square as the sheet allows, numbered from 1',
  sheet.rows[0].label === '1' && sheet.rows.length === Math.round((doc.h - 2 * g.inner) / cw)
  && Math.abs((sheet.rows[0].b - sheet.rows[0].a) / cw - 1) < 0.15,
  sheet.rows.map((r) => r.label).join(','));
const topBand = { x: g.inner, y: g.inner, w: doc.w - 2 * g.inner, h: g.unit * 1.8 };
const ink = await inkIn(topBand);
t('the letters and ticks are drawn in the frame\'s ink just inside the band', ink > 150, ink);
t('it is one undo step', await (async () => {
  await undo(); await p.waitForTimeout(250);
  const off = (await frame()).refs === 'none' && (await hashOf()) === plain;
  await redo(); await p.waitForTimeout(250);
  return off && (await frame()).refs === 'sheet';
})());

const colsSel = await p.evaluate(() => !!document.querySelector('[data-frame="refCols"] input'));
t('the panel offers a column count for a divided sheet', colsSel);
await setRange('[data-frame="refCols"] input', 12);
const twelve = await refs();
t('twelve columns, A to L', twelve.cols.length === 12 && twelve.cols[11].label === 'L');
await undo(); await p.waitForTimeout(250);
t('and one undo goes back to eight', (await refs()).cols.length === 8 && (await frame()).refCols === 8);
await redo(); await p.waitForTimeout(250);

/* ---- following a grid this map does not have ----------------------------------------- */

await choose('grid');
const fallback = await refs();
t('a map with no grid falls back to dividing the sheet', fallback.mode === 'sheet' && fallback.cols.length === 12);
const note = await p.evaluate(() => (document.querySelector('[data-frame-note="refs"]') || {}).textContent || '');
t('and the panel says so', /no grid to follow/.test(note), note);

const sane = await p.evaluate(() => {
  const R = window.__cg.R;
  return [R.frameValue({ refs: 'bogus' }, 'refs'), R.frameValue({ refs: 'toString' }, 'refs'),
          R.frameValue({ refCols: 99 }, 'refCols'), R.frameValue({ refCols: 2.6 }, 'refCols'),
          R.frameValue({ refCols: 'x' }, 'refCols')];
});
t('a hand-edited reference setting is held to sense', JSON.stringify(sane) === JSON.stringify(['none', 'none', 26, 3, 8]),
  JSON.stringify(sane));

t('an export without the paper leaves the references off', (await strip(900, 60, 200, 60, { paper: false })) === bare0);

/* ---- a battle map's own squares ------------------------------------------------------ */

await newMap(p, { name: 'Squares Check', kind: 'battle', size: '40x30' });
await addFrame();
await choose('grid');
const sq = await refs();
const grid = await p.evaluate(() => {
  const l = window.__cg.app.doc.layers.find((x) => x.kind === 'grid');
  return { size: l.size, ox: l.offsetX || 0, oy: l.offsetY || 0 };
});
const gb = await band();
t('a battle map is lettered from its grid', sq.mode === 'grid', sq.mode);
t('each column is one grid square, clipped to the band',
  sq.cols.every((c) => {
    const left = grid.ox + c.i * grid.size, right = left + grid.size;
    return Math.abs(c.a - Math.max(left, gb.inner)) < 1e-6 && Math.abs(c.b - Math.min(right, 2800 - gb.inner)) < 1e-6;
  }), JSON.stringify(sq.cols.slice(0, 3)));
t('a square mostly under the frame is not lettered, but keeps its letter for the next',
  sq.cols[0].i === (gb.inner - grid.ox > grid.size / 2 ? 1 : 0) && sq.cols[0].label === (sq.cols[0].i ? 'B' : 'A'),
  JSON.stringify([sq.cols[0], gb.inner]));
t('forty columns and thirty rows, give or take the frame',
  sq.cols.length >= 38 && sq.cols.length <= 40 && sq.rows.length >= 28 && sq.rows.length <= 30,
  sq.cols.length + ' x ' + sq.rows.length);
const nameAt = (r, x) => (r.cols.find((c) => c.a <= x && x < c.b) || {}).label;
const atK = nameAt(sq, 10 * grid.size + 5);
await setRange('[data-frame="size"] input', 2.4);
const wide = await refs();
t('widening the frame renames no square', atK === 'K' && nameAt(wide, 10 * grid.size + 5) === 'K'
  && wide.cols[0].i >= sq.cols[0].i, JSON.stringify([atK, wide.cols[0].label]));
await undo(); await p.waitForTimeout(250);

// Change the grid from its own panel; the frame has to follow without being told.
await p.evaluate(async () => {
  const A = await import('/js/app.js');
  A.setActiveLayer(A.app.doc.layers.find((l) => l.kind === 'grid').id);
});
await p.waitForTimeout(300);
const cellSel = await rangeLabelled('Cell size');
const beforeRegrid = await hashOf();
await setRange(cellSel, 140);
const regrid = await refs();
t('a coarser grid, fewer references', regrid.cols.length >= 18 && regrid.cols.length <= 20 && regrid.cols.length < sq.cols.length,
  regrid.cols.length);
const [onScreen, fresh] = await rebuiltHash();
t('and the frame on screen is what a fresh draw gives', onScreen === fresh && onScreen !== beforeRegrid);
await setRange(cellSel, 70);
await toFrame();
await p.waitForTimeout(300);
const gnote = await p.evaluate(() => (document.querySelector('[data-frame-note="refs"]') || {}).textContent || '');
t('the panel says the references are the grid\'s own', /grid's own squares|its own squares/.test(gnote) && /to /.test(gnote), gnote);

// A fine grid gets every second or fifth reference rather than a smear.
const fine = await p.evaluate(() => {
  const R = window.__cg.R;
  const doc = window.__cg.app.doc;
  const grid = doc.layers.find((l) => l.kind === 'grid');
  const was = grid.size;
  grid.size = 8;
  const r = R.frameRefs(doc.layers.find((l) => l.kind === 'frame'), doc);
  grid.size = was;
  return { stride: r.stride, size: r.size };
});
t('a fine grid letters every few squares instead of every one', fine.stride > 1 && fine.size >= 6, JSON.stringify(fine));

/* ---- the reload ----------------------------------------------------------------------- */

if (process.env.CG_SHOT) await p.screenshot({ path: process.env.CG_SHOT.replace(/\.png$/, '-battle.png') });
const saved = await fp();
await p.evaluate(async () => { const a = await import('/js/app.js'); await a.saveProject({ silent: true }); });
const slug = await p.evaluate(() => window.__cg.app.slug);
await p.reload({ waitUntil: 'networkidle' });
await ready(p);
await p.waitForFunction((s) => window.__cg.app.slug === s, slug, { timeout: 10000 }).catch(() => {});
await p.waitForTimeout(800);
t('a map with references reloads pixel-identical', saved === (await fp()) && !!slug, `${saved} ${await fp()}`);

/* ---- hexes ------------------------------------------------------------------------------ */

await newMap(p, { name: 'Hex Check', kind: 'hex' });
await addFrame();
await choose('grid');
const hx = await refs();
const centres = await p.evaluate(async (cols) => {
  const H = await import('/js/hex.js');
  const grid = window.__cg.app.doc.layers.find((l) => l.kind === 'grid');
  return cols.map((c) => { const { q, r } = H.fromOffset(grid, c.i, 0); return H.toPixel(grid, q, r).x; });
}, hx.cols);
const hb = await band();
t('a hex map is lettered by its columns', hx.mode === 'grid' && hx.cols.length > 5, hx.cols.length);
t('each letter sits over its column of hexes', hx.cols.every((c, k) => {
  const unclipped = c.a > hb.inner + 1e-6 && c.b < hx.w - hb.inner - 1e-6;
  return !unclipped || Math.abs((c.a + c.b) / 2 - centres[k]) < 1e-6;
}));
t('rows numbered from 1 down the side', hx.rows.length > 4 && hx.rows.every((r) => r.label === String(r.i + 1)));
if (process.env.CG_SHOT) await p.screenshot({ path: process.env.CG_SHOT.replace(/\.png$/, '-hex.png') });

/* ---- the art ------------------------------------------------------------------------------ */

await newMap(p, { name: 'Coast Check', kind: 'battle', size: '20x15' });
const lib = await p.evaluate(async ([tex, st]) => {
  const A = await import('/js/assets.js');
  const get = (id) => A.library.byId.get(id);
  return {
    textures: tex.map(([n]) => get('starter/' + n)).map((a) => a && [a.kind, a.group, a.tileable]),
    stamps: st.map((n) => [0, 2, 3].map((v) => get('starter/' + n + (v ? '-' + v : '')))
      .map((a) => a && [a.kind, a.group])),
  };
}, [TEXTURES, STAMPS]);
t('three new textures are in the library',
  lib.textures.every((a, i) => a && a[0] === 'terrain' && a[1] === TEXTURES[i][1] && a[2] === true),
  JSON.stringify(lib.textures));
t('eight coast symbols, three variants of each',
  lib.stamps.every((v) => v.every((a) => a && a[0] === 'stamp' && a[1] === 'coast')),
  lib.stamps.map((v) => v.filter(Boolean).length).join(','));

const seams = await p.evaluate(async (tex) => {
  const A = await import('/js/assets.js');
  const res = {};
  for (const [n] of tex) {
    const img = await A.image('starter/' + n);
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    const W = c.width, H = c.height;
    const at = (i, j) => (j * W + i) * 4;
    const diff = (a, b2) => Math.abs(d[a] - d[b2]) + Math.abs(d[a + 1] - d[b2 + 1]) + Math.abs(d[a + 2] - d[b2 + 2]);
    const col = (i, k) => { let s = 0; for (let j = 0; j < H; j++) s += diff(at(i, j), at(k, j)); return s; };
    const row = (j, k) => { let s = 0; for (let i = 0; i < W; i++) s += diff(at(i, j), at(i, k)); return s; };
    let worstX = 0, worstY = 0;
    for (let i = 0; i < W - 1; i++) worstX = Math.max(worstX, col(i, i + 1));
    for (let j = 0; j < H - 1; j++) worstY = Math.max(worstY, row(j, j + 1));
    res[n] = { x: +(col(W - 1, 0) / Math.max(1, worstX)).toFixed(2),
               y: +(row(H - 1, 0) / Math.max(1, worstY)).toFixed(2), opaque: d[3] === 255 };
  }
  return res;
}, TEXTURES);
t('each texture meets its own opposite edge',
  Object.values(seams).every((s) => s.x <= 1 && s.y <= 1 && s.opaque), JSON.stringify(seams));

const M = (mx, my) => p.evaluate(([x, y]) => {
  const s = window.__cg.mapToScreen(x, y);
  const r = document.getElementById('canvas').getBoundingClientRect();
  return { x: r.left + s.x, y: r.top + s.y };
}, [mx, my]);
await p.evaluate(async () => {
  const A = await import('/js/app.js');
  A.setActiveLayer(A.app.doc.layers.find((l) => l.kind === 'objects').id);
});
await p.click('.tool[data-tool="stamp"]');
await p.waitForTimeout(200);
const spots = [[175, 175], [455, 175], [735, 175], [1015, 175], [175, 525], [455, 525], [735, 525], [1015, 525]];
for (let i = 0; i < LABELS.length; i++) {
  await p.fill('#asset-picker input[type=text]', LABELS[i].toLowerCase());
  await p.waitForTimeout(120);
  await p.click(`#asset-picker .asset[title="${LABELS[i]}"] >> nth=0`);
  await p.waitForTimeout(120);
  const s = await M(...spots[i]);
  await p.mouse.click(s.x, s.y);
  await p.waitForTimeout(160);
}
await p.fill('#asset-picker input[type=text]', '');
await p.waitForTimeout(600);
const placed = await p.evaluate(() => {
  const objs = window.__cg.app.doc.layers.find((l) => l.kind === 'objects');
  const ids = objs.ops.flatMap((o) => o.assets || (o.asset ? [o.asset] : []));
  return [...new Set(ids.map((id) => id.replace(/-\d+$/, '')))];
});
t('all eight can be placed with the Stamp tool',
  STAMPS.every((n) => placed.includes('starter/' + n)), placed.join(' '));
if (process.env.CG_SHOT) await p.screenshot({ path: process.env.CG_SHOT });

t('no request leaves 127.0.0.1', external.length === 0, external.slice(0, 3).join(' '));
t('no console errors', errs.length === 0, errs.slice(0, 3).join(' | '));

report();
await b.close();
process.exit(fails ? 1 : 0);
