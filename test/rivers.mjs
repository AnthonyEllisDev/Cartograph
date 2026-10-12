/* Rivers from a seed.
 *
 * Start the server first:  python3 app.py --no-browser --port 7871
 * Then:                    node test/rivers.mjs [http://127.0.0.1:7871]
 *
 * The promises: a river starts inland and ends on the coast, every point of it
 * but the mouth is on land, the same seed on the same land gives the same
 * rivers, two rivers draining opposite sides of a ridge do not meet head on,
 * generating again replaces the generated rivers and nothing drawn by hand,
 * the whole thing is one step in the history, and the map comes back from
 * disk exactly as it went away.
 *
 * Then the three textures and eight river symbols of art version 8.
 */

import { launch, base, ready, newMap } from './browser.mjs';

const out = [];
let fails = 0;
function t(name, pass, note) {
  out.push([pass ? 'PASS' : 'FAIL', name, note == null ? '' : String(note)]);
  if (!pass) fails++;
}

const b = await launch();
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
const external = [];
p.on('request', (r) => { if (!/^https?:\/\/127\.0\.0\.1[:/]/.test(r.url()) && !/^(data|blob):/.test(r.url())) external.push(r.url()); });

const TEXTURES = [['riverbed', 'water'], ['mudflat', 'land'], ['reed-bed', 'land']];
const STAMPS = ['waterfall', 'watermill', 'stepping-stones', 'lily-pads', 'rapids', 'ferry', 'weir', 'fish-trap'];
const LABELS = ['Waterfall', 'Watermill', 'Stepping Stones', 'Lily Pads', 'Rapids', 'Rope Ferry', 'Weir', 'Fish Trap'];
await p.goto(base('http://127.0.0.1:7871/'), { waitUntil: 'networkidle' });
await ready(p);

/* helpers ------------------------------------------------------------------ */

const fingerprint = () => p.evaluate(() => {
  const c = window.__cg.R.flatten({ scale: 1, grid: true, paper: true });
  const s = document.createElement('canvas'); s.width = 96; s.height = 72;
  const x = s.getContext('2d'); x.drawImage(c, 0, 0, 96, 72);
  return Array.from(x.getImageData(0, 0, 96, 72).data).join(',');
});

const pathOps = () => p.evaluate(() =>
  JSON.parse(JSON.stringify(window.__cg.app.doc.layers.find((l) => l.kind === 'paths').ops)));

const saveAndReload = async () => {
  await p.click('#btn-save');
  await p.waitForTimeout(2000);
  await p.reload({ waitUntil: 'networkidle' });
  await ready(p);
  await p.waitForTimeout(600);
};

const toastText = () => p.evaluate(() =>
  Array.from(document.querySelectorAll('.toast')).map((n) => n.textContent).join(' | '));

/** Set a field in the open dialog by its label. */
const setField = (label, value) => p.evaluate(([l, v]) => {
  const f = Array.from(document.querySelectorAll('.modal .field'))
    .find((n) => n.querySelector('label span') && n.querySelector('label span').textContent === l);
  const input = f.querySelector('select, input');
  input.value = v;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}, [label, value]);

const generateLand = async (seed) => {
  await p.click('.tool[data-tool="land"]');
  await p.waitForTimeout(200);
  await p.click('[data-action="generate-land"]');
  await p.waitForSelector('.modal .gen-preview');
  await p.fill('.modal input[data-gen="seed"]', seed);
  await p.click('.modal .btn-primary');
  await p.waitForTimeout(1500);
};

/** Open the rivers dialog from the Path tool, set it up and press Generate. */
const generateRivers = async ({ seed, count, branches, existing, cancel } = {}) => {
  await p.click('.tool[data-tool="path"]');
  await p.waitForTimeout(200);
  await p.click('[data-action="generate-rivers"]');
  await p.waitForSelector('.modal [data-rivers="preview"]');
  if (seed) await p.fill('.modal input[data-rivers="seed"]', seed);
  if (count != null) await setField('Rivers', count);
  if (branches != null) await setField('Tributaries', branches);
  if (existing) await setField('Rivers generated before', existing);
  await p.waitForTimeout(250);
  if (cancel) await p.click('.modal button:has-text("Cancel")');
  else await p.click('.modal .btn-primary');
  await p.waitForTimeout(800);
};

/* ========================================================================== *
 * The pure function.
 * ========================================================================== */

await newMap(p, { name: 'Rivers Test', kind: 'region' });
await generateLand('harbour');

