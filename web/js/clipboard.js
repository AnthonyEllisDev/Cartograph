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
 * The clipboard is a list of entries even though the Select tool picks up one
 * thing at a time, so that a selection set, when there is one, pastes through
 * the same code.
 */

import { app, emit, markDirty, scheduleAutosave } from './app.js';
import { gridStepPx, kindOf, layerVisible, snapPoint } from './doc.js';
import { pushEntry } from './history.js';
import * as R from './render.js';
import { deleteSelection, selectObject, selectedObject } from './tools.js';
import { toast, uid } from './util.js';

// Layer kinds whose ops are self-contained objects. A paint stroke is not one
// of these: it only exists as pixels on its layer and has no handle to grab.
const COPYABLE = new Set(['objects', 'labels', 'paths', 'regions', 'walls', 'lights', 'notes']);

// The id prefix each kind's tool mints, so a pasted op is indistinguishable
// from one drawn by hand.
const ID_PREFIX = { objects: 'o', labels: 't', paths: 'p', regions: 'rg', walls: 'w', lights: 'o', notes: 'n' };

const clip = { entries: [], layerId: null, kind: null, pastes: 0 };

/* ------------------------------------------------------------------ copying */

export function hasClipboard() { return clip.entries.length > 0; }

/** What is on the clipboard, for the palette and the tests. A copy, so no
 *  caller can reach in and change what the next paste will write. */
export function clipboardContents() {
  return { kind: clip.kind, entries: JSON.parse(JSON.stringify(clip.entries)) };
}

export function copySelection({ quiet = false } = {}) {
  const picked = selectedObject();
  if (!picked) { if (!quiet) toast('Pick something up with the Select tool first'); return false; }
  if (!COPYABLE.has(picked.layer.kind)) { toast('That cannot be copied', 'bad'); return false; }
  clip.entries = [JSON.parse(JSON.stringify(picked.item))];
  clip.layerId = picked.layer.id;
  clip.kind = picked.layer.kind;
  // Counted from the copy, so pasting twice without the pointer on the map
  // steps each copy one cell further on instead of stacking them.
  clip.pastes = 0;
  if (!quiet) toast('Copied');
  return true;
}

export function cutSelection() {
  if (!copySelection({ quiet: true })) return false;
  // The delete is the Select tool's own, so a cut is one undo step labelled
  // Delete and restores exactly what Delete would.
  deleteSelection();
  toast('Cut');
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

function boundsCentre(item) {
  const pts = item.points && item.points.length ? item.points : [anchorOf(item)];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  if (item.x != null && item.points) {
    // A curved label carries an anchor as well as its curve.
    x0 = Math.min(x0, item.x); y0 = Math.min(y0, item.y); x1 = Math.max(x1, item.x); y1 = Math.max(y1, item.y);
  }
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}

/** How far to move a copy. Snapped as its tool snaps -- centres for things
 *  that stand in a cell, corners for things drawn along the lines -- so a door
 *  copied from a grid line lands on a grid line, and on a hex map a copy lands
 *  on the hex lattice rather than one square step off it. */
function offsetFor(items, to, steps) {
  const first = items[0];
  const anchor = anchorOf(first);
  let want;
  if (to) {
    const c = boundsCentre(first);
    want = { x: anchor.x + to.x - c.x, y: anchor.y + to.y - c.y };
  } else {
    const step = gridStepPx(app.doc) || 64;
    want = { x: anchor.x + step * steps, y: anchor.y + step * steps };
  }
  const prefer = first.x != null && !first.points ? 'centre' : 'corner';
  const snapped = snapPoint(app.doc, want, prefer);
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

/** Put `items` (ops of `kind`) onto the map as one undo step, and pick the
 *  first of them up so it can be dragged straight into place. */
function place(items, kind, layerId, { to = null, steps = 1, label = 'Paste' } = {}) {
  if (!app.doc || !items.length) return false;
  const layer = pasteTarget(kind, layerId);
  if (!layer) {
    toast(`This map has no ${kindOf({ kind }).label.toLowerCase()} layer to paste onto, or it is hidden or locked`, 'bad');
    return false;
  }
  const { dx, dy } = offsetFor(items, to, steps);
  const copies = items.map((item) => moved(item, dx, dy, kind));
  const before = layer.ops.slice();
  const after = before.concat(copies);
  // The Light tool's rule, kept: the first light on a layer turns the night on,
  // because a light on a map with no darkness does nothing you can see.
  const wasAmbient = layer.ambient;
  const lightsOn = kind === 'lights' && !before.length && !wasAmbient;
  const apply = () => {
    layer.ops = after.slice();
    if (lightsOn) layer.ambient = 0.8;
    R.invalidate(layer);
    emit('layers');
  };
  apply();
  pushEntry({
    label,
    bytes: 0,
    undo() {
      layer.ops = before.slice();
      if (lightsOn) layer.ambient = wasAmbient;
      R.invalidate(layer);
      emit('layers');
    },
    redo: apply,
  });
  markDirty();
  scheduleAutosave();
  selectObject(layer, copies[0]);
  return true;
}

/** Paste at the pointer if it is over the map, otherwise a cell on from where
 *  the copy was taken, one cell further for each paste. */
export function paste(at = R.view.cursor) {
  if (!hasClipboard()) { toast('Nothing copied yet'); return false; }
  const to = at ? { x: at.x, y: at.y } : null;
  if (!to) clip.pastes += 1;
  return place(clip.entries, clip.kind, clip.layerId, { to, steps: clip.pastes, label: 'Paste' });
}

/** A copy of what is in hand, a cell on, without touching the clipboard. */
export function duplicateSelection() {
  const picked = selectedObject();
  if (!picked) { toast('Pick something up with the Select tool first'); return false; }
  if (!COPYABLE.has(picked.layer.kind)) { toast('That cannot be copied', 'bad'); return false; }
  return place([picked.item], picked.layer.kind, picked.layer.id, { steps: 1, label: 'Duplicate' });
}
