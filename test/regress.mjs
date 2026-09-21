/* Regressions found by reading the code rather than by using it.
 *
 * Start the server first:  python3 app.py --no-browser --port 7871
 * Then:                    node test/regress.mjs [http://127.0.0.1:7871]
 *
 * Every check here stands for a bug that was in the program and is not any
 * more. They have one thing in common: a value derived from another, where the
 * source could change by a route that never told the derived value about it.
 */

import { launch, base, ready, newMap } from './browser.mjs';

const out = [];
let fails = 0;
function t(name, pass, note) {
  out.push([pass ? 'PASS' : 'FAIL', name, note == null ? '' : String(note)]);
  if (!pass) fails++;
}

const b = await launch();
const p = await b.newPage({ viewport: { width: 1700, height: 1000 } });
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await p.goto(base('http://127.0.0.1:7871/'), { waitUntil: 'networkidle' });
await ready(p);

/* helpers ------------------------------------------------------------------ */

const M = (mx, my) => p.evaluate(([x, y]) => {
  const s = window.__cg.mapToScreen(x, y);
  const r = document.getElementById('canvas').getBoundingClientRect();
  return { x: r.left + s.x, y: r.top + s.y };
}, [mx, my]);
const clickAt = async (x, y) => { const s = await M(x, y); await p.mouse.click(s.x, s.y); await p.waitForTimeout(120); };
const tool = async (n) => { await p.click(`.tool[data-tool="${n}"]`); await p.waitForTimeout(190); };
const setOpt = async (label, value) => {
  await p.evaluate(([lab, val]) => {
    const f = Array.from(document.querySelectorAll('#tool-options .field'))
      .find((x) => x.querySelector('label span') && x.querySelector('label span').textContent === lab);
    if (!f) throw new Error('no option ' + lab);
    const i = f.querySelector('input,select');
    i.value = val;
    i.dispatchEvent(new Event(i.type === 'range' ? 'input' : 'change', { bubbles: true }));
    if (i.type === 'range') i.dispatchEvent(new Event('change', { bubbles: true }));
  }, [label, String(value)]);
  await p.waitForTimeout(130);
};

/** Brightness of one pixel of the flattened map, 0-255, with the grid and the
 *  paper left out so that only the lighting is being measured. */
const brightnessAt = (x, y) => p.evaluate(([px, py]) => {
  const c = window.__cg.R.flatten({ scale: 1, grid: false, paper: false });
  const d = c.getContext('2d').getImageData(px, py, 1, 1).data;
  return (d[0] + d[1] + d[2]) / 3;
}, [x, y]);

/** A 64-pixel thumbprint of the whole flattened map: the standing test for
 *  "this map came back exactly as it was put away". */
const fingerprint = () => p.evaluate(() => {
  const c = window.__cg.R.flatten({ scale: 1, grid: true, paper: true });
  const s = document.createElement('canvas'); s.width = 64; s.height = 64;
  const x = s.getContext('2d'); x.drawImage(c, 0, 0, 64, 64);
  return Array.from(x.getImageData(0, 0, 64, 64).data).join(',');
});

/** Click the eye on a layer row, the way a person would. */
const toggleEye = async (name) => {
  await p.evaluate((wanted) => {
    const row = Array.from(document.querySelectorAll('#layer-list .lname'))
      .find((n) => n.textContent === wanted);
    if (!row) throw new Error('no layer row named ' + wanted);
    row.parentElement.querySelector('.eye').click();
  }, name);
  await p.waitForTimeout(350);
};

/* ========================================================================== *
 * A battle map: walls, lights, and everything derived from them.
 * ========================================================================== */

await newMap(p, { name: 'Guarded Hall', kind: 'battle', size: '30x20' });

// One long wall across the room, then a light on one side of it, so there is a
// real shadow to measure on the other.
await tool('wall');
await setOpt('Kind', 'wall');
await setOpt('Thickness', '7');
await clickAt(400, 200);
await clickAt(400, 1100);
await p.keyboard.press('Enter');
await p.waitForTimeout(350);

await tool('light');
await setOpt('Source', 'torch');
await p.waitForTimeout(200);
await clickAt(250, 650);
await p.waitForTimeout(500);

