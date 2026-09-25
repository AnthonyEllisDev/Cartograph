/* Seeded land generation.
 *
 * Start the server first:  python3 app.py --no-browser --port 7871
 * Then:                    node test/generate.mjs [http://127.0.0.1:7871]
 *
 * The generator's promises are the ones a person relies on without thinking:
 * the same seed gives the same land, "40%" means forty per cent, the result is
 * ordinary landmass that the eraser and undo work on, and the map comes back
 * from disk exactly as it went away. And a terrain fill bound to the landmass
 * follows it, which it did not before this suite existed.
 */

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

const fingerprint = () => p.evaluate(() => {
  const c = window.__cg.R.flatten({ scale: 1, grid: true, paper: true });
  const s = document.createElement('canvas'); s.width = 64; s.height = 64;
  const x = s.getContext('2d'); x.drawImage(c, 0, 0, 64, 64);
  return Array.from(x.getImageData(0, 0, 64, 64).data).join(',');
});

/** Share of the landmass mask that is land, and whether any of it is within
 *  `edge` pixels of the frame on each side. */
const maskStats = (edge = 0) => p.evaluate((e) => {
  const doc = window.__cg.app.doc;
  const land = doc.layers.find((l) => l.kind === 'land');
  const m = window.__cg.R.maskFor(land);
  const d = m.getContext('2d').getImageData(0, 0, m.width, m.height).data;
  let on = 0, n = 0;
  const near = { left: 0, right: 0, top: 0, bottom: 0 };
  for (let y = 0; y < m.height; y += 2) {
    for (let x = 0; x < m.width; x += 2) {
      const a = d[(y * m.width + x) * 4 + 3];
      n++;
      if (a > 127) {
        on++;
        if (x < e) near.left++;
        if (x >= m.width - e) near.right++;
        if (y < e) near.top++;
        if (y >= m.height - e) near.bottom++;
      }
    }
  }
  return { share: on / n, near };
}, edge);

const landOps = () => p.evaluate(() =>
  window.__cg.app.doc.layers.find((l) => l.kind === 'land').ops.map((o) => o.t + (o.rings ? ':gen' : '')).join(','));

/** Open the dialog from the Landmass tool, set it up, and press Generate. */
const generate = async ({ seed, shape, land, existing } = {}) => {
  await p.click('.tool[data-tool="land"]');
  await p.waitForTimeout(200);
  await p.click('[data-action="generate-land"]');
  await p.waitForSelector('.modal .gen-preview');
  if (shape) {
    await p.evaluate((v) => {
      const sel = Array.from(document.querySelectorAll('.modal .field'))
        .find((f) => f.querySelector('label span') && f.querySelector('label span').textContent === 'Shape')
        .querySelector('select');
      sel.value = v; sel.dispatchEvent(new Event('change', { bubbles: true }));
    }, shape);
  }
  if (land != null) {
    await p.evaluate((v) => {
      const inp = Array.from(document.querySelectorAll('.modal .field'))
        .find((f) => f.querySelector('label span') && f.querySelector('label span').textContent === 'Land')
        .querySelector('input');
      inp.value = String(v); inp.dispatchEvent(new Event('input', { bubbles: true }));
    }, land);
  }
  if (existing) {
    await p.evaluate((v) => {
      const sel = Array.from(document.querySelectorAll('.modal .field'))
        .find((f) => f.querySelector('label span') && f.querySelector('label span').textContent === 'Existing land')
        .querySelector('select');
      sel.value = v; sel.dispatchEvent(new Event('change', { bubbles: true }));
    }, existing);
  }
  if (seed) await p.fill('[data-gen="seed"]', seed);
  await p.click('.modal .btn-primary');
  await p.waitForTimeout(1400);
};

const undo = async () => { await p.evaluate(async () => { (await import('/js/history.js')).undo(); }); await p.waitForTimeout(900); };
const redo = async () => { await p.evaluate(async () => { (await import('/js/history.js')).redo(); }); await p.waitForTimeout(900); };

const saveAndReload = async () => {
  await p.click('#btn-save');
  await p.waitForTimeout(2000);
  await p.reload({ waitUntil: 'networkidle' });
  await ready(p);
  await p.waitForTimeout(600);
};

/* ========================================================================== *
 * The generator on its own terms.
 * ========================================================================== */

await newMap(p, { name: 'Generated Coast', kind: 'region' });

