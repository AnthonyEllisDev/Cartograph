/* Boot and top-bar wiring. */

import { api } from './api.js';
import { app, boot, emit, markDirty, newMap, on, saveProject, scheduleAutosave } from './app.js';
import { canRedo, canUndo, history, redo, undo } from './history.js';
import { keyMarkdown, layerVisible, noteKey } from './doc.js';
import * as R from './render.js';
import { initInput } from './input.js';
import { extensions, loadExtensions, renderExtensionLayer } from './extensions.js';
import { initPalette, paletteOpen } from './palette.js';
import { initTabs, newMapDialog, openProject, showTab } from './tabs.js';
import { initUI, renderHistory, renderSelection, renderToolOptions } from './ui.js';
import { $, el, modal, modalOpen, toast } from './util.js';
import { copySelection, cutSelection, duplicateSelection, paste } from './clipboard.js';
import { selectAll } from './tools.js';
import { printDialog } from './print.js';

async function start() {
  R.initRender($('#canvas'));

  try {
    await boot();
  } catch (err) {
    document.body.innerHTML =
      `<div style="padding:40px;font:14px system-ui;color:#e7eaf0">
         <h2>Cartograph could not reach its own server.</h2>
         <p style="color:#98a1b0">${err.message}. Close this tab, stop the program and start it again.</p>
       </div>`;
    return;
  }

  // Extensions load before the first document so a layer kind one of them adds
  // is understood by the time a saved map that uses it is opened.
  R.view.renderCustomLayer = renderExtensionLayer;
  await loadExtensions();

  R.view.showScaleBar = app.settings.showScaleBar !== false;

  initTabs();
  initUI();
  initInput();
  initPalette();
  wireTopbar();

  // Pick up where we left off, if there is anything to pick up.
  const { projects } = await api.projects();
  if (projects.length) await openProject(projects[0].slug);
  // openProject reports a map that will not open and carries on, so the
  // editor came up with no document and threw on the next line. A blank map
  // is a better welcome than a dead one.
  if (!app.doc) await newMap({ name: 'Untitled Map' });

  $('#hud-size').textContent = `${app.doc.width} × ${app.doc.height}`;
  $('#hud-zoom').textContent = Math.round(R.view.zoom * 100) + '%';
  R.view.onAfterDraw = () => {
    $('#hud-zoom').textContent = Math.round(R.view.zoom * 100) + '%';
  };
  refreshHistoryButtons();
}

/** Undo or redo one step, and count it as an edit only if there was a step.
 *  Ctrl+Z on a freshly opened map used to mark it unsaved, prompt on close and
 *  have autosave rewrite an identical file. */
function stepHistory(step) {
  const moved = step();
  refreshHistoryButtons();
  if (moved) { markDirty(); scheduleAutosave(); }
}

