/* Asking before unsaved work is thrown away, and the backup kept either way.
 *
 * Opening another map, starting a new one or restoring a backup used to
 * replace the map on screen without a word. Now the editor asks -- and writes
 * a backup before it asks, so a click through the question costs a trip to
 * the Backups list rather than the work.
 *
 * Start the server first:  python3 app.py --no-browser --port 7871
 * Then:                    node test/backups.mjs [http://127.0.0.1:7871]
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

const URL0 = base('http://127.0.0.1:7871/');
const b = await launch();
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = [];
const external = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); });
p.on('request', (r) => {
  const u = new URL(r.url());
  if (!['127.0.0.1', 'localhost'].includes(u.hostname) && !['data:', 'blob:'].includes(u.protocol)) external.push(r.url());
});
await p.goto(URL0, { waitUntil: 'networkidle' });
await ready(p);

const tag = Date.now().toString(36);
const NAME_A = 'Backup A ' + tag;
const backups = () => p.evaluate(async () => (await (await fetch('/api/backups')).json()).backups);
// The folder keeps twenty, and other suites fill it, so a count cannot tell
// whether one was added: the newest one's id can.
const newest = async () => { const l = await backups(); return l[0] ? l[0].id : null; };
const fp = () => p.evaluate(() => {
  const R = window.__cg.R;
  const c = R.flatten({ scale: 0.25, grid: false, paper: false, lights: false });
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let h = 0; for (let i = 0; i < d.length; i += 7) h = (h * 31 + d[i]) >>> 0;
  return h;
});
const M = (mx, my) => p.evaluate(([x, y]) => {
  const s = window.__cg.mapToScreen(x, y);
  const r = document.getElementById('canvas').getBoundingClientRect();
  return { x: r.left + s.x, y: r.top + s.y };
}, [mx, my]);
async function stroke(y) {
  await p.click('.tab[data-tab="map"]');
  await p.click('.tool[data-tool="brush"]');
  await p.waitForTimeout(150);
  await p.click('#asset-picker .asset >> nth=4');
  await p.waitForTimeout(250);
  const a = await M(300, y), z = await M(1500, y + 80);
  await p.mouse.move(a.x, a.y); await p.mouse.down();
  await p.mouse.move(z.x, z.y, { steps: 10 }); await p.mouse.up();
  await p.waitForTimeout(400);
}
const opsOnMap = () => p.evaluate(() => window.__cg.app.doc.layers.reduce((n, l) => n + l.ops.length, 0));
/* Press New map and Create, and stop at whatever comes up. */
async function pressNew(name) {
  await p.click('.tab[data-tab="projects"]');
  await p.waitForTimeout(200);
  await p.click('#btn-new-project');
  await p.waitForTimeout(300);
  await p.fill('.modal input[type=text]', name);
  await p.click('.modal .btn-primary');
  await p.waitForTimeout(900);
}
const asking = () => p.evaluate(() => {
  const m = document.querySelector('.modal');
  if (!m || !m.textContent.includes('Discard unsaved changes?')) return null;
  const note = m.querySelector('[data-discard]');
  return { text: m.textContent, kept: note && note.getAttribute('data-discard') };
});

/* ---- a new map over unsaved work ----------------------------------------- */

await newMap(p, { name: NAME_A, kind: 'region' });
const untouched = await newest();
await pressNew('Should not ask ' + tag);
const quiet = await asking();
const nameNow = await p.evaluate(() => window.__cg.app.doc.name);
t('a new map nobody has touched is replaced without a question or a backup',
  !quiet && nameNow === 'Should not ask ' + tag && (await newest()) === untouched, nameNow);

await newMap(p, { name: NAME_A, kind: 'region' });
await stroke(600);
const opsA = await opsOnMap();
const fpA = await fp();
const n0 = await newest();
await pressNew('Never made ' + tag);
const q1 = await asking();
t('creating a new map over unsaved changes asks first',
  q1 && /Creating a new map will discard all the unsaved changes to .Backup A/.test(q1.text), q1 && q1.text.slice(0, 120));
