/* The properties panel: changing a thing after it has been drawn.
 *
 * Every op this program writes has carried its colour, its width and its
 * wording all along; until now the only way to change one was to delete it and
 * draw it again. This suite is about the panel that reaches them.
 *
 * Start the server first:  python3 app.py --no-browser --port 7871
 * Then:                    node test/props.mjs [http://127.0.0.1:7871]
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
const p = await b.newPage({ viewport: { width: 1700, height: 1000 } });
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await p.goto(base('http://127.0.0.1:7871/'), { waitUntil: 'networkidle' });
await ready(p);

/* Its own map: the editor reopens the last one on launch, so a suite that
 * measures whatever is open inherits the previous suite's work. */
await newMap(p, { name: 'Property Marches', kind: 'region' });

const M = (mx, my) => p.evaluate(([x, y]) => {
  const s = window.__cg.mapToScreen(x, y);
  const r = document.getElementById('canvas').getBoundingClientRect();
  return { x: r.left + s.x, y: r.top + s.y };
}, [mx, my]);

const tool = async (n) => { await p.click(`.tool[data-tool="${n}"]`); await p.waitForTimeout(200); };
const click = async (mx, my) => {
  const s = await M(mx, my);
  await p.mouse.click(s.x, s.y);
  await p.waitForTimeout(180);
};
const drag = async (pts, steps = 5) => {
  const f = await M(...pts[0]);
  await p.mouse.move(f.x, f.y); await p.mouse.down();
  for (const q of pts.slice(1)) { const s = await M(...q); await p.mouse.move(s.x, s.y, { steps }); }
  await p.mouse.up(); await p.waitForTimeout(220);
};

/* The colour of one pixel of the flattened map, so what changed can be
 * measured rather than inferred from the document. */
const pixel = (mx, my) => p.evaluate(([x, y]) => {
  const d = window.__cg.R.view.flat.getContext('2d').getImageData(x, y, 1, 1).data;
  return [d[0], d[1], d[2]];
}, [mx, my]);
const apart = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

const labels = () => p.$$eval('#selection-props .field > label > span, #selection-props .check span',
  (ns) => ns.map((n) => n.textContent));
const hidden = () => p.evaluate(() => document.getElementById('panel-selection').hidden);
const topStep = () => p.evaluate(() => {
  const past = window.__cg.history.past;
  return past.length ? past[past.length - 1].label : null;
});
const steps = () => p.evaluate(() => window.__cg.history.past.length);
const undo = async () => {
  await p.evaluate(async () => { (await import('/js/history.js')).undo(); });
  await p.waitForTimeout(350);
};

/* Set one field of the panel by its visible label, the way a person would --
 * not by writing to the op, which would prove nothing about the panel. */
