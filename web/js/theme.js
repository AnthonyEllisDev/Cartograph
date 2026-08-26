/* Look and layout.
 *
 * Everything visual in the chrome comes from the CSS custom properties defined
 * on :root, so a theme is just a table of overrides and applying one is a
 * handful of setProperty calls. No stylesheet swapping, no flash, and an
 * extension or a hand-edit can add a theme by adding a row.
 */

export const THEMES = {
  graphite: {
    label: 'Graphite',
    vars: {
      '--bg': '#101216', '--panel': '#191c22', '--panel-2': '#21252d', '--panel-3': '#2a2f39',
      '--line': '#2c313b', '--line-hi': '#3d4450',
      '--text': '#e7eaf0', '--dim': '#98a1b0', '--faint': '#6c7686',
    },
  },
  slate: {
    label: 'Slate blue',
    vars: {
      '--bg': '#0d1219', '--panel': '#141c26', '--panel-2': '#1c2733', '--panel-3': '#243241',
      '--line': '#25333f', '--line-hi': '#36495a',
      '--text': '#e3ecf4', '--dim': '#90a4b6', '--faint': '#66798a',
    },
  },
  ink: {
    label: 'Ink',
    vars: {
      '--bg': '#0a0a0b', '--panel': '#141415', '--panel-2': '#1c1c1e', '--panel-3': '#262628',
      '--line': '#282829', '--line-hi': '#3a3a3d',
      '--text': '#ececed', '--dim': '#9a9a9d', '--faint': '#6d6d70',
    },
  },
  vellum: {
    label: 'Vellum',
    vars: {
      '--bg': '#221d16', '--panel': '#2c261d', '--panel-2': '#372f24', '--panel-3': '#43392c',
      '--line': '#453b2d', '--line-hi': '#5b4e3c',
      '--text': '#f1e8d8', '--dim': '#b6a88a', '--faint': '#8c7f6b',
    },
  },
  daylight: {
    label: 'Daylight',
    vars: {
      '--bg': '#e9ebef', '--panel': '#f6f7f9', '--panel-2': '#eceef2', '--panel-3': '#e0e3e9',
      '--line': '#d3d7de', '--line-hi': '#bcc2cc',
      '--text': '#1b1f26', '--dim': '#5a6270', '--faint': '#858d9a',
    },
  },
};

export const ACCENTS = [
  ['#d9a441', 'Brass'], ['#e0803c', 'Copper'], ['#5ea9e6', 'Sky'],
  ['#57b98a', 'Verdigris'], ['#c1666b', 'Rust'], ['#a98cd8', 'Iris'],
];

export const BACKDROPS = {
  checker: { label: 'Checkerboard',
    css: 'repeating-conic-gradient(var(--panel) 0% 25%, var(--bg) 0% 50%) 0 0 / 22px 22px' },
  dark: { label: 'Flat dark', css: '#0b0d10' },
  neutral: { label: 'Neutral grey', css: '#3a3d43' },
  light: { label: 'Light', css: '#c9ccd2' },
};

export const DEFAULTS = {
  theme: 'graphite',
  accent: '#d9a441',
  uiScale: 100,
  railSide: 'left',
  railWidth: 312,
  inspectorWidth: 264,
  backdrop: 'checker',
  compactTools: false,
  showHud: true,
  cornerRadius: 6,
};

/** Read a themeable setting, filling in the default. */
export function look(settings, key) {
  const bag = settings.look || (settings.look = {});
  if (bag[key] === undefined) bag[key] = DEFAULTS[key];
  return bag[key];
}

export function applyLook(settings) {
  const root = document.documentElement;
  const theme = THEMES[look(settings, 'theme')] || THEMES.graphite;
  for (const [name, value] of Object.entries(theme.vars)) root.style.setProperty(name, value);

  const accent = look(settings, 'accent');
  root.style.setProperty('--accent', accent);
  // A light accent needs dark text on it and vice versa, or the Save button
  // becomes unreadable the moment someone picks pale blue.
  root.style.setProperty('--accent-ink', luminance(accent) > 0.55 ? '#1a1408' : '#fff8e8');

  // Selected tools and layers sit on a wash of the accent over the panel. It has
  // to be mixed rather than hard-coded, or a light theme gets a dark bar with
  // invisible text on it the moment the accent changes.
  root.style.setProperty('--accent-wash', mix(accent, theme.vars['--panel-2'], 0.16));
  root.style.setProperty('--accent-wash-2', mix(accent, theme.vars['--panel-3'], 0.26));

  root.style.setProperty('--rail-w', look(settings, 'railWidth') + 'px');
  root.style.setProperty('--rail-r-w', look(settings, 'inspectorWidth') + 'px');
  root.style.setProperty('--r', look(settings, 'cornerRadius') + 'px');
  root.style.fontSize = (look(settings, 'uiScale') / 100 * 13).toFixed(2) + 'px';

  const backdrop = BACKDROPS[look(settings, 'backdrop')] || BACKDROPS.checker;
  root.style.setProperty('--stage-bg', backdrop.css);

  document.body.classList.toggle('rails-swapped', look(settings, 'railSide') === 'right');
  document.body.classList.toggle('tools-compact', !!look(settings, 'compactTools'));
  document.body.classList.toggle('hud-hidden', !look(settings, 'showHud'));
  // Derived, not hard-coded to one theme id, so a theme added by hand or by an
  // extension gets the light-mode treatment for free.
  document.body.classList.toggle('is-light', luminance(theme.vars['--bg']) > 0.5);
}

function rgb(hex) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex || '');
  return m ? [1, 2, 3].map((i) => parseInt(m[i], 16)) : [128, 128, 128];
}

/** Blend `a` into `b` by `t`, returning a hex string. */
function mix(a, b, t) {
  const [x, y] = [rgb(a), rgb(b)];
  return '#' + x.map((v, i) => Math.round(y[i] + (v - y[i]) * t)
    .toString(16).padStart(2, '0')).join('');
}

function luminance(hex) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex || '');
  if (!m) return 0.5;
  const [r, g, b] = [1, 2, 3].map((i) => parseInt(m[i], 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
