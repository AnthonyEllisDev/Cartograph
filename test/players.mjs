/* The players' copy.
 *
 * One map, two pictures of it: the GM's, with everything, and the one the
 * players are shown, which leaves out every layer marked GM only and every note
 * pin and draws a secret door as the plain wall the players think it is. This
 * suite checks that the players' copy is exactly the GM's picture with those
 * three things changed and nothing else, that the GM's copy and the screen do
 * not move when a layer is marked, that a group marks its members, that the
 * mark is a step in the history and survives a reload, that the tabletop file
 * agrees with the picture (a secret door goes across as a wall, not a door),
 * and that Export and Print both write a players' copy when asked.
 *
 * Start the server first:  python3 app.py --no-browser --port 7871
 * Then:                    node test/players.mjs [http://127.0.0.1:7871]
 */

import { launch, base, ready, newMap } from './browser.mjs';

const out = [];
let fails = 0;
function t(name, pass, note) {
  out.push([pass ? 'PASS' : 'FAIL', name, note == null ? '' : String(note)]);
  if (!pass) fails++;
}
function report() {
  for (const [status, name, note] of out) console.log(status.padEnd(5), name, note ? ' [' + note + ']' : '');
  console.log(`\n${out.length - fails}/${out.length} passed`);
}
process.on('unhandledRejection', (err) => {
  report();
  console.log('\nthrew: ' + (err && err.message));
  process.exit(1);
});

const b = await launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const p = await ctx.newPage();
const errs = [];
const offHost = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
p.on('request', (r) => { if (!/^(https?:\/\/127\.0\.0\.1[:/]|data:|blob:)/.test(r.url())) offHost.push(r.url()); });
await p.goto(base('http://127.0.0.1:7871/'), { waitUntil: 'networkidle' });
await ready(p);
await newMap(p, { name: 'Smugglers Den', kind: 'battle', size: '20x15' });

// A room with an ordinary door on one side and a secret door on the other,
// and a notes layer with one pin in it.
await p.evaluate(async () => {
  const { makeLayer } = await import('/js/doc.js');
  const { app, R } = window.__cg;
  const C = 70;
  const w = (kind, x0, y0, x1, y1) => ({ id: 'w' + Math.random().toString(36).slice(2, 9), kind,
    points: [{ x: x0 * C, y: y0 * C }, { x: x1 * C, y: y1 * C }] });
  const walls = app.doc.layers.find((l) => l.kind === 'walls');
  walls.ops = [
    w('wall', 3, 3, 12, 3), w('wall', 12, 3, 12, 5), w('secret', 12, 5, 12, 6), w('wall', 12, 6, 12, 9),
    w('wall', 12, 9, 8, 9), w('door', 8, 9, 7, 9), w('wall', 7, 9, 3, 9), w('wall', 3, 9, 3, 3),
  ];
  R.invalidate(walls);
  const notes = makeLayer('notes', { name: 'Notes' });
  notes.ops.push({ id: 'n1', x: 7 * C, y: 6 * C, title: 'The stash', body: 'Behind the east wall.', color: '#c0392b' });
  app.doc.layers.push(notes);
  R.invalidate(notes);
  R.compositeAll(); R.requestDraw();
});

/* the picture --------------------------------------------------------------- */

// Distance between two flattened maps, and where they differ.
const compare = `(a, b) => {
  const A = a.getContext('2d').getImageData(0, 0, a.width, a.height).data;
  const B = b.getContext('2d').getImageData(0, 0, b.width, b.height).data;
  if (A.length !== B.length) return { size: true, n: -1 };
  let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let i = 0; i < A.length; i += 4) {
    if (A[i] !== B[i] || A[i + 1] !== B[i + 1] || A[i + 2] !== B[i + 2] || A[i + 3] !== B[i + 3]) {
      n++; const px = (i / 4) % a.width, py = Math.floor(i / 4 / a.width);
      x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py);
    }
  }
  return { n, box: n ? [x0, y0, x1, y1] : null };
}`;