function wireTopbar() {
  $('#btn-save').addEventListener('click', () => doSave());
  $('#btn-export').addEventListener('click', exportDialog);
  $('#btn-print').addEventListener('click', printDialog);
  // scheduleAutosave alongside markDirty, as every other edit does. Without it
  // an undo after the last autosave had already fired left the document dirty
  // for good: nothing ever rearmed the timer, so the file on disk kept the
  // stroke that had been undone.
  $('#btn-undo').addEventListener('click', () => stepHistory(undo));
  $('#btn-redo').addEventListener('click', () => stepHistory(redo));

  const nameField = $('#project-name');
  nameField.addEventListener('change', () => {
    if (!app.doc) return;
    app.doc.name = nameField.value.trim() || 'Untitled Map';
    markDirty(); scheduleAutosave();
  });

  // Any history move can put the selected thing back, take it away, or change
  // what its fields say, so the properties panel is rebuilt with the buttons.
  history.onChange = () => { refreshHistoryButtons(); renderSelection(); };

  on('dirty', (dirty) => {
    const state = $('#save-state');
    state.classList.toggle('is-dirty', dirty);
    state.textContent = dirty ? 'unsaved changes' : (app.slug ? 'saved' : 'not saved yet');
  });
  // saveProject leaves the document dirty when something changed while it was
  // writing; the label must not say otherwise.
  on('saved', () => { if (!app.dirty) $('#save-state').textContent = 'saved'; });
  on('autosaved', () => toast('Autosaved', 'good'));
  on('document', () => {
    $('#hud-size').textContent = `${app.doc.width} × ${app.doc.height}`;
    $('#project-name').value = app.doc.name;
  });
  window.addEventListener('cartograph:tool-options', renderToolOptions);

  window.addEventListener('keydown', (ev) => {
    const mod = ev.ctrlKey || ev.metaKey;
    if (!mod) return;
    const key = ev.key.toLowerCase();
    const t = ev.target;
    const typing = t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement
      || (t instanceof HTMLInputElement && !['range', 'checkbox', 'color', 'button'].includes(t.type));
    // Undo and the clipboard act on the map, and a dialog on screen is still
    // waiting on the map as it was when it opened.
    const onMap = !typing && !modalOpen() && !paletteOpen();
    if (paletteOpen() && (key === 'e' || key === 'n' || key === 'p')) { ev.preventDefault(); return; }
    if (key === 's') { ev.preventDefault(); doSave(); }
    else if (key === 'e') { ev.preventDefault(); exportDialog(); }
    // The browser's own print would put the editor on paper, toolbars and
    // all, at whatever size fits; nobody wants that from a map maker.
    else if (key === 'p') { ev.preventDefault(); printDialog(); }
    else if (key === 'n') { ev.preventDefault(); newMapDialog(); }
    else if (key === 'z' || key === 'y') {
      // Inside a text field these belong to the field. Taking them undid a
      // brush stroke while someone was retyping a label, and the history
      // change then rebuilt the Selected panel under them and lost the text.
      if (!onMap) return;
      ev.preventDefault();
      stepHistory(key === 'y' || ev.shiftKey ? redo : undo);
    }
    else if (key === 'a') {
      // Everything on the map, picked up with the Select tool. In a field it
      // selects the field's text, as it always did.
      if (!onMap || ev.shiftKey || ev.altKey) return;
      ev.preventDefault();
      selectAll();
    }
    else if (key === 'c' || key === 'x' || key === 'v' || key === 'd') {
      // Copy and cut belong to the Select tool. Under any other tool Ctrl+C is
      // left to the browser, which may be copying text off a panel; paste and
      // duplicate pick the Select tool up themselves.
      if (!onMap || ev.shiftKey || ev.altKey) return;
      if (key === 'v') { ev.preventDefault(); paste(); return; }
      if (app.tool !== 'select' && key !== 'd') return;
      ev.preventDefault();
      if (key === 'c') copySelection();
      else if (key === 'x') cutSelection();
      else duplicateSelection();
    }
  });

  window.addEventListener('beforeunload', (ev) => {
    if (!app.dirty) return undefined;
    ev.preventDefault();
    ev.returnValue = '';
    return '';
  });
}

function refreshHistoryButtons() {
  $('#btn-undo').disabled = !canUndo();
  $('#btn-redo').disabled = !canRedo();
  renderHistory();
}

async function doSave() {
  try {
    await saveProject();
  } catch (err) {
    toast('Save failed: ' + err.message, 'bad');
  }
}

