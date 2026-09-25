/* The command palette.
 *
 * Ctrl+K. Everything the program can do in one list you can type at: tools,
 * layers, tabs, and whatever commands extensions have added. It exists because
 * a program with fourteen tools and four tabs has more in it than a toolbar can
 * show, and hunting through menus for something you already know the name of is
 * the slowest way to use software.
 */

import { app, emit, markDirty, saveProject, scheduleAutosave } from './app.js';
import { extensions } from './extensions.js';
import { generateDialog } from './generate.js';
import { jumpTo, redo, undo } from './history.js';
import { allPresets, applyPreset } from './presets.js';
import * as R from './render.js';
import { TOOLS, setTool } from './tools.js';
import { renderAssetPicker, renderToolOptions } from './ui.js';
import { $, el, toast } from './util.js';

let root = null;
let items = [];
let filtered = [];
let cursor = 0;

const BUILT_IN = [
  { id: 'save', group: 'File', title: 'Save the map', keys: 'Ctrl+S', run: () => saveProject() },
  { id: 'fit', group: 'View', title: 'Fit the map in the window', keys: '0', run: () => R.fitView() },
  { id: 'zoom-100', group: 'View', title: 'Zoom to 100%', run: () => { R.view.zoom = 1; R.requestDraw(); } },
  // markDirty and scheduleAutosave travel together. The toolbar buttons were
  // fixed for this and these duplicates were not: an undo after the last
  // autosave had fired marked the document dirty and rearmed nothing, so the
  // step that was undone stayed in project.json for good.
  { id: 'undo', group: 'Edit', title: 'Undo', keys: 'Ctrl+Z',
    run: () => { if (undo()) { markDirty(); scheduleAutosave(); } } },
  { id: 'redo', group: 'Edit', title: 'Redo', keys: 'Ctrl+Shift+Z',
    run: () => { if (redo()) { markDirty(); scheduleAutosave(); } } },
  { id: 'revert-all', group: 'Edit', title: 'Go back to the start of this session',
    detail: 'Undoes everything still in the history',
    run: () => { jumpTo(0); markDirty(); scheduleAutosave(); R.requestDraw(); } },
  { id: 'generate-land', group: 'Map', title: 'Generate land…',
    detail: 'Grow a coastline from a seed onto the Landmass layer',
    run: () => generateDialog() },
  { id: 'scale-bar', group: 'View', title: 'Show or hide the scale bar',
    run: () => {
      app.settings.showScaleBar = !(app.settings.showScaleBar !== false);
      R.view.showScaleBar = app.settings.showScaleBar;
      R.requestDraw();
    } },
];

function collect() {
  const out = [];
  for (const tool of Object.values(TOOLS)) {
    out.push({
      id: 'tool:' + tool.id, group: 'Tool', title: tool.label,
      detail: tool.hint || '', run: () => setTool(tool.id),
    });
  }
  for (const cmd of BUILT_IN) out.push(cmd);
  for (const preset of allPresets()) {
    const tool = TOOLS[preset.tool];
    if (!tool) continue;
    out.push({
      id: 'preset:' + preset.id, group: 'Preset', title: preset.name,
      detail: tool.label,
      run: () => {
        setTool(preset.tool);
        applyPreset(preset.id);
        renderToolOptions(); renderAssetPicker(); R.requestDraw();
      },
    });
  }
  for (const cmd of extensions.commands) {
    out.push({
      id: 'ext:' + cmd.id, group: cmd.group || 'Extension', title: cmd.title,
      detail: cmd.detail || '', keys: cmd.keys,
      run: () => {
        try { cmd.run(); } catch (err) { toast(String(err.message || err), 'bad'); }
      },
    });
  }
  if (app.doc) {
    for (const layer of app.doc.layers) {
      out.push({
        id: 'layer:' + layer.id, group: 'Layer', title: 'Select ' + layer.name,
        run: () => { app.activeLayerId = layer.id; emit('layers'); },
      });
      out.push({
        id: 'layer-vis:' + layer.id, group: 'Layer', title: (layer.visible ? 'Hide ' : 'Show ') + layer.name,
        run: () => {
          layer.visible = !layer.visible;
          // Hiding the walls has to relight: see render.relight.
          R.relight(layer);
          R.compositeAll(); R.requestDraw(); markDirty(); scheduleAutosave(); emit('layers');
        },
      });
    }
  }
  for (const tab of ['map', 'assets', 'projects', 'extensions', 'settings']) {
    out.push({
      id: 'tab:' + tab, group: 'Go to', title: tab[0].toUpperCase() + tab.slice(1) + ' tab',
      run: () => document.querySelector(`.tab[data-tab="${tab}"]`).click(),
    });
  }
  return out;
}

