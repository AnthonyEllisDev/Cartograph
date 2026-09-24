# Daily log

One entry per working day. The daily maintenance run reads this before it
starts, so it knows what has already been done and does not do it twice.

---

## 2026-09-24 — a properties panel, and a paint layer that would not go away

Anthony's working copy matched `origin/main` byte for byte across all 66 tracked
source files, so this could be a feature day.

**The baseline was not quite green, and the reason is worth reading.**
`test/pro.mjs` failed one check — *hiding a group hides its members* — against a
pristine `git clone` as surely as against the working tree, so it was not a
regression in the program. The preset section of that suite reloads the page to
prove a preset outlives it, and **a new map lives only in memory until the first
save**: `newMap` posts nothing to the server, `app.slug` is null until
`saveProject` runs, and autosave does not fire for fifteen seconds. So the
reload did not bring "Pro Workbench" back at all — it reopened whatever map was
last written to disk, which is the *previous suite's*. The group section then
grouped and hid layers on that map and measured it. It passed for as long as the
inherited map happened to have paint on a raster layer and failed the first day
it did not, a long way from the cause. That is the same poisoning `newMap` and
`ready` exist to stop, arriving through a reload rather than through omission.
The section now makes its own map and paints on it, with a precondition check
saying so, which is what its neighbour is measured against.

**The feature: changing a thing after it has been drawn.** Research first —
Dungeondraft treats its Selection Tool as the primary property editor, Azgaar
opens a properties window on any marker, Foundry gives every map note a config
dialog, and Inkarnate, which largely does not have this, has a stamp-tool
feature board dominated by requests for it. Cartograph had fifteen tools writing
six op kinds, every one of them fully-specified JSON carrying exactly the fields
a panel would expose — and no way to reach any of them. A region's colour, a
road's width, a label's wording, a door's kind and a lamp's reach were all fixed
at the moment the tool committed them, and the only way to change one was to
delete it and draw it again. This is the gap against the baseline rather than an
addition on top of it, and it is the only candidate on the list that retrofits
six landed features at once.

There is a **Selected** panel at the top of the right rail, there only while the
Select tool is holding something. Three things about it were decisions.

It is **one table, not six hand-written panels**. Every field goes through a
single `editObject`, so the two mistakes this invites — a colour input firing on
every tick of a drag inside the picker, and an undo entry that hands the item
back the snapshot's own arrays — are one fix each rather than six. Every
expensive control carries `commit: true`; the undo entry deep-copies in both
directions; an edit that changes nothing pushes no entry, because at 32 slots a
dead one evicts a real step.

Edits go through **`R.invalidate(layer)`**, not `compositeAll`. That matters for
exactly one case and it is the case the suite measures: turning a door into a
window has to lift the shadows behind it, and `invalidate` is the route that
relights. A light's Bright and Dim are shown in **map units and stored in
pixels**, the conversion `unitPx()` makes, so a light edited here is worth the
same as one placed there.

`hitTest` learnt about **walls**, which it did not cover at all, so a wall can
now be picked up and restyled. Hit testing on a wall is by its points — a
straight one has exactly two — which is why the suite grabs it by reading the op
rather than by clicking where the drag started; snapping has moved the ends onto
the grid by then.

The panel sits **first in the rail**, above Layers. It is what you are working
on at that moment, and the Layers panel is long enough to push anything under it
off the bottom of a short window — which is exactly what happened to the first
version, and was obvious in a screenshot and invisible in the source.

**Two bugs that lost work.** Both were found by reading and then reproduced.

*Undoing past a layer delete left the paint on the canvas and took the ops out
of the document.* `deleteLayer`'s undo called `R.setDocument(app.doc)`, which
empties `layerCanvases` and mints fresh ones — and every painting entry below it
in the stack is a closure holding the canvas it snapshotted. The next undo wrote
its pixels into an orphan while still splicing the op out of `layer.ops`, so the
stroke stayed on screen and left the file; the next save wrote a map without it.
Measured on the unfixed tree the flattened map was byte-for-byte unchanged while
the ops were gone. The undo now rebuilds just the layer it put back, which is
the only one whose canvas was dropped. `resizeDialog` has the same shape and no
targeted fix is available — every canvas really is replaced — so it clears the
history, as opening a map does.

*Narrowing a coastline left a band of the wider one behind.* `repaintLand`
clears only the rectangle it is about to draw and grew that rectangle from the
*current* shelf and ink widths. Drag *Shallow width* from 120 down to 2 and the
wider band falls outside the clear and stays on the canvas, in 64-px steps,
until something forces a full rebuild — and a full rebuild clears the whole
canvas, so the map did not come back from disk the way it was on screen. That is
invariant (a). There is a `coastReach` map now: cleared as far as the coast has
ever reached on that layer, drawn as far as it reaches now. The box is still
snapped to `SHELF_GRID` inside `paintLand`, so widening it by whole grid steps
moves nothing the shelf downscale depends on — this is not the `opBox` change
that was reverted yesterday, because nothing here feeds `applyStroke`. Measured
against a full rebuild of the same layer: 595,585 bytes differed before, none
after.

