/* The three non-editor tabs: Assets, Projects, Settings. */

import { api } from './api.js';
import { library, loadLibrary, forgetPatterns, warm } from './assets.js';
import { extensions } from './extensions.js';
import { app, emit, markDirty, newMap, openDocument, saveProject, saveSettings } from './app.js';
import { MAP_KINDS, referencedAssets } from './doc.js';
import * as hex from './hex.js';
import * as R from './render.js';
import { ACCENTS, BACKDROPS, THEMES, applyLook, look } from './theme.js';
import { $, $$, ago, el, modal, toast } from './util.js';

let currentTab = 'map';

export function showTab(name) {
  currentTab = name;
  $$('#tabs .tab').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === name));
  $$('.view').forEach((v) => v.classList.toggle('is-active', v.dataset.view === name));
  if (name === 'assets') renderPacks();
  if (name === 'projects') renderProjects();
  if (name === 'extensions') renderExtensions();
  if (name === 'settings') renderSettings();
  if (name === 'map') { R.resize(); R.requestDraw(); }
}

export const activeTab = () => currentTab;

/* ------------------------------------------------------------------ assets */

export async function renderPacks() {
  const root = $('#pack-list');
  root.innerHTML = '<p class="empty">Reading packs…</p>';
  await loadLibrary();
  emit('library');
  root.innerHTML = '';
  if (!library.packs.length) {
    root.innerHTML = '<p class="empty">No packs found.</p>';
    return;
  }
  for (const pack of library.packs) {
    const card = el('section', { class: 'pack' });
    const head = el('div', { class: 'pack-head' }, [
      el('h4', { text: pack.name || pack.id }),
      el('span', { class: 'tag' + (String(pack.license).startsWith('CC0') ? ' cc0' : ''),
                   text: pack.license || 'licence not stated' }),
      el('span', { class: 'tag', text: pack.count + ' assets' }),
      pack.generated ? el('span', { class: 'tag', text: 'generated · seed ' + pack.seed }) : null,
      el('span', { class: 'tag', text: 'assets/packs/' + pack.dir }),
    ]);
    card.appendChild(head);
    if (pack.error) card.appendChild(el('p', { class: 'empty', text: pack.error }));

    const grid = el('div', { class: 'asset-grid' });
    for (const asset of (pack.assets || []).slice(0, 200)) {
      grid.appendChild(el('div', {
        class: 'asset' + (asset.kind === 'stamp' ? ' is-stamp' : ''), title: `${asset.label} · ${asset.id}`,
      }, [
        el('img', { src: asset.url, alt: asset.label, loading: 'lazy' }),
        el('span', { class: 'cap', text: asset.label }),
      ]));
    }
    if (!pack.assets || !pack.assets.length) {
      grid.appendChild(el('p', { class: 'empty', text: 'This folder has no images in it yet.' }));
    }
    card.appendChild(grid);
    root.appendChild(card);
  }
}

export function initAssetsTab() {
  $('#import-input').addEventListener('change', async (ev) => {
    const files = Array.from(ev.target.files || []);
    ev.target.value = '';
    if (!files.length) return;

    const kindSel = el('select', {}, [
      el('option', { value: 'stamp', text: 'Stamps — symbols placed on the map' }),
      el('option', { value: 'terrain', text: 'Textures — seamless tiles for the brush' }),
    ]);
    const groupInput = el('input', { type: 'text', value: 'imported', placeholder: 'Group name' });
    let go = false;
    await modal({
      title: `Import ${files.length} file${files.length > 1 ? 's' : ''}`,
      body: el('div', {}, [
        el('div', { class: 'field' }, [el('label', { text: 'Use them as' }), kindSel]),
        el('div', { class: 'field' }, [el('label', { text: 'Group' }), groupInput]),
        el('p', { class: 'muted', text: 'Files are copied into assets/packs/user. Nothing leaves this machine.' }),
      ]),
      buttons: [{ label: 'Cancel' }, { label: 'Import', class: 'btn-primary', onClick: () => { go = true; } }],
    });
    if (!go) return;

    let ok = 0;
    for (const file of files) {
      try {
        await api.importAsset(file, { kind: kindSel.value, group: groupInput.value.trim() || 'imported' });
        ok++;
      } catch (err) {
        toast(`${file.name}: ${err.message}`, 'bad');
      }
    }
    forgetPatterns();
    await renderPacks();
    toast(`Imported ${ok} file${ok === 1 ? '' : 's'}`, 'good');
  });

  $('#btn-rescan').addEventListener('click', async () => {
    forgetPatterns();
    await renderPacks();
    toast('Packs rescanned', 'good');
  });
}

