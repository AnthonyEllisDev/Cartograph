# Daily log

One entry per working day. The daily maintenance run reads this before it
starts, so it knows what has already been done and does not do it twice.

---

## 2026-10-07 -- caverns, the underground art, and five things the review found

Anthony's working copy matched `origin/main` byte for byte across the 87
tracked text files, and the two screenshots by size. (The one difference on
first compare was this run's own `npm install` bumping Playwright in the
clone's `package.json`, put back before anything else.) A feature day.

**Baseline: green.** 872 of 872, plus `battle`, against the working tree.

**Review.** Two readers, reading only, each reproducing on its own clone and
port: one on the renderer, lighting, printing, transforms, the generators and
the art pipeline; one on the server and the front-end state. `node --check`
passed on every module and the non-ASCII scan found nothing outside comments,
docstrings and UI strings. The Origin and Host checks are in place, every early
return in `_handle` goes through `_refuse`, every client path through
`safe.py`. Five findings fixed, each with a check in `regress.mjs` (129 -> 135;
all five fail against a pristine clone, the sixth -- *and reloads at that
width* -- is kept as the precondition of the one before it and passes there):

- *A pen held at one pressure painted at the full brush width.* `endPaint`
  drops a uniform `widths` array and left `op.size` at the slider, so a stylus
  at a steady 0.3 asking for 44 px drew 120 px, live and committed. The size
  now becomes that width when the array goes (and `livePaintOp` does the same
  for the preview). The width never exceeds `op.size`, so this only narrows the
  stroke and every box measured from it. Mouse strokes are unchanged.
- *Rescan left the open map unable to redraw its own textures.* It emptied the
  decoded images and decoded nothing again; the screen survived until the next
  rebuild of any layer drew the terrain flat grey. Written up on 2026-09-22 and
  reproduced today. Rescan now re-warms what the map uses and redraws it.
- *A `tileSize` in config.json that is not a number stopped the program* before
  the server bound (`int("large")`). It is now held to the same bounds as a size
  read back from a baked pack, else 256.
- *A `pack.json` saved with a byte-order mark was rebaked from the config's
  seed*, because `ensure_starter_pack` read it with `json.load`, not
  `safe.load`. With a different seed in config that changes every map's art.
- *The dungeon dialog asked about one walls layer and replaced another.* With
  the first walls layer locked, "Walls already drawn" described the locked
  layer while `commitDungeon` replaced the first unlocked one. It asks about the
  unlocked one now.

Written up, not changed: **opening a map or making a new one discards unsaved
work without asking** (reproduced: a never-saved map with a stroke on it is
gone after Open on another card). This was already in the hand-off's
deliberately-not-fixed list as a design question -- which buttons the prompt
offers -- and it is still that; but it is the one finding today that loses work,
so it is worth Anthony's decision soon. Also still open: the Import dialog's
Group field is ignored; `wallSegments`/`toUVTT`/`playersLights` read only the
first walls layer (reachable only by hand-editing a file); Ctrl+S/E/P/N do not
check `modalOpen()`.

**The feature: caverns.** *Generate dungeon...* has a new first setting, *Dig
out*: **Rooms and corridors** (what it always did, and the default) or
**Caverns**. A cave is grown on a lattice of two points to the grid cell by a
cellular automaton (noise, then five passes of a 3 x 3 majority), every pocket
worth keeping is tunnelled to the biggest so all of it can be walked to, and
the outline is smoothed once and traced with the land generator's marching
squares (`traceRings`, `simplifyRing` and `ringArea` are exported from
`generate.js` for it). It writes what a dungeon writes -- a floor op with
rings, the shaded rock, wall ops (one closed run per outline, so a pillar of
rock is one wall) and a numbered note per chamber, the chambers being the
widest places, kept apart, numbered from the bottom by nearest neighbour. So
shadows, hatching, the VTT export, the players' copy, undo and replace all
came for free. The dialog hides the room settings for a cave and shows
*Hollow*; choosing Caverns lays the cave floor unless a floor was picked.
`isDungeonOp` and `commitDungeon` are unchanged; settings remembered from
before have no style and mean rooms. No extension API change.

Why this: today's art had to be somewhere to go, and the generator only made
buildings. Watabou's Cave/Glade generator, Roll20's new random dungeon and the
cave packs people buy for Dungeondraft all say the same: caves are half of
what is underground, and Cartograph could not make one without drawing every
wall by hand. It was on the hand-off's candidate list. Rejected today: making
`registerExporter` work (real, small, and still worth a day of its own);
elevation (a design, not a day); the unsaved-work prompt (a product decision).

**The art (version 3).** Three textures -- **Cave Floor** (group *floor*),
**Underground Pool** (*water*) and **Lava Flow** (*floor*; a wrapping Worley
field read the other way round from the cobbles, the joints the bright part,
heat bleeding into the crust beside them) -- and eight symbols in a new group,
*underground*, three variants each, drawn from above at the furnishings' five
feet to seventy pixels: pillar, stalagmites, rubble, campfire, altar, stairs
down, brazier, cave mushrooms. `ART_VERSION` 2 -> 3. Baked old and new side by
side at the same seed and size: all 105 files the old generators wrote are
byte-identical and every old manifest entry is unchanged.

**Tests.** A new suite, `test/caverns.mjs` (25): the dialog's settings for each
kind, what a cave writes, its walls closed and off the grid, every chamber's
pin on the floor, the cave in one piece, the same seed the same cave, Hollow
doing what it says, rooms unchanged, the walls casting shadows (and lifting
them when hidden), one undo step, the round trip pixel-identical, and the
underground art in the library, tiling, painted and placed through the real
tools. `regress` 129 -> 135.

Looked at: a contact sheet of the three textures in 2 x 2 repeat and all 24
symbol variants (the first rubble was too pale and the first lava too bright;
both tuned before shipping), the dialog at 1600 x 1000 with Caverns chosen, a
40 x 30 cavern in the cave floor, a hatched 30 x 20 cavern lit by four lights
in its chambers (shadows stop at the cave walls; the relight took 55 ms), and
every new symbol placed on a battle map beside a stroke of lava.

**Tests:** 82 verify, 37 props, 29 lighting, 27 hex, 25 pro, 25 regions, 17 ext,
16 theme, 66 guards, 135 regress, 8 labels, 8 brushes, 27 generate, 36 notes,
34 dungeon, 40 clipboard, 43 selection, 41 prefabs, 52 transform, 32 hatch,
29 print, 31 players, 21 setedit, 17 art, 25 caverns -- 903 checks, all
passing, plus `battle`, over two full back-to-back rounds on the finished
tree, with `CG_CHROME` pointed at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.

Anthony's pack has `artVersion` 2, so his next launch prints "Adding the new
art to the starter pack" and takes about fifteen seconds once. What is left
for caverns, if anyone asks: water and lava pools laid in the low chambers,
stalagmites scattered on the floor, and a mixed dungeon (rooms opening off a
cave).

---

## 2026-10-06 -- floors and furnishings, and nine things the review found

Anthony's working copy matched `origin/main` byte for byte across all 88
tracked non-`.pyc` files, so this was a feature day. The `.pyc` files are still
tracked, though `.gitignore` names them; `git rm --cached` would end that.

**Baseline: green.** 846 of 846, plus `battle`, against the working tree.

**From today the run also adds art.** Anthony's note on the scheduled prompt
asks for three new textures and eight new stamps every day. The pack was baked
once on first launch and never again, so art added to the generators would
have reached nobody who had already run the program. That had to be fixed
first, and it is the day's feature (below). The rules for adding art are now in
`ASSETS.md` under *Adding to the generated art*: add, never change; every recipe
on its own random stream; no id ending in `-<number>`.

**Review.** Two readers, reading only, each on its own copy and port: one on
the renderer, lighting, printing, transforms, the dungeon and land generators;
one on the server, `tools/` and the front-end state. `node --check` passed on
every module and the non-ASCII scan found nothing outside comments, docstrings
and UI strings. Origin and Host checks are in place; every client path still
goes through `safe.py`. Nine findings; seven were fixed, each with a check in
`regress.mjs` (nine checks), and every one of those checks fails against a
pristine clone on its own port (the create race only once the body is heavy
enough for the requests to overlap, which is how the check is written):

- *The coast's ink was missing past a grid line until a reload.* `growInk`
  regrew the ring only inside the stroke's reach snapped to `SHELF_GRID`, but
  the ring stands up to `inkWidth` outside the mask. A stroke ending a few
  pixels short of a grid line left the new ring beyond it out of the cache (340
  pixels at width 12). The dirty box is grown by the ring's radius before it is
  snapped. Undo goes through the same function.
- *The Scatter brush cut dabs off along a straight line.* `opBox` measured a
  dabs op with `strokeBox`, but a dab lands up to half the jitter off the path,
  is up to `0.4 * size * (1 + sizeJitter)` across and is then blurred: at the
  tool's defaults up to 1,810 pixels of a stroke were sliced away, on screen and
  on reload alike. `dabsBox` measures dabMask's own reach, and the live stroke
  uses it. **A saved map with Scatter strokes near their edges draws the
  missing dabs once reopened** -- a one-time change, towards what was painted.
- *Two assets in one pack could share an id.* The id is the pack and the stem,
  so `rock.png` imported as a stamp and again as a texture -- or `forest/rock`
  beside `desert/rock` in a dropped-in folder -- were two files with one id,
  and the editor's lookup kept the last: picking the stamp drew the texture. An
  import now skips any stem already used in the pack under any extension, and a
  loose pack gives a second file of the same name an id from its path (the
  first keeps the plain id, so maps that use it still find it).
- *Two creates of one map name at once wrote into one folder.* `unique_slug`
  checked and `write` made the folder later; the second save overwrote the
  first and both were told it had worked. The folder is now claimed with
  `os.mkdir` in the same step that finds it free, and removed again if the
  document is then refused.
- *An extension whose setup threw halfway could not be removed.* What it had
  registered stayed, and nothing recorded it, so unticking it found nothing.
  `loadOne` now records it and unloads it at once.
- *A long map name made the players' copy look like a GM file.* The server
  keeps 64 characters of a name, and a 70-character map lost `-players` to it.
  Export and Print cut the map's name to 40 characters before any suffix.
- *`--host` with any other address refused every request with 421.* The
  allowed Host and Origin lists only ever held 127.0.0.1 and localhost; the
  address bound is now added (bracketed for IPv6). The wildcards add nothing.

Written up, not changed: a "(mixed)" select in the set panel shows the
primary's value, and choosing that same value fires no `change` in a real
browser, so it never reaches the rest of the set (Playwright always fires
`change`, so this is reasoned, not reproduced; a blank "(mixed)" option would
fix it). And the coastline settings in the Layers panel -- ink, widths, shelf
colours -- are not on the undo stack. Neither are the other layer settings, so
that is a design question rather than a slip.

**The feature: the starter pack grows, and the first of it.** Three things:

- `ART_VERSION` in `tools/genpack.py`, written into the pack's `pack.json`.
  `ensure_starter_pack` rebakes a pack whose version is older (or whose
  `pack.json` does not parse) from the seed and tile size recorded in it, not
  today's settings. Baked old and new side by side: all 78 files the old
  generators wrote are byte-identical, and every manifest entry is unchanged.
- Three floor textures, group *floor*: **flagstones** (courses of dressed
  slabs, the joints staggered and wobbled by a wrapping field), **wooden
  floorboards** (sixteen boards to the tile, sawn to random lengths, grain
  from a sine bent by noise, nails either side of every joint) and
  **cobblestones** (a wrapping Worley field, F2 - F1 for the mortar, each
  stone domed and lit from the north-west). All three are built rather than
  noised, and wrap by construction.
- Eight furnishings, group *furnishing*, in three variants each: barrel, crate,
  table, bed, chest, bookshelf, rug, well. Drawn from above at five feet to
  seventy pixels, in the pack's ink palette, with three timbers and five cloths
  to vary them.

Why this: the brief asked for art, and every texture and symbol in the pack
was overland -- the Floor layer of a battle map defaulted to bare rock and the
dungeon generator to parchment, because there was nothing else. Dungeondraft's
library is floors and furniture first; Cartograph had none. Without the
rebake, the art would not have reached Anthony's own copy. Rejected for the
art: anything downloaded (constraint 3), and changing the battle map's default
floor from rock to flagstones -- a product decision, left for Anthony.

**Tests.** A new suite, `test/art.mjs` (17): the rebake in a temporary folder
through the real `ensure_starter_pack` (an old pack rebaked keeping its seed
and size, a current one left alone, a broken `pack.json` rebaked), a bake
repeatable byte for byte; then in the browser the new textures and stamps in
the library, each texture's wrap no worse than its worst interior joint, the
Floor layer laid in flagstones from the Layers panel, the dungeon dialog
offering all three floors, a stroke in floorboards and every furnishing placed
through the real tools, the round trip, no request off 127.0.0.1, no console
errors. `regress` 120 -> 129.

Looked at: a 2x2 repeat of each texture for seams, a sheet of all 24 furniture
variants, and the editor with a flagstone floor, a band of floorboards and one
of each furnishing on it.

**Tests:** 82 verify, 37 props, 29 lighting, 27 hex, 25 pro, 25 regions, 17 ext,
16 theme, 66 guards, 129 regress, 8 labels, 8 brushes, 27 generate, 36 notes,
34 dungeon, 40 clipboard, 43 selection, 41 prefabs, 52 transform, 32 hatch,
29 print, 31 players, 21 setedit, 17 art -- 872 checks, all passing, plus
`battle`, over two full back-to-back rounds on the finished tree, with
`CG_CHROME` pointed at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.
Anthony's existing starter pack has no `artVersion`, so his next launch prints
"Adding the new art to the starter pack" and takes about fifteen seconds once.

---

## 2026-10-05 — editing a set, and ten things the review found

Anthony's working copy matched `origin/main` byte for byte across all 87
tracked non-`.pyc` files, and nothing untracked sat beside the sources, so
this was a feature day. The `.pyc` files are still tracked.

**Baseline: green.** 815 of 815, plus `battle`, against the working tree. (The
counts in the scheduled prompt are older than the suites; these are the
current ones.)

**Review.** Two readers, reading only, each reproducing on its own copy and
port: one on the renderer, lighting, printing, `transform.js`, the hatching and
the players' copy; one on the server and the front-end state. `node --check`
passed on every module and the non-ASCII scan found nothing outside comments,
docstrings and UI strings. The server was re-probed over raw sockets (smuggled
second request on both branches, foreign Host, chunked, disagreeing and huge
Content-Length, OPTIONS with a body, traversal through every path-taking
endpoint, NUL in the path, non-object and NaN bodies) and held everywhere. One
hardening note, not a defect: an empty `Transfer-Encoding:` header passes the
check, since `headers.get` returns `""`; it matters only behind a proxy.

Ten findings were fixed. Each has a check in `regress.mjs`, and all ten were
run against a pristine clone on its own port and fail there (the last as an
equivalent probe script, the other nine as the checks themselves):

- *The players' copy drew the hidden walls in shadow.* A walls layer marked GM
  only was left out of the players' picture, but the lighting was the GM's,
  cast against those walls, so the darkness drew a hard-edged shape exactly
  where they were (416,619 pixels against the same map with the walls really
  gone). `wallSegments(doc, { players })` returns none for a GM-only walls
  layer, and `playersCanvas` relights such a map for the copy, cached as the
  walls canvas is. Export's PNG and Print's PDF both had it; the `.dd2vtt` did
  not (its image is unlit and its walls were already left out).
- *Export drew the players' copy from whatever was on screen by then.* Every
  picture after the first was drawn after an upload, and the window is live,
  so opening another map while a large GM image went up wrote that map as
  `<this map>-players.png`. The same race Print was closed against yesterday.
  Every picture and both tabletop payloads are now drawn before the first
  await.
- *A wall round the whole frame brought back the hatched front room.*
  Yesterday's fallback seeded the walk from the regions just inside such a
  wall but never counted them as framed, so a door in a room's outside wall
  cost nothing again and the room behind it was hatched as rock (14,161 ink
  pixels inside it). The fallback is worked out before the links and marks
  what it seeds. Maps with any open edge are untouched.
- *Dragging a walls layer past another in the Layers panel did not relight.*
  Shadows come from the first walls layer; `moveLayer` and `moveGroup` only
  composited, so the screen kept the old shadows and a reload drew new ones
  (58,827 pixels at half scale). A second walls layer is easy to get without
  an extension: lock the walls and generate a dungeon. Both now go through
  `restacked()`, which relights when a walls layer moved.
- *Export hid "Include the lighting" when the darkness was nought*, though
  lamps still draw their pools without it -- the rule fixed in Print yesterday,
  left in Export. Same rule now.
- *The GM's `.dd2vtt` took the bare map name* while the image beside it had
  been numbered, so the second export's tabletop file sat beside the first
  export's picture. It is named from the image actually written, as the key and
  the players' files already were.
- *Space over the map, with a panel switch still focused, went to the switch.*
  Click *Locked* or any tool toggle and the focus stays on it; Space then never
  started a pan, the drag painted a stroke, and the key toggled the switch.
  Space over the map now pans and takes the focus off a switch, range or
  colour control; a text box keeps it.
- *Changing the autosave interval left a pending deadline where it was.* 900
  turned down to 15 still waited out the 900. `rescheduleAutosave()` in
  `app.js` re-arms from now.
- *Deleting the open map left the top bar saying "saved".* It says "not saved
  yet" now. Whether to mark such a map dirty, or warn on closing, is left as a
  decision.
- *A saved map reopened at launch said "not saved yet".* Found in today's
  screenshot, not by the readers. `markDirty(false)` emits only when the flag
  moves, and a clean open moves nothing, so the label kept the page's initial
  text (or the previous map's). `openDocument` emits it.

**The feature: editing a set.** When everything the Select tool holds is one
kind of thing, the Selected panel now offers the fields they share, and a
change goes to all of them as one step: six torches turned blue, a corridor of
doors made secret, every village label set in one size. A field the things
disagree on is marked "(mixed)" and shows the primary's value. Left out: a
label's wording, a region's name, a note's title and text (one value across six
things is six copies of one name), and a stamp's angle, which the Turn buttons
already do for the set about its middle. A mixed set offers no fields, as
before.

Why this one: it has been on the candidate list since the selection set landed
on 2026-09-29 and was passed over each day as smaller than the day's choice;
with sets, prefabs and turning all done, it is the obvious gap in that line of
work. Dungeondraft's Select tool edits a multi-selection's shared properties
(Encounter Library's guide to its object tools and select tool), and in
Cartograph the only way to recolour a row of torches was one at a time. It
passes the three tests: not there (`renderSetSummary` said, in so many words,
that it offered no fields); no dependency; and squarely a one-person-at-a-desk
thing. Rejected today: caverns for the dungeon generator (bigger, and wants its
own day), making `registerExporter` work, prefab rescaling, hatching across
all walls layers, and elevation (still a design rather than an addition).

How it is built: `setFields(set)` in `ui.js` takes the kind's `OBJECT_FIELDS`
row for every thing held, drops `SET_SKIP`, and marks a field mixed where the
values differ; `editSet(set, key, value)` is `editObject` across the lot --
deep copies both ways, nothing pushed when nothing moved, keys a snapshot
lacks taken off on undo (a torch with no colour of its own gets none back),
one entry named "Edit 3 lights", and every layer touched rebuilt through
`invalidateAll`, walls last, so turning walls into windows relights. Unlike a
single edit it re-renders the panel at once, since no field offered for a set
takes typing and the "(mixed)" marks have to come off. A light's radii are set
in map units and stored in pixels, as for one light. `API_VERSION` stays 1;
nothing in `api.tools` changed.

**Tests.** A new suite, `test/setedit.mjs` (21), on its own map, picking things
up with a box dragged on empty map: the shared fields offered and the mixed
mark; one change reaching every torch held and nothing else, as one step; a
radius in feet stored as pixels; undo giving each its own colour back and
taking one off the torch that had none; redo; the screen after both matching a
rebuild; a no-op change pushing nothing; a mixed set offering nothing; three
walls made windows in one step and the light reaching past them (32 -> 137
brightness); labels offered no wording and sized together; the round trip; no
request off 127.0.0.1; no console errors. `regress` 110 -> 120.

Looked at in a screenshot: three torches held and turned blue, the panel with
its shared fields under the count, the windows letting the lamp below through.

**Tests:** 82 verify, 37 props, 29 lighting, 27 hex, 25 pro, 25 regions, 17 ext,
16 theme, 66 guards, 120 regress, 8 labels, 8 brushes, 27 generate, 36 notes,
34 dungeon, 40 clipboard, 43 selection, 41 prefabs, 52 transform, 32 hatch,
29 print, 31 players, 21 setedit -- 846 checks, all passing, plus `battle`,
over two full back-to-back rounds on the finished tree, with `CG_CHROME`
pointed at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` as before.

---

## 2026-10-04 — the players' copy, and eight things the review found

Anthony's working copy matched `origin/main` byte for byte across all 84
tracked text files (the two screenshots and the tracked `.pyc` files were not
compared), so this was a feature day. The `.pyc` files are still tracked; that
still needs `git rm --cached` from Anthony.

**Baseline: green.** 777 of 777, plus `battle`. Most of it ran against the
working tree; the last eight suites were run against a pristine clone on its
own port, because the first hatching fix landed in the working tree while the
baseline was still running against it.

**Review.** Two readers, reading only, each reproducing on its own copy and
port. One covered the renderer, printing, `pdf.js`, lighting, `transform.js`,
`dungeon.js` and the hatching. The other covered the server and the front-end
state. `node --check` passed on every module, and the non-ASCII scan found
nothing outside comments, docstrings and UI strings. The server's guards
(Origin, Host, refuse-before-route, `safe.py` on every path, `safe.load` on
every body) were re-read and found sound.

Six findings were fixed. Each has a check that fails on a pristine clone:

- *A print drew each sheet from whatever was on screen at that moment.*
  `buildPrint` takes a document, but every sheet comes from `R.flatten`, which
  reads `view.doc`, and the window stays live between sheets. Opening another
  map 30 ms into an 18-sheet print gave a 248 KB PDF instead of 1.2 MB, most
  of it the other map, under the first one's name. A stroke painted during a
  long print mixed before and after the same way. The build now stops with
  "the map changed while it was being drawn" if the map on screen or
  `app.edits` moves while it runs (`print.mjs`).
- *The Print dialog could leave the lighting out unseen.* Its switch showed only
  when the darkness was above nought, but lights still draw their pools without
  it, and with no switch shown the setting left from an earlier print decided
  it. The switch now shows for any visible lighting layer with lights in it, and
  when it is not shown the lighting is printed (`print.mjs`).
- *A wall all the way round the frame took the hatching off the whole map.*
  The walk starts from regions touching the edge of the map, and there were
  none, so every region came out unreached, which the parity test reads as
  floor. When the edge is entirely wall, the regions just inside it now start
  the walk instead, as if the wall were the map's edge. Maps with any open
  edge are untouched, so every saved map draws as before. The comment that
  said an unreached region is rock was wrong, and now says what the code does
  (`hatch.mjs`, +2; "and the room inside it clean" passes on the pristine clone
  too and is kept on purpose, as the guard against seeding at the wrong parity).
- *A tool letter pressed with the button down lost the work.* The release went
  to the new tool. A Select drag moved the wall with no undo entry and no dirty
  flag, and a brush stroke never reached `endPaint`, so it stayed on screen and
  was not in the map. Tool letters now wait while a drag or a pan is in
  progress (`regress.mjs`).
- *Turning autosave off did not stop an autosave already due.* It saved over
  the map regardless, which is exactly what someone unticking it before
  something risky does not want. The deadline checks the setting when it
  fires, and the checkbox clears it (and, turned back on, arms one if there is
  unsaved work, which closes the 2026-09-26 note that it waited for the next
  edit) (`regress.mjs`).
- *Dragging a group row left its members behind.* Already written up on
  2026-09-26. `moveGroup` in `ui.js` now moves the group and its members as one
  block, beside the target's whole run, never into another group's
  (`regress.mjs`).

Written up, not changed:

- *An extension whose manifest id is not slug-shaped cannot be turned off*
  (`acme:tokens`, `@acme/tokens`): `index()` accepts any string and keys
  `enabled` on it, and `POST /api/extensions/<id>` refuses it with a 400. The
  handoff already listed this. The fix (fall back to the folder name, or key on
  `dir`) changes the ids of tools registered under it, so it wants deciding.
- Ctrl+S/E/P/N in `main.js` do not check `modalOpen()`, so Ctrl+E over the Note
  tool's dialog cancels the note. Settled safely (that is `modal()`'s
  contract), so small.

**The feature: the players' copy.** Export can write a second image, and Print
a second PDF, of the map as the players are meant to see it:

- secret doors drawn as plain wall;
- note pins left off;
- every layer marked **GM only** left out. The switch is in each layer's
  properties; a group marked GM only takes its members with it
  (`layerGM(doc, layer)` in `doc.js`, read the way `layerVisible` is), and the
  layer row carries a **GM** badge. Marking is one undo step.

The dialogs say what the copy will change before it is made. Export writes
`<map>-players.png` beside the GM's image, named from the file the server
actually wrote, as the key is, and, with Universal VTT ticked,
`<map>-players.dd2vtt`, where a secret door goes across as a sight line rather
than a portal so the tabletop does not show players a door icon. Print writes
`<map> - players - print.pdf` with "(players' copy)" on every sheet.

Why this one: "GM versus player export, the rest of it" has been on the
candidate list since 2026-09-24, was called small and more useful once
generated dungeons had secret doors, and yesterday's printing made it more
useful again: a dungeon printed for the table with its secret doors dashed in
is printed twice. Forum threads (Roll20, Paizo) still ask how to get a player
map with the secret doors taken out; how each comparable tool handles it was
not checked one by one. It passes the three tests:

- *Not there.* Nothing in the code had a GM flag or a second rendering; hiding
  the notes layer was the whole of it.
- *No dependency.* It is a flag on a layer and a branch in `flatten`.
- *Fits.* One person at a desk making the table's copy and their own.

Rejected today: hatching across all walls layers and the hand-inked wall line
(polish), `registerExporter`, prefab rescaling, and elevation (still a design,
not an addition).

How it is built:

- **Nothing is stored but the flag.** The players' copy is made at export from
  the same layers, so the two copies cannot drift apart. The flag changes
  nothing on screen and nothing in the GM's copy, and `players.mjs` checks both
  pixel for pixel.
- `flatten({ players: true })` skips what `forPlayers(layer)` refuses, and
  draws a walls layer holding a secret door from `playersCanvas`, which runs
  the ordinary `renderWalls` on a copy of the layer with each secret door's
  kind set to `wall` (`playersWalls`). That canvas is cached per layer on a key
  of the layer's own JSON, because a print asks for it once a sheet and the
  hatching under it is not cheap. Without `players`, `flatten` takes exactly
  the old path.
- `toUVTT(..., { players: true })` leaves out a GM-only walls or lights layer,
  as the picture does, and sends secret doors as walls.
- The hatching is the same in both copies. A secret door is a door to the walk,
  so the players' copy shows a dead-end corridor with clean floor beyond the
  wall rather than rock, which is what a player standing there would see.
- `API_VERSION` stays 1. `flatten`'s new option and `forPlayers` reach
  extensions through `api.render`, and `EXTENSIONS.md` says so.

**Tests.** A new suite, `test/players.mjs` (31), in the style of the others,
on its own map. It checks:

- the players' copy is pixel-identical to the GM's picture drawn after really
  turning the secret door into a wall and with the pins off;
- the GM-only switch: one undo step called "GM only", the GM badge, the layer
  left out of the players' copy, and the GM's copy and the screen unchanged;
- undo and redo of the mark;
- a group marking its members;
- the summary the dialogs show;
- the tabletop file: both doors as portals for the GM, the secret door as a
  wall for the players, and no walls at all from a GM-only walls layer;
- the mark surviving save and reload, and the map reloading pixel-identical;
- Export writing `-players.png` and `-players.dd2vtt` and offering both
  downloads;
- Print offering the copy, writing the players' PDF, and naming it on every
  sheet;
- nothing fetched off 127.0.0.1, and no console errors.

The fixes added checks to `regress` (+3), `print` (+2) and `hatch` (+2).

Looked at in screenshots: the layer panel with the GM switch and badge, the
Export dialog with the summary line, and a generated dungeon exported both
ways side by side, zoomed on its secret door: dashed in the GM's copy, solid
wall in the players'.

**Tests:** 82 verify, 37 props, 29 lighting, 27 hex, 25 pro, 25 regions, 17 ext,
16 theme, 66 guards, 110 regress, 8 labels, 8 brushes, 27 generate, 36 notes,
34 dungeon, 40 clipboard, 43 selection, 41 prefabs, 52 transform, 32 hatch,
29 print, 31 players -- 815 checks, all passing, plus `battle`, over two full
back-to-back rounds on the finished tree, with `CG_CHROME` pointed at
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome` as before.

---

## 2026-10-03 — printing at scale, and seven things the review found

Anthony's working copy matched `origin/main` byte for byte across all 81
tracked source files (the screenshots and the tracked `.pyc` files were not
compared), so this was a feature day. One thing noticed in passing: the ten
`server/__pycache__` and `tools/__pycache__` `.pyc` files are tracked in git
even though `.gitignore` names them. They were committed before the ignore
line, so git goes on tracking them. Nothing was done about it, because it needs
`git rm --cached`, which is Anthony's to run.

**Baseline: green.** 742 of 742, plus `battle`. The second half was run against
a pristine clone on its own port, because the first run had been serving files
that were already being edited.

**Review.** Two readers, reading only, in parallel with the baseline. One
covered the renderer, the hatching, lighting, `transform.js`, `dungeon.js` and
the walls panel. The other covered the server and the front-end state.
`node --check` passed on all 50 modules. The non-ASCII scan found nothing
outside comments and UI strings.

Seven findings were reproduced and fixed. Each has a check that fails on a
pristine clone (the hatch one hangs there instead):

- *A room with a door in its outside wall was hatched inside, as rock.* A door
  cost nothing to cross in the 0-1 walk. So a room entered from the rock through
  a front door took the outside's parity, and so did every room beyond it. A
  tavern with a front door came out hatched throughout. A door now costs a wall
  when either side of it is a region touching the frame. Between rooms it still
  costs nothing.
- *A tiny stroke length in a map file hung the tab.* The work grows with
  1/size^2, and only the panel's slider kept it at 8 or more. Probed at 0.5 it
  took 5.3 s; at 0.05 it would take minutes. The new check really did hang the
  pristine clone. Width and stroke length are now clamped to the panel's ranges
  when read, and a value that is not finite falls back to the default.
- *Importing art wrote through a dangling link out of its pack.* `exists()` is
  False for a broken link, and `open()` then followed it. Reproduced with a link
  out to `exports/`. Names are now claimed with `O_EXCL`, which refuses any
  existing name, a link included, and also closes the exists-then-open race.
- *Deleting a linked map folder deleted the map it pointed at.* `under()`
  resolves links, so `rmtree` ran on the target, which is a different map. The
  link is now unlinked and the target is left alone. The same problem for
  prefabs stays written up, as it was yesterday.
- *A prefab or paste holding a stamp this session had not decoded put down
  nothing visible.* It was saved, and it appeared after a reload. `place()` now
  warms any cold stamp and redraws when it lands, as the Stamp tool does.
- *Extension event listeners outlived their extension.* `api.events.on` was the
  bare `on`, so a switched-off extension went on hearing events, and each Reload
  added another copy of the handler. They are now owned and taken away on
  unload. This is additive, and `API_VERSION` stays 1.
- *A map save did not fsync before its rename.* After a power cut, NTFS can
  leave an empty `project.json`, which loses the whole map. This was fixed by
  reading and has no check, because it cannot be reproduced without the crash.

Written up, not changed:

- *Dragging a set that includes walls on a hatched map rebuilds all the hatching
  on every pointer move.* That is 50-250 ms a move here, so a few frames a
  second. Hatching off is 2 ms. The fix is to freeze the hatching during a
  Select drag and rebuild once at pointer-up. It touches the drag path the
  transform work depends on, so it was left for a day with room to test it.
- The Light tool's first light sets `layer.visible = true`. Put into a lights
  layer inside a hidden group, it turns on darkness nobody can see. It is a
  write, not a read, so the `layerVisible()` rule covers it only loosely.

**The feature: printing at scale.** **Print** in the top bar (Ctrl+P, or the
palette) writes a PDF that puts the map on paper at a chosen size per grid
cell, across as many sheets as it takes:

- One inch to the square by default, or 25, 30 or 20 mm, or half an inch. On a
  hex map it is one hex across the flats.
- A4, Letter, A3 or Tabloid, either way round, or whichever gives fewer sheets.
- Overlap of 0 to 15 mm between sheets, with dashed lines to lay the next sheet
  on and corner marks to cut at.
- A label on every sheet (A1, B2...), naming the sheets it goes beside.
- A scale bar on every sheet, to check with a ruler before cutting.
- An optional first page with the sheets drawn over the whole map.

It went into `exports/` and offers a download, like Export.

Why this one: print tiling has been on the candidate list since 2026-09-21 and
was put off every day for one reason, "needs a PDF writer, verified by
printing". Both are now done. The writer is `web/js/pdf.js`, about 130 lines.
It writes pages, JPEGs placed as they are (PDF takes `DCTDecode` without
re-encoding), lines and Helvetica text, which every reader carries, so nothing
is embedded. The verification was done with poppler in the container:

- `qpdf --check` is clean.
- `pdfinfo` reads 19 A4 pages.
- One sheet rendered at 150 dpi has its grid lines at 150, 150, 150, 151 and
  150 px, which is one inch.

Elsewhere the gap is real. Dungeondraft exports a picture and leaves the inch
to a poster-printing tool; there are blog posts (Dan Q's "Printing Maps from
Dungeondraft") on doing it by hand. Other tools were not checked one by one. It
passes the three tests:

- *Not there.* Nothing in the code wrote PDF or tiled.
- *No dependency.* It is canvas, `toBlob('image/jpeg')` and a byte array.
- *Fits.* It is the one-person-at-a-desk job, the step between making a battle
  map and using it.

Rejected today:

- Hatching across all walls layers, and the hand-inked wall line: polish on
  yesterday.
- GM/player export in one go: smaller.
- `registerExporter`.
- Elevation: still a design, not an addition.

How it is built:

- `render.flatten` takes an optional `rect` and draws one piece of the map.
  A 40 x 30 map at 300 dpi would be a 12000-px canvas, which browsers refuse,
  so each sheet is drawn on its own. The default path is untouched.
- `printPlan` is pure arithmetic in millimetres. Sheets step by the printable
  area less the overlap. The overlap is capped at half a sheet, so no part of
  the map lands on three sheets.
- `buildPrint` draws each sheet onto white, because a JPEG has no alpha and the
  map's transparent edges would print black. It yields between sheets.
- More than 200 sheets is refused before anything is drawn.
- Printing never touches the document or the history.
- The server's export allowlist gained `.pdf`.
- Ctrl+P is taken from the browser, whose own print would put the editor's
  toolbars on paper.

Not done: the thumbnail labels use canvas text, which looks a little different
from font to font. Also, the bar label's position is estimated from Helvetica's
average width rather than its real metrics.

**Tests.** There is a new suite, `test/print.mjs` (27). It checks:

- the sheet counts on A4 both ways and the fewest-sheets choice;
- coverage with nothing past the map, and exactly 10 mm shared between
  neighbours;
- a square printing 25.4 mm, the spreadsheet labels, abutting with no overlap,
  Letter, and the 200-sheet refusal;
- the PDF: header and trailer, every xref offset landing on its object, 19
  pages, the A4 MediaBox, the first sheet placed at exactly its millimetres,
  and nothing but ASCII outside the pictures;
- a piece of the map matching the whole (within 2 levels);
- printing leaving the map and its history alone;
- a hex map's cell measured across the flats;
- Ctrl+P opening the dialog, and the plan following the settings;
- Make the PDF writing a `.pdf` into `exports/`, plus the download and the
  palette entry;
- no request off 127.0.0.1, and no console errors.

The fixes added checks to `guards` (+3: the dangling link, and the linked map
folder twice), `hatch` (+3: the front door twice, the tiny stroke length),
`clipboard` (+1) and `ext` (+1).

Looked at in screenshots and rendered pages: the dialog on a generated
dungeon, the assembly page with its 18 labelled sheets, and sheet A1 at
150 dpi with its dashed lines, corner marks, label and bar.

**Tests:** 82 verify, 37 props, 29 lighting, 27 hex, 25 pro, 25 regions, 17 ext,
16 theme, 66 guards, 107 regress, 8 labels, 8 brushes, 27 generate, 36 notes,
34 dungeon, 40 clipboard, 43 selection, 41 prefabs, 52 transform, 30 hatch,
27 print -- 777 checks, all passing, plus `battle`, over two full back-to-back
rounds on the finished tree, with `CG_CHROME` pointed at
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome` as before.

---

## 2026-10-02 — hatching the rock, and five things the review found

Anthony's working copy matched `origin/main` byte for byte across all 80
tracked source files (the two screenshots were not compared), so this was a
feature day.

**Baseline: one red check, not a regression.** 705 of 706 passed, plus
`battle`. The one failure, `verify.mjs`'s *a custom layer kind renders through
the extension hook*, failed the same way on a rerun, so it was looked at rather
than rerun again. The check reads the pixel at the token's exact centre, which
is where the token's letter is drawn. Probed on the running program, the centre
read 164,119,114 (white glyph blended into the red), while 26 px to the left
read 181,94,94, plainly the disc. Where the fallback serif puts its stroke
depends on the fonts the machine has, so this check has been passing by luck of
the font. It now reads beside the centre. The program was not changed for it.

**Review.** Two readers in parallel, reading only, while the baseline ran: one
on the renderer, lighting, `transform.js` (new yesterday), the clipboard and
prefabs, the other on the server and front-end state. `node --check` passed on
every module, and the non-ASCII scan found nothing outside comments and
strings. Both readers found the first item below independently. Five were
reproduced and fixed, each with a check that fails on a pristine clone:

- *R pressed in the middle of a Select drag half-turned the set.* The drag
  writes every position back from its pointer-down snapshot on the next move,
  which undid the turn's positions but not a cone's `angle` or a stamp's `rot`.
  The Turn entry's "before" was a mid-drag copy, so undoing both steps left the
  set where the drag had been, not where it began. R is now eaten and ignored
  while a drag is in progress, and `transformSet` refuses one as well (for the
  palette and extensions).
- *Turning a lone round lamp, a pin or a straight label pushed an undo entry
  that changed nothing.* `pivotFor` turns a lone point-like thing about itself.
  The entry still took one of 32 slots and threw the redo stack away. There is
  now no entry when nothing moved.
- *A cone aimed by dragging lost precision on its first turn.* `angleDeg`
  rounded every angle to four places, so 22.126334809373287 came back from R
  then Shift+R as 22.1263. Now only an angle a hair from a whole degree is put
  on it; the round trip is good to 1e-9 (adding and taking away 90 can move the
  last bit of a double).
- *On Half snapping, a hex edge's midpoint drifted off the lattice when turned.*
  `settle` tried only corners and centres, so a sixth turn left a midpoint
  ~5e-7 px off the point the Wall tool snaps to. With Half snapping on, it now
  also tries `snapPoint`'s half lattice.
- *A bad port stopped the program starting.* `bind()` raises `OverflowError`
  for 70000 and `TypeError` for `"7870"` in quotes in a hand-edited
  `config.json`. Neither is an `OSError`, which is all `app.py` caught.
  Reproduced with `--port 70000`. It now says so and picks a free port.

Fixed by reading and not covered by a check: `transform.js` reused the cached
pivot after the grid or the snapping changed between two turns. The lattice is
now part of the cache key.

Written up, not changed:

- An extension whose manifest id is not slug-shaped (`@me/aging`) loads, but it
  cannot be switched off. The toggle route runs the id through `slug()`, which
  refuses it with a 400. This sits next to the known "enabled keyed on manifest
  id" item.
- The Extensions tab's Reload bypasses yesterday's `toggling` queue, so a
  Reload clicked during a toggle's import could still register an extension
  twice.
- Two prefab files differing only in case (`Hall.json`, `Hall.JSON`) share one
  slug on a case-sensitive disk.
- Deleting a prefab that is a symlink removes its target, because `under()`
  resolves links.
- `deletePrefab` returns true after a failed delete. The user still sees the
  toast.
- The "Autosaved" toast fires even when the save stood down because another
  map was opened mid-save.

**The feature: hatching the rock around the walls.** This is the old
hand-drawn dungeon look: short bundles of pen strokes hugging the rock side of
every wall, with the rock beyond left bare. It is the signature style of Dyson
Logos, of Dungeon Scrawl and of Watabou's one-page dungeons. Campaign
Cartographer users build it by hand. Cartograph's only options were the
dungeon generator's flat dark shade or nothing.

It passed the three tests:
- *Not already there.* There was no hatching anywhere in the code.
- *Within the founding constraints.* It is arithmetic and canvas strokes.
- *Fits what this is.* It is a style for one person's battle maps.

Rejected today:
- GM/player export in one go. Smaller, and it was weighed yesterday.
- Editing a set's fields.
- Making `registerExporter` work.
- Print tiling and elevation.

How it works:

- **It belongs to the walls layer, not to an op.** It has to follow every wall
  that is drawn, moved, turned, pasted or deleted, and every one of those routes
  already ends in `R.invalidate(walls)`. `renderWalls` draws it first, under the
  lines, from `hatch`, `hatchWidth`, `hatchSize` and `hatchColor` on the layer.
  All four are read with defaults, so old maps are unchanged.
- **Which side is rock is worked out from the walls.** They are rasterised at
  4 px a cell, and the gaps are labelled as regions. Whatever touches the frame
  is rock. Otherwise a region's class is the parity of the fewest walls between
  it and the frame, found by a 0-1 walk where a door (any `portal` kind) costs
  nothing, because a door joins floor to floor.
  - The first version flooded from the frame and called everything unreached a
    room. That left every pocket of rock inside a ring of corridors bare, which
    was obvious in a screenshot of a generated dungeon and invisible in the
    source.
  - A lone wall in open rock is hatched on both sides.
  - A room open to the frame counts as rock. The panel says so.
- **Each bundle is placed and turned from a hash of its lattice position**, not
  from a running random sequence. A wall added in one corner leaves the
  hatching elsewhere bit-identical (checked), and the rebuild is a pure
  function of the layer, which is invariant (a).
- A bundle is placed by its middle, so the band ends raggedly a bundle at a
  time. Each stroke is then cut back where it leaves the rock by marching along
  it on the region grid.
  - The first version clipped with a full-map `destination-in` mask instead.
    That cost 45 ms of a ~200 ms rebuild on a 2800 x 2100 dungeon.
  - It now takes 50-80 ms in this container (software-rendered) against 2 ms
    with hatching off. Nothing feeds `applyStroke`, so no box of the dangerous
    kind was touched.
- **Panel:** the Walls layer has a properties section for the first time: a
  toggle, *Width*, *Stroke length* and *Ink*. Every slider and colour is
  `commit: true`. Unlike the layer panels around it, these are undoable, one
  entry per change and none for a change to nothing. That makes them a small
  model for the known "layer edits are not undoable" item.
- **Dungeon generator:** *Shade the rock around it* became *Rock: Shaded /
  Hatched along the walls / Left plain*.
  - `normalise` still honours an old `shade: false`.
  - Hatched writes no shade op and sets `walls.hatch`, inside `commitDungeon`'s
    one step. Undo puts back the old value, or the absence of one.
  - A dungeon generated with the rock shaded turns off a previous dungeon's
    hatching, but never adds `hatch: false` to a map that had none.
  - The dialog's plan shows the choice.
- Extension API: unchanged apart from `HATCH_DEFAULTS`, which `api.render`
  exposes automatically. `API_VERSION` stays 1.

What is left, for a later day:
- Hatching the walls of every walls layer together. Each layer works out its
  own rooms today, as each layer must redraw from its own ops.
- A hand-inked rough edge on the walls themselves.
- A flagstone floor texture to go with it.

**Tests.** There is a new suite, `test/hatch.mjs` (27). It throws on a pristine
clone, which has no hatching control. It checks:
- a closed room left clean and the rock round it hatched;
- hatching stopping short of rock far from walls;
- two rooms joined by a door both clean;
- a pocket of rock inside a ring of corridor hatched, and the ring left clean;
- a wall added far away leaving another corner bit-identical;
- a lone wall hatched both sides;
- Width widening the band, as one undo step that undo and redo put back
  exactly;
- no entry for setting a value to itself;
- the round trip pixel-identical;
- a rebuild under 300 ms (fastest of four);
- the dungeon dialog's *Hatched* turning it on in one step that undo takes off
  (key and all), and *Shaded* turning it off again.

`transform.mjs` went from 43 to 52 checks:
- six fail on a pristine clone: the half-lattice midpoint, R mid-drag (three:
  no half-turn, one Move entry not two, undo back to where the drag began), the
  round lamp's entry and the dragged cone's angle;
- two are preconditions, kept deliberately: the path really is on edge
  midpoints, and the round lamp really is the only thing held;
- one, *the Select tool is still in hand*, passes on a pristine clone and is
  kept because it guards today's choice to eat R mid-drag rather than let it
  fall through to the Shape tool.

The `verify.mjs` change is described above. The `app.py` port fix was checked
by hand, `--port 70000` against a copy, since no suite starts the program.

Looked at in screenshots at 1440 x 900: a 17-room generated dungeon with
hatched rock. The rooms and corridors are clean, every rock pocket between the
loops is hatched, and the bundles meet the walls under the line.

**Tests:** 82 verify, 37 props, 29 lighting, 27 hex, 25 pro, 25 regions, 16 ext,
16 theme, 63 guards, 107 regress, 8 labels, 8 brushes, 27 generate, 36 notes,
34 dungeon, 39 clipboard, 43 selection, 41 prefabs, 52 transform, 27 hatch --
742 checks, all passing, plus `battle`, over two full back-to-back rounds on the
finished tree, with `CG_CHROME` pointed at
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome` as before.

---

## 2026-10-01 — turning a set round, and eight things the review found

Anthony's working copy matched `origin/main` byte for byte across all 80
tracked source files (the two screenshots were not compared), so this was a
feature day. The baseline was green: 648 checks across eighteen suites, plus
`battle`. (`npm install playwright` rewrote `package.json` here too, as the
hand-off warns; it was put back before comparing.)

**Review.** Two readers in parallel, reading only, each with a private copy on
its own port and told to reproduce before reporting: renderer, lighting,
clipboard, prefabs and generators; server and front-end state. `node --check`
passed on every module, and the non-ASCII grep found nothing outside comments
and UI strings. Eight defects fixed, each with a check that fails on a
pristine clone:

- *Undoing a landmass stroke after narrowing the shelf left a band of the old
  shelf* -- a gap in yesterday's fix. The undo puts back pixels drawn under the
  wide shelf, and `repaintLand` then cleared only as far as the narrow one
  reaches, because narrowing it had already lowered `coastReach`. 38,817 pixels
  off a rebuild. The entry now tells `repaintLand` how far its snapshot can have
  painted (`reachThen`); that box only clears and re-tints, so it is the safe
  kind (§12).
- *Paste, duplicate and prefab placement could take walls off the grid.*
  `offsetFor` snapped the first snapping thing in the set and moved the rest by
  the same amount, which keeps the rest on the lines only if that one was on
  them: a lamp Alt-placed off centre carried a copied wall half a cell off, and
  on a hex map a corner moved onto a different kind of corner took half a path
  off the lattice. The delta is now the difference of two cell centres
  (`latticePoint` in `doc.js`), a translation of the grid onto itself on square
  and hex grids alike. A consequence: on *Half* snapping a paste now moves by
  whole cells, and something placed off the grid with Alt stays off it by the
  same amount, as it would if dragged.
- *Undoing a move could bring back an edit undone during the drag.* The Move
  entry restored whole snapshots taken when the button went down; Ctrl+Z
  mid-drag undoing *Lit* left the light dark again after the Move was undone,
  with no step left to relight it. The entry now holds positions only
  (`placeOf`/`setPlace`).
- *A save of a new map wrote its slug onto whichever map was open when the
  reply came back* -- open another map while the first save of a new one is in
  flight and the opened map took the new one's folder, and its next save
  overwrote the new map. Data loss, reproduced end to end. `saveProject` now
  holds on to the document it was called for and touches nothing else after an
  await.
- *Two saves at once on a new map made two folders* (Ctrl+S twice, or Ctrl+S on
  an autosave). Saves now run one at a time; one asked for while another is in
  flight waits for it, and a save with nothing in flight still snapshots there
  and then, which `regress.mjs` checks.
- *Turning an extension on then off before its import finished left it on, and
  two ons at once registered it twice*, the first set never removable.
  `setExtensionEnabled` runs one toggle at a time, and `loadOne` unloads an id
  that is already loaded before loading it again. API-level only -- the
  checkbox round trip on loopback is too fast to hit it by clicking.
- *Two extension folders with one id* -- a copied folder -- both loaded and the
  second overwrote the first's record, leaving its commands in the palette for
  good. The second is refused with a message naming the first.
- Server: a prefab saved as `Hall.JSON` by hand was listed and then refused on
  delete (a 404 on a case-sensitive file system), and a folder named
  `Hall.json` was a 500 on delete. The delete finds the file by the rule the
  list uses, and refuses a folder with a 404.

Found and not changed: nothing new beyond what the hand-off already lists. Ctrl+S,
Ctrl+E and Ctrl+N still act while a dialog is up; E and N replace the dialog
and settle its promise, so it was judged benign.

**The feature: turning and mirroring a set.** The hand-off's first prefab
"next step", taken further: Dungeondraft turns and mirrors a selection from its
Select tool and Dungeon Scrawl added the same, and in Cartograph a prefab came
down facing the way it was saved with no way to turn it, nor any set. Not
already there (no rotation of anything but a stamp's own tilt), nothing beyond
arithmetic, and squarely a one-person-at-a-desk thing. Rejected today: editing a
set's fields (smaller and less asked for), GM/player export in one go, making
`registerExporter` do something, print tiling and elevation.

- **R** turns what Select holds clockwise, **Shift+R** anticlockwise -- only with
  something held; otherwise R is the Shape tool as before. *Turn left*, *Turn
  right*, *Mirror* and *Flip* are in the Selected panel (one thing or a set) and
  the palette. `web/js/transform.js`.
- **The grid decides the turn.** A square grid maps onto itself only under
  quarter turns about a corner or a cell centre, a hex grid under sixth turns
  about a hex centre; mirrors likewise. The pivot is the middle of the set's box
  moved to the nearest such point, a lone stamp, lamp or pin turns where it
  stands, and with snapping off the set turns about its own middle. Turned
  points within a hair of a lattice point are put exactly on it (`settle`), so a
  dozen turns do not walk a wall end off the corner the Wall tool snaps to.
- **The same pivot for consecutive turns of the same set.** A box that is not
  square changes shape under a quarter turn, so a pivot worked out afresh made R
  then Shift+R land a cell away from the start. The last pivot is reused while
  the set is the same things, untouched since; four quarter turns, six sixths
  and two mirrors land exactly home. A stamp's angle is folded onto exact
  multiples of pi/12 for the same reason.
- **What turns.** Every `x`/`y` and every point; a stamp's `rot` (and `flip` on a
  mirror -- across the horizontal it is also turned half round); a cone light's
  `angle`. A straight label keeps reading left to right and only its anchor
  moves; a curved one follows its curve.
- One undo step, deep copies both ways, keys the snapshot lacked taken off
  (undoing a mirror leaves no `flip: false` behind); walls invalidated last,
  through `invalidateAll` (now exported from `tools.js`), so a turned wall
  relights.
- **A turned stamp is clicked where it is drawn**: the Select hit test and its
  ring work in the stamp's own rotated frame. The Selected panel's stamp slider
  is now *Turn*, the whole circle, rather than *Tilt* at +/-0.8 -- a turned
  stamp would otherwise have shown pinned at the end and been unturned by a
  touch. That also affects a stamp's tilt set by hand.
- Extension API, additive: `api.tools.turnSelection(dir)` and
  `api.tools.mirrorSelection(axis)`. `API_VERSION` stays 1.

What is left, for a later day: turning by any angle (a stamp could, walls could
not); turning *while placing* a prefab rather than after; rescaling prefabs
between grid sizes.

**Tests.** A new suite, `test/transform.mjs` (43): a room on a battle map turned
by key, by button and back -- walls on grid lines and their lengths kept, the
cone and the stamp turned with them, Shift+R undoing R exactly, four turns home,
undo and redo exact, Mirror and Flip with no stray `flip` left by an undo, a
lone wall turned off a lamp's line lifting its shadow, a turned stamp clicked
where it is drawn and not where it stood, R with nothing held still picking the
Shape tool, the round trip pixel-identical, and on a hex map a path along hex
edges kept on hex corners through sixth turns, a mirror and a flip. It throws on
a pristine clone, which has no `transform.js`. `regress.mjs` 95 -> 107: twelve
new checks, eleven failing on a pristine clone and one precondition kept
deliberately (unticking *Lit* really does put the light out, which is what makes
"and undoing the move does not bring it back" mean anything). `guards.mjs` 60 ->
63, two failing on a pristine clone and one precondition (the prefab really was
saved). Looked at in screenshots at 1440 x 860: a walled room with a door, a
cone lamp and two stamps held and turned -- walls on the grid, the cone now
facing south and clipped by the walls, the stamps on their sides inside turned
rings -- and the panel's buttons, which first came out as three and an orphan
and are now two pairs.

**Tests:** 82 verify, 37 props, 29 lighting, 27 hex, 25 pro, 25 regions, 16 ext,
16 theme, 63 guards, 107 regress, 8 labels, 8 brushes, 27 generate, 36 notes,
34 dungeon, 39 clipboard, 43 selection, 41 prefabs, 43 transform -- 706 checks,
all passing, plus `battle`, over two full back-to-back rounds on the finished
tree. In this container the suites need `CG_CHROME` pointed at
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`, as the hand-off says.

---

## 2026-09-30 — prefabs, and nine things the review found

Anthony's working copy matched `origin/main` byte for byte across all 75 tracked
source files (the `.pyc`s and the two screenshots were not compared), so this
was a feature day. The baseline was green: 596 checks across seventeen suites,
plus `battle`. (The scheduled prompt's expected counts are older than the
suites: `pro.mjs` has 25, not 24, and there are eight suites it does not list.)

**Review.** Two readers in parallel, reading only, with every finding then
reproduced here before it was fixed: renderer, lighting and generators; server
and front-end state. `node --check` passed on every module, and the non-ASCII
grep found nothing outside comments and UI strings. Nine defects fixed, each
with a check that fails on a pristine clone:

- *Undoing a landmass stroke after changing the coast brought the old look
  back.* The undo restores a pixel snapshot drawn in the ink colour, shelf
  width and texture of the moment; change any of them, undo, and that
  rectangle kept the old look while the rest of the map (and a reload) had the
  new one -- 54,870 pixels off a rebuild. The entry remembers the look it was
  drawn in and calls `repaintLand` on undo and redo when it has moved on; when
  it has not, the snapshot is exact and nothing slower runs.
- *A texture nothing had decoded painted flat grey.* Only a click in the picker
  decoded one, so the texture remembered from last session, a preset's, and the
  dungeon dialog's Floor all painted `#888` while the op saved the name, and the
  map reopened textured (44,504 pixels). Boot decodes the remembered texture and
  stamp, a preset decodes its asset, the dungeon dialog awaits its floor, and
  `requireAsset` starts a decode and rebuilds the layer when it lands.
- *A stroke on a Multiply layer previewed darker than it landed*: the live
  canvas was blended with the map and the layer under it separately. A layer
  whose own blend is not Normal now takes the copy-and-composite path of
  invariant (h).
- *Ctrl+Z in the middle of dragging a duplicate* pushed a `Move` for a copy no
  longer on the map and threw its redo away. The Select tool's `up()` drops
  items that have left the map and puts them back where they were, so the redo
  restores them there.
- *Keys reached the map behind the command palette* once its box lost focus --
  Delete took the held stamp, a letter swapped the tool. `input.js` and
  `main.js` stand down while `paletteOpen()`.
- *The Escape that closed a dialog also reached the tool*, throwing away a wall
  half drawn behind the dungeon dialog. The dialog's listener stops it.
- *Autosave never fired during steady work.* It was a debounce: every edit
  restarted the clock, so a stroke a minute with a 90-second setting was never
  saved. It is a deadline set by the first edit after a save now, re-armed if
  more arrived while the save was in flight.
- *A map with a layer missing its `ops` list* threw out of `setDocument` after
  `app.doc` had switched: "Could not open" on screen, and Ctrl+S then saved the
  broken map over the name. `openDocument` gives such a layer an empty list.
- Server: a `Content-Length` of 5,000 digits passed the digit check and made
  `int()` itself raise (Python's 4,300-digit guard), killing the handler with no
  reply. Anything over 18 digits is refused with a 400.

Found and not changed, written up in the hand-off: `api.registerExporter` is
documented and does nothing -- the Export dialog never reads
`extensions.exporters` (making it work is a feature, not a patch); Fill *Inside
/ Outside the landmass* ignores Feather (live and reload agree, and fixing it
changes how every saved fill of that kind looks, so it wants deciding); a
failure inside `setDocument` for any *other* reason still leaves the editor half
switched (only the reproduced trigger is fixed); `layer.__maskVersion` is
written into `project.json` and never read; the palette's Save and a project
card's Delete show nothing when they fail; `newMap` marks the map dirty without
arming autosave, which may be deliberate (a new map is not on disk until first
saved, and every suite relies on that).

**The feature: prefabs.** Next on the hand-off's list since the selection set
landed, and still the gap today's look at Dungeondraft, Inkarnate and Dungeon
Scrawl found: Dungeondraft saves a selection as a prefab and places it from a
tab, and nothing in Cartograph outlived the page. Not already there (no
`prefab` anywhere in the code); standard library and a JSON file, nothing
fetched; and a folder of reusable rooms is squarely a one-person-at-a-desk
thing. Rejected today: editing a set (smaller, and less asked for), GM/player
export in one go, print tiling and elevation, as before.

- **Save as prefab…** in the Selected panel (one thing or a set), *Save
  selection…* in the Select tool's panel, and the palette. The name is asked
  for; the file is `prefabs/<name>.json` beside the program -- the clipboard's
  own `{entries, kinds}`, deep-copied, with no layer ids (they name layers on
  the old map), plus the grid step it was drawn on and the map kind. A second
  prefab of the same name gets a number rather than replacing the first.
- **Putting one down** is a chip in the Select tool's panel, or *Place …* in the
  palette. It goes through the clipboard's own `place()`, so it is a paste in
  every way that matters: one undo step, each part onto a layer of its own kind,
  walls snapped to the grid and relit, the first lamp turning the night on,
  fresh ids, and the copies picked up ready to drag. It lands in the middle of
  the view -- the button is in the rail, so the pointer is nowhere useful. A
  prefab saved on a different grid size says so, because its walls will not
  sit on the new lines. **The x on a chip deletes the file, after asking**;
  copies already placed stay.
- **Server**: `server/prefabs.py`, with `GET`/`POST /api/prefabs` and `DELETE
  /api/prefabs/<name>`. Names go through `slugify`/`slug`/`under`, files through
  `safe.load`, and `check()` refuses what the editor could not place -- a kind
  that is not an object kind, an entry with no position, a point that is not a
  finite number, mismatched lists, anything deeper than `MAX_DEPTH`, over 2 MB,
  or over 2,000 things. A broken file in the folder is skipped, never allowed to
  empty the list. The folder is never served statically, so nothing in it can
  run as a page. The name is claimed with a hard link from a private temp file,
  so two saves racing for one name cannot lose one. `prefabs/` is in
  `.gitignore`, like `projects/`.
- `OBJECT_NOUNS` moved from `ui.js` to `doc.js` so the set summary and a
  prefab's description cannot come to call one thing two names. No extension API
  change.

What is left, for a later day: rotating and mirroring a prefab as it goes down
(Dungeondraft has both); adding a layer the new map lacks (a note in a prefab
put on a map with no notes layer is left out with a message, as a paste does);
and scaling between grid sizes.

**Tests.** A new suite, `test/prefabs.mjs` (41): the strip and its disabled
Save link; saving from the Selected panel; the file on disk; placing on a second
map as one step, picked up, shape kept, walls on grid lines, fresh ids, centred
on the view, the night turned on; undo and redo; placing from the palette; the
round trip pixel-identical; a same-name save getting a number; a name full of
markup shown as text; seven malformed bodies refused, a foreign Origin refused,
a delete naming a path out of the folder refused, a broken file skipped; and
delete asking first. It throws on a pristine clone, which has no strip. It names
every prefab it saves with a run tag and removes them in a `finally`.
`regress.mjs` 85 -> 95: nine new checks, all failing on a pristine clone, and
one precondition kept deliberately (the active texture really is undecoded,
which is what makes "and it is not left grey" mean anything). `guards.mjs` 59
-> 60, failing on a pristine clone. Looked at in screenshots at 1440 x 860: the
save dialog over a generated dungeon ("86 things (9 notes, 77 walls)"), and the
same dungeon put down on a fresh battle map from its chip, walls on the grid and
held, with the nine notes left out and the toast saying so.

**Tests:** 82 verify, 37 props, 29 lighting, 27 hex, 25 pro, 25 regions, 16 ext,
16 theme, 60 guards, 95 regress, 8 labels, 8 brushes, 27 generate, 36 notes,
34 dungeon, 39 clipboard, 43 selection, 41 prefabs -- 648 checks, all passing,
plus `battle`, over two full back-to-back rounds on the finished tree.

---

## 2026-09-29 — holding several things at once, and nine things the review found

Anthony's working copy matched `origin/main` byte for byte across all 76 tracked
source files (the `.pyc`s were not compared), so this was a feature day. The
baseline was green: 541 checks across sixteen suites, plus `battle`.

**Review.** Two readers in parallel, each on its own running copy and each
reproducing before reporting: renderer, lighting and the generators; server and
front-end state. `node --check` passed on every module, and the non-ASCII grep
found only em dashes, times, degree and middle-dot signs, ellipses and curly
quotes in comments and UI strings. Nine front-end defects, none on the known
list, all reproduced and fixed; two server nits, fixed:

- *Undoing a dungeon took away layers added after it.* `commitDungeon`'s undo
  restored a snapshot of the whole stack, and adding a layer is not itself an
  undo step (known, hand-off 13) -- so a paint layer added after generating
  vanished on undo, paint and all, and redo did not bring it back either. The
  step now takes away and puts back only the layers it added, at their places.
- *Undoing a dungeon that had added the walls layer left its shadows behind.*
  The relight only ran if the walls layer was still in the document. It calls
  `relightAll()` when it is not.
- *A paste with the pointer over the grey margin landed off the map* (both
  readers found it): saved, selected and invisible. The cursor is tracked over
  the whole canvas; a paste now uses it only when it is over the map.
- *Something picked up before its layer was locked or hidden could still be
  deleted, cut or edited.* `hitTest` refused such layers and `selectedObject()`
  did not. It does now, `selectObject` refuses them, and the Locked toggle
  emits `'selection'` so the panel steps down.
- *A pasted or duplicated label was pulled onto the grid*, which the Label tool
  never does. The paste now reads how to snap off the kind's own tool rather
  than guessing from the op's shape.
- *Ctrl+E and Ctrl+N opened their dialogs underneath an open palette*, and the
  next palette command then ran behind the waiting dialog. `palette.js` exports
  `paletteOpen()` and `main.js` stands those two down while it is true.
- *An extension's shortcut fired while typing in a text field* (Ctrl+Shift+A in
  the map name aged the paper).
- *"Go back to the start of this session", and clicking the history row you
  were already on, marked a saved map dirty.* Both now check `jumpTo`'s return.
- Server: `Content-Length` was parsed with `int()`, which reads `1_0` as ten and
  takes `+2`; it must be ASCII digits now. And `do_OPTIONS` was the one handler
  without the Host check; it refuses an unknown Host with 421 like the rest.

Found and not changed: the Select tool's drag is not snapped, so a wall dragged
on a battle map leaves the grid lines (true before today too; snapping the
drag's delta is small, but it changes how every move feels, so it wants
deciding). Also noted, not reproduced: after a space-pan `view.cursor` is not
updated, so a paste straight after one may use a stale point.

**The feature: a selection set.** First on the hand-off's candidate list since
yesterday, and today's research agreed: Dungeondraft's Select tool box-selects
and shift-adds, and "select stamps from different groups" is an open request on
Inkarnate's board. Not already there (read the code: `state.grabbed` was one
item); no dependency; squarely a one-person-at-a-desk thing. Rejected today:
prefabs (they build on this, so they are the natural next day), GM/player
export in one go, print tiling and elevation (as before).

- **Shift-click** adds a thing or puts it back down and moves nothing. **A box
  dragged on empty map** picks up what it *wholly* encloses -- touching is not
  enough, because a region covers half the map and a box drawn round three
  doors must not pick up the kingdom they are in. Shift and a box adds to the
  set. A click on empty map puts everything down; so does Escape. Ctrl+A picks
  up everything on every drawn, unlocked layer, and the palette has both.
- **The set is not stored twice.** The tool keeps its primary (`grabbed`, what
  the Selected panel edits and what `selectedObject()` has always returned) and
  a list of the rest, and `selectedObjects()` is the only reading of it: each
  thing is checked against the document, its layer's lock and its visibility
  every time, so an undo, a delete or a lock simply drops it out.
- **Drag any of it and all of it moves**, each item from its own snapshot plus
  one delta rather than accumulating per frame, as one `Move` step. Walls are
  invalidated last so the light is recast against where they are now; moving a
  wall off a lamp's line lifts its shadow and undo puts it back (measured).
- **Delete, cut, copy, paste and duplicate take the whole set**, as one step
  however many layers it spans. The clipboard carries each op's kind, so a room
  copied with its walls, doors, lamps and furniture pastes each part onto a
  layer of its own kind; a part with no drawn, unlocked layer to go to is left
  out with a toast rather than refusing the lot. The set keeps its shape, and
  the delta is snapped as the first snapping thing in it snaps, so walls stay
  on grid lines. The first light on an empty lighting layer still turns the
  night on.
- **The Selected panel** says what is held ("5 things picked up: 3 walls, 2
  lights") with Duplicate, Copy and Delete. It offers no fields for a set,
  deliberately: "the colour" of a wall, a lamp and a stamp has no single
  meaning. Editing a set is the next step if anyone wants it -- `editObject`
  applied across it.
- **Extension API, additive:** `api.tools.selectedObjects()` and
  `api.tools.selectObjects(list)`. `API_VERSION` stays 1.

**Tests.** A new suite, `test/selection.mjs` (43): building a set by shift-click
and taking one out; the panel's summary and its lack of fields; the box taking
the lamp and wall inside it and not the road through it; shift-box adding;
moving a set as one step with the far ends moved alike, the shadow lifting and
coming back on undo; the round trip pixel-identical; deleting a set as one step;
copying a set that spans walls and lighting and pasting it at the pointer,
shape kept, walls on grid lines, copies held; duplicating a set; a paste with
the lighting hidden landing its wall only; Ctrl+A; and a lock dropping a wall
out of the set so Delete takes only the lamp. It throws on a pristine clone,
which has no `selectedObjects`. `regress.mjs` 75 -> 85: nine new checks, all
failing on a pristine clone, and one precondition kept deliberately (the
dungeon's walls do cast shadows, which is what makes "and undo takes them away"
mean anything). `guards.mjs` 57 -> 59, both new checks failing on a pristine
clone. Looked at in a screenshot at 1440 x 860 on a generated dungeon: the
dashed box while dragging, then two rooms' walls and pins ringed and the panel
reading "14 things picked up: 2 notes, 12 walls".

**Tests:** 82 verify, 37 props, 29 lighting, 27 hex, 25 pro, 25 regions, 16 ext,
16 theme, 59 guards, 85 regress, 8 labels, 8 brushes, 27 generate, 36 notes,
34 dungeon, 39 clipboard, 43 selection -- 596 checks, all passing, plus
`battle`, over two full back-to-back rounds on the finished tree.

---

## 2026-09-28 — copy and paste, and a dialog that owns the keyboard

Anthony's working copy matched `origin/main` byte for byte across all 74 tracked
files other than the `.pyc`s (sizes matched for those too), so this was a
feature day. The baseline was green: 498 checks across fifteen suites, plus
`battle`.

**Review.** Two readers in parallel -- renderer, lighting and the generators;
server and front-end state -- each on its own running copy, plus `node --check`
on every module and a non-ASCII grep (clean: every hit is an em dash, a times
sign or a degree sign in a comment or a UI string). The server came back with
nothing new. What was found:

- *The command palette opened over a dialog, and a dialog did not own the
  keyboard.* `.palette-root` sits above `.modal-root`, and nothing in
  `initPalette` asked whether a dialog was up, so Ctrl+K inside Generate land or
  Generate dungeon opened the palette on top, took the focus out of the seed
  box, and would run Undo (or anything else) against the map the dialog was
  still waiting on; the Escape that closed the palette then cancelled the
  dialog too. The same family, one level down: with the focus on one of the
  dialog's checkboxes Ctrl+Z undid the map behind it (`main.js` only exempts
  text fields), and after a click on the dialog's plan a tool letter changed
  the tool and Delete removed the selected thing behind it. `util.js` now
  exports `modalOpen()`, and the palette, extension shortcuts, the tool keys in
  `input.js`, and undo/redo and the new clipboard keys in `main.js` all stand
  down while it is true. Three checks in `regress.mjs`; all three fail on a
  pristine clone.
- *The Select tool's ring outlived what it held.* The overlay drew from
  `state.grabbed` without asking `selectedObject()`, so undoing the placing of
  the thing in hand left a ring marking where nothing was. Found in today's
  screenshot, not by reading. One check in `regress.mjs`, which fails on a
  pristine clone. A light's selection mark is also a ring round its grab radius
  now rather than the box a stamp gets, which was drawn off to one side of it.
- *Layer adds and reorders are not undoable* -- reproduced again and already
  on the known list (hand-off section 13), so not re-reported as new and not
  fixed today.
- Suspected and not reproduced: a straight corridor in `dungeon.js` passing
  through a third room it was not joining (it would still be a valid dungeon);
  `dungeon.floorLayer()` is exported and unused.

**The feature: copy, cut, paste and duplicate.** Next in line on the hand-off's
candidate list since 2026-09-24, and today's research agreed: Dungeondraft's
select tool copies, pastes and saves selections as prefabs, Inkarnate copies
and pastes stamps, and Cartograph had no way at all to make a second of
anything except drawing it again and setting every property by hand -- which
the properties panel had made more noticeable, not less. It passes all three
tests: not already there (read the code: no clipboard, no Ctrl+C binding
anywhere), no dependency, and it is exactly the desk-and-one-person kind of
thing. Rejected today: GM/player export in one go (small, and hiding the notes
layer already gives the players' copy), print tiling (needs a PDF writer
verified by printing), elevation (touches coast, shelf and lighting at once),
and prefabs-to-disk (tomorrow's half of this -- see below).

`web/js/clipboard.js`, wired to Ctrl+C / Ctrl+X / Ctrl+V / Ctrl+D, to four
palette commands, and to Duplicate / Copy / Delete buttons in the Selected
panel. The decisions:

- **A copy is a deep copy of the op; a paste is an ordinary op** on a layer of
  the same kind, with a fresh id from the prefix its tool mints. Nothing below
  this module learned anything new, which is why the round trip is
  pixel-identical without a line of renderer change.
- **Where it lands.** Under the pointer if the pointer is on the map (the
  thing's bounding box is centred there), otherwise a cell on from the
  original, one cell further for each paste in a row. A duplicate is always a
  cell on. The anchor is then **snapped as the thing's own tool snaps** --
  centres for stamps, lights and notes, corners for walls, paths and regions --
  so a door copied off a grid line lands on one, and on a hex map a copy lands
  on the hex lattice rather than a square step off it.
- **Which layer.** The one it came from if this map still has it, then the
  active layer, then the topmost of that kind -- each only if drawn and
  unlocked. A map with none says so and writes nothing.
- **The clipboard outlives changing maps**, deliberately: carrying furniture
  from one battle map to the next is the point. It does not survive a reload,
  and nothing goes to the system clipboard (reading it back needs a permission
  prompt, and no other program can use a map op).
- **One undo step each**, and the copy is picked up so it can be dragged
  straight into place. Cut is Copy plus the Select tool's own Delete, factored
  out of its `key()` into `deleteSelection()` so the Delete key, the panel
  button and Cut are one route.
- **A pasted wall relights**: the paste goes through `R.invalidate`, so a wall
  pasted between a lamp and the floor shades it at once and undoing it lifts
  the shadow (measured). The first light pasted onto an empty lighting layer
  turns the night on, as the Light tool's first light does, and undo turns it
  back off.
- **A copy is the user's own**: `gen` is dropped, so a note copied out of a
  generated dungeon is not swept away when the dungeon is regenerated.
- Keys typed into a field stay the field's -- Ctrl+C in the note's title box
  copies text. Ctrl+C with nothing picked up is left to the browser.
- No extension API change; `API_VERSION` stays 1.

**What remains of it**, for a later day: a selection *set* (shift-click or a
marquee) so several things copy at once -- the clipboard is already a list of
entries so that it pastes through the same code -- and then prefabs, a
selection saved as a JSON file in a `prefabs/` folder beside `assets/`, which
wants an endpoint through `safe.py`. Also worth knowing: a wall is still picked
up by its end points only (hand-off 6a), so copying one means clicking an end.

**Tests.** A new suite, `test/clipboard.mjs` (39): nothing to paste, the door
copied and pasted under the pointer on grid lines with its own id, one undo
step and the copy in hand, the pasted wall shading a lit floor and its undo
lifting it, duplicate one cell on in a cell centre with the clipboard left
alone, the panel's Duplicate and Delete, cut then pasting off the map stepping
each copy on, a generated note losing its tag, the reload pixel-identical, a
lamp carried to another map turning its night on (and undo turning it off), a
map with no such layer refusing, a hex duplicate landing on the lattice, and
the clipboard keys inside a text field. `regress.mjs` 71 -> 75, all four new
checks failing on a pristine clone. Looked at in a screenshot at 1440 x 860: a
walled room, a pasted wall beside it, the Selected panel's new buttons, and --
the reason the ring fix exists -- the ghost ring after undoing a duplicate.

**Tests:** 82 verify, 37 props, 29 lighting, 27 hex, 25 pro, 25 regions, 16 ext,
16 theme, 57 guards, 75 regress, 8 labels, 8 brushes, 27 generate, 36 notes,
34 dungeon, 39 clipboard -- 541 checks, all passing, plus `battle`, over two
full back-to-back rounds on the finished tree.

---

## 2026-09-27 — a dungeon from a seed, and sixteen things the review found

Anthony's working copy matched `origin/main` across all 72 tracked source files
(the `.pyc` files git also tracks were not compared), so this was a feature day.
The baseline was green: 447 checks across fourteen suites, plus `battle`.

**Review.** Three readers in parallel -- renderer and lighting, server, front-end
state -- each reproducing on its own running copy before reporting. Sixteen
findings, none already on the known list, all reproduced, all fixed. Every fix
has a check, and every new check was run against a pristine clone of
`origin/main`: all 4 new guard checks and all 13 new regression checks fail
there. Two drafts passed on the pristine tree for the wrong reason and were
rewritten, not kept: the notes-list undo check passed because the list was
already stale from the step before (it now checks undo *and* redo), and the
dialog check cancelled Export with Escape -- which the first dialog's leaked
Escape listener heard, settling it and hiding the very bug under test (it now
clicks Cancel).

**Fixed, server side.**

- *A whole number too big for a double saved, and the map then opened blank.*
  The 2026-09-26 guard went through `parse_float`, which never sees an integer;
  `1` followed by 400 zeros came back to the browser as `Infinity` and the
  editor showed `Infinity x 1536` on an empty canvas. `safe.loads` checks
  integers too now.
- *A byte-order mark broke every JSON file on disk* -- and Notepad and
  PowerShell's `Out-File` write one, on the platform this is developed on. A
  `pack.json` or `extension.json` was reported broken, a `project.json` vanished
  from the Projects tab, and a `config.json` was discarded *and overwritten with
  the defaults* at startup. `safe.load` strips it.
- *`POST /api/projects` answered 500 for any body that was not an object*, and
  for `write()`'s own depth refusal, where `PUT` answers 400. Both are 400 now.
- *On port 80 every API call from the editor was refused.* The Host set got the
  bare names a browser sends for the default port; the Origin set did not.
  Not covered by a check: it needs a privileged port.
- *A hand-dropped art file called `tree #2.png` never loaded*: its URL was not
  encoded and the `#` began a fragment. `assets.js` encodes each segment.

**Fixed, in the editor.**

- *A light beside a wall that ran out past its reach lost a wedge of its own
  side of the room*, and so did a light near two walls crossing: rays were cast
  only at segment ends. `light.js` clips each wall to the light's bounding
  square and adds wall crossings as corners. 1,238 of 11,502 probe pixels were
  wrongly dark before; none after.
- *A curved label longer than its curve piled its extra letters on the two end
  points* -- nine glyphs drawn at one spot. `pathWalker` runs on along the end
  segments.
- *A brush set to Multiply (or any blend) previewed as Normal and changed on
  release*, and a stroke on a layer below full opacity previewed wrong too.
  The live stroke is now blended onto a copy of the layer's box, the route
  invariant (h) built for the eraser. Measured mid-drag and after release: the
  same pixel.
- *Letter spacing counted UTF-16 units*, so a name in the fraktur letters people
  paste in for fantasy names sat 51 px off its anchor.
- *`wantsHover` was documented and read nowhere*: only the Path tool got moves
  with no button down, so Wall and Region drew no line to the cursor between
  clicks and the Note tool no preview pin. `input.js` reads the flag; Measure
  lost its, since its `move` would otherwise keep dragging a finished reading.
- *The top bar said "saved" while the map was not*, when an edit landed during
  a save.
- *Adding a group from inside a group split the old group's run*, and left a
  layer that had just left a hidden group undrawn and unlit.
- *The numbered notes list went stale* after a Delete, an edit in the Selected
  panel, or their undo -- the list and the key disagreed, which is the one thing
  the notes design promises cannot happen.
- *Battle-token numbers came from a counter in the module*, so undo, a reload
  or a second map handed out numbers already on the board.
- *An extension command bound with `keys`*, as `EXTENSIONS.md` says, was shown
  in the palette and never bound; `map-aging`'s `shortcut` was bound and never
  shown. Both spellings do both now.
- *`modal()` replaced an open dialog without settling it*, so the Note tool --
  waiting on its dialog behind a busy flag -- never placed another note once
  Ctrl+E had opened Export over it; and every dialog closed by a button left its
  Escape listener behind. `modal()` settles the dialog it replaces.
- And one found by today's own test: *a dialog taller than the window put its
  buttons below the fold* with no way to reach them. `.modal` is capped to the
  window and its body scrolls.

**Written up rather than fixed.** Two minor ones from reading: a Fill set to
*Outside the landmass* on a map with no landmass is not rebuilt when a
landmass layer is later added; and `withKey` gives a note title no `maxWidth`,
so one very long word runs past the key strip. Also from the server review:
`load_config` discards a `config.json` it cannot read and startup then rewrites
it with the defaults, so a typo in a hand-edited file silently costs every
setting in it.

**The feature: a dungeon from a seed.** First on the hand-off's candidate list
since 2026-09-24, and today's research agreed: Dungeon Scrawl has a random
dungeon tool (size, room count and size, straight to winding layouts, door
density) but no seed and no room numbers; Donjon has seeds and options but is a
web page; Watabou's one-page dungeons show what a plan plus a numbered key is
worth. A battle map here still started at a blank floor, and the notes of
2026-09-26 meant the key was already half built. Rejected today: copy/paste and
prefabs (next in line -- medium, and a change to the Select tool), GM/player
export in one go (small, and hiding the notes layer already does half of it),
print tiling (a PDF writer, verified by printing) and elevation (touches coast,
shelf and lighting at once).

*Generate dungeon…* sits at the top of the Wall panel and in the palette. A
dialog with a live plan offers a seed, room count, room size, straight or
winding corridors, loops, how many doorways get doors, secret doors, the floor
texture, shading the rock, and numbering the rooms. The decisions worth knowing:

- **Everything is laid out in grid cells and written as ordinary ops.** Rooms
  are rectangles of cells two apart and one from the frame; a minimum spanning
  tree joins them and a share of the shortest spare pairs adds loops; each join
  is carved as a path of cells, and every step from outside a room into one is
  a doorway. A wall is any edge between an open cell and a closed one, or
  between a room and a corridor that did not step in there. Collinear edges
  merge into runs, so a long wall is one op the Select tool picks up whole.
- **The walls are walls.** They go on the Walls layer as `wall`, `door` and
  `secret` ops, so they cast shadows, travel into the Universal VTT export as
  sight lines and portals (checked: one portal per door), and can be selected
  and edited one at a time. Every one lies on a grid line.
- **The floor is one shape op on the paint layer**, `shape: 'generated'` with
  `rings` of cell corners filled even-odd -- the one renderer change, a branch
  in `shapeMask` mirroring the landmass one. The rock around it is a second op
  whose rings are the frame plus the floor's, which even-odd turns into
  everything else. Both are `hardness: 1`, so no blur and nothing for a box to
  clip. The settings ride on the floor op's `gen`, as generated land's do.
- **Rooms are numbered from the way in.** The entrance is the room nearest the
  bottom of the map, the rest breadth first along the corridors, nearest first;
  each note carries the room's size in map units. The notes are tagged
  `gen: 'dungeon'`, so generating again replaces them and leaves the user's own.
- **Secret doors only ever go on a loop's doorway.** A room whose only way in is
  hidden is a room nobody finds.
- **One step, undone whole.** Walls, floor, notes, and any layer the dungeon had
  to add (a notes layer, or a paint layer when none was free) come and go
  together; a layer taken away keeps its canvases for the redo, as `deleteLayer`
  does. Walls are invalidated last, so the relight sees them.
- **Square grids only.** A hex map is told so and nothing changes.
- No extension API change; `API_VERSION` stays 1.

**Tests.** A new suite, `test/dungeon.mjs` (34): the entry points, the plan in
the dialog, cancel, determinism, every room reachable, rooms kept apart, every
wall on a grid line, secret doors only on loops, *open arches only*, a note per
room with the entrance first, the floor lighter than the shaded rock, a light
held in by the walls, VTT sight lines and one portal per door, undo taking the
notes layer away and redo restoring the same pixels, regenerating replacing
rather than adding while keeping the user's notes, *keep* and *replace* walls,
the round trip pixel-identical, a map with no paint layer, and the hex refusal.
`guards.mjs` 53 -> 57, `regress.mjs` 58 -> 71. Looked at in screenshots: the
dialog at a 1440 x 860 window, the generated map, and the map lit by two torches
with the walls holding the light in.

**Tests:** 82 verify, 37 props, 29 lighting, 27 hex, 25 pro, 25 regions, 16 ext,
16 theme, 57 guards, 71 regress, 8 labels, 8 brushes, 27 generate, 36 notes,
34 dungeon -- 498 checks, all passing, plus `battle`, over two full back-to-back
rounds on the finished tree.

---

## 2026-09-26 — notes with a key beside the map, and other people's files

Anthony's working copy matched `origin/main` across all 71 tracked source files
(the `.pyc` files git also tracks were not compared), so this was a feature
day. The baseline was green: 388 checks across thirteen suites, plus `battle`.

**Review.** Three readers in parallel again -- renderer and generator, server,
front-end state -- turned up twenty candidates, one already on the known list
(map-aging's stains) and the rest each reproduced on a running copy before
anything was changed. Sixteen were fixed. Every fix has a check,
and every check was run against a pristine clone of `origin/main`: 8 of the 9
new guard checks and 13 of the 14 new regression checks fail there. The one
that passes on each is a precondition -- *the editor's own files are left
alone* beside the sandbox check, and *the label is picked up* before the
dropdown checks. Two drafts passed on the unfixed tree for the wrong reason and
were rewritten, not kept: the region-colour check set its colour with a `change`
event a colour input never hears, and the empty-label check depended on the
step before it having failed.

**Fixed, server side.**

- *A file in an art pack could drive the whole API.* Pack and map folders were
  served from the editor's own origin with no sandbox, so an SVG or HTML file
  with a script in it, opened as a page, ran as the editor: same origin, an
  Origin the guard accepts. Reproduced end to end: a stamp SVG created a
  project. `/assets/` and `/projects/` now carry `Content-Security-Policy:
  sandbox` and `nosniff`; an `<img>` or a canvas ignores both, so the editor's
  own use is untouched. Extensions are code by design and are left alone.
- *A NaN anywhere on disk stopped the editor starting.* Python reads `NaN`,
  `Infinity` and `1e999` and writes them back out; `JSON.parse` refuses all
  three. One in a `pack.json` took `/api/packs` -- read at boot -- with it; a
  `width: 1e999` saved with a 200 and then emptied the Projects tab.
  `safe.loads`/`safe.load` refuse them, every loader and every request body goes
  through them, and a body that does not parse is now a 400 from one place
  (`api._body`) rather than a 500 from whichever handler read it.
- *Listed maps that would not open.* `list_projects` checked less than `read`,
  so a map with no layers was listed, and when it was the newest the editor
  reopened it on launch and came up with no document; a folder named `Old Map
  (copy)` was listed and could be neither opened nor deleted. The list applies
  `read`'s tests now, `read` requires string layer ids as the save's sweep
  already did, and boot falls back to a blank map if the reopen fails anyway.
  That fallback should also cover the hand-off's "deleted last-open map stops
  the editor booting", but that exact case was not reproduced today.
- *Importing `tree (1).png` was a 400.* `import_asset` validated the stem with
  `slug` instead of tidying it with `slugify`.
- *An export name of 64 four-byte letters was a 500*, past the 255-byte file
  name limit. Capped by bytes, and the name now goes through `under()` -- the
  hand-off asked for that on the day `.md` joined the allow-list, which is today.

**Fixed, in the editor.**

- *Pressing ] mid-stroke made the stroke wider than `op.size`*, breaking the
  invariant every box relies on: clipped on screen, and on the landmass an undo
  that left 32,931 pixels of ghost land in the mask. `move()` reads `live.op.size`.
- *A one-pixel seam round every landmass stroke.* The composite box is padded by
  an ink width of 2.5, and a fractional clip half-blends its outline: 105,786
  channel values on screen differed from a full composite. `compositeAll` rounds
  its box out to whole pixels. That box only copies from finished canvases and
  never reaches `applyStroke`, so it is the safe kind (hand-off section 12).
- *Keys typed in a focused dropdown went to the tools.* Delete in a label's
  Style menu deleted the label; "w" to reach Water picked up the Wall tool.
- *A half-drawn wall, path or region carried over into the next map*, and Enter
  committed the old map's coordinates into it. Tool state is cleared on
  `'document'`.
- *A label emptied in the Selected panel became unclickable* (no text, no hit
  width). The panel refuses an empty label text, and an empty note title.
- *The region colour menu went dead* the first time a custom colour was picked.
  Whichever of the two was touched last now wins; settings from before keep the
  old rule.
- *Generate land with the seed box emptied* re-rolled on every preview redraw
  and committed a third seed nobody had seen. It falls back to one held seed,
  shown as the placeholder.
- *The palette's scale-bar toggle was never saved*; the coordinates extension's
  *Show or hide* command made its layer hidden on first use; and the coordinates
  did not follow a change of grid size (`regrid` now rebuilds extension layers).

**Written up rather than fixed.**

- *Generate land's Replace keeps every dead op.* Each replace appends a `clear`
  and the new land, so four replaces left ten ops and 37 kB replayed on every
  rebuild. Dropping the old ops is safe for undo, but it is a change to
  yesterday's stated design, so it is left for a day that decides it.
- *The Fill shape box is smaller than its feather blur* (30 px against about
  42 px at Feather 1), a faint hard edge. Live and reload agree, so invariant
  (a) holds; it feeds `applyStroke`, so it is the dangerous kind of box.
- `tools/import_folder.py --group ../x` joins a CLI argument into a path without
  `under()`. Local trust only.
- Git tracks `server/__pycache__/*.pyc` and `tools/__pycache__/*.pyc` despite
  `.gitignore`. `git rm --cached` them when convenient.

**The feature: notes, with the key beside the map.** Second in line on
2026-09-25, and the research agreed today: Inkarnate's own feedback board has a
*Notes export* request, Dungeondraft numbers rooms with the plain text tool, and
Foundry, Azgaar and LegendKeeper all have pins -- but nobody puts the key on the
exported picture, and a numbered map without its list is half a thing at the
table. Rejected today: GM/player export as its own feature (a hidden notes layer
now does the useful half of it), prefabs and copy/paste (larger, and a change to
the Select tool), print tiling (a PDF writer, verified by printing), elevation
(touches coast, shelf and lighting at once), and a dungeon generator.

- A `notes` layer kind; no map kind starts with one, and the Note tool's panel
  offers to add it, as the Region tool does. It goes on top of the stack, above
  the paper, because a pin under the vignette is a pin you squint at.
- A note is `{ id, x, y, title, body, color }`. **The number is not stored**: it
  is the note's place in its layer, so the pin, the list in the Layers panel and
  the key cannot disagree, and deleting note 2 renumbers the rest everywhere at
  once. Each notes layer counts from 1 -- which keeps a layer drawable from that
  layer alone -- and a map with two gets a heading per layer in the key.
- The Note tool (N) places a pin through a title-and-note dialog, one undo step.
  Select picks a pin up by clicking it, drags it and deletes it; the Selected
  panel edits title, note (a new `textarea` field type) and colour. The Layers
  panel lists the notes in order, and clicking one selects it and brings it into
  view if it is off screen. Pin size and *Show titles beside the pins* are
  layer settings.
- The export dialog offers, when there are visible notes: *Include the note
  pins*, *Set the key beside the image*, and *Also write the key as a Markdown
  file*, named after the image the server actually wrote (`map-2-key.md` beside
  `map-2.png`). The key strip is measured from the image, so a half-size export
  gets a half-size key, and a key longer than the map runs on below it. A hidden
  notes layer is neither drawn nor keyed, and the dialog stops offering it --
  that is the players' copy.
- `R.drawPin`, `R.withKey`, `R.centreOn`, `noteKey`, `keyMarkdown` and
  `NOTE_DEFAULTS` are new exports; `api.tools.selectObject` is new in the
  extension API (additive; `API_VERSION` stays 1).

**Tests.** A new suite, `test/notes.mjs` (36): the layer and where it goes, the
dialog and cancel, the pin in its colour, undo and redo, the list and selecting
from it, Selected-panel edits one undo step at a time, the empty-title refusal,
moving by the pin, renumbering in the key, the list and the drawn pin, titles
beside pins, pins left out of an export, the hidden layer leaving the key and
the dialog, the real export writing a wider PNG and a matching `-key.md`, a key
that runs below the map, two layers, and the round trip. `guards.mjs` 44 -> 53,
`regress.mjs` 44 -> 58. Looked at in screenshots: the editor with pins, the
Selected panel on a note, and an exported key.

**Tests:** 82 verify, 37 props, 29 lighting, 27 hex, 25 pro, 25 regions, 16 ext,
16 theme, 53 guards, 58 regress, 8 labels, 8 brushes, 27 generate, 36 notes --
447 checks, all passing, plus `battle`, over two full back-to-back rounds.

---

## 2026-09-25 — land from a seed, and a fill that follows the coast

Anthony's working copy matched `origin/main` across all 69 tracked source files,
so this could be a feature day. The baseline was green: 342 checks across twelve
suites, plus `battle`.

**Review.** Three readers in parallel again — the renderer and lighting, the
server, and the front-end state — turned up about twenty candidates. Each was
checked against the code before anything was changed, and every one that was
fixed has a check that was run against a pristine clone of `origin/main` and
**failed there**: 8 of the 9 new guard checks and 7 of the 10 new regression
checks, and all three of the new "fill follows the land" checks against the
current tree with only that fix reverted. The four that pass on both do so on
purpose — they are preconditions: *while localhost by name is still answered*
for the Host checks, and in `regress.mjs` that the light snapped onto the wall,
that unticking Lit puts it out, and that undoing the delete brings the painted
layer back.

**Fixed, server side.**

- *DNS rebinding could read every map.* The Origin guard stops another site
  driving the API, but a page on `attacker.example` that re-points its own name
  at 127.0.0.1 is same-origin with the server, and a same-origin GET carries no
  Origin at all. `/api/state`, `/api/projects` and each map came back 200 to
  `Host: attacker.example:7871`. Any request whose `Host` is not
  `127.0.0.1:<port>` or `localhost:<port>` is now refused with 421 and the
  connection closed, ahead of the routing split like the other guards — a
  rebound page can read static files under `/projects/` just as well. A request
  with no Host at all is not a browser and is left to the other guards.
- *A document nested ~980 deep saved and then broke the Projects tab.* It
  parsed, `projects.write` replaced `project.json`, and the reply — which echoes
  the document two levels deeper — ran out of stack: a 500 for a save that
  landed. The file on disk then raised `RecursionError`, which is a
  `RuntimeError` and not the `ValueError` the loaders catch, so `GET
  /api/projects` went 500 and the whole tab emptied. `write` now refuses
  anything nested more than 64 deep before it makes a folder (a real map is
  about seven), and the four JSON loaders — projects, packs, extensions and
  `config.json` — catch `RecursionError` too.
- *A thumbnail for a deleted map recreated its folder.* `write_blob` made the
  folder it was writing into, so a thumb landing after another tab deleted the
  map left a folder holding only `thumb.png` — invisible in the Projects tab,
  and enough for `unique_slug` to avoid that name for good. The same class as
  the `projects.write` fix of 2026-09-24. Refused with 404 now.

**Fixed, in the editor.**

- *Undoing a Selected-panel edit of a field the item did not have did nothing.*
  Light ops are placed with no `on`; untick Lit, press Ctrl+Z, and
  `Object.assign(item, before)` — which never deletes a key — used up the step
  and left the light out. Same for a stamp's first Opacity and several region
  and label fields. Keys the snapshot lacks are removed first now.
- *A light standing on a wall lit nothing.* Every ray hit the wall at `t = 0`
  and the visibility polygon collapsed to a point. Snapping puts lights exactly
  there — a diagonal wall crosses a square's centre, and hex half-snapping lands
  on corners. A wall through the light itself is now taken as not in the way.
- *Deleting the painted layer, then undoing twice, left the stroke on screen and
  took it out of the file.* The 2026-09-24 fix covered every other layer's
  entries but not the deleted layer's own: the delete dropped its canvases, the
  undo rebuilt it into fresh ones, and its own paint entry then restored into
  the orphan. `forgetLayer` now returns what it dropped and `adoptLayer` puts
  the same canvas objects back; the entry is charged for holding them.
- *Clearing the landmass left the old coast's ink cached.* `renderLand` returned
  on an empty layer before it wiped the ink, and the next stroke nearby tinted
  across the stale cache: 13,166 pixels of old coastline against a rebuild.
- *Ctrl+Z while typing undid the map*, and the history change then rebuilt the
  Selected panel and threw the half-typed text away. Text fields keep it now.
- *Ctrl+Z with nothing to undo marked the map unsaved*, prompted on close and
  had autosave rewrite an identical file. Undo and redo count as edits only when
  they moved.
- *Delete on a selection that had been undone away* pushed a dead entry that
  threw away the redo. The Select tool asks `selectedObject()` first.
- Bare `markDirty()` with no autosave rearm in the Landmass ground picker and in
  both bundled extensions; the coordinates extension's sliders and colour now
  commit on release, since each tick redrew text in every cell of the grid.

**Written up rather than fixed.** Each is real by reading; none was fixed today.

- *map-aging's stains are not in the document.* The command draws straight
  onto the paper canvas, so they vanish on reload and on any paper rebuild, and
  undoing after such a rebuild restores a snapshot with the old vignette in it.
  Fixing it means storing the ageing as paper-layer data — a change to a worked
  example's design, not a patch.
- *Reload extensions leaves extension layers blank* until something invalidates
  them: `loadExtensions` re-registers the kind but, unlike the per-extension
  toggle, neither rebuilds the orphaned layers nor emits `'layers'`.
- *A `setup()` that throws after registering things leaks them*, since the
  extension never reaches `extensions.loaded` for `unloadExtension` to find.
- *Only the first walls layer casts shadows or exports sight lines*
  (`wallSegments` and `toUVTT` use `find`), though every walls layer draws.
- *A save with no `layers` key sweeps every blob and leaves an unopenable map.*
  Not changed, because `guards.mjs` deliberately asserts that saves with
  `layers: null` and `layers: []` succeed; refusing them is a contract change.
- Saved files are created 0600 (`mkstemp`), which matters on a shared folder;
  `tools/import_folder.py --name starter` overwrites the starter pack; Windows
  device names (`nul`, `con`) pass `SLUG_RE`; a non-numeric `port` in
  `config.json` crashes startup outside the `OSError` fallback; a hex grid with
  an offset over one column leaves an edge without lines.

**The feature: land from a seed.** The 2026-09-24 research named seeded
generation the largest category gap, and today's check agreed: Wonderdraft's
Landmass Wizard, Inkarnate's World Generator (whose feature board has requests
for more control over it), Azgaar's heightmap templates and Watabou's whole line
all start you at something to push around, and Cartograph started you at a
blank page. Rejected today: pins with an exported key (good, and next in line —
it needs the export allow-list and `safe.py` work), prefabs and copy/paste (a
larger change to the Select tool), print tiling (a PDF writer), and GM/player
export (small, and better paired with pins).

*Generate land…* sits at the top of the Landmass panel and in the palette. A
dialog with a live preview offers a seed (typed, or re-rolled as three readable
words), eight shapes — one continent, a single island, an archipelago, scattered
lands, and a coast to each compass point — land share, feature size, how ragged
the coast is, whether to keep clear of the frame, and whether to replace or add
to the land already there. The decisions worth knowing:

- **The document is ops, so the height field is not stored.** It is
  thresholded, traced into closed rings with marching squares, simplified with
  Douglas-Peucker, and written as one ordinary landmass op:
  `{ t: 'stroke', mode: 'shape', shape: 'generated', rings: [[x, y, …], …],
  gen: {…settings}, points: [corners] }`. The rings are saved, not just the
  seed, so a map reopens pixel-identical even if a later generator draws that
  seed differently; the settings are kept beside them so the result can be read
  and re-rolled. A continent is about 8 kB. `points` holds the extent's two
  corners, which is what every existing box function already reads, so nothing
  downstream needed teaching.
- **Rings are filled even-odd**, in one new branch of `applyMaskStroke`, so a
  lake inside a continent and an island in the lake come out right without
  anyone deciding which ring is which. Everything after the mask — the shelf,
  the ink, the texture, the eraser — is the existing landmass pipeline.
- **Sea level is picked by rank**, so *Land 40%* is forty per cent whatever the
  seed did to the heights (40.3% measured).
- **The trace is padded** with a ring of edge heights carried 24 px past the
  frame and then deep sea, so every contour closes, and land that meets the
  frame carries on past it instead of growing an ink line along the border.
- **Replace is a `clear` op then the new land**, which the mask replay has
  always honoured, so the step undoes to exactly the land that was there.
- Noise is hashed value noise with a domain warp and each octave turned against
  the last. Before the base octave was turned too, several seeds on the
  tuning sheet had a ruler-straight north-south coast; the tuning was done against a sheet of
  seeds for every shape, in a screenshot.

**And a fill that follows the coast.** A Fill set to *Inside the landmass* was
already meant to follow a redrawn coast, and did not: it is baked into its
raster layer like any stroke, and nothing redrew that layer when the mask
changed — the generator would have made that obvious on the first click.
`followLand()` rebuilds every paint layer holding a land- or sea-bound fill, and
is called from `invalidate` on a landmass and from the Landmass brush's commit,
undo and redo; a paint entry on such a layer rebuilds instead of restoring a
snapshot taken against the old coast. Separately, `setDocument` rebuilds the
landmass first, because `doc.layers` is bottom-first and a fill layer *below* a
see-through landmass was rebuilt against an empty mask on opening, and vanished.
Measured: 94,501 samples differed from a rebuild after regenerating with the
fix reverted, and 1,378 after one brush stroke; none with it.

**Tests.** A new suite, `test/generate.mjs` (27): determinism to the byte, the
op's shape and size, the dialog and its preview, cancel, the land share, edge
clearance, the eraser on generated land, the round trip, replace and add with
undo and redo to identical pixels, a west coast meeting the frame without a
coastline, a lake as a hole, the fill following regeneration and the brush, the
load order, and the palette. `guards.mjs` 35 → 44, `regress.mjs` 34 → 44.

**Tests:** 82 verify, 37 props, 29 lighting, 27 hex, 25 pro, 25 regions, 16 ext,
16 theme, 44 guards, 44 regress, 8 labels, 8 brushes, 27 generate — 388 checks,
all passing, plus `battle`, over two full back-to-back rounds.

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
