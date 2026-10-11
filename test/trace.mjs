/* Trace images, and the art that came the same day (art version 7).
 *
 * A trace layer holds one picture -- a sketch, a scan, a photograph -- shown
 * over the map while it is drawn and left out of everything the map is turned
 * into. The picture is a file in the map's folder, written by the save, so the
 * awkward cases are the ones where the document and the folder can disagree:
 * a layer deleted and saved (its file swept) and then undone, and a picture
 * replaced and saved and then undone. This suite checks those, that the
 * picture is on screen and in no export, that each panel change is one undo
 * step, that a large picture is cut down to size, that a map with a trace
 * reloads pixel-identical, and that a missing file is said to be missing.
 * Then the three textures and eight farm symbols.
 *
 * Start the server first:  python3 app.py --no-browser --port 7871
 * Then:                    node test/trace.mjs [http://127.0.0.1:7871]
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

const TEXTURES = [['vineyard', 'land'], ['wheat-field', 'land'], ['packed-earth', 'floor']];
const STAMPS = ['fence', 'scarecrow', 'beehive', 'trough', 'wheelbarrow', 'crop-rows', 'grain-sacks', 'millstone'];
const LABELS = ['Fence', 'Scarecrow', 'Beehives', 'Trough', 'Wheelbarrow', 'Vegetable Patch', 'Grain Sacks', 'Millstone'];

const URL0 = base('http://127.0.0.1:7871/');
const b = await launch();
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = [];
const external = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
// Twice this suite reads a picture it has taken away on purpose -- once to
// prove a save swept it, once to prove a missing one is said to be missing --
// and the browser logs each 404, sometimes long after the read. Those are
// told apart by where they were read from, not by when.
p.on('console', (m) => {
  if (m.type() !== 'error') return;
  if (/404/.test(m.text()) && /\/layers\/l-[a-z0-9]+\.png$/.test(m.location().url || '')) return;
  errs.push('console: ' + m.text() + ' ' + (m.location().url || ''));
});
p.on('request', (r) => {
  const u = new URL(r.url());
  if (!['127.0.0.1', 'localhost'].includes(u.hostname) && !['data:', 'blob:'].includes(u.protocol)) external.push(r.url());
});
await p.goto(URL0, { waitUntil: 'networkidle' });
await ready(p);
await newMap(p, { name: 'Trace Check', kind: 'region' });

/* ---- helpers ---------------------------------------------------------------- */

const traceLayer = () => p.evaluate(() => {
  const l = window.__cg.app.doc.layers.find((x) => x.kind === 'trace');
  return l ? Object.assign({}, l, { ops: undefined }) : null;
});
const undo = () => p.evaluate(async () => { const H = await import('/js/history.js'); return H.undo(); });
const redo = () => p.evaluate(async () => { const H = await import('/js/history.js'); return H.redo(); });
const past = () => p.evaluate(() => window.__cg.history.past.length);
const lastLabel = () => p.evaluate(() => {
  const h = window.__cg.history.past; return h.length ? h[h.length - 1].label : null;
});
// A fingerprint of what is on screen (the composited map) and of the export.
const screenHash = () => p.evaluate(() => {
  const f = window.__cg.R.view.flat;
  const d = f.getContext('2d').getImageData(0, 0, f.width, f.height).data;
  let h = 0; for (let i = 0; i < d.length; i += 3) h = (h * 31 + d[i]) >>> 0;
  return h;
});
const exportHash = () => p.evaluate(() => {
  const c = window.__cg.R.flatten({ scale: 0.5 });
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let h = 0; for (let i = 0; i < d.length; i += 3) h = (h * 31 + d[i]) >>> 0;
  return h;
});
const pixel = (x, y) => p.evaluate(([x, y]) => {
  const f = window.__cg.R.view.flat;
  return [...f.getContext('2d').getImageData(x, y, 1, 1).data];
}, [x, y]);
const save = () => p.evaluate(async () => { const A = await import('/js/app.js'); return A.saveProject({ silent: true }); });
const fileStatus = (slug, id) => p.evaluate(async ([s, i]) =>
  (await fetch('/projects/' + encodeURIComponent(s) + '/layers/' + encodeURIComponent(i) + '.png', { cache: 'no-store' })).status,
[slug, id]);
const setRange = async (key, value) => {
  await p.evaluate(([k, v]) => {
    const i = document.querySelector(`[data-trace="${k}"] input`);
    i.value = String(v); i.dispatchEvent(new Event('input')); i.dispatchEvent(new Event('change'));
  }, [key, value]);
  await p.waitForTimeout(150);
};
/** A picture made in the page: a field of one colour with a block of another
 *  in its top-left quarter, so where it lands can be read off the map. */
