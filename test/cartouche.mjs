/* The title cartouche on a map frame, and the art that came the same day
 * (art version 5).
 *
 * A cartouche is a plate carrying the map's title, laid out from the frame --
 * across its band at the top or bottom, or inside it at a corner -- and dressed
 * in the frame's style. With no title of its own it shows the map's name, read
 * when it draws, so renaming the map has to redraw it. This suite checks where
 * it lands, that each change is one undo step, that renaming follows through,
 * that it stays out of an export that leaves the paper off, and that a map with
 * one reloads pixel-identical. Then the three textures and eight camp symbols.
 *
 * Start the server first:  python3 app.py --no-browser --port 7871
 * Then:                    node test/cartouche.mjs [http://127.0.0.1:7871]
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

const TEXTURES = [['sandstone', 'floor'], ['straw', 'floor'], ['ice', 'land']];
const STAMPS = ['tent', 'market-stall', 'signpost', 'weapon-rack', 'bedroll', 'haystack', 'cart', 'woodpile'];
const LABELS = ['Tent', 'Market Stall', 'Signpost', 'Weapon Rack', 'Bedroll', 'Haystack', 'Cart', 'Woodpile'];

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
await newMap(p, { name: 'Cartouche Check', kind: 'region' });

/* ---- helpers ---------------------------------------------------------------- */

const frame = () => p.evaluate(() => {
  const l = window.__cg.app.doc.layers.find((x) => x.kind === 'frame');
  return l ? Object.assign({}, l, { ops: undefined }) : null;
});
const plate = () => p.evaluate(() => {
  const doc = window.__cg.app.doc;
  const l = doc.layers.find((x) => x.kind === 'frame');
  return l ? window.__cg.R.cartoucheBox(l, doc) : null;
});
const band = () => p.evaluate(() => {
  const doc = window.__cg.app.doc;
  return window.__cg.R.frameBand(doc.layers.find((x) => x.kind === 'frame'), doc.width, doc.height);
});
// A hash of the frame layer's own canvas, optionally inside one rectangle.
const frameFp = (r) => p.evaluate((r) => {
  const l = window.__cg.app.doc.layers.find((x) => x.kind === 'frame');
  const c = window.__cg.R.canvasFor(l);
  const box = r ? [Math.floor(r.x), Math.floor(r.y), Math.ceil(r.w), Math.ceil(r.h)] : [0, 0, c.width, c.height];
  const d = c.getContext('2d').getImageData(...box).data;
  let h = 0; for (let i = 0; i < d.length; i += 3) h = (h * 31 + d[i]) >>> 0;
  return h;
}, r || null);
// The same layer drawn again from nothing, for comparing with what is on screen.
const rebuiltFp = () => p.evaluate(() => {
  const R = window.__cg.R;
  const l = window.__cg.app.doc.layers.find((x) => x.kind === 'frame');
  R.rebuildLayer(l);
  const c = R.canvasFor(l);
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let h = 0; for (let i = 0; i < d.length; i += 3) h = (h * 31 + d[i]) >>> 0;
  return h;
});
// Pixels inside a rectangle of the frame layer that are close to the ink.
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
const px = (x, y, opts = {}) => p.evaluate(([x, y, opts]) => {
  const c = window.__cg.R.flatten(Object.assign({ scale: 1, rect: { x, y, w: 1, h: 1 } }, opts));
  return [...c.getContext('2d').getImageData(0, 0, 1, 1).data].slice(0, 3);
}, [x, y, opts]);
const undo = () => p.evaluate(async () => { const H = await import('/js/history.js'); H.undo(); });
const redo = () => p.evaluate(async () => { const H = await import('/js/history.js'); H.redo(); });
const setText = async (key, value) => {
  await p.evaluate(([k, v]) => {
    const i = document.querySelector(`[data-frame="${k}"] input`);
    i.value = v; i.dispatchEvent(new Event('change'));
  }, [key, value]);
  await p.waitForTimeout(250);
};
const place = async (where) => {
  await p.selectOption('[data-frame="cartouche"] select', where);
  await p.waitForTimeout(250);
};
const rename = async (name) => {
  await p.fill('#project-name', name);
  await p.evaluate(() => document.querySelector('#project-name').dispatchEvent(new Event('change')));
  await p.waitForTimeout(300);
};

/* ---- a frame starts without one ----------------------------------------------- */

