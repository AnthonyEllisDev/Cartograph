/* The left and right rails: tool picker, tool options, asset picker, layer
   stack and map properties. Every panel rebuilds itself from app state when an
   event fires, so there is one direction of data flow and no stale widgets. */

import { assetsOfKind, groupNames, library, warm } from './assets.js';
import { app, activeLayer, emit, markDirty, on, saveSettings, scheduleAutosave,
         setActiveLayer, setToolSetting } from './app.js';
import { LAYER_KINDS, gridLayer, gridStepPx, groupOf, layerVisible, makeLayer, membersOf } from './doc.js';
import * as hex from './hex.js';
import { history, jumpTo, pushEntry, timeline } from './history.js';
import { applyPreset, deletePreset, presetsFor, savePreset } from './presets.js';
import { extensions } from './extensions.js';
import { icon } from './icons.js';
import * as R from './render.js';
import { TOOLS, currentTool, setTool, toolForLayer, toolTarget } from './tools.js';
import { $, el, modal, toast } from './util.js';

/* ------------------------------------------------------------------ fields */

export function field(spec, onChange) {
  const wrap = el('div', { class: 'field' });
  const readout = el('b', { text: formatValue(spec, spec.value) });

  if (spec.type === 'toggle') {
    const box = el('input', { type: 'checkbox' });
    box.checked = !!spec.value;
    box.addEventListener('change', () => onChange(box.checked));
    return el('label', { class: 'check' }, [box, el('span', { text: spec.label })]);
  }

  wrap.appendChild(el('label', {}, [el('span', { text: spec.label }),
    spec.type === 'range' ? readout : null]));

  let input;
  if (spec.type === 'range') {
    input = el('input', { type: 'range', min: spec.min, max: spec.max, step: spec.step });
    input.value = spec.value;
    // `commit` sliders drive something too expensive to run sixty times a
    // second. The number under the cursor still tracks the drag; the work
    // happens when the mouse comes up.
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      readout.textContent = formatValue(spec, v);
      if (!spec.commit) onChange(v);
    });
    if (spec.commit) input.addEventListener('change', () => onChange(parseFloat(input.value)));
  } else if (spec.type === 'select') {
    input = el('select');
    for (const [value, label] of spec.options) {
      const opt = el('option', { value, text: label });
      if (String(value) === String(spec.value)) opt.selected = true;
      input.appendChild(opt);
    }
    input.addEventListener('change', () => onChange(input.value));
  } else if (spec.type === 'color') {
    input = el('input', { type: 'color', value: spec.value });
    // A colour input fires on every tick of a drag inside the picker, which is
    // too often for anything that rebuilds a layer or the panel itself.
    input.addEventListener(spec.commit ? 'change' : 'input', () => onChange(input.value));
  } else if (spec.type === 'number') {
    input = el('input', { type: 'number', min: spec.min, max: spec.max, step: spec.step, value: spec.value });
    input.addEventListener('change', () => onChange(parseFloat(input.value)));
  } else {
    input = el('input', { type: 'text', value: spec.value || '' });
    input.addEventListener('change', () => onChange(input.value));
  }
  wrap.appendChild(input);
  return wrap;
}

function formatValue(spec, v) {
  if (spec.percent) return Math.round(v * 100) + '%';
  if (spec.suffix) return (Math.round(v * 100) / 100) + spec.suffix;
  return String(Math.round(v * 100) / 100);
}

/* ----------------------------------------------------------------- toolbar */

export function renderToolbar() {
  const root = $('#toolbar');
  root.innerHTML = '';
  for (const tool of Object.values(TOOLS)) {
    const button = el('button', {
      class: 'tool' + (app.tool === tool.id ? ' is-active' : ''),
      'data-tool': tool.id,
      title: tool.hint || tool.label,
      html: icon(tool.icon) + `<span>${tool.label}</span>`,
      onclick: () => setTool(tool.id),
    });
    root.appendChild(button);
  }
}

/* ------------------------------------------------------------ tool options */

