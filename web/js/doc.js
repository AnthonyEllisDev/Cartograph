/* The document: a plain object that is exactly what gets written to
   project.json. Every stroke, stamp, path and label is data, so a saved map is
   readable, diffable, and re-renders identically rather than being a flat
   picture of itself. */

import * as hex from './hex.js';
import { uid } from './util.js';

export const FORMAT = 1;

export const LAYER_KINDS = {
  water:   { label: 'Water',    paint: false, icon: 'water' },
  floor:   { label: 'Floor',    paint: false, icon: 'floor' },
  land:    { label: 'Landmass', paint: true,  icon: 'land'  },
  raster:  { label: 'Paint',    paint: true,  icon: 'brush' },
  paths:   { label: 'Paths',    paint: false, icon: 'path'  },
  regions: { label: 'Regions',  paint: false, icon: 'region' },
  objects: { label: 'Objects',  paint: false, icon: 'stamp' },
  labels:  { label: 'Labels',   paint: false, icon: 'text'  },
  walls:   { label: 'Walls',    paint: false, icon: 'wall'  },
  lights:  { label: 'Lighting', paint: false, icon: 'light' },
  group:   { label: 'Group',    paint: false, icon: 'group' },
  grid:    { label: 'Grid',     paint: false, icon: 'grid'  },
  paper:   { label: 'Paper',    paint: false, icon: 'paper' },
};

/** The entry for a layer's kind, or a usable stand-in.
 *
 *  A saved map can name a kind this program does not currently know: one an
 *  extension taught it and that is now switched off, or one from an
 *  extension that has been removed from the folder altogether. Every
 *  unguarded LAYER_KINDS[l.kind] was a throw on opening that map, which is
 *  also the state in which the user most needs to reach the layer. */
export function kindOf(layer) {
  return LAYER_KINDS[layer && layer.kind] || { label: (layer && layer.kind) || 'layer',
                                               paint: false, icon: 'group' };
}

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
  // Shadow and tint live on the layer, not on each stamp: a map wants every
  // tree lit from the same direction, and setting that once is the difference
  // between a control and a chore.
  if (kind === 'objects') Object.assign(base, {
    shadow: 0, shadowAngle: 55, shadowLength: 0.16, shadowBlur: 0.05,
    shadowColor: '#241c10', tint: '#6f8a4a', tintStrength: 0,
  });
  if (kind === 'walls') Object.assign(base, {
    color: '#20242c', thickness: 7, doorColor: '#a8763c',
  });
  // Darkness with holes in it: `ambient` is how dark the unlit map goes, and
  // every light op cuts its own reach back out of it. A new one starts at 0 —
  // an unlit map is a black rectangle, and nobody wants that by surprise, so
  // the light tool raises it when the first light is placed.
  if (kind === 'lights') Object.assign(base, {
    ambient: 0, color: '#060912', shadows: true, glow: 0.15,
  });
  // `size` is corner-to-corner on a hex grid, which is what it has always been;
  // `orientation` is only read when type is 'hex', and defaults to the flat-top
  // layout every existing document was drawn with.
  if (kind === 'grid') Object.assign(base, {
    type: 'none', size: 64, orientation: 'flat',
    color: '#3a2c1e', opacity: 0.25, offsetX: 0, offsetY: 0, lineWidth: 1,
  });
  // A group draws nothing itself. It is a folder: its members carry its id and
  // take their visibility and opacity through it.
  if (kind === 'group') Object.assign(base, { name: 'Group', collapsed: false });
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
    layers: ['floor', 'terrain', 'objects', 'walls', 'lights', 'labels', 'grid', 'paper'],
  },
  // A hex crawl is a region map that counts in hexes: the grid is the unit, so
  // the scale is one hex per cell and snapping is on from the start.
  hex: {
    label: 'Hex crawl',
    scale: { unit: 'hex', perCell: 1 },
    // A hex crawl is read at a glance and often zoomed out, so the grid has to
    // survive being downscaled — a one-pixel line at 0.3 alpha does not.
    grid: { type: 'hex', size: 110, orientation: 'flat', opacity: 0.5,
            color: '#3d3018', lineWidth: 1.5 },
    snap: 'grid',
    layers: ['water', 'land', 'terrain', 'paths', 'objects', 'labels', 'grid', 'paper'],
  },
};

