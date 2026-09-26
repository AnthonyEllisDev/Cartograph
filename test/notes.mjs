/* Notes: numbered pins on the map, and the key that goes out with it.
 *
 * Start the server first:  python3 app.py --no-browser --port 7871
 * Then:                    node test/notes.mjs [http://127.0.0.1:7871]
 *
 * The number on a pin is not stored -- it is the note's place in its layer --
 * so most of what is checked here is that the three places a number shows up
 * (the pin, the list in the Layers panel, the exported key) cannot disagree.
 */

import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
await p.goto(base('http://127.0.0.1:7871/'), { waitUntil: 'networkidle' });
await ready(p);

/* helpers ------------------------------------------------------------------ */

const M = (mx, my) => p.evaluate(([x, y]) => {
  const s = window.__cg.mapToScreen(x, y);
  const r = document.getElementById('canvas').getBoundingClientRect();
  return { x: r.left + s.x, y: r.top + s.y };
}, [mx, my]);
const tool = async (n) => { await p.click(`.tool[data-tool="${n}"]`); await p.waitForTimeout(200); };
const notes = () => p.evaluate(() => {
  const l = window.__cg.app.doc.layers.find((x) => x.kind === 'notes');
  return l ? l.ops.map((o) => ({ title: o.title, body: o.body, x: o.x, y: o.y, color: o.color })) : null;
});
const undo = () => p.evaluate(async () => (await import('/js/history.js')).undo());
const redo = () => p.evaluate(async () => (await import('/js/history.js')).redo());

/** Place a note with the Note tool, through the dialog, as a person would. */
async function place(x, y, title, body = '', { cancel = false } = {}) {
  const s = await M(x, y);
  await p.mouse.click(s.x, s.y);
  await p.waitForSelector('.modal textarea', { timeout: 5000 });
  await p.fill('.modal input[type=text]', title);
  await p.fill('.modal textarea', body);
  if (cancel) await p.click('.modal .btn:not(.btn-primary)');
  else await p.click('.modal .btn-primary');
  await p.waitForTimeout(350);
}

/** One pixel of the flattened map, as [r, g, b]. */
const pixel = (x, y, opts = {}) => p.evaluate(([px, py, o]) => {
  const c = window.__cg.R.flatten(Object.assign({ scale: 1 }, o));
  return Array.from(c.getContext('2d').getImageData(px, py, 1, 1).data.slice(0, 3));
}, [x, y, opts]);
const near = (a, bb, tol = 30) => a.every((v, i) => Math.abs(v - bb[i]) <= tol);

const fingerprint = () => p.evaluate(() => {
  const c = window.__cg.R.flatten({ scale: 1, grid: true, paper: true });
  const s = document.createElement('canvas'); s.width = 64; s.height = 64;
  const x = s.getContext('2d'); x.drawImage(c, 0, 0, 64, 64);
  return Array.from(x.getImageData(0, 0, 64, 64).data).join(',');
});

/* ========================================================================== *
 * Making a notes layer, and putting notes on it.
 * ========================================================================== */

await newMap(p, { name: 'Notes Check', kind: 'region' });

t('a fresh map has no notes layer', (await notes()) === null);
await p.keyboard.press('n');
await p.waitForTimeout(250);
t('N picks up the Note tool', (await p.evaluate(() => window.__cg.app.tool)) === 'note');
t('whose panel offers to add a notes layer',
  (await p.textContent('#tool-options .target')).includes('Add a notes layer'));
await p.click('#tool-options .target button.link');
await p.waitForTimeout(300);
const top = await p.evaluate(() => {
  const ls = window.__cg.app.doc.layers;
  return ls[ls.length - 1].kind;
});
t('the notes layer goes on top of everything, the paper included', top === 'notes', top);

const PIN = '#8a3b3b';
const under = await pixel(600, 500);
await place(600, 500, 'The drowned chapel', 'The bell still rings at low tide.');
let list = await notes();
t('a click and the dialog put one note on the layer',
  list.length === 1 && list[0].title === 'The drowned chapel' && list[0].body === 'The bell still rings at low tide.',
  JSON.stringify(list));
// Off-centre, clear of the number: this is the pin's own fill.
const onPin = await pixel(600 - 12, 500);
t('and a pin in its colour is drawn where it was put', near(onPin, [0x8a, 0x3b, 0x3b], 40) && !near(onPin, under, 10),
  onPin.join(',') + ' over ' + under.join(','));

await place(1000, 700, 'Should not exist', '', { cancel: true });
t('cancelling the dialog adds nothing', (await notes()).length === 1);

