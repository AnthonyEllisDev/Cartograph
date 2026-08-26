/* Tool presets.
 *
 * A preset is a snapshot of one tool's options plus, if the tool uses one, the
 * asset it was pointing at. That pairing is the whole point: "Pine forest,
 * 220px, soft" is a thing you reach for, and rebuilding it from four sliders
 * every time is the sort of friction that makes a program feel like a toy.
 *
 * They live in the settings bag, so they follow the browser profile rather than
 * the map — the same reasoning as brush settings themselves.
 */

import { app, saveSettings, setToolSetting } from './app.js';
import { TOOLS } from './tools.js';

const ASSET_KEY = { terrain: 'activeTexture', stamp: 'activeStamp' };

function bag() {
  if (!Array.isArray(app.settings.presets)) app.settings.presets = [];
  return app.settings.presets;
}

export function presetsFor(toolId) {
  return bag().filter((p) => p.tool === toolId);
}

/** Capture the current state of `tool` under `name`. */
export function savePreset(toolId, name) {
  const tool = TOOLS[toolId];
  if (!tool) return null;
  const opts = {};
  for (const spec of tool.options()) {
    if (spec.type === 'info') continue;
    opts[spec.key] = spec.value;
  }
  const preset = {
    id: 'p' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
    tool: toolId,
    name: (name || '').trim() || (tool.label + ' preset'),
    opts,
  };
  const assetKey = ASSET_KEY[tool.assetKind];
  if (assetKey) {
    preset.asset = tool.assetTarget === 'layer' && tool.currentAsset
      ? tool.currentAsset()
      : app.settings[assetKey];
  }
  bag().push(preset);
  saveSettings();
  return preset;
}

/** Put a preset back. Returns false if its tool has gone (an extension left). */
export function applyPreset(id) {
  const preset = bag().find((p) => p.id === id);
  if (!preset) return false;
  const tool = TOOLS[preset.tool];
  if (!tool) return false;
  for (const [key, value] of Object.entries(preset.opts)) {
    if (tool.onOption) tool.onOption(key, value);
    else setToolSetting(preset.tool, key, value);
  }
  if (preset.asset) {
    if (tool.assetTarget === 'layer' && tool.applyAsset) tool.applyAsset(preset.asset);
    else if (ASSET_KEY[tool.assetKind]) app.settings[ASSET_KEY[tool.assetKind]] = preset.asset;
  }
  saveSettings();
  return true;
}

export function deletePreset(id) {
  const list = bag();
  const i = list.findIndex((p) => p.id === id);
  if (i >= 0) { list.splice(i, 1); saveSettings(); }
  return i >= 0;
}

export function renamePreset(id, name) {
  const preset = bag().find((p) => p.id === id);
  if (!preset) return false;
  preset.name = (name || '').trim() || preset.name;
  saveSettings();
  return true;
}

export function allPresets() { return bag().slice(); }
