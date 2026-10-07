/* Application state: the one object every other module reads.
   Keeping it in a single place is what makes the panels, the tools and the
   renderer able to stay ignorant of each other. */

import { api } from './api.js';
import { library, loadLibrary, warm } from './assets.js';
import { newDocument, referencedAssets, serialise, findLayer, kindOf, LAYER_KINDS } from './doc.js';
import { clearHistory } from './history.js';
import * as R from './render.js';
import { applyLook } from './theme.js';
import { debounce, el, modal, toast } from './util.js';

export const app = {
  doc: null,
  slug: null,
  server: null,
  activeLayerId: null,
  tool: 'brush',
  settings: {},
  dirty: false,
  // Bumped by every edit. saveProject compares it across its awaits, because
  // work done while a save is in flight is not in the payload that save wrote.
  edits: 0,
  // The edit count when the map on screen was opened or made. A new map that
  // nobody has touched is dirty -- it is not on disk yet -- but there is
  // nothing in it to lose, and asking about it would only teach people to
  // click through the question.
  editsAtOpen: 0,
  listeners: {},
};

/* -------------------------------------------------------------- event bus */

export function on(event, fn) {
  (app.listeners[event] = app.listeners[event] || []).push(fn);
  return () => off(event, fn);
}

export function off(event, fn) {
  const list = app.listeners[event];
  if (list) app.listeners[event] = list.filter((f) => f !== fn);
}

export function emit(event, payload) {
  for (const fn of app.listeners[event] || []) fn(payload);
}

/* ---------------------------------------------------------------- settings */

const SETTINGS_KEY = 'cartograph.settings.v1';

export function loadSettings() {
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch (_) { /* fresh */ }
  app.settings = Object.assign({
    look: {},
    autosave: true,
    autosaveSeconds: 90,
    defaultWidth: 2048,
    defaultHeight: 1536,
    showCursor: true,
    showScaleBar: true,
    presets: [],
    tools: {},
  }, stored);
  return app.settings;
}

export const saveSettings = debounce(() => {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(app.settings)); } catch (_) { /* private mode */ }
}, 250);

export function toolSetting(toolId, key, fallback) {
  const bag = app.settings.tools[toolId] || (app.settings.tools[toolId] = {});
  if (bag[key] === undefined) bag[key] = fallback;
  return bag[key];
}

export function setToolSetting(toolId, key, value) {
  const bag = app.settings.tools[toolId] || (app.settings.tools[toolId] = {});
  bag[key] = value;
  saveSettings();
  emit('tool-settings', { toolId, key, value });
}

/* --------------------------------------------------------------- document */

export function activeLayer() {
  return findLayer(app.doc, app.activeLayerId);
}

export function setActiveLayer(id) {
  app.activeLayerId = id;
  emit('layers');
}

export function markDirty(flag = true) {
  if (flag) app.edits += 1;
  if (app.dirty === flag) return;
  app.dirty = flag;
  emit('dirty', flag);
}

export async function openDocument(doc, slug) {
  // A layer with no ops list is readable JSON the server lets through, and
  // every renderer walks layer.ops: a notes layer without one threw out of
  // setDocument after app.doc had already been switched, so the editor showed
  // "Could not open" while Ctrl+S saved the broken map over the name.
  for (const l of doc.layers || []) if (!Array.isArray(l.ops)) l.ops = [];
  app.doc = doc;
  app.slug = slug || doc.slug || null;
  await warm(referencedAssets(doc));
  R.setDocument(doc);
  // A map can hold a layer whose kind came from an extension that is now
  // switched off or gone, and LAYER_KINDS then has no entry for it. Reading
  // through that threw here, before anything was rendered, so the map could
  // not be opened at all -- and the layer could not be reached to delete it.
  const firstPaintable = doc.layers.find((l) => kindOf(l).paint && l.kind !== 'land');
  app.activeLayerId = (firstPaintable || doc.layers[0]).id;
  clearHistory();
  markDirty(false);
  app.editsAtOpen = app.edits;
  // markDirty speaks only when the flag moves, and opening a saved map from a
  // clean editor moves nothing -- so the top bar kept the last map's word, or
  // the page's "not saved yet" on every launch, over a map that was on disk.
  emit('dirty', false);
  if (!doc.view || !doc.view.zoom) R.fitView();
  else { R.view.x = doc.view.x; R.view.y = doc.view.y; R.view.zoom = doc.view.zoom; R.requestDraw(); }
  emit('document');
  emit('layers');
}

export async function newMap(opts = {}) {
  const doc = newDocument({
    kind: opts.kind || 'region',
    width: opts.width || app.settings.defaultWidth,
    height: opts.height || app.settings.defaultHeight,
    name: opts.name || 'Untitled Map',
  });
  await openDocument(doc, null);
  markDirty(true);
  app.editsAtOpen = app.edits;
  return doc;
}

/* ------------------------------------------------------- discarding work */

/** Whether replacing the map on screen would lose something: changes made
 *  since it was opened or made that no save has written. */
export function hasUnsavedWork() {
  return !!(app.doc && app.dirty && app.edits > app.editsAtOpen);
}

/** Ask before anything replaces a map that has unsaved changes, and keep a
 *  backup of it either way.
 *
 * Opening another map, starting a new one or restoring a backup all go
 * through openDocument, which used to throw the unsaved work away without a
 * word. The backup is written *before* the question is put, so it exists
 * whatever the answer: a dialog gets clicked through unread, and the backup is
 * what that click costs instead of the work. `what.verb` starts the sentence
 * ("Creating a new map"), `what.reason` is recorded with the backup. Resolves
 * true to go ahead. */
