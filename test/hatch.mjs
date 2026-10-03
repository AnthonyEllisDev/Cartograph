/* Hatching the rock around the walls.
 *
 * A walls layer can hatch the outside of its walls, in the manner of the old
 * hand-drawn dungeon plan. Which side is outside is worked out from the walls
 * alone. This suite checks that a closed room stays clean while the rock round
 * it is hatched, that a door joins floor to floor, that a pocket of rock closed
 * off by a ring of corridor is hatched again, that the panel's controls are
 * each one undo step and that setting a value to itself is none, that adding a
 * wall in one corner does not reshuffle the hatching in another, that the
 * dungeon generator's Rock setting turns it on as part of its one step, and
 * that the map reloads pixel-identical.
 *
 * Start the server first:  python3 app.py --no-browser --port 7871
 * Then:                    node test/hatch.mjs [http://127.0.0.1:7871]
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
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await p.goto(base('http://127.0.0.1:7871/'), { waitUntil: 'networkidle' });
await ready(p);
await newMap(p, { name: 'Hatched Hold', kind: 'battle', size: '40x30' });

/* helpers ------------------------------------------------------------------ */

const C = 70;   // a battle map's cell
const wall = (x0, y0, x1, y1, kind = 'wall') =>
  ({ id: 'w' + Math.random().toString(36).slice(2, 9), kind,
     points: [{ x: x0 * C, y: y0 * C }, { x: x1 * C, y: y1 * C }] });
const box = (x0, y0, x1, y1) => [wall(x0, y0, x1, y0), wall(x1, y0, x1, y1), wall(x1, y1, x0, y1), wall(x0, y1, x0, y0)];
const setWalls = (ops) => p.evaluate((list) => {
  const l = window.__cg.app.doc.layers.find((x) => x.kind === 'walls');
  l.ops = list;
  window.__cg.R.invalidate(l);
}, ops);
// The walls layer alone, so the floor texture under it cannot stand in for
// strokes that are not there.
const ink = (x0, y0, x1, y1) => p.evaluate(([a, b2, c, d]) => {
  const l = window.__cg.app.doc.layers.find((x) => x.kind === 'walls');
  const cv = window.__cg.R.canvasFor(l);
  const px = cv.getContext('2d').getImageData(a, b2, c - a, d - b2).data;
  let n = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i] > 40) n++;
  return n;
}, [x0, y0, x1, y1]);
const region = (x0, y0, x1, y1) => p.evaluate(([a, b2, c, d]) => {
  const l = window.__cg.app.doc.layers.find((x) => x.kind === 'walls');
  const cv = window.__cg.R.canvasFor(l);
  return Array.from(cv.getContext('2d').getImageData(a, b2, c - a, d - b2).data).join(',');
}, [x0, y0, x1, y1]);
const fingerprint = () => p.evaluate(() => {
  const c = window.__cg.R.flatten({ scale: 1, grid: true, paper: true });
  const s = document.createElement('canvas'); s.width = 64; s.height = 64;
  const x = s.getContext('2d'); x.drawImage(c, 0, 0, 64, 64);
  return Array.from(x.getImageData(0, 0, 64, 64).data).join(',');
});
const past = () => p.evaluate(() => window.__cg.history.past.length);
const lastLabel = () => p.evaluate(() => {
  const h = window.__cg.history.past; return h.length ? h[h.length - 1].label : null;
});
const walls = () => p.evaluate(() => {
  const l = window.__cg.app.doc.layers.find((x) => x.kind === 'walls');
  return { hatch: l.hatch, has: 'hatch' in l, width: l.hatchWidth };
});
const step = (which) => p.evaluate(async (w) => { const h = await import('/js/history.js'); return h[w](); }, which);

/* a closed room ------------------------------------------------------------ */

// A room from (6,6) to (14,12) in cells: 420..980 x 420..840 px.
await setWalls(box(6, 6, 14, 12));

