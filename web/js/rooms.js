/* Rooms drawn by dragging.
 *
 * Dungeon Scrawl's rectangle tool, Dungeondraft's room tool and DungeonFog's
 * all work the same way: drag out a box and you get a floor with a wall round
 * it, drag another that touches it and the two become one room with the wall
 * between them gone. Cartograph had the dungeon generator and the Wall tool,
 * and nothing between them -- a room drawn by hand was four clicks of wall and
 * a separate fill, and joining two meant cutting the wall up by hand.
 *
 * The design copies the generator's two decisions. What is stored is ordinary
 * ops: the floor as `stroke`/`shape: 'generated'` ops on a paint layer, rings
 * filled even-odd, and the walls as wall ops on the Walls layer, all tagged so
 * the tool can find its own again. And everything is worked out in grid cells:
 * the floor rings are the only record of which cells are rooms, read back by
 * testing each cell's centre against them, so there is no second list to fall
 * out of step with the picture.
 *
 * Each drag reads the cells, changes them, and derives everything again: the
 * floor (one op per texture, so each room keeps the floor it was drawn with),
 * the rock shade if it is wanted, and every wall between a room cell and a cell
 * that is not one. Doors are the exception that makes this usable: a door,
 * secret door or window lying on the outline -- put there by this tool or by
 * the Wall tool -- leaves a gap in the wall it sits in, and survives the next
 * room as long as the outline still runs under it.
 */

import { app, emit, markDirty, scheduleAutosave } from './app.js';
import { pushEntry } from './history.js';
import * as R from './render.js';
import { floorRings, frame } from './dungeon.js';
import { uid } from './util.js';

export const ROOM_TAG = 'rooms';
export const SHADE = { color: '#15120f', opacity: 0.55 };

const OPENING_KINDS = new Set(['door', 'secret', 'window']);

export const isRoomFloor = (op) => !!(op && op.gen && op.gen.kind === 'rooms');
export const isRoomShade = (op) => !!(op && op.gen && op.gen.kind === 'rooms-shade');
const isRoomPaint = (op) => isRoomFloor(op) || isRoomShade(op);
const isRoomWall = (op) => !!(op && op.gen === ROOM_TAG && op.kind === 'wall');


/* ------------------------------------------------------------- the cells */

/** Which cells are rooms, and what floor each has: an array of texture ids
 *  (null for rock), one per cell, read from the room floor ops on `paint`.
 *  A later op wins where two overlap, which only a hand-edited file makes. */
export function readCells(f, paint) {
  const tex = new Array(f.cols * f.rows).fill(null);
  if (!paint) return tex;
  for (const op of paint.ops) {
    if (!isRoomFloor(op) || !Array.isArray(op.rings)) continue;
    for (let y = 0; y < f.rows; y++) {
      const py = f.oy + (y + 0.5) * f.cell;
      for (let x = 0; x < f.cols; x++) {
        if (insideRings(op.rings, f.ox + (x + 0.5) * f.cell, py)) tex[y * f.cols + x] = op.tex || null;
      }
    }
  }
  return tex;
}