**The stroke under the cursor was not the stroke that got committed.**
`strokePath` picks a different rasteriser depending on whether `op.widths` is
there: with widths it stamps discs along the straight chords between points,
without them it strokes the corner-cutting spline. `endPaint` deletes a uniform
widths array — and `dynamicWidth` returns a flat `size` for every point on a
mouse, because only a pen has pressure to read. So that was *every ordinary
stroke*: angular under the cursor, smooth the instant the button came up. The
comment justifying the deletion said it was "a different rendering path for no
difference at all", which was the wrong half of true. The live preview drops a
uniform array too now, so both sides take the spline. Nothing committed changed,
which is why no fingerprint moved; 35,579 samples moved between preview and
commit on the unfixed tree, none after.

**Server robustness, four things that answered 500 where they should have
answered 400 or nothing at all.** `projects.write` made
`projects/<name>/layers/` and *then* reached the line that rejects a body which
is not an object, so every refused PUT left a folder behind — invisible in the
Projects tab and enough to make `unique_slug` walk away from that name for ever.
`/api/open-folder` put an unhashable `which` straight into a dict lookup.
`disabledExtensions` holding anything but a list took **both** extension
endpoints down with "not iterable", which empties the Extensions tab and leaves
no way to repair it from inside the program; a bare string there was worse,
exploding into its own characters and being written back that way. And
`load_config`'s "config.json ignored" net caught `OSError` and `ValueError` but
not the `TypeError` that `dict.update` raises on valid JSON of the wrong shape —
so a `config.json` holding `5` or `[1,2]`, which is what a crash during
`save_config`'s truncating in-place write can leave, stopped the program
starting at all.

**Three races, fixed and not covered by a check.** `sweep_blobs` ran `os.remove`
unguarded, *after* `projects.write` had already replaced `project.json` — so an
autosave landing on top of a manual save had both threads removing the same
stale blob and the loser reported a failed save for one that was on disk and
complete, which skips `markDirty(false)` and leaves the document dirty for good.
`write_blob` used a fixed `<name>.tmp`, one name per blob rather than one per
write: the identical bug `projects.write` was given `mkstemp` for, twelve lines
below it. `projects.delete` surfaced the loser of an `isdir`-then-`rmtree` race
as a 500 rather than a 404. All three now behave. **No check went in for any of
them**: the drafts passed against a pristine clone as readily as against the
fixed tree — this container serialises them too well — and one of them reset the
connection under load. A check that cannot fail is a lie about the program, so
they were deleted rather than kept, as the dabs-box assertion was yesterday.
Worth re-attempting on real hardware.

**Smaller things, all of them things you would meet.** `markDirty` and
`scheduleAutosave` travel together, and sixteen places in `ui.js`, three in the
command palette and the project-rename field called the first without the
second — so an undo, a jump in the History panel, a rename, a layer opacity or a
coast colour set after the last autosave had fired marked the document dirty and
rearmed nothing, and the file on disk kept what had been changed away. The
scatter preview drew without the layer's style, so a run of trees previewed flat
and gained every drop shadow and tint at once on release. `[` and `]` wrote the
brush size straight into the settings bag instead of through `setToolSetting`,
so it never reached `localStorage` and reverted at the next launch. A stamp
whose variant finished decoding after pointerup was in `project.json` and
missing from the map, because the warm handler asked for a redraw rather than a
rebuild and `renderObjects` skips an asset `imageNow` has not decoded. `toUVTT`
threw on a degenerate wall where `renderWalls` and `wallSegments` both skip one.

**Tests.** One new suite and six new assertions elsewhere, 342 in all.
`test/props.mjs` (37) is the feature: the panel absent with nothing picked up,
a region picked up by its border and its five fields offered, a colour change
reaching the op *and* the map, one undo step named for what it changed, a
re-set of the same value pushing nothing, undo restoring the colour and the
pixels and the control, select and text fields writing through, a label
reworded and resized, a path widened, the panel going away when another tool is
picked up and when the selection is deleted, the whole lot surviving a save and
a reload, a wall picked up at all, a door turned into a window *and the light
coming through it*, undo putting the shadow back, a light's radii reading in
feet while stored in pixels, and a wider dim radius lighting what it now
reaches. Three new checks in `regress.mjs` and three in `guards.mjs`. All six
were run against a pristine clone of `origin/main`: **6 of 6 fail there**, and
`props.mjs` cannot run there at all — there is no `#panel-selection` to ask
about. Two region measurements were rewritten rather than kept as first
written: one sampled a point outside the territory entirely, and the first
colour was another blue over a blue sea, which is a check that cannot tell the
tint from what is under it. The light check moved to a 40x30 battle map,
because on the default 20x15 room every corner is already inside a torch's
reach and "it lights further" cannot move.