const pic = await p.evaluate(async (cmp) => {
  const diff = eval(cmp);
  const { app, R } = window.__cg;
  const walls = app.doc.layers.find((l) => l.kind === 'walls');
  const gm = R.flatten({ scale: 1 });
  const players = R.flatten({ scale: 1, players: true });
  const gmNoPins = R.flatten({ scale: 1, notes: false });
  // The reference: the GM's picture with no pins, drawn after the secret door
  // really has been turned into a wall.
  const secret = walls.ops.find((o) => o.kind === 'secret');
  secret.kind = 'wall'; R.invalidate(walls);
  const reference = R.flatten({ scale: 1, notes: false });
  secret.kind = 'secret'; R.invalidate(walls);
  const gmAgain = R.flatten({ scale: 1 });
  return {
    vsGM: diff(players, gm),
    vsRef: diff(players, reference),
    pinsOnly: diff(gm, gmNoPins),
    restored: diff(gm, gmAgain),
  };
}, compare);
t('the players\' copy differs from the GM\'s', pic.vsGM.n > 0, pic.vsGM.n + ' pixels');
t('and is exactly the GM\'s with the pins off and the secret door drawn as a wall', pic.vsRef.n === 0,
  pic.vsRef.n + ' pixels differ');
t('the GM\'s copy has the pins (precondition for the line above)', pic.pinsOnly.n > 0, pic.pinsOnly.n + ' pixels');
t('drawing the players\' copy leaves the walls layer as it was', pic.restored.n === 0, pic.restored.n + ' pixels');

/* marking a layer GM only --------------------------------------------------- */

// The layer to mark is the grid: easy to see, and on every battle map.
const gridRow = await p.evaluate(() => window.__cg.app.doc.layers.find((l) => l.kind === 'grid').id);
const beforeMark = await p.evaluate(() => {
  const { app, R } = window.__cg;
  return { flat: R.flatten({ scale: 0.25 }).toDataURL(), screen: R.view.flat.toDataURL(),
           past: window.__cg.history.past.length };
});
await p.click(`.layer[data-id="${gridRow}"] .lname`);
await p.waitForTimeout(200);
await p.click('#layer-props [data-layer="gm"] input');
await p.waitForTimeout(200);
const marked = await p.evaluate((cmp) => {
  const diff = eval(cmp);
  const { app, R } = window.__cg;
  const grid = app.doc.layers.find((l) => l.kind === 'grid');
  const walls = app.doc.layers.find((l) => l.kind === 'walls');
  const players = R.flatten({ scale: 1, players: true });
  const secret = walls.ops.find((o) => o.kind === 'secret');
  secret.kind = 'wall'; R.invalidate(walls);
  const reference = R.flatten({ scale: 1, notes: false, grid: false });
  secret.kind = 'secret'; R.invalidate(walls);
  const timeline = window.__cg.history.past.map((e) => e.label);
  return {
    gm: grid.gm === true, dirty: !!app.dirty,
    label: timeline[timeline.length - 1], past: timeline.length,
    vsRef: diff(players, reference).n,
    flat: R.flatten({ scale: 0.25 }).toDataURL(), screen: R.view.flat.toDataURL(),
    badge: !!document.querySelector(`.layer[data-id="${grid.id}"] .lgm`),
  };
}, compare);
t('the GM only switch marks the layer and the map as changed', marked.gm && marked.dirty);
t('and is one step in the history, called GM only', marked.past === beforeMark.past + 1 && marked.label === 'GM only',
  marked.label);
t('the layer row says GM', marked.badge);
t('a GM-only layer is left out of the players\' copy', marked.vsRef === 0, marked.vsRef + ' pixels differ');
t('the GM\'s copy is unchanged by the mark', marked.flat === beforeMark.flat);
t('and so is the screen', marked.screen === beforeMark.screen);

const undone = await p.evaluate(async () => {
  const h = await import('/js/history.js');
  const grid = window.__cg.app.doc.layers.find((l) => l.kind === 'grid');
  h.undo();
  const a = grid.gm;
  const badge = !!document.querySelector(`.layer[data-id="${grid.id}"] .lgm`);
  h.redo();
  return { undone: a, badge, redone: grid.gm };
});
t('undo takes the mark off, badge and all', !undone.undone && !undone.badge, JSON.stringify(undone));
t('and redo puts it back', undone.redone === true);

/* groups -------------------------------------------------------------------- */

