/* Printing a map at scale, across as many sheets as it takes.
 *
 * A battle map is still most often used on a table, under miniatures, and a
 * miniature wants a one-inch square. A map forty squares wide is a metre of
 * paper, so it has to go across sheets, and every program people use for this
 * leaves that part to them: export a PNG, then fight a poster-printing tool
 * about what an inch is. Dungeondraft users write blog posts about it.
 *
 * So this writes a PDF, the one format a printer dialog prints at the size it
 * says, cut into pages with a strip of overlap, dashed lines to trim along,
 * corner marks, a label on every sheet and a bar on every sheet to check the
 * scale with a ruler before cutting anything. An optional first page shows how
 * the sheets go together.
 *
 * The map is drawn a page at a time with `flatten({ rect })`, never whole: a
 * 40 x 30 map at 300 dpi would be a 12000-px canvas, which browsers refuse.
 * Nothing here touches the document, so printing is not a step in the history.
 */

import { api } from './api.js';
import { app } from './app.js';
import { gridLayer, gridStepPx, layerVisible, playersText } from './doc.js';
import { Pdf, PT_PER_MM } from './pdf.js';
import * as R from './render.js';
import { field } from './ui.js';
import { el, makeCanvas, modal, throttleFrame, toast } from './util.js';

export const PAPERS = {
  a4:      { label: 'A4', w: 210, h: 297 },
  letter:  { label: 'US Letter', w: 215.9, h: 279.4 },
  a3:      { label: 'A3', w: 297, h: 420 },
  tabloid: { label: 'US Tabloid', w: 279.4, h: 431.8 },
};

// Twelve millimetres clears the unprintable edge of every home printer seen
// in a spec sheet (most want 3 to 6), with room in it for the page's label.
export const MARGIN_MM = 12;
// Past this the job is a poster, not a print-out, and the browser would be
// holding a few hundred megabytes of pictures to make it.
export const MAX_PAGES = 200;

export const PRINT_DEFAULTS = { paper: 'a4', orient: 'auto', cellMm: 25.4, overlapMm: 10, dpi: 150,
                                grid: true, lights: true, notes: true, index: true, download: true,
                                players: false };

let last = null;

/** Letter for the two countries that use it, A4 for everyone else. */
function localPaper() {
  const lang = (navigator.language || '').toLowerCase();
  return /-(us|ca)$/.test(lang) ? 'letter' : 'a4';
}

/** Column letters as on a spreadsheet: A to Z, then AA. */
export function columnName(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s;
  return s;
}

/** How the map goes onto paper. Everything in millimetres except `rect`,
 *  which is the piece of the map each page carries, in map pixels. */
export function printPlan(doc, opts = {}) {
  const o = Object.assign({}, PRINT_DEFAULTS, opts);
  const paper = PAPERS[o.paper] || PAPERS.a4;
  const cellMm = Number.isFinite(o.cellMm) && o.cellMm > 0 ? o.cellMm : PRINT_DEFAULTS.cellMm;
  const step = gridStepPx(doc);
  const pxPerMm = step / cellMm;
  const mapW = doc.width / pxPerMm, mapH = doc.height / pxPerMm;
  const lay = (pw, ph, orient) => {
    const aw = pw - 2 * MARGIN_MM, ah = ph - 2 * MARGIN_MM;
    // Never more than half the page, or the next page would start before
    // this one's middle and some of the map would be on three sheets.
    const ov = Math.max(0, Math.min(o.overlapMm || 0, aw / 2, ah / 2));
    const sx = aw - ov, sy = ah - ov;
    // The tolerance stops a map exactly one page wide asking for a second
    // page to hold a thousandth of a millimetre of it.
    const count = (len, area, stride) => (len <= area + 1e-6 ? 1 : Math.ceil((len - area) / stride - 1e-6) + 1);
    const cols = count(mapW, aw, sx), rows = count(mapH, ah, sy);
    return { pw, ph, aw, ah, ov, sx, sy, cols, rows, orient };
  };
  const portrait = lay(paper.w, paper.h, 'portrait');
  const landscape = lay(paper.h, paper.w, 'landscape');
  const n = (l) => l.cols * l.rows;
  const chosen = o.orient === 'portrait' ? portrait : o.orient === 'landscape' ? landscape
    : n(landscape) < n(portrait) ? landscape : portrait;

  const pages = [];
  for (let r = 0; r < chosen.rows; r++) {
    for (let c = 0; c < chosen.cols; c++) {
      const x = c * chosen.sx, y = r * chosen.sy;
      const w = Math.min(chosen.aw, mapW - x), h = Math.min(chosen.ah, mapH - y);
      pages.push({
        col: c, row: r, label: columnName(c) + (r + 1),
        mm: { x, y, w, h },
        rect: { x: x * pxPerMm, y: y * pxPerMm, w: w * pxPerMm, h: h * pxPerMm },
      });
    }
  }
  return Object.assign(chosen, { paper: o.paper in PAPERS ? o.paper : 'a4', cellMm, step, pxPerMm,
                                 mapMm: { w: mapW, h: mapH }, pages });
}

