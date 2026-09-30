/* Seeded dungeon generation.
 *
 * The land generator gave region maps somewhere to start; a battle map still
 * started at a blank floor. Dungeon Scrawl and Donjon both start you at a
 * dungeon -- one with no seed or room numbers, the other a web page -- and
 * Watabou's one-page dungeons show what the pair of a plan and a numbered key
 * is worth at the table. This lays out rooms and corridors on the map's own
 * square grid and writes them into the map as ordinary things:
 *
 *   - the walls, doors and secret doors as wall ops on the Walls layer, so
 *     they cast shadows, travel into the Universal VTT export as sight lines
 *     and portals, and can be selected, edited and deleted one by one;
 *   - the floor as one shape op on a paint layer, rings filled even-odd the
 *     way generated land is, with the rock around it shaded as a second op;
 *   - optionally, a numbered note in every room, so the key is already there.
 *
 * As with the land, what is stored is the result, not the seed: the walls and
 * the rings go into project.json, so a map reloads identically even if this
 * file later lays the same seed out differently. The settings are kept on the
 * floor op beside the rings so the result can be read and re-rolled.
 *
 * Everything works in grid cells until the very end. A room is a rectangle of
 * cells; a corridor is a path of cells; a wall is the edge between a cell that
 * is open and one that is not. That is what keeps every wall on a grid line,
 * where the Wall tool would have snapped it anyway.
 */

import { app, emit, markDirty, scheduleAutosave } from './app.js';
import { gridLayer, gridStepPx, makeLayer, NOTE_DEFAULTS } from './doc.js';
import { pushEntry } from './history.js';
import * as R from './render.js';
import { field } from './ui.js';
import { library, warm } from './assets.js';
import { el, hashString, makeCanvas, modal, rng, throttleFrame, toast, uid } from './util.js';


/* ------------------------------------------------------------------ settings */

/* Room sides in cells, smallest to largest. */
export const ROOM_SIZES = {
  small:  { label: 'Small',  min: 2, max: 4 },
  medium: { label: 'Medium', min: 3, max: 6 },
  large:  { label: 'Large',  min: 4, max: 9 },
  mixed:  { label: 'Mixed',  min: 2, max: 8 },
};

/* The share of doorways that get a door. The rest are open arches. */
export const DOOR_SHARES = {
  all:  { label: 'Every doorway', share: 1 },
  most: { label: 'Most doorways', share: 0.75 },
  some: { label: 'Some doorways', share: 0.4 },
  none: { label: 'Open arches only', share: 0 },
};

export const DUNGEON_DEFAULTS = {
  seed: '',
  rooms: 10,
  size: 'medium',
  corridors: 'straight',   // 'straight' | 'winding'
  loops: 0.2,              // extra connections, as a share of the room count
  doors: 'most',
  secret: true,            // hide a few of the doors
  numbers: true,           // a numbered note in every room
  shade: true,             // darken the rock around the dungeon
  tex: 'starter/parchment',
};

const SECRET_SHARE = 0.12;
const SHADE = { color: '#15120f', opacity: 0.55 };

/** A fresh seed that a person can read back and type in again. The land
 *  generator's words are about coasts; these are about holes in the ground. */
export function randomSeed() {
  const words = ['barrow', 'crypt', 'delve', 'gaol', 'grotto', 'hollow', 'keep', 'lair',
                 'mine', 'ossuary', 'pit', 'shrine', 'sump', 'tomb', 'undercroft', 'vault',
                 'warren', 'well', 'cistern', 'catacomb', 'sepulchre', 'forge', 'cellar', 'den'];
  const pick = () => words[Math.floor(Math.random() * words.length)];
  return pick() + '-' + pick() + '-' + Math.floor(Math.random() * 100);
}

/** The settings with every field present and in range. */
export function normalise(params) {
  const p = Object.assign({}, DUNGEON_DEFAULTS, params || {});
  p.seed = String(p.seed || '').trim() || randomSeed();
  p.rooms = Math.round(clamp(+p.rooms, 2, 40, DUNGEON_DEFAULTS.rooms));
  if (!ROOM_SIZES[p.size]) p.size = DUNGEON_DEFAULTS.size;
  if (p.corridors !== 'winding') p.corridors = 'straight';
  p.loops = clamp(+p.loops, 0, 0.6, DUNGEON_DEFAULTS.loops);
  if (!DOOR_SHARES[p.doors]) p.doors = DUNGEON_DEFAULTS.doors;
  p.secret = !!p.secret;
  p.numbers = !!p.numbers;
  p.shade = !!p.shade;
  p.tex = typeof p.tex === 'string' && p.tex ? p.tex : DUNGEON_DEFAULTS.tex;
  return p;
}

