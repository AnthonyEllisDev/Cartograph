/* The Room tool: drag a room, rooms that touch become one, carve, doors.
 *
 * Start the server first:  python3 app.py --no-browser --port 7871
 * Then:                    node test/rooms.mjs [http://127.0.0.1:7871]
 */

import { launch, base, ready, newMap } from './browser.mjs';

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

/* helpers ------------------------------------------------------------------ */

// A 40 x 30 battle map of 70-px squares starting at the map's corner, so cell
// (x, y) runs from (70x, 70y) to (70x + 70, 70y + 70).
const C = 70;
await newMap(p, { name: 'Rooms Check', kind: 'battle', size: '40x30' });

const M = (mx, my) => p.evaluate(([x, y]) => {
  const s = window.__cg.mapToScreen(x, y);
  const r = document.getElementById('canvas').getBoundingClientRect();
  return { x: r.left + s.x, y: r.top + s.y };
}, [mx, my]);
const tool = async (n) => { await p.click(`.tool[data-tool="${n}"]`); await p.waitForTimeout(200); };
const drag = async (from, to) => {
  const a = await M(...from), z = await M(...to);
  await p.mouse.move(a.x, a.y);
  await p.mouse.down();
  for (let i = 1; i <= 6; i++) await p.mouse.move(a.x + (z.x - a.x) * i / 6, a.y + (z.y - a.y) * i / 6);
  await p.mouse.up();
  await p.waitForTimeout(300);
};
/** A drag from cell corner (x0, y0) to corner (x1, y1), a little off the
 *  corners so it is the rounding that puts it on the grid. */
const room = (x0, y0, x1, y1) => drag([x0 * C + 9, y0 * C - 7], [x1 * C - 11, y1 * C + 6]);
const click = async (mx, my) => { const s = await M(mx, my); await p.mouse.click(s.x, s.y); await p.waitForTimeout(250); };
const setOption = (key, value) => p.evaluate(async ([k, v]) => {
  const { setToolSetting } = await import('/js/app.js');
  setToolSetting('room', k, v);
  window.dispatchEvent(new CustomEvent('cartograph:tool-options'));
}, [key, value]);
const pickTexture = async (label) => {
  await p.fill('#asset-picker input[type=text]', label.toLowerCase());
  await p.waitForTimeout(250);
  await p.click(`#asset-picker .asset[title="${label}"] >> nth=0`);
  await p.waitForTimeout(400);
  await p.fill('#asset-picker input[type=text]', '');
};
const state = () => p.evaluate(() => {
  const d = window.__cg.app.doc;
  const paint = d.layers.find((l) => l.kind === 'raster');
  const walls = d.layers.find((l) => l.kind === 'walls');
  return JSON.parse(JSON.stringify({
    floors: paint.ops.filter((o) => o.gen && o.gen.kind === 'rooms'),
    shade: paint.ops.filter((o) => o.gen && o.gen.kind === 'rooms-shade'),
    paint: paint.ops.length,
    walls: walls.ops,
    history: window.__cg.history.past.length,
  }));
});
/** The unit edges the room tool's walls cover, as 'h:x,y' / 'v:x,y'. */
const unitEdges = (walls) => {
  const out = [];
  for (const w of walls) {
    const [a, z] = w.points;
    const ax = a.x / C, ay = a.y / C, zx = z.x / C, zy = z.y / C;
    if (ay === zy) for (let x = Math.min(ax, zx); x < Math.max(ax, zx); x++) out.push('h:' + x + ',' + ay);
    else for (let y = Math.min(ay, zy); y < Math.max(ay, zy); y++) out.push('v:' + ax + ',' + y);
  }
  return out;
};
const roomWalls = (s) => s.walls.filter((w) => w.gen === 'rooms' && w.kind === 'wall');
const flat = (x, y) => p.evaluate(([mx, my]) => {
  const c = window.__cg.R.flatten({ scale: 1, grid: false });
  const d = c.getContext('2d').getImageData(mx, my, 1, 1).data;
  return [d[0], d[1], d[2]];
}, [x, y]);
const fingerprint = () => p.evaluate(() => {
  const c = window.__cg.R.flatten({ scale: 0.125 });
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let h = 0;
  for (let i = 0; i < d.length; i++) h = (h * 31 + d[i]) >>> 0;
  return h;
});
const undo = () => p.evaluate(async () => (await import('/js/history.js')).undo());
const redo = () => p.evaluate(async () => (await import('/js/history.js')).redo());
const lastToast = () => p.evaluate(() => {
  const all = document.querySelectorAll('.toast');
  return all.length ? all[all.length - 1].textContent : '';
});

