import { launch, base, ready } from './browser.mjs';
const b = await launch();
const p = await b.newPage({ viewport: { width: 1700, height: 1000 } });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
await p.goto(base('http://127.0.0.1:7871/'), { waitUntil: 'networkidle' });
await ready(p);

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

/* ---- turning one off and on again, without a page reload ---------------- */

const out = [];
let fails = 0;
const t = (name, pass, note) => { out.push([pass ? 'PASS' : 'FAIL', name, note == null ? '' : String(note)]); if (!pass) fails++; };
const state = () => p.evaluate(() => ({
  loaded: [...window.__cgx.extensions.loaded.keys()],
  rail: [...document.querySelectorAll('.tool')].map(n => n.dataset.tool),
  panels: [...document.querySelectorAll('#extension-panels .panel h3')].map(n => n.textContent),
  commands: window.__cgx.extensions.commands.map(c => c.title),
  kinds: [...window.__cgx.extensions.layerKinds.keys()],
  tokenOps: (window.__cg.app.doc.layers.find(l => l.kind === 'tokens') || { ops: [] }).ops.length,
}));

const before = await state();
t('the tokens tool is in the rail', before.rail.includes('battle-tokens:place'), before.rail.join(', '));
t('the coordinates panel is in the rail', before.panels.some(x => /coordinate/i.test(x)), before.panels.join(', '));
t('the aging command is in the palette', before.commands.some(c => /coffee/i.test(c)));

await p.evaluate(async () => {
  const m = await import('/js/extensions.js');
  await m.setExtensionEnabled('battle-tokens', false);
  await m.setExtensionEnabled('hex-coordinates', false);
  await m.setExtensionEnabled('map-aging', false);
});
await p.waitForTimeout(700);
const off = await state();
t('turning them off unloads them with no page reload', off.loaded.length === 0, off.loaded.join(', '));
t('their tool leaves the rail', !off.rail.includes('battle-tokens:place'), off.rail.join(', '));
t('their panel leaves the rail', !off.panels.some(x => /coordinate/i.test(x)), off.panels.join(', '));
t('their command leaves the palette', !off.commands.some(c => /coffee/i.test(c)));
t('their layer kinds stop rendering', off.kinds.length === 0, off.kinds.join(', '));

// The user's work is not a menu entry: the layers stay, ops and all.
t('but the tokens they placed are still in the document', off.tokenOps === before.tokenOps,
  `${before.tokenOps} then ${off.tokenOps}`);
const orphan = await p.evaluate(async () => {
  const d = await import('/js/doc.js');
  return d.LAYER_KINDS.tokens ? d.LAYER_KINDS.tokens.label : null;
});
t('and the layer says where its owner went', /off/i.test(orphan || ''), orphan);

await p.evaluate(async () => {
  const m = await import('/js/extensions.js');
  await m.setExtensionEnabled('battle-tokens', true);
  await m.setExtensionEnabled('hex-coordinates', true);
  await m.setExtensionEnabled('map-aging', true);
});
await p.waitForTimeout(900);
const on = await state();
t('turning them back on reloads them', on.loaded.length === 3, on.loaded.join(', '));
t('the tool comes back', on.rail.includes('battle-tokens:place'));
t('the panel comes back', on.panels.some(x => /coordinate/i.test(x)));
t('the command comes back', on.commands.some(c => /coffee/i.test(c)));
t('and the tokens are still there', on.tokenOps === before.tokenOps, on.tokenOps + ' tokens');

// A layer whose renderer came back has to draw again, not sit blank.
const drawn = await p.evaluate(() => {
  const l = window.__cg.app.doc.layers.find(x => x.kind === 'tokens');
  const c = window.__cg.R.canvasFor(l);
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let on = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 8) on++;
  return on;
});
t('the tokens layer is drawing again', drawn > 100, drawn + ' inked pixels');

await p.screenshot({ path: '/tmp/cg_ext_reload.png' });
for (const [status, name, note] of out) console.log(status.padEnd(5), name, note ? ' [' + note + ']' : '');
console.log(`\n${out.length - fails}/${out.length} passed`);
console.log('errors:', errs.slice(0, 6));
await b.close();
process.exit(fails || errs.length ? 1 : 0);
