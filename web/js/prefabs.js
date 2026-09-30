/* Prefabs: a set of things saved off one map to be put down on another.
 *
 * Copy and paste already carries a furnished room from one map to the next,
 * but only for as long as the page is open. A prefab is the same set written
 * to prefabs/ beside the program as one readable JSON file, so the guard post
 * built once is there next week, on the next map, and in a friend's copy of
 * the program if the file is handed over. Dungeondraft calls these prefabs
 * and keeps them in a tab; here they sit with the Select tool, because that is
 * the tool that picks a set up and the one that is in hand after placing one.
 *
 * Nothing below the clipboard had to learn anything: a prefab is the
 * clipboard's own {entries, kinds}, and putting one down goes through the
 * same place() as a paste, so it is one undo step, each part lands on a layer
 * of its own kind, walls relight, and the copies are picked up ready to drag.
 *
 * The list is module state, fetched when the Select tool is picked up and
 * after every save or delete. It is a list of files on disk rather than part
 * of any map, so it is never in the undo history: saving a prefab changes no
 * map, and deleting one is a file going from a folder, which is why it asks.
 */

import { app, emit } from './app.js';
import { api } from './api.js';
import { OBJECT_NOUNS, gridStepPx, kindOf } from './doc.js';
import { placeSet, selectionAsSet } from './clipboard.js';
import * as R from './render.js';
import { clamp, el, modal, toast } from './util.js';

let list = [];

export function prefabs() { return list; }

/** Re-read prefabs/ from disk. A file dropped in by hand turns up the next
 *  time the Select tool is picked, with no rescan button to find. */
export async function loadPrefabs() {
  try {
    const res = await api.prefabs();
    list = Array.isArray(res.prefabs) ? res.prefabs : [];
  } catch (err) {
    // The server refuses nothing here but a broken folder; an empty list is
    // the honest picture of that, and the editor must carry on regardless.
    list = [];
  }
  emit('prefabs');
  return list;
}

/** "3 walls, 2 lights", for a chip's tooltip and the save dialog. */
export function describeKinds(kinds) {
  const counts = new Map();
  for (const k of kinds) {
    const noun = OBJECT_NOUNS[k] || 'thing';
    counts.set(noun, (counts.get(noun) || 0) + 1);
  }
  return [...counts].map(([noun, n]) => n + ' ' + noun + (n > 1 ? (/(s|x|ch|sh)$/.test(noun) ? 'es' : 's') : '')).join(', ');
}

/** Save what the Select tool is holding as a prefab, asking for its name. */
export async function saveSelectionAsPrefab() {
  const set = selectionAsSet();
  if (!set) { toast('Pick something up with the Select tool first'); return null; }
  const input = el('input', { type: 'text', value: suggestName(set.kinds) });
  let ok = false;
  input.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    const save = document.querySelector('.modal .foot .btn-primary');
    if (save) save.click();
  });
  await modal({
    title: 'Save as prefab',
    body: el('div', {}, [
      el('div', { class: 'field' }, [el('label', { text: 'Name' }), input]),
      el('p', { class: 'muted small', text: set.entries.length === 1
        ? 'One thing, saved to the prefabs folder beside the program.'
        : set.entries.length + ' things (' + describeKinds(set.kinds) + '), saved to the prefabs folder beside the program.' }),
    ]),
    buttons: [{ label: 'Cancel' },
              { label: 'Save', class: 'btn-primary', onClick: () => { ok = true; } }],
  });
  if (!ok) return null;
  const name = input.value.trim() || 'Prefab';
  try {
    const res = await api.savePrefab({
      name,
      entries: set.entries,
      kinds: set.kinds,
      // Recorded so a map on a different grid can say so when the prefab is
      // put down on it; see placePrefab.
      cell: app.doc ? gridStepPx(app.doc) : null,
      mapKind: app.doc ? app.doc.kind : null,
    });
    await loadPrefabs();
    toast('Saved “' + res.prefab.name + '”', 'good');
    return res.prefab;
  } catch (err) {
    toast('Could not save the prefab: ' + err.message, 'bad');
    return null;
  }
}

