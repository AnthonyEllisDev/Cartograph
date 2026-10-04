/* Regressions found by reading the code rather than by using it.
 *
 * Start the server first:  python3 app.py --no-browser --port 7871
 * Then:                    node test/regress.mjs [http://127.0.0.1:7871]
 *
 * Every check here stands for a bug that was in the program and is not any
 * more. They have one thing in common: a value derived from another, where the
 * source could change by a route that never told the derived value about it.
 */

import { cpSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

/* ========================================================================== *
 * The 2026-09-22 review: routes that changed what casts a shadow without
 * saying so, an eraser that showed nothing until you let go, and a history
 * that ran out of room it was no longer using.
 * ========================================================================== */

await newMap(p, { name: 'Shuttered Vault', kind: 'battle', size: '30x20' });

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

const spot = [700, 650];                      // behind the wall, in the shadow
const castingLit = await brightnessAt(...spot);

/* ---- filing the walls into a hidden group has to relight ------------------ */

// The eye on the Walls row goes through relight. Dragging the same layer into
// a folder that is already hidden changes layerVisible by a different route,
// and that route only composited -- so the shadows of a wall nobody could see
// stayed put.
await p.evaluate(async () => {
  const ui = await import('/js/ui.js');
  const doc = window.__cg.app.doc;
  const group = ui.addGroup();
  // addGroup takes the selected layer in with it; put it back so the folder is
  // empty and the only thing that moves is the walls.
  for (const l of doc.layers.filter((x) => x.group === group.id)) ui.setLayerGroup(l, null);
  group.visible = false;
  window.__cgGroupId = group.id;
  ui.setLayerGroup(doc.layers.find((l) => l.kind === 'walls'), group.id);
});
await p.waitForTimeout(450);
const inHiddenGroup = await brightnessAt(...spot);
t('filing the walls into a hidden group lifts their shadows',
  Math.abs(inHiddenGroup - castingLit) > 2,
  `${castingLit.toFixed(1)} casting, ${inHiddenGroup.toFixed(1)} filed away`);

await p.evaluate(async () => {
  const ui = await import('/js/ui.js');
  const doc = window.__cg.app.doc;
  ui.setLayerGroup(doc.layers.find((l) => l.kind === 'walls'), null);
});
await p.waitForTimeout(450);
const takenOut = await brightnessAt(...spot);
t('and taking them out again puts them back',
  Math.abs(takenOut - castingLit) < 1.5, `${takenOut.toFixed(1)} vs ${castingLit.toFixed(1)}`);

/* ---- deleting the folder the walls were hidden in, likewise --------------- */

// Back into the folder, and this time the folder is hidden by its own eye --
// a route that has relit correctly since it was fixed. So the shadows really
// are up before the delete, and the delete is the only thing under test.
await p.evaluate(async () => {
  const ui = await import('/js/ui.js');
  const doc = window.__cg.app.doc;
  // Open the folder again first, so that the eye below is what closes it.
  doc.layers.find((l) => l.id === window.__cgGroupId).visible = true;
  ui.setLayerGroup(doc.layers.find((l) => l.kind === 'walls'), window.__cgGroupId);
});
await p.waitForTimeout(400);
await toggleEye('Group 1');
const folded = await brightnessAt(...spot);
t('hiding the folder by its eye lifts them too', Math.abs(folded - castingLit) > 2,
  `${castingLit.toFixed(1)} casting, ${folded.toFixed(1)} folded away`);

// Deleting a group frees its members rather than deleting them, so the walls
// come back into view and start casting again. By the time deleteLayer could
// ask relight whether the group held any, it has already let them go.
await p.evaluate(() => {
  const row = Array.from(document.querySelectorAll('#layer-list .lname'))
    .find((n) => n.textContent === 'Group 1');
  row.parentElement.click();
});
await p.waitForTimeout(300);
await p.click('#layer-props .btn-danger');
await p.waitForTimeout(600);

const afterDelete = await brightnessAt(...spot);
t('deleting the folder the walls were hidden in puts their shadows back',
  Math.abs(afterDelete - castingLit) < 1.5,
  `${afterDelete.toFixed(1)} vs ${castingLit.toFixed(1)} casting`);

/* ---- the history has to repay what it throws away ------------------------- */

const budget = await p.evaluate(async () => {
  const h = await import('/js/history.js');
  h.clearHistory();
  // Paint, undo, paint again -- the undone entry is discarded on the next
  // push. Its pixels used to go on counting against the 220 MB budget for the
  // rest of the session, and once the leak passed it the stack emptied itself
  // on every push: undo greyed out the moment it was used and stayed that way.
  for (let i = 0; i < 40; i++) {
    h.pushEntry({ label: 'x', bytes: 12 * 1024 * 1024, undo() {}, redo() {} });
    h.undo();
  }
  // Then four ordinary strokes with no undo between them. All four should
  // still be on the stack; with the leak the budget was already spent and
  // every push evicted everything but the one just made.
  for (let i = 0; i < 4; i++) h.pushEntry({ label: 'x', bytes: 12 * 1024 * 1024, undo() {}, redo() {} });
  const state = { past: h.history.past.length, mb: Math.round(h.history.bytes / 1048576) };
  h.clearHistory();
  return state;
});
t('undoing and redrawing does not leak the history budget', budget.mb <= 60,
  `${budget.mb} MB held for ${budget.past} step${budget.past === 1 ? '' : 's'}`);
t('so undo still has every step behind it after a long session', budget.past === 4,
  budget.past + ' of 4 steps kept');

/* ========================================================================== *
 * A region map: the eraser, and what the Select tool records.
 * ========================================================================== */

await newMap(p, { name: 'Scraped Coast', kind: 'region' });

await tool('brush');
await p.click('#asset-picker .asset >> nth=0');
await p.waitForTimeout(400);
await setOpt('Size', '220');
await drag([[500, 600], [1400, 600]]);
await p.waitForTimeout(300);

/* ---- an erase has to show while the button is still down ----------------- */

// The live canvas is drawn over the layer with source-over, which cannot
// subtract -- so a destination-out stroke laid on it showed nothing at all and
// the eraser appeared dead until pointer-up.
// A strip of the composited map across the middle of the band. Alpha is no
// use here -- the parchment underneath is opaque, so the pixel stays solid
// whatever happens to the paint on top. The colour is what moves.
const strip = () => p.evaluate(() =>
  Array.from(window.__cg.R.view.flat.getContext('2d').getImageData(820, 590, 160, 20).data));
const apart = (a, b) => {
  let sum = 0;
  for (let i = 0; i < a.length; i += 4) {
    sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  }
  return Math.round(sum / (a.length / 4));
};

const inked = await strip();
await tool('erase');
await setOpt('Size', '260');
{
  const a = await M(700, 600), b = await M(1100, 600);
  await p.mouse.move(a.x, a.y);
  await p.mouse.down();
  await p.mouse.move(b.x, b.y, { steps: 12 });
  await p.waitForTimeout(280);
  const during = await strip();
  await p.mouse.up();
  await p.waitForTimeout(400);
  const after = await strip();
  // The eraser really did take the paint off...
  t('the eraser takes the paint off', apart(inked, after) > 12, apart(inked, after) + ' apart');
  // ...and the map already looked like that before the button came up.
  t('an erase shows on the map while the button is still down',
    apart(during, after) < apart(inked, after) / 3,
    `mid-drag ${apart(during, after)} from the result, un-erased ${apart(inked, after)}`);
}

const eraseLabel = await p.evaluate(() => {
  const past = window.__cg.history.past;
  return past.length ? past[past.length - 1].label : '(none)';
});
t('and it is called an erase in the History panel', eraseLabel === 'Erase', eraseLabel);

/* ---- selecting is not moving ---------------------------------------------- */

await tool('stamp');
await p.click('#asset-picker .asset.is-stamp >> nth=0');
await p.waitForTimeout(400);
await clickAt(900, 900);
await p.waitForTimeout(350);

const stepsBefore = await p.evaluate(() => window.__cg.history.past.length);
await tool('select');
await clickAt(900, 900);
await p.waitForTimeout(250);
const stepsAfter = await p.evaluate(() => window.__cg.history.past.length);
// A click that only selects used to push a Move entry that moved nothing, and
// at 32 slots that pushes real steps off the bottom of the stack.
t('clicking a stamp to select it records no history step', stepsAfter === stepsBefore,
  `${stepsBefore} steps before, ${stepsAfter} after`);

/* ---- a click that draws nothing is not a step ------------------------------ */

{
  await newMap(p, { name: 'Regress Shapes', kind: 'region' });
  await tool('shape');
  await p.click('#asset-picker .asset >> nth=0');
  await p.waitForTimeout(400);
  const before = await p.evaluate(() => window.__cg.history.past.length);
  await clickAt(900, 700);
  await p.waitForTimeout(350);
  const after = await p.evaluate(() => window.__cg.history.past.length);
  // down() seeds both corners at the same point, so a click with no drag
  // reached endPaint with two points and a zero-area shape: nothing drawn, but
  // a step pushed that undid nothing and evicted a real one off the 32 slots.
  t('a shape click that drags nowhere records no history step', after === before,
    `${before} steps before, ${after} after`);
  const ops = await p.evaluate(() => {
    const l = window.__cg.app.doc.layers.find((x) => x.kind === 'raster');
    return l ? l.ops.length : -1;
  });
  t('and writes no dead op into the map', ops === 0, ops + ' ops');
}

/* ---- the *first* light turns the night on, not every one ------------------- */

{
  await newMap(p, { name: 'Regress Lights', kind: 'battle' });
  await tool('light');
  await clickAt(700, 700);
  await p.waitForTimeout(450);
  const lit = await p.evaluate(() => {
    const l = window.__cg.app.doc.layers.find((x) => x.kind === 'lights');
    return l ? l.ambient : null;
  });
  // The precondition its neighbour is measured against: the first light really
  // does turn the darkness on, and this check is what makes the next one mean
  // something. It passes either way and is kept deliberately.
  t('the first light turns the darkness on', lit > 0, 'ambient ' + lit);

  await p.evaluate(() => {
    const l = window.__cg.app.doc.layers.find((x) => x.kind === 'lights');
    l.ambient = 0;
    window.__cg.R.invalidate(l);
  });
  await p.waitForTimeout(300);
  await clickAt(1100, 800);
  await p.waitForTimeout(450);
  const still = await p.evaluate(() => {
    const l = window.__cg.app.doc.layers.find((x) => x.kind === 'lights');
    return l.ambient;
  });
  // The test was on the ambient value rather than on whether the layer already
  // held any lights, so pulling Darkness to nought to look at the art
  // underneath snapped the map back to night on the very next light placed.
  t('a later light leaves the darkness where it was put', still === 0, 'ambient ' + still);
}

/* ---- the two halves of a VTT export agree about the walls ------------------ */

{
  await newMap(p, { name: 'Regress Walls', kind: 'battle' });
  await tool('wall');
  {
    const a = await M(400, 400), c = await M(1200, 400);
    await p.mouse.click(a.x, a.y); await p.waitForTimeout(150);
    await p.mouse.click(c.x, c.y); await p.waitForTimeout(150);
    await p.keyboard.press('Enter');
    await p.waitForTimeout(350);
  }
  const shown = await p.evaluate(() => window.__cg.R.toUVTT('data:,').line_of_sight.length);
  t('a visible walls layer exports its sight lines', shown > 0, shown + ' lines');
  await p.evaluate(() => {
    const l = window.__cg.app.doc.layers.find((x) => x.kind === 'walls');
    l.visible = false;
    window.__cg.R.relight(l);
  });
  await p.waitForTimeout(300);
  const hidden = await p.evaluate(() => window.__cg.R.toUVTT('data:,').line_of_sight.length);
  // The picture half of the export goes through flatten, which drops a hidden
  // layer; the walls half did not check, so a tabletop got barriers for walls
  // that were not in the image and tokens stopped dead at nothing.
  t('a hidden one exports none, so picture and data agree', hidden === 0, hidden + ' lines');
}

/* ---- a layer kind nothing knows about does not stop the map opening -------- */

{
  const opened = await p.evaluate(async () => {
    const doc = JSON.parse(JSON.stringify(window.__cg.app.doc));
    doc.layers.push({ id: 'l-gone', kind: 'from-an-extension-that-is-off',
                      name: 'Orphan', visible: true, opacity: 1, ops: [] });
    // LAYER_KINDS[l.kind].paint was read unguarded here, so a map holding a
    // kind from an extension that is switched off or has been removed threw
    // before anything was drawn -- and the layer could not then be reached to
    // delete it either.
    try {
      await (await import('/js/app.js')).openDocument(doc, window.__cg.app.slug);
      return 'ok';
    } catch (err) { return 'threw: ' + err.message; }
  });
  t('a map holding an unknown layer kind still opens', opened === 'ok', opened);
  const listed = await p.evaluate(() => {
    try {
      return document.querySelectorAll('#layer-list .layer').length;
    } catch (err) { return -1; }
  });
  t('and the orphan layer is listed so it can be removed', listed > 1, listed + ' rows');
}

/* a coastline that is narrowed leaves nothing of the wider one behind ------- */

{
  await newMap(p, { name: 'Shrinking Shore', kind: 'region' });
  await tool('land');
  const f = await M(520, 480);
  await p.mouse.move(f.x, f.y); await p.mouse.down();
  for (const q of [[900, 460], [980, 820], [560, 800], [520, 480]]) {
    const s = await M(...q); await p.mouse.move(s.x, s.y, { steps: 6 });
  }
  await p.mouse.up();
  await p.waitForTimeout(1500);

  // Widen the shelf, then narrow it. repaintLand clears only the rectangle it
  // is about to draw and grew that rectangle from the *current* widths, so the
  // wider band painted a moment earlier fell outside the clear and stayed on
  // the canvas in 64-px steps -- and a rebuild, which clears the whole canvas,
  // did not reproduce it. Compared against a full rebuild of the same layer,
  // which is the thing a reload does.
  const widthTo = async (v) => {
    await p.evaluate((n) => {
      const layer = window.__cg.app.doc.layers.find((l) => l.kind === 'land');
      layer.coast.shallow = true;
      layer.coast.shallowWidth = n;
      window.__cg.R.repaintLand(layer);
    }, v);
    await p.waitForTimeout(700);
  };
  await widthTo(150);
  await widthTo(4);
  const shown = await p.evaluate(() => {
    const c = window.__cg.R.view.flat;
    return c.getContext('2d').getImageData(0, 0, c.width, c.height).data.slice();
  });
  await p.evaluate(() => {
    const layer = window.__cg.app.doc.layers.find((l) => l.kind === 'land');
    window.__cg.R.invalidate(layer);
  });
  await p.waitForTimeout(1500);
  const rebuilt = await p.evaluate(() => {
    const c = window.__cg.R.view.flat;
    return c.getContext('2d').getImageData(0, 0, c.width, c.height).data.slice();
  });
  let off = 0;
  for (const k of Object.keys(shown)) if (shown[k] !== rebuilt[k]) off++;
  t('narrowing the shallow shelf leaves none of the wider one on the canvas',
    off === 0, off + ' bytes differ from a full rebuild');
}

/* the stroke under the cursor is the stroke that is committed --------------- */

{
  await newMap(p, { name: 'Curved Preview', kind: 'region' });
  await tool('brush');
  await p.click('#asset-picker .asset');
  await p.waitForTimeout(250);
  await setOpt('Size', 90);

  // A uniform widths array picks the tapered rasteriser, which stamps discs
  // along the straight chords between points; endPaint drops the array, and
  // the committed stroke is drawn as the corner-cutting spline instead. A
  // mouse gives every point the same width, so this was every ordinary stroke:
  // angular under the cursor, smooth the instant the button came up. Corners
  // are what shows it, hence the zig-zag.
  const route = [[500, 500], [700, 380], [820, 620], [1000, 420], [1120, 660]];
  const f2 = await M(...route[0]);
  await p.mouse.move(f2.x, f2.y); await p.mouse.down();
  for (const q of route.slice(1)) { const s = await M(...q); await p.mouse.move(s.x, s.y, { steps: 3 }); }
  await p.waitForTimeout(400);
  const mid = await p.evaluate(() => {
    const c = window.__cg.R.view.flat;
    return Array.from(c.getContext('2d').getImageData(440, 320, 760, 420).data);
  });
  await p.mouse.up();
  await p.waitForTimeout(700);
  const done = await p.evaluate(() => {
    const c = window.__cg.R.view.flat;
    return Array.from(c.getContext('2d').getImageData(440, 320, 760, 420).data);
  });
  let moved = 0;
  for (let i = 0; i < mid.length; i++) if (Math.abs(mid[i] - done[i]) > 8) moved++;
  t('letting go of a curved stroke does not change its shape', moved === 0,
    moved + ' samples moved between the preview and the commit');
}

/* undoing a layer delete does not orphan the steps under it ----------------- */

{
  await newMap(p, { name: 'Orphaned Steps', kind: 'region' });
  await tool('brush');
  await p.click('#asset-picker .asset');
  await p.waitForTimeout(250);
  const f3 = await M(560, 520);
  await p.mouse.move(f3.x, f3.y); await p.mouse.down();
  const s3 = await M(1000, 640); await p.mouse.move(s3.x, s3.y, { steps: 6 });
  await p.mouse.up();
  await p.waitForTimeout(700);

  const painted = await p.evaluate(() => {
    const c = window.__cg.R.view.flat;
    const d = c.getContext('2d').getImageData(540, 500, 500, 180).data;
    let sum = 0; for (let i = 0; i < d.length; i += 16) sum += d[i] + d[i + 1] + d[i + 2];
    return sum;
  });

  // Delete a layer and put it back. The undo used to call setDocument, which
  // empties every layer canvas and mints new ones -- and every painting entry
  // below it in the stack is a closure holding the canvas it snapshotted. The
  // next undo then wrote its pixels into an orphan while still taking the op
  // out of the document, so the stroke stayed on screen and left the file.
  await p.evaluate(async () => {
    const ui = await import('/js/ui.js');
    ui.addPaintLayer();                       // selects it as it adds it
  });
  await p.waitForTimeout(400);
  // The Layers panel's own route: "Delete layer" at the foot of the properties.
  await p.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('#layer-props button'))
      .find((x) => x.textContent === 'Delete layer');
    btn.click();
  });
  await p.waitForTimeout(500);
  await p.evaluate(async () => { (await import('/js/history.js')).undo(); });
  await p.waitForTimeout(600);               // the delete comes back
  await p.evaluate(async () => { (await import('/js/history.js')).undo(); });
  await p.waitForTimeout(800);               // and now the stroke should go

  const after = await p.evaluate(() => {
    const c = window.__cg.R.view.flat;
    const d = c.getContext('2d').getImageData(540, 500, 500, 180).data;
    let sum = 0; for (let i = 0; i < d.length; i += 16) sum += d[i] + d[i + 1] + d[i + 2];
    return sum;
  });
  const opsGone = await p.evaluate(() => {
    const l = window.__cg.app.doc.layers.filter((x) => x.kind === 'raster');
    return l.every((x) => x.ops.length === 0);
  });
  t('undoing past a layer delete really takes the paint off the canvas',
    opsGone && Math.abs(after - painted) > 1,
    'ops gone=' + opsGone + ' painted=' + painted + ' after=' + after);
}

