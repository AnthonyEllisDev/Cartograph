/* The starter pack's art: what was added, and that it arrives.
 *
 * The pack is generated on first launch and then left alone, so art added to
 * the generators afterwards never reached anyone who had already run the
 * program. The pack now carries the version of the generators that baked it,
 * and an older one is rebaked from its own seed. This suite checks the art that
 * version 2 added, and the rebake itself.
 *
 * Start the server first:  python3 app.py --no-browser --port 7871
 * Then:                    node test/art.mjs [http://127.0.0.1:7871]
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, base, ready, newMap } from './browser.mjs';

const out = [];
let fails = 0;
function t(name, pass, note) {
  out.push([pass ? 'PASS' : 'FAIL', name, note == null ? '' : String(note)]);
  if (!pass) fails++;
}
function report() {
  for (const [status, name, note] of out) console.log(status.padEnd(5), name, note ? ' [' + note + ']' : '');
  console.log(`\n${out.length - fails}/${out.length} passed`);
}

process.on('unhandledRejection', (err) => {
  report();
  console.log('\nthrew: ' + (err && err.message));
  process.exit(1);
});

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEXTURES = ['flagstone', 'planks', 'cobblestone'];
const STAMPS = ['barrel', 'crate', 'table', 'bed', 'chest', 'bookshelf', 'rug', 'well'];

/* ---- the rebake, outside the browser ------------------------------------- */

{
  // A pack baked before artVersion existed, at a small tile size so the bake
  // is quick, from a seed that is not the default: the rebake must keep both.
  const dir = mkdtempSync(join(tmpdir(), 'cg-art-'));
  const pack = join(dir, 'assets', 'packs', 'starter');
  mkdirSync(pack, { recursive: true });
  writeFileSync(join(pack, 'pack.json'), JSON.stringify({
    id: 'starter', name: 'Starter Pack', generated: true, seed: 'harbour', tileSize: 32, assets: [],
  }));
  const py = (code) => execFileSync('python3', ['-c', code], { cwd: ROOT, encoding: 'utf8' }).trim();
  const run = `import app; app.ROOT = ${JSON.stringify(dir)}; print(app.ensure_starter_pack({}))`;
  const first = py(run).split('\n').pop();
  const m = JSON.parse(readFileSync(join(pack, 'pack.json'), 'utf8'));
  const ids = new Set(m.assets.map((a) => a.id));
  t('an older pack is rebaked on launch', first === 'True' && m.artVersion >= 2, `${first}, artVersion ${m.artVersion}`);
  t('from the seed and tile size it was baked with', m.seed === 'harbour' && m.tileSize === 32,
    `${m.seed} ${m.tileSize}`);
  t('and it gains the new textures and symbols',
    TEXTURES.every((n) => ids.has('starter/' + n)) && STAMPS.every((n) => ids.has('starter/' + n)),
    `${m.assets.length} assets`);
  const again = py(run).split('\n').pop();
  t('a current pack is left alone', again === 'False', again);
  writeFileSync(join(pack, 'pack.json'), '{ not json');
  const broken = py(run).split('\n').pop();
  t('a pack.json that does not parse is rebaked rather than fatal',
    broken === 'True' && JSON.parse(readFileSync(join(pack, 'pack.json'), 'utf8')).artVersion >= 2, broken);

  // The recipes already in a pack are what every saved map is drawn from. The
  // same seed has to give the same bytes, or a rebake changes old maps.
  const same = py(`
import os, sys, tempfile, filecmp
from tools import genpack
a, b = tempfile.mkdtemp(), tempfile.mkdtemp()
genpack.build(a, "v1", 32, log=lambda *x: None)
genpack.build(b, "v1", 32, log=lambda *x: None)
bad = [f for sub in ("terrain", "stamps") for f in os.listdir(os.path.join(a, sub))
       if not filecmp.cmp(os.path.join(a, sub, f), os.path.join(b, sub, f), shallow=False)]
print(len(bad))`);
  t('baking the same seed twice gives the same files', same === '0', same + ' differ');
  rmSync(dir, { recursive: true, force: true });
}

/* ---- the art, in the editor ------------------------------------------------ */

const b = await launch();
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = [];
const external = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
p.on('request', (r) => {
  const u = new URL(r.url());
  if (!['127.0.0.1', 'localhost'].includes(u.hostname) && !['data:', 'blob:'].includes(u.protocol)) external.push(r.url());
});
await p.goto(base('http://127.0.0.1:7871/'), { waitUntil: 'networkidle' });
await ready(p);
await newMap(p, { name: 'Art Check', kind: 'battle', size: '20x15' });