const n1 = await newest();
t('and a backup is already kept before the answer',
  q1 && q1.kept === 'backed-up' && n1 !== n0 && n1.endsWith(NAME_A.replace(/[^A-Za-z0-9 _-]/g, '')), `${n0} -> ${n1}`);
await p.click('.modal button:has-text("Cancel")');
await p.waitForTimeout(400);
const kept = await p.evaluate(() => ({ name: window.__cg.app.doc.name, dirty: window.__cg.app.dirty }));
t('Cancel leaves the map and its changes on screen',
  kept.name === NAME_A && kept.dirty && (await opsOnMap()) === opsA && (await fp()) === fpA, JSON.stringify(kept));

await pressNew('Fresh ' + tag);
const q2 = await asking();
const n2 = await newest();
t('asking again keeps another backup, whatever the answer will be', q2 && n2 !== n1, `${n1} -> ${n2}`);
await p.click('.modal button:has-text("Discard and continue")');
await p.waitForTimeout(900);
const fresh = await p.evaluate(() => window.__cg.app.doc.name);
t('Discard and continue makes the new map', fresh === 'Fresh ' + tag, fresh);

/* ---- the Backups list, and restoring ------------------------------------- */

await p.click('.tab[data-tab="projects"]');
await p.waitForTimeout(600);
const listed = await p.evaluate(() => [...document.querySelectorAll('#backup-list .backup-row')]
  .map((r) => ({ id: r.getAttribute('data-backup'), text: r.textContent })));
t('the Backups section lists it, newest first, with why it was kept',
  listed.length >= 2 && listed[0].text.includes(NAME_A) && listed[0].text.includes('before a new map'),
  listed.slice(0, 2).map((r) => r.text.slice(0, 80)).join(' | '));

await p.click(`#backup-list .backup-row[data-backup="${listed[0].id}"] [data-action="restore-backup"]`);
await p.waitForTimeout(1200);
const q3 = await asking();
const restored = await p.evaluate(() => ({
  name: window.__cg.app.doc.name, slug: window.__cg.app.slug, dirty: window.__cg.app.dirty,
}));
t('restoring over an untouched map asks nothing', !q3, q3 && q3.text.slice(0, 60));
t('the backup comes back as a new, unsaved map, marked restored',
  restored.name === NAME_A + ' (restored)' && restored.slug === null && restored.dirty, JSON.stringify(restored));
t('exactly as it was: the same strokes, the same pixels',
  (await opsOnMap()) === opsA && (await fp()) === fpA, `${await opsOnMap()} ops of ${opsA}`);

// Saving it makes a project of its own.
const savedSlug = await p.evaluate(async () => (await import('/js/app.js')).saveProject({ silent: true }));
t('saving a restored map makes a project of its own', typeof savedSlug === 'string' && /restored/.test(savedSlug), savedSlug);

/* ---- opening a project over unsaved work ---------------------------------- */

await stroke(300);
await p.click('.tab[data-tab="projects"]');
await p.waitForTimeout(600);
const before = await newest();
const other = await p.evaluate(async () => (await (await fetch('/api/projects')).json()).projects
  .find((x) => x.slug !== window.__cg.app.slug));
await p.locator('.project-card', { hasText: other.name }).first().locator('.btn-primary').click();
await p.waitForTimeout(900);
const q4 = await asking();
t('opening another map over unsaved changes asks, naming the map being opened',
  q4 && q4.text.includes('Opening') && q4.text.includes(other.name) && (await newest()) !== before,
  q4 && q4.text.slice(0, 120));
await p.click('.modal button:has-text("Cancel")');
await p.waitForTimeout(400);
t('and Cancel keeps the map', await p.evaluate((s) => window.__cg.app.slug === s, savedSlug), savedSlug);

/* ---- when the backup cannot be written ------------------------------------ */