export function renderToolOptions() {
  const root = $('#tool-options');
  root.innerHTML = '';
  const tool = currentTool();
  const panel = el('section', { class: 'panel' });
  panel.appendChild(el('h3', { text: tool.label }));

  // Which layer this tool is about to write to, spelled out. Not knowing that
  // is the single most confusing thing about a layered editor.
  if (tool.writesTo && app.doc) {
    const target = toolTarget(tool);
    const current = activeLayer();
    if (!target) {
      // Offering only a paint layer here left the wall and light tools with a
      // dead end on any map that happened not to have their layer.
      const kind = tool.writesTo.includes('raster') ? 'raster' : tool.writesTo[0];
      const label = (LAYER_KINDS[kind] || {}).label || 'layer';
      panel.appendChild(el('div', { class: 'target is-warn' }, [
        el('span', { text: 'No layer this tool can draw on.' }),
        el('button', {
          class: 'link', text: 'Add a ' + label.toLowerCase() + ' layer',
          onclick: () => {
            if (kind === 'raster') addPaintLayer();
            else insertLayer(makeLayer(kind));
            renderToolOptions();
          },
        }),
      ]));
    } else if (current && current !== target) {
      panel.appendChild(el('div', { class: 'target is-warn' }, [
        el('span', {}, ['Draws on ', el('b', { text: target.name }), ', not the selected ',
                        el('b', { text: current.name }), '.']),
        el('button', { class: 'link', text: 'Select ' + target.name,
                       onclick: () => setActiveLayer(target.id) }),
      ]));
    } else {
      panel.appendChild(el('div', { class: 'target' },
        [el('span', {}, ['Drawing on ', el('b', { text: target.name })])]));
    }
  }

  const specs = tool.options();
  if (!specs.length) panel.appendChild(el('p', { class: 'empty', text: tool.hint || 'No options.' }));
  for (const spec of specs) {
    panel.appendChild(field(spec, (value) => {
      // Built-in tools keep their settings in the shared bag; a tool from an
      // extension keeps its own, and just wants to be told.
      if (tool.onOption) tool.onOption(spec.key, value);
      else setToolSetting(tool.id, spec.key, value);
      if (spec.key === 'size') R.requestDraw();
      if (spec.rerender) renderToolOptions();
    }));
  }
  if (specs.length && tool.hint) panel.appendChild(el('p', { class: 'empty', text: tool.hint }));
  if (specs.length) panel.appendChild(presetStrip(tool));
  root.appendChild(panel);
}

/* ---------------------------------------------------------------- presets */

function presetStrip(tool) {
  const wrap = el('div', { class: 'presets' });
  wrap.appendChild(el('div', { class: 'presets-head' }, [
    el('span', { text: 'Presets' }),
    el('button', {
      class: 'link', text: 'Save current…',
      onclick: async () => {
        const name = await promptFor('Save preset', 'Name', suggestPresetName(tool));
        if (name === null) return;
        savePreset(tool.id, name);
        renderToolOptions();
        toast('Preset saved', 'good');
      },
    }),
  ]));
  const list = presetsFor(tool.id);
  if (!list.length) {
    wrap.appendChild(el('p', { class: 'empty', text:
      'Save the sliders and the texture you have set now, and get them back in one click.' }));
    return wrap;
  }
  const row = el('div', { class: 'preset-row' });
  for (const preset of list) {
    row.appendChild(el('span', { class: 'chip' }, [
      el('button', {
        class: 'chip-main', text: preset.name, title: describePreset(preset),
        onclick: () => {
          applyPreset(preset.id);
          renderToolOptions();
          renderAssetPicker();
          R.requestDraw();
        },
      }),
      el('button', {
        class: 'chip-x', text: '×', title: 'Delete this preset',
        onclick: () => { deletePreset(preset.id); renderToolOptions(); },
      }),
    ]));
  }
  wrap.appendChild(row);
  return wrap;
}

function suggestPresetName(tool) {
  const size = (app.settings.tools[tool.id] || {}).size;
  const asset = tool.assetKind === 'terrain' ? app.settings.activeTexture : app.settings.activeStamp;
  const named = asset ? library.byId.get(asset) : null;
  const base = named ? named.label : tool.label;
  return size ? `${base} ${Math.round(size)}px` : base;
}

function describePreset(preset) {
  return Object.entries(preset.opts)
    .map(([k, v]) => k + ' ' + (typeof v === 'number' ? Math.round(v * 100) / 100 : v))
    .join(' · ');
}

/** A one-field modal, because window.prompt is blocked in some browsers. */
export async function promptFor(title, label, value = '') {
  const input = el('input', { type: 'text', value });
  let ok = false;
  input.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    const save = document.querySelector('.modal .foot .btn-primary');
    if (save) save.click();
  });
  await modal({
    title,
    body: el('div', { class: 'field' }, [el('label', { text: label }), input]),
    buttons: [{ label: 'Cancel' },
              { label: 'Save', class: 'btn-primary', onClick: () => { ok = true; } }],
  });
  return ok ? input.value : null;
}

/* ---------------------------------------------------------- history panel */

export function renderHistory() {
  const root = $('#history-list');
  if (!root) return;
  root.innerHTML = '';
  const entries = timeline();
  const cursor = history.past.length;

  const base = el('li', {
    class: 'hist' + (cursor === 0 ? ' is-here' : ''),
    onclick: () => { jumpTo(0); afterJump(); },
  }, [el('span', { class: 'hist-name', text: 'Opened' })]);
  root.appendChild(base);

  entries.forEach((entry, i) => {
    root.appendChild(el('li', {
      class: 'hist' + (i + 1 === cursor ? ' is-here' : '') + (i + 1 > cursor ? ' is-ahead' : ''),
      onclick: () => { jumpTo(i + 1); afterJump(); },
    }, [
      el('span', { class: 'hist-name', text: entry.label || 'Edit' }),
      el('span', { class: 'hist-n', text: String(i + 1) }),
    ]));
  });

  if (!entries.length) {
    root.appendChild(el('li', { class: 'empty', text: 'Nothing to undo yet.' }));
  }
  const foot = $('#history-foot');
  if (foot) {
    foot.textContent = entries.length
      ? `${entries.length} step${entries.length > 1 ? 's' : ''} · ${Math.round(history.bytes / 1048576)} MB kept`
      : '';
  }
}

