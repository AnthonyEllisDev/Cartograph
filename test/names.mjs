/* Names for the map, and the town art.
 *
 * Start the server first:  python3 app.py --no-browser --port 7871
 * Then:                    node test/names.mjs [http://127.0.0.1:7871]
 *
 * The promises: the same seed, style and kind always give the same names;
 * every style can name every kind of feature; nothing on the filter's list
 * gets through; a name already on the map is not offered again; the chooser
 * sits in the Label and Region dialogs and fills the box without placing
 * anything; the Selected panel renames a label or a region as one step in the
 * history; a name picked from the palette with nothing held waits for the next
 * label; and a renamed map reopens exactly as it was saved.
 *
 * Then the three roof textures and eight town symbols of art version 9.
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

const TEXTURES = ['thatch', 'slate-roof', 'pantiles'];
const STAMPS = ['fountain', 'shrine', 'gallows', 'banner', 'chicken-coop', 'stocks', 'notice-board', 'street-lamp'];
const LABELS = ['Fountain', 'Wayside Shrine', 'Gallows', 'Banner', 'Chicken Coop', 'Stocks', 'Notice Board', 'Street Lamp'];

await p.goto(base('http://127.0.0.1:7871/'), { waitUntil: 'networkidle' });
await ready(p);
await newMap(p, { name: 'Names Check', kind: 'region' });

/* helpers ------------------------------------------------------------------ */

const M = (mx, my) => p.evaluate(([x, y]) => {
  const s = window.__cg.mapToScreen(x, y);
  const r = document.getElementById('canvas').getBoundingClientRect();
  return { x: r.left + s.x, y: r.top + s.y };
}, [mx, my]);
const clickMap = async (x, y) => { const s = await M(x, y); await p.mouse.click(s.x, s.y); };
const ops = (kind) => p.evaluate((k) =>
  JSON.parse(JSON.stringify(window.__cg.app.doc.layers.find((l) => l.kind === k).ops)), kind);
const steps = () => p.evaluate(() => window.__cg.history.past.length);
const lastStep = () => p.evaluate(() => {
  const h = window.__cg.history.past;
  return h.length ? h[h.length - 1].label : '';
});
const chips = () => p.$$eval('.modal [data-names="chips"] .name-chip', (ns) => ns.map((n) => n.textContent));
const chooserState = () => p.evaluate(() => {
  const c = document.querySelector('.modal [data-names="chips"]');
  return c && { seed: c.dataset.seed, style: c.dataset.style, kind: c.dataset.kind };
});
const modalUp = () => p.evaluate(() => !document.getElementById('modal-root').hidden);
const fingerprint = () => p.evaluate(() => {
  const c = window.__cg.R.flatten({ scale: 1, grid: true, paper: true });
  const s = document.createElement('canvas'); s.width = 96; s.height = 72;
  const x = s.getContext('2d'); x.drawImage(c, 0, 0, 96, 72);
  return Array.from(x.getImageData(0, 0, 96, 72).data).join(',');
});


/* ========================================================================== *
 * The generator, on its own.
 * ========================================================================== */

