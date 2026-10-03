/* Printing at scale.
 *
 * The Print dialog writes a PDF that puts the map on paper at a set size per
 * grid cell, across as many sheets as it takes. This suite checks the
 * arithmetic of the sheets (every part of the map on one, neighbours sharing
 * exactly the overlap, a cell printing exactly its size), that the PDF is a
 * PDF a reader can find its way round (every cross-reference offset lands on
 * its object), that a piece of the map drawn on its own matches the same
 * piece of the whole, that printing leaves the map and its history alone,
 * that Ctrl+P opens the dialog rather than the browser's print, and that the
 * file lands in the exports folder without a request leaving the machine.
 *
 * Start the server first:  python3 app.py --no-browser --port 7871
 * Then:                    node test/print.mjs [http://127.0.0.1:7871]
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

const b = await launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const p = await ctx.newPage();
const errs = [];
const offHost = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
p.on('request', (r) => { if (!/^(https?:\/\/127\.0\.0\.1[:/]|data:|blob:)/.test(r.url())) offHost.push(r.url()); });
await p.goto(base('http://127.0.0.1:7871/'), { waitUntil: 'networkidle' });
await ready(p);
await newMap(p, { name: 'Printed Keep', kind: 'battle', size: '40x30' });

// Something to print that is not the same everywhere: a room of walls.
await p.evaluate(() => {
  const C = 70;
  const w = (x0, y0, x1, y1) => ({ id: 'w' + Math.random().toString(36).slice(2, 9), kind: 'wall',
    points: [{ x: x0 * C, y: y0 * C }, { x: x1 * C, y: y1 * C }] });
  const l = window.__cg.app.doc.layers.find((x) => x.kind === 'walls');
  l.ops = [w(3, 3, 12, 3), w(12, 3, 12, 9), w(12, 9, 3, 9), w(3, 9, 3, 3)];
  window.__cg.R.invalidate(l);
});

/* the sheets ---------------------------------------------------------------- */

const plan = (opts) => p.evaluate(async (o) => {
  const m = await import('/js/print.js');
  return m.printPlan(window.__cg.app.doc, o);
}, opts);

// 40 x 30 squares at an inch each is 1016 x 762 mm. A4 less 12 mm a side is
// 186 x 273 printable; with 10 mm of overlap a sheet moves on 176 or 263.
const a4 = await plan({ paper: 'a4', orient: 'auto', cellMm: 25.4, overlapMm: 10 });
const a4p = await plan({ paper: 'a4', orient: 'portrait', cellMm: 25.4, overlapMm: 10 });
const a4l = await plan({ paper: 'a4', orient: 'landscape', cellMm: 25.4, overlapMm: 10 });
t('A4 portrait needs 6 across and 3 down', a4p.cols === 6 && a4p.rows === 3, a4p.cols + ' x ' + a4p.rows);
t('A4 landscape needs 4 across and 5 down', a4l.cols === 4 && a4l.rows === 5, a4l.cols + ' x ' + a4l.rows);
t('fewest sheets picks the portrait 18 over the landscape 20',
  a4.orient === 'portrait' && a4.pages.length === 18, a4.orient + ' ' + a4.pages.length);

const doc = await p.evaluate(() => ({ w: window.__cg.app.doc.width, h: window.__cg.app.doc.height }));
const covers = (pl) => {
  // Every map pixel column and row sits on some sheet, and no sheet runs off
  // the map or past its printable area.
  let reach = { x: 0, y: 0 };
  for (const pg of pl.pages) {
    if (pg.rect.x + pg.rect.w > doc.w + 1e-6 || pg.rect.y + pg.rect.h > doc.h + 1e-6) return 'runs off the map';
    if (pg.mm.w > pl.aw + 1e-9 || pg.mm.h > pl.ah + 1e-9) return 'larger than the printable area';
    reach = { x: Math.max(reach.x, pg.rect.x + pg.rect.w), y: Math.max(reach.y, pg.rect.y + pg.rect.h) };
  }
  return Math.abs(reach.x - doc.w) < 1e-6 && Math.abs(reach.y - doc.h) < 1e-6 ? 'ok' : 'stops short';
};
t('the sheets cover the whole map and nothing past it', covers(a4) === 'ok', covers(a4));
const a1 = a4.pages[0], b1 = a4.pages[1], a2 = a4.pages[a4.cols];
const overlapMm = (a1.mm.x + a1.mm.w) - b1.mm.x;
const overlapDown = (a1.mm.y + a1.mm.h) - a2.mm.y;
t('neighbours share exactly the overlap', Math.abs(overlapMm - 10) < 1e-9 && Math.abs(overlapDown - 10) < 1e-9,
  overlapMm + ' / ' + overlapDown + ' mm');