const lib = await p.evaluate(async ([tex, st]) => {
  const A = await import('/js/assets.js');
  const get = (id) => A.library.byId.get(id);
  return {
    textures: tex.map((n) => get('starter/' + n)).map((a) => a && [a.kind, a.group, a.tileable]),
    stamps: st.map((n) => [0, 2, 3].map((v) => get('starter/' + n + (v ? '-' + v : '')))
      .map((a) => a && [a.kind, a.group])),
  };
}, [TEXTURES, STAMPS]);
t('three floor textures are in the library',
  lib.textures.every((a) => a && a[0] === 'terrain' && a[1] === 'floor' && a[2] === true),
  JSON.stringify(lib.textures));
t('eight furnishings, three variants of each',
  lib.stamps.every((v) => v.every((a) => a && a[0] === 'stamp' && a[1] === 'furnishing')),
  lib.stamps.map((v) => v.filter(Boolean).length).join(','));

// Each texture tiles: the step across the wrap is no bigger than the biggest
// step between two neighbouring lines inside the tile. A paved floor has
// joints, so the comparison is with the worst of them, not with an average;
// a seam is a line of difference that nothing inside the tile matches.
const seams = await p.evaluate(async (tex) => {
  const A = await import('/js/assets.js');
  const res = {};
  for (const n of tex) {
    const img = await A.image('starter/' + n);
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    const W = c.width, H = c.height;
    const at = (i, j) => (j * W + i) * 4;
    const diff = (a, b2) => Math.abs(d[a] - d[b2]) + Math.abs(d[a + 1] - d[b2 + 1]) + Math.abs(d[a + 2] - d[b2 + 2]);
    const col = (i, k) => { let s = 0; for (let j = 0; j < H; j++) s += diff(at(i, j), at(k, j)); return s; };
    const row = (j, k) => { let s = 0; for (let i = 0; i < W; i++) s += diff(at(i, j), at(i, k)); return s; };
    let worstX = 0, worstY = 0;
    for (let i = 0; i < W - 1; i++) worstX = Math.max(worstX, col(i, i + 1));
    for (let j = 0; j < H - 1; j++) worstY = Math.max(worstY, row(j, j + 1));
    res[n] = { x: +(col(W - 1, 0) / Math.max(1, worstX)).toFixed(2),
               y: +(row(H - 1, 0) / Math.max(1, worstY)).toFixed(2), opaque: d[3] === 255 };
  }
  return res;
}, TEXTURES);
t('each texture meets its own opposite edge',
  Object.values(seams).every((s) => s.x <= 1 && s.y <= 1 && s.opaque), JSON.stringify(seams));

// The floor layer takes a new texture from the layer panel, as any other.
await p.evaluate(async () => {
  const A = await import('/js/app.js');
  A.setActiveLayer(A.app.doc.layers.find((l) => l.kind === 'floor').id);
});
await p.waitForTimeout(200);
await p.click('.tab[data-tab="map"]').catch(() => {});
const floorSet = await p.evaluate(async () => {
  const app = window.__cg.app, R = window.__cg.R;
  const floor = app.doc.layers.find((l) => l.kind === 'floor');
  const sel = [...document.querySelectorAll('select')].find((s) =>
    [...s.options].some((o) => o.value === 'starter/flagstone'));
  if (!sel) return { found: false };
  sel.value = 'starter/flagstone';
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 400));
  const c = R.canvasFor(floor);
  const d = c.getContext('2d').getImageData(0, 0, 200, 200).data;
  let dark = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 75 && d[i + 3] > 200) dark++;
  return { found: true, texture: floor.texture, dark };
});
t('the floor can be laid in flagstones from the layer panel',
  floorSet.found && floorSet.texture === 'starter/flagstone' && floorSet.dark > 200, JSON.stringify(floorSet));

// The dungeon generator offers them as its floor.
const offered = await p.evaluate(async () => {
  const D = await import('/js/dungeon.js');
  D.dungeonDialog();
  await new Promise((r) => setTimeout(r, 400));
  const sel = [...document.querySelectorAll('.modal select')].find((s) =>
    [...s.options].some((o) => o.value === 'starter/parchment'));
  const vals = sel ? [...sel.options].map((o) => o.value) : [];
  return vals;
});
t('the dungeon generator offers the new floors',
  ['starter/flagstone', 'starter/planks', 'starter/cobblestone'].every((v) => offered.includes(v)),
  offered.length + ' options');