const picture = (w, h, ground, block, type = 'image/png') => p.evaluate(async ([w, h, g, k, ty]) => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  x.fillStyle = k; x.fillRect(0, 0, w / 2, h / 2);
  const blob = await new Promise((r) => c.toBlob(r, ty, 0.95));
  return [...new Uint8Array(await blob.arrayBuffer())];
}, [w, h, ground, block, type]);
const choosePicture = async (name, bytes, mime) => {
  const before = await p.evaluate(() => {
    const l = window.__cg.app.doc.layers.find((x) => x.kind === 'trace'); return l && l.image;
  });
  await p.setInputFiles('[data-trace="file"]', { name, mimeType: mime, buffer: Buffer.from(bytes) });
  await p.waitForFunction((was) => {
    const l = window.__cg.app.doc.layers.find((x) => x.kind === 'trace');
    return l && l.image && l.image !== was;
  }, before, { timeout: 15000 });
  await p.waitForTimeout(250);
};

/* ---- adding the layer ------------------------------------------------------- */

const exportBare = await exportHash();
const screenBare = await screenHash();
const pastBefore = await past();
await p.click('#btn-add-layer');
await p.waitForTimeout(250);
await p.selectOption('.modal select', 'trace');
await p.click('.modal .btn-primary');
await p.waitForTimeout(400);
let L = await traceLayer();
t('the New layer dialog adds a trace layer', !!L && L.image === null && L.opacity === 0.5, L && L.opacity);
t('it is the active layer, and its panel offers a picture',
  await p.evaluate((id) => window.__cg.app.activeLayerId === id, L && L.id)
  && await p.isVisible('[data-trace="choose"]')
  && await p.evaluate(() => !!document.querySelector('[data-trace-note="none"]')));
t('adding it is one undo step', (await past()) === pastBefore + 1 && (await lastLabel()) === 'Add trace image',
  await lastLabel());
await undo();
t('undo takes it away', !(await traceLayer()));
await redo();
t('redo puts it back', !!(await traceLayer()));
t('an empty trace layer changes nothing on screen', (await screenHash()) === screenBare);

/* ---- choosing a picture ----------------------------------------------------- */

// Wider than the map's aspect (2048 x 1536), so it is fitted to the width and
// lies across the middle with the map showing above and below.
const red = await picture(800, 400, '#2040e0', '#e02020');
let steps = await past();
await choosePicture('sketch.png', red, 'image/png');
L = await traceLayer();
t('the picture is recorded by size and name, not as pixels',
  L.image && L.image.w === 800 && L.image.h === 400 && L.image.name === 'sketch.png'
  && Object.keys(L.image).sort().join() === 'h,name,w', JSON.stringify(L.image));
t('choosing a picture is one undo step', (await past()) === steps + 1 && (await lastLabel()) === 'Trace picture',
  await lastLabel());
const rect = await p.evaluate(async () => {
  const T = await import('/js/trace.js');
  return T.traceRect(window.__cg.app.doc.layers.find((x) => x.kind === 'trace'), window.__cg.app.doc);
});
t('fitted to the map and centred', Math.abs(rect.w - 2048) < 1e-6 && Math.abs(rect.h - 1024) < 1e-6
  && Math.abs(rect.x) < 1e-6 && Math.abs(rect.y - 256) < 1e-6, JSON.stringify(rect));