t('a square prints exactly 25.4 mm', Math.abs(a1.mm.w / (a1.rect.w / 70) - 25.4) < 1e-9,
  a1.mm.w / (a1.rect.w / 70));
t('sheets are named like a spreadsheet', a1.label === 'A1' && b1.label === 'B1' && a2.label === 'A2'
  && a4.pages[a4.pages.length - 1].label === 'F3', a4.pages.map((x) => x.label).join(' '));
const none = await plan({ paper: 'a4', orient: 'portrait', cellMm: 25.4, overlapMm: 0 });
t('with no overlap the sheets abut', Math.abs(none.pages[1].mm.x - none.aw) < 1e-9, none.pages[1].mm.x);
const letter = await plan({ paper: 'letter', orient: 'portrait', cellMm: 25.4, overlapMm: 10 });
t('US Letter is laid out on its own size', Math.abs(letter.aw - (215.9 - 24)) < 1e-9 && covers(letter) === 'ok',
  letter.aw + ' mm wide, ' + letter.pages.length + ' sheets');
const big = await plan({ paper: 'a4', cellMm: 300 });
const threw = await p.evaluate(async () => {
  const m = await import('/js/print.js');
  try { await m.buildPrint(window.__cg.app.doc, { cellMm: 300 }); return null; } catch (err) { return err.message; }
});
t('a print of more than 200 sheets is refused before anything is drawn',
  big.pages.length > 200 && /more than 200/.test(threw || ''), big.pages.length + ': ' + threw);

/* the PDF ------------------------------------------------------------------- */

const before = await p.evaluate(() => ({
  past: window.__cg.history.past.length,
  dirty: !!window.__cg.app.dirty,
  json: JSON.stringify(window.__cg.app.doc.layers.map((l) => [l.id, l.ops && l.ops.length, l.visible])),
}));
const pdf = await p.evaluate(async () => {
  const m = await import('/js/print.js');
  const t0 = performance.now();
  const r = await m.buildPrint(window.__cg.app.doc, { paper: 'a4', orient: 'auto', cellMm: 25.4, overlapMm: 10,
                                                     dpi: 100, index: true });
  const ms = performance.now() - t0;
  const bytes = r.bytes;
  const text = new TextDecoder('latin1').decode(bytes);
  // Every cross-reference entry has to land on the object it names, or a
  // reader that trusts the table (they all do) opens a broken file.
  const xrefAt = Number(text.match(/startxref\n(\d+)/)[1]);
  const table = text.slice(xrefAt).split('\n');
  const n = Number(table[1].split(' ')[1]);
  let bad = 0;
  for (let i = 1; i < n; i++) {
    const off = Number(table[2 + i].slice(0, 10));
    if (!text.startsWith(i + ' 0 obj', off)) bad++;
  }
  const entryLen = table.slice(2, 2 + n).every((e) => e.length === 19);
  const pages = (text.match(/\/Type \/Page /g) || []).length;
  const media = text.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/);
  // The first sheet's picture: its placing matrix gives its printed width.
  const cms = Array.from(text.matchAll(/q ([\d.]+) 0 0 ([\d.]+) [\d.]+ [\d.]+ cm \/Im0 Do Q/g));
  return { head: text.slice(0, 8), tail: text.slice(-6), bad, entryLen, objects: n, pages,
           media: media && [Number(media[1]), Number(media[2])],
           sheetW: cms.length > 1 ? Number(cms[1][1]) : null, size: bytes.length, ms,
           a1: r.plan.pages[0].mm.w, // The second line is binary on purpose; it tells transfer programs so.
           plain: /[^\x00-\x7f]/.test(text.slice(15).replace(/stream\n[\s\S]*?\nendstream/g, '')) };
});
t('the file is a PDF from start to end', pdf.head === '%PDF-1.4' && pdf.tail === '%%EOF\n', pdf.head + ' ... ' + JSON.stringify(pdf.tail));
t('every cross-reference offset lands on its object', pdf.bad === 0 && pdf.entryLen, pdf.bad + ' bad of ' + pdf.objects);
t('one page per sheet, after the page showing how they fit', pdf.pages === 19, pdf.pages + ' pages');
t('the pages are A4 in points', pdf.media && Math.abs(pdf.media[0] - 595.275591) < 1e-3
  && Math.abs(pdf.media[1] - 841.889764) < 1e-3, pdf.media && pdf.media.join(' x '));
