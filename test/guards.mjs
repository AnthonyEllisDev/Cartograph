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
import { existsSync, mkdirSync, readdirSync, renameSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
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
  // Past 4,300 digits int() itself raises (Python's guard against quadratic
  // parsing), and that escaped the length check and killed the handler with
  // not a byte written back.
  const text = await raw(
    `POST /api/state HTTP/1.1${CRLF}Host: ${hostname}:${port}${CRLF}` +
    `Content-Length: ${'9'.repeat(5000)}${CRLF}${CRLF}`);
  t('a Content-Length thousands of digits long is answered, not died on',
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

{
  // int() reads "1_0" as ten. A proxy in front that reads it as garbage and
  // passes the two bytes on would leave this side waiting, or desynchronised.
  const codes = statuses(await raw(
    `POST /api/projects HTTP/1.1${CRLF}Host: ${hostname}:${port}${CRLF}` +
    `Content-Length: 1_0${CRLF}${CRLF}{}`, 1200));
  t('a Content-Length that only Python calls a number is refused',
    codes[0] === '400' && codes.length === 1, codes.join(' then ') || 'the thread is still waiting');
}

{
  const codes = statuses(await raw(
    `OPTIONS /api/state HTTP/1.1${CRLF}Host: evil.example${CRLF}${CRLF}`));
  t('an OPTIONS for a host we are not is refused like any other request',
    codes[0] === '421', codes.join(' then '));
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

/* 2026-09-26: other people's files, and numbers a browser cannot read ------- */

{
  // An art pack is somebody else's work. A script in one of its SVGs, opened
  // as a page, ran as the editor itself and could drive the whole API.
  const r = await fetch(`${BASE}/assets/packs/starter/stamps/bridge.svg`);
  const csp = r.headers.get('content-security-policy') || '';
  t('a pack file is served sandboxed, so a script inside it cannot run as the editor',
    r.status === 200 && /\bsandbox\b/.test(csp), r.status + ' ' + (csp || 'no CSP'));
  t('and is not sniffed into something it does not say it is',
    r.headers.get('x-content-type-options') === 'nosniff', r.headers.get('x-content-type-options'));
  const js = await fetch(`${BASE}/js/app.js`);
  t('while the editor\'s own files are left alone', !js.headers.get('content-security-policy'),
    js.headers.get('content-security-policy') || 'no CSP');
}

{
  const root = fileURLToPath(new URL('..', import.meta.url));
  const dir = join(root, 'assets', 'packs', 'guard-nan');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'pack.json'), '{"name": "Guard NaN", "scale": NaN, "assets": []}');
  try {
    const text = await (await fetch(`${BASE}/api/packs`)).text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch (_) { /* the failure being tested */ }
    t('a NaN in one pack.json leaves /api/packs readable by a browser', !!parsed,
      parsed ? 'parsed' : 'JSON.parse refused it, and the editor would not start');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const r = await fetch(`${BASE}/api/projects/GuardHuge`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: '{"format":1,"name":"GuardHuge","width":1e999,"height":512,' +
          '"layers":[{"id":"l-a","kind":"raster","ops":[]}]}',
  });
  t('a map with a number too large for JSON is refused rather than saved', r.status === 400, r.status);
  await fetch(`${BASE}/api/projects/GuardHuge`, { method: 'DELETE' });
}

{
  // Listed means openable: the editor reopens the newest map on launch.
  const made = await fetch(`${BASE}/api/projects`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'GuardNoLayers', width: 800, height: 600 }),
  }).then((x) => x.json());
  const list = await fetch(`${BASE}/api/projects`).then((x) => x.json());
  const slug = made.project && made.project.slug;
  t('a map with no layers is not listed as one that can be opened',
    slug && !list.projects.some((q) => q.slug === slug), slug);
  if (slug) await fetch(`${BASE}/api/projects/${encodeURIComponent(slug)}`, { method: 'DELETE' });
}