/* the tool ------------------------------------------------------------------ */

t('the room tool is in the toolbar', await p.$('.tool[data-tool="room"]') !== null);
await p.mouse.move(5, 500);
await p.keyboard.press('o');
await p.waitForTimeout(200);
t('O picks it up', await p.evaluate(async () => (await import('/js/tools.js')).currentTool().id) === 'room');
await tool('room');
const banner = await p.evaluate(() => document.getElementById('tool-options').textContent);
t('its panel says it draws on the Walls layer', /Walls/.test(banner), banner.slice(0, 80));
t('and shows a floor texture picker', await p.$('#asset-picker .asset') !== null);
await setOption('mode', 'add');
await setOption('shade', false);
await pickTexture('Flagstone Floor');

/* a room -------------------------------------------------------------------- */

const floorBefore = await flat(4.5 * C, 4.5 * C);
const outsideBefore = await flat(12.5 * C, 12.5 * C);
const holeBefore = await flat(4.5 * C, 3.5 * C);
const h0 = (await state()).history;
await room(2, 2, 7, 6);
let s = await state();
t('a drag makes one floor op', s.floors.length === 1 && s.floors[0].tex === 'starter/flagstone', s.floors.map((f) => f.tex).join());
t('whose outline is the room, on the grid', s.floors.length === 1 && JSON.stringify(s.floors[0].rings) === JSON.stringify([[140, 140, 140, 420, 490, 420, 490, 140]])
  || (s.floors[0] && s.floors[0].rings.length === 1 && s.floors[0].rings[0].length === 8 && s.floors[0].rings[0].every((v) => v % C === 0)),
  s.floors[0] && JSON.stringify(s.floors[0].rings));
const edges1 = unitEdges(roomWalls(s));
t('and walls round it, one run per side', roomWalls(s).length === 4 && edges1.length === 18, `${roomWalls(s).length} runs, ${edges1.length} edges`);
t('as one undo step', s.history === h0 + 1, s.history - h0);
const floorAfter = await flat(4.5 * C, 4.5 * C);
t('the floor is painted', floorAfter.some((v, i) => Math.abs(v - floorBefore[i]) > 12), `${floorBefore} -> ${floorAfter}`);
const outside = await flat(12.5 * C, 12.5 * C);
t('and nothing outside the room is', outside.every((v, i) => Math.abs(v - outsideBefore[i]) < 3), `${outsideBefore} vs ${outside}`);

/* a click is not a room ----------------------------------------------------- */

const hClick = (await state()).history;
await click(20.4 * C, 20.4 * C);
t('a click with no drag adds nothing', (await state()).history === hClick && (await state()).floors.length === 1);

/* two rooms become one ------------------------------------------------------ */

await room(7, 3, 12, 5);
s = await state();
const edges2 = unitEdges(roomWalls(s));
t('a room touching another joins it: one outline', s.floors.length === 1 && s.floors[0].rings.length === 1, s.floors[0] && s.floors[0].rings.length);
t('with no wall left between them', !edges2.includes('v:7,3') && !edges2.includes('v:7,4'), edges2.filter((e) => e.startsWith('v:7')).join(' '));
t('and the wall round the new part', edges2.includes('v:12,3') && edges2.includes('h:10,3') && edges2.includes('h:10,5'));
t('every edge of the outline is walled once', edges2.length === new Set(edges2).size && edges2.length === 18 + 10 + 2 - 2, edges2.length);

