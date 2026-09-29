/* Copy, cut, paste and duplicate.
 *
 * The Select tool picks a thing up; this suite is about making a second one of
 * it -- where the copy lands, which layer it lands on, that it is one undo step,
 * that it is drawn and lit like the original, and that it survives a reload.
 *
 * Start the server first:  python3 app.py --no-browser --port 7871
 * Then:                    node test/clipboard.mjs [http://127.0.0.1:7871]
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

/* A 40 x 30 battle map of its own: big enough that a light has somewhere to
 * reach, and snapped, so where a copy lands can be checked against the grid. */
await newMap(p, { name: 'Clipboard Keep', kind: 'battle', size: '40x30' });

const M = (mx, my) => p.evaluate(([x, y]) => {
  const s = window.__cg.mapToScreen(x, y);
  const r = document.getElementById('canvas').getBoundingClientRect();
  return { x: r.left + s.x, y: r.top + s.y };
}, [mx, my]);
const tool = async (n) => { await p.click(`.tool[data-tool="${n}"]`); await p.waitForTimeout(200); };
const click = async (mx, my) => { const s = await M(mx, my); await p.mouse.click(s.x, s.y); await p.waitForTimeout(180); };
const hover = async (mx, my) => { const s = await M(mx, my); await p.mouse.move(s.x, s.y); await p.waitForTimeout(80); };
/* Off the map, over the right rail, so the paste has no pointer to go to. */
const offMap = async () => { await p.mouse.move(1590, 500); await p.waitForTimeout(80); };
const press = async (k) => { await p.keyboard.press(k); await p.waitForTimeout(260); };
const ops = (kind) => p.evaluate((k) => JSON.parse(JSON.stringify(
  window.__cg.app.doc.layers.find((l) => l.kind === k).ops)), kind);
const past = () => p.evaluate(() => window.__cg.history.past.length);
const held = () => p.evaluate(async () => {
  const T = await import('/js/tools.js');
  const s = T.selectedObject();
  return s ? { kind: s.layer.kind, id: s.item.id } : null;
});
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
const inCell = (v) => Math.abs((v - 35) / 70 - Math.round((v - 35) / 70)) < 1e-6;

/* ========================================================================== *
 * Nothing to copy.
 * ========================================================================== */

await tool('select');
await click(1400, 1000);
await hover(1400, 1000);
let n0 = await past();
await press('Control+v');
t('pasting with nothing copied writes nothing', (await past()) === n0
  && (await ops('walls')).length === 0);

/* ========================================================================== *
 * A door, copied and pasted at the pointer.
 * ========================================================================== */

await tool('wall');
await p.evaluate(async () => {
  // The kind is a tool setting; set it the way the panel does.
  const A = await import('/js/app.js');
  A.setToolSetting('wall', 'kind', 'door');
});
await click(560, 700); await click(700, 700); await press('Enter');
const door = (await ops('walls'))[0];
t('precondition: a door is drawn', door && door.kind === 'door', door && door.kind);

await tool('select');
await click(560, 700);
t('the Select tool picks the door up', ((await held()) || {}).id === door.id);
await press('Control+c');
const clip = await p.evaluate(async () => (await import('/js/clipboard.js')).clipboardContents());
t('Ctrl+C puts it on the clipboard', clip.kind === 'walls' && clip.entries.length === 1
  && clip.entries[0].id === door.id);

n0 = await past();
await hover(1500, 1300);
await press('Control+v');
let walls = await ops('walls');
const pasted = walls[1];
t('Ctrl+V adds one door', walls.length === 2 && pasted && pasted.kind === 'door', walls.length);
t('with an id of its own', pasted && pasted.id !== door.id && /^w-/.test(pasted.id), pasted && pasted.id);
const len = (w) => Math.hypot(w.points[1].x - w.points[0].x, w.points[1].y - w.points[0].y);
t('the same shape as the original', pasted && Math.abs(len(pasted) - len(door)) < 1e-6
  && pasted.points[0].y === pasted.points[1].y);
t('landing on grid lines, like a door drawn there', pasted
  && pasted.points.every((q) => onLine(q.x) && onLine(q.y)),
  pasted && JSON.stringify(pasted.points));
const mid = pasted && { x: (pasted.points[0].x + pasted.points[1].x) / 2, y: (pasted.points[0].y + pasted.points[1].y) / 2 };
t('under the pointer', mid && Math.hypot(mid.x - 1500, mid.y - 1300) <= 70, mid && JSON.stringify(mid));
t('as one undo step', (await past()) === n0 + 1);
t('and the copy is what is now in hand', ((await held()) || {}).id === (pasted && pasted.id));
t('with its properties in the Selected panel', await p.evaluate(() =>
  !document.getElementById('panel-selection').hidden
  && !!document.querySelector('#selection-props [data-action="duplicate"]')));

