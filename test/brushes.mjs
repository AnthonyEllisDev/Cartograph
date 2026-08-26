import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1700, height: 1000 } });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
await p.goto('http://127.0.0.1:7871/', { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);

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
await b.close();