await undo();
s = await state();
t('undo takes the second room away, wall and all', unitEdges(roomWalls(s)).sort().join() === edges1.slice().sort().join() && s.floors[0].rings.length === 1
  && s.floors[0].rings[0].length === 8);
await redo();
s = await state();
t('and redo puts it back', unitEdges(roomWalls(s)).sort().join() === edges2.slice().sort().join());

/* a second floor ------------------------------------------------------------ */

await pickTexture('Wooden Floorboards');
await room(12, 2, 16, 7);
s = await state();
const edges3 = unitEdges(roomWalls(s));
t('a room in another floor keeps its own texture', s.floors.length === 2 && s.floors.map((f) => f.tex).sort().join() === 'starter/flagstone,starter/planks',
  s.floors.map((f) => f.tex).join());
t('and the old room keeps its floor', s.floors.find((f) => f.tex === 'starter/flagstone').rings.length === 1);
t('but it is still one room: no wall where the floors meet', !edges3.includes('v:12,3') && !edges3.includes('v:12,4'));
const boards = await flat(14.5 * C, 6.5 * C), flags = await flat(4.5 * C, 4.5 * C);
t('the two floors look different', boards.some((v, i) => Math.abs(v - flags[i]) > 10), `${boards} vs ${flags}`);

/* a room over a room ------------------------------------------------------- */

await room(3, 3, 5, 5);
s = await state();
t('a room drawn inside one retextures it and adds no wall', s.floors.length === 2
  && unitEdges(roomWalls(s)).sort().join() === edges3.slice().sort().join());
await undo();

/* carving ------------------------------------------------------------------- */

await setOption('mode', 'remove');
await room(4, 3, 5, 4);
s = await state();
const edges4 = unitEdges(roomWalls(s));
t('carving a cell out of a room leaves a pillar walled on four sides',
  ['h:4,3', 'h:4,4', 'v:4,3', 'v:5,3'].every((k) => edges4.includes(k)), edges4.filter((e) => /:[45],[34]$/.test(e)).join(' '));
t('and its floor has a hole in it', s.floors.find((f) => f.tex === 'starter/flagstone').rings.length === 2);
const hole = await flat(4.5 * C, 3.5 * C);
t('where the old floor shows through', hole.every((v, i) => Math.abs(v - holeBefore[i]) < 3), `${hole} vs ${holeBefore}`);
await undo();
s = await state();
t('undo fills the pillar in again', unitEdges(roomWalls(s)).sort().join() === edges3.slice().sort().join());

/* doors --------------------------------------------------------------------- */

await setOption('mode', 'door');
await setOption('doorKind', 'secret');
t('Door mode offers the kind of door', await p.evaluate(() => [...document.querySelectorAll('#tool-options .field label span')].some((x) => x.textContent === 'Door')));
const hDoor = (await state()).history;
// The middle of the top edge of cell (4, 2): a wall of the first room.
await click(4.5 * C, 2 * C + 6);
s = await state();
const doors = s.walls.filter((w) => w.kind === 'secret');
t('a click on a room\'s wall puts a door in it', doors.length === 1 && doors[0].gen === 'rooms'
  && JSON.stringify(doors[0].points) === JSON.stringify([{ x: 280, y: 140 }, { x: 350, y: 140 }]), JSON.stringify(doors.map((d) => d.points)));
const edges5 = unitEdges(roomWalls(s));
t('and leaves a gap in the wall exactly that wide', !edges5.includes('h:4,2') && edges5.includes('h:3,2') && edges5.includes('h:5,2')
  && edges5.length === edges3.length - 1, edges5.length + ' vs ' + edges3.length);
t('as one undo step', s.history === hDoor + 1);
await click(20.5 * C, 20.5 * C);
t('a click away from any wall is refused', (await state()).history === hDoor + 1 && /wall/.test(await lastToast()), await lastToast());

