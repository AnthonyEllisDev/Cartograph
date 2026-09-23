/* Regions: territories with a tint, a border and a name.
 *
 * Start the server first:  python3 app.py --no-browser --port 7871
 * Then:                    node test/regions.mjs [http://127.0.0.1:7871]
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

// This suite makes its own map: the editor reopens the last one on launch, so
// a suite that paints on whatever is open inherits the previous suite's map.
await newMap(p, { name: 'Sundered Marches', kind: 'region' });

const M = (mx, my) => p.evaluate(([x, y]) => {
  const s = window.__cg.mapToScreen(x, y);
  const r = document.getElementById('canvas').getBoundingClientRect();
  return { x: r.left + s.x, y: r.top + s.y };
}, [mx, my]);
const tool = async (n) => { await p.click(`.tool[data-tool="${n}"]`); await p.waitForTimeout(190); };
const regionLayer = () => p.evaluate(() =>
  window.__cg.app.doc.layers.find((l) => l.kind === 'regions') || null);
const items = async () => {
  const l = await regionLayer();
  return l ? l.ops : [];
};
/* The colour at one point of the flattened map, so a fill can be measured
 * rather than inferred from the document. */
const pixel = (mx, my) => p.evaluate(([x, y]) => {
  const d = window.__cg.R.view.flat.getContext('2d').getImageData(x, y, 1, 1).data;
  return [d[0], d[1], d[2]];
}, [mx, my]);

/* drawing one ------------------------------------------------------------- */

await tool('region');
t('the region tool is in the toolbar', await p.$('.tool[data-tool="region"]') != null);

t('a fresh region map has no regions layer', (await regionLayer()) === null);
t('and the tool panel offers to add one',
  (await p.textContent('#tool-options .target')).includes('Add a regions layer'));

await p.click('#tool-options .target button.link');
await p.waitForTimeout(500);
t('the offer really adds one', (await regionLayer()) !== null);

/* Sampled well away from the centroid: the name's halo is drawn there, and a
 * reading taken inside the lettering measures the label rather than the fill. */
const IN = [640, 470], OUT = [160, 180];
const corners = [[420, 380], [1180, 330], [1320, 900], [560, 980]];
const bare = await pixel(IN[0], IN[1]);
const bareOut = await pixel(OUT[0], OUT[1]);
for (const [x, y] of corners) {
  const s = await M(x, y);
  await p.mouse.click(s.x, s.y);
  await p.waitForTimeout(140);
}
await p.keyboard.press('Enter');
await p.waitForTimeout(450);
await p.fill('.modal input[type=text]', 'Duchy of Ashfen');
await p.click('.modal .btn-primary');
await p.waitForTimeout(700);

let ops = await items();
t('four clicks and Enter make one region', ops.length === 1, JSON.stringify(ops.map((o) => o.points.length)));
t('it keeps the name it was given', ops[0] && ops[0].name === 'Duchy of Ashfen', ops[0] && ops[0].name);
t('and all four border points', ops[0] && ops[0].points.length === 4);

const inside = await pixel(IN[0], IN[1]);
t('the fill tints what is under it', inside.join(',') !== bare.join(','), bare + ' -> ' + inside);
t('and it is a tint, not paint — what is underneath still shows through',
  Math.abs(inside[0] - bare[0]) + Math.abs(inside[1] - bare[1]) + Math.abs(inside[2] - bare[2]) < 240,
  bare + ' -> ' + inside);

const outside = await pixel(OUT[0], OUT[1]);
t('outside the border is untouched', outside.join(',') === bareOut.join(','), outside + ' vs ' + bareOut);

/* a region with fewer than three points encloses nothing ------------------ */

{
  for (const [x, y] of [[300, 1200], [420, 1240]]) {
    const s = await M(x, y);
    await p.mouse.click(s.x, s.y);
    await p.waitForTimeout(130);
  }
  await p.keyboard.press('Enter');
  await p.waitForTimeout(450);
  const modal = await p.$('.modal');
  t('two points do not make a region — no name is even asked for', modal === null);
  t('and nothing was added', (await items()).length === 1);
}

/* Escape abandons the outline -------------------------------------------- */

{
  const s = await M(700, 1150);
  await p.mouse.click(s.x, s.y);
  await p.waitForTimeout(150);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(250);
  const pending = await p.evaluate(() => document.querySelectorAll('.modal').length);
  t('Escape drops the points without asking for a name', pending === 0);
  t('and still nothing was added', (await items()).length === 1);
}

/* the name is drawn, and can be turned off ------------------------------- */

