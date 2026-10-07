/* Caverns, and the underground art that came with them (art version 3).
 *
 * The dungeon generator laid out rooms and corridors on the grid; it now also
 * grows a cave, whose walls follow the rock rather than the grid lines. This
 * suite checks the cave the way dungeon.mjs checks rooms -- what it writes,
 * that it is one piece, that it relights, undoes and reloads -- and that the
 * rooms are untouched. Then the three textures and eight symbols added the
 * same day.
 *
 * Start the server first:  python3 app.py --no-browser --port 7871
 * Then:                    node test/caverns.mjs [http://127.0.0.1:7871]
 */

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

const TEXTURES = [['cave-floor', 'floor'], ['cave-water', 'water'], ['lava', 'floor']];
const STAMPS = ['pillar', 'stalagmites', 'rubble', 'campfire', 'altar', 'stairs', 'brazier', 'mushrooms'];
const LABELS = ['Pillar', 'Stalagmites', 'Rubble', 'Campfire', 'Altar', 'Stairs Down', 'Brazier', 'Cave Mushrooms'];

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
await newMap(p, { name: 'Cavern Check', kind: 'battle', size: '40x30' });

/* ---- the dialog ------------------------------------------------------------ */

await p.evaluate(async () => { const D = await import('/js/dungeon.js'); D.dungeonDialog(); });
await p.waitForSelector('[data-dungeon="style"] select', { timeout: 5000 });
const shown = () => p.evaluate(() => {
  const vis = (label) => {
    const f = [...document.querySelectorAll('.modal .gen.dungeon > *')]
      .find((e) => (e.querySelector('label span, span') || {}).textContent === label);
    return f ? !f.hidden && f.offsetParent !== null : null;
  };
  const floor = [...document.querySelectorAll('.modal select')].find((s) =>
    [...s.options].some((o) => o.value === 'starter/parchment'));
  return { size: vis('Room size'), doors: vis('Doors'), hollow: vis('Hollow'),
           secret: vis('Hide a few doors on the loops'), floor: floor && floor.value };
});
const asRooms = await shown();
t('the dialog opens on rooms, with the rooms\' settings and no Hollow',
  asRooms.size && asRooms.doors && asRooms.secret && asRooms.hollow === false, JSON.stringify(asRooms));
await p.selectOption('[data-dungeon="style"] select', 'caverns');
await p.waitForTimeout(250);
const asCaves = await shown();
t('choosing Caverns hides the room settings and offers Hollow',
  asCaves.size === false && asCaves.doors === false && asCaves.secret === false && asCaves.hollow, JSON.stringify(asCaves));
t('and lays the cave in the cave floor rather than parchment', asCaves.floor === 'starter/cave-floor', asCaves.floor);
const planInk = await p.evaluate(() => {
  const c = document.querySelector('[data-dungeon="preview"]');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let floor = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 190) floor++;
  return floor / (c.width * c.height);
});
t('the plan shows a cave', planInk > 0.15 && planInk < 0.8, planInk.toFixed(2));
await p.fill('[data-dungeon="seed"]', 'grotto-sump-7');
await p.waitForTimeout(150);
await p.click('.modal button:has-text("Generate")');
await p.waitForTimeout(1500);

/* ---- what it wrote --------------------------------------------------------- */

const made = await p.evaluate(() => {
  const doc = window.__cg.app.doc;
  const raster = doc.layers.find((l) => l.kind === 'raster');
  const walls = doc.layers.find((l) => l.kind === 'walls');
  const notes = doc.layers.find((l) => l.kind === 'notes');
  const floor = raster.ops.find((o) => o.gen && o.gen.kind === 'dungeon');
  const shade = raster.ops.find((o) => o.gen && o.gen.kind === 'dungeon-shade');
  const cell = 70;
  const offGrid = walls.ops.flatMap((w) => w.points).filter((q) => Math.abs(q.x / cell - Math.round(q.x / cell)) > 0.05).length;
  const closed = walls.ops.every((w) => w.points.length > 3 && w.points[0].x === w.points[w.points.length - 1].x
    && w.points[0].y === w.points[w.points.length - 1].y);
  // Even-odd: a point is on the floor when it is inside an odd number of rings.
  const inside = (x, y) => floor.rings.reduce((n, r) => {
    let c = false;
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      if ((r[i + 1] > y) !== (r[j + 1] > y) && x < (r[j] - r[i]) * (y - r[i + 1]) / (r[j + 1] - r[i + 1]) + r[i]) c = !c;
    }
    return n + (c ? 1 : 0);
  }, 0) % 2 === 1;
  const pinsIn = notes ? notes.ops.filter((n) => inside(n.x, n.y)).length : 0;
  return {
    style: floor && floor.gen.style, tex: floor && floor.tex, rings: floor ? floor.rings.length : 0,
    shade: !!shade, walls: walls.ops.length, kinds: [...new Set(walls.ops.map((w) => w.kind))],
    offGrid, closed, notes: notes ? notes.ops.length : 0, pinsIn,
    titles: notes ? [...new Set(notes.ops.map((n) => n.title))] : [],
    inFrame: walls.ops.flatMap((w) => w.points).every((q) => q.x > 0 && q.y > 0 && q.x < doc.width && q.y < doc.height),
  };
});
t('a cavern floor is written with its rings and the rock around it',
  made.style === 'caverns' && made.tex === 'starter/cave-floor' && made.rings > 0 && made.shade, JSON.stringify(made));