function afterJump() {
  markDirty();
  renderHistory();
  renderLayers();
  R.requestDraw();
}

/* ----------------------------------------------------------- asset picker */

const pickerState = { group: { terrain: 'all', stamp: 'all' }, query: '' };

export function renderAssetPicker() {
  const root = $('#asset-picker');
  root.innerHTML = '';
  const tool = currentTool();
  const kind = tool.assetKind;
  if (!kind) return;

  const toLayer = tool.assetTarget === 'layer';
  const panel = el('section', { class: 'panel' });
  panel.appendChild(el('h3', { text: tool.assetLabel || (kind === 'terrain' ? 'Brush texture' : 'Stamps') }));
  if (toLayer) {
    panel.appendChild(el('p', { class: 'empty',
      text: 'Sets the ground the whole layer is made of. Changing it repaints the land you have already drawn.' }));
  }
  root.appendChild(panel);

  const search = el('input', { type: 'text', placeholder: 'Search…', value: pickerState.query });
  search.addEventListener('input', () => { pickerState.query = search.value; paint(); });
  root.appendChild(el('div', { class: 'picker-head' }, [search]));

  const tabs = el('div', { class: 'group-tabs' });
  root.appendChild(tabs);
  const grid = el('div', { class: 'asset-grid' });
  root.appendChild(grid);

  const activeKey = kind === 'terrain' ? 'activeTexture' : 'activeStamp';
  const selectedId = () => (toLayer && tool.currentAsset ? tool.currentAsset() : app.settings[activeKey]);

  function paint() {
    const groups = ['all'].concat(groupNames(kind));
    tabs.innerHTML = '';
    for (const g of groups) {
      tabs.appendChild(el('button', {
        class: pickerState.group[kind] === g ? 'is-active' : '',
        text: g === 'all' ? 'All' : g,
        onclick: () => { pickerState.group[kind] = g; paint(); },
      }));
    }
    const q = pickerState.query.trim().toLowerCase();
    const list = assetsOfKind(kind).filter((a) => {
      if (pickerState.group[kind] !== 'all' && (a.group || 'other') !== pickerState.group[kind]) return false;
      if (q && !(a.label + ' ' + a.id).toLowerCase().includes(q)) return false;
      return true;
    });
    grid.innerHTML = '';
    if (!list.length) {
      grid.appendChild(el('p', { class: 'empty', text: 'Nothing here yet. Add files under the Assets tab.' }));
      return;
    }
    for (const asset of list) {
      const cell = el('div', {
        class: 'asset' + (asset.kind === 'stamp' ? ' is-stamp' : '') +
               (selectedId() === asset.id ? ' is-active' : ''),
        title: asset.label,
        onclick: () => {
          if (toLayer && tool.applyAsset) tool.applyAsset(asset.id);
          else { app.settings[activeKey] = asset.id; saveSettings(); }
          warm([asset.id]).then(() => R.requestDraw());
          paint();
        },
      }, [
        el('img', { src: asset.url, alt: asset.label, loading: 'lazy' }),
        el('span', { class: 'cap', text: asset.label }),
      ]);
      grid.appendChild(cell);
    }
  }
  paint();
}

/* ------------------------------------------------------------------ layers */

export function renderLayers() {
  const list = $('#layer-list');
  list.innerHTML = '';
  const layers = app.doc ? app.doc.layers : [];
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    // A collapsed group's members are folded away, which is the whole point of
    // having one on a map big enough to need it.
    const group = groupOf(app.doc, layer);
    if (group && group.collapsed) continue;
    list.appendChild(layerRow(layer, !!group));
  }
  renderLayerProps();
}