const LAYER_RECIPES = {
  water: () => makeLayer('water'),
  land: () => makeLayer('land'),
  terrain: () => makeLayer('raster', { name: 'Terrain', texture: 'starter/forest' }),
  floor: () => makeLayer('floor'),
  paths: () => makeLayer('paths'),
  regions: () => makeLayer('regions', { showNames: true, nameSize: 34 }),
  objects: () => makeLayer('objects'),
  walls: () => makeLayer('walls'),
  lights: () => makeLayer('lights'),
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
  // Only now is the grid layer real, and the grid is what decides how many
  // pixels a cell is worth — on a hex map that is not the same as its size.
  doc.scale.cellPx = gridStepPx(doc);
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
  const grid = gridLayer(doc);
  if (grid && grid.type === 'hex') return hex.snap(grid, pt, prefer, mode);
  const size = (grid && grid.size) || (doc.scale && doc.scale.cellPx) || 64;
  const ox = (grid && grid.offsetX) || 0, oy = (grid && grid.offsetY) || 0;
  const step = mode === 'half' ? size / 2 : size;
  const bias = prefer === 'centre' ? step / 2 : 0;
  return {
    x: Math.round((pt.x - ox - bias) / step) * step + ox + bias,
    y: Math.round((pt.y - oy - bias) / step) * step + oy + bias,
  };
}

/* ---------------------------------------------------------------- groups */

/* Membership is an id on the member, not a list on the group.
 *
 * Keeping doc.layers a flat array matters more than it looks: project.json is
 * the document verbatim, and everything in the program from compositing to
 * the VTT export walks that array. A tree would have meant rewriting all of
 * it to gain nothing a member field does not already give. */

export function groupOf(doc, layer) {
  if (!layer || !layer.group) return null;
  const g = doc.layers.find((l) => l.id === layer.group && l.kind === 'group');
  return g || null;
}

export function membersOf(doc, group) {
  return doc.layers.filter((l) => l.group === group.id);
}

/** Whether a layer is actually drawn, which its group can veto. */
export function layerVisible(doc, layer) {
  if (!layer.visible) return false;
  const g = groupOf(doc, layer);
  return !g || g.visible;
}

/** A layer's opacity with its group's folded in. */
export function layerAlpha(doc, layer) {
  const own = layer.opacity != null ? layer.opacity : 1;
  const g = groupOf(doc, layer);
  return g ? own * (g.opacity != null ? g.opacity : 1) : own;
}

export function gridLayer(doc) {
  return (doc && doc.layers.find((l) => l.kind === 'grid')) || null;
}

/** How many pixels one cell step is.
 *
 * The grid layer is the authority, not `scale.cellPx`: the two start in sync
 * and the Map panel keeps them that way, but a document written before that
 * was true can have a stale `cellPx`, and a stale scale silently makes every
 * distance on the map wrong. On a hex grid the step is centre-to-centre, which
 * is shorter than the corner-to-corner `size` the layer stores. */
export function gridStepPx(doc) {
  const grid = gridLayer(doc);
  if (grid && grid.type === 'hex') return hex.step(grid);
  if (grid && grid.type === 'square' && grid.size) return grid.size;
  return (doc && doc.scale && doc.scale.cellPx) || (grid && grid.size) || 64;
}

function roundish(value) {
  return value >= 100 ? Math.round(value)
    : value >= 10 ? Math.round(value * 10) / 10 : Math.round(value * 100) / 100;
}

/** Distance in map units, for the scale bar and for anything holding only a
 *  length. Measurement between two known points should use `measureBetween`,
 *  which can count hexes properly. */
export function distanceLabel(doc, pixels) {
  const scale = (doc && doc.scale) || { unit: 'px', perCell: 1, cellPx: 64 };
  const cells = pixels / (gridStepPx(doc) || 64);
  return roundish(cells * (scale.perCell || 1)) + ' ' + (scale.unit || 'units');
}

/** Measure between two points on the map.
 *
 * On a square grid this is the straight-line distance, as it always was. On a
 * hex grid it is the number of hexes you cross, which is a different number
 * and the only one a hex crawl cares about — three hexes is three hexes
 * whether they run east or north-east, and the pixel distance is not.
 *
 * Returns the path as well, so the measure tool can show its work. */
export function measureBetween(doc, from, to) {
  const scale = (doc && doc.scale) || { unit: 'units', perCell: 1 };
  const pixels = Math.hypot(to.x - from.x, to.y - from.y);
  const grid = gridLayer(doc);
  const unit = scale.unit || 'units';
  const perCell = scale.perCell || 1;

  if (grid && grid.type === 'hex') {
    const a = hex.at(grid, from), b = hex.at(grid, to);
    const cells = hex.distance(a, b);
    const hexes = cells + (cells === 1 ? ' hex' : ' hexes');
    return {
      hex: true, cells, pixels, path: hex.line(a, b),
      text: unit === 'hex' ? hexes : roundish(cells * perCell) + ' ' + unit + '  ·  ' + hexes,
    };
  }
  const cells = pixels / (gridStepPx(doc) || 64);
  return {
    hex: false, cells, pixels, path: null,
    text: roundish(cells * perCell) + ' ' + unit,
  };
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
  return doc.layers.filter((l) => kindOf(l).paint);
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
