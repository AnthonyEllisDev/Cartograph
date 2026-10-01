/* Turning and mirroring what the Select tool is holding.
 *
 * R turns the held set a step clockwise and Shift+R anticlockwise -- a quarter
 * on a square grid, a sixth on a hex one -- and Mirror and Flip swap it left to
 * right and top to bottom. This suite checks that walls stay on the grid lines
 * through all of it, that a stamp's angle and a cone light's facing go round
 * with the set, that four quarter turns and two mirrors come back to exactly
 * where they started, that each is one undo step that puts back exactly what
 * was there, that a turned wall relights, that a turned stamp is clicked where
 * it is drawn, and that the map reloads pixel-identical afterwards.
 *
 * Start the server first:  python3 app.py --no-browser --port 7871
 * Then:                    node test/transform.mjs [http://127.0.0.1:7871]
 */

import { launch, base, ready, newMap } from './browser.mjs';

const out = [];
let fails = 0;
function t(name, pass, note) {
  out.push([pass ? 'PASS' : 'FAIL', name, note == null ? '' : String(note)]);
  if (!pass) fails++;
}

process.on('unhandledRejection', (err) => {
  report();
  console.log('\nthrew: ' + (err && err.message));
  process.exit(1);
});

const b = await launch();
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await p.goto(base('http://127.0.0.1:7871/'), { waitUntil: 'networkidle' });
await ready(p);

await newMap(p, { name: 'Turning Keep', kind: 'battle', size: '40x30' });

/* helpers ------------------------------------------------------------------ */

const M = (mx, my) => p.evaluate(([x, y]) => {
  const s = window.__cg.mapToScreen(x, y);
  const r = document.getElementById('canvas').getBoundingClientRect();
  return { x: r.left + s.x, y: r.top + s.y };
}, [mx, my]);
const tool = async (n) => { await p.click(`.tool[data-tool="${n}"]`); await p.waitForTimeout(200); };
const click = async (mx, my, mod) => {
  const s = await M(mx, my);
  if (mod) await p.keyboard.down(mod);
  await p.mouse.click(s.x, s.y);
  if (mod) await p.keyboard.up(mod);
  await p.waitForTimeout(180);
};
const press = async (k) => { await p.keyboard.press(k); await p.waitForTimeout(260); };
const ops = (kind) => p.evaluate((k) => JSON.parse(JSON.stringify(
  window.__cg.app.doc.layers.find((l) => l.kind === k).ops)), kind);
const all = async () => JSON.stringify([await ops('walls'), await ops('lights'), await ops('objects')]);
const past = () => p.evaluate(() => window.__cg.history.past.length);
const lastLabel = () => p.evaluate(() => {
  const h = window.__cg.history.past; return h.length ? h[h.length - 1].label : null;
});
const held = () => p.evaluate(async () => {
  const T = await import('/js/tools.js');
  return T.selectedObjects().map((s) => s.layer.kind + ':' + s.item.id);
});
const lum = (x, y) => p.evaluate(([px, py]) => {
  const c = window.__cg.R.flatten({ scale: 1, grid: false, paper: false });
  const d = c.getContext('2d').getImageData(px, py, 1, 1).data;
  return d[0] * 0.3 + d[1] * 0.59 + d[2] * 0.11;
}, [x, y]);
const fingerprint = () => p.evaluate(() => {
  const c = window.__cg.R.flatten({ scale: 1, grid: true, paper: true });
  const s = document.createElement('canvas'); s.width = 64; s.height = 64;
  const x = s.getContext('2d'); x.drawImage(c, 0, 0, 64, 64);
  return Array.from(x.getImageData(0, 0, 64, 64).data).join(',');
});
const onLine = (v) => Math.abs(v / 70 - Math.round(v / 70)) < 1e-9;
const wallsOnGrid = (walls) => walls.every((w) => w.points.every((q) => onLine(q.x) && onLine(q.y)));
const len = (w) => Math.hypot(w.points[1].x - w.points[0].x, w.points[1].y - w.points[0].y);
const close = (a, b, e = 1e-6) => Math.abs(a - b) < e;

/* ========================================================================== *
 * A small room: an L of wall drawn with the Wall tool, a door, a cone light
 * facing east and a stamp. The light and the stamp are put down directly, so
 * their angle and their asset are known.
 * ========================================================================== */