**Tests:** 82 verify, 37 props, 35 guards, 34 regress, 29 lighting, 27 hex, 25
pro, 25 regions, 16 ext, 16 theme, 8 labels, 8 brushes — 342 assertions, all
passing, plus `battle`, over two full back-to-back rounds.

**Not done, deliberately.** The extension API is additive only and
`API_VERSION` is still 1: `api.tools` gained `selectedObject()` and
`clearSelection()`, and there is a `'selection'` event. Three findings were
written up rather than changed. The layer **Opacity** slider is the only range
field in the Layers panel without `commit: true` and runs a full-map
`compositeAll` on every pointer tick — but live feedback is most of the point of
an opacity slider, so that is a judgement call rather than a defect, and it
belongs to whoever decides which way it should feel. The Shape tool commits with
`live.box`, the union of every frame, while a reload replays it with `opBox`
alone, so dragging an ellipse out and back in before releasing keeps a little
more of the feather's tail than the reload reproduces; it is sub-visible above
about Feather 71% and it is squarely in the territory of yesterday's two
reverted box changes, so it was left alone. And the handler sets no socket
timeout, so sixty connections that declare a `Content-Length` and then dribble
one byte pin sixty threads indefinitely — reproduced, bounded by this being a
desktop app, and a behaviour change to the request path that deserves its own
day rather than a corner of a feature day.

---

## 2026-09-23 — regions, and two fixes that were not one-liners

A feature day. Anthony's working copy matched `origin/main` byte for byte and
the baseline was green twice over — 258 assertions across ten suites — so this
was the first day since the backlog emptied that could add something.

**The Region tool.** Click round the border of a territory, press Enter, give
it a name: a tinted area, an outline and the name set across the middle of it.
Kingdoms, duchies, the reach of a forest. Wonderdraft has regions, Azgaar has
states and provinces, Inkarnate gets there with brushes; Cartograph had no
`regions` layer at all, and the region-map half of the program has had the
least attention of the three kinds. It is pure canvas, a new layer kind and a
tool, so it costs the founding constraints nothing.

Three things about it were decisions rather than defaults. The fill is a
**tint** at 28% rather than paint, because a political boundary that hides the
terrain under it is worse than useless on a map you are also meant to read;
that is why the suite asserts the parchment still shows through rather than
merely that something changed. The outline is a **closed spline**, the same
quadratic-midpoint curve the paths use but wrapped, so a territory does not
show the corner where you happened to start drawing it. And the name sits at
the **area-weighted centroid**, not the mean of the vertices: the mean drags
towards whichever stretch of border you clicked most finely and lands outside
anything crescent-shaped. Borders are solid, dashed, dotted or off — an area
with no agreed edge is a real thing to want to draw.

A region map does **not** start with a regions layer. Picking the tool on a map
without one gets the panel's existing offer to add it, which is how the wall and
light tools already work, and it leaves every existing map and every existing
suite's layer stack untouched.

Regions come with the Select tool for free, because it moves anything with a
`points` array — grab any point on a border and the whole outline follows. Hit
testing is by border point and deliberately not by the filled area: a region
covers half the map, and a fill you can grab is a trap over everything under it.

**Two bugs found on the server that stopped the editor booting.** Neither is
about shape, which is what last two days' guards were about, so neither was
caught. `png.dimensions` did a bare `open()`, and `_walk_loose` calls it for
every `.png` it finds — so a broken symlink, an unreadable file or a cloud
placeholder in any pack folder raised `OSError` out of `/api/packs`, and
`boot()` reads the library, so the whole editor came up as *"Cartograph could
not reach its own server."* One unreadable file, wrong message, no editor.
`index()` now reports a bad pack as broken and keeps the rest. Separately,
`urlparse` raises `ValueError` on an absolute-form target with a malformed IPv6
literal, and it ran as the first statement of `_handle`, before any of the body
handling — so the handler died without writing a byte and printed a traceback
for every one. That is the same shape as the NUL-byte hole `safe.under()`
documents, one layer up. It goes through `_refuse` now, like every other early
return in that function.

