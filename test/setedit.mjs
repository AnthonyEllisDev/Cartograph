/* Editing a set.
 *
 * Several things of one kind held at once offer the fields they share in the
 * Selected panel, and a change there goes to every one of them as one step in
 * the history. This suite picks things up the way a person does -- a box
 * dragged on empty map -- and checks that the shared fields are offered (and
 * the ones that make each thing itself are not), that a field the things
 * disagree on says so, that one change reaches them all as one undo step and
 * comes back exactly on undo and redo, that a change that moves nothing is not
 * a step, that a mixed set offers no fields, that turning a run of walls into
 * windows relights the map, and that the result survives a reload.
 *
 * Start the server first:  python3 app.py --no-browser --port 7871
 * Then:                    node test/setedit.mjs [http://127.0.0.1:7871]
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

const b = await launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
const errs = [];
const offHost = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
p.on('request', (r) => { if (!/^(https?:\/\/127\.0\.0\.1[:/]|data:|blob:)/.test(r.url())) offHost.push(r.url()); });
await p.goto(base('http://127.0.0.1:7871/'), { waitUntil: 'networkidle' });
await ready(p);
await newMap(p, { name: 'Torchlit Hall', kind: 'battle', size: '20x15' });

/* helpers ------------------------------------------------------------------ */

const M = (mx, my) => p.evaluate(([x, y]) => {
  const s = window.__cg.mapToScreen(x, y);
  const r = document.getElementById('canvas').getBoundingClientRect();
  return { x: r.left + s.x, y: r.top + s.y };
}, [mx, my]);
const tool = async (n) => { await p.click(`.tool[data-tool="${n}"]`); await p.waitForTimeout(190); };
/** A box dragged on empty map from one corner to the other, as a person does. */
const boxSelect = async (x0, y0, x1, y1) => {
  await p.keyboard.press('Escape');
  const a = await M(x0, y0), z = await M(x1, y1);
  await p.mouse.move(a.x, a.y);
  await p.mouse.down();
  await p.mouse.move(z.x, z.y, { steps: 8 });
  await p.mouse.up();
  await p.waitForTimeout(250);
};
/** The labels of the fields in the Selected panel. */
const fieldLabels = () => p.$$eval('#selection-props .field label span, #selection-props label.check span',
  (els) => els.map((e) => e.textContent));
/** Set a field in the Selected panel by its label, the way its control fires. */
const setField = async (label, value) => {
  await p.evaluate(([lab, val]) => {
    const spans = [...document.querySelectorAll('#selection-props .field label span, #selection-props label.check span')];
    const s = spans.find((x) => x.textContent === lab || x.textContent === lab + ' (mixed)');
    if (!s) throw new Error('no field ' + lab);
    const i = s.closest('.field, label.check').querySelector('input,select');
    if (i.type === 'checkbox') { i.checked = !!val; i.dispatchEvent(new Event('change', { bubbles: true })); return; }
    i.value = String(val);
    // Committed controls listen for change; a colour picker without commit
    // listens for input. Every field in this panel commits.
    i.dispatchEvent(new Event('input', { bubbles: true }));
    i.dispatchEvent(new Event('change', { bubbles: true }));
  }, [label, value]);
  await p.waitForTimeout(250);
};
const hist = () => p.evaluate(() => {
  const h = window.__cg.history;
  return { n: h.past.length, label: (h.past[h.past.length - 1] || {}).label, dirty: !!window.__cg.app.dirty };
});
const undo = () => p.evaluate(async () => { (await import('/js/history.js')).undo(); });
const redo = () => p.evaluate(async () => { (await import('/js/history.js')).redo(); });
const brightnessAt = (x, y) => p.evaluate(([px, py]) => {
  const c = window.__cg.R.flatten({ scale: 1, grid: false, paper: false });
  const d = c.getContext('2d').getImageData(px, py, 1, 1).data;
  return (d[0] + d[1] + d[2]) / 3;
}, [x, y]);
const fingerprint = () => p.evaluate(() => {
  const c = window.__cg.R.flatten({ scale: 64 / window.__cg.app.doc.width });
  return Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data).join(',');
});

/* the map ------------------------------------------------------------------- */