await p.evaluate(async () => {
  const A = await import('/js/app.js');
  A.setToolSetting('wall', 'kind', 'wall');
});
await tool('wall');
await click(1120, 700); await click(1400, 700); await click(1400, 910); await press('Enter');
await p.evaluate(async () => {
  const A = await import('/js/app.js');
  A.setToolSetting('wall', 'kind', 'door');
});
await click(1120, 910); await click(1260, 910); await press('Enter');
const asset = await p.evaluate(async () => {
  const D = await import('/js/doc.js');
  const S = await import('/js/assets.js');
  const A = await import('/js/app.js');
  const doc = window.__cg.app.doc;
  const stamp = [...S.library.byId.values()].find((a) => a.kind !== 'terrain');
  await S.warm([stamp.id]);
  if (!doc.layers.some((l) => l.kind === 'lights')) doc.layers.push(D.makeLayer('lights'));
  const lights = doc.layers.find((l) => l.kind === 'lights');
  lights.ambient = 0.8;
  lights.ops.push({ id: 'o-cone', x: 1225, y: 805, bright: 200, dim: 400, color: '#ffd28a',
    cone: 90, angle: 0 });
  doc.layers.find((l) => l.kind === 'objects').ops.push({ id: 'o-chair', asset: stamp.id,
    x: 1295, y: 840, scale: 0.6, rot: 0 });
  for (const l of doc.layers) window.__cg.R.invalidate(l);
  A.emit('layers');
  return stamp.id;
});
const start = await all();
const walls0 = await ops('walls');
t('precondition: an L of wall and a door on the grid, a cone light and a stamp',
  walls0.length === 2 && walls0[0].points.length === 3 && wallsOnGrid(walls0) && (await ops('lights')).length === 1
  && (await ops('objects')).length === 1 && !!asset, walls0.length);

/* ========================================================================== *
 * A quarter turn.
 * ========================================================================== */

await tool('select');
await press('Control+a');
t('precondition: Ctrl+A holds the four of them', (await held()).length === 4);
let n0 = await past();
await press('r');
let walls = await ops('walls');
let [cone] = await ops('lights');
let [chair] = await ops('objects');
t('R turns the set as one undo step, labelled Turn right',
  (await past()) === n0 + 1 && (await lastLabel()) === 'Turn right');
t('every wall end is still on a grid line', wallsOnGrid(walls),
  JSON.stringify(walls.map((w) => w.points)));
t('and every wall keeps its length', walls.every((w, i) => close(len(w), len(walls0[i]))));
t('the wall that ran east now runs south (a clockwise turn)',
  close(walls[0].points[1].x, walls[0].points[0].x) && walls[0].points[1].y > walls[0].points[0].y,
  JSON.stringify(walls[0].points));
t('the cone light now faces south', cone.angle === 90, cone.angle);
t('and the stamp has turned with it', close(chair.rot, Math.PI / 2), chair.rot);
t('the set is still held, so it can be turned again', (await held()).length === 4);
t('the Selected panel offers Turn left, Turn right, Mirror and Flip', await p.evaluate(() =>
  ['turn-left', 'turn-right', 'mirror', 'flip'].every((a) =>
    document.querySelector(`#selection-props [data-action="${a}"]`))));

await press('Shift+R');
t('Shift+R turns it back, to exactly where it began', (await all()) === start);
await press('r'); await press('r'); await press('r'); await press('r');
t('four quarter turns come back to exactly where they began', (await all()) === start);

await press('r');
await press('Control+z');
t('undo puts back exactly what was there', (await all()) === start);
await press('Control+y');
walls = await ops('walls');
t('and redo turns it again', walls[0].points[1].y > walls[0].points[0].y && wallsOnGrid(walls));
await press('Control+z');

/* ========================================================================== *
 * Mirror and flip.
 * ========================================================================== */

n0 = await past();
await p.click('#selection-props [data-action="mirror"]');
await p.waitForTimeout(260);
walls = await ops('walls');
[cone] = await ops('lights');
[chair] = await ops('objects');
t('Mirror is one undo step', (await past()) === n0 + 1 && (await lastLabel()) === 'Mirror');
t('the walls stay on the grid', wallsOnGrid(walls));
t('the wall that ran east now runs west',
  walls[0].points[1].x < walls[0].points[0].x && close(walls[0].points[1].y, walls[0].points[0].y));
