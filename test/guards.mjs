/* The two server guards, and the things that quietly went round them.
 *
 * Start the server first:  python3 app.py --no-browser --port 7871
 * Then:                    node test/guards.mjs [http://127.0.0.1:7871]
 *
 * No browser here. Every check in this file is about what the server does with
 * bytes a browser would never send in that order, which is exactly why the
 * bugs it covers were not visible from inside the editor.
 */

import net from 'node:net';
import { mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { base } from './browser.mjs';

const BASE = base('http://127.0.0.1:7871/').replace(/\/$/, '');
const { hostname, port } = new URL(BASE);

const out = [];
let fails = 0;
function t(name, pass, note) {
  out.push([pass ? 'PASS' : 'FAIL', name, note == null ? '' : String(note)]);
  if (!pass) fails++;
}

/** Send raw bytes down one connection and collect everything that comes back.
 *
 * The whole point is to count the *responses*: a request that is refused and
 * then answers a second time has left the first request's body on the socket
 * and parsed it as a new one -- which is how a page on another site smuggled
 * an Origin-less request past a guard that had just refused it. */
function raw(bytes, wait = 500) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: hostname, port: Number(port) });
    let buf = '';
    const finish = () => { sock.destroy(); resolve(buf); };
    sock.on('connect', () => { sock.write(bytes); setTimeout(finish, wait); });
    sock.on('data', (d) => { buf += d.toString('latin1'); });
    sock.on('error', finish);
  });
}
const statuses = (text) => (text.match(/HTTP\/1\.[01] (\d{3})/g) || []).map((s) => s.slice(-3));

const CRLF = '\r\n';
const smuggled = `GET /api/state HTTP/1.1${CRLF}Host: x${CRLF}${CRLF}`;

/* the Origin guard, and the body it used to leave behind -------------------- */

{
  const text = await raw(
    `POST /api/projects HTTP/1.1${CRLF}Host: ${hostname}:${port}${CRLF}` +
    `Origin: https://evil.example.com${CRLF}Content-Type: text/plain${CRLF}` +
    `Content-Length: ${smuggled.length}${CRLF}${CRLF}${smuggled}`);
  const codes = statuses(text);
  t('a cross-origin write is refused', codes[0] === '403', codes.join(' then ') || 'no reply');
  t('and its body cannot be read back as a second request', codes.length === 1,
    codes.length > 1 ? 'the smuggled request answered ' + codes[1] : 'one response only');
}

{
  const text = await raw(
    `PUT /api/export?name=smuggle.png HTTP/1.1${CRLF}Host: ${hostname}:${port}${CRLF}` +
    `Content-Length: 999999999${CRLF}${CRLF}${smuggled}`);
  const codes = statuses(text);
  t('an oversized body is refused', codes[0] === '413', codes.join(' then '));
  t('and nothing hides behind the refusal', codes.length === 1, codes.join(' then '));
}

{
  const text = await raw(
    `OPTIONS /api/state HTTP/1.1${CRLF}Host: ${hostname}:${port}${CRLF}` +
    `Content-Length: ${smuggled.length}${CRLF}${CRLF}${smuggled}`);
  t('nor behind an OPTIONS with a body', statuses(text).length === 1, statuses(text).join(' then '));
}

{
  const text = await raw(
    `POST /api/projects HTTP/1.1${CRLF}Host: ${hostname}:${port}${CRLF}` +
    `Transfer-Encoding: chunked${CRLF}${CRLF}0${CRLF}${CRLF}`);
  t('a chunked body is refused rather than read as empty', statuses(text)[0] === '411',
    statuses(text).join(' then '));
}

{
  const text = await raw(
    `POST /api/projects HTTP/1.1${CRLF}Host: ${hostname}:${port}${CRLF}` +
    `Content-Length: abc${CRLF}${CRLF}`);
  t('a Content-Length that is not a number answers rather than dying',
    statuses(text)[0] === '400', statuses(text).join(' then ') || 'no reply at all');
}

{
  // A negative length used to reach rfile.read(-1), which blocks until the
  // peer closes -- a thread held for as long as the caller cared to wait.
  const text = await raw(
    `POST /api/projects HTTP/1.1${CRLF}Host: ${hostname}:${port}${CRLF}` +
    `Content-Length: -1${CRLF}${CRLF}`, 1200);
  t('a negative Content-Length is refused, not waited on',
    statuses(text)[0] === '400', statuses(text).join(' then ') || 'the thread is still waiting');
}