// Three torches in a row along the top, one with no colour of its own (it
// draws with the default), and a run of three walls across the middle with a
// light on the far side of them. Everything is placed through the document;
// the picking up and the editing are done through the editor.
const C = 70;
await p.evaluate((C) => {
  const { app, R } = window.__cg;
  const walls = app.doc.layers.find((l) => l.kind === 'walls');
  const lights = app.doc.layers.find((l) => l.kind === 'lights');
  lights.ops = [
    { id: 'tA', x: 3 * C, y: 2 * C, bright: 70, dim: 140, color: '#ff8800' },
    { id: 'tB', x: 6 * C, y: 2 * C, bright: 70, dim: 140, color: '#ffcc00' },
    { id: 'tC', x: 9 * C, y: 2 * C, bright: 70, dim: 140 },
    { id: 'tD', x: 10 * C, y: 11 * C, bright: 280, dim: 560, color: '#ffffff' },
  ];
  lights.ambient = 0.85; lights.visible = true;
  walls.ops = [
    { id: 'wA', kind: 'wall', points: [{ x: 4 * C, y: 8 * C }, { x: 8 * C, y: 8 * C }] },
    { id: 'wB', kind: 'wall', points: [{ x: 8 * C, y: 8 * C }, { x: 12 * C, y: 8 * C }] },
    { id: 'wC', kind: 'wall', points: [{ x: 12 * C, y: 8 * C }, { x: 16 * C, y: 8 * C }] },
  ];
  R.invalidate(lights); R.invalidate(walls);
}, C);
await tool('select');

/* a set of lights ----------------------------------------------------------- */

await boxSelect(1.5 * C, 1 * C, 10.5 * C, 3 * C);
const held = await p.evaluate(() => {
  const n = document.querySelector('[data-selection-count]');
  return n ? n.getAttribute('data-selection-count') : null;
});
t('a box picks up the three torches', held === '3', held);
let labels = await fieldLabels();
t('a set of lights offers the fields lights share', ['Bright', 'Dim', 'Intensity', 'Spread', 'Lit'].every((l) => labels.includes(l)), JSON.stringify(labels));
t('a field the set disagrees on says so', labels.includes('Colour (mixed)') && !labels.includes('Bright (mixed)'), JSON.stringify(labels));

const h0 = await hist();
await setField('Colour', '#3366ff');
let colours = await p.evaluate(() => window.__cg.app.doc.layers.find((l) => l.kind === 'lights').ops.map((o) => o.color || null));
let h1 = await hist();
t('one change reaches every torch held, and nothing else', colours.slice(0, 3).every((c) => c === '#3366ff') && colours[3] === '#ffffff', JSON.stringify(colours));
t('and is one step in the history, named for them all', h1.n === h0.n + 1 && h1.label === 'Edit 3 lights' && h1.dirty, JSON.stringify(h1));
labels = await fieldLabels();
t('the field is no longer marked mixed', labels.includes('Colour') && !labels.includes('Colour (mixed)'), JSON.stringify(labels));

// Bright is shown in feet and stored in pixels, as it is for one light.
const px = await p.evaluate(async () => (await import('/js/tools.js')).unitPx());
await setField('Bright', 15);
const brights = await p.evaluate(() => window.__cg.app.doc.layers.find((l) => l.kind === 'lights').ops.map((o) => o.bright));
t('a radius is set in map units and stored in pixels for each', brights.slice(0, 3).every((b) => Math.abs(b - 15 * px) < 1e-6) && brights[3] === 280, JSON.stringify(brights));

await undo(); await undo();
await p.waitForTimeout(200);
const back = await p.evaluate(() => window.__cg.app.doc.layers.find((l) => l.kind === 'lights').ops.slice(0, 3)
  .map((o) => ({ color: 'color' in o ? o.color : '(none)', bright: o.bright })));
t('undo gives each its own colour back, and takes a colour off the one that had none',
  JSON.stringify(back) === JSON.stringify([{ color: '#ff8800', bright: 70 }, { color: '#ffcc00', bright: 70 }, { color: '(none)', bright: 70 }]),
  JSON.stringify(back));
