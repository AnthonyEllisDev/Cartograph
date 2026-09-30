/* Prefabs: a set of things saved off one map and put down on another.
 *
 * Builds a small guard post on one battle map -- a lamp, a wall and a door --
 * saves it as a prefab from the Selected panel, and puts it down on a second
 * map from the Select tool's Prefabs strip and from the command palette. It
 * checks that the file lands on disk through the API, that placing is one undo
 * step that keeps the set's shape, snaps its walls to the grid, relights and
 * turns the night on, that the placed copies are picked up, that the map
 * reloads pixel-identical, that a prefab's name is text and never markup, that
 * the server refuses what the editor could not place and skips a broken file
 * rather than emptying the list, and that deleting asks first.
 *
 * Every prefab it saves is named with a run tag and deleted at the end, so a
 * person's own prefabs are never touched and two runs do not see each other's.
 *
 * Start the server first:  python3 app.py --no-browser --port 7871
 * Then:                    node test/prefabs.mjs [http://127.0.0.1:7871]
 */

import fs from 'node:fs';
import path from 'node:path';
import { launch, base, ready, newMap } from './browser.mjs';

const out = [];
let fails = 0;
function t(name, pass, note) {
  out.push([pass ? 'PASS' : 'FAIL', name, note == null ? '' : String(note)]);
  if (!pass) fails++;
}

const URL0 = base('http://127.0.0.1:7871/');
const TAG = 'T' + Date.now().toString(36);
const made = new Set();     // slugs this run saved, removed in the finally

async function cleanup() {
  const res = await fetch(URL0 + 'api/prefabs').then((r) => r.json()).catch(() => ({ prefabs: [] }));
  for (const pf of res.prefabs || []) {
    if (made.has(pf.slug) || pf.name.includes(TAG)) {
      await fetch(URL0 + 'api/prefabs/' + encodeURIComponent(pf.slug), { method: 'DELETE' }).catch(() => {});
    }
  }
}

function report() {
  for (const [status, name, note] of out) console.log(status.padEnd(5), name, note ? ' [' + note + ']' : '');
  console.log(`\n${out.length - fails}/${out.length} passed`);
}

process.on('unhandledRejection', async (err) => {
  await cleanup();
  report();
  console.log('\nthrew: ' + (err && err.message));
  process.exit(1);
});

const b = await launch();
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => {
  // The server's own 400s for the malformed bodies below are the point of
  // those checks, and a browser logs every failed fetch as an error.
  if (m.type() === 'error' && !/400|404/.test(m.text())) errs.push('console: ' + m.text());
});
await p.goto(URL0, { waitUntil: 'networkidle' });
await ready(p);