await press('Control+z');
walls = await ops('walls');
t('one undo takes the paste back off', walls.length === 1 && walls[0].id === door.id);
await press('Control+y');
walls = await ops('walls');
t('and redo puts the same door back', walls.length === 2 && walls[1].id === pasted.id);

/* ========================================================================== *
 * A pasted wall stops light: the paste goes through the relight route.
 * ========================================================================== */

await tool('light');
await click(1225, 525);
const probe = [1225, 875];
const litBefore = lum(await pixel(...probe));
await p.evaluate(async () => {
  const A = await import('/js/app.js');
  A.setToolSetting('wall', 'kind', 'wall');
});
await tool('wall');
await click(420, 1680); await click(700, 1680); await press('Enter');
await tool('select');
await click(420, 1680);
await press('Control+c');
t('lighting is unchanged by copying', Math.abs(lum(await pixel(...probe)) - litBefore) < 1);
await hover(1225, 700);
await press('Control+v');
const shaded = lum(await pixel(...probe));
t('a wall pasted between a light and the floor shades it', shaded < litBefore - 15,
  Math.round(litBefore) + ' -> ' + Math.round(shaded));
await press('Control+z');
t('and undoing the paste lifts the shadow', Math.abs(lum(await pixel(...probe)) - litBefore) < 2,
  Math.round(lum(await pixel(...probe))));

/* ========================================================================== *
 * Duplicate: a cell on, the clipboard left alone.
 * ========================================================================== */

let lights = await ops('lights');
const lamp = lights[0];
await click(lamp.x, lamp.y);
t('the lamp is picked up', ((await held()) || {}).kind === 'lights');
n0 = await past();
await press('Control+d');
lights = await ops('lights');
const twin = lights[1];
t('Ctrl+D makes a second lamp', lights.length === 2 && twin && twin.id !== lamp.id);
t('one cell down and to the right, in a cell centre', twin && twin.x === lamp.x + 70 && twin.y === lamp.y + 70
  && inCell(twin.x) && inCell(twin.y), twin && twin.x + ',' + twin.y);
t('with the same reach and colour', twin && twin.bright === lamp.bright && twin.dim === lamp.dim
  && twin.color === lamp.color);
t('as one undo step, labelled Duplicate', (await past()) === n0 + 1 && await p.evaluate(() =>
  window.__cg.history.past[window.__cg.history.past.length - 1].label === 'Duplicate'));
const clip2 = await p.evaluate(async () => (await import('/js/clipboard.js')).clipboardContents());
t('and the clipboard still holds the wall', clip2.kind === 'walls');

await p.click('#selection-props [data-action="duplicate"]'); await p.waitForTimeout(250);
lights = await ops('lights');
t('the Selected panel\'s Duplicate does the same from the copy in hand',
  lights.length === 3 && lights[2].x === twin.x + 70, lights.length);
await p.click('#selection-props [data-action="delete"]'); await p.waitForTimeout(250);
t('and its Delete takes it off again', (await ops('lights')).length === 2 && !(await held()));

/* ========================================================================== *
 * Cut, then paste with the pointer off the map.
 * ========================================================================== */

await click(lamp.x + 70, lamp.y + 70);
await press('Control+x');
lights = await ops('lights');
t('Ctrl+X takes the lamp off the map', lights.length === 1 && lights[0].id === lamp.id);
t('as the one Delete step', await p.evaluate(() =>
  window.__cg.history.past[window.__cg.history.past.length - 1].label === 'Delete'));
await offMap();
await press('Control+v');
await press('Control+v');
lights = await ops('lights');
t('pasting with the pointer off the map steps each copy one cell further on',
  lights.length === 3 && lights[1].x === twin.x + 70 && lights[2].x === twin.x + 140
  && lights[2].y === twin.y + 140, lights.map((l) => l.x + ',' + l.y).join(' '));

/* ========================================================================== *
 * A note from a generated dungeon becomes the user's own when copied.
 * ========================================================================== */

await p.evaluate(async () => {
  const A = await import('/js/app.js'); const D = await import('/js/doc.js');
  const U = await import('/js/ui.js');
  const l = D.makeLayer('notes', { name: 'Notes' });
  l.ops.push({ id: 'n-gen1', x: 385, y: 385, title: 'Guard room', body: '', color: '#b8452e', gen: 'dungeon' });
  U.insertLayer(l);
  A.emit('layers');
});
await p.waitForTimeout(300);
await tool('select');
await click(385, 385);
await press('Control+d');
let notes = await ops('notes');
t('a duplicated note is numbered next', notes.length === 2 && notes[1].title === 'Guard room');
t('and is no longer tagged as the generator\'s, so regenerating will not sweep it away',
  notes[1] && notes[1].gen === undefined && notes[0].gen === 'dungeon');

