/* The document: a plain object that is exactly what gets written to
   project.json. Every stroke, stamp, path and label is data, so a saved map is
   readable, diffable, and re-renders identically rather than being a flat
   picture of itself. */

import { uid } from './util.js';

export const FORMAT = 1;

export const LAYER_KINDS = {
  water:   { label: 'Water',    paint: false, icon: 'water' },
  floor:   { label: 'Floor',    paint: false, icon: 'floor' },
  land:    { label: 'Landmass', paint: true,  icon: 'land'  },
  raster:  { label: 'Paint',    paint: true,  icon: 'brush' },
  paths:   { label: 'Paths',    paint: false, icon: 'path'  },
  objects: { label: 'Objects',  paint: false, icon: 'stamp' },
  labels:  { label: 'Labels',   paint: false, icon: 'text'  },
  walls:   { label: 'Walls',    paint: false, icon: 'wall'  },
  grid:    { label: 'Grid',     paint: false, icon: 'grid'  },
  paper:   { label: 'Paper',    paint: false, icon: 'paper' },
};

export function makeLayer(kind, extra = {}) {
  const base = {
    id: uid('l'),
    kind,
    name: LAYER_KINDS[kind].label,
    visible: true,
    opacity: 1,
    blend: 'source-over',
    locked: false,
    ops: [],
  };
  // The sea tile is drawn large: at 1x the repeat is obvious across a whole map.
  if (kind === 'water') Object.assign(base, { texture: 'starter/ocean', scale: 2.5, color: '#2a4f74' });
  if (kind === 'floor') Object.assign(base, { texture: 'starter/rock', scale: 1, color: '#6d6a63' });
  if (kind === 'land') Object.assign(base, {
    texture: 'starter/grass', scale: 1, color: '#7c9a52',
    coast: { ink: true, inkWidth: 2.5, inkColor: '#4a3a24',
             shallow: true, shallowWidth: 34, shallowColor: '#7fb4cd', shallowSteps: 3 },
  });
  if (kind === 'raster') Object.assign(base, { texture: 'starter/forest', scale: 1 });
  if (kind === 'walls') Object.assign(base, {
    color: '#20242c', thickness: 7, doorColor: '#a8763c',
  });
  if (kind === 'grid') Object.assign(base, {
    type: 'none', size: 64, color: '#3a2c1e', opacity: 0.25, offsetX: 0, offsetY: 0, lineWidth: 1,
  });
  if (kind === 'paper') Object.assign(base, {
    texture: 'starter/parchment', scale: 2, opacity: 0.42, blend: 'multiply',
    vignette: 0.35, edge: 0.4,
  });
  return Object.assign(base, extra);
}

/* A battle map is the same engine with different defaults: a real-world scale,
   a grid that means something, snapping on, and a walls layer that exports to a
   virtual tabletop. A region map is the same document with the scale in miles
   and the grid off. */
export const MAP_KINDS = {
  region: {
    label: 'Region map',
    scale: { unit: 'mi', perCell: 10 },
    grid: { type: 'none', size: 96, opacity: 0.2 },
    snap: 'off',
    layers: ['water', 'land', 'terrain', 'paths', 'objects', 'labels', 'grid', 'paper'],
  },
  battle: {
    label: 'Battle map',
    scale: { unit: 'ft', perCell: 5 },
    grid: { type: 'square', size: 70, opacity: 0.34, color: '#1c2028' },
    snap: 'grid',
    layers: ['floor', 'terrain', 'objects', 'walls', 'labels', 'grid', 'paper'],
  },
};

const LAYER_RECIPES = {
  water: () => makeLayer('water'),
  land: () => makeLayer('land'),
  terrain: () => makeLayer('raster', { name: 'Terrain', texture: 'starter/forest' }),
  floor: () => makeLayer('floor'),
  paths: () => makeLayer('paths'),
  objects: () => makeLayer('objects'),
  walls: () => makeLayer('walls'),
  labels: () => makeLayer('labels'),
  grid: () => makeLayer('grid'),
  paper: () => makeLayer('paper'),
};

export function newDocument(opts = {}) {
  const kind = MAP_KINDS[opts.kind] ? opts.kind : 'region';
  const recipe = MAP_KINDS[kind];
  const width = opts.width || 2048;
  const height = opts.height || 1536;
  const doc = {
    format: FORMAT,
    kind,
    name: opts.name || 'Untitled Map',
    slug: null,
    width,
    height,
    // What one grid cell is worth on the ground. Everything that reports a
    // distance — the measure tool, the scale bar, the VTT export — reads this.
    scale: Object.assign({ cellPx: recipe.grid.size }, recipe.scale),
    snap: recipe.snap,
    view: { x: 0, y: 0, zoom: 0 },       // zoom 0 means "fit on open"
    layers: recipe.layers.map((name) => LAYER_RECIPES[name]()),
  };
  if (kind === 'battle' && opts.paper !== true) {
    const paper = doc.layers.find((l) => l.kind === 'paper');
    if (paper) { paper.opacity = 0.18; paper.vignette = 0.18; paper.edge = 0; }
  }
  const grid = doc.layers.find((l) => l.kind === 'grid');
  if (grid) Object.assign(grid, recipe.grid);
  return doc;
}

/** Snap a point to the grid.
 *
 * The document decides whether snapping is on and how fine; the tool decides
 * whether it wants corners or cell centres. A wall belongs on the line between
 * two squares, a token or a stamp belongs in the middle of one, and asking the
 * user to switch a global setting between the two would be absurd. */
export function snapPoint(doc, pt, prefer = 'corner') {
  const mode = doc.snap || 'off';
  if (mode === 'off') return pt;
  const grid = doc.layers.find((l) => l.kind === 'grid');
  const size = (grid && grid.size) || (doc.scale && doc.scale.cellPx) || 64;
  const ox = (grid && grid.offsetX) || 0, oy = (grid && grid.offsetY) || 0;
  const step = mode === 'half' ? size / 2 : size;
  const bias = prefer === 'centre' ? step / 2 : 0;
  return {
    x: Math.round((pt.x - ox - bias) / step) * step + ox + bias,
    y: Math.round((pt.y - oy - bias) / step) * step + oy + bias,
  };
}

/** Distance in map units, for the measure tool and the scale bar. */
export function distanceLabel(doc, pixels) {
  const scale = doc.scale || { unit: 'px', perCell: 1, cellPx: 64 };
  const cells = pixels / (scale.cellPx || 64);
  const value = cells * (scale.perCell || 1);
  const rounded = value >= 100 ? Math.round(value)
    : value >= 10 ? Math.round(value * 10) / 10 : Math.round(value * 100) / 100;
  return rounded + ' ' + (scale.unit || 'units');
}

export function findLayer(doc, id) {
  return doc.layers.find((l) => l.id === id) || null;
}

export function layerIndex(doc, id) {
  return doc.layers.findIndex((l) => l.id === id);
}

/** Layers are listed top-first in the panel but drawn bottom-first. */
export function drawOrder(doc) {
  return doc.layers;
}

export function paintableLayers(doc) {
  return doc.layers.filter((l) => LAYER_KINDS[l.kind].paint);
}

/** Asset ids referenced anywhere in the document, so they can be preloaded. */
export function referencedAssets(doc) {
  const ids = new Set();
  for (const layer of doc.layers) {
    if (layer.texture) ids.add(layer.texture);
    for (const op of layer.ops || []) {
      if (op.tex) ids.add(op.tex);
      if (op.asset) ids.add(op.asset);
    }
  }
  return Array.from(ids);
}

export function serialise(doc) {
  return JSON.parse(JSON.stringify(doc));
}