const M = (mx, my) => p.evaluate(([x, y]) => {
  const s = window.__cg.mapToScreen(x, y);
  const r = document.getElementById('canvas').getBoundingClientRect();
  return { x: r.left + s.x, y: r.top + s.y };
}, [mx, my]);
const tool = async (n) => { await p.click(`.tool[data-tool="${n}"]`); await p.waitForTimeout(250); };
const click = async (mx, my) => { const s = await M(mx, my); await p.mouse.click(s.x, s.y); await p.waitForTimeout(180); };
const press = async (k) => { await p.keyboard.press(k); await p.waitForTimeout(260); };
const ops = (kind) => p.evaluate((k) => {
  const l = window.__cg.app.doc.layers.find((x) => x.kind === k);
  return l ? JSON.parse(JSON.stringify(l.ops)) : null;
}, kind);
const layerField = (kind, key) => p.evaluate(([k, f]) => {
  const l = window.__cg.app.doc.layers.find((x) => x.kind === k); return l ? l[f] : undefined;
}, [kind, key]);
const past = () => p.evaluate(() => window.__cg.history.past.length);
const lastLabel = () => p.evaluate(() => {
  const h = window.__cg.history.past; return h.length ? h[h.length - 1].label : null;
});
const held = () => p.evaluate(async () => (await import('/js/tools.js')).selectedObjects().length);
const fingerprint = () => p.evaluate(() => {
  const c = window.__cg.R.flatten({ scale: 1, grid: true, paper: true });
  const s = document.createElement('canvas'); s.width = 64; s.height = 64;
  const x = s.getContext('2d'); x.drawImage(c, 0, 0, 64, 64);
  return Array.from(x.getImageData(0, 0, 64, 64).data).join(',');
});
const onLine = (v) => Math.abs(v / 70 - Math.round(v / 70)) < 1e-6;
const listed = () => fetch(URL0 + 'api/prefabs').then((r) => r.json()).then((j) => j.prefabs);
const post = (body, headers = {}) => fetch(URL0 + 'api/prefabs', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

try {
  /* ======================================================================== *
   * The guard post: a lamp, a wall and a door on a 40 x 30 battle map.
   * ======================================================================== */

  await newMap(p, { name: 'Prefab Source', kind: 'battle', size: '40x30' });
  await tool('select');
  const saveLink = await p.$('.prefabs [data-action="save-prefab"]');
  t('the Select tool shows a Prefabs strip', !!saveLink);
  t('its Save link is off while nothing is held',
    saveLink ? await saveLink.evaluate((n) => n.disabled) : false);

  await tool('light');
  await click(700, 560);
  await p.evaluate(async () => (await import('/js/app.js')).setToolSetting('wall', 'kind', 'wall'));
  await tool('wall');
  await click(560, 700); await click(840, 700); await press('Enter');
  await p.evaluate(async () => (await import('/js/app.js')).setToolSetting('wall', 'kind', 'door'));
  await click(630, 420); await click(770, 420); await press('Enter');
  const srcWalls = await ops('walls');
  const srcLights = await ops('lights');
  t('the source map holds two walls and a light', srcWalls.length === 2 && srcLights.length === 1,
    srcWalls.length + ' walls, ' + srcLights.length + ' lights');

  await tool('select');
  await p.mouse.click(5, 500);
  await press('Control+a');
  t('Ctrl+A picks up all three', (await held()) === 3, await held());

  const nameA = 'Guard post ' + TAG;
  await p.click('#panel-selection [data-action="save-prefab"]');
  await p.waitForTimeout(250);
  await p.fill('.modal input[type=text]', nameA);
  await p.click('.modal .btn-primary');
  await p.waitForTimeout(600);
  let list = await listed();
  const a = list.find((pf) => pf.name === nameA);
  if (a) made.add(a.slug);
  t('Save as prefab writes it to the prefabs folder', !!a, list.map((x) => x.name).join(' | '));
  t('the prefab holds the three things and their kinds',
    a && a.entries.length === 3 && a.kinds.filter((k) => k === 'walls').length === 2 && a.kinds.includes('lights'),
    a && a.kinds.join(','));
  t('it records the grid it was drawn on', a && a.cell === 70, a && a.cell);
  t('saving a prefab is not a step in the map\'s history', (await lastLabel()) !== 'Save as prefab');

  // The file itself: readable JSON beside the program, as a map is.
  const state = await fetch(URL0 + 'api/state').then((r) => r.json());
  const dir = state.folders && state.folders.prefabs;
  let onDisk = null;
  try { onDisk = JSON.parse(fs.readFileSync(path.join(dir, a.slug + '.json'), 'utf8')); } catch (_) { /* measured below */ }
  t('on disk it is one readable JSON file named after the prefab',
    onDisk && onDisk.format === 1 && onDisk.name === nameA && onDisk.entries.length === 3, dir);

  const chip = await p.$(`.prefabs [data-prefab="${a && a.slug}"]`);
  t('the strip shows a chip for it', !!chip);

  /* ======================================================================== *
   * Put it down on another map.
   * ======================================================================== */

  await newMap(p, { name: 'Prefab Target', kind: 'battle', size: '40x30' });
  await tool('select');
  await p.waitForTimeout(400);
  const n0 = await past();
  t('the new map starts with no walls, no lights and the night off',
    (await ops('walls')).length === 0 && (await ops('lights')).length === 0 && !(await layerField('lights', 'ambient')));
  await p.click(`.prefabs [data-prefab="${a.slug}"] .chip-main`);
  await p.waitForTimeout(500);
  const walls = await ops('walls');
  const lights = await ops('lights');
  t('clicking the chip puts all three down, each on a layer of its own kind',
    walls.length === 2 && lights.length === 1, walls.length + ' walls, ' + lights.length + ' lights');
  t('as one undo step', (await past()) === n0 + 1 && /^Place /.test(await lastLabel()), await lastLabel());
  t('and they are picked up, ready to drag', (await held()) === 3, await held());
  t('the walls land on grid lines',
    walls.every((w) => w.points.every((q) => onLine(q.x) && onLine(q.y))),
    JSON.stringify(walls.map((w) => w.points)));
  // Offsets of every wall end from the lamp, before and after: one delta for
  // the lot, so they must match exactly.
  const shape = (ws, l) => ws.map((w) => w.points.map((q) => (q.x - l.x) + ',' + (q.y - l.y)).join(';')).sort().join('|');
  const kept = shape(walls, lights[0]) === shape(srcWalls, srcLights[0]);
  t('the set keeps its shape', kept);
  t('fresh ids, not the source map\'s',
    !walls.some((w) => srcWalls.some((s) => s.id === w.id)) && lights[0].id !== srcLights[0].id);
  t('the first light turns the night on', (await layerField('lights', 'ambient')) === 0.8,
    await layerField('lights', 'ambient'));

  // Centred on the view, not on where it happened to sit on the source map.
  const centre = await p.evaluate(() => {
    const R = window.__cg.R; const c = R.view.canvas;
    return window.__cg.screenToMap(c.width / R.view.dpr / 2, c.height / R.view.dpr / 2);
  });
  const xs = walls.flatMap((w) => w.points.map((q) => q.x)).concat(lights.map((l) => l.x));
  const ys = walls.flatMap((w) => w.points.map((q) => q.y)).concat(lights.map((l) => l.y));
  const mid = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  t('it goes down in the middle of the view', Math.abs(mid.x - centre.x) <= 70 && Math.abs(mid.y - centre.y) <= 70,
    `${Math.round(mid.x)},${Math.round(mid.y)} vs ${Math.round(centre.x)},${Math.round(centre.y)}`);

  await p.evaluate(async () => (await import('/js/history.js')).undo());
  await p.waitForTimeout(300);
  t('undo takes the whole set away and the night off again',
    (await ops('walls')).length === 0 && (await ops('lights')).length === 0 && !(await layerField('lights', 'ambient')));
  await p.evaluate(async () => (await import('/js/history.js')).redo());
  await p.waitForTimeout(300);
  t('redo puts it all back', (await ops('walls')).length === 2 && (await ops('lights')).length === 1);

  // From the palette, which lists every prefab.
  await p.mouse.click(5, 500);
  await p.keyboard.press('Control+k'); await p.waitForTimeout(200);
  await p.keyboard.type('Place ' + nameA); await p.waitForTimeout(200);
  await p.keyboard.press('Enter'); await p.waitForTimeout(500);
  t('the command palette places it too', (await ops('walls')).length === 4 && (await ops('lights')).length === 2,
    (await ops('walls')).length);
  t('a second placing does not turn the night on again over a setting', (await layerField('lights', 'ambient')) === 0.8);

  // The round trip.
  const before = await fingerprint();
  await p.evaluate(async () => { await (await import('/js/app.js')).saveProject({ silent: true }); });
  const slug = await p.evaluate(() => window.__cg.app.slug);
  await p.reload({ waitUntil: 'networkidle' });
  await ready(p);
  await p.waitForFunction((s) => window.__cg.app.slug === s, slug, { timeout: 15000 }).catch(() => {});
  const after = await fingerprint();
  t('the map reloads pixel-identical', before === after && (await p.evaluate(() => window.__cg.app.slug)) === slug);

  /* ======================================================================== *
   * Names are text; the server refuses what cannot be placed.
   * ======================================================================== */

  await tool('select');
  const nasty = '<img src=x onerror="window.__pwned=1"> ' + TAG;
  const r1 = await post({ name: nasty, entries: a.entries, kinds: a.kinds });
  const j1 = await r1.json();
  if (j1.prefab) made.add(j1.prefab.slug);
  const r1b = await post({ name: nameA, entries: a.entries, kinds: a.kinds });
  const j1b = await r1b.json();
  if (j1b.prefab) made.add(j1b.prefab.slug);
  t('a second prefab with the same name gets a number, not the first one\'s file',
    j1b.ok && j1b.prefab.slug !== a.slug && / 2$/.test(j1b.prefab.slug), j1b.prefab && j1b.prefab.slug);
  // Pick the Select tool up again so the strip re-reads the folder.
  await tool('pan'); await tool('select'); await p.waitForTimeout(400);
  const chipText = await p.evaluate((s) => {
    const c = document.querySelector(`.prefabs [data-prefab="${CSS.escape(s)}"]`);
    return c ? { text: c.querySelector('.chip-main').textContent, imgs: c.querySelectorAll('img').length } : null;
  }, j1.prefab && j1.prefab.slug);
  t('a name full of markup is shown as text', chipText && chipText.text === nasty && chipText.imgs === 0
    && !(await p.evaluate(() => window.__pwned)), JSON.stringify(chipText));

  const bad = [
    ['a body that is not an object', [1, 2]],
    ['entries and kinds of different lengths', { name: 'x', entries: [{ x: 1, y: 1 }], kinds: [] }],
    ['nothing in it', { name: 'x', entries: [], kinds: [] }],
    ['a paint stroke', { name: 'x', entries: [{ t: 'stroke', points: [{ x: 1, y: 1 }] }], kinds: ['raster'] }],
    ['a thing with no position', { name: 'x', entries: [{ id: 'o-1', asset: 'a' }], kinds: ['objects'] }],
    ['a point that is not a number', { name: 'x', entries: [{ points: [{ x: 'a', y: 1 }] }], kinds: ['walls'] }],
  ];
  for (const [what, body] of bad) {
    const r = await post(body);
    t('the server refuses ' + what + ' with a 400', r.status === 400, r.status);
  }
  const rNaN = await post('{"name":"x","entries":[{"x":NaN,"y":1}],"kinds":["objects"]}');
  t('and a NaN', rNaN.status === 400, rNaN.status);
  const rOrigin = await post({ name: 'x', entries: a.entries, kinds: a.kinds }, { Origin: 'http://evil.example' });
  t('a request from another origin is refused', rOrigin.status === 403, rOrigin.status);
  const rDel = await fetch(URL0 + 'api/prefabs/..%2F..%2Fapp', { method: 'DELETE' });
  t('a delete that names a path out of the folder is refused', rDel.status === 404 && fs.existsSync(path.join(dir, '..', 'app.py')), rDel.status);

  // A broken file among good ones is skipped, not allowed to empty the list.
  const brokenA = path.join(dir, 'broken ' + TAG + '.json');
  const brokenB = path.join(dir, 'shape ' + TAG + '.json');
  fs.writeFileSync(brokenA, '{ not json');
  fs.writeFileSync(brokenB, JSON.stringify({ name: 'shape', entries: [{ nope: 1 }], kinds: ['walls'] }));
  list = await listed();
  t('a broken file in the folder is skipped and the rest still listed',
    list.some((pf) => pf.slug === a.slug) && !list.some((pf) => pf.slug.startsWith('broken ') || pf.slug.startsWith('shape ')),
    list.length);
  fs.rmSync(brokenA, { force: true }); fs.rmSync(brokenB, { force: true });

  /* ======================================================================== *
   * Deleting asks first.
   * ======================================================================== */

  await tool('pan'); await tool('select'); await p.waitForTimeout(400);
  await p.click(`.prefabs [data-prefab="${a.slug}"] .chip-x`);
  await p.waitForTimeout(250);
  await p.click('.modal .btn:not(.btn-danger)');     // Keep it
  await p.waitForTimeout(300);
  t('Keep it keeps the prefab', (await listed()).some((pf) => pf.slug === a.slug));
  await p.click(`.prefabs [data-prefab="${a.slug}"] .chip-x`);
  await p.waitForTimeout(250);
  await p.click('.modal .btn-danger');
  await p.waitForTimeout(500);
  t('Delete removes the file', !(await listed()).some((pf) => pf.slug === a.slug) && !fs.existsSync(path.join(dir, a.slug + '.json')));
  t('and its chip', !(await p.$(`.prefabs [data-prefab="${a.slug}"]`)));
  t('the copies already placed stay on the map', (await ops('walls')).length === 4);

  t('no console errors', errs.length === 0, errs.slice(0, 3).join(' | '));
} finally {
  await cleanup();
}

report();
await b.close();
process.exit(fails ? 1 : 0);
