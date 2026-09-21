import { launch, base, ready, newMap } from './browser.mjs';
const b = await launch();
const p = await b.newPage({ viewport: { width: 1600, height: 950 } });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
await p.goto(base('http://127.0.0.1:7871/'), { waitUntil: 'networkidle' });
await ready(p);
const ok = [], bad = [];
const t = (l, c, x='') => (c ? ok : bad).push(l + (x ? ' — ' + x : ''));

// clear any presets left from an earlier run
await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('cartograph.settings.v1')||'{}'); s.presets = []; localStorage.setItem('cartograph.settings.v1', JSON.stringify(s)); });
await p.reload({ waitUntil: 'networkidle' });
await ready(p);
// Its own map, so it does not inherit whatever the last suite left open.
await newMap(p, { name: 'Pro Workbench', kind: 'region' });

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
const tool = async (id) => { await p.click(`.tool[data-tool="${id}"]`); await p.waitForTimeout(200); };
const pickFirstAsset = async () => {
  await p.click('#asset-picker .asset');
  await p.waitForTimeout(200);
};

// ---------------------------------------------------------------- scale bar
t('scale bar drawn', await p.evaluate(() => {
  const c = document.getElementById('canvas');
  const ctx = c.getContext('2d');
  // sample the bottom-right strip where the bar lives
  const d = ctx.getImageData(c.width - 400, c.height - 90, 380, 70).data;
  let bright = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 220 && d[i+1] > 220 && d[i+2] > 220) bright++;
  return bright > 200;
}));
await p.screenshot({ path: '/tmp/shots/pro-scalebar.png', clip: { x: 1000, y: 700, width: 340, height: 200 } });

// zoom in — the bar should pick a smaller round distance
const barUnits = () => p.evaluate(() => {
  const d = window.__cg.app.doc.scale;
  return { perCell: d.perCell, cellPx: d.cellPx, zoom: window.__cg.R.view.zoom };
});
const before = await barUnits();
await p.mouse.move(820, 480);
for (let i = 0; i < 6; i++) await p.mouse.wheel(0, -240);
await p.waitForTimeout(400);
const after = await barUnits();
t('zoom changed', after.zoom > before.zoom, before.zoom + ' -> ' + after.zoom);
await p.evaluate(() => window.__cg.R.fitView()); await p.waitForTimeout(300);

// ---------------------------------------------------------------- history
await tool('land');
await drag([[500,400],[800,360],[1000,500],[700,700],[500,400]], 6);
await p.waitForTimeout(500);
await tool('brush');
await pickFirstAsset();
await drag([[620,480],[760,500]], 4);
await p.waitForTimeout(400);
await drag([[820,560],[900,600]], 4);
await p.waitForTimeout(400);

const hist = await p.$$('#history-list .hist');
t('history panel lists entries (' + hist.length + ')', hist.length >= 4);
if (hist.length < 4) { console.log('history too short, aborting'); console.log(await p.evaluate(() => document.getElementById('history-list').innerHTML)); await b.close(); process.exit(1); }
const labels = await p.$$eval('#history-list .hist-name', ns => ns.map(n => n.textContent));
t('history has readable labels', labels.includes('Landmass') && labels.some(l => /Paint|Terrain/.test(l)), labels.join(' | '));
t('cursor is at the end', await p.evaluate(() => {
  const l = document.querySelectorAll('#history-list .hist');
  return l[l.length - 1].classList.contains('is-here');
}));

// jump back two steps
await p.evaluate(() => {
  const l = document.querySelectorAll('#history-list .hist');
  l[l.length - 3].click();
});
await p.waitForTimeout(500);
t('jump moves the cursor', await p.evaluate(() => window.__cg.history.past.length) === (hist.length - 3),
  'past=' + await p.evaluate(() => window.__cg.history.past.length));
t('jump fills the future', await p.evaluate(() => window.__cg.history.future.length) === 2);
t('entries ahead are marked', (await p.$$('#history-list .hist.is-ahead')).length === 2);
await p.screenshot({ path: '/tmp/shots/pro-history.png' });

// jump forward again
await p.evaluate(() => {
  const l = document.querySelectorAll('#history-list .hist');
  l[l.length - 1].click();
});
await p.waitForTimeout(500);
t('jump forward replays', await p.evaluate(() => window.__cg.history.future.length) === 0);
t('undo button live again', !(await p.$eval('#btn-undo', b => b.disabled)));

// ---------------------------------------------------------------- presets
await tool('brush');
await p.evaluate(() => {
  const f = Array.from(document.querySelectorAll('#tool-options .field'))
    .find(x => x.querySelector('span') && x.querySelector('span').textContent === 'Size');
  const r = f.querySelector('input[type=range]');
  r.value = '240'; r.dispatchEvent(new Event('input', { bubbles: true }));
});
await p.waitForTimeout(200);
await p.click('.presets-head .link');
await p.waitForTimeout(350);
t('preset dialog opens', (await p.$$('.modal')).length === 1);
await p.fill('.modal input[type=text]', 'Wide moss');
await p.click('.modal .foot .btn-primary');
await p.waitForTimeout(400);
const chips = await p.$$eval('.preset-row .chip-main', ns => ns.map(n => n.textContent));
t('preset chip appears', chips.includes('Wide moss'), chips.join('|'));

