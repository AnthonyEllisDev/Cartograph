/* Seeded dungeons: rooms, corridors, walls, doors and a numbered key.
 *
 * Start the server first:  python3 app.py --no-browser --port 7871
 * Then:                    node test/dungeon.mjs [http://127.0.0.1:7871]
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

const SEED = 'crypt-well-7';
const tool = async (n) => { await p.click(`.tool[data-tool="${n}"]`); await p.waitForTimeout(200); };
const openDialog = async () => {
  await tool('wall');
  await p.click('[data-action="generate-dungeon"]');
  await p.waitForSelector('.modal [data-dungeon="preview"]');
};
const setField = (label, value) => p.evaluate(([lab, val]) => {
  const f = Array.from(document.querySelectorAll('.modal .field'))
    .find((x) => x.querySelector('label span') && x.querySelector('label span').textContent === lab);
  if (!f) throw new Error('no field ' + lab);
  const i = f.querySelector('input,select');
  if (i.type === 'checkbox') i.checked = !!val; else i.value = String(val);
  i.dispatchEvent(new Event('input', { bubbles: true }));
  i.dispatchEvent(new Event('change', { bubbles: true }));
}, [label, value]);
const generate = async (seed, fields = {}) => {
  await openDialog();
  await p.fill('[data-dungeon="seed"]', seed);
  for (const [k, v] of Object.entries(fields)) await setField(k, v);
  await p.waitForTimeout(150);
  await p.click('.modal .btn-primary');
  await p.waitForTimeout(900);
};
const counts = () => p.evaluate(() => {
  const d = window.__cg.app.doc;
  const of = (k) => d.layers.filter((l) => l.kind === k);
  const walls = of('walls')[0];
  return {
    layers: d.layers.length,
    walls: walls ? walls.ops.length : 0,
    doors: walls ? walls.ops.filter((o) => o.kind === 'door').length : 0,
    secret: walls ? walls.ops.filter((o) => o.kind === 'secret').length : 0,
    paint: of('raster').reduce((n, l) => n + l.ops.length, 0),
    dungeonOps: of('raster').reduce((n, l) => n + l.ops.filter((o) => o.gen && /^dungeon/.test(o.gen.kind)).length, 0),
    notes: of('notes').reduce((n, l) => n + l.ops.length, 0),
    notesLayers: of('notes').length,
    history: window.__cg.history.past.length,
  };
});
const fingerprint = () => p.evaluate(() => {
  const c = window.__cg.R.flatten({ scale: 0.125 });
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let h = 0;
  for (let i = 0; i < d.length; i++) h = (h * 31 + d[i]) >>> 0;
  return h;
});

/** The settings the dungeon on the map was generated with, as its floor op
 *  records them -- the dialog picks a room count to suit the map, so the
 *  defaults are not what was drawn. */
const genNow = () => p.evaluate(() => {
  const paint = window.__cg.app.doc.layers.find((l) => l.kind === 'raster');
  const op = paint && paint.ops.find((o) => o.gen && o.gen.kind === 'dungeon');
  return op ? op.gen : null;
});

await newMap(p, { name: 'Dungeon Check', kind: 'battle', size: '40x30' });

/* the entry points ---------------------------------------------------------- */

await tool('wall');
t('the Wall panel offers Generate dungeon', await p.$('[data-action="generate-dungeon"]') !== null);
const inPalette = await p.evaluate(async () => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  const found = Array.from(document.querySelectorAll('.palette .item, .palette li, .palette [data-id]'))
    .some((x) => /Generate dungeon/.test(x.textContent));
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
  return found || /Generate dungeon/.test(document.body.textContent);
});
t('and so does the command palette', inPalette);

/* the dialog ---------------------------------------------------------------- */

const empty = await counts();
await openDialog();
const previewInk = await p.evaluate(() => {
  const c = document.querySelector('[data-dungeon="preview"]');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let light = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 180) light++;
  return light;
});
t('the dialog shows a plan of the dungeon', previewInk > 2000, previewInk + ' floor pixels');
await p.click('.modal .foot .btn:has-text("Cancel")'); await p.waitForTimeout(250);
const cancelled = await counts();
t('cancel changes nothing', JSON.stringify(cancelled) === JSON.stringify(empty), JSON.stringify(cancelled));

/* determinism and the layout itself ------------------------------------------ */