/** Subsequence match, the way every command palette works: "flw" finds
 *  "Fit the map in the window". */
function score(text, query) {
  if (!query) return 0.001;
  const haystack = text.toLowerCase();
  let i = 0, hits = 0, run = 0, best = 0;
  for (const ch of query.toLowerCase()) {
    const at = haystack.indexOf(ch, i);
    if (at < 0) return -1;
    run = at === i ? run + 1 : 1;
    best = Math.max(best, run);
    hits += at === 0 ? 3 : 1;
    i = at + 1;
  }
  return hits + best * 2 - haystack.length * 0.01;
}

function render(list, query) {
  const body = $('.palette-list', root);
  body.innerHTML = '';
  if (!list.length) {
    body.appendChild(el('div', { class: 'palette-empty', text: 'Nothing matches “' + query + '”' }));
    return;
  }
  list.forEach((item, i) => {
    body.appendChild(el('button', {
      class: 'palette-item' + (i === cursor ? ' is-active' : ''),
      onclick: () => { close(); item.run(); },
      onmousemove: () => { if (cursor !== i) { cursor = i; render(list, query); } },
    }, [
      el('span', { class: 'pgroup', text: item.group }),
      el('span', { class: 'ptitle', text: item.title }),
      item.keys ? el('kbd', { text: item.keys }) : null,
    ]));
  });
}

export function open() {
  if (root) return;
  items = collect();
  filtered = items.slice(0, 40);
  cursor = 0;
  const input = el('input', { type: 'text', placeholder: 'Type a command…', spellcheck: 'false' });
  root = el('div', { class: 'palette-root', onclick: (e) => { if (e.target === root) close(); } }, [
    el('div', { class: 'palette' }, [
      el('div', { class: 'palette-head' }, [input]),
      el('div', { class: 'palette-list' }),
    ]),
  ]);
  document.body.appendChild(root);
  const update = () => {
    const q = input.value.trim();
    filtered = items
      .map((item) => ({ item, s: score(item.group + ' ' + item.title, q) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 40)
      .map((x) => x.item);
    cursor = 0;
    render(filtered, q);
  };
  input.addEventListener('input', update);
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown') { cursor = Math.min(filtered.length - 1, cursor + 1); render(filtered, input.value); ev.preventDefault(); }
    else if (ev.key === 'ArrowUp') { cursor = Math.max(0, cursor - 1); render(filtered, input.value); ev.preventDefault(); }
    else if (ev.key === 'Enter') { const item = filtered[cursor]; close(); if (item) item.run(); }
    else if (ev.key === 'Escape') close();
  });
  update();
  input.focus();
}

export function close() {
  if (!root) return;
  root.remove();
  root = null;
}

export function initPalette() {
  window.addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') {
      ev.preventDefault();
      if (root) close(); else open();
      return;
    }
    if (root) return;
    // extension shortcuts
    for (const cmd of extensions.commands) {
      if (!cmd.shortcut) continue;
      if (matches(cmd.shortcut, ev)) {
        ev.preventDefault();
        try { cmd.run(); } catch (err) { toast(String(err.message || err), 'bad'); }
        return;
      }
    }
  });
}

function matches(shortcut, ev) {
  const parts = String(shortcut).toLowerCase().split('+').map((p) => p.trim());
  const key = parts.pop();
  const wantCtrl = parts.includes('ctrl') || parts.includes('cmd');
  const wantShift = parts.includes('shift');
  const wantAlt = parts.includes('alt');
  return ev.key.toLowerCase() === key &&
         !!(ev.ctrlKey || ev.metaKey) === wantCtrl &&
         ev.shiftKey === wantShift && ev.altKey === wantAlt;
}