**A save that landed and reported failure.** `api.py` built its blob keep-list
with `doc.get("layers", [])`, which does not cover an explicit `"layers": null`,
and `sweep_blobs` concatenated `id + ".png"` without checking the id was a
string. Both raise *after* `projects.write` has already replaced
`project.json`, so the map was on disk and the editor was told the save had
failed — which means `markDirty(false)` is skipped and the document stays dirty
for good. And `projects.read` had none of the shape checking `list_projects`
has, so a hand-edited map went straight to `openDocument` and threw outside any
`try`. That one is half of the known "a deleted or malformed last-open map stops
the editor booting"; it is refused with a 404 now rather than handed over.

**`slugify` threw away every long map name.** `SLUG_RE` caps the whole string
at 64 characters and the match was tested against the *untrimmed* text, so
anything longer failed and fell back — one long title saved to
`projects/untitled`, the next to `projects/untitled 2`. `text[:64]` was dead
code. It trims first now. It also did `(text or "").strip()` on whatever the
request body held, so a name that was a number was a 500 out of the one helper
that exists to be the safe front door for untrusted text.

**Smaller things, all of them things you would meet.** A click with the Shape
tool that never dragged pushed a "Fill" step that undid nothing — at 32 slots
that quietly evicts real steps — and wrote a zero-area op into the map that was
replayed on every rebuild afterwards. The Light tool's *first light turns the
night on* was tested on the ambient value rather than on whether the layer held
any lights, so pulling Darkness to nought to look at the art underneath snapped
the map back to 80% night on the very next light placed. `toUVTT` exported a
hidden walls layer's sight lines while the lights half of the same export
checked visibility, so a tabletop got barriers for walls that were not in the
picture. `path.finish()` had no null-layer guard, so locking the paths layer
part way through a route threw and lost it. Four colour pickers — the coast Ink
and Shallow, the lighting Night and the grid Colour — ran a full repaint or
relight on every tick of a drag inside the picker; the objects panel had been
fixed for exactly this and these were missed. The land mask ignored `op.widths`
while its own preview honoured them, so a tapered coastline snapped to full
brush width the instant you let go.

**A map holding a layer kind nothing knows about now opens.** `LAYER_KINDS[
l.kind].paint` was dereferenced unguarded in `openDocument`, `paintableLayers`,
`layerRow` and `deleteLayer`. Open a map that uses a kind from an extension that
is switched off or has been removed and it threw before anything was drawn —
and the layer could not then be reached to delete it either, which is the state
you are most likely to be in when you meet this. There is a `kindOf(layer)` in
`doc.js` now that returns a usable stand-in.

**Two fixes attempted and reverted, which is the more useful half of today.**
Both looked like one-line corrections of a stated invariant and both turned out
to be contract changes.

*Invariant (c), live strokes.* `paintLive` computes its box from every point in
the stroke, not the segment just drawn, so it grows monotonically and each frame
of a drag allocates two canvases the size of the whole stroke and re-composites
every layer over all of it — exactly the slowdown the comment three lines below
it warns about. Taking the box from the last two points instead made the mid-drag
erase preview stop being pixel-identical to the committed result: `applyStroke`
draws the path into a canvas the size of the box it is handed, so a per-segment
box clips the soft brush's blur at its own edge and leaves a faint seam at every
segment boundary. The measured distance went from 0 to 57. Doing it properly
means letting `applyStroke` draw into a padded canvas and blit only the middle.
Put back, with the reasoning in the comment.

*`opBox` under-measures a scatter stroke.* A dab is thrown up to `size*jitter/2`
off the path and drawn at up to `0.4*size*(1+sizeJitter)` radius, against a box
grown for a stroked line — about 94 px where the real reach is ~133, so the
outermost dabs are sliced off along a straight edge. Growing the box **broke
invariant (a) intermittently**: `brushes.mjs`'s "reloads pixel-identical" failed
3 runs in 5 against 0 in 9 on a pristine clone. `opBox` sizes the canvas
`applyStroke` allocates, so changing it changes how much geometry is available
to the blur — and the incremental paint and the full rebuild stopped agreeing.
The reach and the live paint box have to move together. Reverted; the clipping
is real and is now a known issue rather than a guess.

That second one is worth the next run's attention for the general lesson: in
this renderer a box is not only a clip, it is the size of the canvas the blur
runs in, so widening one on its own changes pixels.

