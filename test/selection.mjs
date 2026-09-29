/* A selection set: several things held at once.
 *
 * Shift-click adds or removes one, a box dragged on empty map picks up what it
 * wholly encloses, and whatever is held moves, deletes, copies, pastes and
 * duplicates together, as one undo step however many layers it spans. This
 * suite checks each of those, that a set moved off a light's line relights,
 * that a locked or hidden layer drops out of the set, and that the map reloads
 * pixel-identical afterwards.
 *
 * Start the server first:  python3 app.py --no-browser --port 7871
 * Then:                    node test/selection.mjs [http://127.0.0.1:7871]
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

/* A 40 x 30 battle map: room for a light to reach, and snapped, so where a
 * pasted set lands can be checked against the grid. */
await newMap(p, { name: 'Selection Keep', kind: 'battle', size: '40x30' });

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
const drag = async (from, to, mod) => {
  const a = await M(...from), z = await M(...to);
  if (mod) await p.keyboard.down(mod);
  await p.mouse.move(a.x, a.y);
  await p.mouse.down();
  for (let i = 1; i <= 8; i++) await p.mouse.move(a.x + (z.x - a.x) * i / 8, a.y + (z.y - a.y) * i / 8);
  await p.mouse.up();
  if (mod) await p.keyboard.up(mod);
  await p.waitForTimeout(250);
};
const hover = async (mx, my) => { const s = await M(mx, my); await p.mouse.move(s.x, s.y); await p.waitForTimeout(80); };
const press = async (k) => { await p.keyboard.press(k); await p.waitForTimeout(260); };
const ops = (kind) => p.evaluate((k) => JSON.parse(JSON.stringify(
  window.__cg.app.doc.layers.find((l) => l.kind === k).ops)), kind);
const past = () => p.evaluate(() => window.__cg.history.past.length);
const lastLabel = () => p.evaluate(() => {
  const h = window.__cg.history.past; return h.length ? h[h.length - 1].label : null;
});
const held = () => p.evaluate(async () => {
  const T = await import('/js/tools.js');
  return T.selectedObjects().map((s) => s.layer.kind + ':' + s.item.id);
});
const ids = (list) => list.map((s) => s.split(':')[1]).sort().join(',');
const pixel = (mx, my) => p.evaluate(([x, y]) => {
  const d = window.__cg.R.view.flat.getContext('2d').getImageData(x, y, 1, 1).data;
  return [d[0], d[1], d[2]];
}, [mx, my]);
const lum = (c) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
const fingerprint = () => p.evaluate(() => {
  const c = window.__cg.R.flatten({ scale: 1, grid: true, paper: true });
  const s = document.createElement('canvas'); s.width = 64; s.height = 64;
  const x = s.getContext('2d'); x.drawImage(c, 0, 0, 64, 64);
  return Array.from(x.getImageData(0, 0, 64, 64).data).join(',');
});
const onLine = (v) => Math.abs(v / 70 - Math.round(v / 70)) < 1e-6;
const setLayer = (kind, fields) => p.evaluate(async ([k, f]) => {
  const A = await import('/js/app.js');
  const layer = window.__cg.app.doc.layers.find((l) => l.kind === k);
  Object.assign(layer, f);
  window.__cg.R.invalidate(layer); window.__cg.R.relightAll();
  A.emit('layers');
}, [kind, fields]);

/* ========================================================================== *
 * The things to pick up: a light, a wall between it and the floor, a door, a
 * long road and a label. The road and the label are put down directly -- they
 * are only there to be left alone by the box.
 * ========================================================================== */

await tool('light');
await click(1225, 525);
await p.evaluate(async () => {
  const A = await import('/js/app.js');
  A.setToolSetting('wall', 'kind', 'wall');
});
await tool('wall');
await click(1120, 700); await click(1330, 700); await press('Enter');
await p.evaluate(async () => {
  const A = await import('/js/app.js');
  A.setToolSetting('wall', 'kind', 'door');
});
await click(420, 1400); await click(560, 1400); await press('Enter');
await p.evaluate(async () => {
  const D = await import('/js/doc.js');
  const A = await import('/js/app.js');
  const doc = window.__cg.app.doc;
  for (const kind of ['paths', 'labels']) {
    if (!doc.layers.some((l) => l.kind === kind)) doc.layers.push(D.makeLayer(kind));
  }
  doc.layers.find((l) => l.kind === 'paths').ops.push({ id: 'p-road', style: 'road', width: 8,
    color: '#8a6a44', points: [{ x: 200, y: 300 }, { x: 1400, y: 320 }, { x: 2600, y: 300 }] });
  doc.layers.find((l) => l.kind === 'labels').ops.push({ id: 't-sign', text: 'Keep', style: 'settlement',
    size: 24, x: 1800, y: 1500 });
  for (const l of doc.layers) window.__cg.R.invalidate(l);
  A.emit('layers');
});
const [wallA, door] = await ops('walls');
const lamp = (await ops('lights'))[0];
const probe = [1225, 875];
const shadedLum = lum(await pixel(...probe));
t('precondition: a lamp, a wall and a door are on the map', wallA && door && lamp
  && wallA.kind === 'wall' && door.kind === 'door');