/* ========================================================================== *
 * 2026-09-25: found by three readers in parallel, reproduced, then fixed.
 * ========================================================================== */

const hist = () => p.evaluate(() => ({ past: window.__cg.history.past.length,
                                       future: window.__cg.history.future.length }));
const undoStep = async () => { await p.evaluate(async () => { (await import('/js/history.js')).undo(); }); await p.waitForTimeout(500); };

/* a light, its panel, and a wall it sits on ------------------------------------ */

{
  await newMap(p, { name: 'Lamp On The Wall', kind: 'battle', size: '40x30' });

  // A diagonal wall across one square, corner to corner -- which passes exactly
  // through that square's centre, which is where the Light tool snaps to.
  await tool('wall');
  await clickAt(140, 140); await clickAt(210, 210);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(400);
  await tool('light');
  await clickAt(175, 175);
  await p.waitForTimeout(600);
  const placed = await p.evaluate(() => {
    const l = window.__cg.app.doc.layers.find((x) => x.kind === 'lights');
    return l && l.ops[0] ? [l.ops[0].x, l.ops[0].y] : null;
  });
  t('precondition: the light snapped onto the wall', placed && placed[0] === 175 && placed[1] === 175,
    JSON.stringify(placed));
  // A little way off the wall on either side, well inside a torch's reach, and
  // a point far outside it for the darkness to be measured against.
  const near = Math.min(await brightnessAt(175, 280), await brightnessAt(280, 175));
  const dark = await brightnessAt(2400, 1800);
  t('a light standing on a wall still lights the room', near > dark + 25,
    'near ' + near.toFixed(0) + ' vs dark ' + dark.toFixed(0));

  // Pick it up and untick Lit. Light ops are placed with no `on` field at all,
  // and the undo used Object.assign, which never deletes a key.
  await tool('select');
  await clickAt(175, 175);
  await p.evaluate(() => {
    const box = Array.from(document.querySelectorAll('#selection-props .check'))
      .find((c) => c.querySelector('span').textContent === 'Lit').querySelector('input');
    box.checked = false;
    box.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await p.waitForTimeout(500);
  const offNow = await p.evaluate(() => window.__cg.app.doc.layers.find((x) => x.kind === 'lights').ops[0].on);
  t('precondition: unticking Lit puts the light out', offNow === false, offNow);
  await undoStep();
  const onAgain = await p.evaluate(() => window.__cg.app.doc.layers.find((x) => x.kind === 'lights').ops[0].on);
  t('undoing it relights it -- a field the light never had is taken off again', onAgain !== false, onAgain);

  // Now undo the light itself while the Select tool is still holding it, and
  // press Delete: there is nothing to delete, and the redo must survive.
  await undoStep();
  const lightsLeft = await p.evaluate(() => window.__cg.app.doc.layers.find((x) => x.kind === 'lights').ops.length);
  const h0 = await hist();
  await p.mouse.move(10, 10);
  await p.keyboard.press('Delete');
  await p.waitForTimeout(300);
  const h1 = await hist();
  t('Delete on something already undone away pushes nothing and keeps the redo',
    lightsLeft === 0 && h1.past === h0.past && h1.future === h0.future && h0.future > 0,
    JSON.stringify([lightsLeft, h0, h1]));
}

/* Ctrl+Z belongs to a text field while you are typing in it ------------------- */

{
  await newMap(p, { name: 'Typing Undo', kind: 'battle' });
  await tool('light');
  await clickAt(420, 420);
  await p.waitForTimeout(500);
  const before = await hist();
  await p.click('#project-name');
  await p.keyboard.type(' renamed');
  await p.keyboard.press('Control+z');
  await p.waitForTimeout(400);
  const after = await hist();
  const lit = await p.evaluate(() => window.__cg.app.doc.layers.find((x) => x.kind === 'lights').ops.length);
  t('Ctrl+Z in the name field does not undo the map', after.past === before.past && lit === 1,
    JSON.stringify([before, after, lit]));
  await p.keyboard.press('Escape');
  await p.click('#canvas', { position: { x: 5, y: 5 } }).catch(() => {});
}

/* an undo with nothing to undo is not an edit ------------------------------------ */

{
  await newMap(p, { name: 'Nothing To Undo', kind: 'region' });
  await p.click('#btn-save');
  await p.waitForTimeout(1800);
  const clean = await p.evaluate(() => window.__cg.app.dirty);
  await p.mouse.move(800, 500);
  await p.keyboard.press('Control+z');
  await p.waitForTimeout(300);
  const dirty = await p.evaluate(() => window.__cg.app.dirty);
  t('Ctrl+Z on a freshly saved map does not mark it unsaved', clean === false && dirty === false,
    JSON.stringify([clean, dirty]));
}

/* undoing a delete of the painted layer itself ------------------------------------ */

{
  await newMap(p, { name: 'Own Steps', kind: 'region' });
  await tool('brush');
  await p.click('#asset-picker .asset');
  await p.waitForTimeout(250);
  const f = await M(560, 520);
  await p.mouse.move(f.x, f.y); await p.mouse.down();
  const s = await M(1000, 640); await p.mouse.move(s.x, s.y, { steps: 6 });
  await p.mouse.up();
  await p.waitForTimeout(700);
  const band = () => p.evaluate(() => {
    const d = window.__cg.R.view.flat.getContext('2d').getImageData(540, 500, 500, 180).data;
    let sum = 0; for (let i = 0; i < d.length; i += 16) sum += d[i] + d[i + 1] + d[i + 2];
    return sum;
  });
  const painted = await band();
  // Delete the layer the stroke is *on* this time. Its own paint entry sits
  // below the delete holding the canvas it snapshotted, and the delete's undo
  // used to rebuild the layer into a fresh one.
  await p.evaluate(() => {
    const terrain = window.__cg.app.doc.layers.find((x) => x.kind === 'raster' && x.ops.length);
    window.__cg.app.activeLayerId = terrain.id;
  });
  await p.evaluate(async () => { (await import('/js/app.js')).emit('layers'); });
  await p.waitForTimeout(300);
  await p.evaluate(() => {
    Array.from(document.querySelectorAll('#layer-props button')).find((x) => x.textContent === 'Delete layer').click();
  });
  await p.waitForTimeout(500);
  await undoStep();                          // the layer comes back
  await p.waitForTimeout(300);
  const back = await band();
  await undoStep();                          // and now its stroke should go
  await p.waitForTimeout(400);
  const after = await band();
  const opsGone = await p.evaluate(() =>
    window.__cg.app.doc.layers.filter((x) => x.kind === 'raster').every((x) => x.ops.length === 0));
  t('precondition: undoing the delete brings the painted layer back', Math.abs(back - painted) <= 1,
    painted + ' vs ' + back);
  t('undoing past a delete of the painted layer takes its paint off the canvas',
    opsGone && Math.abs(after - painted) > 1, 'ops gone=' + opsGone + ' painted=' + painted + ' after=' + after);
}

/* a cleared landmass leaves no coast behind ----------------------------------------- */

{
  await newMap(p, { name: 'Cleared Coast', kind: 'region' });
  await tool('land');
  await setOpt('Size', '260');
  await drag([[500, 600], [1500, 600]], 6);
  await p.evaluate(() => {
    const land = window.__cg.app.doc.layers.find((x) => x.kind === 'land');
    window.__cg.app.activeLayerId = land.id;
  });
  await p.evaluate(async () => { (await import('/js/app.js')).emit('layers'); });
  await p.waitForTimeout(300);
  await p.evaluate(() => {
    Array.from(document.querySelectorAll('#layer-props button')).find((x) => x.textContent === 'Clear').click();
  });
  await p.waitForTimeout(700);
  // A narrower stroke along the same line: the old coast is inside the band
  // the repaint tints, and outside the band it regrows.
  await setOpt('Size', '200');
  await drag([[600, 600], [1400, 600]], 6);
  const ghost = await p.evaluate(() => {
    const R = window.__cg.R;
    const land = window.__cg.app.doc.layers.find((x) => x.kind === 'land');
    const grab = () => R.canvasFor(land).getContext('2d').getImageData(0, 0, 2048, 1536).data;
    const shown = grab();
    R.forgetLayer(land.id);                // nothing cached: rebuilt from the ops alone
    R.rebuildLayer(land);
    const rebuilt = grab();
    let n = 0;
    for (let i = 3; i < shown.length; i += 4) if (Math.abs(shown[i] - rebuilt[i]) > 8) n++;
    R.compositeAll(); R.requestDraw();
    return n;
  });
  t('painting after clearing the landmass brings none of the old coast back', ghost === 0,
    ghost + ' pixels differ from a rebuild');
}

/* ========================================================================== *
 * 2026-09-26: a stroke that outgrew its own size, a seam, and keys that went
 * to the wrong place.
 * ========================================================================== */

{
  await newMap(p, { name: 'Regress Keys', kind: 'region' });
  await tool('land');
  await setOpt('Size', '120');
  // ] during the drag grows the brush setting, not the stroke in hand: a
  // width past op.size ran outside every box measured from op.size.
  const a = await M(700, 700), c = await M(1300, 800);
  await p.mouse.move(a.x, a.y); await p.mouse.down();
  await p.mouse.move((a.x + c.x) / 2, a.y, { steps: 4 });
  for (let i = 0; i < 6; i++) await p.keyboard.press(']');
  await p.mouse.move(c.x, c.y, { steps: 4 });
  await p.mouse.up();
  await p.waitForTimeout(700);
  const grown = await p.evaluate(() => {
    const land = window.__cg.app.doc.layers.find((x) => x.kind === 'land');
    const op = land.ops[land.ops.length - 1];
    return { size: op.size, widest: Math.max(...(op.widths || [op.size])) };
  });
  t('pressing ] mid-stroke leaves the stroke no wider than its own size',
    grown.widest <= grown.size + 0.01, 'size ' + grown.size + ', widest ' + Math.round(grown.widest));

  // The box a landmass stroke composites has fractional edges -- it is padded
  // by an ink width of 2.5 -- and a fractional clip half-blends its outline.
  const seam = await p.evaluate(() => {
    const R = window.__cg.R;
    const w = R.view.flat.width, h = R.view.flat.height;
    const before = R.view.flatCtx.getImageData(0, 0, w, h).data;
    R.compositeAll();
    const after = R.view.flatCtx.getImageData(0, 0, w, h).data;
    let n = 0;
    for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) n++;
    R.requestDraw();
    return n;
  });
  t('the screen after a landmass stroke matches a full composite, with no seam round the box',
    seam === 0, seam + ' channel values differ');

  const land = await p.evaluate(async () => {
    const { undo } = await import('/js/history.js');
    undo();
    const R = window.__cg.R;
    const l = window.__cg.app.doc.layers.find((x) => x.kind === 'land');
    const m = R.maskFor(l).getContext('2d').getImageData(0, 0, 2048, 1536).data;
    let n = 0;
    for (let i = 3; i < m.length; i += 4) if (m[i] > 8) n++;
    return { ops: l.ops.length, n };
  });
  t('and undoing it leaves no ghost land in the mask', land.ops === 0 && land.n === 0,
    land.ops + ' ops, ' + land.n + ' mask pixels');

  // A label on the map, picked up with Select, and its Style menu focused.
  await p.evaluate(() => {
    const doc = window.__cg.app.doc;
    const l = doc.layers.find((x) => x.kind === 'labels');
    l.ops.push({ id: 't-reg', text: 'Harrowgate', x: 1000, y: 400, size: 40, style: 'settlement' });
    window.__cg.R.invalidate(l);
  });
  await tool('select');
  await clickAt(1000, 400);
  const picked = await p.evaluate(() => !document.getElementById('panel-selection').hidden);
  t('the label is picked up (precondition)', picked);
  await p.focus('#selection-props select');
  await p.keyboard.press('Delete');
  await p.keyboard.press('w');
  await p.waitForTimeout(250);
  const kept = await p.evaluate(() => ({
    n: window.__cg.app.doc.layers.find((x) => x.kind === 'labels').ops.length,
    tool: window.__cg.app.tool,
  }));
  t('Delete in a focused dropdown does not delete the thing selected', kept.n === 1, kept.n + ' labels');
  t('and typing in one does not pick up another tool', kept.tool === 'select', kept.tool);

  // Its own starting state, set up by a route known to work: if the Delete
  // above had taken the label, this check would otherwise measure nothing.
  await p.evaluate(() => {
    const l = window.__cg.app.doc.layers.find((x) => x.kind === 'labels');
    if (!l.ops.length) {
      l.ops.push({ id: 't-reg', text: 'Harrowgate', x: 1000, y: 400, size: 40, style: 'settlement' });
      window.__cg.R.invalidate(l);
    }
  });
  await tool('select');
  await clickAt(1000, 400);
  await p.evaluate(() => {
    const i = document.querySelector('#selection-props input[type=text]');
    if (!i) return;
    i.value = '   ';
    i.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await p.waitForTimeout(250);
  const text = await p.evaluate(() => {
    const op = window.__cg.app.doc.layers.find((x) => x.kind === 'labels').ops[0];
    return op ? op.text : 'no label left to check';
  });
  t('a label cannot be emptied from the Selected panel into something unclickable',
    text === 'Harrowgate', JSON.stringify(text));

  // The palette's scale-bar toggle is a setting like the Settings tab's one.
  await p.evaluate(async () => {
    await new Promise((r) => setTimeout(r, 300));
    localStorage.removeItem('cartograph.settings.v1');
  });
  await p.keyboard.press('Control+k');
  await p.waitForTimeout(250);
  await p.keyboard.type('scale bar');
  await p.waitForTimeout(200);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(600);
  const stored = await p.evaluate(() => {
    const raw = localStorage.getItem('cartograph.settings.v1');
    return raw ? JSON.parse(raw).showScaleBar : null;
  });
  t('hiding the scale bar from the palette is saved', stored === false, String(stored));
  await p.keyboard.press('Control+k');
  await p.waitForTimeout(250);
  await p.keyboard.type('scale bar');
  await p.waitForTimeout(200);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(300);

  // A region drawn after picking a custom colour and then a palette one.
  await tool('region');
  await p.click('#tool-options .target button.link');     // add a regions layer
  await p.waitForTimeout(300);
  // A colour input reports on `input`, which setOpt does not send.
  await p.evaluate(() => {
    const f = Array.from(document.querySelectorAll('#tool-options .field'))
      .find((x) => x.querySelector('label span') && x.querySelector('label span').textContent === 'Or pick one');
    const i = f.querySelector('input');
    i.value = '#00ff00';
    i.dispatchEvent(new Event('input', { bubbles: true }));
    i.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await p.waitForTimeout(150);
  await setOpt('Colour', '#5c7a44');
  for (const [x, y] of [[300, 1000], [600, 1000], [450, 1250]]) await clickAt(x, y);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(400);
  await p.fill('.modal input[type=text]', 'Mossreach');
  await p.click('.modal .btn-primary');
  await p.waitForTimeout(500);
  const colour = await p.evaluate(() => {
    const l = window.__cg.app.doc.layers.find((x) => x.kind === 'regions');
    return l && l.ops.length ? l.ops[l.ops.length - 1].color : null;
  });
  t('the region colour menu still works after a custom colour was picked', colour === '#5c7a44', colour);

  // Generate land with the seed box emptied: the preview and the land agree.
  await tool('land');
  await p.click('[data-action="generate-land"]');
  await p.waitForTimeout(500);
  await p.fill('[data-gen="seed"]', '');
  await p.waitForTimeout(300);
  const shots = await p.evaluate(async () => {
    const c = document.querySelector('.gen-preview');
    const first = c.toDataURL();
    const i = document.querySelector('[data-gen="seed"]');
    i.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    return { same: first === c.toDataURL(), placeholder: i.placeholder };
  });
  t('with the seed box empty, the preview holds still', shots.same);
  await p.click('.modal .btn-primary');
  await p.waitForTimeout(1500);
  const seed = await p.evaluate(() => {
    const l = window.__cg.app.doc.layers.find((x) => x.kind === 'land');
    const op = l.ops.find((o) => o.gen);
    return op ? op.gen.seed : null;
  });
  t('and Generate draws the seed the preview showed', seed === shots.placeholder,
    seed + ' vs ' + shots.placeholder);
}

{
  // A wall half clicked out on one map, and Enter pressed on the next.
  await newMap(p, { name: 'Regress Carry', kind: 'battle', size: '20x15' });
  await tool('wall');
  await clickAt(140, 140);
  await clickAt(700, 140);
  await newMap(p, { name: 'Regress Carried', kind: 'battle', size: '20x15' });
  await tool('wall');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(300);
  const walls = await p.evaluate(() =>
    window.__cg.app.doc.layers.find((x) => x.kind === 'walls').ops.length);
  t('a wall half drawn on one map does not land on the next one opened', walls === 0, walls + ' walls');

  // The coordinates extension, asked to show its layer on a map without one.
  const shown = await p.evaluate(async () => {
    const cmd = window.__cgx.extensions.commands.find((c) => /coordinates/i.test(c.title));
    if (!cmd) return 'no command';
    cmd.run();
    const l = window.__cg.app.doc.layers.find((x) => x.kind === 'coords');
    return l ? l.visible : 'no layer';
  });
  t('showing grid coordinates on a map without them shows them', shown === true, String(shown));

  // ...and they follow the grid when it changes.
  const moved = await p.evaluate(async () => {
    const R = window.__cg.R;
    const coords = window.__cg.app.doc.layers.find((x) => x.kind === 'coords');
    const grid = window.__cg.app.doc.layers.find((x) => x.kind === 'grid');
    const grab = () => R.canvasFor(coords).toDataURL();
    const before = grab();
    window.__cg.app.activeLayerId = grid.id;
    (await import('/js/app.js')).emit('layers');
    await new Promise((r) => setTimeout(r, 300));
    const f = Array.from(document.querySelectorAll('#layer-props .field'))
      .find((x) => /Cell size|Size/.test(x.textContent) && x.querySelector('input[type=range]'));
    if (!f) return 'no size field';
    const i = f.querySelector('input[type=range]');
    i.value = String(Number(i.value) + 30);
    i.dispatchEvent(new Event('input', { bubbles: true }));
    i.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    return before !== grab();
  });
  t('grid coordinates follow a change of grid size', moved === true, String(moved));
}

/* 2026-09-27 review ------------------------------------------------------- */

{
  await newMap(p, { name: 'Regress Light Wedge', kind: 'battle', size: '40x30' });

  // Rays were cast only at wall ends, so a wall running on past the light's
  // bounding square had no vertex where it met it, and the lit polygon cut
  // straight across: a dark wedge on the light's own side of the wall. The
  // same line drawn short or long must light that side identically.
  const side = (x0, x1) => p.evaluate(([x0, x1]) => {
    const doc = window.__cg.app.doc, R = window.__cg.R;
    const lights = doc.layers.find((l) => l.kind === 'lights');
    const walls = doc.layers.find((l) => l.kind === 'walls');
    lights.ops = [{ id: 'L', t: 'light', x: 1015, y: 665, bright: 280, dim: 560, color: '#ffffff', intensity: 1, cone: 360, angle: 0 }];
    lights.ambient = 0.85; lights.visible = true;
    walls.ops = [{ id: 'W', kind: 'wall', points: [{ x: x0, y: 770 }, { x: x1, y: 770 }] }];
    R.invalidate(walls);
    const d = R.canvasFor(lights).getContext('2d').getImageData(0, 0, doc.width, doc.height).data;
    const out = [];
    for (let y = 600; y < 766; y += 4) for (let x = 400; x < 1640; x += 4) {
      if (Math.hypot(x - 1015, y - 665) > 550) continue;
      out.push(d[(y * doc.width + x) * 4 + 3]);
    }
    return out;
  }, [x0, x1]);
  const short = await side(500, 1530);
  const long = await side(0, 2800);
  let worse = 0;
  for (let i = 0; i < short.length; i++) if (long[i] - short[i] > 10) worse++;
  t('a wall running past a light casts no wedge on the lit side', short.length > 1000 && worse === 0,
    `${worse} of ${short.length} darker`);

  // Two walls crossing in an X, against the same X drawn as four walls that
  // meet in the middle: nothing marked the crossing as a corner.
  const cross = (split) => p.evaluate((split) => {
    const doc = window.__cg.app.doc, R = window.__cg.R;
    const lights = doc.layers.find((l) => l.kind === 'lights');
    const walls = doc.layers.find((l) => l.kind === 'walls');
    lights.ops = [{ id: 'L', t: 'light', x: 900, y: 700, bright: 280, dim: 560, color: '#ffffff', intensity: 1, cone: 360, angle: 0 }];
    const c = { x: 1100, y: 800 };
    const ends = [[{ x: 900, y: 1000 }, { x: 1300, y: 600 }], [{ x: 900, y: 600 }, { x: 1300, y: 1000 }]];
    walls.ops = split
      ? ends.flatMap(([a, b], i) => [{ id: 'a' + i, kind: 'wall', points: [a, c] }, { id: 'b' + i, kind: 'wall', points: [c, b] }])
      : ends.map(([a, b], i) => ({ id: 'w' + i, kind: 'wall', points: [a, b] }));
    R.invalidate(walls);
    return Array.from(R.canvasFor(lights).getContext('2d').getImageData(600, 400, 800, 800).data.filter((_, i) => i % 4 === 3));
  }, split);
  const whole = await cross(false), parts = await cross(true);
  let off = 0;
  for (let i = 0; i < whole.length; i++) if (Math.abs(whole[i] - parts[i]) > 20) off++;
  t('two walls crossing shade the same as four walls meeting', off === 0, off + ' pixels differ');
}

{
  await newMap(p, { name: 'Regress Labels', kind: 'region' });
  // A curved label longer than its curve: every letter past either end was
  // drawn at the end point, on top of the others.
  const piled = await p.evaluate(() => {
    const doc = window.__cg.app.doc, R = window.__cg.R;
    const labels = doc.layers.find((l) => l.kind === 'labels');
    const pts = []; for (let i = 0; i <= 10; i++) pts.push({ x: 800 + i * 15, y: 600 + Math.sin(i / 3) * 10 });
    labels.ops = [{ id: 't1', text: 'The Kingdom of Aldermere', style: 'region', x: 800, y: 600, points: pts }];
    const seen = new Map();
    const orig = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (s, x, y, ...r) {
      const m = this.getTransform();
      const k = Math.round(m.e) + ',' + Math.round(m.f);
      seen.set(k, (seen.get(k) || 0) + 1);
      return orig.call(this, s, x, y, ...r);
    };
    try { R.invalidate(labels); } finally { CanvasRenderingContext2D.prototype.fillText = orig; }
    return Math.max(...seen.values());
  });
  t('a label longer than its curve does not pile letters at the ends', piled === 1, 'most at one spot: ' + piled);

  // Letter spacing counted UTF-16 units, so a name in astral letters (the
  // fraktur people paste in for fantasy names) sat off its anchor.
  const lean = await p.evaluate(() => {
    const doc = window.__cg.app.doc, R = window.__cg.R;
    const labels = doc.layers.find((l) => l.kind === 'labels');
    const name = '\u{1D504}\u{1D529}\u{1D521}\u{1D522}\u{1D52F}\u{1D52A}\u{1D522}\u{1D52F}\u{1D522}';
    labels.ops = [{ id: 't2', text: name, style: 'region', x: 1000, y: 700 }];
    let lo = Infinity, hi = -Infinity;
    const orig = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (s, x, y, ...r) {
      const w = this.measureText(s).width;
      const m = this.getTransform();
      const cx = m.e + m.a * x;
      lo = Math.min(lo, cx - w / 2 * m.a); hi = Math.max(hi, cx + w / 2 * m.a);
      return orig.call(this, s, x, y, ...r);
    };
    try { R.invalidate(labels); } finally { CanvasRenderingContext2D.prototype.fillText = orig; }
    return Math.round((lo + hi) / 2 - 1000);
  });
  t('a spaced name in astral letters is centred on its anchor', Math.abs(lean) <= 2, lean + ' px off');
}

{
  await newMap(p, { name: 'Regress Live Blend', kind: 'region' });
  // A brush set to Multiply previewed as Normal and changed on release.
  await p.evaluate(() => { const t = window.__cg.app.doc.layers.find((l) => l.kind === 'raster'); window.__cg.app.activeLayerId = t.id; });
  await tool('brush');
  await p.click('#asset-picker .asset[title="Deep Ocean"]'); await p.waitForTimeout(150);
  await setOpt('Hardness', 1); await setOpt('Size', 120);
  const s = await Promise.all([[700, 700], [1300, 700], [1000, 500], [1000, 900]].map(([x, y]) => M(x, y)));
  await p.mouse.move(s[0].x, s[0].y); await p.mouse.down(); await p.mouse.move(s[1].x, s[1].y, { steps: 8 }); await p.mouse.up();
  await p.waitForTimeout(600);
  await p.click('#asset-picker .asset[title="Parchment"]'); await p.waitForTimeout(150);
  await p.evaluate(() => {
    const f = Array.from(document.querySelectorAll('#tool-options .field'))
      .find((x) => x.querySelector('label span') && x.querySelector('label span').textContent === 'Blend');
    const i = f.querySelector('select'); i.value = 'multiply'; i.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await p.waitForTimeout(200);
  const flatAt = () => p.evaluate(() => Array.from(window.__cg.R.view.flat.getContext('2d').getImageData(1000, 700, 1, 1).data));
  await p.mouse.move(s[2].x, s[2].y); await p.mouse.down(); await p.mouse.move(s[3].x, s[3].y, { steps: 8 });
  await p.waitForTimeout(400);
  const live = await flatAt();
  await p.mouse.up(); await p.waitForTimeout(700);
  const done = await flatAt();
  const gap = Math.max(...live.map((v, i) => Math.abs(v - done[i])));
  t('a multiply stroke previews as it will commit', gap <= 3, `live ${live} / done ${done}`);
  await p.evaluate(() => {
    const f = Array.from(document.querySelectorAll('#tool-options .field'))
      .find((x) => x.querySelector('label span') && x.querySelector('label span').textContent === 'Blend');
    const i = f.querySelector('select'); i.value = 'source-over'; i.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

{
  await newMap(p, { name: 'Regress Hover', kind: 'battle' });
  // wantsHover was documented and read nowhere: only the Path tool got moves
  // with no button down, so Wall and Region drew no line to the cursor.
  await tool('wall');
  await clickAt(210, 210);
  const to = await M(700, 500);
  await p.mouse.move(to.x, to.y, { steps: 3 }); await p.waitForTimeout(150);
  const hover = await p.evaluate(async () => {
    const { TOOLS } = await import('/js/tools.js');
    return TOOLS.wall.state.hover || null;
  });
  t('the wall tool follows the cursor between clicks', !!hover && Math.abs(hover.x - 700) < 40, JSON.stringify(hover));
  await p.keyboard.press('Escape');
}

{
  await newMap(p, { name: 'Regress Saved Label', kind: 'region' });
  // saveProject rightly leaves the map dirty when it changed mid-save, and the
  // 'saved' handler then wrote "saved" over the label anyway.
  const label = await p.evaluate(async () => {
    const A = await import('/js/app.js');
    const pending = A.saveProject({ silent: true });
    A.app.doc.name = 'Regress Saved Label, renamed';
    A.markDirty();
    await pending;
    return { dirty: A.app.dirty, label: document.getElementById('save-state').textContent };
  });
  t('a save overtaken by an edit does not say "saved"', label.dirty && label.label !== 'saved', JSON.stringify(label));
}

{
  await newMap(p, { name: 'Regress Add Group', kind: 'region' });
  // A new group was inserted inside the run of the group the selection was
  // in, splitting it: the panel then filed the old group's other member under
  // the new one.
  const run = await p.evaluate(async () => {
    const A = await import('/js/app.js'); const U = await import('/js/ui.js');
    const doc = A.app.doc;
    const paint = doc.layers.find((l) => l.kind === 'raster');
    A.app.activeLayerId = paint.id;
    U.addGroup();
    const g1 = doc.layers.find((l) => l.kind === 'group');
    const other = (await import('/js/doc.js')).makeLayer('raster', { name: 'Other paint' });
    doc.layers.splice(doc.layers.indexOf(paint), 0, other);
    other.group = g1.id;
    A.app.activeLayerId = paint.id;
    U.addGroup();
    const ids = doc.layers.map((l) => l.id);
    const members = doc.layers.map((l, i) => (l.group === g1.id || l.id === g1.id) ? i : -1).filter((i) => i >= 0);
    const contiguous = members[members.length - 1] - members[0] === members.length - 1;
    const g2 = doc.layers.find((l) => l.kind === 'group' && l.id !== g1.id);
    return { contiguous, moved: paint.group === g2.id, n: ids.length };
  });
  t('a new group does not split the group it was added from', run.contiguous && run.moved, JSON.stringify(run));
}

{
  await newMap(p, { name: 'Regress Notes List', kind: 'region' });
  // The list in the Layers panel was only rebuilt on 'layers', and neither a
  // Delete, an edit in the Selected panel nor undo emitted it, so the list
  // and the key disagreed -- the one thing the notes design promises cannot
  // happen.
  await p.evaluate(async () => {
    const A = await import('/js/app.js'); const D = await import('/js/doc.js');
    const layer = D.makeLayer('notes', { name: 'Notes' });
    layer.ops = ['Alpha', 'Beta', 'Gamma'].map((title, i) => ({ id: 'n' + i, x: 400 + i * 200, y: 400, title, body: '', color: '#b3372b' }));
    A.app.doc.layers.push(layer);
    A.app.activeLayerId = layer.id;
    window.__cg.R.invalidate(layer);
    A.emit('layers');
  });
  await tool('select');
  await p.click('.note-row[data-note="2"]'); await p.waitForTimeout(200);
  await p.keyboard.press('Delete'); await p.waitForTimeout(300);
  const agree = () => p.evaluate(async () => {
    const D = await import('/js/doc.js');
    const list = Array.from(document.querySelectorAll('.note-row')).map((b) => b.textContent).join('|');
    const key = D.noteKey(window.__cg.app.doc).flatMap((s) => s.entries.map((e) => e.n + e.title)).join('|');
    return { list, key };
  });
  const a = await agree();
  t('the notes list follows a Delete', a.list === a.key, JSON.stringify(a));
  await p.evaluate(async () => { (await import('/js/history.js')).undo(); });
  await p.waitForTimeout(300);
  const b2 = await agree();
  await p.evaluate(async () => { (await import('/js/history.js')).redo(); });
  await p.waitForTimeout(300);
  const b3 = await agree();
  t('...and its undo and redo', b2.list === b2.key && b2.key.includes('Beta') && b3.list === b3.key,
    JSON.stringify([b2, b3]));
}

{
  await newMap(p, { name: 'Regress Tokens', kind: 'battle' });
  // The next token number came from a counter in the module, so undo, a
  // reload or another map left it handing out numbers already on the board.
  const place = async (x, y) => { await clickAt(x, y); await p.waitForTimeout(150); };
  await tool('battle-tokens:place');
  await place(245, 245); await place(385, 245);
  await p.evaluate(async () => { const H = await import('/js/history.js'); H.undo(); H.undo(); });
  await p.waitForTimeout(300);
  await place(525, 245);
  const labels = await p.evaluate(() => {
    const l = window.__cg.app.doc.layers.find((x) => x.kind === 'tokens');
    return l ? l.ops.map((o) => o.label) : null;
  });
  t('a token placed after undoing the others is number 1', JSON.stringify(labels) === '["1"]', JSON.stringify(labels));
}

{
  // EXTENSIONS.md documents `keys`; the shortcut handler read only `shortcut`.
  const ran = await p.evaluate(async () => {
    let n = 0;
    window.__cgx.extensions.commands.push({ id: 'regress:keys', title: 'Regress keys', keys: 'Ctrl+Shift+Q', run: () => { n++; } });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Q', ctrlKey: true, shiftKey: true, bubbles: true }));
    const cmds = window.__cgx.extensions.commands;
    cmds.splice(cmds.findIndex((c) => c.id === 'regress:keys'), 1);
    return n;
  });
  t('an extension command bound with `keys` runs from the keyboard', ran === 1, 'ran ' + ran);
}

{
  await newMap(p, { name: 'Regress Modal', kind: 'region' });
  // modal() replaced an open dialog without settling it, so the Note tool,
  // waiting on its dialog behind a busy flag, never placed another note after
  // Ctrl+E had opened Export over it.
  await p.evaluate(async () => {
    const A = await import('/js/app.js'); const D = await import('/js/doc.js');
    A.app.doc.layers.push(D.makeLayer('notes', { name: 'Notes' }));
    A.emit('layers');
  });
  await tool('note');
  await clickAt(600, 500); await p.waitForSelector('.modal'); await p.waitForTimeout(150);
  await p.keyboard.press('Control+e'); await p.waitForTimeout(400);
  // Cancel by its button, not Escape: the first dialog's Escape listener
  // outlived it and would settle it, hiding the very bug under test.
  await p.click('.modal .foot .btn:has-text("Cancel")'); await p.waitForTimeout(300);
  await clickAt(800, 500);
  const opened = await p.waitForSelector('.modal', { timeout: 2000 }).then(() => true, () => false);
  if (opened) { await p.keyboard.press('Escape'); await p.waitForTimeout(200); }
  t('the note tool still opens its dialog after another dialog replaced it', opened);
}

{
  // A dialog on screen owns the keyboard. The palette opened over the dungeon
  // dialog (it sits above it) and took its focus; Ctrl+Z after ticking one of
  // the dialog's boxes undid a wall behind it, and after a click on the plan a
  // tool letter changed the tool behind it.
  await newMap(p, { name: 'Regress Dialog Keys', kind: 'battle' });
  await tool('wall');
  await clickAt(210, 210); await clickAt(490, 210);
  await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  const wallsBefore = await p.evaluate(() => window.__cg.app.doc.layers.find((l) => l.kind === 'walls').ops.length);
  await p.click('[data-action="generate-dungeon"]');
  await p.waitForSelector('.modal'); await p.waitForTimeout(300);
  await p.keyboard.press('Control+k'); await p.waitForTimeout(250);
  const paletteUp = await p.evaluate(() => !!document.querySelector('.palette-root'));
  t('the palette does not open over a dialog', !paletteUp);
  // Put away if it did, so the checks below measure the keys and not the palette.
  if (paletteUp) { await p.keyboard.press('Control+k'); await p.waitForTimeout(150); }
  await p.click('.modal input[type=checkbox] >> nth=0'); await p.waitForTimeout(150);
  await p.keyboard.press('Control+z'); await p.waitForTimeout(250);
  await p.click('.modal h3'); await p.waitForTimeout(100);
  await p.keyboard.press('s'); await p.waitForTimeout(150);
  const after = await p.evaluate(() => ({
    walls: window.__cg.app.doc.layers.find((l) => l.kind === 'walls').ops.length,
    tool: window.__cg.app.tool,
    open: !!document.querySelector('#modal-root:not([hidden]) .modal'),
  }));
  t('Ctrl+Z inside a dialog does not undo the map behind it',
    wallsBefore === 1 && after.walls === wallsBefore, wallsBefore + ' -> ' + after.walls);
  t('and a tool letter does not change the tool behind it', after.tool === 'wall' && after.open, after.tool);
  await p.click('.modal .foot .btn:has-text("Cancel")'); await p.waitForTimeout(250);
}

{
  // The Select tool's ring was drawn from what it held, not checked against
  // the document: undo the placing of the thing in hand and the ring stayed,
  // marking a spot where nothing was.
  await newMap(p, { name: 'Regress Ghost Ring', kind: 'battle' });
  await tool('light');
  await clickAt(385, 385);
  const strokes = await p.evaluate(async () => {
    const T = await import('/js/tools.js'); const H = await import('/js/history.js');
    const layer = window.__cg.app.doc.layers.find((l) => l.kind === 'lights');
    T.selectObject(layer, layer.ops[0]);
    H.undo();
    let n = 0;
    const spy = new Proxy({}, { get: (_, k) => (k === 'stroke' || k === 'strokeRect' ? () => { n++; } : () => {}),
                                set: () => true });
    T.TOOLS.select.overlay(spy);
    return n;
  });
  t('the Select tool marks nothing once what it held is undone away', strokes === 0, strokes + ' strokes');
}

/* ========================================================================== *
 * 2026-09-29: two readers in parallel again. A dungeon undo that took away
 * more than it added, a paste off the map, a selection that outlived a lock,
 * and keys that reached past the palette or into a text field.
 * ========================================================================== */

{
  await newMap(p, { name: 'Regress Dungeon Layers', kind: 'battle', size: '40x30' });
  const r = await p.evaluate(async () => {
    const D = await import('/js/dungeon.js'); const H = await import('/js/history.js');
    const Doc = await import('/js/doc.js');
    const doc = window.__cg.app.doc;
    D.commitDungeon(D.generateDungeon({ seed: 'later', rooms: 5 }, doc), false);
    // Adding a layer is not an undo step (known); what it holds must still
    // survive the dungeon being undone and redone underneath it.
    const extra = Doc.makeLayer('raster', { name: 'Added later' });
    doc.layers.push(extra);
    H.undo();
    const afterUndo = doc.layers.includes(extra);
    H.redo();
    return { afterUndo, afterRedo: doc.layers.includes(extra) };
  });
  t('undoing a dungeon keeps a layer added after it', r.afterUndo);
  t('and so does redoing it', r.afterRedo);
}

{
  await newMap(p, { name: 'Regress Dungeon Shadows', kind: 'battle', size: '40x30' });
  // No walls layer, so the dungeon adds one; a lamp in the middle of the map.
  await p.evaluate(async () => {
    const A = await import('/js/app.js');
    const doc = window.__cg.app.doc;
    doc.layers = doc.layers.filter((l) => l.kind !== 'walls');
    const lights = doc.layers.find((l) => l.kind === 'lights');
    lights.ops.push({ id: 'o-lamp', x: 1400, y: 1050, bright: 700, dim: 1400, color: '#ffd9a0' });
    lights.ambient = 0.8; lights.visible = true;
    window.__cg.R.invalidate(lights); window.__cg.R.compositeAll();
    A.emit('layers');
  });
  const dark = () => p.evaluate(() => {
    const layer = window.__cg.app.doc.layers.find((l) => l.kind === 'lights');
    const d = window.__cg.R.canvasFor(layer).getContext('2d').getImageData(0, 0, 2800, 2100).data;
    let s = 0; for (let i = 3; i < d.length; i += 4) s += d[i];
    return s;
  });
  const before = await dark();
  await p.evaluate(async () => {
    const D = await import('/js/dungeon.js');
    D.commitDungeon(D.generateDungeon({ seed: 'shadows', rooms: 6 }, window.__cg.app.doc), false);
  });
  const withDungeon = await dark();
  await p.evaluate(async () => { (await import('/js/history.js')).undo(); });
  const after = await dark();
  t('precondition: the dungeon\'s walls cast shadows', withDungeon > before);
  t('undoing a dungeon that added the walls layer takes its shadows away', after === before,
    before + ' / ' + withDungeon + ' / ' + after);
}

{
  await newMap(p, { name: 'Regress Paste Margin', kind: 'battle', size: '40x30' });
  await tool('light');
  await clickAt(315, 315);
  await tool('select');
  await clickAt(315, 315);
  await p.keyboard.press('Control+c');
  // The canvas left of the map: on the canvas, off the document.
  const s = await M(-60, 600);
  await p.mouse.move(s.x, s.y); await p.waitForTimeout(120);
  await p.keyboard.press('Control+v'); await p.waitForTimeout(250);
  const lamps = await p.evaluate(() => window.__cg.app.doc.layers.find((l) => l.kind === 'lights').ops
    .map((o) => [o.x, o.y]));
  t('a paste with the pointer over the margin lands on the map', lamps.length === 2
    && lamps[1][0] >= 0 && lamps[1][1] >= 0, JSON.stringify(lamps));

  // Held before its layer was locked: no longer holdable.
  await clickAt(lamps[0][0], lamps[0][1]);
  await p.evaluate(() => { window.__cg.app.doc.layers.find((l) => l.kind === 'lights').locked = true; });
  await p.keyboard.press('Delete'); await p.waitForTimeout(200);
  const n = await p.evaluate(() => window.__cg.app.doc.layers.find((l) => l.kind === 'lights').ops.length);
  t('Delete does nothing to a thing whose layer was locked after it was picked up', n === 2, n);
  await p.evaluate(() => { window.__cg.app.doc.layers.find((l) => l.kind === 'lights').locked = false; });
}

{
  await newMap(p, { name: 'Regress Label Copy', kind: 'battle' });
  const r = await p.evaluate(async () => {
    const T = await import('/js/tools.js'); const C = await import('/js/clipboard.js');
    const A = await import('/js/app.js'); const Doc = await import('/js/doc.js');
    const doc = window.__cg.app.doc;
    let layer = doc.layers.find((l) => l.kind === 'labels');
    if (!layer) { layer = Doc.makeLayer('labels'); doc.layers.push(layer); A.emit('layers'); }
    layer.ops.push({ id: 't-x', text: 'Gate', style: 'settlement', size: 24, x: 1000, y: 1010 });
    window.__cg.R.invalidate(layer);
    T.selectObject(layer, layer.ops[0]);
    C.duplicateSelection();
    const c = layer.ops[1];
    return [c.x, c.y];
  });
  // The Label tool does not snap, so neither does a copy of a label.
  t('a duplicated label moves one cell and is not pulled onto the grid', r[0] === 1070 && r[1] === 1080,
    r.join(','));
}

{
  await newMap(p, { name: 'Regress Palette Keys', kind: 'battle' });
  await p.mouse.click(5, 500);
  await p.keyboard.press('Control+k'); await p.waitForTimeout(200);
  await p.keyboard.press('Control+e'); await p.waitForTimeout(300);
  const st = await p.evaluate(async () => ({
    modal: (await import('/js/util.js')).modalOpen(),
    palette: !!document.querySelector('.palette-root'),
  }));
  t('Ctrl+E with the palette open does not open Export underneath it', !st.modal, JSON.stringify(st));
  // Put both away without Escape, whose handling is what differs between the
  // fixed and the unfixed tree (see the dialog trap in the hand-off).
  await p.evaluate(async () => (await import('/js/palette.js')).close());
  if (await p.evaluate(async () => (await import('/js/util.js')).modalOpen())) {
    await p.click('.modal .btn:not(.btn-primary)'); await p.waitForTimeout(200);
  }

  const n0 = await p.evaluate(() => window.__cg.history.past.length);
  await p.click('#project-name');
  await p.keyboard.press('Control+Shift+A'); await p.waitForTimeout(300);
  const n1 = await p.evaluate(() => window.__cg.history.past.length);
  t('an extension\'s shortcut typed into a text field stays in the field', n1 === n0, n0 + ' -> ' + n1);
  await p.mouse.click(5, 500);

  await p.evaluate(async () => { await (await import('/js/app.js')).saveProject({ silent: true }); });
  await p.waitForTimeout(400);
  await p.evaluate(async () => {
    const H = await import('/js/history.js');
    while (H.history.past.length) H.history.past.pop();
    const A = await import('/js/app.js'); A.markDirty(false);
  });
  await p.keyboard.press('Control+k'); await p.waitForTimeout(200);
  await p.keyboard.type('start of this session'); await p.waitForTimeout(150);
  await p.keyboard.press('Enter'); await p.waitForTimeout(250);
  const dirty = await p.evaluate(() => window.__cg.app.dirty);
  t('going back to the start with nothing to undo leaves a saved map saved', dirty === false);
}

/* ========================================================================== *
 * 2026-09-30: nine found by review.
 * ========================================================================== */

const drag2 = async (from, to, steps = 10) => {
  const a = await M(...from), z = await M(...to);
  await p.mouse.move(a.x, a.y); await p.mouse.down();
  for (let i = 1; i <= steps; i++) await p.mouse.move(a.x + (z.x - a.x) * i / steps, a.y + (z.y - a.y) * i / steps);
  await p.mouse.up(); await p.waitForTimeout(250);
};
/** How many pixels of the flattened map differ between now and a full
 *  rebuild of every layer from its ops -- what a reload would draw. */
const driftFromRebuild = (decode = []) => p.evaluate(async (ids) => {
  const R = window.__cg.R;
  // A reload decodes every texture the map names before it draws.
  await (await import('/js/assets.js')).warm(ids);
  const grab = () => R.flatten({ scale: 1, grid: false, paper: false }).getContext('2d')
    .getImageData(0, 0, window.__cg.app.doc.width, window.__cg.app.doc.height).data;
  const now = grab();
  R.setDocument(window.__cg.app.doc);
  const then = grab();
  let n = 0;
  for (let i = 0; i < now.length; i += 4) {
    if (Math.abs(now[i] - then[i]) + Math.abs(now[i + 1] - then[i + 1]) + Math.abs(now[i + 2] - then[i + 2]) > 6) n++;
  }
  return n;
}, decode);

{
  // Landmass undo after a coast change. The undo restored a pixel snapshot
  // drawn in the old ink colour; the rest of the map, and a reload, had the new.
  await newMap(p, { name: 'Restyled Shore', kind: 'region' });
  await tool('land');
  await drag2([500, 500], [700, 520]);
  await drag2([650, 480], [860, 560]);
  await p.evaluate(() => {
    const land = window.__cg.app.doc.layers.find((l) => l.kind === 'land');
    land.coast = Object.assign({}, land.coast, { inkColor: '#ff0000' });
    window.__cg.R.repaintLand(land);
  });
  await p.evaluate(async () => (await import('/js/history.js')).undo());
  await p.waitForTimeout(300);
  const n = await driftFromRebuild();
  t('undoing a landmass stroke after changing the ink colour matches a reload', n === 0, n + ' pixels differ');
}

{
  // A texture nothing had decoded yet painted flat grey, while the op saved
  // its name and the reopened map was textured.
  await newMap(p, { name: 'Undecoded Sand', kind: 'region' });
  const fresh = await p.evaluate(async () => {
    const As = await import('/js/assets.js');
    const pick = ['starter/tundra', 'starter/snow', 'starter/ash', 'starter/swamp']
      .find((id) => As.library.byId.has(id) && !As.imageNow(id));
    if (pick) window.__cg.app.settings.activeTexture = pick;
    return pick || null;
  });
  t('(precondition) a texture that nothing has decoded is the active one', !!fresh, fresh);
  await tool('brush');
  await drag2([900, 700], [1200, 760]);
  await p.waitForTimeout(700);
  const n = await driftFromRebuild([fresh]);
  t('a stroke with an undecoded texture is not left flat grey', n === 0, n + ' pixels differ from a reload');
}

{
  // A layer set to Multiply: the live stroke was multiplied on top of the
  // already-multiplied layer, and lightened the moment the button came up.
  await newMap(p, { name: 'Multiplied Ground', kind: 'region' });
  await tool('brush');
  await p.click('#asset-picker .asset[title="Rock"]').catch(() => p.click('#asset-picker .asset'));
  await p.waitForTimeout(300);
  await p.evaluate(() => {
    const layer = window.__cg.app.doc.layers.find((l) => l.kind === 'raster');
    layer.blend = 'multiply';
    window.__cg.R.compositeAll();
  });
  await drag2([700, 700], [1100, 700]);
  const a = await M(800, 690), z = await M(1000, 710);
  await p.mouse.move(a.x, a.y); await p.mouse.down();
  for (let i = 1; i <= 10; i++) await p.mouse.move(a.x + (z.x - a.x) * i / 10, a.y + (z.y - a.y) * i / 10);
  await p.waitForTimeout(150);
  const sample = () => p.evaluate(() => {
    const d = window.__cg.R.view.flat.getContext('2d').getImageData(900, 700, 1, 1).data;
    return [d[0], d[1], d[2]];
  });
  const live = await sample();
  await p.mouse.up(); await p.waitForTimeout(300);
  const done = await sample();
  const diff = Math.abs(live[0] - done[0]) + Math.abs(live[1] - done[1]) + Math.abs(live[2] - done[2]);
  t('a stroke on a Multiply layer previews as it lands', diff <= 6, live.join(',') + ' -> ' + done.join(','));
}

{
  // Ctrl+Z in the middle of dragging a duplicate: a Move was pushed for the
  // copy that was no longer on the map, and the redo of it was thrown away.
  await newMap(p, { name: 'Undone Mid-drag', kind: 'battle' });
  await tool('light');
  await clickAt(385, 385);
  await tool('select');
  await clickAt(385, 385);
  await p.keyboard.press('Control+d'); await p.waitForTimeout(300);
  const copy = await p.evaluate(() => {
    const l = window.__cg.app.doc.layers.find((x) => x.kind === 'lights'); const o = l.ops[1]; return [o.x, o.y];
  });
  const a = await M(copy[0], copy[1]);
  await p.mouse.move(a.x, a.y); await p.mouse.down();
  await p.mouse.move(a.x + 20, a.y + 10); await p.mouse.move(a.x + 40, a.y + 20);
  await p.keyboard.press('Control+z'); await p.waitForTimeout(200);
  await p.mouse.move(a.x + 60, a.y + 30); await p.mouse.up(); await p.waitForTimeout(250);
  const st = await p.evaluate(() => ({
    last: (window.__cg.history.past[window.__cg.history.past.length - 1] || {}).label,
    future: window.__cg.history.future.length,
  }));
  t('undoing a duplicate mid-drag pushes no Move for it and keeps its redo',
    st.last !== 'Move' && st.future >= 1, JSON.stringify(st));
  await p.evaluate(async () => (await import('/js/history.js')).redo());
  await p.waitForTimeout(200);
  const back = await p.evaluate(() => {
    const l = window.__cg.app.doc.layers.find((x) => x.kind === 'lights');
    return l.ops.length === 2 ? [l.ops[1].x, l.ops[1].y] : null;
  });
  t('and the redo puts the copy back where it was duplicated to',
    back && back[0] === copy[0] && back[1] === copy[1], JSON.stringify(back) + ' vs ' + copy.join(','));

  // The palette open with the focus out of its box: Delete removed the thing
  // held behind it.
  await clickAt(385, 385);
  const held0 = await p.evaluate(() => window.__cg.app.doc.layers.find((x) => x.kind === 'lights').ops.length);
  await p.keyboard.press('Control+k'); await p.waitForTimeout(200);
  await p.evaluate(() => document.activeElement && document.activeElement.blur());
  await p.keyboard.press('Delete'); await p.waitForTimeout(200);
  await p.keyboard.press('w'); await p.waitForTimeout(150);
  const st2 = await p.evaluate(() => ({
    n: window.__cg.app.doc.layers.find((x) => x.kind === 'lights').ops.length, tool: window.__cg.app.tool,
  }));
  t('with the palette open, Delete and tool letters do not reach the map', st2.n === held0 && st2.tool === 'select',
    JSON.stringify(st2));
  await p.evaluate(async () => (await import('/js/palette.js')).close());

  // Escape that closes a dialog also threw away the wall half drawn behind it.
  await tool('wall');
  await clickAt(140, 140); await clickAt(420, 140);
  await p.evaluate(async () => { (await import('/js/dungeon.js')).dungeonDialog(); });
  await p.waitForTimeout(400);
  await p.evaluate(() => document.activeElement && document.activeElement.blur());
  await p.keyboard.press('Escape'); await p.waitForTimeout(250);
  const st3 = await p.evaluate(async () => ({
    modal: (await import('/js/util.js')).modalOpen(),
    points: (await import('/js/tools.js')).TOOLS.wall.state.points.length,
  }));
  t('Escape closes the dialog and leaves the wall being drawn alone', !st3.modal && st3.points === 2,
    JSON.stringify(st3));
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
}

{
  // Autosave was a debounce: every edit restarted the clock, so steady work
  // was never saved. Each call now keeps a deadline that is already set.
  const armed = await p.evaluate(async () => {
    const A = await import('/js/app.js');
    const was = window.__cg.app.settings.autosave;
    window.__cg.app.settings.autosave = true;
    const real = window.setTimeout;
    let n = 0;
    window.setTimeout = (fn, ms, ...rest) => { if (ms >= 15000) n++; return real(fn, ms, ...rest); };
    try { A.scheduleAutosave(); A.scheduleAutosave(); A.scheduleAutosave(); } finally { window.setTimeout = real; }
    window.__cg.app.settings.autosave = was;
    return n;
  });
  t('autosave keeps its deadline rather than restarting it on every edit', armed <= 1, armed + ' timers started');
}

{
  // A layer with no ops list is readable JSON the server passes through; it
  // threw out of setDocument after app.doc had already switched.
  const r = await p.evaluate(async () => {
    const A = await import('/js/app.js');
    const doc = { format: 1, kind: 'region', name: 'Opsless', width: 512, height: 512,
      scale: { unit: 'mi', perCell: 10, cellPx: 96 }, snap: 'off', view: { x: 0, y: 0, zoom: 0 },
      layers: [{ id: 'l-p', kind: 'paper', name: 'Paper', visible: true, opacity: 1 },
               { id: 'l-n', kind: 'notes', name: 'Notes', visible: true, opacity: 1 }] };
    try { await A.openDocument(doc, null); } catch (err) { return 'threw: ' + err.message; }
    return window.__cg.app.doc.layers.every((l) => Array.isArray(l.ops)) ? 'ok' : 'no ops';
  });
  t('a map with a layer missing its ops list opens', r === 'ok', r);
}

/* ==========================================================================
 * 2026-10-01
 * ========================================================================== */

{
  // Undoing a landmass stroke after the shelf was narrowed: the snapshot put
  // back pixels drawn under the old, wide shelf, and the repaint that follows
  // cleared only as far as the new narrow one reaches -- a band of the old
  // shelf left round the coast that a reload does not draw.
  await newMap(p, { name: 'Narrowed Shelf', kind: 'region' });
  const layerVsRebuild = () => p.evaluate(() => {
    const { app, R } = window.__cg; const l = app.doc.layers.find((x) => x.kind === 'land');
    const c = R.canvasFor(l);
    const a = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    R.rebuildLayer(l);
    const z = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < a.length; i += 4) {
      if (Math.abs(a[i] - z[i]) > 2 || Math.abs(a[i + 1] - z[i + 1]) > 2
          || Math.abs(a[i + 2] - z[i + 2]) > 2 || Math.abs(a[i + 3] - z[i + 3]) > 2) n++;
    }
    R.compositeAll(); return n;
  });
  const shelf = (f) => p.evaluate((fields) => {
    const l = window.__cg.app.doc.layers.find((x) => x.kind === 'land');
    Object.assign(l.coast, fields); window.__cg.R.repaintLand(l);
  }, f);
  const stroke = async (pts) => {
    const s0 = await M(...pts[0]); await p.mouse.move(s0.x, s0.y); await p.mouse.down();
    for (const q of pts.slice(1)) { const s = await M(...q); await p.mouse.move(s.x, s.y, { steps: 6 }); }
    await p.mouse.up(); await p.waitForTimeout(300);
  };
  await shelf({ shallow: true, shallowWidth: 120 });
  await tool('land');
  await stroke([[600, 600], [800, 650]]);
  await stroke([[1000, 700], [1100, 720]]);
  await shelf({ shallowWidth: 4 });
  await p.evaluate(async () => (await import('/js/history.js')).undo());
  await p.waitForTimeout(300);
  const off = await layerVsRebuild();
  t('undoing a land stroke after narrowing the shelf leaves no band of the old shelf', off === 0, off + ' px off a rebuild');
}

{
  // Paste and duplicate snapped the lead thing in a set and moved the rest by
  // the same amount, which keeps the rest on the grid only if the lead was on
  // it: a light Alt-placed off a cell centre carried a copied wall half a
  // cell off the lines.
  await newMap(p, { name: 'Off-centre Lamp', kind: 'battle', size: '40x30' });
  await p.evaluate(async () => {
    const D = await import('/js/doc.js');
    const A = await import('/js/app.js');
    const doc = window.__cg.app.doc;
    if (!doc.layers.some((l) => l.kind === 'lights')) doc.layers.push(D.makeLayer('lights'));
    doc.layers.find((l) => l.kind === 'lights').ops.push({ id: 'o-alt', x: 700, y: 560, bright: 140, dim: 280, color: '#ffd28a', cone: 360, angle: 0 });
    doc.layers.find((l) => l.kind === 'walls').ops.push({ id: 'w-alt', kind: 'wall', points: [{ x: 560, y: 700 }, { x: 840, y: 700 }] });
    for (const l of doc.layers) window.__cg.R.invalidate(l);
    A.emit('layers');
  });
  await tool('select');
  await p.evaluate(async () => {
    const T = await import('/js/tools.js');
    const doc = window.__cg.app.doc;
    const lamp = doc.layers.find((l) => l.kind === 'lights');
    const walls = doc.layers.find((l) => l.kind === 'walls');
    // The lamp first, so it is the thing the old code snapped.
    T.selectObjects([{ layer: lamp, item: lamp.ops[0] }, { layer: walls, item: walls.ops[0] }]);
  });
  await p.keyboard.press('Control+d'); await p.waitForTimeout(300);
  const copy = await p.evaluate(() => window.__cg.app.doc.layers.find((l) => l.kind === 'walls').ops[1]);
  t('a set duplicated with an off-centre lamp in the lead keeps its wall on the grid lines',
    copy && copy.points.every((q) => q.x % 70 === 0 && q.y % 70 === 0), copy && JSON.stringify(copy.points));

  // On a hex map a corner moved onto a different kind of corner is not a move
  // of the grid onto itself, and half of a duplicated path came off it.
  await newMap(p, { name: 'Hex Duplicates', kind: 'hex' });
  const worst = await p.evaluate(async () => {
    const D = await import('/js/doc.js');
    const H = await import('/js/hex.js');
    const A = await import('/js/app.js');
    const T = await import('/js/tools.js');
    const C = await import('/js/clipboard.js');
    const doc = window.__cg.app.doc;
    if (!doc.layers.some((l) => l.kind === 'paths')) doc.layers.push(D.makeLayer('paths'));
    const paths = doc.layers.find((l) => l.kind === 'paths');
    paths.ops.push({ id: 'p-hex', style: 'road', width: 6, color: '#8a6a44',
      points: H.corners(D.gridLayer(doc), 3, 3).slice(0, 4).map((q) => ({ x: q.x, y: q.y })) });
    A.emit('layers');
    T.setTool('select');
    let w = 0;
    for (let i = 0; i < 3; i++) {
      T.selectObjects([{ layer: paths, item: paths.ops[paths.ops.length - 1] }]);
      C.duplicateSelection();
    }
    for (const op of paths.ops) for (const q of op.points) {
      const s = D.snapPoint({ ...doc, snap: 'grid' }, q, 'corner');
      w = Math.max(w, Math.hypot(s.x - q.x, s.y - q.y));
    }
    return w;
  });
  t('a path duplicated three times on a hex map stays on hex corners', worst < 1e-6, worst);
}

{
  // A Move entry restored whole snapshots taken when the drag began. Ctrl+Z
  // mid-drag could undo an edit made to the thing being dragged, and undoing
  // the Move then put the undone edit back with no step left to remove it.
  await newMap(p, { name: 'Edited Mid-drag', kind: 'battle', size: '40x30' });
  await tool('light');
  await clickAt(735, 595);
  await tool('select');
  await clickAt(735, 595);
  await p.evaluate(() => {
    const lab = [...document.querySelectorAll('#selection-props label')].find((l) => /Lit/.test(l.textContent));
    lab.querySelector('input').click();
  });
  await p.waitForTimeout(200);
  const lit = () => p.evaluate(() => window.__cg.app.doc.layers.find((l) => l.kind === 'lights').ops[0].on !== false);
  const pre = !(await lit());
  const a = await M(735, 595), z = await M(875, 595);
  await p.mouse.move(a.x, a.y); await p.mouse.down();
  await p.mouse.move(a.x + 30, a.y, { steps: 3 });
  await p.keyboard.press('Control+z'); await p.waitForTimeout(200);
  await p.mouse.move(z.x, z.y, { steps: 3 }); await p.mouse.up(); await p.waitForTimeout(250);
  await p.keyboard.press('Control+z'); await p.waitForTimeout(250);
  const st = await p.evaluate(() => {
    const o = window.__cg.app.doc.layers.find((l) => l.kind === 'lights').ops[0];
    return { x: o.x, on: o.on };
  });
  t('precondition: unticking Lit put the light out', pre);
  t('undoing a move does not bring back an edit undone during the drag', st.on !== false && st.x === 735,
    JSON.stringify(st));
}

{
  // A save of a map not yet on disk wrote its new slug onto whichever map was
  // open when the reply came back; that map's next save then overwrote the
  // new one's folder. And two saves at once created two folders.
  const tag = 'R' + Date.now().toString(36);
  const made = [];
  try {
    await newMap(p, { name: 'Race B ' + tag, kind: 'region' });
    const bslug = await p.evaluate(async () => (await import('/js/app.js')).saveProject({ silent: true }));
    made.push(bslug);
    await newMap(p, { name: 'Race A ' + tag, kind: 'region' });
    await p.route('**/api/projects', async (route) => {
      if (route.request().method() === 'POST') await new Promise((r) => setTimeout(r, 1200));
      await route.continue();
    });
    await p.evaluate(() => { import('/js/app.js').then((A) => { window.__raceSave = A.saveProject({ silent: true }); }); });
    await p.waitForTimeout(150);
    await p.evaluate(async (s) => (await import('/js/tabs.js')).openProject(s), bslug);
    const aslug = await p.evaluate(() => window.__raceSave);
    await p.unroute('**/api/projects');
    made.push(aslug);
    const open = await p.evaluate(() => ({ slug: window.__cg.app.slug, name: window.__cg.app.doc.name }));
    t('a save still in flight when another map is opened does not rename the map opened',
      open.slug === bslug && open.name === 'Race B ' + tag, JSON.stringify(open));
    await p.evaluate(async () => (await import('/js/app.js')).saveProject({ silent: true }));
    const onDisk = await p.evaluate(async (s) => (await (await fetch('/api/projects/' + encodeURIComponent(s))).json()), aslug);
    const docA = onDisk.project || onDisk.doc || onDisk;
    t('and saving the opened map leaves the new one\'s folder holding the new one',
      docA && docA.name === 'Race A ' + tag, docA && docA.name);

    await newMap(p, { name: 'Twice ' + tag, kind: 'region' });
    const both = await p.evaluate(async () => {
      const A = await import('/js/app.js');
      return Promise.all([A.saveProject({ silent: true }), A.saveProject({ silent: true })]);
    });
    made.push(...both);
    const list = await p.evaluate(async () => (await (await fetch('/api/projects')).json()).projects.map((x) => x.slug));
    const twins = list.filter((s) => s.startsWith('Twice ' + tag));
    t('two saves at once of a new map make one folder, not two', twins.length === 1 && both[0] === both[1],
      JSON.stringify(twins));
  } finally {
    await p.unroute('**/api/projects').catch(() => {});
    await p.evaluate(async (slugs) => {
      for (const s of new Set(slugs)) if (s) await fetch('/api/projects/' + encodeURIComponent(s), { method: 'DELETE' });
    }, made);
    await newMap(p, { name: 'After the Race', kind: 'region' });
  }
}

{
  // Turning an extension on and then off before its import had finished left
  // it running; two ons at once registered everything twice, and the first
  // set could never be taken out.
  const st = await p.evaluate(async () => {
    const E = await import('/js/extensions.js');
    const count = () => E.extensions.commands.filter((c) => c.extension === 'map-aging').length;
    await E.setExtensionEnabled('map-aging', true);
    const n0 = count();
    await Promise.all([E.setExtensionEnabled('map-aging', true), E.setExtensionEnabled('map-aging', false)]);
    const offAfterRace = { loaded: E.extensions.loaded.has('map-aging'), n: count() };
    await Promise.all([E.setExtensionEnabled('map-aging', true), E.setExtensionEnabled('map-aging', true)]);
    const twiceOn = count();
    await E.setExtensionEnabled('map-aging', false);
    const offAfter = count();
    await E.setExtensionEnabled('map-aging', true);
    return { n0, offAfterRace, twiceOn, offAfter };
  });
  t('an extension turned on then off at once ends up off', !st.offAfterRace.loaded && st.offAfterRace.n === 0,
    JSON.stringify(st));
  t('and one turned on twice at once registers its commands once, and all of them go when it is turned off',
    st.n0 > 0 && st.twiceOn === st.n0 && st.offAfter === 0, JSON.stringify(st));
}

{
  // Two extension folders with one id -- what copying a folder to change it
  // gives you -- both started, and the second overwrote the record of what
  // the first had registered, so turning it off left the first's commands in
  // the palette for good.
  const dup = fileURLToPath(new URL('../extensions/zz-guard-dup-aging', import.meta.url));
  cpSync(fileURLToPath(new URL('../extensions/map-aging', import.meta.url)), dup, { recursive: true });
  try {
    const st = await p.evaluate(async () => {
      const E = await import('/js/extensions.js');
      await E.loadExtensions();
      const copy = E.extensions.list.find((m) => m.dir === 'zz-guard-dup-aging');
      const n = E.extensions.commands.filter((c) => c.extension === 'map-aging').length;
      await E.setExtensionEnabled('map-aging', false);
      const left = E.extensions.commands.filter((c) => c.extension === 'map-aging').length;
      await E.setExtensionEnabled('map-aging', true);
      return { error: copy && copy.error, n, left };
    });
    t('a second extension folder with the same id is refused with a message', !!st.error && /already uses/.test(st.error),
      JSON.stringify(st));
    t('and turning the id off takes every one of its commands out', st.left === 0 && st.n > 0, JSON.stringify(st));
  } finally {
    rmSync(dup, { recursive: true, force: true });
    await p.evaluate(async () => (await import('/js/extensions.js')).loadExtensions());
  }
}

/* 2026-10-04 ------------------------------------------------------------- */

{
  // Turning autosave off left a deadline already set to fire, and it saved
  // over the map anyway. The callback is caught and run by hand here, so the
  // check does not wait fifteen seconds.
  await newMap(p, { name: 'Autosave Off', kind: 'battle', size: '20x15' });
  const st = await p.evaluate(async () => {
    const A = await import('/js/app.js');
    const s = window.__cg.app.settings;
    const was = s.autosave;
    s.autosave = true;
    A.markDirty();
    const real = window.setTimeout, realFetch = window.fetch;
    let fire = null, saves = 0;
    window.setTimeout = (fn, ms, ...rest) => { if (ms >= 15000) { fire = fn; return 0; } return real(fn, ms, ...rest); };
    try {
      // A deadline left from earlier in the session would swallow this one.
      s.autosave = false; A.scheduleAutosave(); s.autosave = true;
      A.scheduleAutosave();
    } finally { window.setTimeout = real; }
    s.autosave = false;
    window.fetch = (url, init) => { if (/\/api\/projects/.test(String(url)) && init && init.method !== 'GET') saves++; return realFetch(url, init); };
    try { if (fire) await fire(); } finally { window.fetch = realFetch; }
    s.autosave = was;
    return { armed: !!fire, saves, dirty: !!window.__cg.app.dirty };
  });
  t('an autosave already due does not save once autosave is turned off', st.armed && st.saves === 0 && st.dirty,
    JSON.stringify(st));
}

{
  // A tool letter pressed with the button down handed the release to the new
  // tool: a Select drag moved the wall with no undo entry and no dirty flag.
  await newMap(p, { name: 'Letter Mid Drag', kind: 'battle', size: '20x15' });
  await p.evaluate(() => {
    const { app, R } = window.__cg;
    const l = app.doc.layers.find((x) => x.kind === 'walls');
    l.ops = [{ id: 'wmid', kind: 'wall', points: [{ x: 210, y: 210 }, { x: 560, y: 210 }] }];
    R.invalidate(l);
    app.dirty = false;
  });
  await p.click('.tool[data-tool="select"]'); await p.waitForTimeout(200);
  const at = (x, y) => p.evaluate(([mx, my]) => {
    const s = window.__cg.mapToScreen(mx, my);
    const r = document.getElementById('canvas').getBoundingClientRect();
    return { x: r.left + s.x, y: r.top + s.y };
  }, [x, y]);
  const past0 = await p.evaluate(() => window.__cg.history.past.length);
  const a = await at(210, 210), z = await at(210, 420);
  await p.mouse.move(a.x, a.y); await p.mouse.down();
  for (let i = 1; i <= 4; i++) await p.mouse.move(a.x, a.y + (z.y - a.y) * i / 8);
  await p.keyboard.press('b');
  for (let i = 5; i <= 8; i++) await p.mouse.move(a.x, a.y + (z.y - a.y) * i / 8);
  await p.mouse.up(); await p.waitForTimeout(250);
  const st = await p.evaluate(async () => {
    const { app } = window.__cg;
    const T = await import('/js/tools.js');
    const w = app.doc.layers.find((x) => x.kind === 'walls').ops[0];
    return { tool: T.currentTool().id, y: w.points[0].y, dirty: !!app.dirty,
             past: window.__cg.history.past.length, label: (window.__cg.history.past.slice(-1)[0] || {}).label };
  });
  t('a tool letter pressed mid-drag waits, and the drag lands as one Move entry',
    st.tool === 'select' && st.y !== 210 && st.dirty && st.past === past0 + 1 && st.label === 'Move', JSON.stringify(st));
}

{
  // Dragging a group row moved the group alone and left its members where
  // they were, filed under a folder that was no longer beside them.
  await newMap(p, { name: 'Group Drag', kind: 'battle', size: '20x15' });
  const st = await p.evaluate(async () => {
    const { app } = window.__cg;
    const ui = await import('/js/ui.js');
    const terrain = app.doc.layers.find((l) => l.kind === 'raster');
    const g = ui.addGroup();
    ui.setLayerGroup(terrain, g.id);
    return { g: g.id, top: app.doc.layers[app.doc.layers.length - 1].id };
  });
  // Drop the group's row on the top layer's row, as a person drags it.
  await p.dragAndDrop(`.layer[data-id="${st.g}"]`, `.layer[data-id="${st.top}"]`);
  await p.waitForTimeout(250);
  const after = await p.evaluate((gid) => {
    const L = window.__cg.app.doc.layers;
    const gi = L.findIndex((l) => l.id === gid);
    const members = L.map((l, i) => (l.group === gid ? i : -1)).filter((i) => i >= 0);
    return { gi, members, n: L.length };
  }, st.g);
  t('dragging a group takes its members with it, still directly under it',
    after.members.length === 1 && after.members[0] === after.gi - 1 && after.gi > after.n - 4, JSON.stringify(after));
}

t('no console errors', errs.length === 0, errs.slice(0, 3).join(' | '));

for (const [status, name, note] of out) {
  console.log(status.padEnd(5), name, note ? ' [' + note + ']' : '');
}
console.log(`\n${out.length - fails}/${out.length} passed`);
await b.close();
process.exit(fails ? 1 : 0);
