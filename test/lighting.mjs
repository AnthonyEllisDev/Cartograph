/* Lighting: darkness, light sources, shadows cast by walls, and the lights
 * travelling into the Universal VTT export.
 *
 * Start the server first:  python3 app.py --no-browser --port 7871
 * Then:                    node test/lighting.mjs [http://127.0.0.1:7871]
 *
 * The shadow checks all work the same way: measure one pixel, change one wall,
 * measure the same pixel again. Comparing a point against itself cancels the
 * floor texture out, so what is left is the shadow and nothing else.
 */

import { launch, base, ready } from './browser.mjs';

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

/* helpers -------------------------------------------------------------- */

const M = (mx, my) => p.evaluate(([x, y]) => {
  const s = window.__cg.mapToScreen(x, y);
  const r = document.getElementById('canvas').getBoundingClientRect();
  return { x: r.left + s.x, y: r.top + s.y };
}, [mx, my]);
const clickAt = async (x, y) => { const s = await M(x, y); await p.mouse.click(s.x, s.y); await p.waitForTimeout(110); };
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
const lightLayer = () => p.evaluate(() => {
  const l = window.__cg.app.doc.layers.find((x) => x.kind === 'lights');
  return l && { ambient: l.ambient, n: l.ops.length, visible: l.visible, shadows: l.shadows };
});

/** Brightness of one pixel of the flattened map, 0–255. Grid and paper are
 *  left out so nothing but the lighting is being measured. */
const brightnessAt = (x, y) => p.evaluate(([px, py]) => {
  const c = window.__cg.R.flatten({ scale: 1, grid: false, paper: false });
  const d = c.getContext('2d').getImageData(px, py, 1, 1).data;
  return (d[0] + d[1] + d[2]) / 3;
}, [x, y]);

/* a battle map, made through the real dialog ---------------------------- */

await p.click('.tab[data-tab="projects"]');
await p.waitForTimeout(300);
await p.click('#btn-new-project');
await p.waitForTimeout(400);
await p.fill('.modal input[type=text]', 'The Long Dark');
await p.selectOption('.modal select >> nth=0', 'battle');
await p.waitForTimeout(220);
await p.selectOption('.modal select >> nth=1', '30x20');
await p.click('.modal .btn-primary');
await p.waitForTimeout(1100);

const layers = await p.evaluate(() => window.__cg.app.doc.layers.map((l) => l.kind));
t('a battle map comes with a lighting layer', layers.includes('lights'), layers.join(', '));
t('it sits above the walls and below the grid',
  layers.indexOf('lights') > layers.indexOf('walls') && layers.indexOf('lights') < layers.indexOf('grid'));

// Starting dark would be a nasty surprise, so it starts off and the tool
// turns it on.
const fresh = await lightLayer();
t('the darkness starts off', fresh.ambient === 0, 'ambient ' + fresh.ambient);

/* the tool ---------------------------------------------------------------- */

await tool('light');
const opts = await p.evaluate(() => Array.from(
  document.querySelectorAll('#tool-options .field label span')).map((s) => s.textContent));
t('the light tool has its options', ['Source', 'Bright', 'Dim', 'Colour', 'Intensity', 'Spread']
  .every((o) => opts.includes(o)), opts.join(', '));

await setOpt('Source', 'torch');
await clickAt(6 * 70, 6 * 70);
const placed = await lightLayer();
t('clicking drops a light', placed.n === 1, placed.n + ' lights');
t('the first light turns the night on', placed.ambient > 0, 'ambient ' + placed.ambient);

// Radii are set in the map's own units, so a torch really is 20/40 feet.
const first = await p.evaluate(() => {
  const d = window.__cg.app.doc;
  const o = d.layers.find((l) => l.kind === 'lights').ops[0];
  return { bright: o.bright, dim: o.dim, cell: d.scale.cellPx, perCell: d.scale.perCell, color: o.color };
});
t('a torch is 20 feet bright and 40 dim, in map units',
  first.bright === (20 / first.perCell) * first.cell && first.dim === (40 / first.perCell) * first.cell,
  `${first.bright} / ${first.dim} px at ${first.cell}px per ${first.perCell}ft`);

await p.keyboard.press('Control+z');
await p.waitForTimeout(400);
const undone = await lightLayer();
t('undo removes the light and the night with it',
  undone.n === 0 && undone.ambient === 0, `${undone.n} lights, ambient ${undone.ambient}`);