function suggestName(kinds) {
  const kind = new Set(kinds).size === 1 ? kindOf({ kind: kinds[0] }).label : 'Set';
  let n = 1;
  const names = new Set(list.map((p) => p.name));
  while (names.has(kind + ' ' + n)) n += 1;
  return kind + ' ' + n;
}

/** Where a prefab goes down: the middle of what is on screen, pulled onto the
 *  map. The button that asked for it is in the rail, so the pointer is nowhere
 *  useful, and the saved positions belong to the map it came off. */
function viewCentre() {
  const doc = app.doc;
  const c = R.view.canvas;
  if (!c) return { x: doc.width / 2, y: doc.height / 2 };
  const p = R.screenToMap(c.width / R.view.dpr / 2, c.height / R.view.dpr / 2);
  return { x: clamp(p.x, 0, doc.width), y: clamp(p.y, 0, doc.height) };
}

/** Put a prefab down in the middle of the view as one undo step, picked up
 *  so it can be dragged straight to where it belongs. */
export function placePrefab(slug, at = null) {
  const prefab = list.find((p) => p.slug === slug);
  if (!prefab || !app.doc) return false;
  const done = placeSet(prefab.entries, prefab.kinds, at || viewCentre(), 'Place ' + prefab.name);
  if (!done) return false;
  // Positions go down at the size they were drawn. On a map whose grid is a
  // different size that is not wrong -- a stamp is as big as it was -- but
  // walls drawn along one grid will not sit on another's lines, so say so
  // rather than let it be found later.
  const here = gridStepPx(app.doc);
  if (prefab.cell && here && Math.abs(prefab.cell - here) > 0.5) {
    toast(`Saved on a ${Math.round(prefab.cell)}-px grid; this map's is ${Math.round(here)} px, so it keeps its saved size`);
  }
  return true;
}

export async function deletePrefab(slug) {
  const prefab = list.find((p) => p.slug === slug);
  if (!prefab) return false;
  let go = false;
  await modal({
    title: 'Delete this prefab?',
    body: `“${prefab.name}” will be removed from the prefabs folder. Maps it was placed on keep their copies.`,
    buttons: [{ label: 'Keep it' },
              { label: 'Delete', class: 'btn-danger', onClick: () => { go = true; } }],
  });
  if (!go) return false;
  try {
    await api.deletePrefab(slug);
  } catch (err) {
    toast('Could not delete the prefab: ' + err.message, 'bad');
  }
  await loadPrefabs();
  return true;
}

/** The Prefabs strip under the Select tool's options: one chip per prefab,
 *  click to put it down, x to delete it, and a link to save what is held.
 *  Built from text nodes: a prefab's name comes out of a file anyone could
 *  have written, and interpolating it into innerHTML is how that file would
 *  become script running as the editor. */
export function prefabStrip({ canSave }) {
  const wrap = el('div', { class: 'presets prefabs', 'data-prefabs': String(list.length) });
  wrap.appendChild(el('div', { class: 'presets-head' }, [
    el('span', { text: 'Prefabs' }),
    el('button', {
      class: 'link', text: 'Save selection…', 'data-action': 'save-prefab',
      disabled: canSave ? null : '', title: canSave ? '' : 'Pick something up first',
      onclick: () => saveSelectionAsPrefab(),
    }),
  ]));
  if (!list.length) {
    wrap.appendChild(el('p', { class: 'empty', text:
      'Pick up a room\'s walls, doors, lights and furniture and save them here, and put the whole set down again on any map.' }));
    return wrap;
  }
  const row = el('div', { class: 'preset-row' });
  for (const prefab of list) {
    row.appendChild(el('span', { class: 'chip', 'data-prefab': prefab.slug }, [
      el('button', {
        class: 'chip-main', text: prefab.name,
        title: prefab.entries.length + ' things: ' + describeKinds(prefab.kinds) + '. Click to put it down in the middle of the view.',
        onclick: () => placePrefab(prefab.slug),
      }),
      el('button', {
        class: 'chip-x', text: '×', title: 'Delete this prefab', 'aria-label': 'Delete ' + prefab.name,
        onclick: () => deletePrefab(prefab.slug),
      }),
    ]));
  }
  wrap.appendChild(row);
  return wrap;
}