const pure = await p.evaluate(async () => {
  const G = await import('/js/generate.js');
  const a = JSON.stringify(G.generateLand({ seed: 'harbour' }, 2048, 1536));
  const again = JSON.stringify(G.generateLand({ seed: 'harbour' }, 2048, 1536));
  const other = JSON.stringify(G.generateLand({ seed: 'harbours' }, 2048, 1536));
  const op = JSON.parse(a);
  return {
    same: a === again, differs: a !== other, rings: op.rings.length,
    flat: op.rings.every((r) => r.length >= 6 && r.length % 2 === 0 && r.every((v) => Number.isFinite(v))),
    gen: op.gen, bytes: a.length,
  };
});
t('the same seed gives the same land, to the byte', pure.same);
t('and a different seed gives different land', pure.differs);
t('the op is closed rings of plain numbers, with the settings beside them',
  pure.rings > 0 && pure.flat && pure.gen && pure.gen.seed === 'harbour' && pure.gen.shape === 'continent',
  JSON.stringify(pure.gen));
t('and it is kilobytes, not a raster', pure.bytes < 60000, pure.bytes + ' bytes');

/* the dialog ---------------------------------------------------------------- */

await p.click('.tool[data-tool="land"]');
await p.waitForTimeout(200);
t('the Landmass tool offers the generator',
  await p.evaluate(() => !!document.querySelector('#tool-options [data-action="generate-land"]')));
await p.click('[data-action="generate-land"]');
await p.waitForSelector('.modal .gen-preview');
const previewInk = await p.evaluate(() => {
  const c = document.querySelector('.modal .gen-preview');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let land = 0, sea = 0;
  for (let i = 0; i < d.length; i += 4) { if (d[i + 1] > 130) land++; else sea++; }
  return { land, sea };
});
t('its preview shows land and sea before anything is committed',
  previewInk.land > 0 && previewInk.sea > 0, JSON.stringify(previewInk));
await p.click('.modal .foot .btn:not(.btn-primary)');              // Cancel
await p.waitForTimeout(300);
t('cancelling it leaves the map alone', (await landOps()) === '');

/* generating ------------------------------------------------------------------ */

await generate({ seed: 'harbour', land: 0.4 });
t('generating writes one landmass op', (await landOps()) === 'stroke:gen', await landOps());
const first = await maskStats(40);
// The threshold is picked by rank, so this is exact on the samples; the rings
// are simplified and specks dropped, so the painted share is close, not equal.
t('"Land 40%" covers about forty per cent of the map', Math.abs(first.share - 0.4) < 0.04,
  (first.share * 100).toFixed(1) + '%');
t('and keeps clear of the frame when asked to',
  Object.values(first.near).every((v) => v === 0), JSON.stringify(first.near));
t('the generate step is in the history',
  await p.evaluate(() => window.__cg.history.past.at(-1).label === 'Generate land'));

await p.evaluate(() => window.__cg.R.fitView());
await p.waitForTimeout(300);
await p.screenshot({ path: '/tmp/cg_generate.png' });

// It is ordinary landmass: the eraser takes a bite out of it.
await p.click('.tool[data-tool="erase"]');
await p.waitForTimeout(200);
await p.evaluate(() => {
  const land = window.__cg.app.doc.layers.find((l) => l.kind === 'land');
  window.__cg.app.activeLayerId = land.id;
});
const bite = await p.evaluate(async () => {
  // The middle of the map is land on a continent at 40%; erase across it.
  const R = window.__cg.R;
  const doc = window.__cg.app.doc;
  const pt = (x, y) => { const s = R.mapToScreen(x, y); const r = document.getElementById('canvas').getBoundingClientRect(); return { x: r.left + s.x, y: r.top + s.y }; };
  return [pt(doc.width * 0.42, doc.height * 0.5), pt(doc.width * 0.58, doc.height * 0.5)];
});
await p.mouse.move(bite[0].x, bite[0].y);
await p.mouse.down();
await p.mouse.move(bite[1].x, bite[1].y, { steps: 6 });
await p.mouse.up();
await p.waitForTimeout(700);
const bitten = await maskStats();
t('the eraser works on generated land like any other', bitten.share < first.share - 0.005,
  (first.share * 100).toFixed(2) + '% -> ' + (bitten.share * 100).toFixed(2) + '%');

const genPrint = await fingerprint();
await saveAndReload();
t('a generated and then erased map reloads pixel-identical', genPrint === (await fingerprint()));