/* ========================================================================== *
 * Shift-click builds a set, and takes one back out.
 * ========================================================================== */

await tool('select');
await click(wallA.points[0].x, wallA.points[0].y);
t('a plain click picks up one thing', (await held()).length === 1);
await click(lamp.x, lamp.y, 'Shift');
let h = await held();
t('shift-click adds the lamp to it', h.length === 2 && ids(h) === [wallA.id, lamp.id].sort().join(','), h);
t('the Selected panel says two things are held, and what they are', await p.evaluate(() => {
  const n = document.querySelector('#selection-props [data-selection-count]');
  return !document.getElementById('panel-selection').hidden && n && n.dataset.selectionCount === '2'
    && /1 wall/.test(n.textContent) && /1 light/.test(n.textContent);
}));
t('and offers no fields to edit, since a set has no one colour', await p.evaluate(() =>
  document.querySelectorAll('#selection-props input, #selection-props select, #selection-props textarea').length === 0));
let n0 = await past();
await click(lamp.x, lamp.y, 'Shift');
t('shift-click on a held thing puts it down again', (await held()).length === 1);
t('and building a set pushes nothing onto the history', (await past()) === n0);
await press('Escape');
t('Escape puts everything down', (await held()).length === 0
  && await p.evaluate(() => document.getElementById('panel-selection').hidden));

/* ========================================================================== *
 * A box picks up what it wholly encloses.
 * ========================================================================== */

await drag([1050, 440], [1400, 760]);
h = await held();
t('a box dragged on empty map picks up the lamp and the wall inside it',
  h.length === 2 && ids(h) === [wallA.id, lamp.id].sort().join(','), h);
t('but not the road that runs through it, which it does not enclose', !h.some((s) => s.startsWith('paths')));
await drag([380, 1340], [600, 1460], 'Shift');
h = await held();
t('shift and a second box adds the door', h.length === 3 && h.some((s) => s.endsWith(door.id)), h);
await click(2000, 200);
t('a click on empty map puts the set down', (await held()).length === 0);
t('and the box pushes nothing onto the history', (await past()) === n0);

/* ========================================================================== *
 * Moving a set: one delta, one step, and the light recast.
 * ========================================================================== */

await click(wallA.points[0].x, wallA.points[0].y);
await click(door.points[0].x, door.points[0].y, 'Shift');
n0 = await past();
await drag([wallA.points[0].x, wallA.points[0].y], [wallA.points[0].x + 700, wallA.points[0].y + 140]);
let walls = await ops('walls');
const dA = { x: walls[0].points[0].x - wallA.points[0].x, y: walls[0].points[0].y - wallA.points[0].y };
const dD = { x: walls[1].points[0].x - door.points[0].x, y: walls[1].points[0].y - door.points[0].y };
// The Select tool's drag is not snapped, so the delta is a float; each item
// adds it to its own snapshot and the sums differ in the last bits.
const same = (a, b) => Math.abs(a - b) < 1e-6;
t('dragging one of a set moves all of it', Math.abs(dA.x) > 600 && same(dA.x, dD.x) && same(dA.y, dD.y),
  JSON.stringify([dA, dD]));
t('with the far end of each wall moved the same', same(walls[0].points[1].x - wallA.points[1].x, dA.x)
  && same(walls[1].points[1].y - door.points[1].y, dA.y));
t('as one undo step, labelled Move', (await past()) === n0 + 1 && (await lastLabel()) === 'Move');
const litLum = lum(await pixel(...probe));
t('the wall moved off the light\'s line stops shading the floor', litLum > shadedLum + 15,
  Math.round(shadedLum) + ' -> ' + Math.round(litLum));
t('what was dragged is still the set', (await held()).length === 2);
await press('Control+z');
walls = await ops('walls');
t('one undo puts both walls back', JSON.stringify(walls[0].points) === JSON.stringify(wallA.points)
  && JSON.stringify(walls[1].points) === JSON.stringify(door.points));
t('and the shadow with them', Math.abs(lum(await pixel(...probe)) - shadedLum) < 2);
await press('Control+y');
walls = await ops('walls');
t('redo moves both again', same(walls[0].points[0].x, wallA.points[0].x + dA.x)
  && same(walls[1].points[0].x, door.points[0].x + dA.x));

/* A moved set reloads exactly as it looks. */
const print = await fingerprint();
await p.evaluate(async () => { await (await import('/js/app.js')).saveProject({ silent: true }); });
await p.waitForTimeout(600);
await p.reload({ waitUntil: 'networkidle' });
await ready(p);
await p.waitForFunction(() => window.__cg.app.doc && window.__cg.app.doc.name === 'Selection Keep', null, { timeout: 15000 });
await p.waitForTimeout(500);
t('a map with a moved set reloads pixel-identical', (await fingerprint()) === print);
await tool('select');

