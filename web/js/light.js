/* Shadow casting.
 *
 * A light that ignores walls is a pretty gradient. A light that stops at them
 * is a map you can run an encounter from, and that difference is the whole
 * reason this file exists.
 *
 * The method is the classic visibility polygon: cast a ray at every wall
 * corner the light can see, and two more a hair either side of it, so a beam
 * that grazes a corner carries on to whatever is behind rather than stopping
 * dead on the corner itself. Sort the hits by angle and you have the polygon
 * of everything lit.
 *
 * Pure geometry, like hex.js — it is handed segments and knows nothing about
 * layers, walls or canvases, so the renderer stays the only place that has to
 * know what counts as a wall.
 */

const EPS = 1e-9;

/* A ray that passes exactly through a corner is ambiguous: it can stop on the
   corner or slip past it, and floating point picks. Casting either side of it
   settles the question, and 1e-4 radians is wide enough to be a different
   answer without being wide enough to see. */
const NUDGE = 1e-4;

/* How close in front of the light a wall has to be before it is treated as the
   one the light is sitting on. Well under a pixel, since rays are unit length. */
const T_MIN = 1e-3;

/** How far `t` along the ray the segment is hit, or Infinity for a miss.
 *
 *  Ray: O + t·D. Segment: A + u·S, with u in [0, 1]. */
function hit(ox, oy, dx, dy, seg) {
  const sx = seg.b.x - seg.a.x, sy = seg.b.y - seg.a.y;
  const det = sx * dy - dx * sy;
  if (Math.abs(det) < EPS) return Infinity;      // parallel, or a zero-length wall
  const rx = seg.a.x - ox, ry = seg.a.y - oy;
  const u = (dx * ry - dy * rx) / det;
  if (u < 0 || u > 1) return Infinity;
  const t = (sx * ry - rx * sy) / det;
  // A wall through the light itself is hit at t = 0 by every ray, and the
  // visibility polygon collapses to a point: the lamp lit nothing. Snapping
  // puts lights exactly there -- a diagonal wall crosses a square's centre, a
  // hex light snaps to corners -- so such a wall is taken as not in the way.
  return t < T_MIN ? Infinity : t;
}

/** Distance from a point to a segment — used only to decide whether a wall is
 *  close enough to this light to matter. */
function reach(seg, px, py) {
  const sx = seg.b.x - seg.a.x, sy = seg.b.y - seg.a.y;
  const len = sx * sx + sy * sy;
  let t = len < EPS ? 0 : ((px - seg.a.x) * sx + (py - seg.a.y) * sy) / len;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(seg.a.x + sx * t - px, seg.a.y + sy * t - py);
}

/** The part of a segment inside an axis-aligned box (Liang-Barsky), or null. */
function clip(seg, x0, y0, x1, y1) {
  const dx = seg.b.x - seg.a.x, dy = seg.b.y - seg.a.y;
  const p = [-dx, dx, -dy, dy];
  const q = [seg.a.x - x0, x1 - seg.a.x, seg.a.y - y0, y1 - seg.a.y];
  let t0 = 0, t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return null; continue; }
    const t = q[i] / p[i];
    if (p[i] < 0) { if (t > t1) return null; if (t > t0) t0 = t; } else { if (t < t0) return null; if (t < t1) t1 = t; }
  }
  return { a: { x: seg.a.x + dx * t0, y: seg.a.y + dy * t0 }, b: { x: seg.a.x + dx * t1, y: seg.a.y + dy * t1 } };
}

/** Where two segments cross, or null. */
function crossing(p, q) {
  const rx = p.b.x - p.a.x, ry = p.b.y - p.a.y, sx = q.b.x - q.a.x, sy = q.b.y - q.a.y;
  const det = rx * sy - ry * sx;
  if (Math.abs(det) < EPS) return null;
  const qx = q.a.x - p.a.x, qy = q.a.y - p.a.y;
  const t = (qx * sy - qy * sx) / det, u = (qx * ry - qy * rx) / det;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { x: p.a.x + rx * t, y: p.a.y + ry * t } : null;
}