await p.keyboard.press('Control+Shift+z');
await p.waitForTimeout(400);
t('redo puts both back', (await lightLayer()).n === 1);

/* shadows ----------------------------------------------------------------- */

/* One light, one wall, one probe. The wall is vertical at x = 700 spanning
   y = 600..800; the light sits to its left and the probe directly behind it. */
const SETUP = `
  const doc = window.__cg.app.doc, R = window.__cg.R;
  const lights = doc.layers.find(l => l.kind === 'lights');
  const walls  = doc.layers.find(l => l.kind === 'walls');
  lights.ops = [{ id: 'probe-light', t: 'light', x: 500, y: 700,
                  bright: 300, dim: 650, color: '#ffffff', intensity: 1, cone: 360, angle: 0 }];
  lights.ambient = 0.85; lights.shadows = true; lights.visible = true;
  walls.ops = [];
`;
const setup = (extra) => p.evaluate(new Function(SETUP + extra + `
  R.rebuildLayer(walls); R.rebuildLayer(lights); R.compositeAll(); R.requestDraw();`));

const BEHIND = [900, 700];     // straight through the wall from the light
const BESIDE = [900, 300];     // as far from the light, but clear of the wall

await setup('');
const openBehind = await brightnessAt(...BEHIND);
const openBeside = await brightnessAt(...BESIDE);

await setup(`walls.ops = [{ id:'w', kind:'wall', points:[{x:700,y:600},{x:700,y:800}] }];`);
const shadowed = await brightnessAt(...BEHIND);
const stillLit = await brightnessAt(...BESIDE);

t('a wall casts a shadow', shadowed < openBehind - 25,
  `${openBehind.toFixed(0)} lit, ${shadowed.toFixed(0)} behind the wall`);
t('and only behind itself', Math.abs(stillLit - openBeside) < 6,
  `${openBeside.toFixed(0)} then ${stillLit.toFixed(0)} beside it`);

// A window is a wall you can see through, and WALL_KINDS already says so.
await setup(`walls.ops = [{ id:'w', kind:'window', points:[{x:700,y:600},{x:700,y:800}] }];`);
const throughGlass = await brightnessAt(...BEHIND);
t('a window lets the light through', Math.abs(throughGlass - openBehind) < 6,
  `${throughGlass.toFixed(0)} vs ${openBehind.toFixed(0)} with no wall`);

// A door is shut until someone opens it, so it blocks like a wall.
await setup(`walls.ops = [{ id:'w', kind:'door', points:[{x:700,y:600},{x:700,y:800}] }];`);
t('a closed door does not', (await brightnessAt(...BEHIND)) < openBehind - 25);

// Turning shadows off is the "I just want a glow" switch.
await setup(`walls.ops = [{ id:'w', kind:'wall', points:[{x:700,y:600},{x:700,y:800}] }];
             lights.shadows = false;`);
t('shadows can be turned off', Math.abs((await brightnessAt(...BEHIND)) - openBehind) < 6);

// Moving a wall has to move its shadow, or light leaks through a wall that is
// no longer there. This is the one that only works because invalidate() knows.
await setup(`walls.ops = [{ id:'w', kind:'wall', points:[{x:700,y:600},{x:700,y:800}] }];`);
await p.evaluate(() => {
  const doc = window.__cg.app.doc;
  const walls = doc.layers.find((l) => l.kind === 'walls');
  for (const pt of walls.ops[0].points) pt.y -= 500;      // slide it clear of the probe
  window.__cg.R.invalidate(walls);
});
await p.waitForTimeout(250);
t('moving a wall moves its shadow', Math.abs((await brightnessAt(...BEHIND)) - openBehind) < 6,
  'invalidating the walls must relight the map');

/* directional lights ------------------------------------------------------ */

await setup(`lights.ops[0].cone = 60; lights.ops[0].angle = 0;`);
const facing = await brightnessAt(900, 700);          // dead ahead
const aside = await brightnessAt(500, 300);           // ninety degrees off
t('a shuttered light lights what it faces', facing > openBehind - 6, facing.toFixed(0));
t('and not what it does not', aside < facing - 40, aside.toFixed(0));

/* the export -------------------------------------------------------------- */

