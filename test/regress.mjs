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

t('no console errors', errs.length === 0, errs.slice(0, 3).join(' | '));

for (const [status, name, note] of out) {
  console.log(status.padEnd(5), name, note ? ' [' + note + ']' : '');
}
console.log(`\n${out.length - fails}/${out.length} passed`);
await b.close();
process.exit(fails ? 1 : 0);
