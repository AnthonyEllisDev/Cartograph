/* Map frames, and the art that came the same day (art version 4).
 *
 * A frame is a layer of its own, drawn over the map and under the note pins:
 * five styles, a width, a margin that can be filled, and two colours. This
 * suite checks that it lands where it says, that every change to it is one
 * undo step, that it stays out of an export that leaves the paper off, and
 * that a framed map reloads pixel-identical. Then the three floors and eight
 * fittings added to the starter pack.
 *
 * Start the server first:  python3 app.py --no-browser --port 7871
 * Then:                    node test/frames.mjs [http://127.0.0.1:7871]
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

const TEXTURES = [['brick', 'floor'], ['carpet', 'floor'], ['marble', 'floor']];
const STAMPS = ['door', 'portcullis', 'trapdoor', 'sconce', 'statue', 'anvil', 'cauldron', 'chair'];
const LABELS = ['Door', 'Portcullis', 'Trapdoor', 'Wall Torch', 'Statue', 'Anvil', 'Cauldron', 'Chair'];

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
await newMap(p, { name: 'Frame Check', kind: 'region' });

/* ---- helpers ---------------------------------------------------------------- */

const frame = () => p.evaluate(() => {
  const l = window.__cg.app.doc.layers.find((x) => x.kind === 'frame');
  return l ? Object.assign({}, l, { ops: undefined }) : null;
});
// One pixel of the flattened map, at full size.
const px = (x, y, opts = {}) => p.evaluate(([x, y, opts]) => {
  const c = window.__cg.R.flatten(Object.assign({ scale: 1, rect: { x, y, w: 1, h: 1 } }, opts));
  return [...c.getContext('2d').getImageData(0, 0, 1, 1).data].slice(0, 3);
}, [x, y, opts]);
const band = () => p.evaluate(() => {
  const doc = window.__cg.app.doc;
  return window.__cg.R.frameBand(doc.layers.find((x) => x.kind === 'frame'), doc.width, doc.height);
});
// A hash of the frame layer's own canvas.
const frameFp = () => p.evaluate(() => {
  const R = window.__cg.R;
  const l = window.__cg.app.doc.layers.find((x) => x.kind === 'frame');
  const c = R.canvasFor(l);
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let h = 0; for (let i = 0; i < d.length; i += 5) h = (h * 31 + d[i]) >>> 0;
  return h;
});
const fp = () => p.evaluate(() => {
  const c = window.__cg.R.flatten({ scale: 0.5, grid: false, lights: false });
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let h = 0; for (let i = 0; i < d.length; i += 7) h = (h * 31 + d[i]) >>> 0;
  return h;
});
const near = (a, b2, tol = 6) => a.every((v, i) => Math.abs(v - b2[i]) <= tol);
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const undo = () => p.evaluate(async () => { const H = await import('/js/history.js'); H.undo(); });
const redo = () => p.evaluate(async () => { const H = await import('/js/history.js'); H.redo(); });

/* ---- adding one --------------------------------------------------------------- */

t('a new map has no frame', (await frame()) === null);
const corner0 = await px(4, 4);
const bare0 = await px(4, 4, { paper: false });
const middle0 = await px(1024, 768);

// Through the "+" in the Layers panel, as a person would.
await p.click('#btn-add-layer').catch(() => {});
await p.waitForTimeout(250);
const offered = await p.evaluate(() => [...document.querySelectorAll('.modal option')].some((o) => o.value === 'frame'));
t('the new-layer dialog offers a frame', offered);
if (offered) {
  await p.selectOption('.modal select', 'frame');
  await p.click('.modal .btn-primary');
} else {
  await p.keyboard.press('Escape');
  await p.evaluate(async () => { const ui = await import('/js/ui.js'); ui.addFrame(); });
}
await p.waitForTimeout(400);
const f1 = await frame();
const order = await p.evaluate(() => window.__cg.app.doc.layers.map((l) => l.kind));
t('it adds one frame layer, on top', f1 && order[order.length - 1] === 'frame', order.join(','));
t('and selects it', await p.evaluate(() => window.__cg.app.activeLayerId
  === window.__cg.app.doc.layers.find((l) => l.kind === 'frame').id));