/* ---------------------------------------------------------------- projects */

export async function renderProjects() {
  const grid = $('#project-grid');
  grid.innerHTML = '<p class="empty">Reading projects…</p>';
  let list = [];
  try { list = (await api.projects()).projects; } catch (err) {
    grid.innerHTML = '';
    grid.appendChild(el('p', { class: 'empty', text: 'Could not read projects: ' + err.message }));
    return;
  }
  grid.innerHTML = '';
  if (!list.length) {
    grid.appendChild(el('p', { class: 'empty', text: 'No maps yet. Press “New map” to start one.' }));
    return;
  }
  for (const project of list) {
    const shot = el('span', { class: 'shot' });
    if (project.thumb) {
      shot.style.backgroundImage = `url(/projects/${encodeURIComponent(project.slug)}/thumb.png?t=${project.modified})`;
    }
    const card = el('article', { class: 'project-card' }, [
      shot,
      el('div', { class: 'meta' }, [
        el('b', { text: project.name }),
        el('span', { text: `${project.width}×${project.height} · ${project.layers} layers · ${ago(project.modified)}` }),
      ]),
      el('div', { class: 'acts' }, [
        el('button', { class: 'btn btn-primary', text: 'Open', onclick: () => openProject(project.slug) }),
        el('button', {
          class: 'btn btn-danger', text: 'Delete',
          onclick: async (e) => {
            e.stopPropagation();
            let go = false;
            await modal({
              title: 'Delete this map?',
              body: `“${project.name}” and its folder will be removed from disk. This cannot be undone.`,
              buttons: [{ label: 'Keep it' },
                        { label: 'Delete', class: 'btn-danger', onClick: () => { go = true; } }],
            });
            if (!go) return;
            await api.deleteProject(project.slug);
            if (app.slug === project.slug) app.slug = null;
            renderProjects();
            toast('Deleted', 'good');
          },
        }),
      ]),
    ]);
    card.addEventListener('dblclick', () => openProject(project.slug));
    grid.appendChild(card);
  }
}

export async function openProject(slug) {
  try {
    const { project } = await api.readProject(slug);
    await warm(referencedAssets(project));
    await openDocument(project, slug);
    $('#project-name').value = project.name || slug;
    showTab('map');
    toast('Opened ' + (project.name || slug));
  } catch (err) {
    toast('Could not open: ' + err.message, 'bad');
  }
}

export function initProjectsTab() {
  $('#btn-refresh-projects').addEventListener('click', renderProjects);
  $('#btn-new-project').addEventListener('click', newMapDialog);
}