const centre = await p.evaluate(() => {
  const l = window.__cg.app.doc.layers.find((x) => x.kind === 'regions');
  return window.__cg.R.regionCentroid(l.ops[0].points);
});
t('the name sits at the area-weighted centroid, inside the shape',
  centre.x > 420 && centre.x < 1320 && centre.y > 330 && centre.y < 980,
  JSON.stringify(centre));

/* Ink on the map is what proves the name is drawn; the document already said
 * so. The two readings are of the same band of the same map, differing only
 * in the setting under test, so the comparison is of pixels rather than of a
 * threshold guessed against whatever happens to be underneath -- the sea is
 * darker than the lettering, and a count of dark pixels reads it as text. */
const band = () => p.evaluate(([cx, cy]) => Array.from(window.__cg.R.view.flat
  .getContext('2d').getImageData(cx - 180, cy - 30, 360, 60).data),
  [Math.round(centre.x), Math.round(centre.y)]);
const differing = (a, c) => {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] !== c[i] || a[i + 1] !== c[i + 1] || a[i + 2] !== c[i + 2]) n++;
  }
  return n;
};

const withName = await band();
await p.evaluate(() => {
  const l = window.__cg.app.doc.layers.find((x) => x.kind === 'regions');
  l.showNames = false;
  window.__cg.R.invalidate(l);
});
await p.waitForTimeout(400);
const withoutName = await band();
t('the name puts ink on the map, and Show names takes it off again',
  differing(withName, withoutName) > 400, differing(withName, withoutName) + ' pixels differ');
/* The halo is what keeps a name readable over dark terrain, and it is pale
 * against everything this band holds, so the band gets lighter when the name
 * is on. Drop the halo and this reading goes the other way. */
const luma = (d) => {
  let sum = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; n++; }
  return sum / n;
};
t('and it carries the pale halo that keeps it readable over terrain',
  luma(withName) > luma(withoutName) + 2,
  luma(withoutName).toFixed(1) + ' -> ' + luma(withName).toFixed(1));
await p.evaluate(() => {
  const l = window.__cg.app.doc.layers.find((x) => x.kind === 'regions');
  l.showNames = true;
  window.__cg.R.invalidate(l);
});
await p.waitForTimeout(400);

/* undo, and the select tool ---------------------------------------------- */

{
  await p.evaluate(async () => { (await import('/js/history.js')).undo(); });
  await p.waitForTimeout(450);
  t('undo takes the region back off', (await items()).length === 0);
  await p.evaluate(async () => { (await import('/js/history.js')).redo(); });
  await p.waitForTimeout(450);
  t('and redo puts it back', (await items()).length === 1);
}

{
  await tool('select');
  const s = await M(420, 380);                       // a border point
  const to = await M(300, 300);
  await p.mouse.move(s.x, s.y);
  await p.mouse.down();
  await p.mouse.move(to.x, to.y, { steps: 8 });
  await p.mouse.up();
  await p.waitForTimeout(400);
  const moved = (await items())[0];
  t('a region can be grabbed by a border point and moved',
    Math.abs(moved.points[0].x - 420) > 60, JSON.stringify(moved.points[0]));
  t('and the whole outline moves with it, not just the point grabbed',
    Math.abs(moved.points[1].x - 1180) > 60, JSON.stringify(moved.points[1]));
}

/* it survives a round trip ------------------------------------------------ */

const fingerprint = () => p.evaluate(() => {
  const c = window.__cg.R.view.flat;
  const s = document.createElement('canvas'); s.width = 64; s.height = 64;
  const x = s.getContext('2d'); x.drawImage(c, 0, 0, 64, 64);
  return Array.from(x.getImageData(0, 0, 64, 64).data).join(',');
});
const before = await fingerprint();
await p.click('#btn-save');
await p.waitForTimeout(1600);
await p.reload({ waitUntil: 'networkidle' });
await ready(p);
t('a map with a region reloads pixel-identical', before === (await fingerprint()));
const back = await items();
t('and the region comes back with its name', back.length === 1 && back[0].name === 'Duchy of Ashfen',
  JSON.stringify(back.map((o) => o.name)));

await p.evaluate(() => window.__cg.R.fitView());
await p.waitForTimeout(400);
await p.screenshot({ path: '/tmp/cg_regions.png' });
t('a screenshot of the finished map was taken', true, '/tmp/cg_regions.png');
t('no console errors', errs.length === 0, errs.slice(0, 3).join(' | '));

for (const [status, name, note] of out) {
  console.log(status.padEnd(5), name, note ? ' [' + note + ']' : '');
}
console.log(`\n${out.length - fails}/${out.length} passed`);
await b.close();
process.exit(fails ? 1 : 0);