t('the cone light faces west', cone.angle === 180, cone.angle);
t('and the stamp is mirrored', chair.flip === true && close(chair.rot, 0), JSON.stringify([chair.flip, chair.rot]));
await press('Control+z');
t('undo puts back exactly what was there, without leaving a flip behind', (await all()) === start);

await p.click('#selection-props [data-action="flip"]');
await p.waitForTimeout(260);
walls = await ops('walls');
[cone] = await ops('lights');
[chair] = await ops('objects');
t('Flip keeps the walls on the grid', wallsOnGrid(walls));
t('and turns the wall\'s L upside down',
  walls[0].points[2].y < walls[0].points[1].y, JSON.stringify(walls[0].points));
t('a flipped stamp is mirrored and stood on its head', chair.flip === true && close(Math.abs(chair.rot), Math.PI),
  JSON.stringify([chair.flip, chair.rot]));
t('a cone facing east still faces east after a flip', cone.angle === 0, cone.angle);
await p.click('#selection-props [data-action="flip"]');
await p.waitForTimeout(260);
const twice = JSON.parse(await all());
for (const o of twice[2]) o.flip = !!o.flip ? true : undefined;
const startNoFlip = JSON.parse(start);
t('flipping twice comes back to where it began',
  JSON.stringify(twice[0]) === JSON.stringify(startNoFlip[0])
  && JSON.stringify(twice[1]) === JSON.stringify(startNoFlip[1])
  && close(twice[2][0].rot, 0) && twice[2][0].x === startNoFlip[2][0].x);
await press('Control+z'); await press('Control+z');
t('precondition: undone back to the start', (await all()) === start);

/* ========================================================================== *
 * A turned wall relights. A lamp of its own and a straight wall of its own,
 * well away from the room: the wall runs east-west below the lamp and shades
 * the spot under it, and turned to run north-south beside the lamp it does
 * not.
 * ========================================================================== */

await press('Escape');
await p.evaluate(async () => {
  const A = await import('/js/app.js');
  const doc = window.__cg.app.doc;
  const lights = doc.layers.find((l) => l.kind === 'lights');
  lights.ops.push({ id: 'o-lamp', x: 520, y: 1300, bright: 200, dim: 400, color: '#ffd28a', cone: 360, angle: 0 });
  doc.layers.find((l) => l.kind === 'walls').ops.push({ id: 'w-lone', kind: 'wall',
    points: [{ x: 420, y: 1400 }, { x: 700, y: 1400 }] });
  for (const l of doc.layers) window.__cg.R.invalidate(l);
  A.emit('layers');
});
const probe = [520, 1500];
const shaded = await lum(...probe);
await click(700, 1400);
t('precondition: one wall held', (await held()).length === 1 && (await held())[0].endsWith('w-lone'));
await press('r');
const lone = (await ops('walls')).find((w) => w.id === 'w-lone');
t('precondition: it now runs north-south on a grid line', lone.points[0].x === lone.points[1].x && onLine(lone.points[0].x),
  JSON.stringify(lone.points));
const lit = await lum(...probe);
t('turning the wall lifts the shadow it cast', lit > shaded + 15, Math.round(shaded) + ' -> ' + Math.round(lit));
await press('Control+z');
t('and undo puts the shadow back', Math.abs((await lum(...probe)) - shaded) < 2);

/* ========================================================================== *
 * A turned stamp is clicked where it is drawn: on its side, it reaches out
 * to the right of the spot it stands on rather than above it.
 * ========================================================================== */

await press('Escape');
await click(1295, 840 - 10);
t('precondition: the upright stamp is picked up by its body', (await held()).some((s) => s.endsWith('o-chair')));
await press('r');
await press('Escape');
const h = await p.evaluate(async (id) => {
  const S = await import('/js/assets.js');
  const img = S.imageNow(id);
  return img.height * 0.6;
}, asset);
await click(1295 + h / 2, 840);
t('a stamp turned on its side is picked up where it is drawn', (await held()).some((s) => s.endsWith('o-chair')),
  await held());