export async function newMapDialog() {
  const name = el('input', { type: 'text', value: 'Untitled Map' });

  // Region maps are sized in pixels; battle maps are sized in squares, because
  // that is the unit anyone running an encounter actually thinks in.
  const PRESETS = {
    region: [
      ['2048x1536', 'Region — 2048 × 1536'],
      ['3072x2048', 'Continent — 3072 × 2048'],
      ['1536x2048', 'Portrait — 1536 × 2048'],
      ['1024x1024', 'Square — 1024 × 1024'],
      ['4096x3072', 'Large print — 4096 × 3072'],
    ],
    battle: [
      ['20x15', 'Small room — 20 × 15 squares'],
      ['30x20', 'Encounter — 30 × 20 squares'],
      ['40x30', 'Large map — 40 × 30 squares'],
      ['60x40', 'Dungeon level — 60 × 40 squares'],
    ],
    hex: [
      ['20x14', 'Local — 20 × 14 hexes'],
      ['26x18', 'Region — 26 × 18 hexes'],
      ['34x24', 'Domain — 34 × 24 hexes'],
      ['44x30', 'Continent — 44 × 30 hexes'],
    ],
  };
  const CELL = 70;
  // Hex columns interlock, so a map twenty hexes across is not twenty hex
  // widths across. hex.spacing knows the difference.
  const HEX = hex.spacing(MAP_KINDS.hex.grid);

  const kind = el('select', {}, Object.entries(MAP_KINDS).map(([id, k]) =>
    el('option', { value: id, text: k.label })));
  const preset = el('select');
  const note = el('p', { class: 'muted', text: '' });

  const refresh = () => {
    preset.innerHTML = '';
    for (const [value, label] of PRESETS[kind.value]) {
      preset.appendChild(el('option', { value, text: label }));
    }
    describe();
  };
  const size = () => {
    const [a, b] = preset.value.split('x').map(Number);
    if (kind.value === 'battle') return [a * CELL, b * CELL];
    if (kind.value === 'hex') return [Math.round(a * HEX.col), Math.round(b * HEX.row)];
    return [a, b];
  };
  const describe = () => {
    const [w, h] = size();
    const k = MAP_KINDS[kind.value];
    if (kind.value === 'battle') {
      note.textContent =
        `${w} × ${h} pixels, ${CELL} px to the square, one square is ${k.scale.perCell} ${k.scale.unit}. `
        + 'Grid and snapping are on, and there is a walls layer for the tabletop export.';
    } else if (kind.value === 'hex') {
      note.textContent =
        `${w} × ${h} pixels, ${k.grid.size} px to the hex. `
        + 'Stamps land in the middle of a hex, paths and borders on the edges, '
        + 'and the measure tool counts hexes rather than miles.';
    } else {
      note.textContent =
        `${w} × ${h} pixels, one grid cell is ${k.scale.perCell} ${k.scale.unit}. `
        + 'Starts with sea, a landmass and parchment.';
    }
  };
  kind.addEventListener('change', refresh);
  preset.addEventListener('change', describe);
  refresh();

  let go = false;
  await modal({
    title: 'New map',
    body: el('div', {}, [
      el('div', { class: 'field' }, [el('label', { text: 'Name' }), name]),
      el('div', { class: 'field' }, [el('label', { text: 'Kind' }), kind]),
      el('div', { class: 'field' }, [el('label', { text: 'Size' }), preset]),
      note,
    ]),
    buttons: [{ label: 'Cancel' }, { label: 'Create', class: 'btn-primary', onClick: () => { go = true; } }],
  });
  if (!go) return;
  const [w, h] = size();
  await newMap({ kind: kind.value, width: w, height: h, name: name.value.trim() || 'Untitled Map' });
  $('#project-name').value = app.doc.name;
  showTab('map');
}

/* -------------------------------------------------------------- extensions */