function clamp(v, lo, hi, fallback) {
  if (!isFinite(v)) return fallback;
  return v < lo ? lo : v > hi ? hi : v;
}


/* ------------------------------------------------------------------- layout */

/** Lay a dungeon out on a `cols` x `rows` grid of cells.
 *
 * Returns the rooms, the corridor edges between them, which cells are open,
 * and every doorway -- the edge where a corridor steps into a room. Pure: the
 * same settings and grid always give the same layout. */
export function layout(params, cols, rows) {
  const p = normalise(params);
  const rand = rng(hashString('dungeon|' + p.seed + '|' + p.size + '|' + p.corridors));
  const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  const sizes = ROOM_SIZES[p.size];

  // Rooms keep two cells from each other, so a corridor can always pass
  // between two of them with a wall on either side, and a cell from the
  // frame, so no room is left without its outer wall.
  const rooms = [];
  const GAP = 2;
  const maxSide = Math.min(sizes.max, cols - 2, rows - 2);
  const minSide = Math.min(sizes.min, maxSide);
  if (maxSide >= 2) {
    for (let tries = 0; tries < p.rooms * 60 && rooms.length < p.rooms; tries++) {
      const w = between(minSide, maxSide), h = between(minSide, maxSide);
      // Long thin rooms read as corridors, and corridors are what the rest of
      // this is for.
      if (w > h * 2.5 || h > w * 2.5) continue;
      const x = between(1, cols - w - 1), y = between(1, rows - h - 1);
      if (x < 1 || y < 1) continue;
      const clash = rooms.some((r) => x < r.x + r.w + GAP && r.x < x + w + GAP &&
                                      y < r.y + r.h + GAP && r.y < y + h + GAP);
      if (!clash) rooms.push({ x, y, w, h });
    }
  }

  const index = (x, y) => y * cols + x;
  const open = new Uint8Array(cols * rows);
  const roomAt = new Int16Array(cols * rows).fill(-1);
  rooms.forEach((r, i) => {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      open[index(x, y)] = 1; roomAt[index(x, y)] = i;
    }
  });

  // Which rooms join: a minimum spanning tree over the room centres, so every
  // room can be reached, and then a few of the shortest remaining pairs, so
  // not every route is the only one.
  const centre = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
  const dist = (a, b) => Math.hypot(centre(a).x - centre(b).x, centre(a).y - centre(b).y);
  const links = [];
  if (rooms.length > 1) {
    const inTree = new Set([0]);
    while (inTree.size < rooms.length) {
      let best = null;
      for (const i of inTree) {
        for (let j = 0; j < rooms.length; j++) {
          if (inTree.has(j)) continue;
          const d = dist(rooms[i], rooms[j]);
          if (!best || d < best.d) best = { a: i, b: j, d };
        }
      }
      inTree.add(best.b);
      links.push({ a: best.a, b: best.b, loop: false });
    }
    const extra = Math.round(p.loops * rooms.length);
    const joined = new Set(links.map((l) => Math.min(l.a, l.b) + ':' + Math.max(l.a, l.b)));
    const spare = [];
    for (let i = 0; i < rooms.length; i++) {
      for (let j = i + 1; j < rooms.length; j++) {
        if (!joined.has(i + ':' + j)) spare.push({ a: i, b: j, d: dist(rooms[i], rooms[j]) });
      }
    }
    spare.sort((u, v) => u.d - v.d);
    // Drawn from the shorter half, so a loop is a second way round a
    // neighbourhood rather than a corridor across the whole map.
    const pool = spare.slice(0, Math.max(extra, Math.ceil(spare.length / 2)));
    for (let k = 0; k < extra && pool.length; k++) {
      const pick = pool.splice(Math.floor(rand() * pool.length), 1)[0];
      links.push({ a: pick.a, b: pick.b, loop: true });
    }
  }

  // Carve each link as a path of cells, remembering every place it steps from
  // outside a room into one: those edges are the doorways.
  const doorways = new Map();   // edge key -> { a: [x, y], b: [x, y], room, loop }
  const edgeKey = (x0, y0, x1, y1) => (x0 < x1 || y0 < y1)
    ? x0 + ',' + y0 + ':' + x1 + ',' + y1 : x1 + ',' + y1 + ':' + x0 + ',' + y0;
  const carve = (cells, loop) => {
    for (let k = 0; k < cells.length; k++) {
      const [x, y] = cells[k];
      open[index(x, y)] = 1;
      if (!k) continue;
      const [px, py] = cells[k - 1];
      const here = roomAt[index(x, y)], there = roomAt[index(px, py)];
      if ((here >= 0) !== (there >= 0)) {
        const key = edgeKey(px, py, x, y);
        if (!doorways.has(key)) doorways.set(key, { a: [px, py], b: [x, y], room: here >= 0 ? here : there, loop });
      }
    }
  };
  const pointIn = (r) => [between(r.x, r.x + r.w - 1), between(r.y, r.y + r.h - 1)];
  for (const link of links) {
    const A = rooms[link.a], B = rooms[link.b];
    const ox0 = Math.max(A.x, B.x), ox1 = Math.min(A.x + A.w, B.x + B.w) - 1;
    const oy0 = Math.max(A.y, B.y), oy1 = Math.min(A.y + A.h, B.y + B.h) - 1;
    let cells;
    if (p.corridors === 'straight' && ox0 <= ox1) {
      // Facing each other across a gap: one straight corridor, no elbow.
      const x = between(ox0, ox1);
      cells = run([x, centreCell(A)[1]], [x, centreCell(B)[1]], true);
    } else if (p.corridors === 'straight' && oy0 <= oy1) {
      const y = between(oy0, oy1);
      cells = run([centreCell(A)[0], y], [centreCell(B)[0], y], true);
    } else {
      const from = pointIn(A), to = pointIn(B);
      const hFirst = rand() < 0.5;
      if (p.corridors === 'winding') {
        // A waypoint off the straight line, inside the frame, and two elbows
        // either side of it.
        const mx = clampInt(Math.round((from[0] + to[0]) / 2 + (rand() - 0.5) * Math.abs(to[1] - from[1])), 1, cols - 2);
        const my = clampInt(Math.round((from[1] + to[1]) / 2 + (rand() - 0.5) * Math.abs(to[0] - from[0])), 1, rows - 2);
        const first = elbow(from, [mx, my], hFirst);
        cells = first.concat(elbow([mx, my], to, !hFirst).slice(1));
      } else {
        cells = elbow(from, to, hFirst);
      }
    }
    carve(cells, link.loop);
  }

  return { cols, rows, rooms, links, open, roomAt, doorways, params: p };
}