{
  const text = await raw(`GET /a%00b HTTP/1.1${CRLF}Host: ${hostname}:${port}${CRLF}${CRLF}`);
  t('a NUL byte in a path is refused rather than crashing the handler',
    statuses(text)[0] === '403', statuses(text).join(' then ') || 'no reply at all');
}

{
  const text = await raw(`GET /api/state HTTP/1.1${CRLF}Host: ${hostname}:${port}${CRLF}` +
                         `Origin: https://evil.example.com${CRLF}${CRLF}`);
  t('a cross-origin read is refused too', statuses(text)[0] === '403', statuses(text).join(' then '));
}

{
  const text = await raw(`GET /api/state HTTP/1.1${CRLF}Host: ${hostname}:${port}${CRLF}${CRLF}`);
  t('an ordinary same-origin request still works', statuses(text)[0] === '200', statuses(text).join(' then '));
}

/* layer blobs: swept when orphaned, kept when not --------------------------- */

const json = async (method, path, body) => {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
};

const doc = {
  format: 1, kind: 'region', name: 'Guard Check', width: 512, height: 512,
  scale: { unit: 'mi', perCell: 10, cellPx: 96 },
  layers: [{ id: 'l-guard', kind: 'raster', name: 'Paint 1', visible: true, opacity: 1, ops: [] }],
};

let slug = null;
try {
  slug = (await json('POST', '/api/projects', doc)).project.slug;

  await fetch(`${BASE}/api/projects/${encodeURIComponent(slug)}/layer/l-guard`, {
    method: 'PUT', headers: { 'Content-Type': 'image/png' },
    body: Buffer.from('\x89PNG\r\n\x1a\n' + 'x'.repeat(40), 'latin1'),
  });

  const listed = async () => (await fetch(`${BASE}/projects/${encodeURIComponent(slug)}/layers/l-guard.png`)).status;
  t('an imported-pixel layer writes its blob', (await listed()) === 200);

  // The sweep used to test l.raster -- a property no layer has ever had,
  // because raster is a layer *kind* -- so the keep list was always empty and
  // every save, autosave included, deleted the pixels it had just written.
  await json('PUT', `/api/projects/${encodeURIComponent(slug)}`, doc);
  t('saving the map keeps the blob of a layer that is still in it', (await listed()) === 200);

  await json('PUT', `/api/projects/${encodeURIComponent(slug)}`, { ...doc, layers: [] });
  t('and sweeps it once that layer has gone', (await listed()) === 404);

  const noId = await json('PUT', `/api/projects/${encodeURIComponent(slug)}`,
                          { ...doc, layers: [{ kind: 'raster', ops: [] }] });
  t('a layer with no id does not fail the save', noId.ok === true, JSON.stringify(noId).slice(0, 90));
} finally {
  if (slug) await fetch(`${BASE}/api/projects/${encodeURIComponent(slug)}`, { method: 'DELETE' });
}

/* exports must not overwrite each other, even all at once ------------------- */

{
  const n = 6;
  const body = Buffer.from('not really a png');
  const results = await Promise.all(Array.from({ length: n }, () =>
    fetch(`${BASE}/api/export?name=GuardRace.png`, { method: 'PUT', body })
      .then((r) => r.json())));
  const paths = new Set(results.filter((r) => r.ok).map((r) => r.path));
  // Claiming the name and opening it used to be two steps, so two exports
  // racing for the same name both saw it free and one lost its bytes.
  t('concurrent exports each get a name of their own', paths.size === n,
    `${paths.size} distinct paths from ${n} exports`);
}

/* the same desync, on the paths the /api/ guard never covered ---------------- */

{
  // The refusal machinery guarded /api/ and nothing else, and the 405 just
  // below it answered and read on. A cross-origin POST to any other path
  // therefore had its body parsed as a fresh request -- one carrying no
  // Origin, so it passed the very check the first one had just failed. A
  // CORS-simple fetch sends exactly this with no preflight.
  const payload = '{"name":"GuardSmuggle","kind":"region"}';
  const write = `POST /api/projects HTTP/1.1${CRLF}Host: ${hostname}:${port}${CRLF}` +
    `Content-Type: application/json${CRLF}` +
    `Content-Length: ${Buffer.byteLength(payload)}${CRLF}${CRLF}${payload}`;
  const text = await raw(
    `POST /not-an-api-path HTTP/1.1${CRLF}Host: ${hostname}:${port}${CRLF}` +
    `Origin: https://evil.example.com${CRLF}Content-Type: text/plain${CRLF}` +
    `Content-Length: ${write.length}${CRLF}${CRLF}${write}`);
  const codes = statuses(text);
  t('a cross-origin POST to a static path is refused', codes[0] === '405', codes.join(' then '));
  t('and its body cannot be read back as a second request', codes.length === 1,
    codes.length > 1 ? 'the smuggled request answered ' + codes[1] : 'one response only');
  const { projects } = await fetch(`${BASE}/api/projects`).then((r) => r.json());
  t('and nothing it asked for reached the disk',
    !projects.some((pr) => pr.slug === 'GuardSmuggle'), projects.length + ' maps');
}