await p.evaluate(async () => { const ui = await import('/js/ui.js'); ui.addFrame(); });
await p.waitForTimeout(200);
t('asking again does not add a second',
  await p.evaluate(() => window.__cg.app.doc.layers.filter((l) => l.kind === 'frame').length) === 1);

const g = await band();
const accent = hexRgb(f1.accent);
t('the margin outside the band is filled with the ground colour',
  near(await px(Math.floor(g.outer / 2), Math.floor(g.outer / 2)), accent), JSON.stringify(await px(4, 4)));
t('the middle of the map is untouched', near(await px(1024, 768), middle0, 0), JSON.stringify(middle0));
const inBand = await px(1024, Math.floor(g.outer + g.band * 0.25));
t('something is drawn in the band', !near(inBand, middle0, 10), JSON.stringify(inBand));
t('the frame draws nothing inside its band', await p.evaluate((y) => {
  const l = window.__cg.app.doc.layers.find((x) => x.kind === 'frame');
  const d = window.__cg.R.canvasFor(l).getContext('2d').getImageData(200, y, 1600, 1).data;
  for (let i = 3; i < d.length; i += 4) if (d[i]) return false;
  return true;
}, Math.ceil(g.inner) + 3));
t('no Clear button for a frame, but it can be deleted', await p.evaluate(() => {
  const btns = [...document.querySelectorAll('#layer-props .btn')].map((b) => b.textContent);
  return !btns.includes('Clear') && btns.includes('Delete layer');
}));

/* ---- the panel and undo --------------------------------------------------------- */

const styles = await p.evaluate(() => [...document.querySelectorAll('[data-frame="style"] option')].map((o) => o.value));
t('five styles in the panel', styles.join(',') === 'rule,atlas,ornate,rope,stone', styles.join(','));
const prints = {};
for (const s of styles) {
  await p.selectOption('[data-frame="style"] select', s);
  await p.waitForTimeout(250);
  prints[s] = await frameFp();
}
t('every style draws something different', new Set(Object.values(prints)).size === styles.length,
  JSON.stringify(prints));
t('the style is written to the layer', (await frame()).style === 'stone');
await undo(); await p.waitForTimeout(200);
t('one undo takes back one style change', (await frame()).style === 'rope', (await frame()).style);
t('and the frame is redrawn to match', (await frameFp()) === prints.rope);
await redo(); await p.waitForTimeout(200);
t('redo puts it back', (await frame()).style === 'stone' && (await frameFp()) === prints.stone);

// Width: the band's inner edge moves in.
const before = (await band()).inner;
await p.evaluate(() => {
  const i = document.querySelector('[data-frame="size"] input');
  i.value = '2'; i.dispatchEvent(new Event('input')); i.dispatchEvent(new Event('change'));
});
await p.waitForTimeout(250);
const after = (await band()).inner;
t('a wider frame reaches further in', (await frame()).size === 2 && after > before + 10, `${before} -> ${after}`);
await undo(); await p.waitForTimeout(200);
t('and undo narrows it again', (await band()).inner === before);

// The margin left open shows the map through it.
await p.click('[data-frame="mat"] input');
await p.waitForTimeout(250);
t('with the margin open, the corner is the map again',
  (await frame()).mat === false && near(await px(4, 4), corner0, 2), JSON.stringify(await px(4, 4)));
await undo(); await p.waitForTimeout(200);
t('undo fills it again', near(await px(4, 4), accent));

