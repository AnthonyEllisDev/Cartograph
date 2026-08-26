/* The extension host.
 *
 * An extension is a folder under extensions/ containing an extension.json and
 * an ES module. At startup the module is imported and handed one object — the
 * API below — and everything it registers becomes part of the program: tools in
 * the rail, layer kinds the renderer knows how to draw, panels in the side
 * rail, commands in the palette, formats in the export dialog.
 *
 * There is no sandbox. An extension is code you put in the folder yourself, on
 * your own machine, and it runs with the same reach the editor has. That is the
 * bargain a local, open program makes; it is also why the loader reports which
 * extension threw rather than letting one bad file take the editor down.
 */

import { api as serverApi } from './api.js';
import { image, imageNow, library, pattern, warm } from './assets.js';
import { activeLayer, app, emit, markDirty, on, scheduleAutosave } from './app.js';
import { LAYER_KINDS, distanceLabel, gridStepPx, makeLayer, measureBetween, snapPoint } from './doc.js';
import * as hex from './hex.js';
import { pushEntry, restore, snapshot } from './history.js';
import { icon, ICONS } from './icons.js';
import * as R from './render.js';
import { TOOLS, currentTool, setTool } from './tools.js';
import { clamp, el, hashString, modal, rng, toast, uid } from './util.js';

export const API_VERSION = 1;

export const extensions = {
  list: [],          // what is on disk
  loaded: new Map(), // id -> { manifest, exports, registered }
  panels: [],
  commands: [],
  exporters: [],
  layerKinds: new Map(),
};

/* --------------------------------------------------------------- the API */

function makeApi(manifest) {
  const owned = { tools: [], panels: [], commands: [], exporters: [], layerKinds: [] };

  const register = {
    /** Add a tool to the rail. The spec is the same shape the built-in tools
     *  use: label, icon, options(), down/move/up, and optionally overlay. */
    registerTool(spec) {
      if (!spec || !spec.id) throw new Error('a tool needs an id');
      const id = manifest.id + ':' + spec.id;
      if (spec.iconSvg) ICONS[id] = spec.iconSvg;
      TOOLS[id] = Object.assign({}, spec, {
        id, icon: spec.iconSvg ? id : (spec.icon || 'brush'), extension: manifest.id,
      });
      owned.tools.push(id);
      emit('tool-registry');
      return id;
    },

    /** Teach the renderer a new kind of layer. `render(layer, ctx, helpers)` is
     *  called whenever the layer is rebuilt; `make()` returns a fresh one. */
    registerLayerKind(spec) {
      if (!spec || !spec.id) throw new Error('a layer kind needs an id');
      const id = spec.id;
      LAYER_KINDS[id] = { label: spec.label || id, paint: !!spec.paint, icon: spec.icon || 'paper' };
      extensions.layerKinds.set(id, Object.assign({}, spec, { extension: manifest.id }));
      owned.layerKinds.push(id);
      return id;
    },

    /** Add a panel to a side rail. `render(root)` fills it in; it is called
     *  again whenever the document or the layer selection changes. */
    registerPanel(spec) {
      const entry = Object.assign({ where: 'right', title: manifest.name }, spec,
                                  { extension: manifest.id });
      extensions.panels.push(entry);
      owned.panels.push(entry);
      emit('panels');
      return entry;
    },

    /** Add a command: it appears in the palette (Ctrl+K) and can take a key. */
    registerCommand(spec) {
      const entry = Object.assign({ group: manifest.name }, spec, { extension: manifest.id });
      extensions.commands.push(entry);
      owned.commands.push(entry);
      return entry;
    },

    /** Add a format to the Export dialog. `build(doc, opts)` returns a Blob,
     *  a string, or anything Blob accepts. */
    registerExporter(spec) {
      const entry = Object.assign({}, spec, { extension: manifest.id });
      extensions.exporters.push(entry);
      owned.exporters.push(entry);
      return entry;
    },
  };

  return Object.assign(register, {
    version: API_VERSION,
    id: manifest.id,
    manifest,
    /** A URL for a file inside this extension's own folder. */
    url: (file) => `/extensions/${encodeURIComponent(manifest.dir)}/${file}`,

    app,
    doc: () => app.doc,
    activeLayer,
    layers: () => (app.doc ? app.doc.layers : []),
    settings: () => app.settings,

    events: { on, emit },
    render: R,
    tools: { TOOLS, currentTool, setTool },
    assets: { library, image, imageNow, pattern, warm },
    history: { push: pushEntry, snapshot, restore },
    server: serverApi,
    ui: { el, modal, toast, icon },
    util: { clamp, rng, uid, hashString },
    // Additive only: API_VERSION stays 1 because nothing here was taken away.
    map: { makeLayer, snapPoint, distanceLabel, measureBetween, gridStepPx, hex, LAYER_KINDS },
    markDirty,
    scheduleAutosave,
    invalidate: (layer, box) => R.invalidate(layer, box),

    /** Everything this extension registered, so it can be unloaded. */
    _owned: owned,
  });
}

/* ------------------------------------------------------------ the loader */

export async function loadExtensions() {
  extensions.panels.length = 0;
  extensions.commands.length = 0;
  extensions.exporters.length = 0;
  extensions.layerKinds.clear();
  extensions.loaded.clear();

  let list = [];
  try {
    list = (await serverApi.extensions()).extensions;
  } catch (err) {
    return extensions;
  }
  extensions.list = list;

  for (const manifest of list) {
    if (!manifest.enabled || manifest.error) continue;
    if ((manifest.apiVersion || 1) > API_VERSION) {
      manifest.error = `needs extension API ${manifest.apiVersion}; this build provides ${API_VERSION}`;
      continue;
    }
    const href = `/extensions/${encodeURIComponent(manifest.dir)}/${manifest.main}`;
    try {
      const module = await import(/* @vite-ignore */ href);
      const setup = module.default || module.register || module.activate;
      if (typeof setup !== 'function') {
        throw new Error('the module exports no default function to call');
      }
      const api = makeApi(manifest);
      await setup(api);
      extensions.loaded.set(manifest.id, { manifest, api });
    } catch (err) {
      // One broken extension must not take the editor with it.
      manifest.error = String(err && err.message ? err.message : err);
      console.error('[extension ' + manifest.id + ']', err);
    }
  }
  emit('extensions');
  return extensions;
}

/** Renderer hook: layers whose kind came from an extension. */
export function renderExtensionLayer(layer, ctx) {
  const kind = extensions.layerKinds.get(layer.kind);
  if (!kind || typeof kind.render !== 'function') return false;
  try {
    kind.render(layer, ctx, { R, doc: app.doc, assets: { imageNow, pattern } });
  } catch (err) {
    console.error('[extension layer ' + layer.kind + ']', err);
  }
  return true;
}

export async function setExtensionEnabled(id, enabled) {
  await serverApi.setExtensionEnabled(id, enabled);
}
