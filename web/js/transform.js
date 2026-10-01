/* Turning and mirroring what the Select tool is holding.
 *
 * A prefab of a guard post faces one way, a room copied from the last map
 * opens onto the wrong side, and the only way to turn either was to draw it
 * again. Dungeondraft turns and mirrors a selection from its Select tool, and
 * Dungeon Scrawl added the same; here it works on the set, so it works on
 * anything held -- a single stamp, a hand-picked set, or a prefab just put
 * down, which comes in picked up for exactly this.
 *
 * The whole set turns about one point, as a rigid thing: every position and
 * every point goes round, and a stamp's own angle and a cone light's facing
 * go round with them, so a chair still faces its table afterwards. Text does
 * not: a straight label keeps reading left to right and only its anchor moves,
 * and a label on a curve follows its curve, which the renderer already turns
 * the right way up.
 *
 * Walls have to stay on the grid lines, which decides both the angle and the
 * point turned about. A square grid only maps onto itself under quarter turns
 * about a corner or a cell centre; a hex grid under sixth turns about a hex
 * centre. Mirrors are the same: across a line through such a point. With
 * snapping off the grid is not a promise, and the set turns about the middle
 * of its own box.
 *
 * One undo step for the lot, holding each thing as it was and as it is, and
 * walls invalidated last so the light is cast against where they are now.
 */

import { app, emit, markDirty, scheduleAutosave } from './app.js';
import { gridLayer, latticePoint } from './doc.js';
import { pushEntry } from './history.js';
import { invalidateAll, selectedObjects } from './tools.js';
import { toast } from './util.js';

/** How far one turn goes on this map, in degrees. */
export function turnStep(doc = app.doc) {
  const grid = doc && gridLayer(doc);
  return grid && grid.type === 'hex' ? 60 : 90;
}

/** Turn the held set clockwise (`dir` 1) or anticlockwise (-1) by one step. */
export function turnSelection(dir = 1) {
  const deg = turnStep() * (dir < 0 ? -1 : 1);
  const a = (deg * Math.PI) / 180;
  const cos = clean(Math.cos(a)), sin = clean(Math.sin(a));
  return transformSet(dir < 0 ? 'Turn left' : 'Turn right', {
    point: (p, o) => ({ x: o.x + (p.x - o.x) * cos - (p.y - o.y) * sin,
                        y: o.y + (p.x - o.x) * sin + (p.y - o.y) * cos }),
    stamp: (item) => { item.rot = angleRad((item.rot || 0) + a); },
    facing: (deg0) => angleDeg(deg0 + deg),
  });
}

/** Mirror the held set: `axis` 'x' swaps left and right, 'y' top and bottom. */
export function mirrorSelection(axis = 'x') {
  const across = axis !== 'y';
  return transformSet(across ? 'Mirror' : 'Flip', {
    point: (p, o) => (across ? { x: 2 * o.x - p.x, y: p.y } : { x: p.x, y: 2 * o.y - p.y }),
    // A mirror is a turn and a flip: across the vertical the stamp's angle
    // changes sign, across the horizontal it is also turned half round.
    stamp: (item) => {
      item.flip = !item.flip;
      item.rot = angleRad(across ? -(item.rot || 0) : Math.PI - (item.rot || 0));
    },
    facing: (deg0) => angleDeg(across ? 180 - deg0 : -deg0),
  });
}

/* ------------------------------------------------------------------ the work */

// The pivot of the last turn, and what it left behind. A set whose box is not
// square has a different box after a quarter turn, so a pivot worked out
// afresh each time wanders: R then Shift+R landed a cell away from where it
// began. Turning the very same things again, untouched since, goes about the
// same point, so turns undo each other and four of them come back exactly.
let last = null;