const layoutFacts = await p.evaluate(async (seed) => {
  const D = await import('/js/dungeon.js');
  const strip = (r) => JSON.stringify(r, (k, v) => (k === 'id' ? undefined : v));
  const doc = window.__cg.app.doc;
  const a = D.generateDungeon({ seed }, doc), b = D.generateDungeon({ seed }, doc);
  const c = D.generateDungeon({ seed: seed + 'x' }, doc);
  const f = D.frame(doc);
  const lay = D.layout({ seed }, f.cols, f.rows);
  // Every room reachable from the first through open cells.
  const open = (x, y) => x >= 0 && y >= 0 && x < f.cols && y < f.rows && lay.open[y * f.cols + x] === 1;
  const r0 = lay.rooms[0];
  const seen = new Set([r0.x + ',' + r0.y]);
  const queue = [[r0.x, r0.y]];
  while (queue.length) {
    const [x, y] = queue.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = (x + dx) + ',' + (y + dy);
      if (open(x + dx, y + dy) && !seen.has(k)) { seen.add(k); queue.push([x + dx, y + dy]); }
    }
  }
  const reached = lay.rooms.every((r) => seen.has(r.x + ',' + r.y));
  // No two rooms closer than the gap, and none touching the frame.
  let crowded = 0;
  for (let i = 0; i < lay.rooms.length; i++) {
    const r = lay.rooms[i];
    if (r.x < 1 || r.y < 1 || r.x + r.w > f.cols - 1 || r.y + r.h > f.rows - 1) crowded++;
    for (let j = i + 1; j < lay.rooms.length; j++) {
      const s = lay.rooms[j];
      if (r.x < s.x + s.w + 2 && s.x < r.x + r.w + 2 && r.y < s.y + s.h + 2 && s.y < r.y + r.h + 2) crowded++;
    }
  }
  // Secret doors only where there is another way round.
  const secrets = D.edges(lay).filter((e) => e.kind === 'secret').length;
  let secretOnTree = 0;
  const lay2 = D.layout({ seed, loops: 0.6, secret: true, doors: 'all' }, f.cols, f.rows);
  const e2 = D.edges(lay2);
  for (const e of e2.filter((x) => x.kind === 'secret')) {
    const [x0, y0, x1, y1] = e.horiz ? [e.run[0], e.fixed - 1, e.run[0], e.fixed] : [e.fixed - 1, e.run[0], e.fixed, e.run[0]];
    const d = lay2.doorways.get(x0 + ',' + y0 + ':' + x1 + ',' + y1);
    if (!d || !d.loop) secretOnTree++;
  }
  // Every wall on a grid line.
  const off = a.walls.filter((w) => w.points.some((q) => (q.x - f.ox) % f.cell || (q.y - f.oy) % f.cell)).length;
  return {
    same: strip(a) === strip(b), differs: strip(a) !== strip(c),
    rooms: a.rooms, notes: a.notes.length, reached, crowded, off,
    secretsWithLoops: e2.filter((x) => x.kind === 'secret').length, secretOnTree, secrets,
    doorsNone: D.edges(D.layout({ seed, doors: 'none' }, f.cols, f.rows)).filter((e) => e.kind !== 'wall').length,
    firstTitle: a.notes[0] && a.notes[0].title,
  };
}, SEED);
t('the same seed gives the same dungeon', layoutFacts.same);
t('another seed gives another', layoutFacts.differs);
t('every room can be reached from the first', layoutFacts.reached, layoutFacts.rooms + ' rooms');
t('rooms keep their distance from each other and the frame', layoutFacts.crowded === 0, layoutFacts.crowded);
t('every wall lies on a grid line', layoutFacts.off === 0, layoutFacts.off + ' off the grid');
t('secret doors are only ever a second way round', layoutFacts.secretsWithLoops > 0 && layoutFacts.secretOnTree === 0,
  `${layoutFacts.secretsWithLoops} secret, ${layoutFacts.secretOnTree} on the only way in`);
t('"Open arches only" puts no doors in', layoutFacts.doorsNone === 0, layoutFacts.doorsNone);
t('there is a note for every room, the first the entrance', layoutFacts.notes === layoutFacts.rooms && layoutFacts.firstTitle === 'Entrance',
  `${layoutFacts.notes} notes, ${layoutFacts.rooms} rooms, "${layoutFacts.firstTitle}"`);

/* generating it onto the map ---------------------------------------------- */

const fpEmpty = await fingerprint();
await generate(SEED);
const made = await counts();
t('generating writes walls and doors', made.walls > 40 && made.doors > 3, `${made.walls} walls, ${made.doors} doors`);
t('the floor and the shaded rock go on the paint layer', made.dungeonOps === 2, made.dungeonOps);
const GEN = await genNow();
const preview = await p.evaluate(async (gen) => {
  // The map and the plan in the dialog come from the same layout.
  const D = await import('/js/dungeon.js');
  const f = D.frame(window.__cg.app.doc);
  return { rooms: D.layout(gen, f.cols, f.rows).rooms.length, seed: gen.seed };
}, GEN);
t('the rooms are numbered on a new notes layer', made.notesLayers === 1 && made.notes === preview.rooms,
  `${made.notes} notes, ${preview.rooms} rooms`);