export function renderExtensions() {
  const root = $('#extension-list');
  root.innerHTML = '';
  const list = extensions.list;
  if (!list.length) {
    root.appendChild(el('p', { class: 'empty', text:
      'Nothing in the extensions folder yet.' }));
    return;
  }
  for (const ext of list) {
    const on = el('input', { type: 'checkbox' });
    on.checked = !!ext.enabled;
    on.addEventListener('change', async () => {
      try {
        await api.setExtensionEnabled(ext.id, on.checked);
        toast(on.checked ? `${ext.name} will load next time the program starts`
                         : `${ext.name} disabled`, 'good');
        ext.enabled = on.checked;
      } catch (err) { toast(err.message, 'bad'); on.checked = !on.checked; }
    });
    const loaded = extensions.loaded.get(ext.id);
    const card = el('section', { class: 'pack' }, [
      el('div', { class: 'pack-head' }, [
        el('h4', { text: ext.name }),
        el('span', { class: 'tag', text: 'v' + (ext.version || '0.0.0') }),
        ext.author ? el('span', { class: 'tag', text: ext.author }) : null,
        el('span', { class: 'tag', text: 'extensions/' + ext.dir }),
        ext.error ? el('span', { class: 'tag bad', text: 'error' })
                  : el('span', { class: 'tag' + (loaded ? ' cc0' : ''), text: loaded ? 'loaded' : 'off' }),
      ]),
      el('p', { class: 'muted', text: ext.description || '' }),
      ext.error ? el('p', { class: 'err', text: ext.error }) : null,
      loaded ? el('p', { class: 'muted', text: describeOwned(loaded.api._owned) }) : null,
      el('label', { class: 'check' }, [on, el('span', { text: 'Enabled' })]),
    ]);
    root.appendChild(card);
  }
}

function describeOwned(owned) {
  const bits = [];
  if (owned.tools.length) bits.push(owned.tools.length + ' tool' + (owned.tools.length > 1 ? 's' : ''));
  if (owned.layerKinds.length) bits.push(owned.layerKinds.length + ' layer type' + (owned.layerKinds.length > 1 ? 's' : ''));
  if (owned.panels.length) bits.push(owned.panels.length + ' panel' + (owned.panels.length > 1 ? 's' : ''));
  if (owned.commands.length) bits.push(owned.commands.length + ' command' + (owned.commands.length > 1 ? 's' : ''));
  if (owned.exporters.length) bits.push(owned.exporters.length + ' export format');
  return bits.length ? 'Adds ' + bits.join(', ') + '.' : 'Registers nothing.';
}

export function initExtensionsTab() {
  $('#btn-reload-extensions').addEventListener('click', () => window.location.reload());
  $('#btn-open-extensions').addEventListener('click', async () => {
    try { await api.openFolder('extensions'); } catch (err) { toast(err.message, 'bad'); }
  });
}

/* ---------------------------------------------------------------- settings */