await place(1300, 500, 'Saltmarket', 'Fish, rope and rumour.');
await place(900, 1000, 'Gallows Point');
list = await notes();
t('three notes, in the order they were placed',
  list.map((n) => n.title).join('|') === 'The drowned chapel|Saltmarket|Gallows Point',
  list.map((n) => n.title).join('|'));

await undo();
t('undo takes the last note off', (await notes()).length === 2);
await redo();
t('redo puts it back', (await notes()).length === 3);

/* ========================================================================== *
 * The list in the Layers panel, and the Selected panel.
 * ========================================================================== */

await p.evaluate(async () => {
  const l = window.__cg.app.doc.layers.find((x) => x.kind === 'notes');
  window.__cg.app.activeLayerId = l.id;
  (await import('/js/app.js')).emit('layers');
});
await p.waitForTimeout(300);
const rows = await p.$$eval('#layer-props .note-row', (xs) => xs.map((x) => x.textContent));
t('the Layers panel lists the notes, numbered', rows.join('|') === '1The drowned chapel|2Saltmarket|3Gallows Point',
  rows.join('|'));

await p.click('#layer-props .note-row[data-note="2"]');
await p.waitForTimeout(300);
const picked = await p.evaluate(() => ({
  tool: window.__cg.app.tool,
  shown: !document.getElementById('panel-selection').hidden,
  title: (document.querySelector('#selection-props input[type=text]') || {}).value,
}));
t('clicking a row selects that note', picked.tool === 'select' && picked.shown && picked.title === 'Saltmarket',
  JSON.stringify(picked));

await p.fill('#selection-props input[type=text]', 'Saltmarket Quay');
await p.press('#selection-props input[type=text]', 'Tab');
await p.fill('#selection-props textarea', 'Fish, rope and rumour.\nThe harbourmaster owes the smugglers.');
await p.press('#selection-props textarea', 'Tab');
await p.waitForTimeout(250);
list = await notes();
t('the Selected panel edits the title and the note', list[1].title === 'Saltmarket Quay'
  && list[1].body === 'Fish, rope and rumour.\nThe harbourmaster owes the smugglers.', JSON.stringify(list[1]));
await undo();
t('and undo takes one edit back at a time', (await notes())[1].body === 'Fish, rope and rumour.'
  && (await notes())[1].title === 'Saltmarket Quay');
await redo();

await p.evaluate(() => {
  const i = document.querySelector('#selection-props input[type=text]');
  i.value = '  ';
  i.dispatchEvent(new Event('change', { bubbles: true }));
});
await p.waitForTimeout(250);
t('a note cannot be left with no title', (await notes())[1].title === 'Saltmarket Quay');

// Select, by clicking the pin itself, then drag it.
await tool('select');
const from = await M(900, 1000), to = await M(1000, 1100);
await p.mouse.move(from.x, from.y);
await p.mouse.down();
await p.mouse.move(to.x, to.y, { steps: 6 });
await p.mouse.up();
await p.waitForTimeout(300);
list = await notes();
t('the Select tool picks a pin up by clicking it and moves it',
  Math.round(list[2].x) === 1000 && Math.round(list[2].y) === 1100, list[2].x + ',' + list[2].y);
await undo();
list = await notes();
t('and undo puts it back', Math.round(list[2].x) === 900 && Math.round(list[2].y) === 1000);

/* ========================================================================== *
 * Numbers follow the order, and every place that shows one agrees.
 * ========================================================================== */

const key = () => p.evaluate(async () => {
  const doc = await import('/js/doc.js');
  return { key: doc.noteKey(window.__cg.app.doc), md: doc.keyMarkdown(window.__cg.app.doc) };
});
let k = await key();
t('the key numbers the notes 1, 2, 3', k.key.length === 1
  && k.key[0].entries.map((e) => e.n + e.title).join('|') === '1The drowned chapel|2Saltmarket Quay|3Gallows Point');
t('and the Markdown key carries each title and note',
  k.md.includes('## 1. The drowned chapel\n\nThe bell still rings at low tide.')
  && k.md.includes('## 2. Saltmarket Quay') && k.md.includes('## 3. Gallows Point')
  && k.md.startsWith('# Notes Check'), JSON.stringify(k.md.slice(0, 120)));