/* ========================================================================== *
 * The round trip.
 * ========================================================================== */

await click(1400, 1900);
const print = await fingerprint();
const counts = { walls: (await ops('walls')).length, lights: (await ops('lights')).length };
await p.evaluate(async () => { await (await import('/js/app.js')).saveProject({ silent: true }); });
await p.waitForTimeout(600);
await p.reload({ waitUntil: 'networkidle' });
await ready(p);
await p.waitForFunction(() => window.__cg.app.doc && window.__cg.app.doc.name === 'Clipboard Keep', null, { timeout: 15000 });
await p.waitForTimeout(500);
t('a map with pasted things reloads pixel-identical', (await fingerprint()) === print);
t('with every copy still in it', (await ops('walls')).length === counts.walls
  && (await ops('lights')).length === counts.lights);

/* ========================================================================== *
 * Between maps.
 * ========================================================================== */

await tool('select');
lights = await ops('lights');
await click(lights[0].x, lights[0].y);
await press('Control+c');
await newMap(p, { name: 'Clipboard Cellar', kind: 'battle' });
const dark0 = await p.evaluate(() => window.__cg.app.doc.layers.find((l) => l.kind === 'lights').ambient);
await tool('select');
await hover(690, 500);
await press('Control+v');
lights = await ops('lights');
t('a lamp copied on one map pastes onto the next', lights.length === 1 && lights[0].x === 665
  && lights[0].y === 525, lights.map((l) => l.x + ',' + l.y).join(' '));
const dark1 = await p.evaluate(() => window.__cg.app.doc.layers.find((l) => l.kind === 'lights').ambient);
t('and, the first light there, turns the night on as the Light tool does', !dark0 && dark1 > 0, dark0 + ' -> ' + dark1);
await press('Control+z');
t('which undo turns back off', await p.evaluate((a) =>
  window.__cg.app.doc.layers.find((l) => l.kind === 'lights').ambient === a, dark0));

await newMap(p, { name: 'Clipboard Coast', kind: 'region' });
n0 = await past();
await tool('select');
await hover(700, 500);
await press('Control+v');
t('a map with no layer for it is told so, and nothing is written',
  (await past()) === n0 && await p.evaluate(() =>
    !window.__cg.app.doc.layers.some((l) => l.kind === 'lights')));

/* ========================================================================== *
 * Hexes: a copy lands on the hex lattice.
 * ========================================================================== */

await newMap(p, { name: 'Clipboard Hexes', kind: 'hex' });
await p.evaluate(async () => {
  const A = await import('/js/app.js'); const D = await import('/js/doc.js');
  const U = await import('/js/ui.js');
  const l = D.makeLayer('notes', { name: 'Notes' });
  const at = D.snapPoint(A.app.doc, { x: 600, y: 600 }, 'centre');
  l.ops.push({ id: 'n-h1', x: at.x, y: at.y, title: 'Ruined tower', body: '', color: '#b8452e' });
  U.insertLayer(l);
  A.emit('layers');
});
await p.waitForTimeout(300);
notes = await ops('notes');
await tool('select');
await click(notes[0].x, notes[0].y);
await press('Control+d');
notes = await ops('notes');
const onHex = notes[1] && await p.evaluate(async (q) => {
  const D = await import('/js/doc.js');
  const s = D.snapPoint(window.__cg.app.doc, q, 'centre');
  return Math.hypot(s.x - q.x, s.y - q.y) < 1e-6;
}, { x: notes[1].x, y: notes[1].y });
t('on a hex map a duplicate lands in a hex, not a square step off one',
  notes.length === 2 && onHex && (notes[1].x !== notes[0].x || notes[1].y !== notes[0].y),
  notes.map((q) => Math.round(q.x) + ',' + Math.round(q.y)).join(' '));

/* ========================================================================== *
 * Keys typed into a field are the field's.
 * ========================================================================== */

await click(notes[1].x, notes[1].y);
const before = (await ops('notes')).length;
await p.click('#selection-props input[type=text] >> nth=0');
await p.keyboard.press('Control+a');
await p.keyboard.press('Control+c');
await p.keyboard.press('Control+v');
await p.keyboard.press('Control+d');
await p.waitForTimeout(250);
t('Ctrl+C, V and D inside a text field copy text, not the note', (await ops('notes')).length === before);

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