await setOption('mode', 'add');
await pickTexture('Flagstone Floor');
await room(20, 10, 24, 14);
s = await state();
t('a door survives a room drawn somewhere else', s.walls.filter((w) => w.kind === 'secret').length === 1);
const hand = { id: 'handmade', kind: 'wall', points: [{ x: 30 * C, y: 20 * C }, { x: 34 * C, y: 20 * C }] };
const handDoor = { id: 'handdoor', kind: 'door', points: [{ x: 24 * C, y: 11 * C }, { x: 24 * C, y: 12 * C }] };
await p.evaluate(([a, d]) => {
  const w = window.__cg.app.doc.layers.find((l) => l.kind === 'walls');
  w.ops.push(a, d);
  window.__cg.R.invalidate(w);
}, [hand, handDoor]);
await room(26, 10, 28, 12);
s = await state();
t('a wall drawn by hand is left alone', s.walls.some((w) => w.id === 'handmade' && JSON.stringify(w.points) === JSON.stringify(hand.points)));
t('a door drawn by hand on the outline leaves a gap too', s.walls.some((w) => w.id === 'handdoor')
  && !unitEdges(roomWalls(s)).includes('v:24,11') && unitEdges(roomWalls(s)).includes('v:24,10'));

await setOption('mode', 'door');
await click(4.5 * C, 2 * C + 4);
s = await state();
t('clicking a door again takes it out and closes the wall', s.walls.filter((w) => w.kind === 'secret').length === 0 && unitEdges(roomWalls(s)).includes('h:4,2'));
await undo();
s = await state();
t('and undo puts it back', s.walls.filter((w) => w.kind === 'secret').length === 1 && !unitEdges(roomWalls(s)).includes('h:4,2'));

await setOption('mode', 'add');
await room(3, 1, 6, 3);
s = await state();
t('a room drawn across a door\'s wall takes the door with the wall', s.walls.filter((w) => w.kind === 'secret').length === 0
  && !unitEdges(roomWalls(s)).includes('h:4,2'));
await undo();

/* the walls are walls ------------------------------------------------------- */

// The lamp is put down first and the room drawn round it afterwards, so it is
// the room's own step that has to relight the map.
await p.evaluate(() => {
  const d = window.__cg.app.doc;
  const lights = d.layers.find((l) => l.kind === 'lights');
  window.__lampWas = { ops: lights.ops.slice(), ambient: lights.ambient, visible: lights.visible };
  lights.ops.push({ id: 'o-test', t: 'light', x: 35.5 * 70, y: 15.5 * 70, bright: 280, dim: 420,
                    color: '#ffd28a', intensity: 1, cone: 360, angle: 0 });
  lights.ambient = 0.85; lights.visible = true;
  window.__cg.R.invalidate(lights);
});
// The same distance from the lamp: one inside the room to be, one past its
// south wall.
const lit = () => p.evaluate(() => {
  const c = window.__cg.R.flatten({ scale: 1, grid: false });
  const g = c.getContext('2d');
  const at = (x, y) => Array.from(g.getImageData(x, y, 1, 1).data).slice(0, 3).reduce((a, v) => a + v, 0);
  return { inside: at(37.5 * 70, 15.5 * 70), through: at(35.5 * 70, 17.5 * 70) };
});
const litBefore = await lit();
await room(34, 14, 38, 17);
const shadow = await lit();
t('a room drawn round a lamp casts shadows at once', litBefore.through > litBefore.inside * 0.8 && shadow.through < shadow.inside * 0.6,
  JSON.stringify([litBefore, shadow]));
await undo();
const unshadow = await lit();
t('and undoing it lifts them', unshadow.through > unshadow.inside * 0.8, JSON.stringify(unshadow));
await p.evaluate(() => {
  const lights = window.__cg.app.doc.layers.find((l) => l.kind === 'lights');
  lights.ops = window.__lampWas.ops; lights.ambient = window.__lampWas.ambient; lights.visible = window.__lampWas.visible;
  window.__cg.R.invalidate(lights);
});