// The block is the top-left quarter: centred on (512, 512) on the map.
const inBlock = await pixel(512, 512);
const inGround = await pixel(1536, 1024);
const above = await pixel(1024, 100);
if (process.env.CG_SHOT) await p.screenshot({ path: process.env.CG_SHOT.replace(/\.png$/, '-trace.png') });
t('it shows on screen, half strength over the map',
  inBlock[0] > inBlock[2] + 40 && inGround[2] > inGround[0] + 30, JSON.stringify([inBlock, inGround]));
t('and not where the picture does not reach', (await p.evaluate(async () => {
  const c = window.__cg.R.flatten({ scale: 1, rect: { x: 1024, y: 100, w: 1, h: 1 } });
  return [...c.getContext('2d').getImageData(0, 0, 1, 1).data];
})).every((v, i) => v === above[i]), JSON.stringify(above));
t('no export carries it', (await exportHash()) === exportBare);
t('unless asked for by name', await p.evaluate(() => {
  const c = window.__cg.R.flatten({ scale: 1, trace: true, rect: { x: 512, y: 512, w: 1, h: 1 } });
  const d = c.getContext('2d').getImageData(0, 0, 1, 1).data;
  return d[0] > d[2] + 40;
}));
t('the players\' copy leaves it out too', await p.evaluate(() => {
  const c = window.__cg.R.flatten({ scale: 1, players: true, rect: { x: 512, y: 512, w: 1, h: 1 } });
  const d = c.getContext('2d').getImageData(0, 0, 1, 1).data;
  const e = window.__cg.R.flatten({ scale: 1, rect: { x: 512, y: 512, w: 1, h: 1 } }).getContext('2d').getImageData(0, 0, 1, 1).data;
  return [0, 1, 2].every((i) => d[i] === e[i]);
}));
await p.evaluate(async () => {
  const A = await import('/js/app.js'); const D = await import('/js/doc.js');
  const l = A.app.doc.layers.find((x) => x.kind === 'trace');
  l.visible = false; window.__cg.R.compositeAll();
});
t('hiding the layer hides the picture', (await screenHash()) === screenBare);
await p.evaluate(() => {
  const l = window.__cg.app.doc.layers.find((x) => x.kind === 'trace');
  l.visible = true; window.__cg.R.compositeAll();
});

/* ---- size and position ------------------------------------------------------ */

steps = await past();
await setRange('zoom', 0.5);
L = await traceLayer();
const half = await p.evaluate(async () => {
  const T = await import('/js/trace.js');
  return T.traceRect(window.__cg.app.doc.layers.find((x) => x.kind === 'trace'), window.__cg.app.doc);
});
t('Size scales it about the middle of the map', L.zoom === 0.5 && Math.abs(half.w - 1024) < 1e-6
  && Math.abs(half.x - 512) < 1e-6 && Math.abs(half.y - 512) < 1e-6, JSON.stringify(half));
await setRange('offsetX', 0.25);
await setRange('offsetY', -0.1);
L = await traceLayer();
t('Across and Down move it by a share of the map', L.offsetX === 0.25 && L.offsetY === -0.1);
t('three changes, three undo steps', (await past()) === steps + 3, (await past()) - steps);
const moved = await screenHash();
await undo();
L = await traceLayer();
t('undo puts it back where it was', L.offsetY === 0 && L.offsetX === 0.25);
await redo();
t('and redo moves it again', (await screenHash()) === moved);
steps = await past();
await p.click('[data-trace="fit"]');
await p.waitForTimeout(200);
L = await traceLayer();
t('Fit to the map resets all three in one step',
  L.zoom === 1 && L.offsetX === 0 && L.offsetY === 0 && (await past()) === steps + 1);
steps = await past();
await p.click('[data-trace="fit"]');
await p.waitForTimeout(150);
t('fitting a fitted picture is no step at all', (await past()) === steps);
await setRange('zoom', 0.8);

/* ---- saving, reloading ------------------------------------------------------ */

