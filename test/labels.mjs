/* Labels: straight ones, and ones that follow a curve.
 *
 * Start the server first:  python3 app.py --no-browser --port 7871
 * Then:                    node test/labels.mjs [http://127.0.0.1:7871]
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

const M = (mx, my) => p.evaluate(([x, y]) => {
  const s = window.__cg.mapToScreen(x, y);
  const r = document.getElementById('canvas').getBoundingClientRect();
  return { x: r.left + s.x, y: r.top + s.y };
}, [mx, my]);
const tool = async (n) => { await p.click(`.tool[data-tool="${n}"]`); await p.waitForTimeout(190); };
const setOpt = async (label, value) => {
  await p.evaluate(([lab, val]) => {
    const f = Array.from(document.querySelectorAll('#tool-options .field'))
      .find((x) => x.querySelector('label span') && x.querySelector('label span').textContent === lab);
    const i = f.querySelector('input,select');
    i.value = val;
    i.dispatchEvent(new Event(i.type === 'range' ? 'input' : 'change', { bubbles: true }));
    if (i.type === 'range') i.dispatchEvent(new Event('change', { bubbles: true }));
  }, [label, String(value)]);
  await p.waitForTimeout(130);
};
const labels = () => p.evaluate(() => window.__cg.app.doc.layers.find((l) => l.kind === 'labels').ops
  .map((o) => ({ text: o.text, x: o.x, y: o.y, n: o.points ? o.points.length : 0 })));

await p.click('.tab[data-tab="projects"]');
await p.waitForTimeout(300);
await p.click('#btn-new-project');
await p.waitForTimeout(400);
await p.fill('.modal input[type=text]', 'Named Places');
await p.selectOption('.modal select >> nth=0', 'region');
await p.waitForTimeout(200);
await p.click('.modal .btn-primary');
await p.waitForTimeout(1100);

await tool('label');

/* a straight one, the way it has always worked ---------------------------- */

{
  const s = await M(1000, 1100);
  await p.mouse.click(s.x, s.y);
  await p.waitForTimeout(400);
  await p.fill('.modal input[type=text]', 'Harrowgate');
  await p.click('.modal .btn-primary');
  await p.waitForTimeout(500);
}
let ops = await labels();
t('a click still places a straight label', ops.length === 1 && ops[0].n === 0,
  JSON.stringify(ops[0]));

/* a curved one ------------------------------------------------------------ */

await setOpt('Style', 'region');
await setOpt('Size', '54');
const arc = [];
for (let i = 0; i <= 24; i++) {
  const u = i / 24;
  arc.push([300 + u * 1400, 620 - Math.sin(u * Math.PI) * 260]);
}
{
  const s0 = await M(...arc[0]);
  await p.mouse.move(s0.x, s0.y);
  await p.mouse.down();
  for (const q of arc.slice(1)) { const s = await M(...q); await p.mouse.move(s.x, s.y); }
  await p.mouse.up();
  await p.waitForTimeout(420);
  await p.fill('.modal input[type=text]', 'THE SUNDERED COAST');
  await p.click('.modal .btn-primary');
  await p.waitForTimeout(600);
}
ops = await labels();
const curved = ops.find((o) => o.text === 'THE SUNDERED COAST');
t('a drag places one that follows the curve', curved && curved.n > 5, curved && curved.n + ' points');

// The letters have to actually be on the curve rather than on a baseline
// through its ends, which is the difference between this and a rotated label.
const ink = await p.evaluate(() => {
  const l = window.__cg.app.doc.layers.find((x) => x.kind === 'labels');
  const c = window.__cg.R.canvasFor(l);
  const g = c.getContext('2d');
  // The text is centred on the curve, so find where it actually is first
  // rather than assuming it fills the whole drag.
  const whole = g.getImageData(0, 0, c.width, 900).data;
  let left = -1, right = -1;
  for (let i = 3; i < whole.length; i += 4) {
    if (whole[i] > 20) { const col = (i / 4) % c.width; if (left < 0 || col < left) left = col; if (col > right) right = col; }
  }
  const topAt = (px) => {
    const d = g.getImageData(Math.max(0, px - 25), 0, 50, 900).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 20) return Math.floor((i / 4) / 50);
    return -1;
  };
  return { left, right, middleTop: topAt((left + right) / 2), endTop: topAt(left + 40) };
});
t('its middle letters sit higher than its end letters',
  ink.middleTop > 0 && ink.endTop > 0 && ink.middleTop < ink.endTop - 60,
  `text spans x ${ink.left.toFixed(0)}–${ink.right.toFixed(0)}; middle top y≈${ink.middleTop}, end top y≈${ink.endTop}`);