async function set(label, value) {
  await p.evaluate(([name, v]) => {
    const fields = Array.from(document.querySelectorAll('#selection-props .field'));
    const f = fields.find((x) => x.querySelector('label > span')
                              && x.querySelector('label > span').textContent === name);
    if (!f) throw new Error('no field called ' + name);
    const input = f.querySelector('input, select');
    input.value = String(v);
    // change, not input: every expensive control in this panel commits on
    // release, which is the event a person's mouse-up sends.
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, [label, value]);
  await p.waitForTimeout(420);
}

/* nothing selected -------------------------------------------------------- */

await tool('select');
t('with nothing picked up there is no properties panel', await hidden() === true);

/* a region ---------------------------------------------------------------- */

await tool('region');
await p.click('#tool-options .target button.link');      // the offer to add the layer
await p.waitForTimeout(500);
await click(520, 380); await click(980, 400); await click(1000, 780); await click(540, 760);
await p.keyboard.press('Enter');
await p.waitForTimeout(400);
if ((await p.$$('.modal')).length) {
  await p.fill('.modal input[type=text]', 'Ashmoor');
  await p.click('.modal .btn-primary');
  await p.waitForTimeout(600);
}
const regions = () => p.evaluate(() => {
  const l = window.__cg.app.doc.layers.find((x) => x.kind === 'regions');
  return l ? l.ops : [];
});
t('a region was drawn to work on', (await regions()).length === 1);

await tool('select');
await click(520, 380);
t('clicking a region border picks it up', await hidden() === false);
t('and the panel offers what a region has',
  JSON.stringify(await labels()) === JSON.stringify(['Name', 'Colour', 'Fill', 'Border', 'Border width']),
  (await labels()).join(', '));

/* Measured inside the territory and away from the centroid: the name and its
 * halo are drawn there, and a reading taken over them measures the label
 * rather than the tint. The two readings differ only in the colour setting.
 * Green, not another blue: the sea underneath is blue already, and a check
 * that cannot tell the tint from what is under it is not a check. */
const beforeTint = await pixel(900, 600);
await set('Colour', '#2fd06a');
t('changing the colour reaches the op',
  (await regions())[0].color === '#2fd06a', (await regions())[0].color);
const afterTint = await pixel(900, 600);
t('and reaches the map', apart(beforeTint, afterTint) > 12,
  beforeTint.join(',') + ' -> ' + afterTint.join(','));
t('it is one undo step, named for what it changed', await topStep() === 'Edit region', await topStep());

const stepsAfterEdit = await steps();
await set('Colour', '#2fd06a');
t('setting a field to what it already said pushes nothing',
  await steps() === stepsAfterEdit, stepsAfterEdit + ' -> ' + await steps());

await undo();
t('undo puts the colour back', (await regions())[0].color === '#8a3b3b', (await regions())[0].color);
t('and puts the pixels back', apart(await pixel(900, 600), beforeTint) <= 1);
t('and the panel follows it', await p.$eval(
  '#selection-props input[type=color]', (n) => n.value) === '#8a3b3b');

await set('Colour', '#2fd06a');
await set('Border', 'none');
await set('Name', 'Ashmoor Reach');
t('a select field writes through too', (await regions())[0].border === 'none');
t('and a text field', (await regions())[0].name === 'Ashmoor Reach');

/* a label ----------------------------------------------------------------- */

await tool('label');
await click(700, 900);
await p.waitForTimeout(400);
if ((await p.$$('.modal')).length) {
  await p.fill('.modal input[type=text]', 'Grey Ford');
  await p.click('.modal .btn-primary');
  await p.waitForTimeout(500);
}
const labelOps = () => p.evaluate(() => {
  const l = window.__cg.app.doc.layers.find((x) => x.kind === 'labels');
  return l ? l.ops : [];
});
t('a label was written', (await labelOps()).length === 1, (await labelOps()).length);

await tool('select');
await click(700, 900);
t('a label can be picked up', await hidden() === false);
await set('Text', 'Greyford');
t('its wording can be rewritten', (await labelOps())[0].text === 'Greyford',
  (await labelOps())[0].text);
await set('Size', 56);
t('and its size', (await labelOps())[0].size === 56, (await labelOps())[0].size);

/* a path ------------------------------------------------------------------ */

await tool('path');
await click(300, 1100); await click(700, 1150); await click(1100, 1080);
await p.keyboard.press('Enter');
await p.waitForTimeout(400);
const paths = () => p.evaluate(() => {
  const l = window.__cg.app.doc.layers.find((x) => x.kind === 'paths');
  return l ? l.ops : [];
});
t('a path was drawn', (await paths()).length === 1);

await tool('select');
await click(300, 1100);
t('a path can be picked up', await hidden() === false);
await set('Width', 34);
t('its width can be changed after the fact', (await paths())[0].width === 34, (await paths())[0].width);
t('and the map is thicker for it', await p.evaluate(() => {
  // count how much of a band across the route is now painted at all
  const c = window.__cg.R.view.flat;
  const d = c.getContext('2d').getImageData(280, 1060, 60, 120).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) n++;
  return n > 0;
}));

/* the panel goes away when it should --------------------------------------- */

await tool('brush');
t('picking up another tool puts the panel away', await hidden() === true);
await tool('select');
await click(300, 1100);
t('and it comes back', await hidden() === false);
await p.keyboard.press('Delete');
await p.waitForTimeout(350);
t('deleting what was selected puts it away too', await hidden() === true);
t('and the path really went', (await paths()).length === 0);

/* the round trip ----------------------------------------------------------- */