const slug = await save();
L = await traceLayer();
t('the save writes the picture into the map\'s folder', (await fileStatus(slug, L.id)) === 200, slug);
const json = await p.evaluate(async (s) => (await (await fetch('/api/projects/' + encodeURIComponent(s))).json()).project, slug);
const saved = json.layers.find((l) => l.kind === 'trace');
t('project.json holds its size and name, not the picture',
  saved && JSON.stringify(saved).length < 600 && saved.image.w === 800, saved && JSON.stringify(saved).length);
const beforeReload = await screenHash();
await p.reload({ waitUntil: 'networkidle' });
await ready(p);
await p.waitForFunction((s) => window.__cg.app.slug === s, slug, { timeout: 15000 });
await p.waitForFunction(async () => {
  const T = await import('/js/trace.js');
  const l = window.__cg.app.doc.layers.find((x) => x.kind === 'trace');
  return l && T.traceState(l) === 'ready';
}, null, { timeout: 15000 });
await p.waitForTimeout(400);
t('reloads pixel-identical, picture and all', (await screenHash()) === beforeReload);

/* ---- the folder and the document disagreeing ------------------------------- */

// Delete the layer and save: the server sweeps its file. Undo: the layer is
// back on screen. The next save has to write the file again, or the map
// reopens without the picture the user can see.
await p.evaluate(async () => {
  const A = await import('/js/app.js');
  A.setActiveLayer(A.app.doc.layers.find((x) => x.kind === 'trace').id);
});
await p.waitForTimeout(200);
L = await traceLayer();
await p.click('#layer-props button:has-text("Delete layer")');
await p.waitForTimeout(250);
await save();
t('deleting the layer and saving sweeps its file', (await fileStatus(slug, L.id)) === 404);
await undo();
await p.waitForTimeout(200);
t('undo brings the picture back on screen', (await screenHash()) === beforeReload);
await save();
t('and the next save writes the file again', (await fileStatus(slug, L.id)) === 200);

// Replace the picture, save, undo to the first and save: the folder must
// hold the first picture again, not the second.
const green = await picture(800, 400, '#20a040', '#f0f0f0');
await p.evaluate(async () => {
  const A = await import('/js/app.js');
  A.setActiveLayer(A.app.doc.layers.find((x) => x.kind === 'trace').id);
});
await p.waitForTimeout(200);
await choosePicture('second.png', green, 'image/png');
await save();
const withGreen = await screenHash();
const onDiskNow = () => p.evaluate(async (s) => {
  const l = window.__cg.app.doc.layers.find((x) => x.kind === 'trace');
  const r = await fetch('/projects/' + encodeURIComponent(s) + '/layers/' + l.id + '.png', { cache: 'no-store' });
  const img = await createImageBitmap(await r.blob());
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  return [...x.getImageData(img.width * 3 / 4, img.height * 3 / 4, 1, 1).data];
}, slug);
const g = await onDiskNow();
t('a second picture replaces the first, on screen and in the folder',
  withGreen !== beforeReload && g[1] > g[0] + 60 && g[1] > g[2] + 60, JSON.stringify(g));
await undo();
await p.waitForTimeout(200);
t('undo shows the first picture again', (await screenHash()) === beforeReload);
await save();
await p.reload({ waitUntil: 'networkidle' });
await ready(p);
await p.waitForFunction((s) => window.__cg.app.slug === s, slug, { timeout: 15000 });
await p.waitForFunction(async () => {
  const T = await import('/js/trace.js');
  const l = window.__cg.app.doc.layers.find((x) => x.kind === 'trace');
  return l && T.traceState(l) !== 'loading';
}, null, { timeout: 15000 });
await p.waitForTimeout(400);
t('and the folder holds the picture the map shows', (await screenHash()) === beforeReload);

