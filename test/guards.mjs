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
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
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

for (const [status, name, note] of out) {
  console.log(status.padEnd(5), name, note ? ' [' + note + ']' : '');
}
console.log(`\n${out.length - fails}/${out.length} passed`);
process.exit(fails ? 1 : 0);