/* replace, add, undo ------------------------------------------------------------ */

const beforeReplace = await fingerprint();
await generate({ seed: 'kestrel', shape: 'archipelago', existing: 'replace' });
t('"Replace it" starts the layer again', (await landOps()) === 'stroke:gen,stroke,clear,stroke:gen', await landOps());
const replaced = await fingerprint();
t('and the land is different', replaced !== beforeReplace);
await undo();
t('undo puts back exactly the land that was there', (await fingerprint()) === beforeReplace);
await redo();
t('and redo brings the new land back exactly', (await fingerprint()) === replaced);

await generate({ seed: 'thorn', shape: 'island', existing: 'add' });
t('"Add to it" keeps what is there', (await landOps()) === 'stroke:gen,stroke,clear,stroke:gen,stroke:gen', await landOps());

/* a coast runs off the edge, without an ink line along the frame -------------- */

await newMap(p, { name: 'Generated West Coast', kind: 'region' });
await generate({ seed: 'salt', shape: 'west' });
const coast = await maskStats(4);
t('a west coast reaches the western edge', coast.near.left > 0, JSON.stringify(coast.near));
const frameInk = await p.evaluate(() => {
  // Down the left-hand column, land should be land texture all the way to the
  // frame: the contour was carried past it, so no ink ring was grown there.
  const doc = window.__cg.app.doc;
  const land = doc.layers.find((l) => l.kind === 'land');
  const m = window.__cg.R.maskFor(land).getContext('2d').getImageData(0, 0, 2, doc.height).data;
  let solid = 0, soft = 0;
  for (let y = 0; y < doc.height; y++) {
    const a = m[(y * 2) * 4 + 3];
    if (a > 250) solid++; else if (a > 5) soft++;
  }
  return { solid, soft };
});
t('and the land meets the frame solid rather than as a coastline',
  frameInk.solid > 100 && frameInk.soft < frameInk.solid * 0.05, JSON.stringify(frameInk));

/* a lake is a hole ----------------------------------------------------------------- */

const hole = await p.evaluate(() => {
  const R = window.__cg.R;
  const c = document.createElement('canvas'); c.width = 200; c.height = 200;
  const ctx = c.getContext('2d');
  R.applyMaskStroke(ctx, { t: 'stroke', mode: 'shape', shape: 'generated', size: 0, hardness: 1,
    rings: [[10, 10, 190, 10, 190, 190, 10, 190], [70, 70, 130, 70, 130, 130, 70, 130]], points: [] }, null);
  const a = (x, y) => ctx.getImageData(x, y, 1, 1).data[3];
  return { outer: a(30, 30), lake: a(100, 100) };
});
t('a ring inside another is water, not more land', hole.outer === 255 && hole.lake === 0, JSON.stringify(hole));

/* ========================================================================== *
 * A terrain fill bound to the landmass follows it.
 * ========================================================================== */

await newMap(p, { name: 'Following Fill', kind: 'region' });
await generate({ seed: 'harbour' });

// The Fill tool at its default, Region "Inside the landmass", onto the Terrain
// layer. That is the ordinary way to say "this continent is forest".
await p.click('.tool[data-tool="fill"]');
await p.waitForTimeout(250);
await p.evaluate(() => {
  const f = Array.from(document.querySelectorAll('#tool-options .field'))
    .find((x) => x.querySelector('label span') && x.querySelector('label span').textContent === 'Region');
  const s = f.querySelector('select'); s.value = 'land'; s.dispatchEvent(new Event('change', { bubbles: true }));
});
await p.waitForTimeout(200);
await p.click('#asset-picker .asset[title="Broadleaf Forest"]');
await p.waitForTimeout(250);
await p.evaluate(() => {
  const terrain = window.__cg.app.doc.layers.find((l) => l.kind === 'raster');
  window.__cg.app.activeLayerId = terrain.id;
});
const canvasBox = await p.evaluate(() => {
  const s = window.__cg.R.mapToScreen(1024, 768);
  const r = document.getElementById('canvas').getBoundingClientRect();
  return { x: r.left + s.x, y: r.top + s.y };
});
await p.mouse.click(canvasBox.x, canvasBox.y);
await p.waitForTimeout(900);
const filled = await p.evaluate(() => window.__cg.app.doc.layers.find((l) => l.kind === 'raster').ops.map((o) => o.shape).join(','));
t('precondition: the land is filled, bound to the landmass', filled === 'land', filled);

