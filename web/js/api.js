/* Every call this program makes goes to its own server on localhost.
   There is no other origin in the codebase, by design. */

async function jsonFetch(url, options = {}) {
  const res = await fetch(url, options);
  let payload = null;
  try { payload = await res.json(); } catch (_) { /* non-JSON error body */ }
  if (!res.ok || (payload && payload.ok === false)) {
    throw new Error((payload && payload.error) || `${res.status} ${res.statusText}`);
  }
  return payload;
}

const put = (url, blob, type) => jsonFetch(url, {
  method: 'PUT',
  headers: { 'Content-Type': type || blob.type || 'application/octet-stream' },
  body: blob,
});

export const api = {
  state: () => jsonFetch('/api/state'),
  packs: () => jsonFetch('/api/packs'),

  importAsset: (file, { kind = 'stamp', group = 'imported', pack = 'user' } = {}) =>
    put(`/api/packs/import?name=${encodeURIComponent(file.name)}&kind=${kind}` +
        `&group=${encodeURIComponent(group)}&pack=${encodeURIComponent(pack)}`, file),

  extensions: () => jsonFetch('/api/extensions'),
  setExtensionEnabled: (id, enabled) => jsonFetch(`/api/extensions/${encodeURIComponent(id)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }),
  }),
  openFolder: (which) => jsonFetch('/api/open-folder', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ which }),
  }),

  projects: () => jsonFetch('/api/projects'),
  createProject: (doc) => jsonFetch('/api/projects', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc),
  }),
  readProject: (slug) => jsonFetch(`/api/projects/${encodeURIComponent(slug)}`),
  writeProject: (slug, doc) => jsonFetch(`/api/projects/${encodeURIComponent(slug)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc),
  }),
  deleteProject: (slug) => jsonFetch(`/api/projects/${encodeURIComponent(slug)}`, { method: 'DELETE' }),
  writeLayer: (slug, layerId, blob) =>
    put(`/api/projects/${encodeURIComponent(slug)}/layer/${encodeURIComponent(layerId)}`, blob, 'image/png'),
  writeThumb: (slug, blob) =>
    put(`/api/projects/${encodeURIComponent(slug)}/thumb`, blob, 'image/png'),

  prefabs: () => jsonFetch('/api/prefabs'),
  savePrefab: (prefab) => jsonFetch('/api/prefabs', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(prefab),
  }),
  deletePrefab: (slug) => jsonFetch(`/api/prefabs/${encodeURIComponent(slug)}`, { method: 'DELETE' }),

  backups: () => jsonFetch('/api/backups'),
  saveBackup: (doc, reason) => jsonFetch('/api/backups', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ doc, reason }),
  }),
  readBackup: (id) => jsonFetch(`/api/backups/${encodeURIComponent(id)}`),
  deleteBackup: (id) => jsonFetch(`/api/backups/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  exportImage: (name, blob) => put(`/api/export?name=${encodeURIComponent(name)}`, blob, blob.type),
};