await p.click('.layer:has-text("Walls")');
await p.waitForTimeout(300);
const toggle = p.locator('#layer-props label.check:has-text("Hatch the rock")');
t('the walls layer offers hatching in its panel', await toggle.count() === 1);
const before = await past();
await toggle.locator('input').check();
await p.waitForTimeout(500);
t('turning it on is one undo step', (await past()) === before + 1 && (await lastLabel()) === 'Hatching on',
  (await past()) - before + ' ' + (await lastLabel()));
t('and it is stored on the layer', (await walls()).hatch === true);

// A band 20 px deep just outside each wall, and the same inside.
const outside = (await ink(420 - 30, 500, 420 - 8, 760)) + (await ink(600, 840 + 8, 800, 840 + 30));
const inside = (await ink(420 + 8, 500, 420 + 30, 760)) + (await ink(600, 840 - 30, 800, 840 - 8));
t('the rock outside a closed room is hatched', outside > 300, outside + ' inked pixels');
t('and the room inside it is left clean', inside === 0, inside + ' inked pixels');
const far = await ink(1900, 1500, 2000, 1600);
t('the hatching stops short of rock far from any wall', far === 0, far + ' inked pixels');

/* a door joins floor to floor ---------------------------------------------- */

// A second room east of the first, sharing the wall at x=14, with a door in
// it: both rooms are floor.
const shared = [
  ...box(6, 6, 14, 12).filter((w) => !(w.points[0].x === 14 * C && w.points[1].x === 14 * C)),
  wall(14, 6, 14, 8), wall(14, 8, 14, 9, 'door'), wall(14, 9, 14, 12),
  wall(14, 6, 20, 6), wall(20, 6, 20, 12), wall(20, 12, 14, 12),
];
await setWalls(shared);
await p.waitForTimeout(300);
const eastIn = await ink(14 * C + 10, 6 * C + 10, 20 * C - 10, 12 * C - 10);
const westIn = await ink(6 * C + 10, 6 * C + 10, 14 * C - 10, 12 * C - 10);
t('a room reached through a door is floor, not rock', eastIn === 0 && westIn === 0,
  'east ' + eastIn + ', west ' + westIn);

/* a door in an outside wall ----------------------------------------------- */

// The same pair of rooms, entered from the rock through a front door in the
// west room's top wall. A door costing nothing there gave the west room the
// outside's parity, and the east room's through the inner door with it.
await setWalls([
  ...shared.filter((w) => !(w.points[0].y === 6 * C && w.points[1].y === 6 * C && w.points[0].x < 14 * C + 1
                           && w.points[1].x < 14 * C + 1)),
  wall(6, 6, 9, 6), wall(9, 6, 10, 6, 'door'), wall(10, 6, 14, 6),
]);
await p.waitForTimeout(300);
const frontWest = await ink(6 * C + 10, 6 * C + 10, 14 * C - 10, 12 * C - 10);
const frontEast = await ink(14 * C + 10, 6 * C + 10, 20 * C - 10, 12 * C - 10);
const frontOut = await ink(420 - 30, 500, 420 - 8, 760);
t('a room with a door to the rock is still floor', frontWest === 0 && frontEast === 0,
  'west ' + frontWest + ', east ' + frontEast);
t('and the rock outside its front door is still hatched', frontOut > 150, frontOut + ' inked pixels');

/* a pocket of rock inside a ring of corridor -------------------------------- */

// An outer box (4,4)-(24,20) and an inner one (8,8)-(20,16): the ring between
// them is a corridor, the inner box is rock that the ring closes off.
await setWalls([...box(4, 4, 24, 20), ...box(8, 8, 20, 16)]);
await p.waitForTimeout(300);
const pocket = await ink(8 * C + 8, 10 * C, 8 * C + 30, 14 * C);
const ring = await ink(4 * C + 10, 10 * C, 8 * C - 10, 14 * C);
t('rock closed off by a ring of corridor is hatched', pocket > 150, pocket + ' inked pixels');
t('and the corridor round it is not', ring === 0, ring + ' inked pixels');

/* a stroke length from a hand-edited file -------------------------------- */