const pure = await p.evaluate(async () => {
  const N = await import('/js/names.js');
  const styles = Object.keys(N.NAME_STYLES);
  const kinds = Object.keys(N.NAME_KINDS);
  const a = N.suggestNames({ seed: 'harbour', style: 'common', kind: 'settlement', count: 12 });
  const a2 = N.suggestNames({ seed: 'harbour', style: 'common', kind: 'settlement', count: 12 });
  const other = N.suggestNames({ seed: 'harbour2', style: 'common', kind: 'settlement', count: 12 });
  const avoid = N.suggestNames({ seed: 'harbour', style: 'common', kind: 'settlement', count: 12, avoid: [a[0].toUpperCase()] });
  const grid = {};
  let all = [];
  for (const s of styles) for (const k of kinds) {
    const list = N.suggestNames({ seed: 'grid', style: s, kind: k, count: 24 });
    grid[s + '/' + k] = list.length;
    all = all.concat(list.map((n) => ({ n, s, k })));
  }
  // A big sweep for the filter and the seams.
  const sweep = [];
  for (let i = 0; i < 6; i++) for (const s of styles) for (const k of kinds) {
    sweep.push(...N.suggestNames({ seed: 'sweep' + i, style: s, kind: k, count: 24 }));
  }
  return {
    styles, kinds, a, a2, other, avoid,
    grid, all, sweep,
    joins: [N.join('Ama', 'a'), N.join('Lae', 'ie'), N.join('Grim', ''), N.join('Thor', 'heim')],
    kindFor: ['title', 'region', 'settlement', 'water', 'nonsense'].map(N.kindForLabelStyle),
    clamp: N.suggestNames({ seed: 'x', count: 500 }).length,
  };
});
t('six styles and a mixed one', pure.styles.length === 7 && pure.styles.includes('mixed'), pure.styles.join(','));
t('seven kinds of feature', pure.kinds.length === 7, pure.kinds.join(','));
t('the same seed gives the same names', JSON.stringify(pure.a) === JSON.stringify(pure.a2), pure.a.slice(0, 4).join(', '));
t('another seed gives others', pure.other.filter((n) => pure.a.includes(n)).length < 4, pure.other.slice(0, 4).join(', '));
t('twelve different names asked for, twelve given', pure.a.length === 12 && new Set(pure.a).size === 12);
t('a name to avoid is avoided, whatever its case', !pure.avoid.includes(pure.a[0]) && pure.avoid.length === 12, pure.a[0]);
t('every style names every kind', Object.values(pure.grid).every((n) => n === 24),
  Object.entries(pure.grid).filter(([, n]) => n !== 24).map(([k, n]) => k + '=' + n).join(' '));
t('the count is capped', pure.clamp === 48, pure.clamp);
const islands = pure.all.filter((x) => x.k === 'island');
t('an island is called an island', islands.every((x) => /Isle|Island|oy$|holm$/.test(x.n)),
  islands.filter((x) => !/Isle|Island|oy$|holm$/.test(x.n)).map((x) => x.n).slice(0, 4).join(', '));
const mountains = pure.all.filter((x) => x.k === 'mountains');
const HIGH = /Mount|Mountains|Peaks|Range|Hills|Fells|Tor$|Edge$|Spines|fjell$|Anvils|Deeps|Halls|Scarps|Mons|Alps/;
t('mountains are called mountains', mountains.every((x) => HIGH.test(x.n)),
  mountains.filter((x) => !HIGH.test(x.n)).map((x) => x.n).slice(0, 4).join(', '));
const BLOCK = ['nig', 'fag', 'cunt', 'shit', 'rape', 'fuck', 'slut', 'twat', 'cock', 'dick', 'piss', 'arse', 'nazi', 'wank', 'sex'];
t('nothing on the filter list gets through, in ' + pure.sweep.length + ' names',
  pure.sweep.every((n) => !BLOCK.some((x) => n.toLowerCase().includes(x))),
  pure.sweep.filter((n) => BLOCK.some((x) => n.toLowerCase().includes(x))).slice(0, 3).join(', '));
t('every name is plain printable text that starts with a capital or "the"',
  pure.sweep.every((n) => /^[\x20-\x7e]+$/.test(n) && /^(the |[A-Z])/.test(n) && n.length <= 40),
  pure.sweep.filter((n) => !(/^[\x20-\x7e]+$/.test(n) && /^(the |[A-Z])/.test(n))).slice(0, 3).join(', '));
t('no three vowels or three of a letter running, anywhere',
  pure.sweep.every((n) => !/[aeiouy]{3}/i.test(n) && !/(.)\1\1/i.test(n)),
  pure.sweep.filter((n) => /[aeiouy]{3}/i.test(n) || /(.)\1\1/i.test(n)).slice(0, 4).join(', '));
t('a seam drops a letter rather than doubling it',
  JSON.stringify(pure.joins) === JSON.stringify(['Ama', 'Lae', 'Grim', 'Thorheim']), pure.joins.join(','));
t('a label’s style picks the kind it is asked to name',
  JSON.stringify(pure.kindFor) === JSON.stringify(['region', 'region', 'settlement', 'sea', 'settlement']), pure.kindFor.join(','));


/* ========================================================================== *
 * In the Label dialog.
 * ========================================================================== */