function centreCell(r) { return [r.x + Math.floor(r.w / 2), r.y + Math.floor(r.h / 2)]; }
function clampInt(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/** The cells from `a` to `b` along one axis, both ends included. */
function run(a, b) {
  const out = [];
  const dx = Math.sign(b[0] - a[0]), dy = Math.sign(b[1] - a[1]);
  let [x, y] = a;
  out.push([x, y]);
  while (x !== b[0] || y !== b[1]) {
    if (x !== b[0]) x += dx; else y += dy;
    out.push([x, y]);
  }
  return out;
}

/** An L from `a` to `b`, along x first or y first. */
function elbow(a, b, hFirst) {
  const knee = hFirst ? [b[0], a[1]] : [a[0], b[1]];
  return run(a, knee).concat(run(knee, b).slice(1));
}


/* ---------------------------------------------------------------- the walls */

/** Every wall, door and open arch, in cells, merged into straight runs.
 *
 * A unit edge is a wall when it lies between an open cell and one that is not,
 * and also when it lies between a room and a corridor that did not step in
 * there -- a corridor that runs past a room has a wall between them. A doorway
 * is a door, a secret door or nothing (an arch), decided per doorway from the
 * seed. Edges of one kind that continue each other are joined, so a long wall
 * is one op the Select tool picks up whole, not a run of one-cell stubs. */
export function edges(lay) {
  const { cols, rows, open, roomAt, doorways, params } = lay;
  const rand = rng(hashString('doors|' + params.seed + '|' + params.doors + '|' + params.secret));
  const share = DOOR_SHARES[params.doors].share;
  const index = (x, y) => y * cols + x;
  const isOpen = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows && open[index(x, y)] === 1;
  const inRoom = (x, y) => isOpen(x, y) && roomAt[index(x, y)] >= 0;

  const doorKinds = new Map();
  // Sorted, so the doors are decided in the same order however the Map was
  // filled.
  for (const key of [...doorways.keys()].sort()) {
    const d = doorways.get(key);
    let kind = rand() < share ? 'door' : null;
    // Secret doors go on the second ways round, never on the only way in:
    // a room reached only through a secret door is a room nobody finds.
    if (kind && params.secret && d.loop && rand() < SECRET_SHARE * 3) kind = 'secret';
    doorKinds.set(key, kind);
  }

  // horizontal[y][x]: the edge along the top of cell (x, y); vertical[x][y]:
  // along its left side. Values: 'wall' | 'door' | 'secret' | null.
  const horizontal = [], vertical = [];
  const kindBetween = (x0, y0, x1, y1) => {
    const a = isOpen(x0, y0), b = isOpen(x1, y1);
    if (a !== b) return 'wall';
    if (!a) return null;
    if (inRoom(x0, y0) === inRoom(x1, y1)) return null;
    const key = (x0 < x1 || y0 < y1) ? x0 + ',' + y0 + ':' + x1 + ',' + y1 : x1 + ',' + y1 + ':' + x0 + ',' + y0;
    if (!doorKinds.has(key)) return 'wall';
    return doorKinds.get(key);
  };
  for (let y = 0; y <= rows; y++) {
    horizontal.push([]);
    for (let x = 0; x < cols; x++) horizontal[y].push(kindBetween(x, y - 1, x, y));
  }
  for (let x = 0; x <= cols; x++) {
    vertical.push([]);
    for (let y = 0; y < rows; y++) vertical[x].push(kindBetween(x - 1, y, x, y));
  }

  const out = [];
  const merge = (lines, horiz) => {
    lines.forEach((line, fixed) => {
      let start = 0;
      for (let i = 1; i <= line.length; i++) {
        if (i < line.length && line[i] === line[start]) continue;
        const kind = line[start];
        if (kind) {
          // A door is one doorway wide. Two doorways side by side are two
          // doors, as two clicks of the Wall tool would have made them.
          if (kind === 'wall') out.push({ kind, run: [start, i], fixed, horiz });
          else for (let k = start; k < i; k++) out.push({ kind, run: [k, k + 1], fixed, horiz });
        }
        start = i;
      }
    });
  };
  merge(horizontal, true);
  merge(vertical, false);
  return out;
}


/* ---------------------------------------------------------------- the floor */

/** The outline of every open cell, as closed rings of cell corners.
 *
 * Built from the boundary edges only, each directed with the open cell on its
 * left. Every corner then has as many edges leaving as arriving, so they chain
 * into closed rings; where two cells touch only at a corner the pairing is
 * arbitrary, and the even-odd fill makes that not matter. Collinear corners are
 * dropped, so a room is four points, not four per cell of its edge. */
export function floorRings(lay) {
  const { cols, rows, open } = lay;
  const isOpen = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows && open[y * cols + x] === 1;
  const next = new Map();   // "x,y" -> list of [x, y] the edges from here go to
  const add = (x0, y0, x1, y1) => {
    const k = x0 + ',' + y0;
    if (!next.has(k)) next.set(k, []);
    next.get(k).push([x1, y1]);
  };
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!isOpen(x, y)) continue;
      if (!isOpen(x, y - 1)) add(x + 1, y, x, y);          // top, leftwards
      if (!isOpen(x - 1, y)) add(x, y, x, y + 1);          // left, downwards
      if (!isOpen(x, y + 1)) add(x, y + 1, x + 1, y + 1);  // bottom, rightwards
      if (!isOpen(x + 1, y)) add(x + 1, y + 1, x + 1, y);  // right, upwards
    }
  }
  const rings = [];
  for (const startKey of [...next.keys()].sort()) {
    while (next.get(startKey).length) {
      const ring = [];
      let key = startKey;
      let guard = cols * rows * 4 + 8;
      do {
        const [x, y] = key.split(',').map(Number);
        ring.push([x, y]);
        const to = next.get(key).pop();
        key = to[0] + ',' + to[1];
      } while (key !== startKey && next.get(key) && next.get(key).length && --guard > 0);
      rings.push(dropCollinear(ring));
    }
  }
  return rings.filter((r) => r.length >= 3);
}