const pure = await p.evaluate(async () => {
  const M = await import('/js/rivers.js');
  const doc = window.__cg.app.doc;
  const land = doc.layers.find((l) => l.kind === 'land');
  const g = M.landGrid(land, doc.width, doc.height);
  const t0 = performance.now();
  const a = M.traceRivers(g, { seed: 'delta', count: 5, branches: 0.6 });
  const ms = performance.now() - t0;
  const again = M.traceRivers(g, { seed: 'delta', count: 5, branches: 0.6 });
  const other = M.traceRivers(g, { seed: 'deltas', count: 5, branches: 0.6 });
  const calm = M.traceRivers(g, { seed: 'delta', count: 5, branches: 0.6, meander: 0 });
  const none = M.traceRivers(g, { seed: 'delta', count: 3, branches: 0 });
  const lots = M.traceRivers(g, { seed: 'delta', count: 3, branches: 1 });
  const wide = M.traceRivers(g, { seed: 'delta', count: 3, width: 30, color: '#112233' });

  // Every point but the mouth on land; the mouth beside the sea; the source
  // further from the sea than the mouth. Read from the mask at full size.
  const m = window.__cg.R.maskFor(land);
  const md = m.getContext('2d').getImageData(0, 0, m.width, m.height).data;
  const at = (x, y) => {
    const xi = Math.max(0, Math.min(m.width - 1, Math.round(x))), yi = Math.max(0, Math.min(m.height - 1, Math.round(y)));
    return md[(yi * m.width + xi) * 4 + 3];
  };
  const seaWithin = (q, r) => {
    for (let dy = -r; dy <= r; dy += 2) for (let dx = -r; dx <= r; dx += 2) if (at(q.x + dx, q.y + dy) < 128) return true;
    return false;
  };
  const cell = g.cell;
  let offLand = 0, mouthsOk = 0, mains = 0, sourcesInland = 0;
  for (const r of a) {
    const pts = r.points;
    for (let i = 0; i < pts.length - 1; i++) if (at(pts[i].x, pts[i].y) < 100) offLand++;
    const mouth = pts[pts.length - 1];
    if (seaWithin(mouth, Math.ceil(cell * 1.5))) {
      mains++;
      mouthsOk++;
      if (!seaWithin(pts[0], Math.ceil(cell * 3))) sourcesInland++;
    }
  }
  // Mouths of different rivers: the rivers that end on the coast are the
  // main stems. Their nearest approach to each other, in map pixels.
  const stems = none;
  let nearest = Infinity;
  for (let i = 0; i < stems.length; i++) {
    for (let j = i + 1; j < stems.length; j++) {
      for (const q of stems[i].points.slice(0, -1)) {
        for (const r of stems[j].points.slice(0, -1)) nearest = Math.min(nearest, Math.hypot(q.x - r.x, q.y - r.y));
      }
    }
  }
  return {
    ms, n: a.length, same: JSON.stringify(a) === JSON.stringify(again),
    differs: JSON.stringify(a) !== JSON.stringify(other),
    meanderDiffers: JSON.stringify(a) !== JSON.stringify(calm),
    shape: a.every((r) => r.style === 'river' && r.gen === 'rivers' && !('id' in r) && r.points.length >= 2
      && r.points.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y) && Math.round(q.x * 10) === q.x * 10)),
    offLand, mouthsOk, mains, sourcesInland,
    noneCount: none.length, lotsCount: lots.length,
    widest: Math.max(...wide.map((r) => r.width)), colours: [...new Set(wide.map((r) => r.color))].join(','),
    narrowerTribs: a.filter((r) => !seaWithin(r.points[r.points.length - 1], Math.ceil(cell * 1.5)))
      .every((r) => r.width < Math.max(...a.map((s) => s.width))),
    nearest, cell,
  };
});
t('the same seed on the same land gives the same rivers', pure.same);
t('another seed gives other rivers', pure.differs);
t('meander changes the course', pure.meanderDiffers);
t('rivers are plain river paths tagged as generated, points to a tenth of a pixel', pure.shape, pure.n + ' rivers');
t('every point of every river but its mouth is on land', pure.offLand === 0, pure.offLand + ' off land');
t('each main river ends beside the sea', pure.mains >= 3, pure.mains + ' mouths');
t('and starts inland, away from it', pure.sourcesInland === pure.mains, pure.sourcesInland + '/' + pure.mains);
t('Tributaries at nothing draws only the main rivers, no more than asked for', pure.noneCount >= 1 && pure.noneCount <= 3, pure.noneCount);
t('Tributaries at full draws more of them', pure.lotsCount > pure.noneCount, pure.noneCount + ' -> ' + pure.lotsCount);
t('the widest river is the width asked for, in the colour asked for', pure.widest === 30 && pure.colours === '#112233',
  pure.widest + ' ' + pure.colours);
t('a tributary is narrower than the river it feeds', pure.narrowerTribs);
t('two river systems keep their distance rather than meeting head on', pure.nearest > pure.cell * 4,
  Math.round(pure.nearest) + ' px apart, cell ' + pure.cell);
