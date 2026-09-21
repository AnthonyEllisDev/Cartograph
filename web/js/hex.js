/* Hex geometry.
 *
 * One definition of where the hexes are, shared by the renderer, the snapping,
 * the measure tool and the extension API. Keeping it in one place is the whole
 * point: a grid you can see but cannot snap to is worse than no grid at all,
 * and that is exactly what happens when the drawing code and the picking code
 * each carry their own arithmetic.
 *
 * Internally everything is axial (q, r). Offset (col, row) exists only at the
 * edges, because a human reading a coordinate off a map wants columns and rows,
 * and because that is what the grid layer's offsets are expressed in.
 *
 * `size` is corner-to-corner across the hex — the same number the grid layer
 * has always stored, so old documents keep the geometry they were drawn with.
 * Note that this is NOT the distance between two neighbouring centres; that is
 * `step()`, and it is the number every measurement wants. */

const SQRT3 = Math.sqrt(3);

/** Pull the geometry out of a grid layer. `size` is corner-to-corner. */
export function metrics(grid) {
  const size = Math.max(4, (grid && grid.size) || 64);
  return {
    r: size / 2,
    pointy: !!(grid && grid.orientation === 'pointy'),
    ox: (grid && grid.offsetX) || 0,
    oy: (grid && grid.offsetY) || 0,
  };
}

/** Centre-to-centre distance — one hex "cell" as measurement understands it.
 *  The same for both orientations, which is why nothing downstream has to
 *  care which way up the hexes are. */
export function step(grid) {
  return metrics(grid).r * SQRT3;
}

/* -- axial <-> pixel ------------------------------------------------------- */

export function toPixel(grid, q, r) {
  const m = metrics(grid);
  return m.pointy
    ? { x: m.ox + m.r * SQRT3 * (q + r / 2), y: m.oy + m.r * 1.5 * r }
    : { x: m.ox + m.r * 1.5 * q, y: m.oy + m.r * SQRT3 * (r + q / 2) };
}

/** The hex containing a point, as axial coordinates. */
export function at(grid, pt) {
  const m = metrics(grid);
  const x = (pt.x - m.ox) / m.r, y = (pt.y - m.oy) / m.r;
  const q = m.pointy ? (SQRT3 / 3) * x - y / 3 : (2 / 3) * x;
  const r = m.pointy ? (2 / 3) * y : -x / 3 + (SQRT3 / 3) * y;
  return round(q, r);
}

/** Cube rounding. Rounding q and r independently lands in the wrong hex near
 *  the edges; the trick is to round all three cube axes and then discard
 *  whichever one moved furthest, so the q+r+s = 0 identity is restored by the
 *  coordinate we trust least. */
export function round(q, r) {
  const s = -q - r;
  let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq, r: rr };
}

/* -- the pieces of one hex ------------------------------------------------- */

/** The six vertices, in the order the renderer draws them. */
export function corners(grid, q, r) {
  const m = metrics(grid);
  const c = toPixel(grid, q, r);
  const turn = m.pointy ? Math.PI / 6 : 0;
  const out = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + turn;
    out.push({ x: c.x + m.r * Math.cos(a), y: c.y + m.r * Math.sin(a) });
  }
  return out;
}

/** The midpoint of each of the six edges — where a wall between two hexes
 *  wants to sit, and what "half a cell" means on a hex grid. */
export function edgeMidpoints(grid, q, r) {
  const c = corners(grid, q, r);
  return c.map((p, i) => {
    const n = c[(i + 1) % 6];
    return { x: (p.x + n.x) / 2, y: (p.y + n.y) / 2 };
  });
}

const NEIGHBOURS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

export function neighbours(q, r) {
  return NEIGHBOURS.map(([dq, dr]) => ({ q: q + dq, r: r + dr }));
}

/* -- distance and the line between two hexes ------------------------------- */

/** How many hexes you cross getting from a to b. This is the number a hex
 *  crawl actually cares about; the straight-line pixel distance is a different
 *  question with a different answer. */
