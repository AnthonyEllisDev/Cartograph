# Writing a Cartograph extension

An extension is a folder. Drop it in `extensions/`, restart the program, and
whatever it registers is part of the editor: tools in the rail, layer types the
renderer understands, panels beside the layer stack, commands in the palette,
formats in the Export dialog.

There is no build step, no package manager and no bundler. The file the program
imports is the file you wrote — an ES module, loaded by the browser directly.

> **A word about trust.** Extensions are not sandboxed. An extension runs with
> the same reach the editor has: your maps, your asset folders, the local API.
> That is the bargain a local, open program makes. Read an extension before you
> put it in the folder, the same way you would read a script before running it.

---

## The shape of one

```
extensions/
  my-extension/
    extension.json     <- the manifest, required
    main.js            <- the module, required
    icon.svg           <- anything else you want, optional
```

### `extension.json`

```json
{
  "id": "my-extension",
  "name": "My Extension",
  "version": "1.0.0",
  "author": "You",
  "description": "One sentence. This is what the Extensions tab shows.",
  "main": "main.js",
  "apiVersion": 1
}
```

`id` must be unique and is used to namespace everything you register.
`main` must exist or the program lists the extension with an error instead of
loading it. `apiVersion` is the version of the API below that you were written
against; a build that only provides an older one refuses to load you rather
than failing halfway through.

### `main.js`

```js
export default function setup(api) {
  api.registerCommand({
    id: 'hello',
    title: 'Say hello',
    run: () => api.ui.toast('Hello from my extension', 'good'),
  });
}
```

The default export is called once at startup with the API object. It may be
`async`. If it throws, the program reports *that extension* as broken in the
Extensions tab and carries on loading the others — one bad file never takes the
editor down with it.

---

## The API

Everything below hangs off the single `api` argument.

### Identity and files

| | |
|---|---|
| `api.version` | the API version this build provides (currently `1`) |
| `api.id` | your extension's id |
| `api.manifest` | the parsed `extension.json` |
| `api.url(file)` | a URL for a file inside your own folder — use it for images, workers, extra modules |

### `api.registerTool(spec)`

Adds a tool to the left rail. The spec is exactly the shape the built-in tools
use, so `web/js/tools.js` is the reference implementation for all of it.

```js
api.registerTool({
  id: 'token',                       // becomes "my-extension:token"
  label: 'Token',
  iconSvg: '<svg …>',                // or icon: 'brush' to reuse a built-in
  hint: 'Drop a labelled disc. Click to place, drag to size.',
  writesTo: ['tokens'],              // layer kinds this tool draws on
  snaps: true, snapTo: 'centre',     // 'corner' | 'centre'
  options: () => ([                  // rebuilt every time the panel renders
    { key: 'size', type: 'range', label: 'Size', min: 1, max: 6, step: 1, value: state.size },
    { key: 'colour', type: 'color', label: 'Colour', value: state.colour },
  ]),
  onOption: (key, value) => { state[key] = value; },
  down(pt, ev, layer) { … },
  move(pt, ev, layer) { … },
  up(pt, ev, layer) { … },
  overlay(ctx) { … },                // optional, drawn over the canvas each frame
});
```

Option types are `range`, `number`, `color`, `select`, `toggle`, and — for
anything else — plain text. A `range` may carry `percent: true` or
`suffix: 'px'` to say how its readout reads; a `select` takes
`options: [[value, label], …]`. Add `rerender: true` to have the whole panel
rebuild when that option changes, and `commit: true` to a range so it fires on
release rather than on every pixel of the drag — worth it for anything
expensive.

### `api.registerLayerKind(spec)`

Teaches the renderer a kind of layer it has never seen. Your `render` runs
whenever the layer is rebuilt; the ops list is yours to define and is saved
verbatim into `project.json`, so a map made with your extension still opens
years later as long as the extension is present.

```js
api.registerLayerKind({
  id: 'tokens',                         // used verbatim — pick something unlikely to clash
  label: 'Tokens',
  icon: 'stamp',
  render(layer, ctx, helpers) {         // helpers: { R, doc, assets }
    for (const op of layer.ops) { … }   // ctx is the layer's own canvas
  },
  make() {                              // optional: what "+ → this kind" creates
    return api.map.makeLayer('tokens', { name: 'Tokens' });
  },
});
```

Unlike tool ids, layer-kind ids are **not** namespaced for you: the id goes
into `project.json` verbatim, so a map keeps working if you rename your
extension, and breaks if two extensions pick the same word. Give `make()` and
the "+" button in the Layers panel offers your kind next to the built-in ones.

### `api.registerPanel(spec)`

Adds a panel to the right rail, under the map properties. `render(root, tools)`
is called again whenever the document or the layer selection changes, so read
your state fresh each time rather than holding onto nodes.

```js
api.registerPanel({
  title: 'Coordinates',
  where: 'right',
  render(root, { el, field }) {
    root.appendChild(el('p', { class: 'muted', text: 'Writes a reference into every cell.' }));
    root.appendChild(el('button', { class: 'btn', text: 'Add the layer', onclick: add }));
  },
});
```

### `api.registerCommand(spec)`

Adds an entry to the command palette (**Ctrl+K**). Give it `keys` and it also
gets a shortcut.

```js
api.registerCommand({
  id: 'foxing',
  title: 'Age the paper',
  detail: 'Speckles the paper layer with foxing',
  keys: 'Ctrl+Shift+A',
  run: () => { … },
});
```

