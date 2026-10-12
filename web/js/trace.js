/* A trace image: a picture laid over the map to draw from.
 *
 * Someone with a sketch on squared paper, a photograph of a hand-drawn map or
 * an old campaign map wants to draw over it, not copy it by eye from another
 * window. A trace layer holds one such picture, shown at reduced opacity while
 * the map is drawn and left out of every export, print and thumbnail -- it is
 * scaffolding, never part of the map.
 *
 * The picture is a file in the map's folder (layers/<layer id>.png), which is
 * the slot the server has always kept for imported pixels, and the document
 * holds only its size and the name it came from. So project.json stays
 * kilobytes of readable JSON, and a map with a trace still opens in a text
 * editor.
 *
 * The awkward part is that the document and the file are saved separately.
 * Undo can bring back a layer, or a picture, whose file a later save has
 * already swept away. So the decoded picture is kept in memory against the
 * very `layer.image` object the document holds (a WeakMap, so it goes when the
 * object does), and every save compares what is on disk with what the
 * document now points at and writes the difference. Undo swaps the object;
 * the next save notices.
 */

/* ----------------------------------------------------------------- records */

// layer.image object -> { img, blob, state }. state is 'loading', 'ready'
// or 'missing'. Keyed on the object rather than the layer id because undo
// puts the previous object back, and its picture has to come with it.
const records = new WeakMap();

// doc -> Map(layer id -> { image, slug }): what each layer's file on disk
// holds, as far as this session knows.
const onDisk = new WeakMap();

// doc -> the slug of another map whose folder its pictures can be read from.
// A restored backup has no folder of its own until it is saved, and its
// pictures are still in the folder of the map it was taken from.
const borrowed = new WeakMap();

/** Read this document's trace pictures from another map's folder until it
 *  has one of its own. The first save copies them across. */
export function traceBorrow(doc, slug) {
  if (doc && typeof slug === 'string' && slug) borrowed.set(doc, slug);
}

/** The longest side a trace is kept at. A phone photo is 4000-odd pixels; a
 *  map is 2048 by default, and a picture several times the map's size is
 *  memory spent on detail nobody can draw from at 50% opacity. */
export const TRACE_MAX = 4096;

export const TRACE_DEFAULTS = { zoom: 1, offsetX: 0, offsetY: 0 };

export function traceValue(layer, key) {
  const v = layer[key];
  if (key === 'zoom') return Number.isFinite(v) ? Math.min(8, Math.max(0.05, v)) : 1;
  if (key === 'offsetX' || key === 'offsetY') return Number.isFinite(v) ? Math.min(2, Math.max(-2, v)) : 0;
  return v === undefined ? TRACE_DEFAULTS[key] : v;
}

/** Whether a layer's `image` field is the shape this module writes. A
 *  hand-edited map may hold anything there. */
function usable(image) {
  return !!(image && typeof image === 'object'
            && Number.isFinite(image.w) && image.w > 0
            && Number.isFinite(image.h) && image.h > 0);
}

/** Where the picture sits on the map: fitted inside it at zoom 1 and centred,
 *  then scaled about the centre and moved by a fraction of the map's size.
 *  Fractions, so resizing the canvas keeps the picture where it was relative
 *  to the map rather than leaving it pinned to the top-left corner. */
export function traceRect(layer, doc) {
  const image = layer && layer.image;
  if (!usable(image)) return null;
  const fit = Math.min(doc.width / image.w, doc.height / image.h);
  const s = fit * traceValue(layer, 'zoom');
  const w = image.w * s;
  const h = image.h * s;
  return {
    x: (doc.width - w) / 2 + traceValue(layer, 'offsetX') * doc.width,
    y: (doc.height - h) / 2 + traceValue(layer, 'offsetY') * doc.height,
    w, h,
  };
}

/** 'none', 'loading', 'ready' or 'missing', for the panel. */
export function traceState(layer) {
  if (!usable(layer && layer.image)) return 'none';
  const rec = records.get(layer.image);
  return rec ? rec.state : 'loading';
}

/* ---------------------------------------------------------------- drawing */

/** Draw the picture, or start loading it. `ready` is called once a load
 *  lands, so the caller can rebuild the layer; the load cannot be awaited
 *  here because rebuildLayer is synchronous. */