// A backup holds the document, not the picture. Restored, the map has no
// folder of its own yet; the picture is read from the map it came from, and
// the restored map's first save copies it into a folder of its own.
const restored = await p.evaluate(async () => {
  const { api } = await import('/js/api.js');
  const D = await import('/js/doc.js');
  const A = await import('/js/app.js');
  const kept = (await api.saveBackup(D.serialise(A.app.doc), 'trace suite')).backup;
  const T = await import('/js/tabs.js');
  await T.restoreBackup(kept);
  return { name: A.app.doc.name, slug: A.app.slug };
});
await p.waitForFunction(async () => {
  const T = await import('/js/trace.js');
  const l = window.__cg.app.doc.layers.find((x) => x.kind === 'trace');
  return l && T.traceState(l) !== 'loading';
}, null, { timeout: 15000 });
await p.waitForTimeout(300);
t('a restored backup shows the picture from the map it came from',
  /restored/.test(restored.name) && restored.slug === null && (await screenHash()) === beforeReload, restored.name);
const restoredSlug = await save();
L = await traceLayer();
t('and its first save writes the picture into its own folder',
  restoredSlug !== slug && (await fileStatus(restoredSlug, L.id)) === 200, restoredSlug);
await p.evaluate(async (s) => fetch('/api/projects/' + encodeURIComponent(s), { method: 'DELETE' }), restoredSlug);
await p.evaluate(async (s) => {
  const T = await import('/js/tabs.js');
  const A = await import('/js/app.js');
  const { api } = await import('/js/api.js');
  const doc = (await api.readProject(s)).project;
  await A.openDocument(doc, s);
}, slug);
await p.waitForFunction((s) => window.__cg.app.slug === s, slug, { timeout: 15000 });
await p.waitForTimeout(500);

/* ---- a large picture, a JPEG ------------------------------------------------ */

const big = await picture(6000, 1500, '#808080', '#202020', 'image/jpeg');
await p.evaluate(async () => {
  const A = await import('/js/app.js');
  A.setActiveLayer(A.app.doc.layers.find((x) => x.kind === 'trace').id);
});
await p.waitForTimeout(200);
await choosePicture('photo.jpg', big, 'image/jpeg');
L = await traceLayer();
t('a large picture is cut down to 4096 on its long side', L.image.w === 4096 && L.image.h === 1024,
  L.image.w + 'x' + L.image.h);
const stored = await p.evaluate(async (s) => {
  const A = await import('/js/app.js');
  await A.saveProject({ silent: true });
  const l = A.app.doc.layers.find((x) => x.kind === 'trace');
  const r = await fetch('/projects/' + encodeURIComponent(s) + '/layers/' + l.id + '.png', { cache: 'no-store' });
  const head = new Uint8Array(await r.clone().arrayBuffer()).slice(1, 4);
  const img = await createImageBitmap(await r.blob());
  return { png: String.fromCharCode(...head), w: img.width, h: img.height };
}, slug);
t('and stored as a PNG of that size', stored.png === 'PNG' && stored.w === 4096 && stored.h === 1024,
  JSON.stringify(stored));

/* ---- a missing file --------------------------------------------------------- */

const missing = await p.evaluate(async () => {
  const A = await import('/js/app.js');
  const D = await import('/js/doc.js');
  const doc = D.newDocument({ name: 'Trace Missing', kind: 'region' });
  const l = D.makeLayer('trace', { image: { w: 100, h: 50, name: 'gone.png' } });
  doc.layers.push(l);
  const r = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(doc) });
  const made = (await r.json()).project;
  A.markDirty(false);
  await A.openDocument(made, made.slug);
  A.setActiveLayer(made.layers.find((x) => x.kind === 'trace').id);
  return made.slug;
});
await p.waitForFunction(() => !!document.querySelector('[data-trace-note="missing"]'), null, { timeout: 15000 });
t('a picture whose file has gone is said to be missing, and nothing breaks',
  await p.isVisible('[data-trace="choose"]'), missing);
// The browser reports the failed read when it gets round to it, which can be
// after the check above; the 404s stay expected until this map is gone.
await p.evaluate(async (s) => fetch('/api/projects/' + encodeURIComponent(s), { method: 'DELETE' }), missing);

/* ---- the art ------------------------------------------------------------------------------ */

await newMap(p, { name: 'Farm Check', kind: 'battle', size: '20x15' });
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
t('eight farm symbols, three variants of each',
  lib.stamps.every((v) => v.every((a) => a && a[0] === 'stamp' && a[1] === 'farm')),
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