const lit = await p.evaluate(() => {
  const l = window.__cg.app.doc.layers.find((x) => x.kind === 'lights');
  return { n: l.ops.length, ambient: l.ambient, visible: l.visible };
});
t('a light was placed and turned the darkness on', lit.n === 1 && lit.ambient > 0,
  JSON.stringify(lit));

/* ---- hiding the walls has to relight ------------------------------------- */

// Behind the wall, where the shadow falls.
const shadowed = [700, 650];
const before = await brightnessAt(...shadowed);
await toggleEye('Walls');
const afterHide = await brightnessAt(...shadowed);
// The eye used to composite and nothing else, so the shadows of a wall nobody
// could see any longer stayed exactly where they were until something else
// happened to relight.
t('hiding the walls lifts the shadows they were casting', Math.abs(afterHide - before) > 2,
  `behind the wall: ${before.toFixed(1)} lit, ${afterHide.toFixed(1)} with the walls hidden`);

await toggleEye('Walls');
const afterShow = await brightnessAt(...shadowed);
t('and showing them again puts them back', Math.abs(afterShow - before) < 1.5,
  `${afterShow.toFixed(1)} vs ${before.toFixed(1)}`);

/* ---- a group's visibility vetoes the shadows too -------------------------- */

const grouped = await p.evaluate(async () => {
  const ui = await import('/js/ui.js');
  const render = await import('/js/render.js');
  const doc = window.__cg.app.doc;
  const walls = doc.layers.find((l) => l.kind === 'walls');
  window.__cg.app.activeLayerId = walls.id;
  const group = ui.addGroup();
  ui.setLayerGroup(walls, group.id);
  const segs = () => render.wallSegments(doc).length;
  const on = segs();
  group.visible = false;
  const off = segs();
  group.visible = true;
  return { on, off, drawn: doc.layers.filter((l) => l.group === group.id).map((l) => l.kind) };
});
// wallSegments read layer.visible directly, so a group could hide the walls on
// the map while they went on stopping the light -- hard shadow edges in what
// looked like empty floor, and relighting did not fix it because the source of
// truth itself was wrong.
t('a walls layer can be put in a group', grouped.drawn.includes('walls'), grouped.drawn.join(', '));
t('hiding that group stops the walls casting shadows', grouped.on > 0 && grouped.off === 0,
  `${grouped.on} segments shown, ${grouped.off} hidden`);

/* ---- the VTT export must agree with the picture it ships with ------------- */

const vtt = await p.evaluate(async () => {
  const doc = window.__cg.app.doc;
  const render = await import('/js/render.js');
  const ui = await import('/js/ui.js');
  const lights = doc.layers.find((l) => l.kind === 'lights');
  const group = doc.layers.find((l) => l.kind === 'group');
  ui.setLayerGroup(lights, group.id);
  const read = () => render.toUVTT("data:image/png;base64,", { bakedLighting: false });
  const shown = read().lights.length;
  group.visible = false;
  const hidden = read().lights.length;
  group.visible = true;
  ui.setLayerGroup(lights, null);
  return { shown, hidden };
});
t('the tabletop export leaves out lights the map was exported without',
  vtt.shown > 0 && vtt.hidden === 0, `${vtt.shown} lights shown, ${vtt.hidden} hidden`);

/* ---- undo has to put back everything the edit changed --------------------- */

const thickness = await p.evaluate(() => window.__cg.app.doc.layers
  .find((l) => l.kind === 'walls').thickness);
await tool('wall');
await setOpt('Thickness', '20');
await clickAt(1400, 300);
await clickAt(1400, 900);
await p.keyboard.press('Enter');
await p.waitForTimeout(350);
await p.keyboard.press('Control+z');
await p.waitForTimeout(500);
const afterUndo = await p.evaluate(() => {
  const l = window.__cg.app.doc.layers.find((x) => x.kind === 'walls');
  return { thickness: l.thickness, walls: l.ops.length };
});
// Thickness is a property of the layer, so the new wall restyled every wall
// already on it -- and undo, which only ever restored the op list, left them
// all at the new thickness with no step left that could put them back.
t('undoing a wall restores the thickness the others were drawn at',
  afterUndo.thickness === thickness, `${afterUndo.thickness} vs ${thickness}`);
t('and leaves the earlier walls alone', afterUndo.walls === 1, afterUndo.walls + ' walls');