labels = await fieldLabels();
t('and the panel follows the undo', labels.includes('Colour (mixed)'), JSON.stringify(labels));
await redo();
await p.waitForTimeout(200);
colours = await p.evaluate(() => window.__cg.app.doc.layers.find((l) => l.kind === 'lights').ops.map((o) => o.color || null));
t('redo puts the new colour back on all three', colours.slice(0, 3).every((c) => c === '#3366ff'), JSON.stringify(colours));
// The map on screen after all that is the map a full rebuild draws.
const same = await p.evaluate(() => {
  const { app, R } = window.__cg;
  const a = R.flatten({ scale: 0.5 }).toDataURL();
  R.rebuildLayer(app.doc.layers.find((l) => l.kind === 'lights'));
  return a === R.flatten({ scale: 0.5 }).toDataURL();
});
t('the screen after undo and redo is what a rebuild draws', same);

const h2 = await hist();
await setField('Colour', '#3366ff');
const h3 = await hist();
t('a change that moves nothing is not a step', h3.n === h2.n, JSON.stringify([h2, h3]));

/* a mixed set ---------------------------------------------------------------- */

await boxSelect(1.5 * C, 1 * C, 16.5 * C, 9 * C);
const mixed = await p.evaluate(() => document.querySelector('[data-selection-count]').getAttribute('data-selection-count'));
labels = await fieldLabels();
t('a set of lights and walls offers no fields', mixed === '6' && labels.length === 0, mixed + ' ' + JSON.stringify(labels));

/* a run of walls, made windows ----------------------------------------------- */

await boxSelect(3.5 * C, 7.5 * C, 16.5 * C, 8.5 * C);
labels = await fieldLabels();
t('a set of walls offers their kind', labels.includes('Kind'), JSON.stringify(labels));
// Above the walls, straight up from the light below them: in the shadow.
const dark = await brightnessAt(10 * C, 6 * C);
await setField('Kind', 'window');
const kinds = await p.evaluate(() => window.__cg.app.doc.layers.find((l) => l.kind === 'walls').ops.map((o) => o.kind));
const lit = await brightnessAt(10 * C, 6 * C);
t('three walls become windows in one step', kinds.every((k) => k === 'window') && (await hist()).label === 'Edit 3 walls', JSON.stringify(kinds));
t('and the light below them now reaches past them', lit > dark + 40, dark.toFixed(1) + ' -> ' + lit.toFixed(1));

/* a set of labels -------------------------------------------------------------- */

await p.evaluate((C) => {
  const { app, R } = window.__cg;
  const labels = app.doc.layers.find((l) => l.kind === 'labels');
  labels.ops = [
    { id: 'lA', x: 4 * C, y: 13 * C, text: 'Larder', style: 'settlement', size: 20 },
    { id: 'lB', x: 9 * C, y: 13 * C, text: 'Kennels', style: 'settlement', size: 28 },
  ];
  R.invalidate(labels);
}, C);
await boxSelect(2 * C, 12.3 * C, 11 * C, 13.6 * C);
labels = await fieldLabels();
t('a set of labels offers no wording to make them all the same', !labels.some((l) => /^Text/.test(l)) && labels.includes('Size (mixed)'), JSON.stringify(labels));
await setField('Size', 36);
const sizes = await p.evaluate(() => window.__cg.app.doc.layers.find((l) => l.kind === 'labels').ops.map((o) => [o.text, o.size]));
t('and sets their size together, keeping their words', JSON.stringify(sizes) === JSON.stringify([['Larder', 36], ['Kennels', 36]]), JSON.stringify(sizes));

/* reload ----------------------------------------------------------------------- */

await p.keyboard.press('Escape');
const before = await fingerprint();
const slug = await p.evaluate(async () => { const a = await import('/js/app.js'); await a.saveProject({ silent: true }); return a.app.slug; });
await p.reload({ waitUntil: 'networkidle' });
await ready(p);
await p.waitForFunction((s) => window.__cg.app.slug === s, slug, { timeout: 15000 });
await p.waitForTimeout(800);
t('the map reloads pixel-identical', before === await fingerprint());

/* screenshot -------------------------------------------------------------------- */

await tool('select');
await boxSelect(1.5 * C, 1 * C, 10.5 * C, 3 * C);
await p.screenshot({ path: process.env.CG_SHOT || '/tmp/cg_setedit.png' });

t('no request left 127.0.0.1', offHost.length === 0, offHost.slice(0, 3).join(' '));
t('no console errors', errs.length === 0, errs.slice(0, 3).join(' | '));

report();
await b.close();
process.exit(fails ? 1 : 0);