// Colours, through the inputs.
await p.evaluate(() => {
  const i = document.querySelector('[data-frame="accent"] input');
  i.value = '#204060'; i.dispatchEvent(new Event('change'));
});
await p.waitForTimeout(250);
t('the ground colour changes the margin', near(await px(4, 4), [0x20, 0x40, 0x60]), JSON.stringify(await px(4, 4)));
await undo(); await p.waitForTimeout(200);
t('a colour change is one undo step', (await frame()).accent === f1.accent);

/* ---- export, a bad file, the palette ------------------------------------------- */

t('an export without the paper leaves the frame off', near(await px(4, 4, { paper: false }), bare0, 0),
  JSON.stringify(await px(4, 4, { paper: false })));

const clamped = await p.evaluate(() => {
  const R = window.__cg.R;
  const l = { kind: 'frame', style: 'bogus', size: 99, margin: -3, color: 'red', accent: 12 };
  return [R.frameValue(l, 'style'), R.frameValue(l, 'size'), R.frameValue(l, 'margin'),
          R.frameValue(l, 'color'), R.frameValue(l, 'accent'), R.frameValue({}, 'mat')];
});
t('a hand-edited frame is held to sense',
  JSON.stringify(clamped) === JSON.stringify(['atlas', 3, 0, '#3a2c1e', '#efe3c6', true]), JSON.stringify(clamped));

await p.keyboard.press('Control+k');
await p.waitForTimeout(250);
await p.keyboard.type('frame');
await p.waitForTimeout(250);
const inPalette = await p.evaluate(() => document.body.innerText.includes('Add a frame round the map'));
await p.keyboard.press('Escape');
t('the command palette can add one', inPalette);

/* ---- reload, and undoing the frame itself ------------------------------------------ */

const saved = await fp();
await p.evaluate(async () => { const a = await import('/js/app.js'); await a.saveProject({ silent: true }); });
const slug = await p.evaluate(() => window.__cg.app.slug);
await p.reload({ waitUntil: 'networkidle' });
await ready(p);
await p.waitForFunction((s) => window.__cg.app.slug === s, slug, { timeout: 10000 }).catch(() => {});
await p.waitForTimeout(800);
t('a framed map reloads pixel-identical', saved === (await fp()) && !!slug, `${saved} ${await fp()}`);

await newMap(p, { name: 'Frame Undo', kind: 'battle', size: '20x15' });
await p.evaluate(async () => { const ui = await import('/js/ui.js'); ui.addFrame(); });
await p.waitForTimeout(300);
const withFrame = await fp();
await undo(); await p.waitForTimeout(300);
t('undo takes the frame away', (await frame()) === null);
await redo(); await p.waitForTimeout(300);
t('redo brings it back, drawn the same', (await frame()) !== null && (await fp()) === withFrame);
if (process.env.CG_SHOT) await p.screenshot({ path: process.env.CG_SHOT.replace(/\.png$/, '-frame.png') });

/* ---- the art ------------------------------------------------------------------- */

const lib = await p.evaluate(async ([tex, st]) => {
  const A = await import('/js/assets.js');
  const get = (id) => A.library.byId.get(id);
  return {
    textures: tex.map(([n]) => get('starter/' + n)).map((a) => a && [a.kind, a.group, a.tileable]),
    stamps: st.map((n) => [0, 2, 3].map((v) => get('starter/' + n + (v ? '-' + v : '')))
      .map((a) => a && [a.kind, a.group])),
  };
}, [TEXTURES, STAMPS]);
t('three new floors are in the library',
  lib.textures.every((a, i) => a && a[0] === 'terrain' && a[1] === TEXTURES[i][1] && a[2] === true),
  JSON.stringify(lib.textures));
t('eight fittings, three variants of each',
  lib.stamps.every((v) => v.every((a) => a && a[0] === 'stamp' && a[1] === 'fittings')),
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
t('each floor meets its own opposite edge',
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
const spots = [[160, 140], [420, 160], [700, 160], [980, 160], [1200, 220], [160, 480], [420, 520], [700, 520]];
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
