/* Battle Tokens — an example extension.
 *
 * Shows the two heaviest hooks in the API: a new layer kind the renderer knows
 * how to draw, and a new tool in the rail that puts things on it. Everything
 * here is ordinary code using the object handed to setup(); nothing reaches
 * into the editor's internals.
 */

const PALETTE = [
  ['#b2453c', 'Red'], ['#3f7cc0', 'Blue'], ['#4e9764', 'Green'],
  ['#9b6bbd', 'Purple'], ['#c8973c', 'Amber'], ['#5c6470', 'Grey'],
];

export default function setup(api) {
  const { ui, util, render: R } = api;

  /* ------------------------------------------------------- the layer kind */

  api.registerLayerKind({
    id: 'tokens',
    label: 'Tokens',
    icon: 'stamp',
    // Offered by the "+" in the Layers panel, alongside the built-in kinds.
    make: () => api.map.makeLayer('tokens', { name: 'Tokens' }),
    render(layer, ctx) {
      for (const token of layer.ops) {
        const r = token.radius;
        ctx.save();
        ctx.translate(token.x, token.y);

        ctx.beginPath();
        ctx.arc(0, 2, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,.28)';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fillStyle = token.color;
        ctx.fill();
        ctx.lineWidth = Math.max(1.5, r * 0.1);
        ctx.strokeStyle = 'rgba(12,14,18,.85)';
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(0, 0, r * 0.78, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,.28)';
        ctx.lineWidth = Math.max(1, r * 0.06);
        ctx.stroke();

        if (token.label) {
          ctx.fillStyle = '#fff';
          ctx.font = `700 ${Math.round(r * 0.95)}px Georgia, serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.shadowColor = 'rgba(0,0,0,.55)';
          ctx.shadowBlur = Math.max(2, r * 0.15);
          ctx.fillText(token.label.slice(0, 2).toUpperCase(), 0, 1);
        }
        ctx.restore();
      }
    },
  });

  /** Find the token layer, or add one above everything but the grid. */
  function tokenLayer() {
    const doc = api.doc();
    let layer = doc.layers.find((l) => l.kind === 'tokens');
    if (layer) return layer;
    layer = api.map.makeLayer('tokens', { name: 'Tokens' });
    const gridAt = doc.layers.findIndex((l) => l.kind === 'grid');
    doc.layers.splice(gridAt < 0 ? doc.layers.length : gridAt, 0, layer);
    R.rebuildLayer(layer);
    R.compositeAll();
    api.events.emit('layers');
    return layer;
  }

  /* ------------------------------------------------------------ the tool */

  let settings = { size: 1, color: PALETTE[0][0], label: '', autoNumber: true };
  let counter = 0;

  api.registerTool({
    id: 'place',
    label: 'Token',
    snaps: true,
    snapTo: 'centre',
    writesTo: ['tokens'],
    hint: 'Click to drop a creature token. It snaps to the middle of a square.',
    iconSvg: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.4"/></svg>',
    options: () => ([
      { key: 'size', type: 'range', label: 'Size in squares', min: 0.5, max: 4, step: 0.5,
        value: settings.size, suffix: '×' },
      { key: 'color', type: 'select', label: 'Colour', value: settings.color,
        options: PALETTE.map(([hex, name]) => [hex, name]) },
      { key: 'label', type: 'text', label: 'Label', value: settings.label },
      { key: 'autoNumber', type: 'toggle', label: 'Number them automatically',
        value: settings.autoNumber },
    ]),
    onOption(key, value) { settings[key] = value; },
    down(pt) {
      const doc = api.doc();
      const grid = doc.layers.find((l) => l.kind === 'grid');
      const cell = (grid && grid.size) || (doc.scale && doc.scale.cellPx) || 64;
      const layer = tokenLayer();
      counter += 1;
      const token = {
        id: util.uid('tok'),
        x: pt.x, y: pt.y,
        radius: (cell * settings.size) / 2 - Math.max(2, cell * 0.04),
        color: settings.color,
        label: settings.label || (settings.autoNumber ? String(counter) : ''),
      };
      const before = layer.ops.slice();
      layer.ops.push(token);
      R.invalidate(layer);
      api.history.push({
        label: 'Token',
        undo() { layer.ops = before.slice(); R.invalidate(layer); },
        redo() { layer.ops = before.concat([token]); R.invalidate(layer); },
      });
      api.markDirty();
      api.scheduleAutosave();
    },
    move() {}, up() {},
  });

  /* ---------------------------------------------------------- a command */

  api.registerCommand({
    id: 'clear-tokens',
    title: 'Clear every token',
    run() {
      const layer = api.doc().layers.find((l) => l.kind === 'tokens');
      if (!layer || !layer.ops.length) return ui.toast('There are no tokens on this map');
      const before = layer.ops.slice();
      layer.ops = [];
      counter = 0;
      R.invalidate(layer);
      api.history.push({
        label: 'Clear tokens',
        undo() { layer.ops = before.slice(); R.invalidate(layer); },
        redo() { layer.ops = []; R.invalidate(layer); },
      });
      api.markDirty();
      ui.toast(`Removed ${before.length} tokens`, 'good');
    },
  });
}
