/* Copy, cut, paste and duplicate for the thing the Select tool is holding.
 *
 * Every comparable editor has these and Cartograph had none: the only way to
 * get a second door, a second lamp or a second copy of a carefully placed
 * label was to draw it again and set every property by hand. An op is plain
 * JSON, so a copy is a deep copy of one and a paste is an ordinary op pushed
 * onto a layer -- nothing below this module had to learn anything new.
 *
 * The clipboard lives in this module rather than on the document, so it
 * survives opening another map: copying a room's worth of furniture from one
 * battle map to the next is the point. It does not survive a page reload, and
 * nothing is written to the system clipboard, which would need a permission
 * prompt to read back and would hand another program a map op it cannot use.
 *
 * The clipboard is a list of entries, each remembering the kind of layer it
 * came off, so a selection set that spans the walls, the lights and the
 * stamps copies and pastes as one thing and each part lands on a layer of its
 * own kind.
 */

import { app, emit, markDirty, scheduleAutosave } from './app.js';
import { gridStepPx, kindOf, layerVisible, snapPoint } from './doc.js';
import { pushEntry } from './history.js';
import * as R from './render.js';
import { TOOLS, deleteSelection, selectObjects, selectedObjects, toolForLayer } from './tools.js';
import { toast, uid } from './util.js';

// Layer kinds whose ops are self-contained objects. A paint stroke is not one
// of these: it only exists as pixels on its layer and has no handle to grab.
const COPYABLE = new Set(['objects', 'labels', 'paths', 'regions', 'walls', 'lights', 'notes']);

// The id prefix each kind's tool mints, so a pasted op is indistinguishable
// from one drawn by hand.
const ID_PREFIX = { objects: 'o', labels: 't', paths: 'p', regions: 'rg', walls: 'w', lights: 'o', notes: 'n' };

// `entries` are the ops, `kinds` and `layerIds` run beside them. `kind` is the
// one kind they share, or 'mixed'.
const clip = { entries: [], kinds: [], layerIds: [], kind: null, pastes: 0 };

/* ------------------------------------------------------------------ copying */

export function hasClipboard() { return clip.entries.length > 0; }

/** What is on the clipboard, for the palette and the tests. A copy, so no
 *  caller can reach in and change what the next paste will write. */
export function clipboardContents() {
  return { kind: clip.kind, kinds: clip.kinds.slice(), entries: JSON.parse(JSON.stringify(clip.entries)) };
}

/** What the Select tool is holding that can be copied. A paint stroke cannot
 *  be picked up at all, so today that is everything; the filter is for an
 *  extension's layer kind that a later Select tool might learn to pick. */
function copyable() {
  return selectedObjects().filter((s) => COPYABLE.has(s.layer.kind));
}

export function copySelection({ quiet = false } = {}) {
  const set = copyable();
  if (!set.length) { if (!quiet) toast('Pick something up with the Select tool first'); return false; }
  clip.entries = set.map((s) => JSON.parse(JSON.stringify(s.item)));
  clip.kinds = set.map((s) => s.layer.kind);
  clip.layerIds = set.map((s) => s.layer.id);
  clip.kind = new Set(clip.kinds).size === 1 ? clip.kinds[0] : 'mixed';
  // Counted from the copy, so pasting twice without the pointer on the map
  // steps each copy one cell further on instead of stacking them.
  clip.pastes = 0;
  if (!quiet) toast(set.length === 1 ? 'Copied' : `Copied ${set.length} things`);
  return true;
}

export function cutSelection() {
  if (!copySelection({ quiet: true })) return false;
  // The delete is the Select tool's own, so a cut is one undo step labelled
  // Delete and restores exactly what Delete would.
  deleteSelection();
  toast(clip.entries.length === 1 ? 'Cut' : `Cut ${clip.entries.length} things`);
  return true;
}

/* ----------------------------------------------------------------- pasting */

/** Where a pasted copy goes: its own layer if this map still has it, then the
 *  layer being worked on, then the topmost layer of the same kind. Each must be
 *  drawn and unlocked -- a paste you cannot see, or into a layer you locked to
 *  stop exactly this, is worse than being told there is nowhere to put it. */
function pasteTarget(kind, layerId) {
  const doc = app.doc;
  const usable = (l) => l && l.kind === kind && !l.locked && layerVisible(doc, l);
  const own = doc.layers.find((l) => l.id === layerId);
  if (usable(own)) return own;
  const active = doc.layers.find((l) => l.id === app.activeLayerId);
  if (usable(active)) return active;
  for (let i = doc.layers.length - 1; i >= 0; i--) if (usable(doc.layers[i])) return doc.layers[i];
  return null;
}

function anchorOf(item) { return item.x != null ? { x: item.x, y: item.y } : item.points[0]; }

/** The centre of the box round everything being placed, so a set lands
 *  centred on the pointer as a single thing does. */
function boundsCentre(items) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const take = (p) => { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); };
  for (const item of items) {
    if (item.points) for (const p of item.points) take(p);
    // A curved label carries an anchor as well as its curve.
    if (item.x != null) take(item);
  }
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}

/** How a kind's own tool snaps, read off the tool rather than kept in a second
 *  table here: null for one that does not snap at all, which is the Label
 *  tool -- a copied label was pulled onto the grid that the original, placed
 *  by the same tool, never was. */