{
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
                          '1f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4d30000000049454e44ae426082', 'hex');
  const r = await fetch(`${BASE}/api/packs/import?name=${encodeURIComponent('guard tree (1).png')}&kind=stamp&pack=user`,
    { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: png });
  const body = await r.json().catch(() => ({}));
  t('importing "tree (1).png", as a browser names a second download, works', r.status === 200,
    r.status + ' ' + (body.error || (body.asset && body.asset.file)));
  if (body.asset) {
    rmSync(join(fileURLToPath(new URL('..', import.meta.url)), 'assets', 'packs', 'user', body.asset.file),
           { force: true });
  }
}

{
  const long = '\u{1D400}'.repeat(64);
  const r = await fetch(`${BASE}/api/export?name=${encodeURIComponent(long + '.png')}`,
    { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: Buffer.from('x') });
  const body = await r.json().catch(() => ({}));
  t('an export name of 64 four-byte letters is written, not a 500', r.status === 200,
    r.status + ' ' + (body.error || ''));
  if (body.path) rmSync(body.path, { force: true });
  const md = await fetch(`${BASE}/api/export?name=GuardKey.md`,
    { method: 'PUT', headers: { 'Content-Type': 'text/markdown' }, body: Buffer.from('# key') });
  const mdBody = await md.json().catch(() => ({}));
  t('a map key can be exported as Markdown', md.status === 200 && /GuardKey(-\d+)?\.md$/.test(mdBody.path || ''),
    mdBody.path || md.status);
  if (mdBody.path) rmSync(mdBody.path, { force: true });
}

/* 2026-09-27 ---------------------------------------------------------------- */

{
  // parse_float saw decimals only. A whole number past the largest double went
  // straight through, came back to the browser as Infinity, and the map
  // opened blank at "Infinity x 1536".
  const r = await fetch(`${BASE}/api/projects/GuardHugeInt`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: '{"format":1,"name":"GuardHugeInt","width":1' + '0'.repeat(400) + ',"height":512,' +
          '"layers":[{"id":"l-a","kind":"raster","ops":[]}]}',
  });
  t('a whole number too large for a double is refused rather than saved', r.status === 400, r.status);
  await fetch(`${BASE}/api/projects/GuardHugeInt`, { method: 'DELETE' });
}