t('the whole thing is one undo step', made.history === empty.history + 1, made.history);
const fpMade = await fingerprint();
t('the map records the seed it was drawn from', preview.seed === SEED, preview.seed);

// Inside a room against the rock outside it: the floor is lighter than the
// shaded rock, measured on the paint layer alone so the grid and the paper do
// not decide it.
const contrast = await p.evaluate(async (gen) => {
  const D = await import('/js/dungeon.js');
  const doc = window.__cg.app.doc, R = window.__cg.R;
  const f = D.frame(doc);
  const lay = D.layout(gen, f.cols, f.rows);
  const r = lay.rooms[0];
  const paint = doc.layers.find((l) => l.kind === 'raster');
  const ctx = R.canvasFor(paint).getContext('2d');
  const lum = (x, y) => { const d = ctx.getImageData(x, y, 1, 1).data; return { l: (d[0] + d[1] + d[2]) / 3, a: d[3] }; };
  const inside = lum(f.ox + (r.x + r.w / 2) * f.cell, f.oy + (r.y + r.h / 2) * f.cell);
  const rock = lum(f.ox + 0.3 * f.cell, f.oy + 0.3 * f.cell);
  return { inside, rock };
}, GEN);
t('the floor is drawn inside the rooms', contrast.inside.a === 255 && contrast.inside.l > 150, JSON.stringify(contrast.inside));
t('and the rock around them is shaded', contrast.rock.a > 100 && contrast.rock.l < 40, JSON.stringify(contrast.rock));

/* walls that behave like walls ------------------------------------------------ */

const lit = await p.evaluate(async (gen) => {
  const D = await import('/js/dungeon.js');
  const doc = window.__cg.app.doc, R = window.__cg.R;
  const f = D.frame(doc);
  const lay = D.layout(gen, f.cols, f.rows);
  const r = lay.rooms[0];
  const lights = doc.layers.find((l) => l.kind === 'lights');
  const cx = f.ox + (r.x + r.w / 2) * f.cell, cy = f.oy + (r.y + r.h / 2) * f.cell;
  lights.ops = [{ id: 'L', t: 'light', x: cx, y: cy, bright: 1400, dim: 2800, color: '#ffffff', intensity: 1, cone: 360, angle: 0 }];
  lights.ambient = 0.9; lights.visible = true;
  R.invalidate(lights);
  const ctx = R.canvasFor(lights).getContext('2d');
  // A room cell no corridor opens onto from here: any rock cell just past the
  // room's wall, in the direction with no doorway.
  const alpha = (x, y) => ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data[3];
  const inside = alpha(cx, cy);
  let dark = 0, probes = 0;
  for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    const x = dx ? (dx < 0 ? r.x - 1.5 : r.x + r.w + 1.5) : r.x + r.w / 2;
    const y = dy ? (dy < 0 ? r.y - 1.5 : r.y + r.h + 1.5) : r.y + r.h / 2;
    const cxl = Math.floor(x), cyl = Math.floor(y);
    if (cxl < 0 || cyl < 0 || cxl >= f.cols || cyl >= f.rows || lay.open[cyl * f.cols + cxl]) continue;
    probes++;
    if (alpha(f.ox + x * f.cell, f.oy + y * f.cell) > 150) dark++;
  }
  lights.ops = []; lights.ambient = 0; R.invalidate(lights);
  return { inside, dark, probes };
}, GEN);
t('a light in a room is stopped by its walls', lit.inside < 80 && lit.probes > 0 && lit.dark === lit.probes,
  JSON.stringify(lit));

const vtt = await p.evaluate(() => {
  const R = window.__cg.R;
  const u = R.toUVTT(R.flatten({ scale: 0.25 }).toDataURL('image/png'));
  const walls = window.__cg.app.doc.layers.find((l) => l.kind === 'walls');
  return { sight: u.line_of_sight.length, portals: u.portals.length,
           doors: walls.ops.filter((o) => o.kind !== 'wall').length };
});
t('the walls go to a virtual tabletop as sight lines', vtt.sight > 20, vtt.sight);
t('and every door as a portal', vtt.portals === vtt.doors && vtt.portals > 0, `${vtt.portals} portals, ${vtt.doors} doors`);

/* undo, redo, again -------------------------------------------------------- */

await p.evaluate(async () => { (await import('/js/history.js')).undo(); });
await p.waitForTimeout(700);
const undone = await counts();
t('undo takes every part of it away, the notes layer too',
  undone.walls === 0 && undone.paint === empty.paint && undone.notesLayers === 0 && undone.layers === empty.layers,
  JSON.stringify(undone));
t('and the map is as it was', (await fingerprint()) === fpEmpty);
await p.evaluate(async () => { (await import('/js/history.js')).redo(); });
await p.waitForTimeout(700);
t('redo puts it back exactly', (await fingerprint()) === fpMade);