### `api.registerExporter(spec)`

Adds a format to the Export dialog. `build` returns a `Blob`, a string, or
anything the `Blob` constructor accepts.

```js
api.registerExporter({
  id: 'geojson',
  label: 'GeoJSON',
  extension: '.geojson',
  build: (doc) => JSON.stringify(toGeoJSON(doc)),
});
```

---

## What else is on `api`

| | |
|---|---|
| `api.app` | the live app state object |
| `api.doc()` | the open document, or `null` |
| `api.activeLayer()` | the selected layer |
| `api.layers()` | every layer in the open document |
| `api.settings()` | the settings bag — put your own keys under your id |
| `api.events` | `{ on, emit }` — `'document'`, `'layers'`, `'tool'`, `'library'`, `'dirty'`, `'saved'` |
| `api.render` | the whole render module: `invalidate`, `compositeAll`, `requestDraw`, `flatten`, `mapToScreen`, `screenToMap`, `view` |
| `api.tools` | `{ TOOLS, currentTool, setTool }` |
| `api.assets` | `{ library, image, imageNow, pattern, warm }` — the texture and stamp library |
| `api.history` | `{ push, snapshot, restore }` — see below |
| `api.server` | the local HTTP API: `state`, `packs`, `importAsset`, `projects`, `createProject`, `readProject`, `writeProject`, `deleteProject`, `writeLayer`, `writeThumb`, `exportImage`, `openFolder` |
| `api.ui` | `{ el, modal, toast, icon }` |
| `api.util` | `{ clamp, rng, uid, hashString }` — `rng` is seeded, for repeatable noise |
| `api.map` | `{ makeLayer, snapPoint, distanceLabel, measureBetween, gridStepPx, hex, LAYER_KINDS }` — see *Grids* below |
| `api.markDirty()` | mark the document changed |
| `api.scheduleAutosave()` | poke the autosave timer |
| `api.invalidate(layer, box)` | rebuild a layer, optionally only inside a rectangle |

### Grids

`api.map.gridStepPx(doc)` is how many pixels one cell is — the grid layer is the
authority, not `doc.scale.cellPx`, and on a hex grid the step is across the
flats rather than the corner-to-corner `size` the layer stores. Anything
reporting a distance should go through it.

`api.map.measureBetween(doc, from, to)` returns `{ text, cells, pixels, hex,
path }`. On a hex grid `cells` is a count of hexes and `path` is the hexes
crossed; on a square grid `cells` is a fraction and `path` is `null`.

`api.map.hex` is the geometry itself, and anything drawing into hexes should use
it rather than working the arithmetic out again — that is exactly how a grid
ends up drawn in one place and snapped to in another. Every function takes the
grid layer as its first argument and reads `size` and `orientation` off it.

| | |
|---|---|
| `at(grid, pt)` | the hex containing a point, as axial `{q, r}` |
| `toPixel(grid, q, r)` | that hex's centre |
| `corners(grid, q, r)` | its six vertices, in drawing order |
| `edgeMidpoints(grid, q, r)` | the middle of each of its six edges |
| `neighbours(q, r)` | the six hexes around it |
| `distance(a, b)` | hexes crossed between two axial coordinates |
| `line(a, b)` | every hex on the shortest path, ends included |
| `snap(grid, pt, prefer, mode)` | what `snapPoint` calls for hex grids |
| `forEach(grid, w, h, fn)` | every hex on the map: `fn(x, y, col, row, q, r)` |
| `fromOffset` / `toOffset` | axial ↔ the `col, row` a person reads off a map |
| `step(grid)` | centre-to-centre distance |
| `spacing(grid)` | `{ col, row }` — how far apart columns and rows sit |

### Undo

Anything an extension does to a document should be undoable, or the editor's
undo stack starts lying. Push an entry with the two closures that put the
change in and take it back out:

```js
const before = api.history.snapshot(canvas, box);   // pixels you are about to overwrite
draw();
api.history.push({
  label: 'Coffee ring',
  bytes: before ? before.w * before.h * 4 : 0,      // so the stack can budget memory
  undo() { api.history.restore(canvas, before); api.render.compositeAll(box); api.render.requestDraw(); },
  redo() { draw(); api.render.compositeAll(box); api.render.requestDraw(); },
});
```

`label` is what the History panel shows, so name it after the thing the user
did, not after your function.

---

## The three that ship

Read these before writing your own — between them they use every register
function.

| Folder | Shows |
|---|---|
| `extensions/battle-tokens` | `registerTool` + `registerLayerKind` — a tool with options, a custom layer kind, click-and-drag placement, undo entries |
| `extensions/hex-coordinates` | `registerLayerKind` + `registerPanel` — a generated layer driven by controls in the side rail |
| `extensions/map-aging` | `registerCommand` — drawing straight onto an existing layer and pushing a proper undo entry |

## Loading, reloading and turning off

Extensions load once at startup, in folder order. There is no hot reload:
change a file and press **Reload** on the Extensions tab (it reloads the page).
Toggling one off writes its id into `config.json` and it stays off until you
turn it back on — useful for bisecting when the editor starts misbehaving.

If your extension throws during `setup`, the Extensions tab shows the message
next to it. Errors thrown later — inside a tool or a layer renderer — go to the
browser console, which you can open with F12.

## Compatibility

`apiVersion` is `1`. Within a major version, things are added and not removed:
a new register function or a new key on `api` may appear, but a `1` extension
keeps working. If the number goes to `2`, this document will say what moved.