/* Put the walls back where they started, as a plain move of a set. */
walls = await ops('walls');
await click(walls[0].points[0].x, walls[0].points[0].y);
await click(walls[1].points[0].x, walls[1].points[0].y, 'Shift');
await drag([walls[0].points[0].x, walls[0].points[0].y], [wallA.points[0].x, wallA.points[0].y]);
walls = await ops('walls');
const near = (u, v) => u.every((q, i) => same(q.x, v[i].x) && same(q.y, v[i].y));
t('precondition: the set can be dragged back to where it began',
  near(walls[0].points, wallA.points) && near(walls[1].points, door.points));

/* ========================================================================== *
 * Deleting a set.
 * ========================================================================== */

n0 = await past();
await press('Delete');
t('Delete takes the whole set off', (await ops('walls')).length === 0);
t('as one step', (await past()) === n0 + 1 && (await lastLabel()) === 'Delete');
await press('Control+z');
walls = await ops('walls');
t('and one undo puts both back, the same walls', walls.length === 2
  && walls[0].id === wallA.id && walls[1].id === door.id);

/* ========================================================================== *
 * Copying and pasting a set that spans two layers.
 * ========================================================================== */

await drag([1050, 440], [1400, 760]);
await press('Control+c');
const clip = await p.evaluate(async () => (await import('/js/clipboard.js')).clipboardContents());
t('Ctrl+C puts both on the clipboard', clip.entries.length === 2 && clip.kind === 'mixed'
  && clip.kinds.includes('walls') && clip.kinds.includes('lights'), clip.kind);
n0 = await past();
await hover(1925, 1225);
await press('Control+v');
walls = await ops('walls');
let lights = await ops('lights');
const wCopy = walls[2], lCopy = lights[1];
t('Ctrl+V puts a wall on the walls layer and a lamp on the lighting',
  walls.length === 3 && lights.length === 2 && wCopy && lCopy);
t('as one undo step, labelled Paste', (await past()) === n0 + 1 && (await lastLabel()) === 'Paste');
t('keeping the set\'s shape', lCopy && wCopy
  && same(lCopy.x - wCopy.points[0].x, lamp.x - wallA.points[0].x)
  && same(lCopy.y - wCopy.points[0].y, lamp.y - wallA.points[0].y));
t('with the wall on grid lines', wCopy && wCopy.points.every((q) => onLine(q.x) && onLine(q.y)));
t('near the pointer', lCopy && Math.abs(lCopy.x - 1925) < 250 && Math.abs(lCopy.y - 1225) < 250,
  lCopy && lCopy.x + ',' + lCopy.y);
h = await held();
t('and the copies are what is held now', h.length === 2 && ids(h) === [wCopy.id, lCopy.id].sort().join(','));
const copyProbe = [lCopy.x, lCopy.y + 350];
t('the pasted wall shades the floor below the pasted lamp, as the original does',
  Math.abs(lum(await pixel(...copyProbe)) - shadedLum) < 12,
  Math.round(lum(await pixel(...copyProbe))) + ' vs ' + Math.round(shadedLum));

n0 = await past();
await press('Control+d');
walls = await ops('walls'); lights = await ops('lights');
t('Ctrl+D duplicates the set a cell on', walls.length === 4 && lights.length === 3
  && lights[2].x === lCopy.x + 70 && same(walls[3].points[0].x, wCopy.points[0].x + 70));
t('as one step, labelled Duplicate', (await past()) === n0 + 1 && (await lastLabel()) === 'Duplicate');
await press('Control+z');
await press('Control+z');
t('two undos take the duplicate and the paste back off',
  (await ops('walls')).length === 2 && (await ops('lights')).length === 1);

/* A layer that cannot take its part: the rest still lands. */
await drag([1050, 440], [1400, 760]);
await press('Control+c');
await setLayer('lights', { visible: false });
await hover(1925, 1225);
await press('Control+v');
t('with the lighting hidden, a pasted set still puts its wall down and leaves the lamp out',
  (await ops('walls')).length === 3 && (await ops('lights')).length === 1);
await press('Control+z');
await setLayer('lights', { visible: true });

/* ========================================================================== *
 * Everything, and a lock.
 * ========================================================================== */

await press('Escape');
await press('Control+a');
h = await held();
t('Ctrl+A picks up everything on the map', h.length === 5
  && ['walls', 'lights', 'paths', 'labels'].every((k) => h.some((s) => s.startsWith(k))), h.length);
await press('Escape');

await drag([1050, 440], [1400, 760]);
await setLayer('walls', { locked: true });
h = await held();
t('locking the walls layer drops its wall out of the set', h.length === 1 && h[0].startsWith('lights'), h);
await press('Delete');
t('so Delete takes only the lamp', (await ops('walls')).length === 2 && (await ops('lights')).length === 0);
await press('Control+z');
await setLayer('walls', { locked: false });
t('precondition: undo puts the lamp back', (await ops('lights')).length === 1);

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