/** Even-odd, over flat [x, y, ...] rings: the rule the renderer fills by. */
function insideRings(rings, px, py) {
  let inside = false;
  for (const r of rings) {
    const n = r.length >> 1;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = r[2 * i], yi = r[2 * i + 1], xj = r[2 * j], yj = r[2 * j + 1];
      if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** The cells a drag from `a` to `b` covers, as a half-open box of cell
 *  indices clipped to the frame, or null if it covers none. The corners are
 *  rounded to grid lines whether or not snapping was on, because a room off
 *  the grid is a room whose walls the Wall tool could never meet. */
export function rectCells(f, a, b) {
  const cx = (x) => Math.round((x - f.ox) / f.cell);
  const cy = (y) => Math.round((y - f.oy) / f.cell);
  const x0 = Math.max(0, Math.min(cx(a.x), cx(b.x))), x1 = Math.min(f.cols, Math.max(cx(a.x), cx(b.x)));
  const y0 = Math.max(0, Math.min(cy(a.y), cy(b.y))), y1 = Math.min(f.rows, Math.max(cy(a.y), cy(b.y)));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x0, y0, x1, y1 };
}

/** A copy of `cells` with the box set to `tex` -- a texture to add a room,
 *  null to carve one back to rock. */
export function paintCells(cells, f, box, tex) {
  const out = cells.slice();
  for (let y = box.y0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++) out[y * f.cols + x] = tex;
  return out;
}


/* ------------------------------------------------------------- the edges */

/* A unit edge is named by the corner it starts from: 'h:x,y' runs from
 * corner (x, y) to (x + 1, y), 'v:x,y' from (x, y) to (x, y + 1). */

/** Every unit edge an axis-aligned op on grid lines lies along, or [] for one
 *  that is diagonal, off the grid, or outside it. */
export function opEdges(f, op) {
  const out = [];
  const pts = op && Array.isArray(op.points) ? op.points : [];
  const corner = (v, o) => {
    const c = (v - o) / f.cell;
    return Math.abs(c - Math.round(c)) < 0.02 ? Math.round(c) : null;
  };
  for (let i = 0; i + 1 < pts.length; i++) {
    const ax = corner(pts[i].x, f.ox), ay = corner(pts[i].y, f.oy);
    const bx = corner(pts[i + 1].x, f.ox), by = corner(pts[i + 1].y, f.oy);
    if (ax === null || ay === null || bx === null || by === null) continue;
    if (ay === by && ax !== bx) for (let x = Math.min(ax, bx); x < Math.max(ax, bx); x++) out.push('h:' + x + ',' + ay);
    else if (ax === bx && ay !== by) for (let y = Math.min(ay, by); y < Math.max(ay, by); y++) out.push('v:' + ax + ',' + y);
  }
  return out;
}

/** The unit edges between a room cell and a cell that is not one -- where
 *  the walls go. The frame's own edge counts as rock. */
export function boundary(f, cells) {
  const open = (x, y) => x >= 0 && y >= 0 && x < f.cols && y < f.rows && cells[y * f.cols + x] !== null;
  const out = new Set();
  for (let y = 0; y <= f.rows; y++) {
    for (let x = 0; x < f.cols; x++) if (open(x, y - 1) !== open(x, y)) out.add('h:' + x + ',' + y);
  }
  for (let x = 0; x <= f.cols; x++) {
    for (let y = 0; y < f.rows; y++) if (open(x - 1, y) !== open(x, y)) out.add('v:' + x + ',' + y);
  }
  return out;
}

/** The boundary edge nearest `pt`, if it is within half a cell of it. */
export function nearestEdge(f, cells, pt) {
  const edges = boundary(f, cells);
  let best = null, bestD = f.cell * 0.5;
  for (const key of edges) {
    const [dir, rest] = key.split(':');
    const [x, y] = rest.split(',').map(Number);
    const mx = f.ox + (x + (dir === 'h' ? 0.5 : 0)) * f.cell;
    const my = f.oy + (y + (dir === 'v' ? 0.5 : 0)) * f.cell;
    const d = Math.hypot(pt.x - mx, pt.y - my);
    if (d < bestD) { bestD = d; best = key; }
  }
  return best;
}

/** A unit edge's two ends, in pixels. */
export function edgePoints(f, key) {
  const [dir, rest] = key.split(':');
  const [x, y] = rest.split(',').map(Number);
  const a = { x: f.ox + x * f.cell, y: f.oy + y * f.cell };
  const b = dir === 'h' ? { x: a.x + f.cell, y: a.y } : { x: a.x, y: a.y + f.cell };
  return [a, b];
}


/* ------------------------------------------------------------ the result */

/** The paint layer the rooms are on: the one already holding room floor, or
 *  the lowest paint layer, which on a battle map is Terrain over the Floor. */
export function roomPaintLayer(doc) {
  return doc.layers.find((l) => l.kind === 'raster' && l.ops.some(isRoomPaint))
    || doc.layers.find((l) => l.kind === 'raster' && !l.locked) || null;
}

/** The paint layer's ops with the rooms' floor and shade worked out from
 *  `cells` again, in the place the old ones were -- so paint laid over the
 *  rooms afterwards stays on top of them. */
export function planPaint(doc, f, paint, cells, shade) {
  const rest = [];
  let at = -1;
  paint.ops.forEach((op) => {
    if (isRoomPaint(op)) { if (at < 0) at = rest.length; } else rest.push(op);
  });
  if (at < 0) at = rest.length;

  const px = (cx, cy) => [f.ox + cx * f.cell, f.oy + cy * f.cell];
  const ringsOf = (open) => floorRings({ cols: f.cols, rows: f.rows, open }).map((ring) => {
    const flat = [];
    for (const [cx, cy] of ring) flat.push(...px(cx, cy));
    return flat;
  });
  const made = [];
  const any = cells.some((t) => t !== null);
  if (any && shade) {
    const all = Uint8Array.from(cells, (t) => (t !== null ? 1 : 0));
    made.push({
      t: 'stroke', mode: 'shape', shape: 'generated', gen: { kind: 'rooms-shade' },
      rings: [[0, 0, doc.width, 0, doc.width, doc.height, 0, doc.height]].concat(ringsOf(all)),
      color: SHADE.color, opacity: SHADE.opacity, blend: 'source-over', hardness: 1, size: 0,
      points: [{ x: 0, y: 0 }, { x: doc.width, y: doc.height }],
    });
  }
  // Sorted, so the same rooms always come out as the same ops whatever order
  // they were drawn in.
  const textures = [...new Set(cells.filter((t) => t !== null))].sort();
  for (const tex of textures) {
    const open = Uint8Array.from(cells, (t) => (t === tex ? 1 : 0));
    const rings = ringsOf(open);
    if (!rings.length) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of rings) {
      for (let i = 0; i + 1 < r.length; i += 2) {
        x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]);
        y0 = Math.min(y0, r[i + 1]); y1 = Math.max(y1, r[i + 1]);
      }
    }
    made.push({
      t: 'stroke', mode: 'shape', shape: 'generated', gen: { kind: 'rooms' }, rings,
      tex, scale: 1, opacity: 1, blend: 'source-over', hardness: 1, size: 0,
      points: [{ x: x0, y: y0 }, { x: x1, y: y1 }],
    });
  }
  return rest.slice(0, at).concat(made, rest.slice(at));
}