// A long thin island is the hard case: every river rises on the one ridge
// down its middle, from both coasts at once. Without the margin each system
// claims, rivers from opposite shores came within six cells of each other.
const band = await p.evaluate(async () => {
  const M = await import('/js/rivers.js');
  const cols = 300, rows = 120, land = new Uint8Array(cols * rows);
  for (let y = 30; y < 90; y++) for (let x = 10; x < 290; x++) land[y * cols + x] = 1;
  const g = { cols, rows, cell: 4, land };
  let worst = Infinity, n = 0;
  for (const seed of ['band', 'ridge', 'spine']) {
    const rs = M.traceRivers(g, { seed, count: 12, branches: 0 });
    n += rs.length;
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++)
      for (const q of rs[i].points) for (const r of rs[j].points) worst = Math.min(worst, Math.hypot(q.x - r.x, q.y - r.y));
  }
  return { worst, n };
});
// The margin is 4% of the long side (12 cells of 4 px); a tenth of slack
// for the smoothing.
t('on a thin island, rivers from opposite shores stop short of each other', band.n >= 12 && band.worst >= 12 * 4 * 0.8,
  Math.round(band.worst) + ' px, ' + band.n + ' rivers');
t('tracing them is quick', pure.ms < 1500, pure.ms.toFixed(0) + ' ms');

/* ========================================================================== *
 * The dialog, the document and the history.
 * ========================================================================== */

t('the Path tool offers Generate rivers', await p.evaluate(async () => {
  document.querySelector('.tool[data-tool="path"]').click();
  await new Promise((r) => setTimeout(r, 200));
  return !!document.querySelector('[data-action="generate-rivers"]');
}));

// A road drawn by hand, which no generating may touch.
const road = await p.evaluate(async () => {
  const H = await import('/js/history.js');
  const layer = window.__cg.app.doc.layers.find((l) => l.kind === 'paths');
  const item = { id: 'p-handroad', style: 'road', width: 8, color: '#c8ab74', points: [{ x: 300, y: 300 }, { x: 700, y: 420 }] };
  layer.ops.push(item);
  window.__cg.R.invalidate(layer);
  return JSON.stringify(item);
});
const blank = await fingerprint();
const beforeOps = await pathOps();
const depth0 = await p.evaluate(async () => (await import('/js/history.js')).history.past.length);

await generateRivers({ seed: 'delta', cancel: true });
t('Cancel changes nothing', JSON.stringify(await pathOps()) === JSON.stringify(beforeOps));

await generateRivers({ seed: 'delta', count: 4, branches: 0.5 });
const first = await pathOps();
const gen1 = first.filter((o) => o.gen === 'rivers');
t('Generate puts the rivers on the Paths layer', gen1.length >= 2, gen1.length + ' rivers');
t('each with an id of its own', new Set(gen1.map((o) => o.id)).size === gen1.length && gen1.every((o) => /^p/.test(o.id)));
t('the hand-drawn road is still there', first.some((o) => JSON.stringify(o) === road));
t('the dialog committed what the function gives for that seed', await p.evaluate(async (ops) => {
  const M = await import('/js/rivers.js');
  const doc = window.__cg.app.doc;
  const land = doc.layers.find((l) => l.kind === 'land');
  const want = M.traceRivers(M.landGrid(land, doc.width, doc.height), { seed: 'delta', count: 4, branches: 0.5 });
  return JSON.stringify(want.map((r) => r.points)) === JSON.stringify(ops.map((r) => r.points));
}, gen1));
const withRivers = await fingerprint();
t('the rivers are drawn', withRivers !== blank);
t('generating is one step in the history', await p.evaluate(async (d) => {
  const H = await import('/js/history.js');
  const s = H.history.past;
  return s.length === d + 1 && s[s.length - 1].label === 'Generate rivers';
}, depth0));

await p.evaluate(async () => (await import('/js/history.js')).undo());
await p.waitForTimeout(300);
t('undo takes the rivers away and leaves the road', JSON.stringify(await pathOps()) === JSON.stringify(beforeOps));
t('and the map is as it was', (await fingerprint()) === blank);
await p.evaluate(async () => (await import('/js/history.js')).redo());
await p.waitForTimeout(300);
t('redo brings the same rivers back', JSON.stringify(await pathOps()) === JSON.stringify(first));
t('drawn exactly as before', (await fingerprint()) === withRivers);