await p.click('.tool[data-tool="label"]');
await p.waitForTimeout(200);
const before = await steps();
await clickMap(600, 500);
await p.waitForSelector('.modal [data-names="chips"] .name-chip');
const first = await chips();
const st = await chooserState();
const expect = await p.evaluate(async (s) => {
  const N = await import('/js/names.js');
  return N.suggestNames({ seed: s.seed, style: s.style, kind: s.kind, count: 12, avoid: N.namesOnMap() });
}, st);
t('the Label dialog offers twelve names', first.length === 12, first.slice(0, 3).join(', '));
t('and they are the generator’s for the seed it shows', JSON.stringify(first) === JSON.stringify(expect), st && st.seed);
t('a settlement label asks for a settlement', st && st.kind === 'settlement', st && st.kind);
await p.click('.modal [data-names="more"]');
await p.waitForTimeout(120);
const more = await chips();
t('More gives twelve others', more.length === 12 && more.filter((n) => first.includes(n)).length === 0,
  more.slice(0, 3).join(', '));
await p.click('.modal .name-chip >> nth=2');
await p.waitForTimeout(120);
const typed = await p.inputValue('.modal input[type=text]');
t('a chip fills the box and leaves the dialog up', typed === more[2] && await modalUp(), typed);
t('and places nothing yet', (await ops('labels')).length === 0 && await steps() === before);
await p.click('.modal .btn-primary');
await p.waitForTimeout(300);
const placed = await ops('labels');
t('Place puts the label down with that name', placed.length === 1 && placed[0].text === more[2], placed[0] && placed[0].text);
t('as one step in the history', await steps() === before + 1 && await lastStep() === 'Label', await lastStep());

// The kind follows the style the label will be lettered in.
await p.evaluate(async () => { const A = await import('/js/app.js'); A.setToolSetting('label', 'style', 'water'); });
await clickMap(900, 300);
await p.waitForSelector('.modal [data-names="chips"] .name-chip');
const waterKind = await chooserState();
t('a water label asks for a sea, a lake or a bay', waterKind.kind === 'sea', waterKind.kind);
await p.selectOption('.modal [data-names="style"]', 'northern');
await p.waitForTimeout(120);
const northern = await chooserState();
t('changing the style redraws the names in it', northern.style === 'northern', northern.style);
await p.keyboard.press('Escape');
await p.waitForTimeout(200);
t('Escape places nothing', (await ops('labels')).length === 1 && !(await modalUp()));
await p.evaluate(async () => { const A = await import('/js/app.js'); A.setToolSetting('label', 'style', 'settlement'); });
await clickMap(900, 300);
await p.waitForSelector('.modal [data-names="chips"] .name-chip');
const remembered = await chooserState();
t('the style is remembered from one dialog to the next', remembered.style === 'northern', remembered.style);
const offered = await chips();
t('a name already on the map is not offered again', !offered.includes(more[2]));
await p.keyboard.press('Escape');
await p.waitForTimeout(200);


/* ========================================================================== *
 * In the Region dialog.
 * ========================================================================== */

await p.evaluate(async () => {
  const A = await import('/js/app.js');
  const D = await import('/js/doc.js');
  if (!A.app.doc.layers.some((l) => l.kind === 'regions')) {
    A.app.doc.layers.push(D.makeLayer('regions'));
    A.emit('layers');
  }
});
await p.click('.tool[data-tool="region"]');
await p.waitForTimeout(200);
for (const [x, y] of [[300, 300], [700, 320], [520, 700]]) { await clickMap(x, y); await p.waitForTimeout(60); }
await p.keyboard.press('Enter');
await p.waitForSelector('.modal [data-names="chips"] .name-chip');
const regionKind = await chooserState();
t('the Region dialog asks for a region', regionKind.kind === 'region', regionKind.kind);
const regionChips = await chips();
await p.click('.modal .name-chip >> nth=0');
await p.click('.modal .btn-primary');
await p.waitForTimeout(300);
const regions = await ops('regions');
t('and the region takes the name chosen', regions.length === 1 && regions[0].name === regionChips[0], regions[0] && regions[0].name);


/* ========================================================================== *
 * Renaming from the Selected panel.
 * ========================================================================== */

