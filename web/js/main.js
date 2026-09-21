/* Boot and top-bar wiring. */

import { api } from './api.js';
import { app, boot, emit, markDirty, newMap, on, saveProject, scheduleAutosave } from './app.js';
import { canRedo, canUndo, history, redo, undo } from './history.js';
import { layerVisible } from './doc.js';
import * as R from './render.js';
import { initInput } from './input.js';
import { extensions, loadExtensions, renderExtensionLayer } from './extensions.js';
import { initPalette } from './palette.js';
import { initTabs, newMapDialog, openProject, showTab } from './tabs.js';
import { initUI, renderHistory, renderToolOptions } from './ui.js';
import { $, el, modal, toast } from './util.js';

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
  else await newMap({ name: 'Untitled Map' });

  $('#hud-size').textContent = `${app.doc.width} × ${app.doc.height}`;
  $('#hud-zoom').textContent = Math.round(R.view.zoom * 100) + '%';
  R.view.onAfterDraw = () => {
    $('#hud-zoom').textContent = Math.round(R.view.zoom * 100) + '%';
  };
  refreshHistoryButtons();
}

function wireTopbar() {
  $('#btn-save').addEventListener('click', () => doSave());
  $('#btn-export').addEventListener('click', exportDialog);
  // scheduleAutosave alongside markDirty, as every other edit does. Without it
  // an undo after the last autosave had already fired left the document dirty
  // for good: nothing ever rearmed the timer, so the file on disk kept the
  // stroke that had been undone.
  $('#btn-undo').addEventListener('click', () => { undo(); refreshHistoryButtons(); markDirty(); scheduleAutosave(); });
  $('#btn-redo').addEventListener('click', () => { redo(); refreshHistoryButtons(); markDirty(); scheduleAutosave(); });

  const nameField = $('#project-name');
  nameField.addEventListener('change', () => {
    if (!app.doc) return;
    app.doc.name = nameField.value.trim() || 'Untitled Map';
    markDirty();
  });

  history.onChange = refreshHistoryButtons;

  on('dirty', (dirty) => {
    const state = $('#save-state');
    state.classList.toggle('is-dirty', dirty);
    state.textContent = dirty ? 'unsaved changes' : (app.slug ? 'saved' : 'not saved yet');
  });
  on('saved', () => { $('#save-state').textContent = 'saved'; });
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
    if (key === 's') { ev.preventDefault(); doSave(); }
    else if (key === 'e') { ev.preventDefault(); exportDialog(); }
    else if (key === 'n') { ev.preventDefault(); newMapDialog(); }
    else if (key === 'z') {
      ev.preventDefault();
      if (ev.shiftKey) redo(); else undo();
      refreshHistoryButtons();
      markDirty(); scheduleAutosave();
    } else if (key === 'y') { ev.preventDefault(); redo(); refreshHistoryButtons(); markDirty(); scheduleAutosave(); }
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

  const canvas = R.flatten({ scale: parseFloat(scale.value), grid: grid.checked,
                             paper: paper.checked, lights: lights.checked });
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  const name = (app.doc.name || 'map').replace(/[^\w \-]+/g, '').trim() || 'map';
  try {
    const res = await api.exportImage(name + '.png', blob);
    toast('Exported to ' + res.path, 'good');
  } catch (err) {
    toast('Export failed: ' + err.message, 'bad');
  }
  if (vtt.checked) {
    try {
      // The tabletop does its own lighting, so it gets the map unlit and the
      // lights as data — otherwise the two stack and the map comes out washed.
      const full = R.flatten({ scale: 1, grid: grid.checked, paper: paper.checked, lights: false });
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