function layerRow(layer, inGroup) {
  const isGroup = layer.kind === 'group';
  const dimmed = !layerVisible(app.doc, layer);
  const row = el('li', {
    class: 'layer' + (layer.id === app.activeLayerId ? ' is-active' : '')
           + (dimmed ? ' is-hidden' : '') + (inGroup ? ' in-group' : '')
           + (isGroup ? ' is-group' : ''),
    draggable: 'true',
    dataset: { id: layer.id },
    onclick: () => selectLayer(layer),
  });
  if (isGroup) {
    const n = membersOf(app.doc, layer).length;
    row.appendChild(el('span', {
      class: 'fold', text: layer.collapsed ? '\u25b8' : '\u25be',
      title: layer.collapsed ? 'Open the group' : 'Fold the group away',
      onclick: (e) => { e.stopPropagation(); layer.collapsed = !layer.collapsed; markDirty(); renderLayers(); },
    }));
    row.title = n + (n === 1 ? ' layer' : ' layers') + ' in this group';
  }
  row.appendChild(el('span', {
    class: 'eye', html: icon(layer.visible ? 'eye' : 'eyeOff'), title: 'Show or hide',
    onclick: (e) => {
      e.stopPropagation();
      layer.visible = !layer.visible;
      // Hiding the walls changes what casts a shadow: see render.relight.
      R.relight(layer);
      R.compositeAll(); R.requestDraw(); markDirty(); scheduleAutosave(); renderLayers();
    },
  }));
  row.appendChild(el('span', { class: 'lname', text: layer.name }));
  row.appendChild(el('span', { class: 'lkind', text: LAYER_KINDS[layer.kind].label }));
  row.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', layer.id);
    row.classList.add('is-dragging');
  });
  row.addEventListener('dragend', () => row.classList.remove('is-dragging'));
  row.addEventListener('dragover', (e) => e.preventDefault());
  row.addEventListener('drop', (e) => {
    e.preventDefault();
    moveLayer(e.dataTransfer.getData('text/plain'), layer.id);
  });
  return row;
}

/** Put a layer into a group, or take it out of whatever it is in.
 *
 * Joining also moves the layer to sit with the group's other members. The
 * group layer marks the top of its run, so a contiguous run below it both
 * reads as a folder in the panel and means something in the draw order — a
 * group whose members are scattered through the stack is a lie about what is
 * drawn on top of what. */
export function setLayerGroup(layer, groupId) {
  const was = layer.group || null;
  const wasAt = app.doc.layers.indexOf(layer);
  if (was === (groupId || null)) return;

  const apply = (id, restoreTo) => {
    if (id) layer.group = id; else delete layer.group;
    if (restoreTo != null) {
      const now = app.doc.layers.indexOf(layer);
      if (now >= 0) app.doc.layers.splice(now, 1);
      app.doc.layers.splice(Math.min(restoreTo, app.doc.layers.length), 0, layer);
    } else if (id) {
      const now = app.doc.layers.indexOf(layer);
      if (now >= 0) app.doc.layers.splice(now, 1);
      const at = app.doc.layers.findIndex((l) => l.id === id);
      app.doc.layers.splice(at < 0 ? app.doc.layers.length : at, 0, layer);
    }
    // Filing the walls inside a hidden group -- or taking them out of one --
    // changes what casts a shadow: see render.relight.
    R.relight(layer);
    R.compositeAll(); R.requestDraw(); emit('layers');
  };
  apply(groupId || null);
  pushEntry({
    label: groupId ? 'Group' : 'Ungroup',
    bytes: 0,
    undo() { apply(was, wasAt); },
    redo() { apply(groupId || null); },
  });
  markDirty();
}

/** A new group, holding whatever is selected to start with. */
export function addGroup() {
  const group = makeLayer('group', { name: 'Group ' + (app.doc.layers.filter((l) => l.kind === 'group').length + 1) });
  const current = activeLayer();
  const at = current ? app.doc.layers.indexOf(current) + 1 : app.doc.layers.length;
  app.doc.layers.splice(at, 0, group);
  R.rebuildLayer(group);
  if (current && current.kind !== 'group') current.group = group.id;
  markDirty();
  emit('layers');
  setActiveLayer(group.id);
  return group;
}

/** Selecting a layer also picks a tool that can edit it — but only when the
 *  current tool cannot, so choosing a layer to change its opacity does not
 *  quietly take the brush out of your hand. */
function selectLayer(layer) {
  setActiveLayer(layer.id);
  const tool = currentTool();
  if (tool.writesTo && !tool.writesTo.includes(layer.kind)) {
    const better = toolForLayer(layer);
    if (better) setTool(better);
  }
}

function moveLayer(fromId, toId) {
  if (!fromId || fromId === toId) return;
  const target = app.doc.layers.find((l) => l.id === toId);
  const moving = app.doc.layers.find((l) => l.id === fromId);
  // Dropping onto a group puts the layer in it; dropping onto an ordinary
  // layer moves it there and gives it whatever group that layer is in, which
  // is what makes a drag out of a group actually leave the group.
  if (moving && target && moving.kind !== 'group') {
    setLayerGroup(moving, target.kind === 'group' ? target.id : (target.group || null));
    if (target.kind === 'group') { renderLayers(); return; }
  }
  const from = app.doc.layers.findIndex((l) => l.id === fromId);
  const to = app.doc.layers.findIndex((l) => l.id === toId);
  if (from < 0 || to < 0) return;
  const [moved] = app.doc.layers.splice(from, 1);
  app.doc.layers.splice(to, 0, moved);
  R.compositeAll(); R.requestDraw(); markDirty(); renderLayers();
}