// Delete note 2: the old 3 becomes 2 on the pin, in the list and in the key.
await p.click('#layer-props .note-row[data-note="2"]').catch(() => {});
await p.evaluate(async () => {
  const l = window.__cg.app.doc.layers.find((x) => x.kind === 'notes');
  window.__cg.app.activeLayerId = l.id;
  (await import('/js/app.js')).emit('layers');
});
await p.waitForTimeout(300);
await p.click('#layer-props .note-row[data-note="2"]');
await p.waitForTimeout(200);
await p.mouse.move(5, 5);
await p.evaluate(() => document.activeElement && document.activeElement.blur());
await p.keyboard.press('Delete');
await p.waitForTimeout(300);
k = await key();
const rows2 = await p.evaluate(async () => {
  const l = window.__cg.app.doc.layers.find((x) => x.kind === 'notes');
  window.__cg.app.activeLayerId = l.id;
  (await import('/js/app.js')).emit('layers');
  await new Promise((r) => setTimeout(r, 200));
  return Array.from(document.querySelectorAll('#layer-props .note-row')).map((x) => x.textContent).join('|');
});
t('deleting a note renumbers the rest in the key', k.key[0].entries.map((e) => e.n + e.title).join('|')
  === '1The drowned chapel|2Gallows Point', k.key[0].entries.map((e) => e.n + e.title).join('|'));
t('and in the list', rows2 === '1The drowned chapel|2Gallows Point', rows2);
// And on the pin: what is at Gallows Point now is exactly a "2" pin.
const drawnTwo = await p.evaluate(async () => {
  const R = window.__cg.R;
  const { NOTE_DEFAULTS } = await import('/js/doc.js');
  const l = window.__cg.app.doc.layers.find((x) => x.kind === 'notes');
  const size = l.pinSize || NOTE_DEFAULTS.pinSize;
  const grab = (draw) => {
    const c = document.createElement('canvas'); c.width = size * 2; c.height = size * 2;
    const x = c.getContext('2d'); draw(x);
    return c.toDataURL();
  };
  const onLayer = grab((x) => x.drawImage(R.canvasFor(l), 900 - size, 1000 - size, size * 2, size * 2, 0, 0, size * 2, size * 2));
  const two = grab((x) => R.drawPin(x, size, size, 2, '#8a3b3b', size));
  const three = grab((x) => R.drawPin(x, size, size, 3, '#8a3b3b', size));
  return { two: onLayer === two, three: onLayer === three };
});
t('and on the pin itself', drawnTwo.two && !drawnTwo.three, JSON.stringify(drawnTwo));
await undo();
t('undoing the delete brings the note back in its place',
  (await key()).key[0].entries.map((e) => e.title).join('|') === 'The drowned chapel|Saltmarket Quay|Gallows Point');

/* ========================================================================== *
 * Layer settings, and hiding the notes for a players' copy.
 * ========================================================================== */

/** Dark pixels in a band along where pin 1's title would be written. The
 *  same band measured with the setting off and on: whatever is underneath
 *  is in both readings. */
const titleInk = () => p.evaluate(() => {
  const c = window.__cg.R.flatten({ scale: 1 });
  const d = c.getContext('2d').getImageData(600 + 30, 500 - 12, 120, 24).data;
  let dark = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] < 200) dark++;
  return dark;
});
const untitled = await titleInk();
await p.evaluate(async () => {
  const l = window.__cg.app.doc.layers.find((x) => x.kind === 'notes');
  window.__cg.app.activeLayerId = l.id;
  (await import('/js/app.js')).emit('layers');
});
await p.waitForTimeout(250);
await p.evaluate(() => {
  const box = Array.from(document.querySelectorAll('#layer-props label.check'))
    .find((x) => x.textContent.includes('Show titles')).querySelector('input');
  box.click();
});
await p.waitForTimeout(300);
const titled = await titleInk();
t('"Show titles" writes the title beside its pin', titled > untitled + 30,
  untitled + ' dark pixels before, ' + titled + ' after');

const noPins = await pixel(600 - 12, 500, { notes: false });
t('the export can leave the pins off', near(noPins, under, 6), noPins.join(',') + ' vs ' + under.join(','));

await p.evaluate(() => {
  const row = Array.from(document.querySelectorAll('#layer-list .lname')).find((n) => n.textContent === 'Notes');
  row.parentElement.querySelector('.eye').click();
});
await p.waitForTimeout(300);
t('hiding the notes layer takes its notes out of the key', (await key()).key.length === 0);
await p.click('#btn-export');
await p.waitForTimeout(400);
const optsHidden = await p.$$eval('.modal label.check span', (xs) => xs.map((x) => x.textContent).join('|'));
t('and out of the export dialog, which is the players\' copy', !/note pins|key/i.test(optsHidden), optsHidden);
await p.click('.modal .btn:not(.btn-primary)');
await p.waitForTimeout(250);
await p.evaluate(() => {
  const row = Array.from(document.querySelectorAll('#layer-list .lname')).find((n) => n.textContent === 'Notes');
  row.parentElement.querySelector('.eye').click();
});
await p.waitForTimeout(300);

/* ========================================================================== *
 * The export: the key beside the picture, and the key as Markdown.
 * ========================================================================== */