const bare0 = await px(1024, 40, { paper: false });
await p.evaluate(async () => { const ui = await import('/js/ui.js'); ui.addFrame(); });
await p.waitForTimeout(400);
const noPlate = await frameFp();
t('a new frame has no cartouche', (await plate()) === null && (await frame()).cartouche === 'none');
const places = await p.evaluate(() => [...document.querySelectorAll('[data-frame="cartouche"] option')].map((o) => o.value));
t('the panel offers seven places, "none" among them',
  places.join(',') === 'none,top,bottom,top-left,top-right,bottom-left,bottom-right', places.join(','));
t('and no title fields until one is chosen',
  await p.evaluate(() => !document.querySelector('[data-frame="title"]')));

// A frame saved before cartouches existed has no such field at all.
const legacy = await p.evaluate(() => {
  const R = window.__cg.R;
  const l = window.__cg.app.doc.layers.find((x) => x.kind === 'frame');
  delete l.cartouche; delete l.title; delete l.subtitle; delete l.titleSize;
  R.rebuildLayer(l);
  const c = R.canvasFor(l);
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let h = 0; for (let i = 0; i < d.length; i += 3) h = (h * 31 + d[i]) >>> 0;
  l.cartouche = 'none';
  return h;
});
t('a frame from before cartouches draws exactly as it did', legacy === noPlate);

/* ---- across the top, showing the map's name ------------------------------------- */

await place('top');
const top = await plate();
const g = await band();
t('choosing a place puts a plate there, one undo step', (await frame()).cartouche === 'top' && !!top);
t('it shows the map\'s name', top && top.title === 'Cartouche Check', top && top.title);
t('nothing is copied into the layer', (await frame()).title === undefined);
t('it straddles the top of the band',
  top && top.y < g.inner && top.y + top.h > g.inner && top.y >= 0, JSON.stringify([top && top.y, top && top.h, g.inner]));
t('centred across the map', top && Math.abs(top.x + top.w / 2 - 1024) < 1, top && top.x);
const letters = await inkIn({ x: top.x + top.w * 0.2, y: top.y + top.h * 0.25, w: top.w * 0.6, h: top.h * 0.5 });
t('the name is lettered on it in the frame\'s ink', letters > 200, letters);
t('the panel now offers a title, a second line and lettering size', await p.evaluate(() =>
  ['title', 'subtitle', 'titleSize'].every((k) => document.querySelector(`[data-frame="${k}"]`))));
t('the title field shows the name it is following', await p.evaluate(() =>
  document.querySelector('[data-frame="title"] input').placeholder === 'Cartouche Check'));

/* ---- renaming the map ---------------------------------------------------------- */

const beforeRename = await frameFp();
await rename('The Sundered Coast');
const afterRename = await frameFp();
t('renaming the map relabels the plate', afterRename !== beforeRename && (await plate()).title === 'The Sundered Coast');
t('and what is on screen is what a fresh draw gives', afterRename === (await rebuiltFp()));
t('the placeholder follows the new name', await p.evaluate(() =>
  document.querySelector('[data-frame="title"] input').placeholder === 'The Sundered Coast'));

/* ---- a title of its own -------------------------------------------------------- */

await setText('title', 'Isles of the Heron');
t('a title of its own is stored on the frame', (await frame()).title === 'Isles of the Heron'
  && (await plate()).title === 'Isles of the Heron');
const ownTitle = await frameFp();
await rename('Something Else Entirely');
t('and renaming the map then leaves the plate alone', (await frameFp()) === ownTitle);
await undo(); await p.waitForTimeout(250);
t('one undo goes back to following the name', (await frame()).title === undefined
  && (await plate()).title === 'Something Else Entirely');
await redo(); await p.waitForTimeout(250);
t('redo puts the title back', (await plate()).title === 'Isles of the Heron' && (await frameFp()) === ownTitle);
await setText('title', '   ');
t('a blank title goes back to the name, rather than an empty plate', (await frame()).title === undefined
  && (await plate()).title === 'Something Else Entirely');
await setText('title', 'Isles of the Heron');

const oneLine = await plate();
await setText('subtitle', 'Surveyed in the year of the long winter');
const twoLines = await plate();
t('a second line makes the plate taller', twoLines.h > oneLine.h && twoLines.sub.startsWith('Surveyed'),
  `${oneLine.h} -> ${twoLines.h}`);
await undo(); await p.waitForTimeout(250);
t('and one undo takes it off', (await plate()).h === oneLine.h && (await frame()).subtitle === undefined);
await redo(); await p.waitForTimeout(250);