await press('Escape');
await click(1295 - 6, 840 - h * 0.75);
t('and not where it used to stand', !(await held()).some((s) => s.endsWith('o-chair')));

/* R with nothing held is still the Shape tool's letter. */
await press('Escape');
await press('r');
t('R with nothing held picks up the Shape tool, as it always has',
  await p.evaluate(() => window.__cg.app.tool === 'shape'));
await tool('select');

/* A turned set reloads exactly as it looks. */
await press('Control+a');
await press('r');
await p.click('#selection-props [data-action="mirror"]');
await p.waitForTimeout(260);
const print = await fingerprint();
await p.evaluate(async () => { await (await import('/js/app.js')).saveProject({ silent: true }); });
await p.waitForTimeout(600);
await p.reload({ waitUntil: 'networkidle' });
await ready(p);
await p.waitForFunction(() => window.__cg.app.doc && window.__cg.app.doc.name === 'Turning Keep', null, { timeout: 15000 });
await p.waitForTimeout(600);
t('a turned and mirrored map reloads pixel-identical', (await fingerprint()) === print);

/* ========================================================================== *
 * A hex map turns by a sixth, about a hex centre, so a path along the hex
 * edges stays on hex corners.
 * ========================================================================== */

await newMap(p, { name: 'Turning Hexes', kind: 'hex' });
await p.evaluate(async () => {
  const D = await import('/js/doc.js');
  const H = await import('/js/hex.js');
  const A = await import('/js/app.js');
  const doc = window.__cg.app.doc;
  const grid = D.gridLayer(doc);
  if (!doc.layers.some((l) => l.kind === 'paths')) doc.layers.push(D.makeLayer('paths'));
  const c = H.corners(grid, 4, 4);
  doc.layers.find((l) => l.kind === 'paths').ops.push({ id: 'p-edge', style: 'road', width: 6,
    color: '#8a6a44', points: c.slice(0, 4).map((q) => ({ x: q.x, y: q.y })) });
  for (const l of doc.layers) window.__cg.R.invalidate(l);
  A.emit('layers');
});
const offCorner = () => p.evaluate(async () => {
  const D = await import('/js/doc.js');
  const doc = window.__cg.app.doc;
  const path = doc.layers.find((l) => l.kind === 'paths').ops;
  let worst = 0;
  for (const op of path) for (const q of op.points) {
    const s = D.snapPoint({ ...doc, snap: 'grid' }, q, 'corner');
    worst = Math.max(worst, Math.hypot(s.x - q.x, s.y - q.y));
  }
  return worst;
});
t('precondition: the path runs along four hex corners', (await offCorner()) < 1e-6);
await tool('select');
await press('Control+a');
const before = JSON.stringify(await ops('paths'));
await press('r');
t('a hex map turns by a sixth', await p.evaluate(async () => (await import('/js/transform.js')).turnStep() === 60));
t('and the path stays on hex corners', (await offCorner()) < 1e-6, await offCorner());
t('and it did move', JSON.stringify(await ops('paths')) !== before);
for (let i = 0; i < 5; i++) await press('r');
const back = JSON.parse(JSON.stringify(await ops('paths')));
const was = JSON.parse(before);
t('six sixths come back to where it began',
  back[0].points.every((q, i) => close(q.x, was[0].points[i].x, 1e-6) && close(q.y, was[0].points[i].y, 1e-6)));
await p.click('#selection-props [data-action="mirror"]');
await p.waitForTimeout(260);
t('a mirrored hex path stays on hex corners', (await offCorner()) < 1e-6);
await p.click('#selection-props [data-action="flip"]');
await p.waitForTimeout(260);
t('and so does a flipped one', (await offCorner()) < 1e-6);

t('no console errors', errs.length === 0, errs.slice(0, 3).join(' | '));

/* ------------------------------------------------------------------ report */

function report() {
  for (const [state, name, note] of out) {
    console.log(state + '  ' + name + (note ? '  [' + note + ']' : ''));
  }
  if (errs.length) { console.log('\nconsole errors:'); for (const e of errs) console.log('  ' + e); }
  console.log('\n' + (out.length - fails) + '/' + out.length + ' passed');
}
report();
await b.close();
process.exit(fails || errs.length ? 1 : 0);