function snapFor(kind) {
  const tool = TOOLS[toolForLayer({ kind })];
  return tool && tool.snaps ? (tool.snapTo || 'corner') : null;
}

/** How far to move a set. One delta for all of it, so the set keeps its shape;
 *  snapped as the first thing in it whose tool snaps -- centres for things
 *  that stand in a cell, corners for things drawn along the lines -- so a door
 *  copied from a grid line lands on a grid line, and on a hex map a copy lands
 *  on the hex lattice rather than one square step off it. */
function offsetFor(items, kinds, to, steps) {
  let lead = kinds.findIndex((k) => snapFor(k));
  const snap = lead >= 0 ? snapFor(kinds[lead]) : null;
  if (lead < 0) lead = 0;
  const anchor = anchorOf(items[lead]);
  let want;
  if (to) {
    const c = boundsCentre(items);
    want = { x: anchor.x + to.x - c.x, y: anchor.y + to.y - c.y };
  } else {
    const step = gridStepPx(app.doc) || 64;
    want = { x: anchor.x + step * steps, y: anchor.y + step * steps };
  }
  const snapped = snap ? snapPoint(app.doc, want, snap) : want;
  return { dx: snapped.x - anchor.x, dy: snapped.y - anchor.y };
}

function moved(item, dx, dy, kind) {
  const out = JSON.parse(JSON.stringify(item));
  out.id = uid(ID_PREFIX[kind] || 'o');
  if (out.x != null) { out.x += dx; out.y += dy; }
  if (out.points) for (const p of out.points) { p.x += dx; p.y += dy; }
  // A copy is the user's own. Left on, a note copied out of a generated
  // dungeon would be swept away the next time the dungeon was generated.
  delete out.gen;
  return out;
}

/** Put `items` onto the map as one undo step, whatever layers they land on,
 *  and pick the copies up so they can be dragged straight into place. */
function place(items, kinds, layerIds, { to = null, steps = 1, label = 'Paste' } = {}) {
  if (!app.doc || !items.length) return false;
  const targets = kinds.map((k, i) => pasteTarget(k, layerIds[i]));
  const keep = items.map((_, i) => i).filter((i) => targets[i]);
  if (!keep.length) {
    const kind = new Set(kinds).size === 1 ? kindOf({ kind: kinds[0] }).label.toLowerCase() : 'matching';
    toast(`This map has no ${kind} layer to paste onto, or it is hidden or locked`, 'bad');
    return false;
  }
  const { dx, dy } = offsetFor(keep.map((i) => items[i]), keep.map((i) => kinds[i]), to, steps);
  const copies = keep.map((i) => ({ layer: targets[i], item: moved(items[i], dx, dy, kinds[i]) }));
  const layers = [...new Set(copies.map((c) => c.layer))];
  const before = new Map(layers.map((l) => [l, l.ops.slice()]));
  const after = new Map(layers.map((l) => [l, l.ops.concat(copies.filter((c) => c.layer === l).map((c) => c.item))]));
  // The Light tool's rule, kept: the first light on a layer turns the night on,
  // because a light on a map with no darkness does nothing you can see.
  const nights = layers
    .filter((l) => l.kind === 'lights' && !l.ops.length && !l.ambient)
    .map((l) => ({ layer: l, was: l.ambient }));
  const rebuild = () => {
    // Walls last: invalidating them relights against the walls there now.
    for (const l of layers) if (l.kind !== 'walls') R.invalidate(l);
    for (const l of layers) if (l.kind === 'walls') R.invalidate(l);
    emit('layers');
  };
  const apply = () => {
    for (const l of layers) l.ops = after.get(l).slice();
    for (const n of nights) n.layer.ambient = 0.8;
    rebuild();
  };
  apply();
  pushEntry({
    label,
    bytes: 0,
    undo() {
      for (const l of layers) l.ops = before.get(l).slice();
      for (const n of nights) n.layer.ambient = n.was;
      rebuild();
    },
    redo: apply,
  });
  markDirty();
  scheduleAutosave();
  selectObjects(copies);
  const lost = items.length - keep.length;
  if (lost) toast(`${lost} of them had no drawn, unlocked layer of their kind here and were left out`, 'bad');
  return true;
}

/** Where the pointer is on the map, or null when it is not over the map.
 *  The cursor is tracked over the whole canvas, margin included, and a paste
 *  over the grey round the map landed off it: saved, selected and invisible. */
function onMap(at) {
  const doc = app.doc;
  if (!at || !doc) return null;
  if (at.x < 0 || at.y < 0 || at.x > doc.width || at.y > doc.height) return null;
  return { x: at.x, y: at.y };
}

/** Paste at the pointer if it is over the map, otherwise a cell on from where
 *  the copy was taken, one cell further for each paste. */
export function paste(at = R.view.cursor) {
  if (!hasClipboard()) { toast('Nothing copied yet'); return false; }
  const to = onMap(at);
  if (!to) clip.pastes += 1;
  return place(clip.entries, clip.kinds, clip.layerIds, { to, steps: clip.pastes, label: 'Paste' });
}

/** A copy of what is in hand, a cell on, without touching the clipboard. */
export function duplicateSelection() {
  const set = copyable();
  if (!set.length) { toast('Pick something up with the Select tool first'); return false; }
  return place(set.map((s) => s.item), set.map((s) => s.layer.kind), set.map((s) => s.layer.id),
    { steps: 1, label: 'Duplicate' });
}