export function drawTrace(ctx, layer, doc, ready) {
  const rect = traceRect(layer, doc);
  if (!rect) return;
  let rec = records.get(layer.image);
  if (!rec) {
    const from = doc.slug || borrowed.get(doc);
    rec = { img: null, blob: null, state: 'loading' };
    records.set(layer.image, rec);
    // Nowhere to read it from: a map that names a picture but has no folder.
    if (!from) { rec.state = 'missing'; return; }
    const img = new Image();
    const lent = !doc.slug;
    const image = layer.image;
    // Kept so a save that lands while the picture is still on its way can
    // wait for it. Skipped instead, the save cleared the dirty flag and moved
    // the map to its own folder without the picture, and nothing later wrote
    // it: reopened, the map said the picture was missing.
    rec.loaded = new Promise((done) => {
      img.onload = () => {
        // A backup holds the picture's size, not the picture, so the one
        // borrowed from the old folder may since have been replaced there.
        // Drawn anyway it was another picture stretched to this one's size,
        // and the first save copied it in as if it were the right one.
        if (lent && (img.naturalWidth !== image.w || img.naturalHeight !== image.h)) rec.state = 'missing';
        else { rec.img = img; rec.state = 'ready'; }
        done(); ready();
      };
      img.onerror = () => { rec.state = 'missing'; done(); ready(); };
    });
    img.src = '/projects/' + encodeURIComponent(from) + '/layers/'
      + encodeURIComponent(layer.id) + '.png';
    return;
  }
  if (rec.state !== 'ready') return;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(rec.img, rect.x, rect.y, rect.w, rect.h);
  ctx.restore();
}

/* -------------------------------------------------------------- importing */

function decode(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('not a picture this browser can read')); };
    img.src = url;
  });
}

function encode(img, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return new Promise((resolve, reject) => c.toBlob(
    (b) => (b ? resolve(b) : reject(new Error('the picture could not be stored'))), 'image/png'));
}

/** Turn a file the user picked into a new `layer.image` object, with its
 *  picture ready to draw. Re-encoded as PNG whatever it came in as, because
 *  the server's slot is a .png, and capped at TRACE_MAX on the long side.
 *
 *  What is drawn is the PNG decoded again, not the canvas it was made from:
 *  a canvas holds premultiplied alpha and the file does not, so drawing the
 *  canvas would make the map on screen differ from the map reopened. */
export async function importTrace(file) {
  const src = await decode(file);
  const k = Math.min(1, TRACE_MAX / Math.max(src.naturalWidth, src.naturalHeight));
  const w = Math.max(1, Math.round(src.naturalWidth * k));
  const h = Math.max(1, Math.round(src.naturalHeight * k));
  const blob = await encode(src, w, h);
  const img = await decode(blob);
  const name = String(file.name || 'picture').slice(0, 120);
  const image = { w, h, name };
  records.set(image, { img, blob, state: 'ready' });
  return image;
}

/* ----------------------------------------------------------------- saving */

/** A map just opened from disk: its trace files are what its layers say. */
export function traceOpened(doc, slug) {
  const known = new Map();
  if (slug) {
    for (const l of doc.layers || []) {
      if (l && l.kind === 'trace' && usable(l.image)) known.set(l.id, { image: l.image, slug });
    }
  }
  onDisk.set(doc, known);
}

/** What a save is about to write: each trace layer's picture as it stands
 *  now, taken with the document snapshot so a picture changed during the
 *  save's awaits is left for the next one. */
export function traceSnapshot(doc) {
  const out = new Map();
  for (const l of doc.layers || []) {
    if (l && l.kind === 'trace' && usable(l.image)) out.set(l.id, l.image);
  }
  return out;
}

async function blobFor(image) {
  const rec = records.get(image);
  if (rec && rec.state === 'loading' && rec.loaded) await rec.loaded;
  if (!rec || rec.state !== 'ready') return null;
  // A picture read back from disk has no blob in memory. It only needs one
  // when its file has gone -- swept by a save while its layer was deleted, or
  // a backup put back as a new map -- and then the decoded picture is the
  // only copy left, so it is written out again.
  if (!rec.blob) rec.blob = await encode(rec.img, rec.img.naturalWidth, rec.img.naturalHeight);
  return rec.blob;
}

/** After project.json is written: write every picture the folder does not
 *  hold yet, and forget files the save has just swept. `ids` is every layer
 *  id the saved document had -- the server keeps those layers' files and
 *  removes the rest. */
export async function saveTraces(doc, slug, snap, ids, writeLayer) {
  let known = onDisk.get(doc);
  if (!known) { known = new Map(); onDisk.set(doc, known); }
  for (const id of [...known.keys()]) if (!ids.has(id) || !snap.has(id)) known.delete(id);
  for (const [id, image] of snap) {
    const had = known.get(id);
    if (had && had.image === image && had.slug === slug) continue;
    const blob = await blobFor(image);
    if (!blob) continue;
    await writeLayer(slug, id, blob);
    known.set(id, { image, slug });
  }
}
