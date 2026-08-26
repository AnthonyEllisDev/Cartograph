/* Grid Coordinates — an example extension.
 *
 * Adds a layer type that writes a reference into every grid cell, and a panel
 * in the right-hand rail to configure it. Between them they show how an
 * extension can own a piece of the document and a piece of the interface
 * without touching the editor's own code.
 */

const SCHEMES = {
  alphanumeric: { label: 'A1, B1, C1…', make: (cx, cy) => letters(cx) + (cy + 1) },
  numeric: { label: '01.01, 02.01…', make: (cx, cy) => pad(cx + 1) + '.' + pad(cy + 1) },
  offset: { label: '0101, 0201…', make: (cx, cy) => pad(cx + 1) + pad(cy + 1) },
};

const pad = (n) => String(n).padStart(2, '0');

function letters(index) {
  let out = '';
  let n = index;
  do { out = String.fromCharCode(65 + (n % 26)) + out; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return out;
}

export default function setup(api) {
  const { render: R, ui } = api;

  api.registerLayerKind({
    id: 'coords',
    label: 'Coordinates',
    icon: 'grid',
    make: () => api.map.makeLayer('coords', {
      name: 'Coordinates', scheme: 'alphanumeric', color: '#3a2c1e',
      textOpacity: 0.7, textScale: 0.2, inset: 0.16,
    }),
    render(layer, ctx, ctxHelpers) {
      const doc = ctxHelpers.doc;
      const grid = doc.layers.find((l) => l.kind === 'grid');
      if (!grid || !grid.size) return;
      const size = grid.size;
      const ox = grid.offsetX || 0, oy = grid.offsetY || 0;
      const scheme = SCHEMES[layer.scheme] || SCHEMES.alphanumeric;
      const hex = grid.type === 'hex';

      ctx.save();
      ctx.fillStyle = layer.color || '#3a2c1e';
      ctx.globalAlpha = layer.textOpacity != null ? layer.textOpacity : 0.75;
      ctx.font = `600 ${Math.max(7, Math.round(size * (layer.textScale || 0.2)))}px ui-monospace, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      if (hex) {
        const r = size / 2;
        const dx = r * 1.5, dy = r * Math.sqrt(3);
        for (let col = 0; ox + col * dx < doc.width; col++) {
          for (let row = 0; oy + row * dy < doc.height; row++) {
            const x = ox + col * dx;
            const y = oy + row * dy + (col % 2 ? dy / 2 : 0);
            if (x < 0 || y < 0) continue;
            ctx.fillText(scheme.make(col, row), x, y - r * (layer.inset || 0.55));
          }
        }
      } else {
        for (let cx = 0; ox + cx * size < doc.width; cx++) {
          for (let cy = 0; oy + cy * size < doc.height; cy++) {
            ctx.fillText(scheme.make(cx, cy),
                         ox + cx * size + size / 2,
                         oy + cy * size + size * (layer.inset != null ? layer.inset : 0.16));
          }
        }
      }
      ctx.restore();
    },
  });

  function coordLayer(create) {
    const doc = api.doc();
    let layer = doc.layers.find((l) => l.kind === 'coords');
    if (layer || !create) return layer || null;
    layer = api.map.makeLayer('coords', {
      name: 'Coordinates', scheme: 'alphanumeric', color: '#3a2c1e',
      textOpacity: 0.7, textScale: 0.2, inset: 0.16,
    });
    const gridAt = doc.layers.findIndex((l) => l.kind === 'grid');
    doc.layers.splice(gridAt < 0 ? doc.layers.length : gridAt + 1, 0, layer);
    R.rebuildLayer(layer);
    R.compositeAll();
    api.events.emit('layers');
    api.markDirty();
    return layer;
  }

  api.registerPanel({
    id: 'coords',
    title: 'Grid coordinates',
    render(root, { el, field }) {
      const layer = coordLayer(false);
      if (!layer) {
        root.appendChild(el('p', { class: 'empty', text:
          'Writes a reference into every grid cell. The map needs a grid turned on.' }));
        root.appendChild(el('button', {
          class: 'btn', text: 'Add the coordinates layer',
          onclick: () => { coordLayer(true); ui.toast('Coordinates layer added', 'good'); },
        }));
        return;
      }
      root.appendChild(field({
        type: 'select', label: 'Scheme', value: layer.scheme,
        options: Object.entries(SCHEMES).map(([id, s]) => [id, s.label]),
      }, (v) => { layer.scheme = v; R.invalidate(layer); api.markDirty(); }));
      root.appendChild(field({
        type: 'range', label: 'Text size', min: 0.08, max: 0.5, step: 0.01,
        value: layer.textScale, percent: true,
      }, (v) => { layer.textScale = v; R.invalidate(layer); api.markDirty(); }));
      root.appendChild(field({
        type: 'range', label: 'Opacity', min: 0.1, max: 1, step: 0.02,
        value: layer.textOpacity, percent: true,
      }, (v) => { layer.textOpacity = v; R.invalidate(layer); api.markDirty(); }));
      root.appendChild(field({
        type: 'color', label: 'Colour', value: layer.color,
      }, (v) => { layer.color = v; R.invalidate(layer); api.markDirty(); }));
    },
  });

  api.registerCommand({
    id: 'toggle-coords',
    title: 'Show or hide the grid coordinates',
    run() {
      const layer = coordLayer(true);
      layer.visible = !layer.visible;
      R.compositeAll();
      R.requestDraw();
      api.events.emit('layers');
      api.markDirty();
    },
  });
}
