/* Application state: the one object every other module reads.
   Keeping it in a single place is what makes the panels, the tools and the
   renderer able to stay ignorant of each other. */

import { api } from './api.js';
import { loadLibrary, warm } from './assets.js';
import { newDocument, referencedAssets, serialise, findLayer, LAYER_KINDS } from './doc.js';
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
  if (app.dirty === flag) return;
  app.dirty = flag;
  emit('dirty', flag);
}

export async function openDocument(doc, slug) {
  app.doc = doc;
  app.slug = slug || doc.slug || null;
  await warm(referencedAssets(doc));
  R.setDocument(doc);
  const firstPaintable = doc.layers.find((l) => LAYER_KINDS[l.kind].paint && l.kind !== 'land');
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

  markDirty(false);
  emit('saved', app.slug);
  if (!silent) toast('Saved to projects/' + app.slug, 'good');
  return app.slug;
}

let autosaveTimer = 0;
export function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  if (!app.settings.autosave) return;
  autosaveTimer = setTimeout(async () => {
    if (!app.dirty || !app.doc) return;
    try {
      await saveProject({ silent: true });
      emit('autosaved');
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
  emit('library');
}
