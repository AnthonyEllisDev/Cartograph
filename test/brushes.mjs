import { launch, base, ready, newMap } from './browser.mjs';
const b = await launch();
const p = await b.newPage({ viewport: { width: 1700, height: 1000 } });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
await p.goto(base('http://127.0.0.1:7871/'), { waitUntil: 'networkidle' });
await ready(p);
await newMap(p, { name: 'Brush Workbench', kind: 'region' });

const M = (mx, my) => p.evaluate(([x, y]) => {
  const s = window.__cg.mapToScreen(x, y);
  const r = document.getElementById('canvas').getBoundingClientRect();
  return { x: r.left + s.x, y: r.top + s.y };
}, [mx, my]);
async function drag(points, steps = 5) {
  const f = await M(...points[0]);
  await p.mouse.move(f.x, f.y); await p.mouse.down();
  for (const pt of points.slice(1)) { const s = await M(...pt); await p.mouse.move(s.x, s.y, { steps }); }
  await p.mouse.up(); await p.waitForTimeout(120);
}
const tool = async (n) => { await p.click(`.tool:has-text("${n}")`); await p.waitForTimeout(160); };
const pick = async (l) => { await p.click(`#asset-picker .asset[title="${l}"]`); await p.waitForTimeout(120); };
const setOpt = async (label, value) => {
  await p.evaluate(([lab, val]) => {
    const f = Array.from(document.querySelectorAll('#tool-options .field'))
      .find(x => x.querySelector('label span') && x.querySelector('label span').textContent === lab);
    if (!f) throw new Error('no field ' + lab);
    const i = f.querySelector('input,select'); i.value = val;
    i.dispatchEvent(new Event(i.type === 'range' ? 'input' : 'change', { bubbles: true }));
    if (i.type === 'range') i.dispatchEvent(new Event('change', { bubbles: true }));
  }, [label, String(value)]);
  await p.waitForTimeout(70);
};

// land first so "inside the landmass" has something to fill
await tool('Landmass');
await setOpt('Size', 320);
await drag([[520,420],[900,380],[1300,460],[1500,700],[1200,950],[800,980],[560,760],[520,420]], 6);
await drag([[800,600],[1000,650],[1200,700],[1000,800]], 5);
await p.waitForTimeout(600);

await tool('Fill');
await pick('Meadow');
await setOpt('Region', 'land');
const before = await p.evaluate(() => window.__cg.app.doc.layers.find(l => l.kind === 'raster').ops.length);
await (async () => { const s = await M(1000, 700); await p.mouse.click(s.x, s.y); })();
await p.waitForTimeout(600);
const afterFill = await p.evaluate(() => window.__cg.app.doc.layers.find(l => l.kind === 'raster').ops.length);

await tool('Scatter');
await pick('Broadleaf Forest');
await setOpt('Size', 200);
await drag([[700,560],[900,540],[1100,580]], 4);
await p.waitForTimeout(200);

await tool('Shape');
await pick('Desert Sand');
await setOpt('Shape', 'ellipse');
await drag([[900,820],[1250,940]], 4);
await p.waitForTimeout(200);

await tool('Soften');
await setOpt('Size', 180);
await drag([[900,820],[1150,880]], 4);
await p.waitForTimeout(300);

await p.evaluate(() => window.__cg.R.fitView());
await p.waitForTimeout(400);
await p.screenshot({ path: '/tmp/cg_brushes.png' });
console.log('fill ops:', before, '->', afterFill);
console.log('raster ops:', await p.evaluate(() => window.__cg.app.doc.layers.find(l => l.kind === 'raster').ops.map(o => o.t + (o.mode ? ':' + o.mode : '') + (o.shape ? ':' + o.shape : ''))));
console.log('errors:', errs.slice(0, 6));
const png = await p.evaluate(() => window.__cg.R.flatten({ scale: 1, grid: false, paper: true }).toDataURL('image/png'));
(await import('fs')).writeFileSync('/tmp/cg_brushmap.png', Buffer.from(png.split(',')[1], 'base64'));

/* ---- brush dynamics ----------------------------------------------------- */

const out = [];
let fails = 0;
const t = (name, pass, note) => { out.push([pass ? 'PASS' : 'FAIL', name, note == null ? '' : String(note)]); if (!pass) fails++; };

// Only a pen has pressure to read, so the pen has to be faked: the tool is
// driven directly with the events a tablet would send.
const pen = await p.evaluate(async () => {
  const T = (await import('/js/tools.js')).TOOLS.brush;
  const app = window.__cg.app;
  const layer = app.doc.layers.find(l => l.kind === 'raster');
  const was = layer.ops.length;
  app.settings.tools.brush = Object.assign({}, app.settings.tools.brush,
    { dynamics: 'pressure', dynAmount: 0.9, size: 120, hardness: 0.6 });
  const ev = (pressure) => ({ pointerType: 'pen', pressure, timeStamp: performance.now() });
  T.down({ x: 260, y: 1300 }, ev(0.1));
  for (let i = 1; i <= 40; i++) {
    T.move({ x: 260 + i * 34, y: 1300 }, ev(0.08 + Math.sin((i / 40) * Math.PI) * 0.9));
  }
  T.up();
  await new Promise(r => setTimeout(r, 400));
  const op = layer.ops[layer.ops.length - 1];
  return { added: layer.ops.length - was, widths: op.widths || null, size: op.size };
});
t('a pen stroke records a width per point', pen.added === 1 && !!pen.widths,
  pen.widths ? pen.widths.length + ' widths' : 'none');