export async function confirmDiscard(what) {
  if (!hasUnsavedWork()) return true;
  const doc = app.doc;
  const name = doc.name || 'this map';
  let kept = null;
  let failed = null;
  try {
    const snap = serialise(doc);
    snap.view = { x: R.view.x, y: R.view.y, zoom: R.view.zoom };
    kept = (await api.saveBackup(snap, what.reason || '')).backup;
  } catch (err) {
    failed = err.message;
  }
  // Something else replaced the map while the backup was being written; the
  // question would be about a map no longer on screen.
  if (app.doc !== doc) return false;
  let go = false;
  await modal({
    title: 'Discard unsaved changes?',
    body: el('div', {}, [
      el('p', { text: `${what.verb} will discard all the unsaved changes to “${name}”. Proceed anyway?` }),
      el('p', { class: 'muted', 'data-discard': kept ? 'backed-up' : 'no-backup', text: kept
        ? 'A backup of it as it stands has been kept either way: Projects tab, under Backups.'
        : `No backup could be kept (${failed}). Cancel and save first if you want these changes.` }),
    ]),
    buttons: [{ label: 'Cancel' },
              { label: 'Discard and continue', class: 'btn-danger', onClick: () => { go = true; } }],
  });
  return go && app.doc === doc;
}

/* ------------------------------------------------------------------ saving */

function thumbBlob() {
  const flat = R.flatten({ scale: Math.min(1, 480 / app.doc.width), grid: true, paper: true });
  return new Promise((resolve) => flat.toBlob(resolve, 'image/png'));
}

/* Saves run one at a time. Two at once on a map not yet on disk -- Ctrl+S
 * pressed twice, or Ctrl+S landing on an autosave -- both saw no slug and
 * both created a project, so one map became two folders and the editor went
 * on with the second. A save asked for while another is in flight waits for
 * it, and by then the map has its slug and is written rather than created. */
let saving = null;

export function saveProject(opts) {
  // With nothing in flight it starts there and then, so the snapshot is of the
  // map as it is at the call, not as it is a tick later.
  const go = () => saveOnce(opts || {});
  const run = saving ? saving.then(go, go) : go();
  saving = run;
  const done = () => { if (saving === run) saving = null; };
  run.then(done, done);
  return run;
}

async function saveOnce({ silent = false } = {}) {
  if (!app.doc) return null;
  // The map this save is for. Another map can be opened while it is in
  // flight, and everything after an await used to write to whatever app.doc
  // was by then -- the new map's slug went onto the map just opened, whose
  // next save then overwrote the new map's folder with its own contents.
  const doc = app.doc;
  doc.view = { x: R.view.x, y: R.view.y, zoom: R.view.zoom };
  // The payload is a snapshot. Between here and the last await there are three
  // round trips and a PNG encode, and anything painted in that time is in the
  // document but not in the file -- so clearing the flag unconditionally told
  // the user their work was saved when it was not, and autosave then skipped
  // it because it looked clean.
  const editsAtSnapshot = app.edits;
  const payload = serialise(doc);

  let slug = app.slug;
  if (!slug) {
    const created = await api.createProject(payload);
    slug = created.project.slug;
    doc.slug = slug;
    if (app.doc === doc) app.slug = slug;
  } else {
    await api.writeProject(slug, payload);
  }
  // Saved, but no longer the map on screen: the thumbnail would be a picture
  // of the other one, and the dirty flag and the toast are about it too.
  if (app.doc !== doc) return slug;

  const thumb = await thumbBlob();
  if (thumb && app.doc === doc) await api.writeThumb(slug, thumb);
  if (app.doc !== doc) return slug;

  if (app.edits === editsAtSnapshot) markDirty(false);
  emit('saved', slug);
  if (!silent) toast('Saved to projects/' + slug, 'good');
  return slug;
}

/* Autosave is a deadline set by the first edit after a save, not a debounce.
 * It was a debounce -- every edit restarted the clock -- so it only saved
 * after the given number of seconds with no edits at all, and someone who
 * painted a stroke every minute for an hour with a 90-second setting was never
 * saved once. "Autosave every 90 seconds" now means that. */
let autosaveTimer = 0;
export function scheduleAutosave() {
  if (!app.settings.autosave) { clearTimeout(autosaveTimer); autosaveTimer = 0; return; }
  if (autosaveTimer) return;
  autosaveTimer = setTimeout(async () => {
    autosaveTimer = 0;
    // Turned off while the deadline was pending: someone who unticks it to try
    // something risky does not want it written over the saved map regardless.
    if (!app.settings.autosave || !app.dirty || !app.doc) return;
    try {
      await saveProject({ silent: true });
      emit('autosaved');
      // Anything drawn while the save was in flight is not in it, and the
      // edit that made it arrived while this deadline was still pending.
      if (app.dirty) scheduleAutosave();
    } catch (err) {
      toast('Autosave failed: ' + err.message, 'bad');
    }
  }, Math.max(15, app.settings.autosaveSeconds) * 1000);
}

/** The interval changed: a deadline already pending was set from the old one,
 *  so 900 seconds turned down to 15 still waited out the 900, and turned up
 *  before something risky still saved at the old, shorter time. */
export function rescheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = 0;
  if (app.dirty) scheduleAutosave();
}

/* ------------------------------------------------------------------- boot */

export async function boot() {
  loadSettings();
  applyLook(app.settings);
  app.server = await api.state();
  await loadLibrary();
  // The texture and stamp picked last session come back as settings, not as
  // decoded images; decode them now so the first stroke is not flat grey.
  warm([app.settings.activeTexture, app.settings.activeStamp].filter((id) => id && library.byId.has(id)));
  emit('library');
}