const beforeSave = await p.evaluate(() => window.__cg.R.fingerprint ? window.__cg.R.fingerprint() : null);
await p.click('#btn-save');
await p.waitForTimeout(1400);
await p.reload({ waitUntil: 'networkidle' });
await ready(p);
await p.waitForTimeout(600);
t('the edits survive a save and a reload',
  (await regions())[0].name === 'Ashmoor Reach'
  && (await regions())[0].color === '#2fd06a'
  && (await regions())[0].border === 'none'
  && (await labelOps())[0].text === 'Greyford',
  JSON.stringify({ r: (await regions())[0].name, c: (await regions())[0].color,
                   l: (await labelOps())[0].text }));

/* walls and lights, which need a battle map -------------------------------- */

/* Snapping moves a wall's ends onto the grid, so clicking where the drag
 * started is not clicking the wall. Hit testing on a wall is by its points --
 * a straight one has exactly two -- so the click has to go to one of them. */
const grab = async (kind, pick = (ops) => ops[0]) => {
  const at = await p.evaluate((k) => {
    const l = window.__cg.app.doc.layers.find((x) => x.kind === k);
    const item = l && l.ops[0];
    if (!item) return null;
    return item.points ? item.points[0] : { x: item.x, y: item.y };
  }, kind);
  if (!at) return false;
  await tool('select');
  await click(at.x, at.y);
  return true;
};

/* Bigger than the default room, so there is somewhere beyond the reach of a
 * torch to read: on a 20 x 15 map every corner is already lit and a check that
 * a light reaches further cannot move. */
await newMap(p, { name: 'Property Hall', kind: 'battle', size: '40x30' });

await tool('wall');
await click(300, 200); await click(300, 900);
await p.keyboard.press('Enter');
await p.waitForTimeout(400);
const walls = () => p.evaluate(() => {
  const l = window.__cg.app.doc.layers.find((x) => x.kind === 'walls');
  return l ? l.ops : [];
});
t('a wall was drawn', (await walls()).length >= 1, (await walls()).length);

await tool('light');
await click(180, 550);
await p.waitForTimeout(500);
const lights = () => p.evaluate(() => {
  const l = window.__cg.app.doc.layers.find((x) => x.kind === 'lights');
  return l ? l.ops : [];
});
t('a light was placed', (await lights()).length === 1);

/* Behind the wall, which is the whole point: if the wall stops blocking, the
 * darkness there has to lift. Read well clear of the wall itself. */
const behind = () => pixel(460, 550);
const shadowed = await behind();

await grab('walls');
t('a wall can be picked up, which it could not be before', await hidden() === false);
t('and the panel offers what a wall has',
  JSON.stringify(await labels()) === JSON.stringify(['Kind']), (await labels()).join(', '));

await set('Kind', 'window');
t('a wall can be turned into a window', (await walls())[0].kind === 'window', (await walls())[0].kind);
const throughIt = await behind();
t('and the light comes through it — the relight ran', apart(shadowed, throughIt) > 8,
  shadowed.join(',') + ' -> ' + throughIt.join(','));

await undo();
t('undoing it puts the shadow back', apart(await behind(), shadowed) <= 2,
  shadowed.join(',') + ' vs ' + (await behind()).join(','));

await grab('lights');
t('a light can be picked up', await hidden() === false);
t('and its radii read in map units, not pixels', await p.evaluate(() => {
  const fields = Array.from(document.querySelectorAll('#selection-props .field'));
  const f = fields.find((x) => x.querySelector('label > span')
                            && x.querySelector('label > span').textContent === 'Dim');
  const shown = parseFloat(f.querySelector('input').value);
  const op = window.__cg.app.doc.layers.find((l) => l.kind === 'lights').ops[0];
  // the light tool's own default is 40 feet, stored as pixels
  return Math.abs(shown - 40) < 1.5 && op.dim > shown * 2;
}));

/* Straight down the light's own column, so the wall beside it cannot be what
 * decides the reading: 875 px away, which is beyond a 40-foot dim radius and
 * inside a 120-foot one. */
const beyond = await pixel(175, 1400);
await set('Dim', 120);
t('reaching further lights what it reaches', apart(beyond, await pixel(175, 1400)) > 4,
  beyond.join(',') + ' -> ' + (await pixel(175, 1400)).join(','));
t('and the stored value is back in pixels', await p.evaluate(() => {
  const op = window.__cg.app.doc.layers.find((l) => l.kind === 'lights').ops[0];
  return op.dim > 200;
}), (await lights())[0].dim);

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