/** The walls layer's ops with the rooms' walls worked out from `cells` again.
 *
 * Everything the user drew with the Wall tool stays, untouched. The tool's
 * own walls are derived afresh; its own doors stay while the outline still
 * runs under them and go with the wall they were in when it goes. Any door,
 * secret door or window on the outline -- whoever drew it -- leaves a gap in
 * the wall. A run that comes out where one already was keeps the old op, so
 * a room drawn beside another does not churn the ids of walls it never
 * touched. */
export function planWalls(f, walls, cells, extra) {
  const edges = boundary(f, cells);
  const kept = [], gaps = new Set();
  const old = new Map();
  for (const op of walls.ops.concat(extra ? [extra] : [])) {
    if (isRoomWall(op)) {
      old.set(op.points.map((p) => p.x + ',' + p.y).join(' '), op);
      continue;
    }
    const mine = op.gen === ROOM_TAG;
    const on = OPENING_KINDS.has(op.kind) ? opEdges(f, op) : [];
    if (mine && !(on.length && on.every((k) => edges.has(k)))) continue;
    kept.push(op);
    for (const k of on) if (edges.has(k)) gaps.add(k);
  }
  const run = (a, b) => {
    const pts = [{ x: f.ox + a[0] * f.cell, y: f.oy + a[1] * f.cell }, { x: f.ox + b[0] * f.cell, y: f.oy + b[1] * f.cell }];
    const key = pts.map((p) => p.x + ',' + p.y).join(' ');
    return old.get(key) || { id: uid('w'), kind: 'wall', points: pts, gen: ROOM_TAG };
  };
  const made = [];
  const solid = (key) => edges.has(key) && !gaps.has(key);
  for (let y = 0; y <= f.rows; y++) {
    let start = -1;
    for (let x = 0; x <= f.cols; x++) {
      const on = x < f.cols && solid('h:' + x + ',' + y);
      if (on && start < 0) start = x;
      if (!on && start >= 0) { made.push(run([start, y], [x, y])); start = -1; }
    }
  }
  for (let x = 0; x <= f.cols; x++) {
    let start = -1;
    for (let y = 0; y <= f.rows; y++) {
      const on = y < f.rows && solid('v:' + x + ',' + y);
      if (on && start < 0) start = y;
      if (!on && start >= 0) { made.push(run([x, start], [x, y])); start = -1; }
    }
  }
  return kept.concat(made);
}


/* ------------------------------------------------------------- committing */

/** Put new op lists on the paint and walls layers as one undoable step. A
 *  change to nothing pushes nothing: at 32 slots a dead entry evicts a real
 *  one. Returns whether anything changed. */
export function commitRooms(label, paint, paintAfter, walls, wallsAfter) {
  const same = (a, b) => a.length === b.length && a.every((op, i) => op === b[i] || JSON.stringify(op) === JSON.stringify(b[i]));
  const paintBefore = paint ? paint.ops.slice() : null;
  const wallsBefore = walls.ops.slice();
  if ((!paint || same(paintBefore, paintAfter)) && same(wallsBefore, wallsAfter)) return false;
  const apply = (p, w) => {
    if (paint && app.doc.layers.includes(paint)) { paint.ops = p.slice(); R.invalidate(paint); }
    // Walls last: invalidating a walls layer relights, and the light has to
    // be cast against the walls that are there now.
    if (app.doc.layers.includes(walls)) { walls.ops = w.slice(); R.invalidate(walls); }
    R.compositeAll(); R.requestDraw();
    emit('layers');
  };
  apply(paintAfter, wallsAfter);
  pushEntry({
    label,
    bytes: 0,
    undo() { apply(paintBefore, wallsBefore); },
    redo() { apply(paintAfter, wallsAfter); },
  });
  markDirty(); scheduleAutosave();
  return true;
}

export { frame };