function dropCollinear(ring) {
  const out = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[(i + n - 1) % n], b = ring[i], c = ring[(i + 1) % n];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (cross !== 0) out.push(b);
  }
  return out;
}


/* ------------------------------------------------------------------ the map */

/** Where the dungeon's grid sits on this map: the cell size and the origin of
 *  the first whole cell, read from the grid layer as the Wall tool's snapping
 *  does. Null on a hex grid, which a dungeon of square rooms does not fit. */
export function frame(doc) {
  const grid = gridLayer(doc);
  if (grid && grid.type === 'hex') return null;
  const cell = gridStepPx(doc);
  const ox = grid ? ((grid.offsetX || 0) % cell + cell) % cell : 0;
  const oy = grid ? ((grid.offsetY || 0) % cell + cell) % cell : 0;
  const cols = Math.floor((doc.width - ox) / cell), rows = Math.floor((doc.height - oy) / cell);
  return { cell, ox, oy, cols, rows };
}

/** Everything the dungeon puts on the map, as ops, in pixels.
 *
 * `floor` and `shade` go on a paint layer, `walls` on the Walls layer and
 * `notes` on a notes layer; none of them refers to the others, so each layer
 * redraws from its own ops alone, as every layer in this program must. */
export function generateDungeon(params, doc) {
  const p = normalise(params);
  const f = frame(doc);
  if (!f || f.cols < 6 || f.rows < 6) return null;
  const lay = layout(p, f.cols, f.rows);
  const px = (cx, cy) => ({ x: f.ox + cx * f.cell, y: f.oy + cy * f.cell });

  const walls = edges(lay).map((e) => {
    const a = e.horiz ? px(e.run[0], e.fixed) : px(e.fixed, e.run[0]);
    const b = e.horiz ? px(e.run[1], e.fixed) : px(e.fixed, e.run[1]);
    return { id: uid('w'), kind: e.kind, points: [a, b] };
  });

  const rings = floorRings(lay).map((ring) => {
    const flat = [];
    for (const [cx, cy] of ring) { const q = px(cx, cy); flat.push(q.x, q.y); }
    return flat;
  });
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings) {
    for (let i = 0; i + 1 < r.length; i += 2) {
      if (r[i] < x0) x0 = r[i]; if (r[i] > x1) x1 = r[i];
      if (r[i + 1] < y0) y0 = r[i + 1]; if (r[i + 1] > y1) y1 = r[i + 1];
    }
  }
  const gen = { kind: 'dungeon', seed: p.seed, rooms: p.rooms, size: p.size, corridors: p.corridors,
                loops: p.loops, doors: p.doors, secret: p.secret };
  const floor = rings.length ? {
    t: 'stroke', mode: 'shape', shape: 'generated', gen, rings,
    tex: p.tex, scale: 1, opacity: 1, blend: 'source-over', hardness: 1, size: 0,
    points: [{ x: x0, y: y0 }, { x: x1, y: y1 }],
  } : null;
  // The rock outside: the whole frame as one more ring, which the even-odd
  // fill turns into everything except the dungeon.
  const W = doc.width, H = doc.height;
  const shade = floor && p.shade ? {
    t: 'stroke', mode: 'shape', shape: 'generated', gen: { kind: 'dungeon-shade' },
    rings: [[0, 0, W, 0, W, H, 0, H]].concat(rings),
    color: SHADE.color, opacity: SHADE.opacity, blend: 'source-over', hardness: 1, size: 0,
    points: [{ x: 0, y: 0 }, { x: W, y: H }],
  } : null;

  const notes = p.numbers ? roomNotes(lay, doc, f, px) : [];
  return { floor, shade, walls, notes, rooms: lay.rooms.length, params: p };
}

