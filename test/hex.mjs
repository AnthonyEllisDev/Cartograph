/* Hex grids: snapping, measurement and the two orientations.
 *
 * Start the server first:  python3 app.py --no-browser --port 7871
 * Then:                    node test/hex.mjs [http://127.0.0.1:7871]
 *
 * The point of every check here is the same one: what the grid draws and what
 * the editor snaps to have to be the same hexes. A grid you can see but cannot
 * land on is worse than no grid at all. */

import { launch, base } from './browser.mjs';

const out = [];
let fails = 0;
function t(name, pass, note) {
  out.push([pass ? 'PASS' : 'FAIL', name, note == null ? '' : String(note)]);
  if (!pass) fails++;
}
const near = (a, b, eps = 0.02) => Math.abs(a - b) <= eps;

const b = await launch();
const p = await b.newPage({ viewport: { width: 1700, height: 1000 } });
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await p.goto(base('http://127.0.0.1:7871/'), { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);

/* helpers -------------------------------------------------------------- */

const M = (mx, my) => p.evaluate(([x, y]) => {
  const s = window.__cg.mapToScreen(x, y);
  const r = document.getElementById('canvas').getBoundingClientRect();
  return { x: r.left + s.x, y: r.top + s.y };
}, [mx, my]);
const clickAt = async (x, y) => { const s = await M(x, y); await p.mouse.click(s.x, s.y); await p.waitForTimeout(90); };
const tool = async (n) => { await p.click(`.tool[data-tool="${n}"]`); await p.waitForTimeout(180); };
const grid = () => p.evaluate(() => window.__cg.app.doc.layers.find((l) => l.kind === 'grid'));

/* a hex crawl, made through the real dialog ----------------------------- */

await p.click('.tab[data-tab="projects"]');
await p.waitForTimeout(300);
await p.click('#btn-new-project');
await p.waitForTimeout(400);
await p.fill('.modal input[type=text]', 'The Bitter Marches');
await p.selectOption('.modal select >> nth=0', 'hex');
await p.waitForTimeout(250);
await p.selectOption('.modal select >> nth=1', '20x14');
await p.click('.modal .btn-primary');
await p.waitForTimeout(1000);

const doc = await p.evaluate(() => {
  const d = window.__cg.app.doc;
  return { kind: d.kind, w: d.width, h: d.height, scale: d.scale, snap: d.snap,
           grid: d.layers.find((l) => l.kind === 'grid') };
});
t('the New Map dialog offers a hex crawl', doc.kind === 'hex', doc.kind);
t('it comes with a hex grid turned on', doc.grid.type === 'hex' && doc.snap === 'grid',
  doc.grid.type + ', snap ' + doc.snap);
t('it counts in hexes', doc.scale.unit === 'hex' && doc.scale.perCell === 1,
  doc.scale.perCell + ' ' + doc.scale.unit);

// The stored scale must be the centre-to-centre step, not the corner-to-corner
// width. Getting this wrong makes every distance on the map 15% too long.
const wantStep = doc.grid.size * Math.sqrt(3) / 2;
t('a cell is measured across the flats, not corner to corner',
  near(doc.scale.cellPx, wantStep, 0.01), doc.scale.cellPx.toFixed(2) + ' px, want ' + wantStep.toFixed(2));
t('the map is sized in whole hexes', doc.w === Math.round(20 * doc.grid.size * 0.75)
  && doc.h === Math.round(14 * wantStep), doc.w + ' × ' + doc.h);

/* snapping --------------------------------------------------------------- */

/** Ask the page what the shared geometry says, so the test compares the
 *  editor's behaviour against the definition rather than against a number
 *  copied out of it. */
const geom = (fn, ...args) => p.evaluate(async ([f, a]) => {
  const H = await import('/js/hex.js');
  const g = window.__cg.app.doc.layers.find((l) => l.kind === 'grid');
  return H[f](g, ...a);
}, [fn, args]);

const snapped = (pt, prefer, mode) => p.evaluate(async ([q, pref, m]) => {
  const D = await import('/js/doc.js');
  const doc = window.__cg.app.doc;
  const was = doc.snap;
  doc.snap = m;
  const r = D.snapPoint(doc, q, pref);
  doc.snap = was;
  return r;
}, [pt, prefer, mode]);

// A point deliberately nowhere near anything.
const loose = { x: 431.7, y: 388.3 };

const centre = await snapped(loose, 'centre', 'grid');
const owning = await p.evaluate(async ([q]) => {
  const H = await import('/js/hex.js');
  const g = window.__cg.app.doc.layers.find((l) => l.kind === 'grid');
  const h = H.at(g, q);
  return { h, c: H.toPixel(g, h.q, h.r) };
}, [loose]);
t('a stamp lands in the middle of the hex it was dropped in',
  near(centre.x, owning.c.x) && near(centre.y, owning.c.y),
  `(${centre.x.toFixed(1)}, ${centre.y.toFixed(1)})`);

const corner = await snapped(loose, 'corner', 'grid');
const cornerIsAVertex = await p.evaluate(async ([q, snapPt]) => {
  const H = await import('/js/hex.js');
  const g = window.__cg.app.doc.layers.find((l) => l.kind === 'grid');
  const h = H.at(g, q);
  const cells = [h, ...H.neighbours(h.q, h.r)];
  let best = Infinity;
  for (const c of cells) {
    for (const v of H.corners(g, c.q, c.r)) {
      best = Math.min(best, Math.hypot(v.x - snapPt.x, v.y - snapPt.y));
    }
  }
  // and is it the nearest one to the original point?
  let nearest = Infinity, nx = 0, ny = 0;
  for (const c of cells) {
    for (const v of H.corners(g, c.q, c.r)) {
      const d = Math.hypot(v.x - q.x, v.y - q.y);
      if (d < nearest) { nearest = d; nx = v.x; ny = v.y; }
    }
  }
  return { onAVertex: best, nx, ny };
}, [loose, corner]);
t('a wall lands on a hex corner', near(cornerIsAVertex.onAVertex, 0),
  cornerIsAVertex.onAVertex.toFixed(4) + ' px off');
t('and on the nearest one',
  near(corner.x, cornerIsAVertex.nx) && near(corner.y, cornerIsAVertex.ny),
  `(${corner.x.toFixed(1)}, ${corner.y.toFixed(1)})`);

// Half-cell snapping adds the edge midpoints, which is where a wall between two
// hexes wants to sit. Probe just off one of them; whole-cell snapping should
// walk away to a corner instead, which is exactly the difference between the
// two settings.
const mids = await geom('edgeMidpoints', owning.h.q, owning.h.r);
const probe = { x: mids[0].x + 3, y: mids[0].y - 3 };
const half = await snapped(probe, 'corner', 'half');
t('half cells offer the edge midpoints', near(half.x, mids[0].x) && near(half.y, mids[0].y),
  `(${half.x.toFixed(1)}, ${half.y.toFixed(1)}) want (${mids[0].x.toFixed(1)}, ${mids[0].y.toFixed(1)})`);
const whole = await snapped(probe, 'corner', 'grid');
t('whole cells do not', !near(whole.x, mids[0].x, 0.5) || !near(whole.y, mids[0].y, 0.5),
  `(${whole.x.toFixed(1)}, ${whole.y.toFixed(1)})`);

// Alt has to keep working: snapping you cannot escape is a trap.
const off = await snapped(loose, 'centre', 'off');
t('snapping off leaves the point alone', off.x === loose.x && off.y === loose.y);

/* the grid you see is the grid you land on ------------------------------- */

// Drop a real stamp with a real click and check it centred itself.
await p.click('.tab[data-tab="map"]');
await p.waitForTimeout(250);
await tool('stamp');
await p.click('#asset-picker .asset >> nth=0');
await p.waitForTimeout(200);
const target = await p.evaluate(async () => {
  const H = await import('/js/hex.js');
  const g = window.__cg.app.doc.layers.find((l) => l.kind === 'grid');
  const c = H.toPixel(g, 4, 2);
  return { c, off: { x: c.x + 14, y: c.y - 11 } };   // click near the centre, not on it
});
await clickAt(target.off.x, target.off.y);
await p.waitForTimeout(250);
const placed = await p.evaluate(() => {
  const l = window.__cg.app.doc.layers.find((x) => x.kind === 'objects');
  return l && l.ops.length ? { x: l.ops[l.ops.length - 1].x, y: l.ops[l.ops.length - 1].y } : null;
});
t('a real click through the real tool centres the stamp',
  !!placed && near(placed.x, target.c.x, 0.6) && near(placed.y, target.c.y, 0.6),
  placed ? `(${placed.x.toFixed(1)}, ${placed.y.toFixed(1)}) want (${target.c.x.toFixed(1)}, ${target.c.y.toFixed(1)})` : 'nothing placed');

/* measurement ------------------------------------------------------------ */

const measured = (aq, ar, bq, br) => p.evaluate(async ([a, c]) => {
  const H = await import('/js/hex.js');
  const D = await import('/js/doc.js');
  const doc = window.__cg.app.doc;
  const g = doc.layers.find((l) => l.kind === 'grid');
  const from = H.toPixel(g, a[0], a[1]), to = H.toPixel(g, c[0], c[1]);
  const r = D.measureBetween(doc, from, to);
  return { text: r.text, cells: r.cells, path: r.path.length, hex: r.hex };
}, [[aq, ar], [bq, br]]);

const east = await measured(0, 0, 4, 0);
t('measuring counts hexes, not pixels', east.hex && east.cells === 4, east.text);
t('the label says so', east.text === '4 hexes', east.text);
t('and it knows the path it counted', east.path === 5, east.path + ' hexes on the path');

// The whole point of hex distance: a diagonal step is one step, not 1.4.
const diag = await measured(0, 0, 3, -3);
t('three hexes north-east is three hexes', diag.cells === 3, diag.text);
const one = await measured(0, 0, 1, 0);
t('one hex is singular', one.text === '1 hex', one.text);

// With a real-world unit the reading carries both numbers.
const both = await p.evaluate(async () => {
  const H = await import('/js/hex.js');
  const D = await import('/js/doc.js');
  const doc = window.__cg.app.doc;
  const g = doc.layers.find((l) => l.kind === 'grid');
  const was = { ...doc.scale };
  doc.scale.unit = 'mi'; doc.scale.perCell = 6;
  const r = D.measureBetween(doc, H.toPixel(g, 0, 0), H.toPixel(g, 4, 0));
  Object.assign(doc.scale, was);
  return r.text;
});
t('a real-world unit reads as both', both === '24 mi  ·  4 hexes', both);

/* pointy-top ------------------------------------------------------------- */

await p.evaluate(async () => {
  const doc = window.__cg.app.doc;
  const g = doc.layers.find((l) => l.kind === 'grid');
  g.orientation = 'pointy';
  const D = await import('/js/doc.js');
  doc.scale.cellPx = D.gridStepPx(doc);
  window.__cg.R.invalidate(g);
});
await p.waitForTimeout(300);

const pointyCentre = await snapped(loose, 'centre', 'grid');
const pointyOwning = await p.evaluate(async ([q]) => {
  const H = await import('/js/hex.js');
  const g = window.__cg.app.doc.layers.find((l) => l.kind === 'grid');
  const h = H.at(g, q);
  return H.toPixel(g, h.q, h.r);
}, [loose]);
t('pointy-top hexes snap to their own centres',
  near(pointyCentre.x, pointyOwning.x) && near(pointyCentre.y, pointyOwning.y));
t('turning the hexes moves the snapping with them',
  !near(pointyCentre.x, centre.x, 1) || !near(pointyCentre.y, centre.y, 1),
  `flat (${centre.x.toFixed(0)}, ${centre.y.toFixed(0)}) vs pointy (${pointyCentre.x.toFixed(0)}, ${pointyCentre.y.toFixed(0)})`);
t('and the step across the flats is unchanged',
  near(await p.evaluate(() => window.__cg.app.doc.scale.cellPx), wantStep, 0.01));

// Round-trip offset <-> axial in both orientations: this is what the
// coordinates extension reads, and an off-by-one here mislabels a whole map.
const roundTrip = await p.evaluate(async () => {
  const H = await import('/js/hex.js');
  const g = window.__cg.app.doc.layers.find((l) => l.kind === 'grid');
  const bad = [];
  for (const orientation of ['flat', 'pointy']) {
    const gg = { ...g, orientation };
    for (let col = -3; col <= 6; col++) {
      for (let row = -3; row <= 6; row++) {
        const a = H.fromOffset(gg, col, row);
        const o = H.toOffset(gg, a.q, a.r);
        if (o.col !== col || o.row !== row) bad.push(`${orientation} ${col},${row}`);
      }
    }
  }
  return bad;
});
t('offset and axial coordinates round-trip', roundTrip.length === 0, roundTrip.slice(0, 4).join(' '));

/* a picture, and the reload invariant ------------------------------------ */

await p.evaluate(async () => {
  const doc = window.__cg.app.doc;
  doc.layers.find((l) => l.kind === 'grid').orientation = 'flat';
  window.__cg.R.invalidate(doc.layers.find((l) => l.kind === 'grid'));
});
await tool('measure');
const m1 = await p.evaluate(async () => {
  const H = await import('/js/hex.js'); const g = window.__cg.app.doc.layers.find((l) => l.kind === 'grid');
  return H.toPixel(g, 2, 3);
});
const m2 = await p.evaluate(async () => {
  const H = await import('/js/hex.js'); const g = window.__cg.app.doc.layers.find((l) => l.kind === 'grid');
  return H.toPixel(g, 8, 0);
});
const s1 = await M(m1.x, m1.y), s2 = await M(m2.x, m2.y);
await p.mouse.move(s1.x, s1.y); await p.mouse.down(); await p.mouse.move(s2.x, s2.y, { steps: 6 });
await p.waitForTimeout(400);
await p.screenshot({ path: '/tmp/cg_hex.png' });
await p.mouse.up();
t('a screenshot of the measured path was taken', true, '/tmp/cg_hex.png');

const fingerprint = () => p.evaluate(() => {
  const c = window.__cg.R.flatten({ scale: 1, grid: true, paper: true });
  const s = document.createElement('canvas'); s.width = 64; s.height = 64;
  const x = s.getContext('2d'); x.drawImage(c, 0, 0, 64, 64);
  return Array.from(x.getImageData(0, 0, 64, 64).data).join(',');
});
const beforeReload = await fingerprint();
await p.click('#btn-save');
await p.waitForTimeout(1400);
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
const afterReload = await fingerprint();
t('a hex map reloads pixel-identical', beforeReload === afterReload,
  beforeReload === afterReload ? '' : 'fingerprints differ');

t('no console errors', errs.length === 0, errs.slice(0, 3).join(' | '));

for (const [status, name, note] of out) {
  console.log(status.padEnd(5), name, note ? ' [' + note + ']' : '');
}
console.log(`\n${out.length - fails}/${out.length} passed`);
await b.close();
process.exit(fails ? 1 : 0);