/** What one cell of this map is called, for the dialog and the page footer. */
function cellWord(doc) {
  const g = gridLayer(doc);
  return g && g.type === 'hex' ? 'hex' : 'square';
}

const mmText = (v) => (Math.round(v * 10) / 10) + ' mm';
const cmText = (v) => (Math.round(v / 10 * 10) / 10) + ' cm';

/** A canvas as JPEG bytes, on white. JPEG has no transparency, and the map
 *  outside its paper layer is transparent, which a JPEG would make black. */
async function jpegOf(canvas, quality = 0.9) {
  const flat = makeCanvas(canvas.width, canvas.height);
  const g = flat.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, flat.width, flat.height);
  g.drawImage(canvas, 0, 0);
  const blob = await new Promise((resolve) => flat.toBlob(resolve, 'image/jpeg', quality));
  return new Uint8Array(await blob.arrayBuffer());
}

/** Draw the sheets over a picture of the map: the dialog's plan, and the
 *  first page of the print. Each sheet is shown as the part it keeps once
 *  trimmed, so the outlines tile the map without overlapping. */
function drawSheets(ctx, plan, k) {
  ctx.save();
  ctx.lineWidth = Math.max(1, k * 0.6);
  // Sized from the sheet, so the labels read on a dialog's thumbnail and on a
  // whole page alike.
  const size = Math.max(9, Math.round(Math.min(plan.sx, plan.sy) * k * 0.14));
  ctx.font = `600 ${size}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const pg of plan.pages) {
    const x = pg.mm.x * k, y = pg.mm.y * k;
    const w = (pg.col < plan.cols - 1 ? plan.sx : pg.mm.w) * k;
    const h = (pg.row < plan.rows - 1 ? plan.sy : pg.mm.h) * k;
    ctx.strokeStyle = 'rgba(200, 30, 30, 0.9)';
    ctx.strokeRect(x, y, w, h);
    const tw = ctx.measureText(pg.label).width + size * 0.6;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    // A last row or column can be a sliver; its label is kept on the picture.
    const cy = Math.min(y + h / 2, ctx.canvas.height - size * 0.75);
    const cx = Math.min(x + w / 2, ctx.canvas.width - tw / 2);
    ctx.fillRect(cx - tw / 2, cy - size * 0.7, tw, size * 1.4);
    ctx.fillStyle = '#7a1010';
    ctx.fillText(pg.label, cx, cy);
  }
  ctx.restore();
}

/** The PDF, as bytes, with the plan it was made from. Exported for the tests;
 *  the dialog is the only caller in the program. */
export async function buildPrint(doc, opts = {}) {
  const o = Object.assign({}, PRINT_DEFAULTS, opts);
  const plan = printPlan(doc, o);
  if (plan.pages.length > MAX_PAGES) throw new Error(`${plan.pages.length} pages is more than ${MAX_PAGES}`);
  const word = cellWord(doc);
  const name = ((doc.name || 'Map').trim() || 'Map') + (o.players ? ' (players\' copy)' : '');
  const P = PT_PER_MM;
  const pdf = new Pdf();
  const layersOn = { grid: o.grid, paper: true, lights: o.lights, notes: o.notes, players: !!o.players };
  // Every sheet is drawn from whatever is on screen when its turn comes, and
  // the window stays live between sheets. A map opened or painted on part way
  // through would otherwise come out as half one thing and half another,
  // under the first one's name.
  const edits = app.edits;
  const check = () => {
    if (R.view.doc !== doc || app.edits !== edits) throw new Error('the map changed while it was being drawn; print it again');
  };
  const pageW = plan.pw * P, pageH = plan.ph * P, M = MARGIN_MM * P;
  const total = `${plan.cols} across and ${plan.rows} down`;

  if (o.index) {
    const pg = pdf.page(pageW, pageH);
    let y = pageH - M - 14;
    pg.text(M, y, 16, name, { bold: true });
    y -= 20;
    const lines = [
      `${plan.pages.length} sheet${plan.pages.length === 1 ? '' : 's'} of ${PAPERS[plan.paper].label} ${plan.orient}, `
        + `${total}. One ${word} prints ${mmText(plan.cellMm)}; the whole map is `
        + `${cmText(plan.mapMm.w)} by ${cmText(plan.mapMm.h)}.`,
      'Print at 100% ("Actual size"), not "Fit to page". Before cutting, check the bar at the foot of',
      'any sheet with a ruler: if it is not the length it says, the printer has scaled it.',
      'Trim each sheet at the edge of its picture on the left and at the top, where the corner marks',
      'are, and lay it over its neighbours with that edge on their dashed line, as below. The strip',
      'it covers is printed on both sheets, which leaves room for glue or tape underneath.',
    ];
    for (const line of lines) { pg.text(M, y, 9, line, { grey: 0.15 }); y -= 12; }
    y -= 6;
    // The picture of the map, as large as the rest of the page allows.
    const room = { w: pageW - 2 * M, h: y - M };
    const fit = Math.min(room.w / (plan.mapMm.w * P), room.h / (plan.mapMm.h * P));
    const w = plan.mapMm.w * P * fit, h = plan.mapMm.h * P * fit;
    // Twice the page's resolution at 72 per inch is plenty for a thumbnail.
    const k = (w * 2) / plan.mapMm.w;              // canvas px per mm of map
    check();
    const thumb = R.flatten(Object.assign({ scale: (k / plan.pxPerMm) }, layersOn));
    drawSheets(thumb.getContext('2d'), plan, k);
    pg.jpeg(await jpegOf(thumb, 0.85), thumb.width, thumb.height, M, y - h, w, h);
    pg.rect(M, y - h, w, h, { width: 0.5, grey: 0.4 });
  }

  // Output pixels per map pixel: the dots per millimetre the printer gets,
  // over the map pixels per millimetre the scale gives.
  const scale = (o.dpi / 25.4) / plan.pxPerMm;
  const barCells = plan.cellMm * 2 <= 70 ? 2 : 1;
  for (const page of plan.pages) {
    const pg = pdf.page(pageW, pageH);
    check();
    const tile = R.flatten(Object.assign({ scale, rect: page.rect }, layersOn));
    const w = page.mm.w * P, h = page.mm.h * P;
    const top = pageH - M;
    pg.jpeg(await jpegOf(tile), tile.width, tile.height, M, top - h, w, h);

    // Where the next sheet's picture starts: trim here, and the edges meet.
    const dash = { width: 0.6, grey: 0.35, dash: [4, 3] };
    const tick = { width: 0.4, grey: 0 };
    if (page.col < plan.cols - 1) {
      const x = M + plan.sx * P;
      pg.line(x, top, x, top - h, dash);
      // Above only: below is the footer's.
      pg.line(x, top + 3 * P, x, top + 9 * P, tick);
    }
    if (page.row < plan.rows - 1) {
      const yy = top - plan.sy * P;
      pg.line(M, yy, M + w, yy, dash);
      pg.line(M - 3 * P, yy, M - 9 * P, yy, tick).line(M + w + 3 * P, yy, M + w + 9 * P, yy, tick);
    }
    // Corner marks at the picture's top left, which is the other cut.
    pg.line(M - 3 * P, top, M - 9 * P, top, tick).line(M, top + 3 * P, M, top + 9 * P, tick);
    pg.line(M - 3 * P, top - h, M - 9 * P, top - h, tick).line(M + w, top + 3 * P, M + w, top + 9 * P, tick);

    // In the middle of the top margin: both top corners carry cutting marks.
    pg.text(pageW / 2 - page.label.length * 4, pageH - M + 4 * P, 14, page.label, { bold: true });
    const left = page.col > 0 ? columnName(page.col - 1) + (page.row + 1) : null;
    const above = page.row > 0 ? columnName(page.col) + page.row : null;
    const joins = [left && `${left} to its left`, above && `${above} above`].filter(Boolean).join(', ');
    pg.text(M, 8 * P, 7, `${name}  -  sheet ${page.label} of ${total}`
      + (joins ? `  -  goes beside ${joins}` : ''), { grey: 0.25 });

    // The scale bar: the one thing on the sheet a ruler can check.
    const barLen = plan.cellMm * barCells * P;
    const bx = pageW - M - barLen, by = 8 * P;
    pg.rect(bx, by, barLen, 1.2 * P, { fill: 0 });
    pg.line(bx, by - 1.2 * P, bx, by + 2.4 * P, tick).line(bx + barLen, by - 1.2 * P, bx + barLen, by + 2.4 * P, tick);
    // Helvetica averages about half an em a letter, near enough to set the
    // label off to the bar's left without carrying the font's metrics.
    const barText = `${barCells} ${word}${barCells > 1 ? 's' : ''} = ${mmText(plan.cellMm * barCells)}`;
    pg.text(bx - barText.length * 6.5 * 0.55 - 2 * P, by, 6.5, barText, { grey: 0.25 });
    // Give the page back to the browser between sheets: a long job should not
    // freeze the window it was started from.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  check();
  return { bytes: pdf.bytes(), plan };
}

/* ---------------------------------------------------------------- dialog */

export async function printDialog() {
  const doc = app.doc;
  if (!doc) return;
  const o = Object.assign({}, PRINT_DEFAULTS, { paper: localPaper() }, last || {});
  const word = cellWord(doc);
  // A lighting layer with the darkness at nought still draws its pools of
  // light, so it still needs the switch. Without one shown, the setting left
  // from an earlier print must not decide it unseen -- see `effective` below.
  const lit = doc.layers.some((l) => l.kind === 'lights' && layerVisible(doc, l)
    && (l.ambient > 0 || l.ops.length));
  const pinned = doc.layers.some((l) => l.kind === 'notes' && layerVisible(doc, l) && l.ops.length);

  const pw = 420, ph = Math.round(Math.min(240, pw * doc.height / doc.width));
  const pw2 = Math.round(Math.min(pw, ph * doc.width / doc.height));
  const preview = el('canvas', { class: 'gen-preview', width: pw2, height: ph, 'data-print': 'preview' });
  const base = R.flatten({ scale: pw2 / doc.width, grid: true, paper: true, lights: false, notes: false });
  const summary = el('p', { class: 'muted span', 'data-print': 'plan' });
  const playersNote = el('p', { class: 'empty span', text: playersText(doc), 'data-print': 'players' });
  playersNote.hidden = !o.players;
  let plan = null;
  const redraw = throttleFrame(() => {
    plan = printPlan(doc, o);
    const g = preview.getContext('2d');
    g.clearRect(0, 0, preview.width, preview.height);
    g.drawImage(base, 0, 0);
    drawSheets(g, plan, preview.width / plan.mapMm.w);
    const n = plan.pages.length;
    summary.textContent = `${n} sheet${n === 1 ? '' : 's'} of ${PAPERS[plan.paper].label} ${plan.orient}, `
      + `${plan.cols} across and ${plan.rows} down${o.index ? ', after a page showing how they fit' : ''}. `
      + `The map prints ${cmText(plan.mapMm.w)} by ${cmText(plan.mapMm.h)}.`
      + (n > MAX_PAGES ? ` That is more than ${MAX_PAGES}; choose a smaller ${word} or larger paper.` : '');
  });
  const set = (key, cast = (v) => v) => (v) => { o[key] = cast(v); redraw(); };

  const cellLabel = word === 'hex' ? 'One hex prints (across the flats)' : 'One square prints';
  const sizes = [[25.4, '1 inch (25.4 mm)'], [25, '25 mm'], [30, '30 mm'], [20, '20 mm'], [12.7, 'Half an inch']];
  if (!sizes.some(([v]) => v === o.cellMm)) o.cellMm = 25.4;
  const body = el('div', { class: 'gen print' }, [
    preview,
    summary,
    field({ type: 'select', label: 'Paper', value: o.paper,
            options: Object.entries(PAPERS).map(([id, p]) => [id, p.label]) }, set('paper')),
    field({ type: 'select', label: 'Orientation', value: o.orient,
            options: [['auto', 'Fewest sheets'], ['portrait', 'Portrait'], ['landscape', 'Landscape']] }, set('orient')),
    field({ type: 'select', label: cellLabel, value: String(o.cellMm),
            options: sizes.map(([v, l]) => [String(v), l]) }, set('cellMm', parseFloat)),
    field({ type: 'select', label: 'Overlap', value: String(o.overlapMm),
            options: [['0', 'None'], ['5', '5 mm'], ['10', '10 mm'], ['15', '15 mm']] }, set('overlapMm', parseFloat)),
    field({ type: 'select', label: 'Quality', value: String(o.dpi),
            options: [['100', 'Draft (100 dpi)'], ['150', 'Normal (150 dpi)'], ['200', 'Fine (200 dpi)'],
                      ['300', 'Best (300 dpi)']] }, set('dpi', parseFloat)),
    field({ type: 'toggle', label: 'Include the grid', value: o.grid }, set('grid')),
    lit ? field({ type: 'toggle', label: 'Include the lighting', value: o.lights }, set('lights')) : null,
    pinned ? field({ type: 'toggle', label: 'Include the note pins', value: o.notes }, set('notes')) : null,
    field({ type: 'select', label: 'Copy', value: o.players ? 'players' : 'gm',
            options: [['gm', 'The GM\'s: everything'], ['players', 'The players\'']] },
          (v) => { o.players = v === 'players'; playersNote.hidden = !o.players; redraw(); }),
    playersNote,
    field({ type: 'toggle', label: 'Start with a page showing how the sheets fit', value: o.index }, set('index')),
    field({ type: 'toggle', label: 'Also download a copy', value: o.download }, set('download')),
    el('p', { class: 'empty span', text:
      'Written as a PDF in the exports folder. Print it at 100% ("Actual size"), not "Fit to page", '
      + 'and check the bar at the foot of a sheet with a ruler before cutting. The overlap is printed '
      + 'on both sheets: trim one, lay it over the other on the dashed line, and glue under the strip.' }),
  ]);
  redraw();

  const go = await modal({
    title: 'Print at scale',
    body,
    buttons: [{ label: 'Cancel', value: false }, { label: 'Make the PDF', class: 'btn-primary', value: true }],
  });
  if (!go || app.doc !== doc) return;
  last = Object.assign({}, o);
  plan = printPlan(doc, o);
  if (plan.pages.length > MAX_PAGES) {
    return toast(`${plan.pages.length} sheets is more than ${MAX_PAGES}; choose a smaller ${word} or larger paper`, 'bad');
  }
  toast(`Drawing ${plan.pages.length} sheet${plan.pages.length === 1 ? '' : 's'}...`);
  let made;
  try {
    const effective = Object.assign({}, o, { lights: lit ? o.lights : true, notes: pinned ? o.notes : true });
    made = await buildPrint(doc, effective);
  } catch (err) {
    return toast('Print failed: ' + err.message, 'bad');
  }
  const blob = new Blob([made.bytes], { type: 'application/pdf' });
  // Cut before a suffix is added: the server keeps sixty-four characters,
  // and a long name lost "-players" there, so the players' copy was written
  // under a name that read as a second GM export.
  const name = (doc.name || 'map').replace(/[^\w \-]+/g, '').slice(0, 40).trim() || 'map';
  try {
    const res = await api.exportImage(name + (o.players ? ' - players' : '') + ' - print.pdf', blob);
    toast('Print written to ' + res.path, 'good');
  } catch (err) {
    toast('Print failed: ' + err.message, 'bad');
    return;
  }
  if (!o.download) return;
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name + (o.players ? ' - players' : '') + ' - print.pdf' });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