/** A note in every room, numbered from the way in.
 *
 * The entrance is the room nearest the bottom of the map, which is where a
 * plan is conventionally entered from; the rest are numbered in the order a
 * party would meet them, breadth first along the corridors, nearest first. A
 * note's number is its place in the layer, so this order is the numbering. */
function roomNotes(lay, doc, f, px) {
  const { rooms, links } = lay;
  if (!rooms.length) return [];
  const centre = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
  let entry = 0;
  rooms.forEach((r, i) => { if (r.y + r.h > rooms[entry].y + rooms[entry].h) entry = i; });
  const near = rooms.map(() => []);
  for (const l of links) { near[l.a].push(l.b); near[l.b].push(l.a); }
  const order = [entry];
  const seen = new Set(order);
  for (let k = 0; k < order.length; k++) {
    const here = centre(rooms[order[k]]);
    const next = near[order[k]].filter((j) => !seen.has(j))
      .sort((a, b) => Math.hypot(centre(rooms[a]).x - here.x, centre(rooms[a]).y - here.y)
                    - Math.hypot(centre(rooms[b]).x - here.x, centre(rooms[b]).y - here.y));
    for (const j of next) { seen.add(j); order.push(j); }
  }
  const unit = (doc.scale && doc.scale.unit) || 'ft';
  const per = (doc.scale && doc.scale.perCell) || 5;
  return order.map((i, n) => {
    const r = rooms[i];
    const area = r.w * r.h;
    const title = n === 0 ? 'Entrance' : area >= 30 ? 'Hall' : area <= 9 ? 'Small chamber' : 'Chamber';
    const at = px(r.x + r.w / 2, r.y + r.h / 2);
    return {
      id: uid('n'), x: at.x, y: at.y, title,
      body: (r.w * per) + ' x ' + (r.h * per) + ' ' + unit,
      color: NOTE_DEFAULTS.color, gen: 'dungeon',
    };
  });
}