t('the first sheet prints its piece at exactly its size',
  Math.abs(pdf.sheetW - pdf.a1 * 72 / 25.4) < 1e-4, pdf.sheetW + ' pt for ' + pdf.a1 + ' mm');
t('nothing outside the pictures is past ASCII', !pdf.plain);
t('19 pages at 100 dpi in under 20 seconds', pdf.ms < 20000, Math.round(pdf.ms) + ' ms, ' + pdf.size + ' bytes');

const after = await p.evaluate(() => ({
  past: window.__cg.history.past.length,
  dirty: !!window.__cg.app.dirty,
  json: JSON.stringify(window.__cg.app.doc.layers.map((l) => [l.id, l.ops && l.ops.length, l.visible])),
}));
t('printing is not a step in the history and leaves the map alone',
  after.past === before.past && after.dirty === before.dirty && after.json === before.json,
  JSON.stringify([before.past, after.past, before.dirty, after.dirty]));

/* a piece of the map is that piece of the whole ----------------------------- */

const same = await p.evaluate(() => {
  const R = window.__cg.R;
  const rect = { x: 140, y: 210, w: 350, h: 280 };
  const whole = R.flatten({ scale: 1 });
  const piece = R.flatten({ scale: 1, rect });
  const a = whole.getContext('2d').getImageData(rect.x, rect.y, rect.w, rect.h).data;
  const b2 = piece.getContext('2d').getImageData(0, 0, rect.w, rect.h).data;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff = Math.max(diff, Math.abs(a[i] - b2[i]));
  return { diff, w: piece.width, h: piece.height };
});
t('a piece drawn on its own matches the same piece of the whole map', same.diff <= 2 && same.w === 350 && same.h === 280,
  'largest difference ' + same.diff);

/* hex maps ------------------------------------------------------------------ */

await newMap(p, { name: 'Printed Hexes', kind: 'hex' });
const hexPlan = await p.evaluate(async () => {
  const m = await import('/js/print.js');
  const d = await import('/js/doc.js');
  const pl = m.printPlan(window.__cg.app.doc, { cellMm: 25.4 });
  return { pxPerMm: pl.pxPerMm, step: d.gridStepPx(window.__cg.app.doc) };
});
t('on a hex map one hex across the flats prints the chosen size',
  Math.abs(hexPlan.pxPerMm * 25.4 - hexPlan.step) < 1e-9, hexPlan.step + ' px per hex');

/* the dialog ---------------------------------------------------------------- */

await newMap(p, { name: 'Printed Keep Two', kind: 'battle', size: '20x15' });
await p.keyboard.press('Control+p');
await p.waitForSelector('.modal [data-print="preview"]', { timeout: 5000 });
const summary = await p.textContent('[data-print="plan"]');
t('Ctrl+P opens the Print dialog with a plan of the sheets', /sheets? of/.test(summary), summary);
await p.selectOption('.modal select >> nth=0', 'a4');
await p.selectOption('.modal select >> nth=1', 'landscape');
await p.waitForTimeout(200);
const summary2 = await p.textContent('[data-print="plan"]');
t('and the plan follows the settings', /A4 landscape/.test(summary2), summary2);
await p.screenshot({ path: '/tmp/cg_print_dialog.png' });

const put = p.waitForResponse((r) => r.url().includes('/api/export') && r.request().method() === 'PUT', { timeout: 60000 });
const dl = p.waitForEvent('download', { timeout: 60000 }).catch(() => null);
await p.click('.modal .btn-primary');
const res = await put;
const body = await res.json().catch(() => ({}));
t('Make the PDF writes a .pdf to the exports folder', res.ok() && /\.pdf$/.test(body.path || ''), body.path);
const download = await dl;
t('and offers a copy to download', !!download && /\.pdf$/.test(download.suggestedFilename()),
  download && download.suggestedFilename());

const palette = await p.evaluate(async () => {
  const m = await import('/js/palette.js');
  m.open();
  await new Promise((r) => setTimeout(r, 100));
  const text = document.body.innerText;
  m.close();
  return /Print at scale/.test(text);
});
t('the palette offers it too', palette);

t('nothing was fetched from off this machine', offHost.length === 0, offHost.slice(0, 3).join(' '));
t('no console errors', errs.length === 0, errs.slice(0, 3).join(' | '));

report();
await b.close();
process.exit(fails ? 1 : 0);