const vtt = await p.evaluate(() => {
  const v = window.__cg.R.toUVTT('data:image/png;base64,');
  return { sight: v.line_of_sight.length, portals: v.portals.length, walls: window.__cg.app.doc.layers.find((l) => l.kind === 'walls').ops.map((w) => w.kind + (w.gen ? '*' : '')).join(' ') };
});
s = await state();
t('they go into the Universal VTT export as sight lines, the door as a portal',
  vtt.sight >= roomWalls(s).length && vtt.portals >= s.walls.filter((w) => w.kind !== 'wall' && w.kind !== 'window').length && vtt.portals >= 2, JSON.stringify(vtt));

/* the rock ------------------------------------------------------------------ */

const rockBefore = await flat(30.5 * C, 25.5 * C);
await setOption('shade', true);
await room(30, 2, 33, 5);
s = await state();
t('Shade the rock adds the shade', s.shade.length === 1);
const rockAfter = await flat(30.5 * C, 25.5 * C);
const lum = (c) => c[0] + c[1] + c[2];
t('which darkens the rock and not the rooms', lum(rockAfter) < lum(rockBefore) * 0.75
  && Math.abs(lum(await flat(4.5 * C, 4.5 * C)) - lum(flags)) < 6, `${rockBefore} -> ${rockAfter}`);
await setOption('shade', false);
await room(30, 6, 33, 8);
t('and turning it off takes it away', (await state()).shade.length === 0);

/* refusals ------------------------------------------------------------------ */

await p.evaluate(() => { window.__cg.app.doc.layers.find((l) => l.kind === 'walls').locked = true; });
const hLocked = (await state()).history;
await room(35, 20, 38, 24);
t('with the walls locked nothing is drawn', (await state()).history === hLocked && /walls layer/.test(await lastToast()), await lastToast());
await p.evaluate(() => { window.__cg.app.doc.layers.find((l) => l.kind === 'walls').locked = false; });

/* the round trip ------------------------------------------------------------ */

const fpBefore = await fingerprint();
await p.evaluate(async () => { await (await import('/js/app.js')).saveProject({ silent: true }); });
const slug = await p.evaluate(() => window.__cg.app.slug);
await p.reload({ waitUntil: 'networkidle' });
await ready(p);
await p.waitForFunction((sl) => window.__cg.app.slug === sl, slug, { timeout: 20000 }).catch(() => {});
await p.waitForTimeout(1500);
const fpAfter = await fingerprint();
t('a map of rooms reloads pixel-identical', fpAfter === fpBefore && (await p.evaluate(() => window.__cg.app.slug)) === slug, `${fpBefore} vs ${fpAfter}`);
s = await state();
const n = s.floors.length;
await tool('room');
await setOption('mode', 'add');
await pickTexture('Flagstone Floor');
await room(20, 20, 22, 22);
t('and the rooms read back from the file can be added to', (await state()).floors.length === n && unitEdges(roomWalls(await state())).includes('v:22,20'));

/* a hex map ----------------------------------------------------------------- */

await newMap(p, { name: 'Rooms Hex', kind: 'hex' });
await p.evaluate(() => {
  // A hex crawl has no walls layer; give it one, so it is the grid that says no.
  const d = window.__cg.app.doc;
  d.layers.splice(2, 0, { id: 'l-walls-x', kind: 'walls', name: 'Walls', visible: true, opacity: 1, blend: 'source-over', locked: false, ops: [] });
  if (!d.layers.some((l) => l.kind === 'raster')) d.layers.splice(1, 0, { id: 'l-paint-x', kind: 'raster', name: 'Paint', visible: true, opacity: 1, blend: 'source-over', locked: false, ops: [] });
});
await tool('room');
await setOption('mode', 'add');
const hHex = (await state()).history;
await drag([300, 300], [600, 520]);
t('a hex map is refused, with a reason', (await state()).history === hHex && /square grid/.test(await lastToast()), await lastToast());

/* the workshop art ---------------------------------------------------------- */