function renderLayerProps() {
  const root = $('#layer-props');
  root.innerHTML = '';
  const layer = activeLayer();
  if (!layer) return;

  root.appendChild(field({ type: 'text', label: 'Name', value: layer.name }, (v) => {
    layer.name = v || layer.name; markDirty(); renderLayers();
  }));
  root.appendChild(field({ type: 'range', label: 'Opacity', min: 0, max: 1, step: 0.01,
    value: layer.opacity, percent: true }, (v) => {
    layer.opacity = v; R.compositeAll(); R.requestDraw(); markDirty();
  }));
  root.appendChild(field({ type: 'select', label: 'Blend', value: layer.blend,
    options: [['source-over', 'Normal'], ['multiply', 'Multiply'], ['overlay', 'Overlay'],
              ['screen', 'Screen'], ['soft-light', 'Soft light']] }, (v) => {
    layer.blend = v; R.compositeAll(); R.requestDraw(); markDirty();
  }));
  root.appendChild(field({ type: 'toggle', label: 'Locked', value: layer.locked }, (v) => {
    layer.locked = v; markDirty();
  }));

  if (layer.kind === 'water' || layer.kind === 'floor' || layer.kind === 'land' || layer.kind === 'paper') {
    root.appendChild(textureField(layer, 'Texture'));
  }
  if (layer.kind === 'land' && layer.coast) {
    // None of these change the shape anyone painted, so none of them replay the
    // strokes — see render.repaintLand.
    const coast = (key, value) => { layer.coast[key] = value; R.repaintLand(layer); markDirty(); };
    root.appendChild(el('h3', { text: 'Coastline' }));
    root.appendChild(field({ type: 'toggle', label: 'Ink outline', value: layer.coast.ink },
      (v) => coast('ink', v)));
    root.appendChild(field({ type: 'range', label: 'Line width', min: 0.5, max: 12, step: 0.5,
      value: layer.coast.inkWidth, suffix: 'px', commit: true }, (v) => coast('inkWidth', v)));
    root.appendChild(field({ type: 'color', label: 'Ink', value: layer.coast.inkColor },
      (v) => coast('inkColor', v)));
    root.appendChild(field({ type: 'toggle', label: 'Shallow water', value: layer.coast.shallow },
      (v) => coast('shallow', v)));
    root.appendChild(field({ type: 'range', label: 'Shallow width', min: 2, max: 120, step: 1,
      value: layer.coast.shallowWidth, suffix: 'px', commit: true }, (v) => coast('shallowWidth', v)));
    root.appendChild(field({ type: 'range', label: 'Depth bands', min: 1, max: 6, step: 1,
      value: layer.coast.shallowSteps || 3, commit: true }, (v) => coast('shallowSteps', v)));
    root.appendChild(field({ type: 'color', label: 'Shallow', value: layer.coast.shallowColor },
      (v) => coast('shallowColor', v)));
  }
  if (layer.kind === 'group') {
    const members = membersOf(app.doc, layer);
    root.appendChild(el('p', { class: 'empty', text: members.length
      ? `Holding ${members.length} layer${members.length === 1 ? '' : 's'}. `
        + 'Its visibility and opacity apply to all of them. Drag a layer onto this row to add it.'
      : 'Empty. Drag a layer onto this row to put it in the group.' }));
    if (members.length) {
      root.appendChild(el('button', {
        class: 'btn', text: 'Take them all out',
        onclick: () => { for (const m of members) setLayerGroup(m, null); renderLayers(); },
      }));
    }
  }
  if (layer.kind === 'objects') {
    const restamp = () => { R.invalidate(layer); markDirty(); };
    root.appendChild(el('h3', { text: 'Drop shadow' }));
    root.appendChild(field({ type: 'range', label: 'Strength', min: 0, max: 1, step: 0.02,
      value: layer.shadow || 0, percent: true, commit: true }, (v) => { layer.shadow = v; restamp(); }));
    root.appendChild(field({ type: 'range', label: 'Direction', min: 0, max: 359, step: 1,
      value: layer.shadowAngle != null ? layer.shadowAngle : 55, suffix: '\u00b0', commit: true },
      (v) => { layer.shadowAngle = v; restamp(); }));
    root.appendChild(field({ type: 'range', label: 'Length', min: 0, max: 0.6, step: 0.01,
      value: layer.shadowLength != null ? layer.shadowLength : 0.16, percent: true, commit: true },
      (v) => { layer.shadowLength = v; restamp(); }));
    root.appendChild(field({ type: 'range', label: 'Softness', min: 0, max: 0.3, step: 0.005,
      value: layer.shadowBlur != null ? layer.shadowBlur : 0.05, percent: true, commit: true },
      (v) => { layer.shadowBlur = v; restamp(); }));
    // Every slider around these two waits for the release, because restamp()
    // re-renders every sprite on the layer. The colours were the two that
    // could not, and ran it on every tick of a drag inside the picker.
    root.appendChild(field({ type: 'color', label: 'Shadow', value: layer.shadowColor || '#241c10', commit: true },
      (v) => { layer.shadowColor = v; restamp(); }));
    root.appendChild(el('h3', { text: 'Tint' }));
    root.appendChild(field({ type: 'range', label: 'Strength', min: 0, max: 1, step: 0.02,
      value: layer.tintStrength || 0, percent: true, commit: true },
      (v) => { layer.tintStrength = v; restamp(); }));
    root.appendChild(field({ type: 'color', label: 'Colour', value: layer.tint || '#6f8a4a', commit: true },
      (v) => { layer.tint = v; restamp(); }));
  }
  if (layer.kind === 'lights') {
    const relight = () => { R.invalidate(layer); markDirty(); };
    root.appendChild(field({ type: 'range', label: 'Darkness', min: 0, max: 1, step: 0.02,
      value: layer.ambient != null ? layer.ambient : 0, percent: true, commit: true },
      (v) => { layer.ambient = v; relight(); }));
    root.appendChild(field({ type: 'color', label: 'Night', value: layer.color || '#060912' },
      (v) => { layer.color = v; relight(); }));
    root.appendChild(field({ type: 'range', label: 'Glow', min: 0, max: 0.8, step: 0.02,
      value: layer.glow != null ? layer.glow : 0.15, percent: true, commit: true },
      (v) => { layer.glow = v; relight(); }));
    root.appendChild(field({ type: 'toggle', label: 'Walls cast shadows',
      value: layer.shadows !== false }, (v) => { layer.shadows = v; relight(); }));
    const n = layer.ops.length;
    root.appendChild(el('p', { class: 'empty', text: n
      ? `${n} light${n === 1 ? '' : 's'}. The Light tool adds them; Select moves and deletes them.`
      : 'No lights yet. The Light tool drops them, and walls cast the shadows.' }));
  }
  if (layer.kind === 'grid') {
    const isHex = layer.type === 'hex';
    // The grid is what a cell is. Change it and the scale, the measure tool and
    // the scale bar have to follow, or the map quietly starts lying about how
    // far apart things are.
    const regrid = () => {
      R.invalidate(layer);
      if (app.doc.scale) app.doc.scale.cellPx = gridStepPx(app.doc);
      markDirty();
      renderMapProps();
    };
    root.appendChild(field({ type: 'select', label: 'Grid', value: layer.type,
      options: [['none', 'None'], ['square', 'Square'], ['hex', 'Hex']] },
      (v) => { layer.type = v; regrid(); renderLayerProps(); }));
    if (isHex) {
      root.appendChild(field({ type: 'select', label: 'Orientation',
        value: layer.orientation || 'flat',
        options: [['flat', 'Flat top'], ['pointy', 'Pointy top']] },
        (v) => { layer.orientation = v; regrid(); }));
    }
    root.appendChild(field({ type: 'range', label: isHex ? 'Hex width' : 'Cell size',
      min: 8, max: 320, step: 1, value: layer.size, suffix: 'px', commit: true },
      (v) => { layer.size = v; regrid(); }));
    root.appendChild(field({ type: 'color', label: 'Colour', value: layer.color },
      (v) => { layer.color = v; R.invalidate(layer); markDirty(); }));
    if (isHex) {
      root.appendChild(el('p', { class: 'empty', text:
        'Hex width is corner to corner. One hex measures '
        + Math.round(gridStepPx(app.doc)) + ' px across the flats, which is what '
        + 'the scale and the measure tool count in.' }));
    }
  }
  if (layer.kind === 'paper') {
    root.appendChild(field({ type: 'range', label: 'Vignette', min: 0, max: 1, step: 0.01,
      value: layer.vignette, percent: true, commit: true },
      (v) => { layer.vignette = v; R.invalidate(layer); markDirty(); }));
    root.appendChild(field({ type: 'range', label: 'Border', min: 0, max: 1, step: 0.01,
      value: layer.edge, percent: true, commit: true },
      (v) => { layer.edge = v; R.invalidate(layer); markDirty(); }));
  }

  const acts = el('div', { class: 'row' });
  if (layer.kind !== 'group') {
    acts.appendChild(el('button', { class: 'btn', text: 'Clear', onclick: () => clearLayer(layer) }));
  }
  if (layer.kind === 'raster' || layer.kind === 'group') {
    acts.appendChild(el('button', {
      class: 'btn btn-danger', text: 'Delete layer', onclick: () => deleteLayer(layer),
    }));
  }
  root.appendChild(acts);
}