**Tests.** Forty new assertions and one new suite. `test/regions.mjs` (25) is
the feature: the tool, the offer to add the layer, four clicks making one
region, the tint reading as a tint, the name drawn at the centroid with its
halo and taken off again by *Show names*, two points making nothing, Escape
abandoning the outline, undo and redo, dragging a border point, and the round
trip. Seven new checks in `guards.mjs` and eight in `regress.mjs` for the bugs
above. All fifteen were run against a pristine clone of `origin/main`: **7 of 7
new guard checks and 7 of 8 new regress checks fail there.** The one that passes
on both trees is kept deliberately — "the first light turns the darkness on" is
the precondition that makes "and a later one leaves it where it was put" mean
anything, and it would fail if the fix over-corrected. One draft check was
thrown away rather than kept: the dabs-box assertion, because its fix was
reverted and a check for behaviour the program does not have is a lie about it.
Three checks in the regions suite were rewritten rather than kept as first
written — they were measuring the name's halo, comparing two different points,
and counting the blue sea as dark ink.

**Tests:** 82 verify, 29 lighting, 27 hex, 24 pro, 32 guards, 31 regress, 25
regions, 16 ext, 16 theme, 8 labels, 8 brushes — 298 assertions, all passing,
plus `battle`, over two full back-to-back rounds.

**Not done, deliberately.** The extension API is untouched: `API_VERSION` is
still 1, `regions` is a core layer kind, and `REGION_BORDERS`, `REGION_DEFAULTS`
and `regionCentroid` came to extensions for free through `api.render`, so
`EXTENSIONS.md` needed no change. Regions have no per-region editing panel — you
set the colour, fill and border on the tool before you draw, and changing one
afterwards means deleting it and drawing it again. That is the obvious next
slice and it wants the Select tool to grow a properties panel, which is a piece
of design rather than an addition. The asset-id collision across sub-folders
(`terrain/rock.png` and `stamps/rock.png` both becoming `user/rock`) was left
alone on purpose: the fix changes the ids of assets already on disk, so it would
break saved maps that reference them, and it needs a migration rather than a
patch.

---

## 2026-09-22 — the guard that was only half a guard

A review day, and not by choice. The baseline was green — 239 assertions across
ten suites, twice — so this should have been a feature day. It stopped being one
about twenty minutes in, when the Origin guard turned out to be walkable past
again by a route yesterday's fix never covered. Everything below is a bug that
was in the program this morning; nothing was added.