await p.evaluate(async () => {
  const T = await import('/js/tools.js');
  const layer = window.__cg.app.doc.layers.find((l) => l.kind === 'labels');
  T.selectObject(layer, layer.ops[0]);
});
await p.waitForTimeout(250);
t('a label held offers Suggest a name', await p.isVisible('[data-action="suggest-name"]'));
const oldText = (await ops('labels'))[0].text;
const s0 = await steps();
await p.click('[data-action="suggest-name"]');
await p.waitForSelector('.modal [data-names="chips"] .name-chip');
await p.keyboard.press('Escape');
await p.waitForTimeout(200);
t('closing it without a name changes nothing', (await ops('labels'))[0].text === oldText && await steps() === s0);
await p.click('[data-action="suggest-name"]');
await p.waitForSelector('.modal [data-names="chips"] .name-chip');
const renameTo = (await chips())[4];
await p.click('.modal .name-chip >> nth=4');
await p.waitForTimeout(300);
t('a chip renames the label and closes the dialog',
  (await ops('labels'))[0].text === renameTo && !(await modalUp()), renameTo);
t('as one step in the history', await steps() === s0 + 1 && await lastStep() === 'Edit label', await lastStep());
t('and the panel shows the new name',
  await p.evaluate(() => Array.from(document.querySelectorAll('#selection-props input[type=text]')).map((i) => i.value).join('|')) === renameTo);
await p.evaluate(() => window.__cg.history && document.getElementById('btn-undo').click());
await p.waitForTimeout(250);
t('undo gives the old name back', (await ops('labels'))[0].text === oldText);
await p.evaluate(() => document.getElementById('btn-redo').click());
await p.waitForTimeout(250);
t('and redo the new one', (await ops('labels'))[0].text === renameTo);

await p.evaluate(async () => {
  const T = await import('/js/tools.js');
  const layer = window.__cg.app.doc.layers.find((l) => l.kind === 'regions');
  T.selectObject(layer, layer.ops[0]);
});
await p.waitForTimeout(250);
await p.click('[data-action="suggest-name"]');
await p.waitForSelector('.modal [data-names="chips"] .name-chip');
const regionAgain = await chooserState();
const regionTo = (await chips())[1];
await p.click('.modal .name-chip >> nth=1');
await p.waitForTimeout(300);
t('a region held is renamed as a region', regionAgain.kind === 'region' && (await ops('regions'))[0].name === regionTo,
  regionAgain.kind + ' ' + regionTo);


/* ========================================================================== *
 * From the palette, with nothing held.
 * ========================================================================== */

await p.keyboard.press('Escape');
await p.click('.tool[data-tool="brush"]');
await p.waitForTimeout(200);
await p.keyboard.press('Control+k');
await p.waitForTimeout(300);
await p.fill('.palette-head input', 'suggest a name');
await p.waitForTimeout(250);
const hit = await p.$$eval('.palette-item .ptitle', (ns) => ns.map((n) => n.textContent));
t('the palette has Suggest a name', hit.some((h) => /Suggest a name/.test(h)), hit.join(' | '));
await p.keyboard.press('Enter');
await p.waitForSelector('.modal [data-names="chips"] .name-chip');
const pend = (await chips())[0];
await p.click('.modal .name-chip >> nth=0');
await p.waitForTimeout(300);
t('picking one with nothing held picks up the Label tool',
  await p.evaluate(() => window.__cg.app.tool) === 'label', await p.evaluate(() => window.__cg.app.tool));
await clickMap(1200, 900);
await p.waitForSelector('.modal input[type=text]');
t('and the next label opens with that name in the box', await p.inputValue('.modal input[type=text]') === pend, pend);
await p.click('.modal .btn-primary');
await p.waitForTimeout(300);
await clickMap(1400, 200);
await p.waitForSelector('.modal input[type=text]');
t('once: the label after it starts empty', await p.inputValue('.modal input[type=text]') === '');
await p.keyboard.press('Escape');
await p.waitForTimeout(200);
t('three labels and one region on the map',
  (await ops('labels')).length === 2 && (await ops('regions')).length === 1, (await ops('labels')).map((l) => l.text).join(', '));


/* ========================================================================== *
 * Back from disk.
 * ========================================================================== */

await p.waitForTimeout(400);
const fpBefore = await fingerprint();
const savedLabels = await ops('labels');
await p.click('#btn-save');
await p.waitForTimeout(2000);
await p.reload({ waitUntil: 'networkidle' });
await ready(p);
await p.waitForTimeout(800);
t('the names come back from disk', JSON.stringify(await ops('labels')) === JSON.stringify(savedLabels));
t('and the map is pixel-identical', await fingerprint() === fpBefore);