await p.evaluate(() => {
  const i = document.querySelector('[data-frame="titleSize"] input');
  i.value = '1.6'; i.dispatchEvent(new Event('input')); i.dispatchEvent(new Event('change'));
});
await p.waitForTimeout(250);
const bigger = await plate();
t('larger lettering, a larger plate', (await frame()).titleSize === 1.6 && bigger.size > twoLines.size
  && bigger.w > twoLines.w, `${twoLines.size} -> ${bigger.size}`);
await undo(); await p.waitForTimeout(250);
t('undo puts the lettering back', (await plate()).size === twoLines.size);

/* ---- every place, every style, a long title --------------------------------------- */

const doc = await p.evaluate(() => ({ w: window.__cg.app.doc.width, h: window.__cg.app.doc.height }));
const where = {};
for (const pl of ['bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right']) {
  await place(pl);
  where[pl] = await plate();
}
const b2 = await band();
t('bottom straddles the bottom of the band', where.bottom.y < doc.h - b2.inner
  && where.bottom.y + where.bottom.h > doc.h - b2.inner && where.bottom.y + where.bottom.h <= doc.h);
t('the corners sit inside the band, in their own corners',
  ['top-left', 'top-right', 'bottom-left', 'bottom-right'].every((k) => {
    const r = where[k];
    const inside = r.x >= b2.inner && r.y >= b2.inner && r.x + r.w <= doc.w - b2.inner && r.y + r.h <= doc.h - b2.inner;
    const left = r.x + r.w / 2 < doc.w / 2, high = r.y + r.h / 2 < doc.h / 2;
    return inside && left === k.endsWith('left') && high === k.startsWith('top');
  }), JSON.stringify(where));
await undo(); await p.waitForTimeout(250);
t('each change of place is one undo step', (await frame()).cartouche === 'bottom-left');

await place('top');
const styles = await p.evaluate(() => [...document.querySelectorAll('[data-frame="style"] option')].map((o) => o.value));
const dressed = {};
for (const s of styles) {
  await p.selectOption('[data-frame="style"] select', s);
  await p.waitForTimeout(250);
  const r = await plate();
  dressed[s] = await frameFp({ x: r.x, y: r.y, w: r.w, h: r.h });
}
t('each frame style dresses the plate its own way', new Set(Object.values(dressed)).size === styles.length,
  JSON.stringify(dressed));

await setText('title', 'The Very Long and Exceedingly Thorough Name of a Map Nobody Will Ever Read Aloud');
const long = await plate();
const b3 = await band();
t('a long title is shrunk to fit across the map', long.x >= b3.inner && long.x + long.w <= doc.w - b3.inner
  && long.size < twoLines.size, JSON.stringify([long.x, long.w, long.size]));
await place('top-right');
const longCorner = await plate();
t('and to under half the map in a corner', longCorner.w < (doc.w - 2 * b3.inner) * 0.45, longCorner.w);
await place('top');

const sane = await p.evaluate(() => {
  const R = window.__cg.R;
  const l = { kind: 'frame', cartouche: 'middle', title: 42, subtitle: 'x'.repeat(500), titleSize: 99 };
  return [R.frameValue(l, 'cartouche'), R.frameValue(l, 'title'), R.frameValue(l, 'subtitle').length,
          R.frameValue(l, 'titleSize'), R.frameValue({ cartouche: 'toString' }, 'cartouche')];
});
t('a hand-edited cartouche is held to sense',
  JSON.stringify(sane) === JSON.stringify(['none', '', 80, 2, 'none']), JSON.stringify(sane));

/* ---- export and reload ---------------------------------------------------------- */

t('an export without the paper leaves the plate off too', JSON.stringify(await px(1024, 40, { paper: false }))
  === JSON.stringify(bare0), JSON.stringify(await px(1024, 40, { paper: false })));
if (process.env.CG_SHOT) await p.screenshot({ path: process.env.CG_SHOT.replace(/\.png$/, '-plate.png') });

const saved = await fp();
await p.evaluate(async () => { const a = await import('/js/app.js'); await a.saveProject({ silent: true }); });
const slug = await p.evaluate(() => window.__cg.app.slug);
await p.reload({ waitUntil: 'networkidle' });
await ready(p);
await p.waitForFunction((s) => window.__cg.app.slug === s, slug, { timeout: 10000 }).catch(() => {});
await p.waitForTimeout(800);
t('a map with a cartouche reloads pixel-identical', saved === (await fp()) && !!slug, `${saved} ${await fp()}`);

/* ---- the art ------------------------------------------------------------------- */

await newMap(p, { name: 'Camp Check', kind: 'battle', size: '20x15' });
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
t('eight camp symbols, three variants of each',
  lib.stamps.every((v) => v.every((a) => a && a[0] === 'stamp' && a[1] === 'camp')),
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