/* undoing the first light must put the darkness back the way it was --------- */

const lightUndo = await p.evaluate(async () => {
  const doc = window.__cg.app.doc;
  const lights = doc.layers.find((l) => l.kind === 'lights');
  const history = await import('/js/history.js');
  lights.visible = false;                       // working on the map in daylight
  const tools = await import('/js/tools.js');
  const before = lights.visible;
  tools.TOOLS.light.down({ x: 900, y: 700 }, {}, lights);
  tools.TOOLS.light.up({ x: 900, y: 700 }, {}, lights);
  const during = lights.visible;
  history.undo();
  return { before, during, after: lights.visible, n: lights.ops.length };
});
// apply() turns the lighting layer on; undo restored the ops and the ambient
// and left it on, so undoing a light plunged a map into darkness it had never
// been in.
t('undoing a light leaves the lighting layer as it found it',
  lightUndo.during === true && lightUndo.after === false,
  `hidden -> ${lightUndo.during} -> ${lightUndo.after}`);

/* ---- a layer's opacity is applied once, not twice ------------------------- */

// This is what the Opacity slider does, and all it did: the grid and the paper
// also baked the same figure into their own canvas, so the slider moved one
// factor of two and a reload rebuilt both. The map came back different.
await p.evaluate(async () => {
  const R = window.__cg.R;
  const grid = window.__cg.app.doc.layers.find((l) => l.kind === 'grid');
  grid.opacity = 0.8;
  R.compositeAll(); R.requestDraw();
});
await p.waitForTimeout(300);
const gridBefore = await fingerprint();
await p.click('#btn-save');
await p.waitForTimeout(1800);
await p.reload({ waitUntil: 'networkidle' });
await ready(p);
t('a grid whose opacity was changed reloads pixel-identical',
  gridBefore === (await fingerprint()));

await p.evaluate(() => window.__cg.R.fitView());
await p.waitForTimeout(400);
await p.screenshot({ path: '/tmp/cg_regress_battle.png' });

/* ========================================================================== *
 * A region map: painting, softening, and coming back the same way.
 * ========================================================================== */

await newMap(p, { name: 'Softened Shore', kind: 'region' });

await tool('brush');
await p.waitForTimeout(250);
// The terrain brush refuses to start without a texture chosen, by design.
await p.click('#asset-picker .asset[title="Broadleaf Forest"]');
await p.waitForTimeout(250);
await setOpt('Size', '200');
const drag = async (pts, steps = 4) => {
  const s0 = await M(...pts[0]);
  await p.mouse.move(s0.x, s0.y);
  await p.mouse.down();
  for (const q of pts.slice(1)) { const s = await M(...q); await p.mouse.move(s.x, s.y, { steps }); }
  await p.mouse.up();
  await p.waitForTimeout(500);
};
// A band of paint wide enough for the soften strokes below to have something
// to work on.
await drag([[350, 600], [1450, 600]], 6);

// Two soften strokes whose boxes are the same size, in different places: they
// borrow the same canvas out of the scratch pool, so if either left anything
// behind on it the map would not come back the way it went away.
await tool('soften');
await p.waitForTimeout(250);
await drag([[400, 500], [800, 700]]);
await drag([[1400, 500], [1000, 700]]);

const painted = await p.evaluate(() => {
  const l = window.__cg.app.doc.layers.find((x) => x.kind === 'raster');
  return l.ops.map((o) => o.t).join(',');
});
t('the band and both soften strokes were recorded', painted === 'stroke,soften,soften', painted);

const softBefore = await fingerprint();
await p.click('#btn-save');
await p.waitForTimeout(1800);
await p.reload({ waitUntil: 'networkidle' });
await ready(p);
t('a softened map reloads pixel-identical', softBefore === (await fingerprint()));

await p.evaluate(() => window.__cg.R.fitView());
await p.waitForTimeout(400);
await p.screenshot({ path: '/tmp/cg_regress_region.png' });

t('no console errors', errs.length === 0, errs.slice(0, 3).join(' | '));

for (const [status, name, note] of out) {
  console.log(status.padEnd(5), name, note ? ' [' + note + ']' : '');
}
console.log(`\n${out.length - fails}/${out.length} passed`);
await b.close();
process.exit(fails ? 1 : 0);