export function renderSettings() {
  const root = $('#settings-body');
  root.innerHTML = '';
  const s = app.settings;
  s.look = s.look || {};

  /* ------------------------------------------------------------ interface */
  root.appendChild(el('h3', { text: 'Interface' }));

  const themeGrid = el('div', { class: 'theme-grid' });
  for (const [id, theme] of Object.entries(THEMES)) {
    const bar = el('span', { class: 'swatchbar' });
    for (const key of ['--bg', '--panel', '--panel-2', '--panel-3', '--line-hi']) {
      bar.appendChild(el('i', { style: 'background:' + theme.vars[key] }));
    }
    themeGrid.appendChild(el('button', {
      class: 'theme-card' + (look(s, 'theme') === id ? ' is-active' : ''),
      onclick: () => { s.look.theme = id; applyLook(s); saveSettings(); renderSettings(); },
    }, [bar, el('b', { text: theme.label })]));
  }
  root.appendChild(themeGrid);

  root.appendChild(el('label', { class: 'field' }, [el('span', { text: 'Accent' })]));
  const swatches = el('div', { class: 'swatches' });
  for (const [hex, name] of ACCENTS) {
    swatches.appendChild(el('button', {
      class: 'swatch' + (look(s, 'accent') === hex ? ' is-active' : ''),
      title: name, style: 'background:' + hex,
      onclick: () => { s.look.accent = hex; applyLook(s); saveSettings(); renderSettings(); },
    }));
  }
  const custom = el('input', { type: 'color', value: look(s, 'accent'), style: 'width:34px;height:26px;padding:1px' });
  custom.addEventListener('input', () => { s.look.accent = custom.value; applyLook(s); saveSettings(); });
  swatches.appendChild(custom);
  root.appendChild(swatches);

  const grid = el('div', { class: 'pair', style: 'max-width:560px' });
  grid.appendChild(selectField('Interface scale', look(s, 'uiScale'),
    [[90, 'Compact — 90%'], [100, 'Normal — 100%'], [110, 'Large — 110%'], [125, 'Very large — 125%']],
    (v) => { s.look.uiScale = +v; applyLook(s); saveSettings(); R.resize(); R.requestDraw(); }));
  grid.appendChild(selectField('Tools on the', look(s, 'railSide'),
    [['left', 'Left'], ['right', 'Right']],
    (v) => { s.look.railSide = v; applyLook(s); saveSettings(); R.resize(); R.requestDraw(); }));
  grid.appendChild(selectField('Canvas backdrop', look(s, 'backdrop'),
    Object.entries(BACKDROPS).map(([id, b]) => [id, b.label]),
    (v) => { s.look.backdrop = v; applyLook(s); saveSettings(); }));
  grid.appendChild(selectField('Corner rounding', look(s, 'cornerRadius'),
    [[0, 'Square'], [3, 'Slight'], [6, 'Normal'], [10, 'Round']],
    (v) => { s.look.cornerRadius = +v; applyLook(s); saveSettings(); }));
  root.appendChild(grid);

  root.appendChild(rangeField('Tool panel width', look(s, 'railWidth'), 240, 460,
    (v) => { s.look.railWidth = v; applyLook(s); saveSettings(); R.resize(); R.requestDraw(); }));
  root.appendChild(rangeField('Layers panel width', look(s, 'inspectorWidth'), 200, 420,
    (v) => { s.look.inspectorWidth = v; applyLook(s); saveSettings(); R.resize(); R.requestDraw(); }));
  root.appendChild(checkbox('Compact tool rail (icons only)', look(s, 'compactTools'), (v) => {
    s.look.compactTools = v; applyLook(s); saveSettings();
  }));
  root.appendChild(checkbox('Show the status bar over the canvas', look(s, 'showHud'), (v) => {
    s.look.showHud = v; applyLook(s); saveSettings();
  }));

  root.appendChild(el('h3', { text: 'Editing' }));
  root.appendChild(checkbox('Autosave while you work', s.autosave, (v) => { s.autosave = v; saveSettings(); }));
  root.appendChild(numberField('Autosave every (seconds)', s.autosaveSeconds, 15, 900, (v) => {
    s.autosaveSeconds = v; saveSettings();
  }));
  root.appendChild(checkbox('Show the brush outline', s.showCursor, (v) => {
    s.showCursor = v; saveSettings(); R.requestDraw();
  }));
  root.appendChild(checkbox('Show the scale bar on the canvas', s.showScaleBar !== false, (v) => {
    s.showScaleBar = v; saveSettings(); R.view.showScaleBar = v; R.requestDraw();
  }));

  root.appendChild(el('h3', { text: 'New maps' }));
  root.appendChild(numberField('Default width', s.defaultWidth, 256, 8192, (v) => { s.defaultWidth = v; saveSettings(); }));
  root.appendChild(numberField('Default height', s.defaultHeight, 256, 8192, (v) => { s.defaultHeight = v; saveSettings(); }));

  root.appendChild(el('h3', { text: 'This installation' }));
  const server = app.server || {};
  root.appendChild(el('dl', { class: 'kv' }, [
    el('dt', { text: 'Version' }), el('dd', { text: `${server.app} ${server.version}` }),
    el('dt', { text: 'Program folder' }), el('dd', { text: server.root || '—' }),
    el('dt', { text: 'Maps' }), el('dd', { text: (server.folders || {}).projects || '—' }),
    el('dt', { text: 'Asset packs' }), el('dd', { text: (server.folders || {}).packs || '—' }),
    el('dt', { text: 'Exports' }), el('dd', { text: (server.folders || {}).exports || '—' }),
    el('dt', { text: 'Port' }), el('dd', { text: String((server.config || {}).port || '—') }),
  ]));
  const folders = el('div', { class: 'row', style: 'flex-wrap:wrap;margin:-8px 0 16px' });
  for (const [which, label] of [['root', 'Program folder'], ['projects', 'Maps'],
                                ['packs', 'Asset packs'], ['exports', 'Exports'],
                                ['extensions', 'Extensions']]) {
    folders.appendChild(el('button', {
      class: 'btn', text: 'Open ' + label.toLowerCase(),
      onclick: async () => {
        try { await api.openFolder(which); } catch (err) { toast(err.message, 'bad'); }
      },
    }));
  }
  root.appendChild(folders);

  root.appendChild(el('p', { class: 'muted', text:
    'To change the port or stop the browser opening on launch, edit config.json in the program ' +
    'folder, or start it with --port and --no-browser. To re-roll the generated art pack from a ' +
    'different seed, run: python app.py --regen-pack --seed yourword' }));

  root.appendChild(el('h3', { text: 'Keyboard' }));
  const keys = [
    ['B / E / L', 'Terrain brush · Eraser · Landmass'],
    ['G / F / R', 'Scatter · Fill · Shape'],
    ['S / P / T', 'Stamp · Path · Label'],
    ['W / M', 'Wall · Measure'],
    ['V / H', 'Select · Pan'],
    ['[ and ]', 'Smaller and larger brush'],
    ['Space + drag', 'Pan from any tool'],
    ['Scroll', 'Zoom about the pointer'],
    ['0', 'Fit the map in the window'],
    ['Ctrl+K', 'Command palette — everything, searchable'],
    ['Ctrl+S / Ctrl+E', 'Save · Export'],
    ['Alt (held)', 'Ignore grid snapping'],
    ['Ctrl+Z / Ctrl+Shift+Z', 'Undo · Redo'],
    ['Enter / Esc', 'Finish or cancel a path'],
    ['Delete', 'Remove the selected object'],
  ];
  root.appendChild(el('dl', { class: 'kv' },
    keys.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })])));
}