await generate({ seed: 'kestrel', existing: 'replace' });
// On screen now, against the same map rebuilt from nothing but its ops.
const drift = await p.evaluate(() => {
  const R = window.__cg.R;
  const grab = () => {
    const c = R.flatten({ scale: 0.25, grid: false, paper: false });
    return c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  };
  const shown = grab();
  for (const l of window.__cg.app.doc.layers) if (l.kind === 'land') R.rebuildLayer(l);
  for (const l of window.__cg.app.doc.layers) if (l.kind !== 'land') R.rebuildLayer(l);
  R.compositeAll();
  const rebuilt = grab();
  let n = 0;
  for (let i = 0; i < shown.length; i++) if (Math.abs(shown[i] - rebuilt[i]) > 6) n++;
  return n;
});
t('the fill follows the coast when the land is regenerated', drift === 0, drift + ' samples differ from a rebuild');

// And by the brush, which is the other route to the mask: a stroke of land
// out into the sea, then the same comparison with a rebuild.
await p.click('.tool[data-tool="land"]');
await p.waitForTimeout(200);
const seaward = await p.evaluate(() => {
  const R = window.__cg.R;
  const r = document.getElementById('canvas').getBoundingClientRect();
  return [[140, 140], [520, 300]].map(([x, y]) => { const s = R.mapToScreen(x, y); return { x: r.left + s.x, y: r.top + s.y }; });
});
await p.mouse.move(seaward[0].x, seaward[0].y);
await p.mouse.down();
await p.mouse.move(seaward[1].x, seaward[1].y, { steps: 6 });
await p.mouse.up();
await p.waitForTimeout(900);
const drift2 = await p.evaluate(() => {
  const R = window.__cg.R;
  const grab = () => {
    const c = R.flatten({ scale: 0.25, grid: false, paper: false });
    return c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  };
  const shown = grab();
  for (const l of window.__cg.app.doc.layers) if (l.kind === 'land') R.rebuildLayer(l);
  for (const l of window.__cg.app.doc.layers) if (l.kind !== 'land') R.rebuildLayer(l);
  R.compositeAll();
  const rebuilt = grab();
  let n = 0;
  for (let i = 0; i < shown.length; i++) if (Math.abs(shown[i] - rebuilt[i]) > 6) n++;
  return n;
});
t('and when more land is painted on with the brush', drift2 === 0, drift2 + ' samples differ from a rebuild');

// Now the fill's layer below a see-through landmass. doc.layers is bottom
// first and was rebuilt in that order on opening, so the fill was drawn
// against a landmass mask that did not exist yet and vanished -- invisible
// under an opaque landmass, which is why it needs the opacity to be seen.
await p.evaluate(() => {
  const doc = window.__cg.app.doc;
  const terrain = doc.layers.find((l) => l.kind === 'raster');
  const land = doc.layers.find((l) => l.kind === 'land');
  doc.layers.splice(doc.layers.indexOf(terrain), 1);
  doc.layers.splice(doc.layers.indexOf(land), 0, terrain);
  land.opacity = 0.55;
  window.__cg.R.compositeAll(); window.__cg.R.requestDraw();
});
await p.waitForTimeout(300);
const below = await p.evaluate(() => {
  const d = window.__cg.app.doc.layers;
  return d.findIndex((l) => l.kind === 'raster') < d.findIndex((l) => l.kind === 'land');
});
const fillPrint = await fingerprint();
await saveAndReload();
t('and with it below a see-through landmass, the map reloads pixel-identical',
  below && fillPrint === (await fingerprint()), 'below=' + below);

/* the command palette ------------------------------------------------------------- */

await p.keyboard.press('Control+k');
await p.waitForTimeout(300);
await p.keyboard.type('generate land');
await p.waitForTimeout(300);
const listed = await p.evaluate(() => document.body.innerText.includes('Generate land'));
await p.keyboard.press('Escape');
await p.waitForTimeout(200);
t('the command palette can find it', listed);

t('no console errors', errs.length === 0, errs.slice(0, 3).join(' | '));

for (const [status, name, note] of out) {
  console.log(status.padEnd(5), name, note ? ' [' + note + ']' : '');
}
console.log(`\n${out.length - fails}/${out.length} passed`);
await b.close();
process.exit(fails ? 1 : 0);
