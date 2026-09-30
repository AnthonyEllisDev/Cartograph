/* Application state: the one object every other module reads.
   Keeping it in a single place is what makes the panels, the tools and the
   renderer able to stay ignorant of each other. */

import { api } from './api.js';
import { library, loadLibrary, warm } from './assets.js';
import { newDocument, referencedAssets, serialise, findLayer, kindOf, LAYER_KINDS } from './doc.js';
import { clearHistory } from './history.js';
import * as R from './render.js';
import { applyLook } from './theme.js';
import { debounce, toast } from './util.js';

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
  return doc;
}

/* ------------------------------------------------------------------ saving */

function thumbBlob() {
  const flat = R.flatten({ scale: Math.min(1, 480 / app.doc.width), grid: true, paper: true });
  return new Promise((resolve) => flat.toBlob(resolve, 'image/png'));
}

export async function saveProject({ silent = false } = {}) {
  if (!app.doc) return null;
  app.doc.view = { x: R.view.x, y: R.view.y, zoom: R.view.zoom };
  // The payload is a snapshot. Between here and the last await there are three
  // round trips and a PNG encode, and anything painted in that time is in the
  // document but not in the file -- so clearing the flag unconditionally told
  // the user their work was saved when it was not, and autosave then skipped
  // it because it looked clean.
  const editsAtSnapshot = app.edits;
  const payload = serialise(app.doc);

  if (!app.slug) {
    const created = await api.createProject(payload);
    app.slug = created.project.slug;
    app.doc.slug = app.slug;
  } else {
    await api.writeProject(app.slug, payload);
  }

  const thumb = await thumbBlob();
  if (thumb) await api.writeThumb(app.slug, thumb);

  if (app.edits === editsAtSnapshot) markDirty(false);
  emit('saved', app.slug);
  if (!silent) toast('Saved to projects/' + app.slug, 'good');
  return app.slug;
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
    if (!app.dirty || !app.doc) return;
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