/** The polygon of everything a light at `origin` can see within `radius`.
 *
 * Returns null when nothing is in the way, so the caller can draw a plain
 * circle instead of a 12-sided approximation of one. */
export function visibility(origin, radius, segments) {
  // A bounding square so every ray terminates somewhere. Without it a ray that
  // escapes between two walls has no intersection and the polygon tears open.
  const r = radius * 1.05;
  // Each wall is clipped to that square first. Rays are cast only at segment
  // ends, so a wall running out past the square had no vertex where it met
  // it, and the polygon cut straight across the corner between the square
  // and the wall -- a dark wedge inside the light's own reach.
  const near = [];
  for (const s of segments) {
    if (reach(s, origin.x, origin.y) > radius) continue;
    const c = clip(s, origin.x - r, origin.y - r, origin.x + r, origin.y + r);
    if (c) near.push(c);
  }
  if (!near.length) return null;

  const box = [
    { x: origin.x - r, y: origin.y - r }, { x: origin.x + r, y: origin.y - r },
    { x: origin.x + r, y: origin.y + r }, { x: origin.x - r, y: origin.y + r },
  ];
  const all = near.concat([
    { a: box[0], b: box[1] }, { a: box[1], b: box[2] },
    { a: box[2], b: box[3] }, { a: box[3], b: box[0] },
  ]);

  // Where two walls cross is a corner of the lit area too, and no segment
  // end marks it.
  const corners = [];
  for (const s of all) corners.push(s.a, s.b);
  for (let i = 0; i < near.length; i++) {
    for (let j = i + 1; j < near.length; j++) {
      const x = crossing(near[i], near[j]);
      if (x) corners.push(x);
    }
  }
  const angles = [];
  for (const p of corners) {
    const a = Math.atan2(p.y - origin.y, p.x - origin.x);
    angles.push(a - NUDGE, a, a + NUDGE);
  }
  angles.sort((x, y) => x - y);

  const poly = [];
  for (const a of angles) {
    const dx = Math.cos(a), dy = Math.sin(a);
    let best = Infinity;
    for (const s of all) {
      const t = hit(origin.x, origin.y, dx, dy, s);
      if (t < best) best = t;
    }
    if (!isFinite(best)) continue;
    poly.push({ x: origin.x + dx * best, y: origin.y + dy * best });
  }
  return poly.length > 2 ? poly : null;
}

/** Trace a light's lit area into `ctx` as a path, ready to clip or fill.
 *
 * `cone` narrows it to a wedge facing `angle` — a lantern shuttered on three
 * sides, or a spell that fires in one direction. */
export function litPath(ctx, op, radius, segments) {
  const origin = { x: op.x, y: op.y };
  const poly = segments && segments.length ? visibility(origin, radius, segments) : null;
  ctx.beginPath();
  if (poly) {
    for (let i = 0; i < poly.length; i++) {
      if (i === 0) ctx.moveTo(poly[i].x, poly[i].y); else ctx.lineTo(poly[i].x, poly[i].y);
    }
    ctx.closePath();
  } else {
    ctx.arc(origin.x, origin.y, radius, 0, Math.PI * 2);
  }
}

/** The wedge of a directional light, as a second path to clip against. */
export function conePath(ctx, op, radius) {
  const facing = ((op.angle || 0) * Math.PI) / 180;
  const half = (((op.cone || 360) * Math.PI) / 180) / 2;
  ctx.beginPath();
  ctx.moveTo(op.x, op.y);
  ctx.arc(op.x, op.y, radius, facing - half, facing + half);
  ctx.closePath();
}

/** Is this light directional? */
export function isCone(op) {
  const c = op.cone;
  return c != null && c > 0 && c < 360;
}