const grouped = await p.evaluate(async (cmp) => {
  const diff = eval(cmp);
  const { app, R } = window.__cg;
  const ui = await import('/js/ui.js');
  const d = await import('/js/doc.js');
  const grid = app.doc.layers.find((l) => l.kind === 'grid');
  const notes = app.doc.layers.find((l) => l.kind === 'notes');
  // The grid's own mark off again, so the group is the only thing deciding.
  ui.setLayerGM(grid, false);
  const paperish = app.doc.layers.find((l) => l.kind === 'objects');
  const g = ui.addGroup();
  ui.setLayerGroup(grid, g.id);
  const before = d.layerGM(app.doc, grid);
  ui.setLayerGM(g, true);
  const after = d.layerGM(app.doc, grid);
  const players = R.flatten({ scale: 1, players: true });
  const noGrid = R.flatten({ scale: 1, players: true, grid: false });
  const badge = !!document.querySelector(`.layer[data-id="${grid.id}"] .lgm`);
  const summary = d.playersSummary(app.doc);
  return { before, after, same: diff(players, noGrid).n, badge, summary, notesUntouched: !d.layerGM(app.doc, notes),
           objects: paperish && !d.layerGM(app.doc, paperish) };
}, compare);
t('a layer in a group marked GM only is GM only too', !grouped.before && grouped.after);
t('and is left out of the players\' copy with it', grouped.same === 0, grouped.same + ' pixels');
t('its row says GM as well', grouped.badge);
t('layers outside the group are not marked', grouped.notesUntouched && grouped.objects);
t('the summary counts the secret door, the pin and the hidden layer',
  grouped.summary.secret === 1 && grouped.summary.pins === 1 && grouped.summary.layers.includes('Grid'),
  JSON.stringify(grouped.summary));

/* the tabletop file --------------------------------------------------------- */

const vtt = await p.evaluate(() => {
  const { app, R } = window.__cg;
  const gm = R.toUVTT('data:image/png;base64,AA', { bakedLighting: false });
  const pl = R.toUVTT('data:image/png;base64,AA', { bakedLighting: false, players: true });
  const walls = app.doc.layers.find((l) => l.kind === 'walls');
  walls.gm = true;
  const hidden = R.toUVTT('data:image/png;base64,AA', { bakedLighting: false, players: true });
  const gmStill = R.toUVTT('data:image/png;base64,AA', { bakedLighting: false });
  delete walls.gm;
  return { gm: [gm.portals.length, gm.line_of_sight.length], pl: [pl.portals.length, pl.line_of_sight.length],
           hidden: [hidden.portals.length, hidden.line_of_sight.length],
           gmStill: [gmStill.portals.length, gmStill.line_of_sight.length] };
});
t('the GM\'s tabletop file has both doors as portals', vtt.gm[0] === 2 && vtt.gm[1] === 6, JSON.stringify(vtt.gm));
t('the players\' has the secret door as a wall, not a door', vtt.pl[0] === 1 && vtt.pl[1] === 7, JSON.stringify(vtt.pl));
t('a GM-only walls layer leaves no walls in the players\' file and all of them in the GM\'s',
  vtt.hidden[0] === 0 && vtt.hidden[1] === 0 && vtt.gmStill[1] === 6, JSON.stringify([vtt.hidden, vtt.gmStill]));

/* the map file -------------------------------------------------------------- */

const saved = await p.evaluate(async () => {
  const { saveProject, app } = await import('/js/app.js');
  await saveProject();
  return app.slug;
});
const flatBefore = await p.evaluate(() => window.__cg.R.flatten({ scale: 0.25 }).toDataURL());
await p.reload({ waitUntil: 'networkidle' });
await ready(p);
await p.waitForFunction((slug) => window.__cg.app.slug === slug, saved, { timeout: 15000 });
await p.waitForTimeout(500);
const reloaded = await p.evaluate(async () => {
  const { app, R } = window.__cg;
  const d = await import('/js/doc.js');
  const g = app.doc.layers.find((l) => l.kind === 'group');
  const grid = app.doc.layers.find((l) => l.kind === 'grid');
  return { group: !!(g && g.gm), grid: d.layerGM(app.doc, grid), flat: R.flatten({ scale: 0.25 }).toDataURL() };
});
t('the mark is in the map file and survives a reload', reloaded.group && reloaded.grid);
t('and the map reloads pixel-identical', reloaded.flat === flatBefore);

/* export -------------------------------------------------------------------- */

