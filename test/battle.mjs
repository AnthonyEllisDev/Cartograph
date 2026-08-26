import { launch, base } from './browser.mjs';
import fs from 'fs';
const b = await launch();
const p = await b.newPage({ viewport: { width: 1700, height: 1000 } });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
await p.goto(base('http://127.0.0.1:7871/'), { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);

// new battle map through the real dialog
await p.click('.tab[data-tab="projects"]');
await p.waitForTimeout(300);
await p.click('#btn-new-project');
await p.waitForTimeout(400);
await p.fill('.modal input[type=text]', 'Cellar Fight');
await p.selectOption('.modal select >> nth=0', 'battle');
await p.waitForTimeout(200);
await p.selectOption('.modal select >> nth=1', '30x20');
await p.click('.modal .btn-primary');
await p.waitForTimeout(900);

console.log('doc:', await p.evaluate(() => {
  const d = window.__cg.app.doc;
  return { kind: d.kind, w: d.width, h: d.height, scale: d.scale, snap: d.snap,
           layers: d.layers.map(l => l.kind) };
}));

const M = (mx, my) => p.evaluate(([x, y]) => {
  const s = window.__cg.mapToScreen(x, y);
  const r = document.getElementById('canvas').getBoundingClientRect();
  return { x: r.left + s.x, y: r.top + s.y };
}, [mx, my]);
const clickAt = async (x, y) => { const s = await M(x, y); await p.mouse.click(s.x, s.y); await p.waitForTimeout(80); };
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

// a stone floor room
await tool('Shape');
await pick('Bare Rock');
await setOpt('Shape', 'rect');
const a = await M(3.5*70, 3.5*70), c = await M(20.5*70, 14.5*70);
await p.mouse.move(a.x, a.y); await p.mouse.down(); await p.mouse.move(c.x, c.y, { steps: 8 }); await p.mouse.up();
await p.waitForTimeout(400);

// walls round it
await tool('Wall');
await setOpt('Kind', 'wall');
await clickAt(3*70, 3*70); await clickAt(21*70, 3*70); await clickAt(21*70, 15*70);
await clickAt(3*70, 15*70); await clickAt(3*70, 3*70);
await p.keyboard.press('Enter');
await p.waitForTimeout(200);
// an inner wall
await clickAt(12*70, 3*70); await clickAt(12*70, 9*70);
await p.keyboard.press('Enter');
await p.waitForTimeout(200);
// a door in it
await setOpt('Kind', 'door');
await clickAt(12*70, 9*70); await clickAt(12*70, 11*70);
await p.waitForTimeout(300);

console.log('walls:', await p.evaluate(() => window.__cg.app.doc.layers.find(l => l.kind === 'walls').ops
  .map(o => ({ kind: o.kind, n: o.points.length, snapped: o.points.every(pt => pt.x % 70 === 0 && pt.y % 70 === 0) }))));

// measure
await tool('Measure');
const m1 = await M(3*70, 3*70), m2 = await M(13*70, 3*70);
await p.mouse.move(m1.x, m1.y); await p.mouse.down(); await p.mouse.move(m2.x, m2.y, { steps: 5 });
await p.waitForTimeout(300);
await p.screenshot({ path: '/tmp/cg_battle.png' });
await p.mouse.up();

// VTT export
const uvtt = await p.evaluate(() => {
  const c = window.__cg.R.flatten({ scale: 1, grid: true, paper: true });
  return window.__cg.R.toUVTT(c.toDataURL('image/png'));
});
console.log('uvtt:', JSON.stringify({ format: uvtt.format, resolution: uvtt.resolution,
  sight: uvtt.line_of_sight.length, portals: uvtt.portals.length,
  firstWall: uvtt.line_of_sight[0] && uvtt.line_of_sight[0].slice(0, 2),
  imageBytes: uvtt.image.length }));
console.log('errors:', errs.slice(0, 6));
await b.close();