const TEXTURES = ['herringbone', 'hex-tiles', 'cinders'];
const TEX_LABELS = ['Herringbone Parquet', 'Hexagonal Tiles', 'Smithy Cinders'];
const STAMPS = ['forge', 'workbench', 'loom', 'spinning-wheel', 'potters-wheel', 'grindstone', 'kiln', 'tanning-rack'];
const LABELS = ['Forge', 'Workbench', 'Loom', 'Spinning Wheel', "Potter's Wheel", 'Grindstone', 'Kiln', 'Tanning Frame'];

await newMap(p, { name: 'Workshop Art Check', kind: 'battle', size: '20x15' });
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
  lib.textures.every((a) => a && a[0] === 'terrain' && a[1] === 'floor' && a[2] === true), JSON.stringify(lib.textures));
t('eight workshop symbols, three variants of each',
  lib.stamps.every((v) => v.every((a) => a && a[0] === 'stamp' && a[1] === 'workshop')),
  lib.stamps.map((v) => v.filter(Boolean).length).join(','));

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
    const col = (i, k) => { let q = 0; for (let j = 0; j < H; j++) q += diff(at(i, j), at(k, j)); return q; };
    const row = (j, k) => { let q = 0; for (let i = 0; i < W; i++) q += diff(at(i, j), at(i, k)); return q; };
    let worstX = 0, worstY = 0;
    for (let i = 0; i < W - 1; i++) worstX = Math.max(worstX, col(i, i + 1));
    for (let j = 0; j < H - 1; j++) worstY = Math.max(worstY, row(j, j + 1));
    res[n] = { x: +(col(W - 1, 0) / Math.max(1, worstX)).toFixed(2),
               y: +(row(H - 1, 0) / Math.max(1, worstY)).toFixed(2), opaque: d[3] === 255 };
  }
  return res;
}, TEXTURES);
t('each floor meets its own opposite edge',
  Object.values(seams).every((q) => q.x <= 1 && q.y <= 1 && q.opaque), JSON.stringify(seams));

// Each new floor as a room of its own, then the symbols stood in them.
await tool('room');
await setOption('mode', 'add');
await setOption('shade', true);
for (let i = 0; i < TEX_LABELS.length; i++) {
  await pickTexture(TEX_LABELS[i]);
  await room(1 + i * 6, 1, 6 + i * 6, 6);
}
s = await state();
t('each can floor a room', s.floors.map((f) => f.tex).sort().join() === TEXTURES.map((n) => 'starter/' + n).sort().join(),
  s.floors.map((f) => f.tex).join());
await p.evaluate(async () => {
  const A = await import('/js/app.js');
  A.setActiveLayer(A.app.doc.layers.find((l) => l.kind === 'objects').id);
});
await tool('stamp');
const spots = [[175, 175], [385, 280], [595, 175], [805, 280], [1015, 175], [1225, 280], [385, 700], [805, 700]];
for (let i = 0; i < LABELS.length; i++) {
  await p.fill('#asset-picker input[type=text]', LABELS[i].toLowerCase());
  await p.waitForTimeout(120);
  await p.click(`#asset-picker .asset[title="${LABELS[i]}"] >> nth=0`);
  await p.waitForTimeout(120);
  const q = await M(...spots[i]);
  await p.mouse.click(q.x, q.y);
  await p.waitForTimeout(160);
}
await p.fill('#asset-picker input[type=text]', '');
await p.waitForTimeout(600);
const stamped = await p.evaluate(() => {
  const objs = window.__cg.app.doc.layers.find((l) => l.kind === 'objects');
  const ids = objs.ops.flatMap((o) => o.assets || (o.asset ? [o.asset] : []));
  return [...new Set(ids.map((id) => id.replace(/-\d+$/, '')))];
});
t('all eight can be placed with the Stamp tool',
  STAMPS.every((n) => stamped.includes('starter/' + n)), stamped.join(' '));
if (process.env.CG_SHOT) await p.screenshot({ path: process.env.CG_SHOT });

t('no console errors', errs.length === 0, errs.join(' | '));

for (const [r, name, note] of out) console.log(`${r}  ${name}  ${note}`);
console.log(`\n${out.length - fails}/${out.length} passed`);
await b.close();
process.exit(fails ? 1 : 0);