await p.route('**/api/backups', (route) => (route.request().method() === 'POST'
  ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"ok":false,"error":"disk full"}' })
  : route.continue()));
await pressNew('Unbacked ' + tag);
const q5 = await asking();
t('a backup that fails is said so, and the question is still put',
  q5 && q5.kept === 'no-backup' && q5.text.includes('disk full'), q5 && q5.text.slice(-120));
await p.click('.modal button:has-text("Cancel")');
await p.waitForTimeout(300);
await p.unroute('**/api/backups');

/* ---- deleting, pruning, the server's guards ------------------------------- */

await p.click('.tab[data-tab="projects"]');
await p.waitForTimeout(600);
const victim = await p.evaluate(() => document.querySelector('#backup-list .backup-row').getAttribute('data-backup'));
await p.click(`#backup-list .backup-row[data-backup="${victim}"] [data-action="delete-backup"]`);
await p.waitForTimeout(300);
await p.click('.modal .btn-danger');
await p.waitForTimeout(700);
const gone = await p.evaluate(async (id) => ({
  listed: !!document.querySelector(`#backup-list .backup-row[data-backup="${CSS.escape(id)}"]`),
  status: (await fetch('/api/backups/' + encodeURIComponent(id))).status,
}), victim);
t('Delete takes a backup off the list and off the disk', !gone.listed && gone.status === 404, JSON.stringify(gone));

const pruned = await p.evaluate(async () => {
  const doc = { name: 'Prune', layers: [{ id: 'a', kind: 'paper', ops: [] }] };
  let last = null;
  for (let i = 0; i < 23; i++) {
    const r = await (await fetch('/api/backups', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ doc, reason: 'prune ' + i }) })).json();
    last = r.backup.id;
  }
  const list = (await (await fetch('/api/backups')).json()).backups;
  return { n: list.length, newest: list[0].id === last, reason: list[0].reason };
});
t('only the newest twenty are kept', pruned.n === 20 && pruned.newest && pruned.reason === 'prune 22', JSON.stringify(pruned));

const guards = await p.evaluate(async () => {
  const post = (body) => fetch('/api/backups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  return {
    notObject: (await post('{"doc": 5}')).status,
    noLayers: (await post('{"doc": {"name": "x", "layers": []}}')).status,
    nan: (await post('{"doc": {"name": NaN, "layers": [{"id": "a"}]}}')).status,
    escape: (await fetch('/api/backups/' + encodeURIComponent('../projects/x'))).status,
    del: (await fetch('/api/backups/' + encodeURIComponent('../../app'), { method: 'DELETE' })).status,
    staticRead: (await fetch('/backups/')).status,
  };
});
t('the server refuses a backup that would not open, and any path out of the folder',
  guards.notObject === 400 && guards.noLayers === 400 && guards.nan === 400 && guards.escape === 404 && guards.del === 404,
  JSON.stringify(guards));
t('and the folder is not served as files', guards.staticRead === 404, guards.staticRead);
const foreign = await fetch(URL0 + 'api/backups', {
  method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: 'http://evil.example' },
  body: JSON.stringify({ doc: { name: 'x', layers: [{ id: 'a' }] } }),
});
t('a page on another origin cannot write one', foreign.status === 403, foreign.status);

// Leave the folder as tidy as the suite found it: the pruning test filled it.
await p.evaluate(async () => {
  for (const x of (await (await fetch('/api/backups')).json()).backups) {
    if (/^Prune$/.test(x.name)) await fetch('/api/backups/' + encodeURIComponent(x.id), { method: 'DELETE' });
  }
  await fetch('/api/projects/' + encodeURIComponent(window.__cg.app.slug), { method: 'DELETE' }).catch(() => {});
}).catch(() => {});

t('no request leaves 127.0.0.1', external.length === 0, external.slice(0, 3).join(' '));
t('no console errors', errs.length === 0, errs.slice(0, 3).join(' | '));
report();
await b.close();
process.exit(fails ? 1 : 0);