async function exportDialog() {
  if (!app.doc) return;
  const scale = el('select', {}, [
    el('option', { value: '0.5', text: 'Half size' }),
    el('option', { value: '1', text: 'Full size', selected: true }),
    el('option', { value: '2', text: 'Double size (print)' }),
  ]);
  const grid = el('input', { type: 'checkbox' }); grid.checked = true;
  const paper = el('input', { type: 'checkbox' }); paper.checked = true;
  const download = el('input', { type: 'checkbox' }); download.checked = true;
  const note = el('p', { class: 'muted', text: '' });
  const sizeNote = () => {
    const s = parseFloat(scale.value);
    note.textContent = `Image will be ${Math.round(app.doc.width * s)} × ${Math.round(app.doc.height * s)} pixels.`;
  };
  scale.addEventListener('change', sizeNote);
  sizeNote();

  const walls = app.doc.layers.find((l) => l.kind === 'walls');
  const lit = app.doc.layers.find((l) => l.kind === 'lights'
    && layerVisible(app.doc, l) && l.ambient > 0);
  const hexGrid = app.doc.layers.find((l) => l.kind === 'grid' && l.type === 'hex');
  const lights = el('input', { type: 'checkbox' }); lights.checked = true;
  // Only the notes that would be drawn: hiding the notes layer is how a map
  // goes out to the players with no pins and no key.
  const key = noteKey(app.doc);
  const pins = el('input', { type: 'checkbox' }); pins.checked = true;
  const keyBeside = el('input', { type: 'checkbox' }); keyBeside.checked = true;
  const keyFile = el('input', { type: 'checkbox' }); keyFile.checked = true;
  const noteCount = key.reduce((n, sct) => n + sct.entries.length, 0);
  const vtt = el('input', { type: 'checkbox' });
  vtt.checked = !!(walls && walls.ops.length);

  let go = false;
  await modal({
    title: 'Export',
    body: el('div', {}, [
      el('div', { class: 'field' }, [el('label', { text: 'Resolution' }), scale]),
      el('label', { class: 'check' }, [grid, el('span', { text: 'Include the grid' })]),
      el('label', { class: 'check' }, [paper, el('span', { text: 'Include the paper and border' })]),
      lit ? el('label', { class: 'check' }, [lights, el('span', { text: 'Include the lighting' })]) : null,
      key.length ? el('label', { class: 'check' }, [pins, el('span', {
        text: `Include the note pins (${noteCount})` })]) : null,
      key.length ? el('label', { class: 'check' }, [keyBeside, el('span', {
        text: 'Set the key beside the image' })]) : null,
      key.length ? el('label', { class: 'check' }, [keyFile, el('span', {
        text: 'Also write the key as a Markdown file' })]) : null,
      el('label', { class: 'check' }, [download, el('span', { text: 'Also download a copy' })]),
      el('label', { class: 'check' }, [vtt, el('span', {
        text: 'Also write a Universal VTT file' + (walls ? '' : ' (this map has no walls layer)') })]),
      note,
      // The format has no field for a hex grid, so saying nothing would mean
      // shipping a square-gridded scene and letting them find out.
      hexGrid ? el('p', { class: 'muted', text:
        'This is a hex map, and the Universal VTT format has no field for hex grids. '
        + 'The walls and the image go across correctly and the cells line up — you just pick '
        + 'the hex grid type once on the tabletop side after importing.' }) : null,
      el('p', { class: 'muted', text:
        'A copy is always written to the exports folder next to the program. The .dd2vtt file ' +
        'carries the walls, doors and light sources as data, so a virtual tabletop imports the ' +
        'map with its line of sight already built. Its image is written without the darkness, ' +
        'because a tabletop that lights an already-lit map washes it out.' }),
    ]),
    buttons: [{ label: 'Cancel' }, { label: 'Export', class: 'btn-primary', onClick: () => { go = true; } }],
  });
  if (!go) return;

  let canvas = R.flatten({ scale: parseFloat(scale.value), grid: grid.checked,
                           paper: paper.checked, lights: lights.checked, notes: pins.checked });
  if (key.length && keyBeside.checked) canvas = R.withKey(canvas, key, app.doc.name);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  const name = (app.doc.name || 'map').replace(/[^\w \-]+/g, '').trim() || 'map';
  let written = null;
  try {
    const res = await api.exportImage(name + '.png', blob);
    written = res.path;
    toast('Exported to ' + res.path, 'good');
  } catch (err) {
    toast('Export failed: ' + err.message, 'bad');
  }
  if (key.length && keyFile.checked) {
    // Named after the image it goes with, which the server may have numbered
    // ("map-2.png") to avoid writing over an earlier export.
    const stem = written ? written.split(/[\\/]/).pop().replace(/\.png$/i, '') : name;
    try {
      const res = await api.exportImage(stem + '-key.md',
        new Blob([keyMarkdown(app.doc)], { type: 'text/markdown' }));
      toast('Key written to ' + res.path, 'good');
    } catch (err) {
      toast('Key export failed: ' + err.message, 'bad');
    }
  }
  if (vtt.checked) {
    try {
      // The tabletop does its own lighting, so it gets the map unlit and the
      // lights as data — otherwise the two stack and the map comes out washed.
      const full = R.flatten({ scale: 1, grid: grid.checked, paper: paper.checked, lights: false,
                               notes: pins.checked });
      const payload = R.toUVTT(full.toDataURL('image/png'), { bakedLighting: false });
      const res = await api.exportImage(name + '.dd2vtt',
        new Blob([JSON.stringify(payload)], { type: 'application/json' }));
      toast('Tabletop file written to ' + res.path, 'good');
    } catch (err) {
      toast('VTT export failed: ' + err.message, 'bad');
    }
  }

  if (download.checked) {
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: name + '.png' });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
}

// A small handle for the test suite and for anyone poking at the program in
// the browser console. It exposes state, never behaviour.
window.__cg = { app, R, mapToScreen: R.mapToScreen, screenToMap: R.screenToMap, history };
window.__cgx = { extensions };

start();