// The panel holds it to 8..60, but a map file is anyone's: the work grows with
// one over the square of it, and 0.05 would have hung the tab as it opened.
const tiny = await p.evaluate(() => {
  const l = window.__cg.app.doc.layers.find((x) => x.kind === 'walls');
  const was = l.hatchSize;
  l.hatchSize = 0.05;
  const t0 = performance.now();
  window.__cg.R.invalidate(l);
  const ms = performance.now() - t0;
  if (was === undefined) delete l.hatchSize; else l.hatchSize = was;
  window.__cg.R.invalidate(l);
  return ms;
});
t('a tiny stroke length in the file is held to the panel\'s range', tiny < 1500, Math.round(tiny) + ' ms');

/* stable as walls are added ------------------------------------------------ */

const patch = await region(4 * C - 40, 4 * C - 40, 4 * C + 40, 6 * C);
await p.evaluate(() => {
  const l = window.__cg.app.doc.layers.find((x) => x.kind === 'walls');
  l.ops.push({ id: 'wfar', kind: 'wall', points: [{ x: 34 * 70, y: 24 * 70 }, { x: 37 * 70, y: 24 * 70 }] });
  window.__cg.R.invalidate(l);
});
t('a wall added in one corner leaves the hatching in another exactly as it was',
  (await region(4 * C - 40, 4 * C - 40, 4 * C + 40, 6 * C)) === patch);
const lone = await ink(34 * C + 40, 24 * C - 30, 37 * C - 40, 24 * C - 8)
  + await ink(34 * C + 40, 24 * C + 8, 37 * C - 40, 24 * C + 30);
t('and a lone wall in the rock is hatched on both sides', lone > 200, lone + ' inked pixels');

/* the panel's controls ----------------------------------------------------- */

await p.click('.layer:has-text("Walls")');
await p.waitForTimeout(300);
const wideBefore = await ink(4 * C - 70, 10 * C, 4 * C - 40, 14 * C);
const n0 = await past();
await p.evaluate(() => {
  const f = Array.from(document.querySelectorAll('#layer-props .field'))
    .find((x) => x.querySelector('label') && /^Width/.test(x.querySelector('label').textContent.trim()));
  const r = f.querySelector('input[type=range]');
  r.value = '90';
  r.dispatchEvent(new Event('input', { bubbles: true }));
  r.dispatchEvent(new Event('change', { bubbles: true }));
});
await p.waitForTimeout(400);
const wideAfter = await ink(4 * C - 70, 10 * C, 4 * C - 40, 14 * C);
t('a wider band reaches further into the rock', wideAfter > wideBefore + 100, wideBefore + ' -> ' + wideAfter);
t('and the width is one undo step', (await past()) === n0 + 1 && (await lastLabel()) === 'Hatching width');
await step('undo');
await p.waitForTimeout(300);
t('undoing it puts the band back', (await ink(4 * C - 70, 10 * C, 4 * C - 40, 14 * C)) === wideBefore
  && !(await walls()).width);
await step('redo');
await p.waitForTimeout(300);
t('and redo widens it again', (await ink(4 * C - 70, 10 * C, 4 * C - 40, 14 * C)) === wideAfter);

// Setting a field to the value it already holds is no step at all.
const n1 = await past();
await p.evaluate(() => {
  const f = Array.from(document.querySelectorAll('#layer-props .field'))
    .find((x) => x.querySelector('label') && /^Width/.test(x.querySelector('label').textContent.trim()));
  const r = f.querySelector('input[type=range]');
  r.value = '90';
  r.dispatchEvent(new Event('change', { bubbles: true }));
});
await p.waitForTimeout(300);
t('a change to the same value pushes no entry', (await past()) === n1, (await past()) - n1);

/* the round trip ----------------------------------------------------------- */