{
  // A GET with a body is the same hole wearing a different verb: the static
  // branch has no use for the bytes, but leaving them unread is what lets the
  // next parse find a request in them.
  const text = await raw(
    `GET /index.html HTTP/1.1${CRLF}Host: ${hostname}:${port}${CRLF}` +
    `Content-Length: ${smuggled.length}${CRLF}${CRLF}${smuggled}`);
  const codes = statuses(text);
  t('a static GET carrying a body answers once', codes.length === 1, codes.join(' then '));
}

{
  const chunked =
    `OPTIONS /api/state HTTP/1.1${CRLF}Host: ${hostname}:${port}${CRLF}` +
    `Transfer-Encoding: chunked${CRLF}${CRLF}4${CRLF}oops${CRLF}0${CRLF}${CRLF}`;
  const codes = statuses(await raw(chunked));
  t('a chunked OPTIONS body is refused rather than left on the socket',
    codes[0] === '411' && codes.length === 1, codes.join(' then '));
}

{
  // Two lengths that disagree are a desync in a bow: we would read one of them
  // and leave the difference behind for the next parse.
  const codes = statuses(await raw(
    `POST /api/projects HTTP/1.1${CRLF}Host: ${hostname}:${port}${CRLF}` +
    `Content-Length: 5${CRLF}Content-Length: 40${CRLF}${CRLF}hello`));
  t('two disagreeing Content-Length headers are refused',
    codes[0] === '400' && codes.length === 1, codes.join(' then '));
}

/* one bad file must not empty a whole library ------------------------------- */

{
  const root = fileURLToPath(new URL('..', import.meta.url));
  const made = [];
  const put = (rel, text) => {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
    made.push(dirname(full));
  };
  try {
    // Valid JSON of the wrong shape. Each of these used to raise out of its
    // endpoint and take every good file on disk down with it.
    put('assets/packs/guard-bad/pack.json',
        '{"name":"Bad","assets":[{"id":123,"file":"nope.png"}]}');
    put('extensions/guard-bad/extension.json', '{"id":["oops"],"name":"Bad","main":"main.js"}');
    put('extensions/guard-bad/main.js', 'export default function () {}\n');
    put('projects/guard-bad/project.json', '[1,2,3]');

    const packs = await fetch(`${BASE}/api/packs`).then((r) => r.json());
    t('a pack.json with an id of the wrong type does not empty the library',
      packs.ok === true && (packs.packs || []).length > 1,
      packs.ok ? (packs.packs || []).length + ' packs' : packs.error);

    const exts = await fetch(`${BASE}/api/extensions`).then((r) => r.json());
    t('an extension.json with an id of the wrong type does not empty the list',
      exts.ok === true && (exts.extensions || []).length > 1,
      exts.ok ? (exts.extensions || []).length + ' extensions' : exts.error);

    const projects = await fetch(`${BASE}/api/projects`).then((r) => r.json());
    t('a project.json of the wrong shape does not stop the map list',
      projects.ok === true, projects.ok ? (projects.projects || []).length + ' maps' : projects.error);
  } finally {
    for (const dir of made) rmSync(dir, { recursive: true, force: true });
  }
}

/* a file that cannot be read is not a file of the wrong shape --------------- */