/* moving it ---------------------------------------------------------------- */

await tool('select');
{
  const from = await M(1000, 370), to = await M(1000, 520);
  await p.mouse.move(from.x, from.y);
  await p.mouse.down();
  await p.mouse.move(to.x, to.y, { steps: 6 });
  await p.mouse.up();
  await p.waitForTimeout(400);
}
const moved = (await labels()).find((o) => o.text === 'THE SUNDERED COAST');
const curvePoints = await p.evaluate(() => {
  const o = window.__cg.app.doc.layers.find((l) => l.kind === 'labels').ops
    .find((q) => q.text === 'THE SUNDERED COAST');
  return { x: o.x, y: o.y, first: o.points[0] };
});
t('dragging a curved label moves the curve with it',
  Math.abs(curvePoints.x - curvePoints.first.x) < 0.01
  && Math.abs(curvePoints.y - curvePoints.first.y) < 0.01,
  `anchor (${curvePoints.x.toFixed(0)}, ${curvePoints.y.toFixed(0)}) vs curve start (${curvePoints.first.x.toFixed(0)}, ${curvePoints.first.y.toFixed(0)})`);
t('and it really moved', moved && moved.y > 400, moved && moved.y.toFixed(0));

/* a curve drawn backwards still reads left to right ------------------------ */

const backwards = await p.evaluate(() => {
  const doc = window.__cg.app.doc, R = window.__cg.R;
  const l = doc.layers.find((x) => x.kind === 'labels');
  const forward = [{ x: 400, y: 1200 }, { x: 900, y: 1200 }, { x: 1400, y: 1200 }];
  const sample = (pts) => {
    l.ops = [{ id: 'probe', text: 'ABCDE', x: pts[0].x, y: pts[0].y, points: pts,
               style: 'region', size: 60, color: '#000000', halo: false }];
    R.rebuildLayer(l);
    const c = R.canvasFor(l);
    const d = c.getContext('2d').getImageData(0, 1140, c.width, 120).data;
    // where along x does the ink start and end?
    let first = -1, last = -1;
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] > 20) { const col = ((i / 4) % c.width); if (first < 0 || col < first) first = col; if (col > last) last = col; }
    }
    return { first, last };
  };
  const a = sample(forward);
  const bck = sample(forward.slice().reverse());
  l.ops = [];
  R.rebuildLayer(l); R.compositeAll(); R.requestDraw();
  return { a, b: bck };
});
t('a curve drawn right to left is turned round rather than set upside down',
  Math.abs(backwards.a.first - backwards.b.first) < 6 && Math.abs(backwards.a.last - backwards.b.last) < 6,
  `${JSON.stringify(backwards.a)} vs ${JSON.stringify(backwards.b)}`);

/* and it survives being put away ------------------------------------------ */

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
t('a map with a curved label reloads pixel-identical', before === (await fingerprint()));

await p.evaluate(() => window.__cg.R.fitView());
await p.waitForTimeout(400);
await p.screenshot({ path: '/tmp/cg_labels.png' });
t('no console errors', errs.length === 0, errs.slice(0, 3).join(' | '));

for (const [status, name, note] of out) {
  console.log(status.padEnd(5), name, note ? ' [' + note + ']' : '');
}
console.log(`\n${out.length - fails}/${out.length} passed`);
await b.close();
process.exit(fails ? 1 : 0);
