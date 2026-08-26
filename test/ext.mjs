import { launch, base } from './browser.mjs';
const b = await launch();
const p = await b.newPage({ viewport: { width: 1700, height: 1000 } });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
await p.goto(base('http://127.0.0.1:7871/'), { waitUntil: 'networkidle' });
await p.waitForTimeout(1600);

console.log('tools:', await p.$$eval('.tool', ns => ns.map(n => n.querySelector('span').textContent)));
console.log('extension panels:', await p.$$eval('#extension-panels .panel h3', ns => ns.map(n => n.textContent)));
console.log('loaded:', await p.evaluate(() => Array.from(window.__cgx.extensions.loaded.keys())));
console.log('commands:', await p.evaluate(() => window.__cgx.extensions.commands.map(c => c.title)));
console.log('errors so far:', errs.slice(0, 5));

// battle map + tokens
await p.click('.tab[data-tab="projects"]'); await p.waitForTimeout(300);
await p.click('#btn-new-project'); await p.waitForTimeout(400);
await p.selectOption('.modal select >> nth=0', 'battle'); await p.waitForTimeout(200);
await p.selectOption('.modal select >> nth=1', '20x15');
await p.click('.modal .btn-primary'); await p.waitForTimeout(900);

const M = (mx, my) => p.evaluate(([x, y]) => {
  const s = window.__cg.mapToScreen(x, y);
  const r = document.getElementById('canvas').getBoundingClientRect();
  return { x: r.left + s.x, y: r.top + s.y };
}, [mx, my]);
const clickAt = async (x, y) => { const s = await M(x, y); await p.mouse.click(s.x, s.y); await p.waitForTimeout(90); };

await p.click('.tool:has-text("Token")'); await p.waitForTimeout(200);
for (const [cx, cy] of [[5,5],[6,5],[7,6],[9,8],[11,7]]) await clickAt(cx*70+35, cy*70+35);
await p.waitForTimeout(300);
console.log('tokens:', await p.evaluate(() => {
  const l = window.__cg.app.doc.layers.find(x => x.kind === 'tokens');
  return l ? l.ops.map(t => ({ x: t.x, y: t.y, label: t.label })) : null;
}));

// coordinates panel: add the layer
await p.click('#extension-panels button.btn'); await p.waitForTimeout(500);
console.log('coords layer:', await p.evaluate(() => !!window.__cg.app.doc.layers.find(l => l.kind === 'coords')));

// aging command via the palette
await p.keyboard.press('Control+k'); await p.waitForTimeout(300);
await p.fill('.palette-head input', 'coffee'); await p.waitForTimeout(250);
console.log('palette hits:', await p.$$eval('.palette-item .ptitle', ns => ns.map(n => n.textContent)));
await p.keyboard.press('Enter'); await p.waitForTimeout(600);

await p.evaluate(() => window.__cg.R.fitView()); await p.waitForTimeout(400);
await p.screenshot({ path: '/tmp/cg_ext.png' });
console.log('errors:', errs.slice(0, 6));
await b.close();