t('its walls are closed runs of plain wall, no doors', made.walls > 0 && made.closed && made.kinds.join() === 'wall',
  `${made.walls} walls, ${made.kinds}`);
t('and follow the rock, not the grid lines', made.offGrid > 50, made.offGrid + ' points off the grid');
t('inside the map', made.inFrame, made.inFrame);
t('every chamber has a numbered note, on the cave floor',
  made.notes >= 3 && made.pinsIn === made.notes && made.titles[0] === 'Entrance', `${made.pinsIn}/${made.notes} ${made.titles}`);

const shape = await p.evaluate(async () => {
  const D = await import('/js/dungeon.js');
  const doc = window.__cg.app.doc;
  const f = D.frame(doc);
  const params = { style: 'caverns', seed: 'grotto-sump-7', rooms: 12 };
  // One piece: a flood fill from any open point reaches every open point.
  const cave = D.caveLayout(params, f.cols, f.rows);
  const { W, H, open } = cave;
  let total = 0, start = -1;
  for (let i = 0; i < W * H; i++) if (open[i]) { total++; if (start < 0) start = i; }
  const seen = new Uint8Array(W * H); const q = [start]; seen[start] = 1;
  for (let k = 0; k < q.length; k++) {
    const c = q[k], x = c % W, y = (c - x) / W;
    for (const j of [c + 1, c - 1, c + W, c - W]) if (j >= 0 && j < W * H && open[j] && !seen[j] && Math.abs((j % W) - x) <= 1) { seen[j] = 1; q.push(j); }
  }
  const strip = (r) => JSON.stringify([r.floor.rings, r.walls.map((w) => w.points), r.notes.map((n) => [n.x, n.y, n.title])]);
  const a = D.generateDungeon(Object.assign({ tex: 'starter/cave-floor' }, params), doc);
  const b2 = D.generateDungeon(Object.assign({ tex: 'starter/cave-floor' }, params), doc);
  const other = D.generateDungeon(Object.assign({ tex: 'starter/cave-floor' }, params, { seed: 'another-one' }), doc);
  const hollow = (o) => { const c = D.caveLayout(Object.assign({}, params, { open: o }), f.cols, f.rows); return c.open.reduce((s, v) => s + v, 0); };
  // Rooms are as they were: settings with no style mean rooms, on the grid.
  const rooms = D.generateDungeon({ seed: 'barrow-crypt-1' }, doc);
  const onGrid = rooms.walls.flatMap((w) => w.points).every((q2) => Math.abs(q2.x / f.cell - Math.round(q2.x / f.cell)) < 1e-6);
  return { reach: q.length, total, same: strip(a) === strip(b2), differs: strip(a) !== strip(other),
           lo: hollow(0.35), hi: hollow(0.65), roomsStyle: D.normalise({}).style, onGrid,
           roomsHaveDoors: rooms.walls.some((w) => w.kind === 'door'), chambers: a.rooms };
});
t('every part of the cave can be walked to', shape.total > 0 && shape.reach === shape.total, `${shape.reach}/${shape.total}`);
t('the same seed gives the same cave, another seed another', shape.same && shape.differs, `${shape.same} ${shape.differs}`);
t('Hollow makes more of the rock hollow', shape.hi > shape.lo * 1.2, `${shape.lo} -> ${shape.hi}`);
t('the chambers asked for are a ceiling, not a promise', shape.chambers >= 1 && shape.chambers <= 12, shape.chambers);
t('settings with no style still give rooms and corridors, on the grid',
  shape.roomsStyle === 'rooms' && shape.onGrid && shape.roomsHaveDoors, JSON.stringify(shape));

/* ---- light, undo, reload ---------------------------------------------------- */

const lit = await p.evaluate(async () => {
  const { app, R } = window.__cg;
  const doc = app.doc;
  const notes = doc.layers.find((l) => l.kind === 'notes');
  const lights = doc.layers.find((l) => l.kind === 'lights');
  const walls = doc.layers.find((l) => l.kind === 'walls');
  const at = notes.ops[0];
  lights.ops.push({ id: 'l-cave', x: at.x, y: at.y, bright: 700, dim: 1400, color: '#ffd28a' });
  lights.ambient = 0.9;
  lights.visible = true;
  R.invalidate(lights);
  const count = () => {
    const d = R.canvasFor(lights).getContext('2d').getImageData(0, 0, doc.width, doc.height).data;
    let n = 0; for (let i = 3; i < d.length; i += 16) if (d[i] < 120) n++;
    return n;
  };
  const withWalls = count();
  walls.visible = false; R.relight(walls); R.invalidate(lights);
  const without = count();
  walls.visible = true; R.relight(walls); R.invalidate(lights);
  const back = count();
  lights.ops = lights.ops.filter((o) => o.id !== 'l-cave');
  R.invalidate(lights);
  return { withWalls, without, back, segs: R.wallSegments(doc).length };
});
t('the cave walls cast shadows', lit.segs > 50 && lit.withWalls < lit.without * 0.8 && lit.back === lit.withWalls,
  JSON.stringify(lit));