export function distance(a, b) {
  const dq = a.q - b.q, dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** Every hex on the shortest path from a to b, ends included.
 *
 * The epsilon nudge matters: without it a line that runs exactly along a hex
 * boundary picks arbitrarily on each step and produces a path that visibly
 * zig-zags rather than hugging one side. */
export function line(a, b) {
  const n = distance(a, b);
  if (n === 0) return [{ q: a.q, r: a.r }];
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push(round(a.q + (b.q - a.q) * t + 1e-6, a.r + (b.r - a.r) * t + 2e-6));
  }
  return out;
}

/* -- snapping -------------------------------------------------------------- */

function nearest(candidates, pt) {
  let best = null, bestD = Infinity;
  for (const c of candidates) {
    const d = (c.x - pt.x) ** 2 + (c.y - pt.y) ** 2;
    if (d < bestD) { bestD = d; best = c; }
  }
  return best || pt;
}

/** Candidate points from the hex under the cursor and its six neighbours.
 *
 * Only the containing hex is ever needed for a centre, but a vertex is shared
 * by three hexes and an edge midpoint by two, so gathering the ring as well is
 * the cheap way to be obviously correct rather than argued-correct. Duplicates
 * do not matter — the nearest of two identical points is the same point. */
function around(grid, pt, want) {
  const h = at(grid, pt);
  const cells = [h, ...neighbours(h.q, h.r)];
  const out = [];
  for (const c of cells) {
    if (want.centre) out.push(toPixel(grid, c.q, c.r));
    if (want.corner) out.push(...corners(grid, c.q, c.r));
    if (want.edge) out.push(...edgeMidpoints(grid, c.q, c.r));
  }
  return out;
}

/** Snap a point to a hex grid.
 *
 * `prefer` is the tool's request — a token belongs in the middle of a hex, a
 * wall belongs on the line between two — and `mode` is the document's snapping
 * setting. Half-cell snapping offers centres, vertices and edge midpoints at
 * once, which is the hex equivalent of halving a square step. */
export function snap(grid, pt, prefer = 'corner', mode = 'grid') {
  if (mode === 'half') {
    return nearest(around(grid, pt, { centre: true, corner: true, edge: true }), pt);
  }
  if (prefer === 'centre') {
    const h = at(grid, pt);
    return toPixel(grid, h.q, h.r);
  }
  return nearest(around(grid, pt, { corner: true }), pt);
}

/* -- walking the whole map ------------------------------------------------- */

/** How far apart columns and rows sit. Not the same as `step()`: neighbouring
 *  columns are staggered, so a column is closer than a full hex away. Sizing a
 *  map in hexes wants these two numbers. */
export function spacing(grid) {
  const m = metrics(grid);
  return m.pointy
    ? { col: m.r * SQRT3, row: m.r * 1.5 }
    : { col: m.r * 1.5, row: m.r * SQRT3 };
}

/** Visit every hex whose centre falls in (or just outside) a w x h map.
 *
 * The renderer and anything that wants to write into cells share this so they
 * agree about which hexes exist and what to call them. `col` and `row` are the
 * offset coordinates a person would read off the map. */
export function forEach(grid, w, h, fn) {
  const m = metrics(grid);
  const { col: dCol, row: dRow } = spacing(grid);
  for (let col = -1; m.ox + col * dCol <= w + dCol; col++) {
    for (let row = -1; m.oy + row * dRow <= h + dRow; row++) {
      const { q, r } = fromOffset(grid, col, row);
      const c = toPixel(grid, q, r);
      fn(c.x, c.y, col, row, q, r);
    }
  }
}

/** Offset (col, row) -> axial. Odd-q for flat-top, odd-r for pointy-top. */
export function fromOffset(grid, col, row) {
  return metrics(grid).pointy
    ? { q: col - (row - (row & 1)) / 2, r: row }
    : { q: col, r: row - (col - (col & 1)) / 2 };
}

/** Axial -> offset (col, row), for anything that shows a human a coordinate. */
export function toOffset(grid, q, r) {
  return metrics(grid).pointy
    ? { col: q + (r - (r & 1)) / 2, row: r }
    : { col: q, row: r + (q - (q & 1)) / 2 };
}