const puts = [];
const written = [];
p.on('response', async (r) => {
  if (r.url().includes('/api/export') && r.request().method() === 'PUT') {
    try { written.push((await r.json()).path || ''); } catch { /* not ours */ }
  }
});
p.on('request', (r) => {
  if (r.url().includes('/api/export') && r.method() === 'PUT') {
    puts.push({ name: new URL(r.url()).searchParams.get('name') || '' });
  }
});
// A Blob body is not visible to the request event, so keep the tabletop files'
// text as the page sends them.
await p.evaluate(() => {
  window.__sent = {};
  const real = window.fetch;
  window.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('/api/export') && /dd2vtt/.test(decodeURIComponent(u)) && init && init.body instanceof Blob) {
      window.__sent[decodeURIComponent(u)] = await init.body.text();
    }
    return real(url, init);
  };
});
await p.keyboard.press('Control+e');
await p.waitForSelector('.modal [data-export="players"]', { timeout: 5000 });
const noteHidden = await p.isHidden('.modal [data-export="players-note"]');
await p.check('.modal [data-export="players"]');
await p.waitForTimeout(150);
const note = await p.textContent('.modal [data-export="players-note"]');
t('ticking the players\' copy says what it will change', noteHidden && /secret door/.test(note) && /Grid/.test(note), note);
await p.screenshot({ path: '/tmp/cg_players_export.png' });
const downloads = [];
p.on('download', (d) => downloads.push(d.suggestedFilename()));
const done = p.waitForResponse((r) => r.url().includes('-players.dd2vtt') || (r.url().includes('/api/export')
  && decodeURIComponent(r.url()).includes('players.dd2vtt')), { timeout: 60000 });
await p.click('.modal .btn-primary');
await done;
await p.waitForTimeout(1500);
const names = puts.map((x) => x.name);
// The server numbers a name already taken, and the players' copy is named
// after the file the GM's image actually went to.
const gmPath = (written.find((x) => /\.png$/.test(x) && !/-players/.test(x)) || '').split(/[\\/]/).pop();
const stem = gmPath.replace(/\.png$/, '');
t('Export writes the GM\'s image and a players\' image beside it',
  !!stem && names.includes(stem + '-players.png'), names.join(', '));
const sent = await p.evaluate(() => window.__sent);
const plKey = Object.keys(sent).find((k) => /-players\.dd2vtt$/.test(k));
let plData = null;
try { plData = JSON.parse(sent[plKey]); } catch { /* reported below */ }
t('and a players\' tabletop file with the secret door as a wall',
  !!plData && plData.portals.length === 1 && plData.line_of_sight.length === 7,
  plData ? JSON.stringify([plData.portals.length, plData.line_of_sight.length]) : 'no file');
t('and offers both images to download', downloads.some((n) => /-players\.png$/.test(n)) && downloads.some((n) => /^[^-]*\.png$/.test(n) || !/-players/.test(n)),
  downloads.join(', '));

/* print --------------------------------------------------------------------- */

await p.keyboard.press('Control+p');
await p.waitForSelector('.modal [data-print="preview"]', { timeout: 5000 });
const copySel = p.locator('.modal .field', { hasText: 'Copy' }).locator('select');
await copySel.selectOption('players');
await p.waitForTimeout(150);
const pnote = await p.textContent('.modal [data-print="players"]');
t('the Print dialog offers the players\' copy and says what it changes', /secret door/.test(pnote), pnote);
await p.screenshot({ path: '/tmp/cg_players_print.png' });
const pdfPut = p.waitForResponse((r) => r.url().includes('/api/export') && r.request().method() === 'PUT', { timeout: 60000 });
await p.click('.modal .btn-primary');
const pdfRes = await pdfPut;
const pdfBody = await pdfRes.json().catch(() => ({}));
t('and Make the PDF writes a players\' print', pdfRes.ok() && /players - print(-\d+)?\.pdf$/.test(pdfBody.path || ''), pdfBody.path);

const sheet = await p.evaluate(async () => {
  const m = await import('/js/print.js');
  const doc = window.__cg.app.doc;
  const made = await m.buildPrint(doc, { players: true, index: false, dpi: 100 });
  const text = new TextDecoder('latin1').decode(made.bytes);
  // pdf.js escapes the brackets in a string, as the format requires.
  const pages = (text.match(/\/Type \/Page\b/g) || []).length;
  const named = (text.match(/players' copy\\\)/g) || []).length;
  return { named: named > 0 && named >= pages, pages, n: named };
});
t('a players\' print says so on every sheet', sheet.named, sheet.n + ' of ' + sheet.pages + ' pages');

t('no request left 127.0.0.1', offHost.length === 0, offHost.slice(0, 3).join(' '));
t('no console errors', errs.length === 0, errs.slice(0, 3).join(' | '));

report();
await b.close();
process.exit(fails ? 1 : 0);