// A note of the user's own, and a wall, before generating again.
await p.evaluate(() => {
  const doc = window.__cg.app.doc;
  doc.layers.find((l) => l.kind === 'notes').ops.push({ id: 'mine', x: 70, y: 70, title: 'My note', body: '', color: '#335577' });
});
await generate('tomb-sump-3');
const again = await counts();
const kept = await p.evaluate(() => window.__cg.app.doc.layers.find((l) => l.kind === 'notes').ops.map((n) => n.title));
t('generating again replaces the dungeon rather than adding to it', again.dungeonOps === 2 && again.notesLayers === 1,
  JSON.stringify(again));
t('and keeps the notes it did not write', kept.includes('My note') && kept.filter((x) => x === 'Entrance').length === 1,
  kept.slice(0, 4).join(', '));

await p.evaluate(() => {
  const w = window.__cg.app.doc.layers.find((l) => l.kind === 'walls');
  w.ops.push({ id: 'handmade', kind: 'window', points: [{ x: 0, y: 0 }, { x: 70, y: 0 }] });
});
await generate('tomb-sump-3', { 'Walls already drawn': 'keep' });
const keptWall = await p.evaluate(() => window.__cg.app.doc.layers.find((l) => l.kind === 'walls').ops.some((o) => o.id === 'handmade'));
t('"Keep them" keeps walls already drawn', keptWall);
await generate('tomb-sump-3');
const replacedWall = await p.evaluate(() => window.__cg.app.doc.layers.find((l) => l.kind === 'walls').ops.some((o) => o.id === 'handmade'));
t('and "Replace them" does not', !replacedWall);

/* the round trip ------------------------------------------------------------ */

const fpBefore = await fingerprint();
await p.evaluate(async () => { await (await import('/js/app.js')).saveProject({ silent: true }); });
const slug = await p.evaluate(() => window.__cg.app.slug);
await p.reload({ waitUntil: 'networkidle' });
await ready(p);
await p.waitForFunction((s) => window.__cg.app.slug === s, slug, { timeout: 20000 }).catch(() => {});
await p.waitForTimeout(1200);
const fpAfter = await fingerprint();
t('a generated dungeon reloads pixel-identical', fpAfter === fpBefore && (await p.evaluate(() => window.__cg.app.slug)) === slug,
  `${fpBefore} vs ${fpAfter}`);

/* a map with nowhere to put the floor --------------------------------------- */

await newMap(p, { name: 'Dungeon No Paint', kind: 'battle' });
await p.evaluate(() => {
  const doc = window.__cg.app.doc;
  doc.layers = doc.layers.filter((l) => l.kind !== 'raster');
});
await generate('keep-lair-2');
const addedPaint = async () => p.evaluate(() => {
  const doc = window.__cg.app.doc, R = window.__cg.R;
  const paint = doc.layers.find((l) => l.kind === 'raster');
  if (!paint) return null;
  const c = R.canvasFor(paint).getContext('2d').getImageData(0, 0, doc.width, doc.height).data;
  let n = 0;
  for (let i = 3; i < c.length; i += 4) if (c[i]) n++;
  return { name: paint.name, painted: n, above: doc.layers.indexOf(paint) === doc.layers.findIndex((l) => l.kind === 'floor') + 1 };
});
const withPaint = await addedPaint();
t('a map with no paint layer gets one, just above the floor', !!withPaint && withPaint.painted > 1000 && withPaint.above,
  JSON.stringify(withPaint));
await p.evaluate(async () => { (await import('/js/history.js')).undo(); });
await p.waitForTimeout(500);
const noPaint = await addedPaint();
await p.evaluate(async () => { (await import('/js/history.js')).redo(); });
await p.waitForTimeout(500);
const paintBack = await addedPaint();
t('and undo takes it away, redo brings it back drawn', noPaint === null && !!paintBack && paintBack.painted === withPaint.painted,
  JSON.stringify([noPaint, paintBack && paintBack.painted]));

/* where it does not fit ----------------------------------------------------- */

await newMap(p, { name: 'Dungeon Hex Check', kind: 'hex' });
const hexBefore = await counts();
await p.evaluate(async () => { await (await import('/js/dungeon.js')).dungeonDialog(); });
await p.waitForTimeout(300);
const modalUp = await p.evaluate(() => !document.getElementById('modal-root').hidden);
t('a hex map is told it needs a square grid, and nothing changes',
  !modalUp && JSON.stringify(await counts()) === JSON.stringify(hexBefore));

t('no console errors', errs.length === 0, errs.slice(0, 3).join(' | '));

for (const [status, name, note] of out) {
  console.log(status.padEnd(5), name, note ? ' [' + note + ']' : '');
}
console.log(`\n${out.length - fails}/${out.length} passed`);
await b.close();
process.exit(fails ? 1 : 0);