**The Origin guard, round two.** Yesterday the refusal machinery was built and
the `/api/` path was routed through it: settle the body length first, hang up
rather than answer, refuse chunked with a 411. All of that is still correct.
But it was put *inside* the `if path.startswith("/api/")` branch, and eight
lines below it sat the static path's `if method != "GET": return self._send(405,
…)` — which answers, does not read the body, and does not close the connection.
Same keep-alive socket, same desync, same result: the body is parsed as the next
request, that one carries no `Origin`, and it sails through. Reproduced on the
running program: one connection, a cross-origin `POST /not-api` whose body was a
second request, and `projects/SMUGGLED/` appeared on disk. A CORS-simple `fetch`
with `Content-Type: text/plain` sends exactly those bytes with no preflight, so
any page the user had open could reach every mutating endpoint — the same full
exposure as yesterday, through a different door.

A plain `GET` with a body had it too, for the same reason: the static branch has
no use for the bytes, but not reading them is what lets the next parse find a
request in them. The lesson is that the guard cannot live in one arm of the
routing split, because the socket does not know which arm was going to answer
it. The length check and the refusal now run *before* the split, the 405 goes
through `_refuse`, a static GET drains its body, and `do_OPTIONS` refuses
chunked rather than leaving it behind. Two `Content-Length` headers that
disagree are refused too — we would have read one of them and left the
difference on the wire, which is the same bug wearing a hat.

**One bad file, three empty libraries.** `read_pack` checks that the manifest is
an object and that `assets` is a list, and then does `"/" not in a.get("id", "")`
— so an asset whose `id` is a number reaches `"/" not in 123` and takes the
whole `/api/packs` call down with a `TypeError`. Every good pack on disk
disappears because of one bad file, which is precisely what the comment three
lines above says it is guarding against. `extensions.index` had the same shape
(`entry["id"] not in disabled` with an unhashable id) and so did
`projects.list` — there the `try` covers the parse but not the use, so a
`project.json` holding a bare list raises `AttributeError` out of the endpoint.
That last one is the worst of the three: `main.js` reads the project list
outside any `try`, so one hand-edited or half-written map stopped the editor
booting at all. `os.path.getmtime` was outside the `try` as well, so a folder
deleted between the `listdir` and the stat did the same.

**Undo quietly died partway through a long session.** `history.bytes` accounts
for the past *and* the future — `undo()` moves an entry across without repaying,
because the entry is still holding its pixels. But `pushEntry` discards the redo
stack with `history.future.length = 0` and never repaid those bytes. So every
undo-then-draw-something-else leaked a snapshot's worth, permanently. Once the
leak passed the 220 MB ceiling the eviction loop fired on *every* push, shifted
the entry just made, hit `if (history.past.length <= 1) break`, and returned
with the stack empty — and `bytes` could never come down again, because nothing
it was counting was still in `past` to be subtracted. Simulated at forty
paint-and-undo cycles: 216 MB held, nought steps kept. What that looks like from
the chair is Undo greying out the instant you use it and staying that way, no
matter how much you draw, until you reload the page.

**The eraser showed nothing until you let go.** A stroke in progress goes on the
live canvas, which `compositeAll` draws *over* the layer — and source-over
cannot subtract, so a `destination-out` stroke had nothing to subtract from and
the composite had nothing to show. Both halves were wrong, as it turns out:
`paintLive` ran the destination-out against an empty live canvas, so the live
canvas stayed blank; and even a correct one could not have been laid on top.
Now the live canvas carries the stroke's *shape* and `compositeAll` uses it as a
cutter — the layer's box is copied, the shape is cut out of the copy, and the
copy is what gets drawn. Carving sea with the Landmass tool had the same dead
preview and is fixed by the same change. Measured mid-drag, the preview is now
pixel-identical to what the release produces. The remains of the old mask-based
preview path (`view.liveMask`, allocated per document, cleared per stroke, read
by nothing) went with it — about 12.6 MB and a full-canvas clear per stroke, for
nothing.

**Shadows, again, by two more routes.** `relight` is called from the eye in the
Layers panel and from `invalidate`, and both are right. Filing the walls into a
group is neither: `setLayerGroup` composited and stopped, so dragging the Walls
layer into a folder that was already hidden left every shadow exactly where it
was, over floor that now looks empty. Deleting a group is worse, because it
*frees* its members rather than deleting them — so the walls come back into view
and start casting again, and by the time `deleteLayer` could ask `relight`
whether the group held any, nothing points at the group any more. That one needs
the question asked before the mutation and the rebuild asked for after it, which
is what `relightAll()` is now for. It is additive to the extension API; `relight`
is unchanged.

**Smaller things, all of them things you would meet.** Clicking a stamp with the
Select tool pushed a `Move` entry that moved nothing — at 32 slots, clicking
around pushed real steps off the bottom of the stack. Its undo used
`Object.assign(grabbed, before)`, which puts the *snapshot's own* `points` array
back on the item, so the next drag rewrote a snapshot the history was still
holding; both sides deep-copy now. Every eraser stroke read "Paint" in the
History panel, because `LABELS[op.t]` always won and the `op.erase` branch after
it was unreachable. The Light tool's Bright and Dim sliders declared `rerender`
without `commit`, and a rerender rebuilds the panel — so the first pixel of a
drag destroyed the slider being dragged, and you had to click again for every
step; the colour beside them had it worse, and `field()` honoured `commit` for
ranges only, which it no longer does. The grid Cell size slider ran a full
`invalidate` plus a whole-document composite plus a panel rebuild on every input
event, which on a hex map at small sizes is tens of thousands of hexes a frame;
it and the paper Vignette and Border sliders now wait for the release, like
every slider around them already did.

**Tests.** Nineteen new assertions — nine in `guards.mjs`, ten in `regress.mjs`
— taking the total to 258. All of them were run against a pristine clone of
`origin/main` to prove they catch what they claim: seven of the ten browser
checks and eight of the nine socket checks fail there. The three that pass on
both trees are kept deliberately and are not comfort — each is the precondition
its neighbour is measured against ("the eraser takes the paint off" is what
makes "and it showed while the button was down" mean anything), and each would
fail if a fix over-corrected. Two draft checks were thrown away rather than
kept: one asserted `past.length > 1` after a sequence that leaves exactly one
entry by construction, and one measured alpha where the parchment underneath is
opaque and the value cannot move. A check that cannot fail is worse than no
check.

**Found by reading and written up rather than changed.** The review turned up
more than could honestly be fixed and tested in one day, and a fix nobody has
reproduced is a guess. The full list is in section 13 of the hand-off doc, split
into what was reproduced and what was only read. The ones worth naming here:
*Rescan* clears the decoded images without re-warming them, so the open map goes
on looking right until the next stroke rebuilds a layer and the terrain repaints
as flat grey; deleting the map that is currently open leaves `app.dirty` false,
so the editor says "saved" about a map that no longer exists anywhere; the
Import dialog's **Group** field is collected, sent, echoed back and then thrown
away, so it does nothing at all; `packs.import_asset` and `unique_slug` still do
exists-then-open on a threaded server, which is the race `/api/export` was fixed
for; `config.json` is a read-modify-write with no lock and a truncating write,
so two extension toggles at once can lose one or corrupt the file; and a saved
map holding a layer kind from an extension that is switched off throws on open,
because `LAYER_KINDS[l.kind].paint` is dereferenced without a guard.

**No feature today, deliberately.** Step one of the routine says that a second
day's changes piled on an unreviewed first day make the diff unreviewable, and
that reasoning does not stop applying just because both days are mine. The
production diff is about 145 lines across seven files, one of them a remotely
reachable hole that Anthony should be able to read, understand and land without
a feature sitting on top of it. The research was done anyway, so tomorrow does
not start from a blank page. Three candidates, each checked against the three
tests:

- **Region layer.** Shade a kingdom, name it, give it a colour and a border.
  Azgaar, Inkarnate and Wonderdraft all have some form of it; Cartograph has no
  `regions` layer at all, and the region-map half of the program has had the
  least attention of the three. Pure canvas, a new layer kind and tool, labels
  already exist. My pick.
- **Map pins and notes.** A numbered pin carrying a title and a body, listed in
  the side rail, exported as a readable key beside the image. Every VTT has it
  and LegendKeeper sells on it. Notes are text in `project.json`, which is as
  local-first as it gets.
- **Print tiling.** Export a large map across several pages with overlap and
  crop marks — the thing people actually do with a battle map. Canvas plus the
  PNG encoder we already have.

Elevation stays parked. It is still the honest gap, and it is still a piece of
design rather than an addition: it interacts with the coastline, the lighting
and the shelf all at once.

**Tests:** 82 verify, 29 lighting, 27 hex, 24 pro, 25 guards, 23 regress, 16
ext, 16 theme, 8 labels, 8 brushes — 258 assertions, all passing, plus `battle`,
over two full back-to-back rounds.

---

## 2026-09-21 (later) — a review day: the guards, and state that drifted

No feature today. The code review turned up enough real defects, one of them
serious, that shipping a feature on top would have made the diff unreviewable —
and the first bug below is the kind you fix the day you find it.

**The Origin guard could be walked straight past.** `_handle` refused a
cross-origin request *before* reading its body, and this is a keep-alive server
with `protocol_version = "HTTP/1.1"`. The body therefore stayed on the socket,
and the next thing the parser read was the attacker's bytes — as a brand new
request, with no `Origin` on it, which sailed through the check the first one
had just failed. `fetch(url, {mode:'no-cors', headers:{'Content-Type':'text/plain'}, body: raw})`
sends exactly that with no preflight, so any page the user had open could reach
every mutating endpoint: delete a map, write into `exports/`, call
`/api/open-folder`, shut the server down. Reproduced on the running program
before and after. The 413 path and `do_OPTIONS` had the same hole, and
`Transfer-Encoding: chunked` was not handled at all, so a chunked body was
treated as empty and its bytes left behind too. Every refusal now hangs up
instead of replying and reading on, chunked is refused with a 411, and the
Origin check covers GET as well — no GET handler has a side effect, but a guard
with a hole in it is a guard nobody can reason about.

Two more things on that path answered with nothing at all: a `Content-Length`
that was not a number raised out of `_read_body`, and a NUL byte in a static
path reached `os.path.realpath`, which raises `ValueError` rather than anything
the callers catch. A negative `Content-Length` was worse than either — it
reached `rfile.read(-1)`, which blocks until the peer closes, so a handful of
open sockets held a thread each indefinitely. All three answer properly now.

**Every layer blob was deleted on every save.** The sweep kept
`[l["id"] for l in layers if l.get("raster")]` — and no layer has ever had a
`raster` property, because `raster` is a layer *kind*. The keep list was
therefore always empty and `sweep_blobs` removed every PNG under
`projects/<map>/layers/`. Nothing in the shipped editor calls `writeLayer`,
which is the only reason this had not bitten yet; any extension importing
pixels would have lost them at the next autosave, silently, fifteen seconds
later. Every layer still in the document now keeps its blob, and a layer with
no `id` no longer 500s a save that had already half-committed.

**Shadows did not follow the walls by every route.** `invalidate()` was doing
its job, but two routes went round it. Clicking the eye on the Walls layer, or
*Hide Walls* in the palette, composited and nothing else — so the shadows of a
wall nobody could see stayed exactly where they were until something unrelated
forced a relight, at which point the map changed under you. And `wallSegments`
read `layer.visible` directly instead of `layerVisible()`, so putting the walls
in a group and hiding the group left them stopping light they were no longer
drawing — that one survived a correct relight, because the source of truth
itself was wrong. There is now a `relight(layer)` in render.js that both the
eye and `invalidate` go through, and it covers a group holding a walls layer as
well as the layer itself. It composites the whole map rather than the caller's
box, because a shadow reaches as far as the light that casts it.

`toUVTT`, `ambientArgb`, the export dialog and `hitTest` read `layer.visible`
directly too. The first three meant the picture and the data in one export
disagreed about whether the lighting existed; the last meant you could select,
drag and delete stamps on a layer you had folded away and hidden.

**The grid and the paper applied their own opacity twice.** Both baked
`layer.opacity` into their offscreen canvas, and `compositeAll` then applied
`layerAlpha` to the same canvas — so a battle grid set to 34% drew at 12%, and
the Opacity slider moved one of the two factors while a reload rebuilt both.
The map did not come back the way it was put away, which is invariant (a). The
bake is gone; the opacity belongs to `compositeAll` alone. **This changes how
existing maps look**: a battle grid comes out at the 34% the panel always
claimed rather than 12%, and the parchment at 42% rather than 18%. Both
screenshots are worth a look before/after — on the old rendering the grid on a
battle map was very nearly invisible, which cannot have been the intent, so
this reads as the bug having hidden the design rather than the fix changing it.

**Undo left things behind.** Drawing a wall writes `thickness` onto the layer,
which restyles every wall already on it, and the history entry restored only
the op list — so drawing one wall at 20 and undoing it left the other five at
20 with no step that could put them back. Placing the first light sets
`layer.visible = true` and the undo restored ops and ambient but not that, so
undoing a light on a deliberately-hidden lighting layer plunged the map into
darkness it had never been in. Both entries now carry what they change.

**Smaller things.** Deleting a layer left its offscreen canvases in
`layerCanvases` forever — about 12.6 MB a time at the default map size — so
there is a `forgetLayer(id)` now. `saveProject` cleared the dirty flag after
three round trips and a PNG encode, discarding anything painted while the save
was in flight and marking it clean, so autosave skipped it and `beforeunload`
did not warn; it now compares an edit counter across its own awaits. Undo and
redo marked the document dirty without rearming the autosave timer, so an undo
after the last autosave had fired left the map unsaved for good. *Rescan*
cleared the pattern cache but not the image cache the patterns are built from,
so replacing a file on disk under a name the library already knew went on
drawing the old picture until a page reload. Layer names were interpolated into
`innerHTML` in the tool panel — names come out of `project.json`, so with the
Origin hole above that was one-shot CSRF turning into script execution in the
app's own origin. A malformed `pack.json` or `extension.json` that was valid
JSON but the wrong shape (a bare list, say) took out the whole `/api/packs` or
`/api/extensions` call, so one bad file emptied the library. Concurrent exports
raced between `os.path.exists` and `open`, and one overwrote another — proved
with six at once, which produced five files. `unique_slug` appended " 2" past
the 64 characters `slug()` allows, so saving a long-named map was refused by
our own validator. And `--port` and `--verbose`, and the free port picked when
the pinned one was busy, were all written back into `config.json`, so a single
debugging session became a permanent setting.

**One thing deliberately not claimed as a fix.** `scratch()` did not reset the
canvas transform, and `applySoften` left a `translate` on the mask canvas it
borrowed from the pool, so by inspection two soften strokes of the same box
size share a canvas with a stale transform on it. Both are now put right — the
pool's contract is that you get a cleared canvas with an identity transform,
and it is now true. But no arrangement of strokes could be found that rendered
so much as one channel differently, on the unfixed build, with the fix, in
either order, through `rebuildLayer` or by calling `applySoften` directly. So
it is hardening with an unproven symptom, not a bug that was biting anybody.

**Two things found and written up rather than changed.** Opening a project
replaces `app.doc` outright without consulting `app.dirty`: `beforeunload`
guards closing the tab, nothing guards double-clicking a card in the Projects
tab, and ten minutes of painting goes with no dialog. The fix is a confirm, but
which buttons it offers ("Save and open"?) is a design decision rather than a
defect fix, so it is left for a day that can make it. Separately, if the map
that was open is deleted from disk, the editor throws on boot and never comes
up — seen while testing, not chased down.

**Tests.** Two new suites. `test/guards.mjs` (16) drives the server over raw
sockets with no browser at all, because everything it checks is about byte
order on the wire; 10 of its 16 fail against the unfixed code. `test/regress.mjs`
(13) is the browser half — the relight routes, the group veto, the VTT
agreement, both undo entries and the opacity round trip; 6 of its 13 checks
fail against the unfixed code. Both were run against a pristine clone of
`origin/main` to prove they catch what they claim to, which is how the soften
check above came to be dropped rather than kept as false comfort.

**Tests:** 82 verify, 29 lighting, 27 hex, 24 pro, 16 ext, 16 theme, 16 guards,
13 regress, 8 labels, 8 brushes — 239 assertions, all passing, plus `battle`
and `demo`, over two full back-to-back rounds.

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