{
  // Notepad and PowerShell write UTF-8 with a byte-order mark, and a pack.json
  // saved that way was reported broken.
  const root = fileURLToPath(new URL('..', import.meta.url));
  const dir = join(root, 'assets', 'packs', 'guard-bom');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'pack.json'), '\ufeff{"name": "Guard BOM", "assets": []}');
  try {
    const { packs } = await (await fetch(`${BASE}/api/packs`)).json();
    const pack = packs.find((x) => x.id === 'guard-bom' || x.dir === 'guard-bom');
    t('a pack.json with a byte-order mark is read', !!pack && !pack.error && pack.name === 'Guard BOM',
      pack ? (pack.error || pack.name) : 'not listed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  // POST parsed its body through _body and then called doc.get on whatever
  // came back, so any JSON that was not an object was a 500 -- as was
  // write()'s own refusal of a document nested too deeply, which PUT answers
  // with a 400.
  const codes = [];
  for (const body of ['[]', 'null', '5', '"x"']) {
    const r = await fetch(`${BASE}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    codes.push(r.status);
  }
  t('creating a map from a body that is not an object is a 400', codes.every((c) => c === 400), codes.join(' '));
  let deep = '{"format":1,"name":"GuardDeepPost","width":64,"height":64,"layers":[{"id":"l-a","kind":"raster","ops":[' +
    '['.repeat(70) + ']'.repeat(70) + ']}]}';
  const r = await fetch(`${BASE}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: deep });
  t('and one nested too deeply is a 400 too', r.status === 400, r.status);
}

/* 2026-10-01 ---------------------------------------------------------------- */

{
  // The list took a prefab's extension in any case and the delete looked for
  // ".json" only, so "Hall.JSON" dropped in by hand was listed and could not
  // be deleted. And a folder named like a prefab was a 500 on delete.
  const jr = async (method, path, body) => {
    const res = await fetch(BASE + path, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const root = fileURLToPath(new URL('..', import.meta.url));
  const dir = join(root, 'prefabs');
  const made = await jr('POST', '/api/prefabs', { name: 'GuardUpper', cell: 70, mapKind: 'battle',
    kinds: ['walls'], entries: [{ id: 'w-g', kind: 'wall', points: [{ x: 0, y: 0 }, { x: 70, y: 0 }] }] });
  const slugMade = made.body && made.body.prefab && made.body.prefab.slug;
  const lower = join(dir, slugMade + '.json'), upper = join(dir, slugMade + '.JSON');
  const box = join(dir, 'GuardBox.json');
  try {
    t('precondition: a prefab is saved', made.status === 200 && existsSync(lower), made.status);
    renameSync(lower, upper);
    const listed = (await jr('GET', '/api/prefabs')).body.prefabs.some((x) => x.slug === slugMade);
    const del = await jr('DELETE', '/api/prefabs/' + encodeURIComponent(slugMade));
    t('a prefab saved as .JSON by hand is listed and can be deleted',
      listed && del.status === 200 && !existsSync(upper), listed + ' ' + del.status);
    mkdirSync(box, { recursive: true });
    const dirDel = await jr('DELETE', '/api/prefabs/GuardBox');
    t('deleting a folder named like a prefab is refused, not a 500', dirDel.status === 404, dirDel.status);
  } finally {
    rmSync(upper, { force: true });
    rmSync(lower, { force: true });
    rmSync(box, { recursive: true, force: true });
  }
}

/* links inside the folders the server writes to ---------------------------- */

{
  const root = fileURLToPath(new URL('..', import.meta.url));
  const pack = join(root, 'assets/packs/guard-link-pack');
  const outside = join(root, 'exports', 'guard-link-target.png');
  const real = join(root, 'projects', 'guard-link-real');
  const link = join(root, 'projects', 'guard-link-alias');
  try {
    // exists() is False for a dangling link and open() then follows it, so an
    // import into a pack someone else made could write anywhere the link said.
    mkdirSync(join(pack, 'stamps'), { recursive: true });
    rmSync(outside, { force: true });
    symlinkSync(outside, join(pack, 'stamps', 'guardlink.png'));
    const res = await fetch(`${BASE}/api/packs/import?name=guardlink.png&pack=guard-link-pack&kind=stamp`,
      { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: new Uint8Array([137, 80, 78, 71]) });
    const reply = await res.json().catch(() => ({}));
    t('an import does not write through a dangling link out of its pack', !existsSync(outside),
      existsSync(outside) ? 'wrote ' + outside : (reply.asset && reply.asset.file) || res.status);

    // under() resolves links, so deleting a linked map folder emptied the map
    // it pointed at, which is a different map.
    mkdirSync(real, { recursive: true });
    writeFileSync(join(real, 'project.json'), JSON.stringify({ name: 'Real', width: 100, height: 100, layers: [] }));
    symlinkSync(real, link);
    const del = await fetch(`${BASE}/api/projects/guard-link-alias`, { method: 'DELETE' });
    t('deleting a linked map folder takes the link away, not the map it points at',
      existsSync(join(real, 'project.json')), del.status);
    let linkGone = true;
    try { readdirSync(link); linkGone = false; } catch (err) { linkGone = err.code === 'ENOENT'; }
    t('and the link itself is gone', linkGone && del.status === 200, del.status);
  } finally {
    rmSync(pack, { recursive: true, force: true });
    rmSync(outside, { force: true });
    rmSync(link, { force: true });
    rmSync(real, { recursive: true, force: true });
  }
}

for (const [status, name, note] of out) {
  console.log(status.padEnd(5), name, note ? ' [' + note + ']' : '');
}
console.log(`\n${out.length - fails}/${out.length} passed`);
process.exit(fails ? 1 : 0);