{
  const root = fileURLToPath(new URL('..', import.meta.url));
  const dir = join(root, 'assets/packs/guard-unreadable');
  try {
    mkdirSync(dir, { recursive: true });
    // os.walk lists a broken symlink among its files, and png.dimensions then
    // opened it. The shape guards do not help: this raises OSError, not
    // TypeError, and it took /api/packs down -- which the editor reads during
    // boot, so one unreadable file in one folder stopped it coming up at all.
    symlinkSync(join(dir, 'nowhere-at-all.png'), join(dir, 'broken.png'));

    const packs = await fetch(`${BASE}/api/packs`).then((r) => r.json());
    t('an unreadable file in a pack does not take the library down',
      packs.ok === true && (packs.packs || []).length > 1,
      packs.ok ? (packs.packs || []).length + ' packs' : packs.error);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/* a map of the wrong shape is refused rather than handed to the editor ------ */

{
  const root = fileURLToPath(new URL('..', import.meta.url));
  const dir = join(root, 'projects/guard-shape');
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'project.json'), '{"name":"No Layers","width":800,"height":600}');
    const r = await fetch(`${BASE}/api/projects/guard-shape`);
    const body = await r.json();
    // projects.read handed this straight through, so openDocument reached
    // doc.layers.find outside any try and the editor came up half-started
    // with nothing said about why.
    t('a project.json with no layers is refused, not handed to the editor',
      r.status === 404 && body.ok !== true, r.status + ' ' + (body.error || ''));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/* a save must not report failure for a save that landed --------------------- */

{
  const mk = await fetch(`${BASE}/api/projects`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Guard Shapes' }),
  }).then((r) => r.json());
  const slug = mk.project && (mk.project.slug || mk.project.name);
  // "layers": null defeats api.py's .get("layers", []) default, and a layer
  // id that is not a string reached sweep_blobs' string concatenation. Both
  // raised *after* projects.write had already replaced project.json, so the
  // editor was told the save failed and left the document dirty for good.
  const put = (doc) => fetch(`${BASE}/api/projects/${encodeURIComponent(slug)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(doc),
  }).then((r) => r.status);

  const nul = await put({ name: 'Guard Shapes', layers: null });
  t('a save with a null layers list does not 500 after it has landed', nul === 200, nul);
  const numeric = await put({ name: 'Guard Shapes', layers: [{ id: 7, kind: 'raster' }, 5] });
  t('nor one holding a layer id that is not a string', numeric === 200, numeric);

  await fetch(`${BASE}/api/projects/${encodeURIComponent(slug)}`, { method: 'DELETE' });
}

/* a long map name keeps its name -------------------------------------------- */

{
  const long = 'The Exceedingly Long And Overwrought Name Of A Map That Somebody Really Did Type';
  const mk = await fetch(`${BASE}/api/projects`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: long }),
  }).then((r) => r.json());
  const slug = mk.project && mk.project.slug;
  // slugify capped the whole string at 64 and then tested the *untrimmed*
  // text, so every title longer than that failed the match and fell back:
  // one map saved to projects/untitled, the next to projects/untitled 2.
  t('a map named past 64 characters keeps its name in the folder',
    typeof slug === 'string' && slug.startsWith('The Exceedingly Long'), slug);
  if (slug) await fetch(`${BASE}/api/projects/${encodeURIComponent(slug)}`, { method: 'DELETE' });

  const bad = await fetch(`${BASE}/api/projects`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 12345 }),
  });
  // slugify is the front door for untrusted text and did (text or "").strip().
  t('and a name that is not a string is handled rather than 500ing', bad.status < 500, bad.status);
  const madeIt = await bad.json().catch(() => ({}));
  if (madeIt.project && madeIt.project.slug) {
    await fetch(`${BASE}/api/projects/${encodeURIComponent(madeIt.project.slug)}`, { method: 'DELETE' });
  }
}

/* a request target urlparse cannot read must still be answered -------------- */

{
  const text = await raw(`GET http://[abc HTTP/1.1${CRLF}Host: ${hostname}:${port}${CRLF}${CRLF}`);
  const codes = statuses(text);
  // urlparse raises ValueError on a malformed IPv6 literal, and it ran before
  // any of the body handling -- so the handler died without writing a byte and
  // printed a traceback for every one of them.
  t('a malformed request target is answered rather than dropped',
    codes.length === 1 && codes[0] === '400', codes.join(',') || 'no reply');
}

/* a body of the wrong shape must not leave anything behind ------------------ */

{
  const name = 'GuardStray';
  const r = await fetch(`${BASE}/api/projects/${name}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: 'null',
  });
  // projects.write made the folder and then reached doc["format"], which is
  // where a body that is not an object raised -- so the failing request still
  // created projects/<name>/layers/ on the way to its 500. Invisible in the
  // Projects tab, and enough to make unique_slug avoid that name for good.
  t('a document that is not an object is refused, not 500ed', r.status === 400, r.status);
  // A stray projects/<name>/layers/ is invisible in the Projects tab -- there
  // is no project.json in it -- so the way to see it is to ask for that name:
  // unique_slug walks away from a folder that is already there.
  const made = await fetch(`${BASE}/api/projects`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  }).then((x) => x.json());
  const slug = made.project && made.project.slug;
  t('and the name it was refused under is still free', slug === name, slug);
  if (slug) await fetch(`${BASE}/api/projects/${encodeURIComponent(slug)}`, { method: 'DELETE' });
  await fetch(`${BASE}/api/projects/${name}`, { method: 'DELETE' });
}

/* an argument that cannot be a key ------------------------------------------ */

{
  const r = await fetch(`${BASE}/api/open-folder`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ which: ['packs'] }),
  });
  // A list reached the dict lookup and raised "unhashable type" as a 500,
  // where the "unknown folder" 400 four lines below it is the answer.
  t('a folder name that is not a string is a 400, not a 500', r.status === 400, r.status);
}

/* a page that has rebound its own name to this machine ------------------------ */

{
  // DNS rebinding: attacker.example is re-pointed at 127.0.0.1, so its page is
  // same-origin with the server and a GET from it carries no Origin at all.
  // The one thing it cannot change is the Host header.
  const api = await raw(`GET /api/projects HTTP/1.1${CRLF}Host: attacker.example:${port}${CRLF}${CRLF}`);
  t('an API request addressed to another host name is refused',
    statuses(api).join(',') === '421' && !api.includes('"projects"'), statuses(api).join(',') || 'no reply');
  const stat = await raw(`GET /index.html HTTP/1.1${CRLF}Host: attacker.example:${port}${CRLF}${CRLF}`);
  t('and so is a static file, which a rebound page could read just the same',
    statuses(stat).join(',') === '421', statuses(stat).join(',') || 'no reply');
  const ok = await raw(`GET /api/state HTTP/1.1${CRLF}Host: localhost:${port}${CRLF}${CRLF}`);
  t('while localhost by name is still answered', statuses(ok)[0] === '200', statuses(ok).join(','));
}

/* a document nested past what json.dumps can reply with ----------------------- */

{
  const name = 'GuardDeep';
  let nested = '1';
  for (let i = 0; i < 900; i++) nested = '[' + nested + ']';
  const body = `{"name":"${name}","layers":[{"id":"l-a","kind":"raster","ops":[]}],"x":${nested}}`;
  const r = await fetch(`${BASE}/api/projects/${name}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body,
  });
  // It parsed, it was written, and then the reply -- which echoes it two
  // levels deeper -- ran out of stack: a 500 for a save that had landed, and a
  // project.json that then took GET /api/projects down with it.
  t('a document nested too deep is refused before it is written', r.status === 400, r.status);
  const list = await fetch(`${BASE}/api/projects`);
  const listed = list.status === 200 && !(await list.json()).projects.some((x) => x.slug === name);
  t('and the Projects list is unharmed', listed, list.status);
  await fetch(`${BASE}/api/projects/${name}`, { method: 'DELETE' });

  // A hand-edited file on disk that deep: RecursionError is not a ValueError.
  const root = fileURLToPath(new URL('..', import.meta.url));
  const dir = join(root, 'projects/guard-deep');
  try {
    mkdirSync(dir, { recursive: true });
    let deep = '1';
    for (let i = 0; i < 5000; i++) deep = '[' + deep + ']';
    writeFileSync(join(dir, 'project.json'), `{"name":"Deep","layers":${deep}}`);
    const l2 = await fetch(`${BASE}/api/projects`);
    t('one map file nested beyond the parser does not empty the Projects tab', l2.status === 200, l2.status);
    const one = await fetch(`${BASE}/api/projects/guard-deep`);
    t('and opening it is a 404 like any other unreadable map, not a 500', one.status === 404, one.status);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/* a thumbnail for a map that is not there ---------------------------------------- */

{
  const name = 'GuardGhost';
  const r = await fetch(`${BASE}/api/projects/${name}/thumb`, {
    method: 'PUT', headers: { 'Content-Type': 'image/png' },
    body: Buffer.from('\x89PNG\r\n\x1a\n' + 'x'.repeat(40), 'latin1'),
  });
  t('a thumbnail for a map that does not exist is refused', r.status === 404, r.status);
  // A folder holding only thumb.png is invisible in the Projects tab; the way
  // to see it is to ask for that name and watch unique_slug walk away from it.
  const made = await fetch(`${BASE}/api/projects`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, layers: [{ id: 'l-a', kind: 'raster', ops: [] }] }),
  }).then((x) => x.json());
  const slug = made.project && made.project.slug;
  t('and leaves no folder behind to take the name', slug === name, slug);
  if (slug) await fetch(`${BASE}/api/projects/${encodeURIComponent(slug)}`, { method: 'DELETE' });
  await fetch(`${BASE}/api/projects/${name}`, { method: 'DELETE' });
}

for (const [status, name, note] of out) {
  console.log(status.padEnd(5), name, note ? ' [' + note + ']' : '');
}
console.log(`\n${out.length - fails}/${out.length} passed`);
process.exit(fails ? 1 : 0);
