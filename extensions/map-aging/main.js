/* Map Aging — an example extension.
 *
 * Three commands that draw onto the paper layer. Small, but it shows the whole
 * shape of a well-behaved extension: get a layer, snapshot what you are about
 * to overwrite, draw, and push an undo entry that puts it back. Everything an
 * extension draws is undoable if it does this.
 */

export default function setup(api) {
  const { render: R, ui, util } = api;

  function paperLayer() {
    const layer = api.doc().layers.find((l) => l.kind === 'paper');
    if (!layer) ui.toast('This map has no paper layer to age', 'bad');
    return layer;
  }

  /** Draw onto a layer and make it undoable. */
  function alter(label, draw) {
    const layer = paperLayer();
    if (!layer) return;
    const doc = api.doc();
    const canvas = R.canvasFor(layer);
    const box = { x: 0, y: 0, x1: doc.width, y1: doc.height };
    const before = api.history.snapshot(canvas, box);
    draw(canvas.getContext('2d'), doc);
    R.compositeAll();
    R.requestDraw();
    api.history.push({
      label,
      bytes: before ? before.w * before.h * 4 : 0,
      undo() { api.history.restore(canvas, before); R.compositeAll(); R.requestDraw(); },
      redo() { draw(canvas.getContext('2d'), doc); R.compositeAll(); R.requestDraw(); },
    });
    api.markDirty();
    api.scheduleAutosave();
    ui.toast(label, 'good');
  }

  api.registerCommand({
    id: 'foxing',
    title: 'Age the paper (foxing and stains)',
    shortcut: 'ctrl+shift+a',
    run() {
      alter('Aged the paper', (ctx, doc) => {
        const rand = util.rng((Math.random() * 4294967295) >>> 0);
        const spots = Math.round((doc.width * doc.height) / 26000);
        ctx.save();
        for (let i = 0; i < spots; i++) {
          const x = rand() * doc.width;
          const y = rand() * doc.height;
          // heavier towards the edges, the way damp gets into a folded sheet
          const edge = Math.min(x, y, doc.width - x, doc.height - y) / (Math.min(doc.width, doc.height) / 2);
          if (rand() < edge * 0.75) continue;
          const r = 2 + rand() * 16;
          const g = ctx.createRadialGradient(x, y, 0, x, y, r);
          const tone = rand() < 0.3 ? '150,110,60' : '120,88,48';
          g.addColorStop(0, `rgba(${tone},${(0.05 + rand() * 0.16).toFixed(3)})`);
          g.addColorStop(1, `rgba(${tone},0)`);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      });
    },
  });

  api.registerCommand({
    id: 'coffee',
    title: 'Add a coffee ring',
    run() {
      alter('Coffee ring', (ctx, doc) => {
        const rand = util.rng((Math.random() * 4294967295) >>> 0);
        const cx = doc.width * (0.15 + rand() * 0.7);
        const cy = doc.height * (0.15 + rand() * 0.7);
        const r = Math.min(doc.width, doc.height) * (0.06 + rand() * 0.06);
        ctx.save();
        const fill = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
        fill.addColorStop(0, 'rgba(126,88,44,.05)');
        fill.addColorStop(0.82, 'rgba(126,88,44,.10)');
        fill.addColorStop(1, 'rgba(126,88,44,.02)');
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        // the rim, drawn as a wobbling line rather than a perfect circle
        ctx.strokeStyle = 'rgba(104,70,32,.30)';
        ctx.lineWidth = Math.max(1.5, r * 0.045);
        ctx.beginPath();
        for (let a = 0; a <= Math.PI * 2 + 0.05; a += 0.05) {
          const wobble = r * (1 + Math.sin(a * 5 + rand()) * 0.012);
          const x = cx + Math.cos(a) * wobble, y = cy + Math.sin(a) * wobble;
          if (a === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();
      });
    },
  });

  api.registerCommand({
    id: 'burn',
    title: 'Scorch the edges',
    run() {
      alter('Scorched the edges', (ctx, doc) => {
        const inset = Math.min(doc.width, doc.height) * 0.09;
        const edges = [
          ctx.createLinearGradient(0, 0, inset, 0),
          ctx.createLinearGradient(doc.width, 0, doc.width - inset, 0),
          ctx.createLinearGradient(0, 0, 0, inset),
          ctx.createLinearGradient(0, doc.height, 0, doc.height - inset),
        ];
        ctx.save();
        for (const g of edges) {
          g.addColorStop(0, 'rgba(52,30,10,.55)');
          g.addColorStop(0.45, 'rgba(92,58,24,.18)');
          g.addColorStop(1, 'rgba(92,58,24,0)');
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, doc.width, doc.height);
        }
        ctx.restore();
      });
    },
  });
}
