/* Small shared helpers. Nothing here knows anything about maps. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const uid = (p = 'id') => p + '-' + Math.random().toString(36).slice(2, 9);
export const round = (v, n = 2) => Math.round(v * 10 ** n) / 10 ** n;

export function debounce(fn, ms) {
  let t = 0;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function throttleFrame(fn) {
  let queued = false, last = null;
  return (...args) => {
    last = args;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; fn(...last); });
  };
}

/** A deterministic little generator, so a scatter brush can be replayed. */
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function bytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(0) + ' kB';
  return (n / 1048576).toFixed(1) + ' MB';
}

export function ago(seconds) {
  const d = Date.now() / 1000 - seconds;
  if (d < 60) return 'just now';
  if (d < 3600) return Math.round(d / 60) + ' min ago';
  if (d < 86400) return Math.round(d / 3600) + ' h ago';
  return Math.round(d / 86400) + ' d ago';
}

/* ------------------------------------------------------------------ toasts */

let toastRoot = null;
export function toast(message, kind = '') {
  toastRoot = toastRoot || document.getElementById('toasts');
  const node = el('div', { class: 'toast ' + kind, text: message });
  toastRoot.appendChild(node);
  setTimeout(() => {
    node.style.transition = 'opacity .25s';
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 260);
  }, 2600);
}

/* ------------------------------------------------------------------- modal */

export function modal({ title, body, buttons = [{ label: 'Close' }] }) {
  const root = document.getElementById('modal-root');
  const box = el('div', { class: 'modal' });
  box.appendChild(el('h3', { text: title }));
  const bodyEl = el('div', { class: 'body' });
  bodyEl.appendChild(typeof body === 'string' ? el('p', { text: body }) : body);
  box.appendChild(bodyEl);
  const foot = el('div', { class: 'foot' });
  let resolveWith;
  const done = new Promise((res) => { resolveWith = res; });
  const close = (value) => { root.hidden = true; root.innerHTML = ''; resolveWith(value); };
  for (const b of buttons) {
    foot.appendChild(el('button', {
      class: 'btn ' + (b.class || ''), text: b.label,
      onclick: () => { if (b.onClick && b.onClick(bodyEl) === false) return; close(b.value); },
    }));
  }
  box.appendChild(foot);
  root.innerHTML = '';
  root.appendChild(box);
  root.hidden = false;
  root.onclick = (e) => { if (e.target === root) close(undefined); };
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { document.removeEventListener('keydown', esc); close(undefined); }
  });
  const first = bodyEl.querySelector('input, select, textarea');
  if (first) setTimeout(() => first.focus(), 30);
  return done;
}

/* ------------------------------------------------------------------ canvas */

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