const root = fileURLToPath(new URL('..', import.meta.url));
const exportsDir = join(root, 'exports');
const listing = () => { try { return new Set(readdirSync(exportsDir)); } catch (_) { return new Set(); } };
const before = listing();
await p.click('#btn-export');
await p.waitForTimeout(400);
const opts = await p.$$eval('.modal label.check span', (xs) => xs.map((x) => x.textContent).join('|'));
t('the export dialog offers pins, the key beside the image, and a Markdown key',
  opts.includes('Include the note pins (3)') && opts.includes('Set the key beside the image')
  && opts.includes('Also write the key as a Markdown file'), opts);
await p.evaluate(() => {
  // No download in a test: the copy in the exports folder is what is checked.
  const box = Array.from(document.querySelectorAll('.modal label.check'))
    .find((x) => x.textContent.includes('download')).querySelector('input');
  box.checked = false;
  const sel = document.querySelector('.modal select');
  sel.value = '0.5';
  sel.dispatchEvent(new Event('change'));
});
await p.click('.modal .btn-primary');
await p.waitForTimeout(3000);
const fresh = [...listing()].filter((f) => !before.has(f));
const png = fresh.find((f) => f.endsWith('.png'));
const md = fresh.find((f) => f.endsWith('-key.md'));
t('the export writes the image and a key named after it',
  !!png && !!md && md === png.replace(/\.png$/, '-key.md'), fresh.join(', '));
if (png) {
  const bytes = readFileSync(join(exportsDir, png));
  const w = bytes.readUInt32BE(16), h = bytes.readUInt32BE(20);
  t('and the image is wider than the map by the key beside it', w > 1024 && h >= 768, w + ' x ' + h);
}
if (md) {
  const text = readFileSync(join(exportsDir, md), 'utf8');
  t('and the Markdown key on disk is the key', text.includes('## 2. Saltmarket Quay')
    && text.includes('The harbourmaster owes the smugglers.'), JSON.stringify(text.slice(0, 80)));
}
for (const f of fresh) rmSync(join(exportsDir, f), { force: true });

const tall = await p.evaluate(async () => {
  const doc = await import('/js/doc.js');
  const R = window.__cg.R;
  const small = document.createElement('canvas'); small.width = 400; small.height = 300;
  const sections = [{ name: 'Notes', entries: Array.from({ length: 30 }, (_, i) => ({
    n: i + 1, title: 'Room ' + (i + 1), body: 'A long note that has to wrap onto more than one line in the key.',
    color: '#8a3b3b' })) }];
  const out = R.withKey(small, sections, 'Tall');
  return [out.width, out.height, doc.noteKey !== undefined];
});
t('a key longer than the map runs on below it rather than being cut off', tall[1] > 300 && tall[0] > 400,
  tall.slice(0, 2).join(' x '));

/* ========================================================================== *
 * Two notes layers, and the round trip.
 * ========================================================================== */

await p.evaluate(async () => {
  const { makeLayer } = await import('/js/doc.js');
  const { insertLayer } = await import('/js/ui.js');
  const l = makeLayer('notes', { name: 'Secrets', pinSize: 44 });
  l.ops.push({ id: 'n-s1', x: 400, y: 1200, title: 'The false floor', body: '', color: '#3f6b8a' });
  insertLayer(l);
});
await p.waitForTimeout(300);
k = await key();
t('each notes layer counts from 1, under its own heading',
  k.key.length === 2 && k.key[1].name === 'Secrets' && k.key[1].entries[0].n === 1
  && k.md.includes('## Secrets') && k.md.includes('### 1. The false floor'),
  k.key.map((s) => s.name + ':' + s.entries.length).join(', '));

const print = await fingerprint();
await p.evaluate(async () => { await (await import('/js/app.js')).saveProject({ silent: true }); });
await p.waitForTimeout(600);
await p.reload({ waitUntil: 'networkidle' });
await ready(p);
await p.waitForFunction(() => window.__cg.app.doc && window.__cg.app.doc.name === 'Notes Check', null, { timeout: 15000 });
await p.waitForTimeout(500);
t('a map with notes reloads pixel-identical', (await fingerprint()) === print);
list = await notes();
t('with every title and note intact', list.length === 3 && list[1].title === 'Saltmarket Quay'
  && list[1].body === 'Fish, rope and rumour.\nThe harbourmaster owes the smugglers.');

t('no console errors', errs.length === 0, errs.slice(0, 3).join(' | '));

for (const [status, name, note] of out) {
  console.log(status.padEnd(5), name, note ? ' [' + note + ']' : '');
}
console.log(`\n${out.length - fails}/${out.length} passed`);
await b.close();
process.exit(fails ? 1 : 0);
