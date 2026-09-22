/* Undo and redo.
 *
 * Entries are closures rather than a replay of the whole op list: rebuilding a
 * layer with three hundred strokes on it takes long enough to feel broken, and
 * the rectangle a stroke actually touched is usually a small fraction of the
 * map. Painting entries therefore keep the pixels they overwrote, and object
 * layers — which are cheap — keep a copy of their list.
 */

const MAX_ENTRIES = 32;
const MAX_BYTES = 220 * 1024 * 1024;

export const history = {
  past: [],
  future: [],
  bytes: 0,
  onChange: null,
};

function announce() {
  if (history.onChange) history.onChange();
}

export function pushEntry(entry) {
  history.past.push(entry);
  history.bytes += entry.bytes || 0;
  // The redo stack is about to be thrown away, so its pixels stop counting
  // against the budget. Without this every undone-then-overwritten entry
  // leaked its snapshot, and once the leak passed MAX_BYTES the loop below
  // emptied the past on every push: undo quietly degraded to a single step
  // and never recovered short of a reload.
  for (const dropped of history.future) history.bytes -= dropped.bytes || 0;
  history.future.length = 0;
  while (history.past.length > MAX_ENTRIES || history.bytes > MAX_BYTES) {
    const dropped = history.past.shift();
    history.bytes -= dropped.bytes || 0;
    if (history.past.length <= 1) break;
  }
  announce();
}

export function canUndo() { return history.past.length > 0; }
export function canRedo() { return history.future.length > 0; }

export function undo() {
  const entry = history.past.pop();
  if (!entry) return null;
  entry.undo();
  history.future.push(entry);
  announce();
  return entry;
}

export function redo() {
  const entry = history.future.pop();
  if (!entry) return null;
  entry.redo();
  history.past.push(entry);
  announce();
  return entry;
}

export function clearHistory() {
  history.past.length = 0;
  history.future.length = 0;
  history.bytes = 0;
  announce();
}

/** Snapshot a rectangle of a canvas so it can be put back later. */
export function snapshot(canvas, box) {
  const ctx = canvas.getContext('2d');
  const x = Math.max(0, Math.floor(box.x));
  const y = Math.max(0, Math.floor(box.y));
  const w = Math.min(canvas.width - x, Math.ceil(box.x1 - box.x));
  const h = Math.min(canvas.height - y, Math.ceil(box.y1 - box.y));
  if (w <= 0 || h <= 0) return null;
  return { x, y, w, h, data: ctx.getImageData(x, y, w, h) };
}

export function restore(canvas, snap) {
  if (!snap) return;
  canvas.getContext('2d').putImageData(snap.data, snap.x, snap.y);
}

export const snapBytes = (snap) => (snap ? snap.w * snap.h * 4 : 0);

/* ------------------------------------------------------------ the timeline */

/** The whole timeline, oldest first, with the cursor implied by `past.length`. */
export function timeline() {
  return history.past.concat(history.future.slice().reverse());
}

/**
 * Wind the document to the point where `n` entries have been applied. Undo and
 * redo are the only primitives — jumping is just doing several of them — which
 * keeps the entries themselves ignorant of the panel.
 */
export function jumpTo(n) {
  const target = Math.max(0, Math.min(timeline().length, n));
  let moved = 0;
  while (history.past.length > target && history.past.length) {
    const entry = history.past.pop();
    entry.undo();
    history.future.push(entry);
    moved++;
  }
  while (history.past.length < target && history.future.length) {
    const entry = history.future.pop();
    entry.redo();
    history.past.push(entry);
    moved++;
  }
  if (moved) announce();
  return moved;
}