await p.keyboard.press('Escape');
await p.waitForTimeout(200);

// A brush stroke in floorboards, through the real tool.
const M = (mx, my) => p.evaluate(([x, y]) => {
  const s = window.__cg.mapToScreen(x, y);
  const r = document.getElementById('canvas').getBoundingClientRect();
  return { x: r.left + s.x, y: r.top + s.y };
}, [mx, my]);
await p.evaluate(async () => {
  const A = await import('/js/app.js');
  A.setActiveLayer(A.app.doc.layers.find((l) => l.kind === 'raster').id);
});
await p.click('.tool[data-tool="brush"]');
await p.waitForTimeout(200);
await p.fill('#asset-picker input[type=text]', 'floorboards');
await p.waitForTimeout(150);
await p.click('#asset-picker .asset[title="Wooden Floorboards"]');
await p.waitForTimeout(200);
{
  const a = await M(160, 760), z = await M(1220, 760);
  await p.mouse.move(a.x, a.y); await p.mouse.down();
  await p.mouse.move(z.x, z.y, { steps: 12 }); await p.mouse.up();
  await p.waitForTimeout(300);
}
const stroke = await p.evaluate(() => {
  const raster = window.__cg.app.doc.layers.find((l) => l.kind === 'raster');
  const op = raster.ops[raster.ops.length - 1];
  return op ? op.tex : null;
});
t('the brush paints in floorboards', stroke === 'starter/planks', stroke);
await p.fill('#asset-picker input[type=text]', '');

// Every furnishing placed with the Stamp tool, one variant of each.
await p.click('.tool[data-tool="stamp"]');
await p.waitForTimeout(200);
const spots = [[200, 200], [330, 200], [520, 200], [760, 260], [930, 200], [1120, 180], [500, 460], [1000, 520]];
const labels = ['Barrel', 'Crate', 'Table', 'Bed', 'Chest', 'Bookshelf', 'Rug', 'Well'];
for (let i = 0; i < labels.length; i++) {
  await p.fill('#asset-picker input[type=text]', labels[i].toLowerCase());
  await p.waitForTimeout(120);
  await p.click(`#asset-picker .asset[title="${labels[i]}"] >> nth=0`);
  await p.waitForTimeout(120);
  const s = await M(...spots[i]);
  await p.mouse.click(s.x, s.y);
  await p.waitForTimeout(160);
}
await p.fill('#asset-picker input[type=text]', '');
await p.waitForTimeout(600);
const placed = await p.evaluate(() => {
  const objs = window.__cg.app.doc.layers.find((l) => l.kind === 'objects');
  const ids = objs.ops.flatMap((o) => o.assets || (o.asset ? [o.asset] : []));
  return [...new Set(ids.map((id) => id.replace(/-\d+$/, '')))];
});
t('all eight can be placed with the Stamp tool',
  STAMPS.every((n) => placed.includes('starter/' + n)), placed.join(' '));

const drawn = await p.evaluate(() => {
  const R = window.__cg.R;
  const objs = window.__cg.app.doc.layers.find((l) => l.kind === 'objects');
  const c = R.canvasFor(objs);
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let on = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 10) on++;
  return on;
});
t('and they are drawn on the map', drawn > 40000, drawn + ' pixels');

// A map in the new art reloads exactly as it was saved.
const fp = () => p.evaluate(() => {
  const R = window.__cg.R;
  const c = R.flatten({ scale: 0.5, grid: false, paper: false, lights: false });
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let h = 0; for (let i = 0; i < d.length; i += 7) h = (h * 31 + d[i]) >>> 0;
  return h;
});
const before = await fp();
await p.evaluate(async () => { const a = await import('/js/app.js'); await a.saveProject({ silent: true }); });
await p.reload({ waitUntil: 'networkidle' });
await ready(p);
await p.waitForTimeout(800);
const after = await fp();
t('a map in the new art reloads pixel-identical', before === after, `${before} ${after}`);

await p.screenshot({ path: process.env.CG_SHOT || join(tmpdir(), 'cg-art.png') });

t('no request off 127.0.0.1', external.length === 0, external.slice(0, 3).join(' '));
t('no console errors', errs.length === 0, errs.slice(0, 3).join(' | '));

report();
await b.close();
process.exit(fails ? 1 : 0);