function checkbox(label, value, onChange) {
  const box = el('input', { type: 'checkbox' });
  box.checked = !!value;
  box.addEventListener('change', () => onChange(box.checked));
  return el('label', { class: 'check' }, [box, el('span', { text: label })]);
}

function selectField(label, value, options, onChange) {
  const sel = el('select');
  for (const [v, text] of options) {
    const opt = el('option', { value: v, text });
    if (String(v) === String(value)) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => onChange(sel.value));
  return el('div', { class: 'field' }, [el('label', { text: label }), sel]);
}

function rangeField(label, value, min, max, onChange) {
  const readout = el('b', { text: value + 'px' });
  const input = el('input', { type: 'range', min, max, step: 2, value });
  input.addEventListener('input', () => {
    readout.textContent = input.value + 'px';
    onChange(parseInt(input.value, 10));
  });
  return el('div', { class: 'field', style: 'max-width:360px' },
    [el('label', {}, [el('span', { text: label }), readout]), input]);
}

function numberField(label, value, min, max, onChange) {
  const input = el('input', { type: 'number', min, max, step: 1, value });
  input.addEventListener('change', () => {
    const v = Math.max(min, Math.min(max, parseInt(input.value, 10) || min));
    input.value = v;
    onChange(v);
  });
  return el('div', { class: 'field', style: 'max-width:260px' }, [el('label', { text: label }), input]);
}

export function initTabs() {
  $('#tabs').addEventListener('click', (ev) => {
    const button = ev.target.closest('.tab');
    if (button) showTab(button.dataset.tab);
  });
  initAssetsTab();
  initProjectsTab();
  initExtensionsTab();
}
