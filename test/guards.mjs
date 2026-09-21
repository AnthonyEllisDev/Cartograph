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

for (const [status, name, note] of out) {
  console.log(status.padEnd(5), name, note ? ' [' + note + ']' : '');
}
console.log(`\n${out.length - fails}/${out.length} passed`);
process.exit(fails ? 1 : 0);