function textureField(layer, label) {
  const list = assetsOfKind('terrain').map((a) => [a.id, `${a.label}`]);
  return field({ type: 'select', label, value: layer.texture, options: list }, async (v) => {
    layer.texture = v;
    await warm([v]);
    if (layer.kind === 'land') R.repaintLand(layer); else R.invalidate(layer);
    markDirty();
  });
}

function clearLayer(layer) {
  const before = layer.ops.slice();
  if (!before.length) return;
  layer.ops = [];
  R.invalidate(layer);
  pushEntry({
    label: 'Clear layer',
    undo() { layer.ops = before.slice(); R.invalidate(layer); },
    redo() { layer.ops = []; R.invalidate(layer); },
  });
  markDirty(); scheduleAutosave();
}

function deleteLayer(layer) {
  const index = app.doc.layers.indexOf(layer);
  if (index < 0) return;
  // A group is a folder, not a container: deleting it frees its members rather
  // than deleting somebody's work along with their filing.
  const freed = layer.kind === 'group' ? membersOf(app.doc, layer) : [];
  // Asked before the members are freed, because afterwards nothing points at
  // the group and relight can no longer tell it held the walls.
  const touchedWalls = layer.kind === 'walls' || freed.some((m) => m.kind === 'walls');
  for (const m of freed) delete m.group;
  app.doc.layers.splice(index, 1);
  R.forgetLayer(layer.id);
  if (touchedWalls) R.relightAll();
  if (app.activeLayerId === layer.id) {
    const next = app.doc.layers.find((l) => LAYER_KINDS[l.kind].paint) || app.doc.layers[0];
    app.activeLayerId = next ? next.id : null;
  }
  R.compositeAll(); R.requestDraw();
  pushEntry({
    label: 'Delete layer',
    undo() {
      app.doc.layers.splice(index, 0, layer);
      for (const m of freed) m.group = layer.id;
      R.setDocument(app.doc); emit('layers');
    },
    redo() {
      app.doc.layers.splice(app.doc.layers.indexOf(layer), 1);
      for (const m of freed) delete m.group;
      R.forgetLayer(layer.id);
      if (touchedWalls) R.relightAll();
      R.compositeAll(); R.requestDraw(); emit('layers');
    },
  });
  markDirty(); emit('layers');
}