/* -------------------------------------------------------------- committing */

/** The paint layer the floor goes on: the lowest one, which on a battle map is
 *  Terrain, directly over the Floor. */
export function floorLayer(doc) {
  return doc.layers.find((l) => l.kind === 'raster') || null;
}

const isDungeonOp = (op) => op && op.gen && (op.gen.kind === 'dungeon' || op.gen.kind === 'dungeon-shade');

/** Put a generated dungeon on the map as one undoable step.
 *
 * A dungeon generated before is replaced, not added to: its floor and shade
 * ops and its numbered notes are taken out first. The walls are replaced too
 * unless `keepWalls` is set, because a second dungeon's corridors run straight
 * through the first one's walls. Layers the dungeon needed and the map did not
 * have (walls, notes, paint) are added, and the step takes them away again. */
export function commitDungeon(result, keepWalls) {
  const doc = app.doc;
  const added = [];
  const need = (kind, make) => {
    let layer = doc.layers.find((l) => l.kind === kind && !l.locked);
    if (!layer) { layer = make(); added.push(layer); }
    return layer;
  };
  const paint = need('raster', () => makeLayer('raster', { name: 'Terrain' }));
  const walls = need('walls', () => makeLayer('walls'));
  const notesLayer = result.notes.length || doc.layers.some((l) => l.kind === 'notes')
    ? need('notes', () => makeLayer('notes', { pinSize: NOTE_DEFAULTS.pinSize, showTitles: false }))
    : null;

  for (const layer of added) {
    // Walls and paint go just above the floor, where a battle map keeps them;
    // notes go on top, as insertLayer puts them.
    if (layer.kind === 'notes') doc.layers.push(layer);
    else {
      const floorAt = doc.layers.findIndex((l) => l.kind === 'floor');
      const at = layer.kind === 'walls'
        ? Math.max(floorAt + 1, doc.layers.indexOf(paint) + 1)
        : floorAt + 1;
      doc.layers.splice(at, 0, layer);
    }
  }
  const layersAfter = doc.layers.slice();

  const touched = [paint, walls].concat(notesLayer ? [notesLayer] : []);
  const before = new Map(touched.map((l) => [l, l.ops.slice()]));
  paint.ops = paint.ops.filter((op) => !isDungeonOp(op));
  if (result.shade) paint.ops.push(result.shade);
  if (result.floor) paint.ops.push(result.floor);
  walls.ops = (keepWalls ? walls.ops : []).concat(result.walls);
  if (notesLayer) notesLayer.ops = notesLayer.ops.filter((n) => n.gen !== 'dungeon').concat(result.notes);
  const after = new Map(touched.map((l) => [l, l.ops.slice()]));

  // A layer the step added and its undo took away keeps its canvases here,
  // and gets the same ones back on redo: a paint entry made on it afterwards
  // is a closure over that canvas, and would otherwise restore into one that
  // is no longer drawn (see forgetLayer).
  //
  // Only the added layers come and go. Restoring a snapshot of the whole
  // stack threw away any layer added after the dungeon (adding a layer is not
  // itself an undo step), paint and all, on undo and again on redo.
  const shelved = new Map();
  const addedAt = added.map((l) => [l, layersAfter.indexOf(l)]).sort((a, b) => a[1] - b[1]);
  const apply = (present, ops) => {
    if (present) {
      for (const [l, at] of addedAt) {
        if (doc.layers.includes(l)) continue;
        doc.layers.splice(Math.min(at, doc.layers.length), 0, l);
        if (shelved.has(l.id)) { R.adoptLayer(shelved.get(l.id)); shelved.delete(l.id); }
      }
    } else {
      for (const l of added) if (doc.layers.includes(l)) shelved.set(l.id, R.forgetLayer(l.id));
      doc.layers = doc.layers.filter((l) => !added.includes(l));
    }
    for (const l of touched) if (doc.layers.includes(l)) l.ops = ops.get(l).slice();
    // Walls last: invalidate on a walls layer relights, and the light has to
    // be cast against the walls that are there now.
    for (const l of touched) if (doc.layers.includes(l) && l !== walls) R.invalidate(l);
    // A walls layer this step added and its undo took away is not there to
    // invalidate, and its shadows stayed on the lighting.
    if (doc.layers.includes(walls)) R.invalidate(walls); else R.relightAll();
    R.compositeAll(); R.requestDraw();
    emit('layers');
  };
  apply(true, after);
  pushEntry({
    label: 'Generate dungeon',
    bytes: 0,
    undo() { apply(false, before); },
    redo() { apply(true, after); },
  });
  markDirty(); scheduleAutosave();
}


