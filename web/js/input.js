/* Pointer and keyboard handling for the canvas.
 *
 * Space-drag and middle-drag pan from any tool, the wheel zooms about the
 * cursor, and everything else is handed to the active tool in map coordinates
 * so no tool has to know the view transform exists. */

import { app, toolSetting } from './app.js';
import { snapPoint } from './doc.js';
import * as R from './render.js';
import { TOOLS, currentTool, setTool } from './tools.js';
import { $, clamp } from './util.js';

const state = { drag: null, space: false, panning: null, lastPoint: null };

function pointFromEvent(ev, tool) {
  const rect = R.view.canvas.getBoundingClientRect();
  const raw = R.screenToMap(ev.clientX - rect.left, ev.clientY - rect.top);
  // Alt is the universal "ignore the grid for a moment" key; honour it here so
  // no tool has to think about snapping at all.
  if (!tool || !tool.snaps || (ev && ev.altKey) || !app.doc) return raw;
  return snapPoint(app.doc, raw, tool.snapTo || 'corner');
}

function brushRadius() {
  const tool = currentTool();
  if (!app.settings.showCursor) return 0;
  const size = toolSetting(tool.id, 'size', 0);
  if (tool.id === 'stamp') return 0;
  return size ? size / 2 : 0;
}

export function initInput() {
  const stage = $('#stage');
  const canvas = R.view.canvas;

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', (ev) => {
    canvas.setPointerCapture(ev.pointerId);
    const pt = pointFromEvent(ev, currentTool());
    const wantsPan = state.space || ev.button === 1 || ev.button === 2 || app.tool === 'pan';
    if (wantsPan) {
      state.panning = { x: ev.clientX, y: ev.clientY, vx: R.view.x, vy: R.view.y };
      stage.classList.add('is-panning');
      return;
    }
    if (ev.button !== 0) return;
    state.drag = true;
    const tool = currentTool();
    if (tool.down) tool.down(pt, ev);
  });

  canvas.addEventListener('pointermove', (ev) => {
    const tool = currentTool();
    const pt = pointFromEvent(ev, tool);
    state.lastPoint = pt;

    if (state.panning) {
      R.view.x = state.panning.vx + (ev.clientX - state.panning.x);
      R.view.y = state.panning.vy + (ev.clientY - state.panning.y);
      R.requestDraw();
      return;
    }

    R.view.cursor = { x: pt.x, y: pt.y, r: brushRadius() };
    if (state.drag && tool.move) tool.move(pt, ev);
    else if (tool.move && tool.id === 'path') tool.move(pt, ev);
    else R.requestDraw();

    $('#hud-pos').textContent = `${Math.round(pt.x)}, ${Math.round(pt.y)}`;
  });

  const release = (ev) => {
    if (state.panning) { state.panning = null; stage.classList.remove('is-panning'); return; }
    if (!state.drag) return;
    state.drag = false;
    const tool = currentTool();
    if (tool.up) tool.up(pointFromEvent(ev, tool), ev);
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  canvas.addEventListener('pointerleave', () => {
    R.view.cursor = null;
    R.requestDraw();
  });

  canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const factor = Math.exp(-ev.deltaY * 0.0016);
    R.zoomAt(ev.clientX - rect.left, ev.clientY - rect.top, factor);
    $('#hud-zoom').textContent = Math.round(R.view.zoom * 100) + '%';
  }, { passive: false });

  window.addEventListener('keydown', (ev) => {
    if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement) return;
    if (ev.code === 'Space' && !state.space) { state.space = true; ev.preventDefault(); return; }

    const tool = currentTool();
    if (tool.key && tool.key(ev)) { ev.preventDefault(); return; }

    const size = toolSetting(tool.id, 'size', null);
    if (size != null && (ev.key === '[' || ev.key === ']')) {
      const next = clamp(ev.key === '[' ? size * 0.85 : size * 1.18, 2, 900);
      app.settings.tools[tool.id].size = Math.round(next);
      R.requestDraw();
      window.dispatchEvent(new CustomEvent('cartograph:tool-options'));
      return;
    }

    const shortcuts = {
      b: 'brush', e: 'erase', l: 'land', g: 'scatter', f: 'fill', r: 'shape',
      s: 'stamp', p: 'path', t: 'label', w: 'wall', m: 'measure', v: 'select', h: 'pan',
    };
    if (!ev.ctrlKey && !ev.metaKey && shortcuts[ev.key.toLowerCase()]) {
      setTool(shortcuts[ev.key.toLowerCase()]);
      ev.preventDefault();
    }
    if (ev.key === '0' && !ev.ctrlKey) { R.fitView(); $('#hud-zoom').textContent = Math.round(R.view.zoom * 100) + '%'; }
  });

  window.addEventListener('keyup', (ev) => {
    if (ev.code === 'Space') { state.space = false; state.panning = null; stage.classList.remove('is-panning'); }
  });

  R.view.overlay = (ctx) => {
    const tool = currentTool();
    if (tool.overlay) tool.overlay(ctx);
  };
}