await p.evaluate(() => window.__cg.R.compositeAll());
const print = await fingerprint();
const slug = await p.evaluate(async () => {
  const a = await import('/js/app.js');
  await a.saveProject();
  return window.__cg.app.slug;
});
await p.reload({ waitUntil: 'networkidle' });
await ready(p);
await p.waitForFunction((s) => window.__cg.app.slug === s, slug, { timeout: 20000 });
await p.waitForTimeout(800);
t('a hatched map reloads pixel-identical', (await fingerprint()) === print);

/* speed -------------------------------------------------------------------- */

// Fastest of four, after a warm-up: noise only ever makes a run slower.
const ms = await p.evaluate(() => {
  const l = window.__cg.app.doc.layers.find((x) => x.kind === 'walls');
  window.__cg.R.rebuildLayer(l);
  let best = Infinity;
  for (let i = 0; i < 4; i++) {
    const t0 = performance.now();
    window.__cg.R.rebuildLayer(l);
    best = Math.min(best, performance.now() - t0);
  }
  return best;
});
t('a hatched walls layer rebuilds without a visible stall', ms < 300, ms.toFixed(0) + ' ms');

/* the dungeon generator ---------------------------------------------------- */

await setWalls([]);
await p.evaluate(() => {
  const l = window.__cg.app.doc.layers.find((x) => x.kind === 'walls');
  delete l.hatch; delete l.hatchWidth;
  window.__cg.R.invalidate(l);
});
await p.click('.tool[data-tool="wall"]');
await p.waitForTimeout(250);
await p.click('[data-action="generate-dungeon"]');
await p.waitForSelector('.modal [data-dungeon="preview"]');
await p.fill('[data-dungeon="seed"]', 'barrow-vault-12');
const plan = (await p.evaluate(() => document.querySelector('[data-dungeon="preview"]').toDataURL()));
const rockSelect = await p.evaluateHandle(() => Array.from(document.querySelectorAll('.modal select'))
  .find((s) => Array.from(s.options).some((o) => o.value === 'hatched')));
t('the dungeon dialog offers hatched rock', !!(await rockSelect.evaluate((s) => !!s)));
await rockSelect.asElement().selectOption('hatched');
await p.waitForTimeout(300);
t('and its plan shows it', (await p.evaluate(() => document.querySelector('[data-dungeon="preview"]').toDataURL())) !== plan);
const n2 = await past();
await p.click('.modal .btn-primary');
await p.waitForTimeout(1500);
const gen = await p.evaluate(() => {
  const d = window.__cg.app.doc;
  const w = d.layers.find((x) => x.kind === 'walls');
  const shade = d.layers.some((l) => l.kind === 'raster' && l.ops.some((o) => o.gen && o.gen.kind === 'dungeon-shade'));
  return { hatch: w.hatch, walls: w.ops.length, shade };
});
t('generating with hatched rock turns the hatching on', gen.hatch === true && gen.walls > 10, JSON.stringify(gen));
t('and lays no shaded rock under it', gen.shade === false);
t('all in one step', (await past()) === n2 + 1 && (await lastLabel()) === 'Generate dungeon');
await step('undo');
await p.waitForTimeout(600);
const undone = await walls();
t('undoing the dungeon takes the hatching off with it', !undone.has, JSON.stringify(undone));
await step('redo');
await p.waitForTimeout(600);
t('and redo puts it back', (await walls()).hatch === true);

// Shaded is the default and leaves the layer's hatching off.
await p.click('[data-action="generate-dungeon"]');
await p.waitForSelector('.modal [data-dungeon="preview"]');
const sel2 = await p.evaluateHandle(() => Array.from(document.querySelectorAll('.modal select'))
  .find((s) => Array.from(s.options).some((o) => o.value === 'hatched')));
await sel2.asElement().selectOption('shaded');
await p.click('.modal .btn-primary');
await p.waitForTimeout(1500);
t('generating again with shaded rock turns it off', (await walls()).hatch === false);

await p.screenshot({ path: '/tmp/cg_hatch.png' });
t('no console errors', errs.length === 0, errs.slice(0, 3).join(' | '));

report();
await b.close();
process.exit(fails ? 1 : 0);