/* ------------------------------------------------------------------- dialog */

let lastParams = null;

/** A plan of the layout: rock, floor, walls, doors and room numbers, at a
 *  scale that fits the dialog. The same layout the map will get. */
function drawPreview(canvas, params) {
  const doc = app.doc;
  const f = frame(doc);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#2b2824';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!f) return;
  const lay = layout(params, f.cols, f.rows);
  const s = Math.min(canvas.width / (f.cols * f.cell + f.ox), canvas.height / (f.rows * f.cell + f.oy)) * f.cell;
  const x0 = f.ox / f.cell * s, y0 = f.oy / f.cell * s;
  ctx.fillStyle = '#d9cfb8';
  for (let y = 0; y < f.rows; y++) for (let x = 0; x < f.cols; x++) {
    if (lay.open[y * f.cols + x]) ctx.fillRect(x0 + x * s, y0 + y * s, Math.ceil(s), Math.ceil(s));
  }
  const ink = { wall: '#1b1a18', door: '#a8763c', secret: '#6a4aa0' };
  ctx.lineCap = 'square';
  for (const e of edges(lay)) {
    ctx.strokeStyle = ink[e.kind];
    ctx.lineWidth = e.kind === 'wall' ? Math.max(1, s * 0.18) : Math.max(2, s * 0.3);
    ctx.beginPath();
    if (e.horiz) { ctx.moveTo(x0 + e.run[0] * s, y0 + e.fixed * s); ctx.lineTo(x0 + e.run[1] * s, y0 + e.fixed * s); }
    else { ctx.moveTo(x0 + e.fixed * s, y0 + e.run[0] * s); ctx.lineTo(x0 + e.fixed * s, y0 + e.run[1] * s); }
    ctx.stroke();
  }
}