/* ========================================================================== *
 * The art.
 * ========================================================================== */

await newMap(p, { name: 'Town Art Check', kind: 'battle', size: '20x15' });
const lib = await p.evaluate(async ([tex, st]) => {
  const A = await import('/js/assets.js');
  const get = (id) => A.library.byId.get(id);
  return {
    textures: tex.map((n) => get('starter/' + n)).map((a) => a && [a.kind, a.group, a.tileable]),
    stamps: st.map((n) => [0, 2, 3].map((v) => get('starter/' + n + (v ? '-' + v : '')))
      .map((a) => a && [a.kind, a.group])),
  };
}, [TEXTURES, STAMPS]);
t('three roof textures are in the library',
  lib.textures.every((a) => a && a[0] === 'terrain' && a[1] === 'roof' && a[2] === true), JSON.stringify(lib.textures));
t('eight town symbols, three variants of each',
  lib.stamps.every((v) => v.every((a) => a && a[0] === 'stamp' && a[1] === 'town')),
  lib.stamps.map((v) => v.filter(Boolean).length).join(','));

const seams = await p.evaluate(async (tex) => {
  const A = await import('/js/assets.js');
  const res = {};
  for (const n of tex) {
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
t('each roof meets its own opposite edge',
  Object.values(seams).every((s) => s.x <= 1 && s.y <= 1 && s.opaque), JSON.stringify(seams));

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
const stamped = await p.evaluate(() => {
  const objs = window.__cg.app.doc.layers.find((l) => l.kind === 'objects');
  const ids = objs.ops.flatMap((o) => o.assets || (o.asset ? [o.asset] : []));
  return [...new Set(ids.map((id) => id.replace(/-\d+$/, '')))];
});
t('all eight can be placed with the Stamp tool',
  STAMPS.every((n) => stamped.includes('starter/' + n)), stamped.join(' '));
if (process.env.CG_SHOT) await p.screenshot({ path: process.env.CG_SHOT });

/* More never repeats itself, and a waiting name stays on its map ----------- */

// Southern regions were the worst case: up to 21 of the 48 names on four
// pages were ones an earlier page had shown.
// The dialog's starting seed is random; it is pinned here so the check
// measures the same five pages every run.
await p.evaluate(() => { window.__realRandom = Math.random; Math.random = () => 0.4242; });
await p.click('.tool[data-tool="label"]');
await p.waitForTimeout(200);
await clickMap(300, 900);
await p.waitForSelector('.modal [data-names="chips"] .name-chip');
await p.evaluate(() => { Math.random = window.__realRandom; });
await p.selectOption('.modal [data-names="style"]', 'southern');
await p.selectOption('.modal [data-names="kind"]', 'region');
await p.waitForTimeout(120);
const pages = [await chips()];
for (let i = 0; i < 4; i++) {
  await p.click('.modal [data-names="more"]');
  await p.waitForTimeout(100);
  pages.push(await chips());
}
const offeredAll = pages.flat();
t('five pages of More offer sixty different names', offeredAll.length === 60 && new Set(offeredAll).size === 60,
  `${new Set(offeredAll).size} of ${offeredAll.length}`);
await p.click('.modal button:has-text("Cancel")');
await p.waitForTimeout(200);

const kept = await p.evaluate(async () => {
  const N = await import('/js/names.js');
  N.setPendingName('Wendlecombe');
  return N.takePendingName();
});
t('a name waiting for the next label is handed to it', kept === 'Wendlecombe', kept);
await p.evaluate(async () => (await import('/js/names.js')).setPendingName('Wendlecombe'));
await newMap(p, { name: 'Names Elsewhere', kind: 'region' });
const leaked = await p.evaluate(async () => (await import('/js/names.js')).takePendingName());
t('but not to a label on another map', leaked === '', leaked);

t('no request leaves 127.0.0.1', external.length === 0, external.slice(0, 3).join(' '));
t('no console errors', errs.length === 0, errs.slice(0, 3).join(' | '));

/* report ------------------------------------------------------------------- */

for (const [s, n, note] of out) console.log(`${s}  ${n}${note ? '  [' + note + ']' : ''}`);
console.log(`\n${out.length - fails}/${out.length} passed`);
await b.close();
process.exit(fails ? 1 : 0);