export function addPaintLayer() {
  const layer = makeLayer('raster', { name: 'Paint ' + (app.doc.layers.filter((l) => l.kind === 'raster').length + 1) });
  insertLayer(layer);
}

/** Put a new layer under the paths layer — above the ground, below the ink. */
export function insertLayer(layer) {
  const above = app.doc.layers.findIndex((l) => l.kind === 'paths');
  const at = above < 0 ? app.doc.layers.length : above;
  app.doc.layers.splice(at, 0, layer);
  R.rebuildLayer(layer);
  R.compositeAll(); R.requestDraw();
  setActiveLayer(layer.id);
  markDirty();
  return layer;
}

/* The "+" adds a paint layer, which is what it wants to do nine times in ten.
 * Once an extension has taught the program another kind of layer, it asks. */
async function addLayerClicked() {
  const kinds = [...extensions.layerKinds.values()].filter((k) => typeof k.make === 'function');

  const choice = el('select', {}, [
    el('option', { value: 'raster', text: 'Paint layer' }),
    el('option', { value: 'group', text: 'Group — a folder for other layers' }),
  ].concat(kinds.map((k) => el('option', { value: k.id, text: k.label || k.id }))));
  let go = false;
  await modal({
    title: 'New layer',
    body: el('div', { class: 'field' }, [el('label', { text: 'Kind' }), choice]),
    buttons: [{ label: 'Cancel' },
              { label: 'Add', class: 'btn-primary', onClick: () => { go = true; } }],
  });
  if (!go) return;
  if (choice.value === 'raster') return addPaintLayer();
  if (choice.value === 'group') return addGroup();
  const kind = kinds.find((k) => k.id === choice.value);
  try {
    const layer = kind.make();
    if (layer) insertLayer(layer);
  } catch (err) {
    toast('That layer could not be created: ' + err.message, 'bad');
  }
}

/* ----------------------------------------------------------------- map box */

export function renderMapProps() {
  const root = $('#map-props');
  root.innerHTML = '';
  if (!app.doc) return;
  const grid = gridLayer(app.doc);
  let cells = '—';
  if (grid && grid.size) {
    if (grid.type === 'hex') {
      const sp = hex.spacing(grid);
      cells = `${Math.round(app.doc.width / sp.col)} × ${Math.round(app.doc.height / sp.row)} hexes`;
    } else {
      cells = `${Math.round(app.doc.width / grid.size)} × ${Math.round(app.doc.height / grid.size)} cells`;
    }
  }
  root.appendChild(el('dl', { class: 'kv' }, [
    el('dt', { text: 'Size' }), el('dd', { text: `${app.doc.width} × ${app.doc.height}` }),
    el('dt', { text: 'Grid' }), el('dd', { text: cells }),
    el('dt', { text: 'Folder' }), el('dd', { text: app.slug ? 'projects/' + app.slug : 'not saved' }),
  ]));

  // The scale is what turns a picture into a map: the measure tool, the scale
  // bar and the tabletop export all read it.
  const scale = app.doc.scale || (app.doc.scale = { unit: 'mi', perCell: 10, cellPx: 96 });
  root.appendChild(el('h3', { text: 'Scale' }));
  const scaleRow = el('div', { class: 'pair' });
  scaleRow.appendChild(field({ type: 'number', label: 'One cell is', min: 0.01, max: 10000, step: 0.5,
    value: scale.perCell }, (v) => { scale.perCell = v; markDirty(); R.requestDraw(); }));
  scaleRow.appendChild(field({ type: 'select', label: 'Unit', value: scale.unit,
    options: [['ft', 'feet'], ['m', 'metres'], ['mi', 'miles'], ['km', 'kilometres'], ['hex', 'hexes']] },
    (v) => { scale.unit = v; markDirty(); R.requestDraw(); }));
  root.appendChild(scaleRow);
  root.appendChild(field({ type: 'select', label: 'Snap to grid', value: app.doc.snap || 'off',
    options: [['off', 'Off'], ['grid', 'To the grid'], ['half', 'To half cells']] },
    (v) => { app.doc.snap = v; markDirty(); }));
  root.appendChild(el('p', { class: 'empty', text: grid && grid.type === 'hex'
    ? 'Walls, paths and shapes snap to hex corners, stamps to hex centres. '
      + 'Half cells add the edge midpoints. Hold Alt to ignore it.'
    : 'Walls and shapes snap to cell corners, stamps to cell centres. Hold Alt to ignore it.' }));
  root.appendChild(el('button', {
    class: 'btn', text: 'Resize canvas…', onclick: resizeDialog,
  }));
  root.appendChild(el('div', { style: 'height:8px' }));
  root.appendChild(el('button', {
    class: 'btn', text: 'Fit to window', onclick: () => R.fitView(),
  }));
}