function transformSet(label, how) {
  const set = selectedObjects();
  if (!set.length) { toast('Pick something up with the Select tool first'); return false; }
  const items = set.map((s) => s.item);
  const same = last && last.items.length === items.length && last.items.every((it, i) => it === items[i])
    && last.doc === app.doc && last.state === JSON.stringify(items);
  const pivot = same ? last.pivot : pivotFor(items);
  const steps = set.map((s) => ({ layer: s.layer, item: s.item, before: copy(s.item) }));
  for (const st of steps) apply(st.layer, st.item, pivot, how);
  for (const st of steps) st.after = copy(st.item);
  last = { items, doc: app.doc, pivot, state: JSON.stringify(items) };
  const layers = new Set(steps.map((st) => st.layer));
  // Deep copies both ways, and keys the snapshot lacks taken off: a stamp
  // that had no `flip` before a mirror must not keep one after the undo.
  const put = (which) => {
    for (const st of steps) {
      const snap = st[which];
      for (const k of Object.keys(st.item)) if (!(k in snap)) delete st.item[k];
      Object.assign(st.item, copy(snap));
    }
    invalidateAll(layers);
    emit('selection');
  };
  invalidateAll(layers);
  emit('selection');
  pushEntry({ label, undo() { put('before'); }, redo() { put('after'); } });
  markDirty();
  scheduleAutosave();
  return true;
}

function apply(layer, item, pivot, how) {
  const turn = (p) => ({ ...p, ...settle(how.point(p, pivot)) });
  if (item.x != null) Object.assign(item, settle(how.point(item, pivot)));
  if (item.points) item.points = item.points.map(turn);
  if (layer.kind === 'objects') how.stamp(item);
  // Only a cone has a facing worth turning; a round light looks the same
  // whichever way its angle points, and a field left alone stays out of the
  // diff of the file.
  if (layer.kind === 'lights' && item.cone != null && item.cone < 360) {
    item.angle = how.facing(item.angle || 0);
  }
}

/** The point the set turns about: the middle of its box, moved to the nearest
 *  point the grid is symmetric about -- a corner or a cell centre on a square
 *  grid, a hex centre on a hex one -- so the lines come round onto lines. */
function pivotFor(items) {
  // One stamp, lamp or pin turns where it stands: there is nothing else in the
  // set for it to keep its place against, and it is on whatever lattice point
  // it was put on already.
  if (items.length === 1 && items[0].x != null && !items[0].points) return { x: items[0].x, y: items[0].y };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const take = (p) => { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); };
  for (const item of items) {
    if (item.points) for (const p of item.points) take(p);
    if (item.x != null) take(item);
  }
  const mid = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  const doc = app.doc;
  if ((doc.snap || 'off') === 'off') return mid;
  const grid = gridLayer(doc);
  if (grid && grid.type === 'hex') return latticePoint(doc, mid, 'centre');
  const centre = latticePoint(doc, mid, 'centre');
  const corner = latticePoint(doc, mid, 'corner');
  const d = (p) => Math.hypot(p.x - mid.x, p.y - mid.y);
  return d(corner) <= d(centre) ? corner : centre;
}

/* ------------------------------------------------------------------ numbers */

// A quarter turn through cos/sin leaves 6e-17 where 0 belongs.
function clean(v) { return Math.abs(v) < 1e-12 ? 0 : v; }

/** Where a turned point lands, put exactly on the lattice point it is within
 *  a hair of. Arithmetic leaves a wall end at 699.9999999 or a hex corner a
 *  rounding error off the one the Wall tool snaps to, and errors like that
 *  add up over a dozen turns into an end the next snap disagrees about. */
function settle(p) {
  const doc = app.doc;
  if ((doc.snap || 'off') !== 'off') {
    for (const prefer of ['corner', 'centre']) {
      const q = latticePoint(doc, p, prefer);
      if (Math.hypot(q.x - p.x, q.y - p.y) < 0.01) return { x: q.x, y: q.y };
    }
  }
  const r = (v) => Math.round(v * 1e6) / 1e6;
  return { x: r(p.x), y: r(p.y) };
}

/** An angle in radians, folded into (-pi, pi]. A whole number of sixth or
 *  quarter turns is put exactly on that multiple of pi, so turning one way and
 *  back, or four times round, lands on the very number it started from rather
 *  than a float's width beside it. */
function angleRad(v) {
  let a = v % (2 * Math.PI);
  if (a <= -Math.PI) a += 2 * Math.PI;
  if (a > Math.PI) a -= 2 * Math.PI;
  const k = Math.round(a / (Math.PI / 12));
  if (Math.abs(a - (k * Math.PI) / 12) < 1e-9) a = k === 0 ? 0 : (Math.PI * k) / 12;
  return a;
}

/** An angle in degrees, folded into (-180, 180]. */
function angleDeg(v) {
  let a = v % 360;
  if (a <= -180) a += 360;
  if (a > 180) a -= 360;
  return Math.round(a * 1e4) / 1e4;
}

function copy(v) { return JSON.parse(JSON.stringify(v)); }