export async function dungeonDialog() {
  const doc = app.doc;
  const f = doc && frame(doc);
  if (!f) return toast('A dungeon is laid out on a square grid -- this map has a hex one', 'bad');
  if (f.cols < 6 || f.rows < 6) return toast('This map is too small for a dungeon', 'bad');
  const locked = doc.layers.find((l) => l.kind === 'walls' && l.locked);
  if (locked && !doc.layers.some((l) => l.kind === 'walls' && !l.locked)) {
    return toast('The Walls layer is locked', 'bad');
  }

  // A room count that suits the map: about one room per seventy cells, which
  // is roughly what fits with medium rooms and the gaps kept between them.
  const suggested = Math.round(clamp(f.cols * f.rows / 70, 4, 24, 10));
  const p = normalise(Object.assign({ rooms: suggested }, lastParams || {}, { seed: randomSeed() }));
  const walls = doc.layers.find((l) => l.kind === 'walls');
  let keepWalls = false;

  // Held to 250 px tall, so the dialog fits a laptop screen with the plan and
  // every setting in view at once.
  const pw = Math.round(Math.min(500, 250 * doc.width / doc.height));
  const ph = Math.round(pw * doc.height / doc.width);
  const preview = el('canvas', { class: 'gen-preview', width: pw, height: ph, 'data-dungeon': 'preview' });
  const redraw = throttleFrame(() => drawPreview(preview, normalise(p)));

  const seedInput = el('input', { type: 'text', value: p.seed, placeholder: p.seed,
                                  'data-dungeon': 'seed', spellcheck: 'false' });
  seedInput.addEventListener('input', () => { p.seed = seedInput.value.trim() || seedInput.placeholder; redraw(); });
  const reroll = el('button', {
    class: 'btn', text: 'Re-roll', 'data-dungeon': 'reroll', type: 'button',
    onclick: () => { p.seed = seedInput.value = seedInput.placeholder = randomSeed(); redraw(); },
  });
  const set = (key) => (v) => { p[key] = v; redraw(); };

  const textures = library.groups.terrain
    .map((a) => [a.id, a.label || a.id]);
  if (!textures.some(([id]) => id === p.tex)) textures.unshift([p.tex, p.tex]);

  const body = el('div', { class: 'gen dungeon' }, [
    preview,
    el('div', { class: 'field span' }, [el('label', {}, [el('span', { text: 'Seed' })]),
      el('div', { class: 'gen-seed' }, [seedInput, reroll])]),
    field({ type: 'range', label: 'Rooms', min: 2, max: 40, step: 1, value: p.rooms }, set('rooms')),
    field({ type: 'select', label: 'Room size', value: p.size,
            options: Object.entries(ROOM_SIZES).map(([id, s]) => [id, s.label]) }, set('size')),
    field({ type: 'select', label: 'Corridors', value: p.corridors,
            options: [['straight', 'Straight'], ['winding', 'Winding']] }, set('corridors')),
    field({ type: 'range', label: 'Loops', min: 0, max: 0.6, step: 0.05, value: p.loops, percent: true }, set('loops')),
    field({ type: 'select', label: 'Doors', value: p.doors,
            options: Object.entries(DOOR_SHARES).map(([id, d]) => [id, d.label]) }, set('doors')),
    field({ type: 'toggle', label: 'Hide a few doors on the loops', value: p.secret }, set('secret')),
    field({ type: 'select', label: 'Floor', value: p.tex, options: textures }, set('tex')),
    field({ type: 'toggle', label: 'Shade the rock around it', value: p.shade }, set('shade')),
    field({ type: 'toggle', label: 'Number the rooms with notes', value: p.numbers }, set('numbers')),
    walls && walls.ops.length
      ? field({ type: 'select', label: 'Walls already drawn', value: 'replace',
                options: [['replace', 'Replace them'], ['keep', 'Keep them']] }, (v) => { keepWalls = v === 'keep'; })
      : null,
    el('p', { class: 'empty span', text:
      'The same seed and settings always give the same dungeon on a map this size. The walls and doors ' +
      'are written as ordinary walls, so they cast shadows, export to a virtual tabletop and can be ' +
      'edited one by one; a dungeon generated again replaces this one.' }),
  ]);
  drawPreview(preview, p);

  const go = await modal({
    title: 'Generate dungeon',
    body,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Generate', class: 'btn-primary', value: true }],
  });
  if (!go) return;
  if (app.doc !== doc) return;   // the dialog outlived the map it was opened on
  const params = normalise(p);
  // Picked from a menu, so nothing has decoded it; a floor laid with an
  // undecoded texture was flat grey until the map was reopened.
  await warm([params.tex]);
  if (app.doc !== doc) return;
  lastParams = Object.assign({}, params, { seed: '' });
  const result = generateDungeon(params, doc);
  if (!result || !result.floor) return toast('No room fitted on this map -- try smaller rooms', 'bad');
  commitDungeon(result, keepWalls);
  // Rooms that did not fit are said so, not passed over: the slider asked
  // for more than the map had room for.
  const short = result.rooms < params.rooms ? ` (${params.rooms} asked for; that is all that fitted)` : '';
  toast(`Generated ${result.rooms} rooms from seed "${params.seed}"${short}`, 'good');
}