const fp = () => p.evaluate(() => {
  const R = window.__cg.R;
  const c = R.flatten({ scale: 0.5, grid: false, paper: false, lights: false });
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let h = 0; for (let i = 0; i < d.length; i += 7) h = (h * 31 + d[i]) >>> 0;
  return h;
});
const counts = () => p.evaluate(() => {
  const doc = window.__cg.app.doc;
  const n = (k) => doc.layers.filter((l) => l.kind === k).reduce((s, l) => s + l.ops.length, 0);
  return [n('raster'), n('walls'), n('notes')].join('/');
});
const withCave = await counts();
await p.evaluate(async () => { const H = await import('/js/history.js'); H.undo(); });
await p.waitForTimeout(400);
const undone = await counts();
await p.evaluate(async () => { const H = await import('/js/history.js'); H.redo(); });
await p.waitForTimeout(400);
const redone = await counts();
t('generating a cavern is one step: undo takes it all away, redo puts it back',
  undone.split('/').every((v) => v === '0') && redone === withCave, `${withCave} -> ${undone} -> ${redone}`);

const before = await fp();
await p.evaluate(async () => { const a = await import('/js/app.js'); await a.saveProject({ silent: true }); });
const slug = await p.evaluate(() => window.__cg.app.slug);
await p.reload({ waitUntil: 'networkidle' });
await ready(p);
await p.waitForFunction((s) => window.__cg.app.slug === s, slug, { timeout: 10000 }).catch(() => {});
await p.waitForTimeout(800);
const after = await fp();
t('a cavern map reloads pixel-identical', before === after && slug, `${before} ${after}`);

/* ---- the art ---------------------------------------------------------------- */

const lib = await p.evaluate(async ([tex, st]) => {
  const A = await import('/js/assets.js');
  const get = (id) => A.library.byId.get(id);
  return {
    textures: tex.map(([n]) => get('starter/' + n)).map((a) => a && [a.kind, a.group, a.tileable]),
    stamps: st.map((n) => [0, 2, 3].map((v) => get('starter/' + n + (v ? '-' + v : '')))
      .map((a) => a && [a.kind, a.group])),
  };
}, [TEXTURES, STAMPS]);
t('three underground textures are in the library',
  lib.textures.every((a, i) => a && a[0] === 'terrain' && a[1] === TEXTURES[i][1] && a[2] === true),
  JSON.stringify(lib.textures));
t('eight underground symbols, three variants of each',
  lib.stamps.every((v) => v.every((a) => a && a[0] === 'stamp' && a[1] === 'underground')),
  lib.stamps.map((v) => v.filter(Boolean).length).join(','));

const seams = await p.evaluate(async (tex) => {
  const A = await import('/js/assets.js');
  const res = {};
  for (const [n] of tex) {
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

await newMap(p, { name: 'Underground Art', kind: 'battle', size: '20x15' });
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
await p.fill('#asset-picker input[type=text]', 'lava');
await p.waitForTimeout(150);
await p.click('#asset-picker .asset[title="Lava Flow"]');
await p.waitForTimeout(200);
{
  const a = await M(160, 900), z = await M(1220, 900);
  await p.mouse.move(a.x, a.y); await p.mouse.down();
  await p.mouse.move(z.x, z.y, { steps: 12 }); await p.mouse.up();
  await p.waitForTimeout(300);
}
const stroke = await p.evaluate(() => {
  const raster = window.__cg.app.doc.layers.find((l) => l.kind === 'raster');
  const op = raster.ops[raster.ops.length - 1];
  return op ? op.tex : null;
});
t('the brush paints in lava', stroke === 'starter/lava', stroke);
await p.fill('#asset-picker input[type=text]', '');

await p.click('.tool[data-tool="stamp"]');
await p.waitForTimeout(200);
const spots = [[140, 140], [330, 160], [540, 160], [760, 160], [980, 160], [1200, 220], [160, 480], [420, 520]];
for (let i = 0; i < LABELS.length; i++) {
  await p.fill('#asset-picker input[type=text]', LABELS[i].toLowerCase());
  await p.waitForTimeout(120);
  await p.click(`#asset-picker .asset[title="${LABELS[i]}"] >> nth=0`);
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
  const d = R.canvasFor(objs).getContext('2d').getImageData(0, 0, 1400, 1050).data;
  let on = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 10) on++;
  return on;
});
t('and they are drawn on the map', drawn > 30000, drawn + ' pixels');
if (process.env.CG_SHOT) await p.screenshot({ path: process.env.CG_SHOT });

t('no request leaves 127.0.0.1', external.length === 0, external.slice(0, 3).join(' '));
t('no console errors', errs.length === 0, errs.slice(0, 3).join(' | '));

report();
await b.close();
process.exit(fails ? 1 : 0);