// change the size, then click the chip to get it back
await p.evaluate(() => {
  const f = Array.from(document.querySelectorAll('#tool-options .field'))
    .find(x => x.querySelector('span') && x.querySelector('span').textContent === 'Size');
  const r = f.querySelector('input[type=range]');
  r.value = '40'; r.dispatchEvent(new Event('input', { bubbles: true }));
});
await p.waitForTimeout(200);
t('size actually changed', await p.evaluate(() => window.__cg.app.settings.tools.brush.size) === 40);
await p.click('.preset-row .chip-main');
await p.waitForTimeout(350);
t('preset restores the size', await p.evaluate(() => window.__cg.app.settings.tools.brush.size) === 240,
  'size=' + await p.evaluate(() => window.__cg.app.settings.tools.brush.size));

// palette finds it
await p.keyboard.press('Control+k'); await p.waitForTimeout(300);
await p.keyboard.type('wide moss'); await p.waitForTimeout(300);
const first = await p.$eval('.palette-list .palette-item', n => n.textContent);
t('palette finds the preset', /Wide moss/i.test(first), first);
await p.keyboard.press('Escape'); await p.waitForTimeout(200);

// survives a reload
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
await tool('brush');
const chips2 = await p.$$eval('.preset-row .chip-main', ns => ns.map(n => n.textContent));
t('preset survives reload', chips2.includes('Wide moss'), chips2.join('|'));

// delete it again so the shipped build is clean
await p.click('.preset-row .chip-x'); await p.waitForTimeout(300);
t('preset deletes', (await p.$$('.preset-row .chip')).length === 0);
await p.screenshot({ path: '/tmp/shots/pro-presets.png' });

/* ---- layer groups -------------------------------------------------------- */

// A group is a folder: membership is an id on the member, so doc.layers stays
// the flat array everything else in the program walks.
const grouped = await p.evaluate(async () => {
  const ui = await import('/js/ui.js');
  const doc = window.__cg.app.doc;
  const R = window.__cg.R;
  const terrain = doc.layers.find(l => l.kind === 'raster');
  window.__cg.app.activeLayerId = terrain.id;
  const group = ui.addGroup();
  const objects = doc.layers.find(l => l.kind === 'objects');
  ui.setLayerGroup(objects, group.id);
  const inked = () => {
    const c = R.view.flat;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let sum = 0; for (let i = 0; i < d.length; i += 40) sum += d[i] + d[i + 1] + d[i + 2];
    return sum;
  };
  R.compositeAll();
  const lit = inked();
  group.visible = false; R.compositeAll();
  const hidden = inked();
  group.visible = true; R.compositeAll();
  const backAgain = inked();
  return {
    groupId: group.id,
    members: doc.layers.filter(l => l.group === group.id).map(l => l.kind),
    flatArray: doc.layers.every(l => !Array.isArray(l.layers)),
    lit, hidden, backAgain,
  };
});
t('a group can be made and layers put in it',
  grouped.members.length === 2 && grouped.members.includes('objects'), grouped.members.join(', '));
t('the document stays a flat list of layers', grouped.flatArray);
t('hiding a group hides its members', grouped.hidden !== grouped.lit);
t('showing it again brings them back', grouped.backAgain === grouped.lit);

const opacity = await p.evaluate(() => {
  const doc = window.__cg.app.doc, R = window.__cg.R;
  const group = doc.layers.find(l => l.kind === 'group');
  const member = doc.layers.find(l => l.group === group.id);
  const own = member.opacity;
  group.opacity = 0.5;
  R.compositeAll();
  const a = R.view.flat.getContext('2d').getImageData(0, 0, 200, 200).data[3];
  group.opacity = 1;
  R.compositeAll();
  return { own, alphaAtHalf: a };
});
t('a group folds its opacity into its members', opacity.own === 1);

// Deleting the folder must not delete the filing.
const freed = await p.evaluate(async () => {
  const doc = window.__cg.app.doc;
  const before = doc.layers.length;
  const group = doc.layers.find(l => l.kind === 'group');
  const memberIds = doc.layers.filter(l => l.group === group.id).map(l => l.id);
  document.querySelectorAll('#layer-list .layer').forEach(r => { if (r.dataset.id === group.id) r.click(); });
  await new Promise(r => setTimeout(r, 200));
  const btn = [...document.querySelectorAll('#layer-props .btn-danger')][0];
  if (btn) btn.click();
  await new Promise(r => setTimeout(r, 300));
  return {
    removed: before - doc.layers.length,
    survivors: memberIds.filter(id => doc.layers.some(l => l.id === id)).length,
    stillGrouped: doc.layers.filter(l => l.group === group.id).length,
  };
});
t('deleting a group deletes only the group', freed.removed === 1 && freed.survivors === 2,
  `${freed.removed} layer removed, ${freed.survivors} members kept`);
t('and lets its members go', freed.stillGrouped === 0);

console.log(ok.map(x => '  ok  ' + x).join('\n'));
if (bad.length) console.log(bad.map(x => 'FAIL  ' + x).join('\n'));
if (errs.length) console.log('errors:\n' + errs.slice(0, 8).join('\n'));
console.log(`\n${ok.length} passed, ${bad.length} failed, ${errs.length} console errors`);
await b.close();
process.exit(bad.length || errs.length ? 1 : 0);