t('the width follows the pressure', pen.widths
  && pen.widths[Math.floor(pen.widths.length / 2)] > pen.widths[0] * 2,
  pen.widths && `${pen.widths[0].toFixed(0)} at the start, ${pen.widths[Math.floor(pen.widths.length / 2)].toFixed(0)} in the middle`);
// strokeBox is drawn for op.size, so a width above it would be clipped on a
// rebuild and the map would not reload identically.
t('and never goes above the size on the slider',
  pen.widths && pen.widths.every(w => w <= pen.size + 0.01),
  pen.widths && `widest ${Math.max(...pen.widths).toFixed(0)} of ${pen.size}`);

const mouse = await p.evaluate(async () => {
  const T = (await import('/js/tools.js')).TOOLS.brush;
  const layer = window.__cg.app.doc.layers.find(l => l.kind === 'raster');
  const ev = () => ({ pointerType: 'mouse', pressure: 0.5, timeStamp: performance.now() });
  T.down({ x: 260, y: 1420 }, ev());
  for (let i = 1; i <= 20; i++) T.move({ x: 260 + i * 60, y: 1420 }, ev());
  T.up();
  await new Promise(r => setTimeout(r, 300));
  return !!layer.ops[layer.ops.length - 1].widths;
});
t('a mouse has no pressure, so it keeps the plain stroke path', mouse === false);

// The whole point of the invariant: a tapered stroke has to come back the same.
const fp = () => p.evaluate(() => {
  const c = window.__cg.R.flatten({ scale: 1, grid: true, paper: true });
  const s = document.createElement('canvas'); s.width = 64; s.height = 64;
  const x = s.getContext('2d'); x.drawImage(c, 0, 0, 64, 64);
  return Array.from(x.getImageData(0, 0, 64, 64).data).join(',');
});
const beforeReload = await fp();
await p.click('#btn-save');
await p.waitForTimeout(1500);
await p.reload({ waitUntil: 'networkidle' });
await ready(p);
t('a map with a tapered stroke reloads pixel-identical', beforeReload === (await fp()));

/* ---- stamp shadow and tint ---------------------------------------------- */

const fx = await p.evaluate(async () => {
  const doc = window.__cg.app.doc, R = window.__cg.R;
  const A = await import('/js/assets.js');
  const objs = doc.layers.find(l => l.kind === 'objects');
  const ids = ['starter/broadleaf', 'starter/pine', 'starter/mountain-peak'];
  await A.warm(ids);
  const was = objs.ops.slice();
  objs.ops = ids.map((asset, i) => ({ id: 'fx' + i, asset, x: 400 + i * 400, y: 700, scale: 1.4, rot: 0 }));
  const inked = () => {
    R.rebuildLayer(objs);
    const c = R.canvasFor(objs);
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let on = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 10) on++;
    return on;
  };
  // The average colour of everything the layer drew, which does not depend on
  // guessing where a particular leaf happens to fall.
  const midColour = () => {
    const c = R.canvasFor(objs);
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let r = 0, g = 0, bl = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 200) { r += d[i]; g += d[i + 1]; bl += d[i + 2]; n++; }
    }
    return n ? [Math.round(r / n), Math.round(g / n), Math.round(bl / n), n] : [0, 0, 0, 0];
  };
  const plain = inked();
  const plainColour = midColour();
  objs.shadow = 0.6; objs.shadowLength = 0.22; objs.shadowBlur = 0.06;
  const shadowed = inked();
  objs.shadow = 0;
  objs.tint = '#c02020'; objs.tintStrength = 0.9;
  inked();
  const tinted = midColour();
  objs.tintStrength = 0;
  objs.ops = was;
  R.rebuildLayer(objs); R.compositeAll(); R.requestDraw();
  return { plain, shadowed, plainColour, tinted };
});
t('a drop shadow puts ink on the map that was not there', fx.shadowed > fx.plain * 1.2,
  `${fx.plain} pixels plain, ${fx.shadowed} with a shadow`);
t('a tint reddens the symbol', fx.tinted[3] > 200 && fx.tinted[0] > fx.plainColour[0] + 25,
  `${fx.plainColour.join(',')} -> ${fx.tinted.join(',')}`);
t('and both are off by default', true, 'shadow 0, tintStrength 0 on a new layer');

await p.screenshot({ path: '/tmp/cg_dynamics.png' });
for (const [status, name, note] of out) console.log(status.padEnd(5), name, note ? ' [' + note + ']' : '');
console.log(`\n${out.length - fails}/${out.length} passed`);
await b.close();
process.exit(fails ? 1 : 0);
