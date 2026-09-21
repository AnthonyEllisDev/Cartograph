# Daily log

One entry per working day. The daily maintenance run reads this before it
starts, so it knows what has already been done and does not do it twice.

---

## 2026-09-21 — the backlog, cleared

Two sessions in one day. The first added hex support; the second emptied the
rest of the backlog so that the daily run starts from a blank list.

**Hex grids became first-class.** `web/js/hex.js` is now the single definition
of where the hexes are, and the renderer, the snapping, the measure tool, the
coordinates extension and the New Map dialog all read it. Stamps snap to hex
centres, walls and paths to corners, half-cells to edge midpoints; measurement
counts hexes along the cube line and highlights the ones it counted; flat-top
and pointy-top are both supported; and there is a Hex crawl map kind.

**Lighting and darkness for battle maps.** A `lights` layer holds light sources
and renders as darkness with a hole cut for each one. `web/js/light.js` casts
the shadows — the classic visibility polygon, with rays doubled either side of
each wall corner. Windows let light through because `WALL_KINDS.blocks` already
said they should. Sources are set in map units (a torch really is 20/40 feet),
lights can be shuttered into a cone, and they travel into the Universal VTT
export as real light data with the image written unlit, so a tabletop does not
light an already-lit map. Measured at 38 ms to rebuild 20 lights against 170
wall segments in software rendering.

**Extension unload.** Turning an extension off takes its tools, panels,
commands and layer kinds back out there and then — no page reload. Layers whose
kind belonged to the extension keep their ops and are marked "(off)" rather
than being deleted, and come back intact when it is turned on again. Setup can
return a teardown function, or call `api.onUnload`.

**Text along a path.** Dragging with the Label tool lays the name along the
curve; clicking still places a straight one. A curve drawn right to left is
turned round rather than set upside down.

**Brush dynamics.** Pen pressure or speed drives the brush width. Width only,
never opacity — painting is mask-then-texture precisely so overlapping parts of
one stroke do not darken each other, and varying opacity along a stroke would
put that back. The width never exceeds the size on the slider, which is what
lets `strokeBox` keep reaching far enough for a rebuild to match a live
repaint. A mouse has no pressure to read, so it keeps the old stroke path
exactly.

**Layer groups.** A `group` layer is a folder: membership is an id on the
member, so `doc.layers` stays the flat array everything else walks. Group
visibility and opacity fold into the members, joining a group moves the layer
next to the others so the run stays contiguous, and deleting a group frees its
members rather than deleting them.

**Stamp shadow and tint**, set once on the Objects layer rather than per stamp,
with the silhouettes cached.

**Hex and the tabletop export.** Universal VTT has no field for a hex grid.
The walls and the image go across correctly because `pixels_per_grid` is the
across-flats step, and the export dialog now says plainly that you pick the hex
grid type once on the tabletop side.

**Open issues cleared.** An empty asset pack now explains what the folder is
for instead of reading "licence not stated, 0 assets". History moved above Map
in the right rail, because History is read while you work and Map is set once.

**Two bugs found by reading.** Changing the grid cell size never updated
`scale.cellPx`, so the scale bar and the measure tool silently drifted away
from the grid; `gridStepPx(doc)` is now the single authority. And all seven
test scripts hard-coded a Linux Chromium path, so none of them could run on the
machine this project is developed on.

**The harness.** Suites were poisoning each other: the editor reopens the last
map on launch, so a suite that assumed a region map inherited whatever the
previous one saved and failed five checks a long way from the cause. Every
suite now makes its own map through `newMap()`, and waits for the editor to
finish booting with `ready()` rather than sleeping and hoping. Proven by two
full back-to-back rounds with identical results.

**Left alone deliberately.** The landmass full rebuild measures 948 ms on a
deliberately heavy 16-stroke continent at 2048x1536, software-rendered on a
two-core container; `repaintLand` re-tints from the cache in 57 ms, which is
the path colour changes take and the one that has to feel instant. That is the
design working, so nothing was optimised on the strength of a number from a
container. To measure it on real hardware:

```js
const land = __cg.app.doc.layers.find(l => l.kind === 'land');
const best = f => { let m = Infinity; for (let i = 0; i < 5; i++) { const t = performance.now(); f(); m = Math.min(m, performance.now() - t); } return m; };
best(() => __cg.R.rebuildLayer(land));   // full rebuild
best(() => __cg.R.repaintLand(land));    // re-tint from the cache
```

**Tests:** 82 verify, 29 lighting, 27 hex, 24 pro, 16 ext, 16 theme, 8 labels,
8 brushes — 210 assertions, all passing, plus `battle` and `demo`.