// A river picked up and duplicated is the user's own, and is kept.
const dup = await p.evaluate(async () => {
  const T = await import('/js/tools.js'); const C = await import('/js/clipboard.js');
  const layer = window.__cg.app.doc.layers.find((l) => l.kind === 'paths');
  const river = layer.ops.find((o) => o.gen === 'rivers');
  T.selectObject(layer, river);
  C.duplicateSelection();
  const copy = layer.ops[layer.ops.length - 1];
  return { id: copy.id, tagged: 'gen' in copy, river: copy.style === 'river' };
});
t('a duplicated river is not tagged as generated', dup.river && !dup.tagged);
await p.keyboard.press('Escape');

await generateRivers({ seed: 'estuary', count: 2, branches: 0 });
const second = await pathOps();
const gen2 = second.filter((o) => o.gen === 'rivers');
t('generating again replaces the rivers generated before', gen2.length >= 1 && gen2.length <= 2
  && !gen2.some((o) => gen1.some((g) => g.id === o.id)), gen1.length + ' -> ' + gen2.length);
t('and keeps the road and the duplicated river', second.some((o) => JSON.stringify(o) === road)
  && second.some((o) => o.id === dup.id));

// The dialog remembers the last settings for the session, so they are all
// set again here: the run before this one turned the tributaries off.
await generateRivers({ seed: 'delta', count: 4, branches: 0.5, existing: 'add' });
const third = await pathOps();
t('Keep them adds to the rivers already there', third.filter((o) => o.gen === 'rivers').length === gen2.length + gen1.length,
  third.filter((o) => o.gen === 'rivers').length + ' of ' + third.length + ' after ' + second.length);
t('and they are the same rivers that seed gave before', JSON.stringify(third.filter((o) => o.gen === 'rivers').slice(-gen1.length).map((o) => o.points))
  === JSON.stringify(gen1.map((o) => o.points)));

const saved = await fingerprint();
const savedOps = await pathOps();
await saveAndReload();
t('the rivers come back from disk point for point', JSON.stringify(await pathOps()) === JSON.stringify(savedOps));
t('and the map reloads pixel-identical', (await fingerprint()) === saved);

await p.keyboard.press('Control+k');
await p.waitForTimeout(300);
await p.fill('.palette-head input', 'rivers');
await p.waitForTimeout(250);
const hits = await p.$$eval('.palette-item .ptitle', (ns) => ns.map((n) => n.textContent));
t('the command palette offers Generate rivers', hits.some((h) => /Generate rivers/.test(h)), hits.join(', '));
await p.keyboard.press('Enter');
await p.waitForTimeout(400);
t('and running it opens the dialog', !!(await p.$('.modal [data-rivers="preview"]')));
await p.click('.modal button:has-text("Cancel")');
await p.waitForTimeout(200);

/* ========================================================================== *
 * Refusals.
 * ========================================================================== */

await p.evaluate(() => { window.__cg.app.doc.layers.find((l) => l.kind === 'paths').locked = true; });
await p.click('.tool[data-tool="path"]');
await p.waitForTimeout(150);
await p.click('[data-action="generate-rivers"]');
await p.waitForTimeout(300);
t('a locked Paths layer is refused with a message', !(await p.$('.modal [data-rivers="preview"]'))
  && /locked/.test(await toastText()));
await p.evaluate(() => { window.__cg.app.doc.layers.find((l) => l.kind === 'paths').locked = false; });

await newMap(p, { name: 'Rivers Empty', kind: 'region' });
await p.click('.tool[data-tool="path"]');
await p.waitForTimeout(150);
await p.click('[data-action="generate-rivers"]');
await p.waitForTimeout(300);
t('a map with no land yet says rivers need land', !(await p.$('.modal [data-rivers="preview"]'))
  && /need land/.test(await toastText()));

await newMap(p, { name: 'Rivers Battle', kind: 'battle' });
const battle = await p.evaluate(async () => {
  const M = await import('/js/rivers.js');
  await M.riversDialog();
  return { modal: !!document.querySelector('.modal [data-rivers="preview"]'),
           toast: Array.from(document.querySelectorAll('.toast')).map((n) => n.textContent).join(' | ') };
});
t('a battle map, with no Paths layer, is refused with a message rather than a throw',
  !battle.modal && /no Paths layer/.test(battle.toast), battle.toast);

/* ========================================================================== *
 * The art.
 * ========================================================================== */

await newMap(p, { name: 'River Art Check', kind: 'battle', size: '20x15' });
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
t('eight river symbols, three variants of each',
  lib.stamps.every((v) => v.every((a) => a && a[0] === 'stamp' && a[1] === 'river')),
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

/* report ------------------------------------------------------------------- */

for (const [s, n, note] of out) console.log(`${s}  ${n}${note ? '  [' + note + ']' : ''}`);
console.log(`\n${out.length - fails}/${out.length} passed`);
await b.close();
process.exit(fails ? 1 : 0);
