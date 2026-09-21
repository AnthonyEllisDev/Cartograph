/* The asset library: what the packs on disk contain, and the images for them.
   Everything is fetched from this machine, cached once, and handed out as
   ready-to-draw Image objects or canvas patterns. */

import { api } from './api.js';
import { makeCanvas } from './util.js';

const images = new Map();     // asset id -> Promise<Image>
const patterns = new Map();   // `${id}@${scale}` -> CanvasPattern

export const library = {
  packs: [],
  byId: new Map(),
  groups: { terrain: [], stamp: [] },
};

function urlFor(asset) {
  return `/assets/packs/${asset.pack}/${asset.file}`;
}

export async function loadLibrary() {
  const { packs } = await api.packs();
  library.packs = packs;
  library.byId.clear();
  library.groups = { terrain: [], stamp: [] };
  for (const pack of packs) {
    for (const asset of pack.assets || []) {
      asset.pack = pack.dir || pack.id;
      asset.url = urlFor(asset);
      library.byId.set(asset.id, asset);
      const bucket = asset.kind === 'terrain' ? 'terrain' : 'stamp';
      library.groups[bucket].push(asset);
    }
  }
  return library;
}

export function assetsOfKind(kind) {
  return library.groups[kind === 'terrain' ? 'terrain' : 'stamp'];
}

export function groupNames(kind) {
  const seen = new Map();
  for (const a of assetsOfKind(kind)) seen.set(a.group || 'other', true);
  return Array.from(seen.keys()).sort();
}

/** Load (and cache) the bitmap for an asset. SVG stamps rasterise on demand. */
export function image(id) {
  if (images.has(id)) return images.get(id);
  const asset = library.byId.get(id);
  if (!asset) return Promise.reject(new Error('unknown asset ' + id));
  const promise = new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('cannot load ' + asset.url));
    img.src = asset.url;
  });
  images.set(id, promise);
  return promise;
}

/** Synchronous access for the render loop — null until image() has resolved. */
export function imageNow(id) {
  const p = images.get(id);
  return p && p.__value ? p.__value : null;
}

export async function warm(ids) {
  await Promise.all(ids.map(async (id) => {
    try {
      const img = await image(id);
      images.get(id).__value = img;
    } catch (err) { /* a missing file should not stop the map drawing */ }
  }));
}

/** A repeating pattern for a terrain texture, scaled and cached. */
export function pattern(ctx, id, scale = 1) {
  const key = `${id}@${scale.toFixed(3)}`;
  if (patterns.has(key)) return patterns.get(key);
  const img = imageNow(id);
  if (!img) return null;
  let source = img;
  if (Math.abs(scale - 1) > 0.001) {
    const w = Math.max(2, Math.round(img.width * scale));
    const h = Math.max(2, Math.round(img.height * scale));
    const c = makeCanvas(w, h);
    const cx = c.getContext('2d');
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(img, 0, 0, w, h);
    source = c;
  }
  const pat = ctx.createPattern(source, 'repeat');
  patterns.set(key, pat);
  return pat;
}

export function forgetPatterns() { patterns.clear(); }

/** Forget the decoded images too. Rescan cleared the pattern cache alone, and
 *  patterns are rebuilt from these -- so replacing a file on disk under a name
 *  the library already knew went on drawing the old picture until a reload. */
export function forgetImages() { images.clear(); }