async function resizeDialog() {
  const w = el('input', { type: 'number', min: 256, max: 8192, step: 1, value: app.doc.width });
  const h = el('input', { type: 'number', min: 256, max: 8192, step: 1, value: app.doc.height });
  const body = el('div', {}, [
    el('p', { class: 'muted', text: 'Existing artwork keeps its position from the top-left corner.' }),
    el('div', { class: 'field' }, [el('label', { text: 'Width' }), w]),
    el('div', { class: 'field' }, [el('label', { text: 'Height' }), h]),
  ]);
  let ok = false;
  await modal({ title: 'Resize canvas', body, buttons: [
    { label: 'Cancel' }, { label: 'Resize', class: 'btn-primary', onClick: () => { ok = true; } },
  ] });
  if (!ok) return;
  const nw = Math.max(256, Math.min(8192, parseInt(w.value, 10) || app.doc.width));
  const nh = Math.max(256, Math.min(8192, parseInt(h.value, 10) || app.doc.height));
  if (nw === app.doc.width && nh === app.doc.height) return;
  app.doc.width = nw; app.doc.height = nh;
  R.setDocument(app.doc);
  R.fitView();
  markDirty();
  renderMapProps();
  toast(`Canvas is now ${nw} × ${nh}`);
}

/* ------------------------------------------------------------------- wiring */

/** Panels contributed by extensions, redrawn whenever the document changes. */
export function renderExtensionPanels() {
  const root = $('#extension-panels');
  if (!root) return;
  root.innerHTML = '';
  for (const spec of extensions.panels) {
    if (spec.where && spec.where !== 'right') continue;
    const panel = el('section', { class: 'panel' });
    panel.appendChild(el('h3', { text: spec.title }));
    const body = el('div');
    panel.appendChild(body);
    try {
      spec.render(body, { el, field });
    } catch (err) {
      body.appendChild(el('p', { class: 'err', text: String(err.message || err) }));
    }
    root.appendChild(panel);
  }
}

/* ------------------------------------------------------- collapsible panels */

/* The right rail holds four panels and a map with a lot of layers pushes the
 * later ones off the bottom. Letting each one fold — and remembering that —
 * is cheaper than a resizable splitter and does the same job. */
export function initPanels() {
  const closed = new Set(app.settings.closedPanels || []);
  for (const panel of document.querySelectorAll('.rail-right .panel[id]')) {
    const head = panel.querySelector('h3');
    if (!head) continue;
    panel.classList.add('foldable');
    if (closed.has(panel.id)) panel.classList.add('is-closed');
    head.addEventListener('click', (ev) => {
      // the "+" button inside the Layers heading is not a fold handle
      if (ev.target.closest('button')) return;
      panel.classList.toggle('is-closed');
      const now = new Set(app.settings.closedPanels || []);
      panel.classList.contains('is-closed') ? now.add(panel.id) : now.delete(panel.id);
      app.settings.closedPanels = [...now];
      saveSettings();
    });
  }
}

export function initUI() {
  renderToolbar();
  renderToolOptions();
  renderAssetPicker();
  renderHistory();
  on('tool', () => { renderToolbar(); renderToolOptions(); renderAssetPicker(); });
  on('layers', () => { renderLayers(); renderMapProps(); renderToolOptions(); renderExtensionPanels(); });
  on('document', () => { renderLayers(); renderMapProps(); renderExtensionPanels(); renderHistory(); });
  on('tool-registry', () => renderToolbar());
  on('panels', renderExtensionPanels);
  on('library', () => renderAssetPicker());
  $('#btn-add-layer').addEventListener('click', addLayerClicked);
  initPanels();
}