await setup(`walls.ops = [{ id:'w', kind:'wall', points:[{x:700,y:600},{x:700,y:800}] }];`);
const uvtt = await p.evaluate(() => {
  const c = window.__cg.R.flatten({ scale: 1, grid: true, paper: true, lights: false });
  return window.__cg.R.toUVTT(c.toDataURL('image/png'), { bakedLighting: false });
});
t('the tabletop file carries the lights', uvtt.lights.length === 1, uvtt.lights.length + ' lights');
const L = uvtt.lights[0];
t('its position is in grid cells',
  Math.abs(L.position.x - 500 / 70) < 0.001 && Math.abs(L.position.y - 700 / 70) < 0.001,
  JSON.stringify(L.position));
t('its range is in grid cells too', Math.abs(L.range - 650 / 70) < 0.001, L.range);
t('its colour is eight hex digits, alpha first', /^[0-9a-f]{8}$/.test(L.color) && L.color === 'ffffffff', L.color);
t('it says the walls cast shadows', L.shadows === true);
t('and that the image is not already lit', uvtt.environment.baked_lighting === false);
t('the unlit ambient is darkened to match',
  /^ff[0-9a-f]{6}$/.test(uvtt.environment.ambient_light) && uvtt.environment.ambient_light !== 'ffffffff',
  uvtt.environment.ambient_light);

// Without the flag it behaves exactly as it always did, so an old map exports
// the same file it used to.
const plain = await p.evaluate(() => {
  const doc = window.__cg.app.doc;
  const lit = doc.layers.find((l) => l.kind === 'lights');
  const was = lit.ambient; lit.ambient = 0;
  const c = window.__cg.R.flatten({ scale: 1, grid: true, paper: true });
  const u = window.__cg.R.toUVTT(c.toDataURL('image/png'));
  lit.ambient = was; window.__cg.R.rebuildLayer(lit); window.__cg.R.compositeAll();
  return u.environment;
});
t('an unlit map exports the environment it always did',
  plain.baked_lighting === true && plain.ambient_light === 'ffffffff', JSON.stringify(plain));

// Exporting the picture without the darkness is what stops a tabletop lighting
// an already-lit map and washing it out.
const litPx = await brightnessAt(...BEHIND);
const unlitExport = await p.evaluate(([px, py]) => {
  const c = window.__cg.R.flatten({ scale: 1, grid: false, paper: false, lights: false });
  const d = c.getContext('2d').getImageData(px, py, 1, 1).data;
  return (d[0] + d[1] + d[2]) / 3;
}, BEHIND);
t('the image can be flattened without the lighting', unlitExport > litPx + 25,
  `${litPx.toFixed(0)} lit, ${unlitExport.toFixed(0)} without`);

/* selecting and deleting -------------------------------------------------- */

await setup('');
await p.waitForTimeout(200);
await tool('select');
await clickAt(500, 700);
const grabbed = await p.evaluate(() => {
  const s = window.__cg.app.doc.layers.find((l) => l.kind === 'lights');
  return s.ops.length;
});
await p.keyboard.press('Delete');
await p.waitForTimeout(300);
const afterDelete = (await lightLayer()).n;
t('a light can be selected and deleted', grabbed === 1 && afterDelete === 0,
  `${grabbed} before, ${afterDelete} after`);

/* it has to survive being put away ---------------------------------------- */

await setup(`walls.ops = [{ id:'w', kind:'wall', points:[{x:700,y:600},{x:700,y:800}] }];`);
await p.waitForTimeout(300);
const fingerprint = () => p.evaluate(() => {
  const c = window.__cg.R.flatten({ scale: 1, grid: true, paper: true });
  const s = document.createElement('canvas'); s.width = 64; s.height = 64;
  const x = s.getContext('2d'); x.drawImage(c, 0, 0, 64, 64);
  return Array.from(x.getImageData(0, 0, 64, 64).data).join(',');
});
const before = await fingerprint();
await p.click('#btn-save');
await p.waitForTimeout(1500);
await p.reload({ waitUntil: 'networkidle' });
await ready(p);
t('a lit map reloads pixel-identical', before === (await fingerprint()));

await p.screenshot({ path: '/tmp/cg_lighting.png' });
t('no console errors', errs.length === 0, errs.slice(0, 3).join(' | '));

for (const [status, name, note] of out) {
  console.log(status.padEnd(5), name, note ? ' [' + note + ']' : '');
}
console.log(`\n${out.length - fails}/${out.length} passed`);
await b.close();
process.exit(fails ? 1 : 0);
