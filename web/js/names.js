/* Names for the things on a map.
 *
 * A map is mostly names, and the name is the part that stalls a session: the
 * coast is drawn, the rivers run, and the label dialog sits empty while
 * somebody tries to think of a fifth river. Azgaar's generator names
 * everything it makes from bases trained on real-language word lists; Inkarnate
 * and Wonderdraft leave it to a website in another tab, which is no use to a
 * program that promises to work with the network cable out.
 *
 * So the names are made here, from word parts written by hand for this file
 * (and therefore MIT like the rest of it), never from a list of real places
 * whose provenance would have to be taken on trust. Each style is a small
 * phonology -- a feel, not a real language -- and each kind of feature is a
 * handful of patterns a cartographer would use ("Isle of X", "the X Wood").
 *
 * Pure apart from the chooser at the bottom: the same seed, style and kind
 * always give the same names, which is what the tests lean on and what makes
 * "More" a step through a sequence rather than a fresh roll each time.
 */

import { app, setToolSetting, toolSetting } from './app.js';
import { closeModal, el, hashString, modal, rng } from './util.js';


/* ------------------------------------------------------------------ styles */

/* `starts` + `ends` makes a place name and `starts` + `links` a bare stem for
 * the patterns ("the Grimar"); `realms` closes a stem into a country. Every
 * part is short on purpose: the long, apostrophe-laden fantasy name is hard
 * to letter on a map and harder to say at the table. */
const COMMON = {
  label: 'Common',
  starts: ['Ash', 'Black', 'Bram', 'Brock', 'Bright', 'Cold', 'Crow', 'Dun', 'East', 'Elm',
           'Fair', 'Fern', 'Fox', 'Glen', 'Gold', 'Green', 'Grey', 'Hart', 'Hazel', 'High',
           'Holly', 'Kings', 'Lark', 'Long', 'Mar', 'Mill', 'Moss', 'Nor', 'Oak', 'Old',
           'Pen', 'Red', 'Rook', 'Rush', 'Salt', 'Silver', 'Stan', 'Stone', 'Thorn', 'Wal',
           'West', 'White', 'Wil', 'Win', 'Wolf', 'Wren', 'Yar', 'Bar', 'Cran', 'Hen'],
  ends: ['ford', 'by', 'wick', 'ton', 'ham', 'stead', 'bury', 'field', 'well', 'bridge',
         'combe', 'ley', 'worth', 'thorpe', 'minster', 'port', 'moor', 'hollow', 'gate',
         'mouth', 'ing', 'den', 'cote', 'holm'],
  links: ['', '', '', 'ley', 'mere', 'wyn', 'den', 'ham', 'ton', 'wick'],
  realms: ['shire', 'land', 'mark', 'dale', 'march', 'wold', 'moor', 'downs', 'fen', 'mere'],
  // English place names wear their own words for water and high ground.
  extra: {
    settlement: ['Port {W}', '{P} Cross', 'Upper {P}', '{W} Green'],
    river: ['the {W} Water', '{W} Brook', 'the {W}burn'],
    mountains: ['the {W} Fells', '{W} Tor', 'the {W} Edge'],
    forest: ['{W} Chase', '{W} Holt'],
    sea: ['{W} Mere', '{W} Sound'],
  },
};

const NORTHERN = {
  label: 'Northern',
  starts: ['Ar', 'Ask', 'Bjor', 'Brann', 'Dag', 'Ei', 'Frey', 'Grim', 'Gunn', 'Hal', 'Hjal',
           'Hrafn', 'Ing', 'Jor', 'Kol', 'Lund', 'Mor', 'Ny', 'Odd', 'Ran', 'Sig', 'Skar',
           'Sol', 'Stor', 'Svar', 'Thor', 'Tor', 'Ulf', 'Vald', 'Var', 'Vig', 'Yr', 'Hed', 'Kar'],
  ends: ['vik', 'gard', 'heim', 'fjord', 'stad', 'by', 'holm', 'dal', 'ness', 'berg',
         'sund', 'lund', 'havn', 'vang', 'nes', 'stein', 'tun', 'hus'],
  links: ['', 'a', 'e', 'ar', 'en', 'ung', 'ir', 'sted'],
  realms: ['mark', 'land', 'heim', 'gard', 'rike', 'vald'],
  extra: {
    river: ['the {W}elv', '{W} Flow'],
    mountains: ['the {W} Fells', 'the {W} Spines', '{W}fjell'],
    sea: ['{W}fjord', 'the {W} Deep'],
    island: ['{W}oy', '{W}holm'],
  },
};

const FAIR = {
  label: 'Fair',
  starts: ['Ae', 'Al', 'Ama', 'Ar', 'Bel', 'Cae', 'Cel', 'Ela', 'El', 'Eri', 'Fae', 'Gal',
           'Ith', 'Lae', 'Lin', 'Lor', 'Mel', 'Mir', 'Nim', 'Ol', 'Qua', 'Rin', 'Sil', 'Tal',
           'Thal', 'Ul', 'Val', 'Yl', 'Ere', 'Sae'],
  ends: ['ndor', 'ril', 'las', 'thien', 'wen', 'mar', 'nor', 'lin', 'rion', 'dell', 'loth',
         'nis', 'riel', 'sse', 'thas', 'vain', 'ryn', 'ndel', 'lond', 'mir'],
  links: ['a', 'e', 'ia', 'ie', 'il', 'ae', 'en', 'or'],
  realms: ['ndor', 'lond', 'thalas', 'wyn', 'ria', 'loth', 'dell'],
  extra: {
    river: ['{W}duin', 'the Silver {W}'],
    forest: ['{W}loth', 'the Hidden {W}'],
    sea: ['the {W} Shallows'],
  },
};

const DEEP = {
  label: 'Deep',
  starts: ['Bar', 'Bor', 'Dum', 'Dur', 'Dwa', 'Gim', 'Gor', 'Grun', 'Kaz', 'Kel', 'Khar',
           'Kor', 'Mor', 'Nar', 'Nor', 'Rag', 'Thak', 'Thor', 'Ul', 'Zar', 'Zir', 'Bal', 'Az',
           'Dol', 'Brun', 'Kram'],
  ends: ['dum', 'dur', 'gar', 'grim', 'kal', 'khad', 'zad', 'zum', 'rak', 'dak', 'bur',
         'mund', 'thar', 'goth', 'gol', 'rok', 'hold', 'drin', 'gund'],
  links: ['', 'a', 'i', 'u', 'in', 'ak', 'um'],
  realms: ['khar', 'goth', 'hold', 'dum', 'gund'],
  extra: {
    mountains: ['the {W} Anvils', '{W} Deeps', 'the Halls of {W}'],
    river: ['the {W} Cut'],
  },
};

const SOUTHERN = {
  label: 'Southern',
  starts: ['Akh', 'Am', 'Ash', 'Bek', 'Dah', 'Esh', 'Ham', 'Ir', 'Jas', 'Kam', 'Kes', 'Mer',
           'Nab', 'Nef', 'Qad', 'Ram', 'Sab', 'Sek', 'Shar', 'Tah', 'Tem', 'Ush', 'Zah', 'Zer',
           'Hes', 'Ord'],
  ends: ['ar', 'an', 'ir', 'esh', 'et', 'un', 'ra', 'ah', 'ab', 'ut', 'amet', 'iris', 'ara',
         'ekh', 'ennu', 'ash', 'ena', 'oth'],
  links: ['a', 'e', 'i', 'u', 'ar', 'en'],
  realms: ['ara', 'esh', 'emet', 'ira', 'unna'],
  extra: {
    river: ['the {W} Wadi'],
    mountains: ['the {W} Scarps'],
    forest: ['the {W} Palms', 'the Gardens of {W}'],
    sea: ['the {W} Sands'],
  },
};

const IMPERIAL = {
  label: 'Imperial',
  starts: ['Aur', 'Cal', 'Cas', 'Cor', 'Fal', 'Hal', 'Jul', 'Lav', 'Luc', 'Mar', 'Nov', 'Oct',
           'Pal', 'Quin', 'Rav', 'Sal', 'Sev', 'Tar', 'Tib', 'Val', 'Vel', 'Ver', 'Vic', 'Vin',
           'Ost', 'Ser'],
  ends: ['ia', 'um', 'is', 'ona', 'ium', 'ica', 'ara', 'enna', 'anum', 'ae', 'etia', 'os',
         'inum', 'entum', 'ula'],
  links: ['a', 'e', 'i', 'o', 'er', 'en', 'us'],
  realms: ['ia', 'ica', 'ania', 'um', 'ensis'],
  extra: {
    mountains: ['Mons {W}', 'the {W} Alps'],
    sea: ['Mare {W}'],
    forest: ['the {W} Groves'],
  },
};

export const NAME_STYLES = {
  common: COMMON, northern: NORTHERN, fair: FAIR, deep: DEEP, southern: SOUTHERN,
  imperial: IMPERIAL,
  // Each name from a style of its own: a map of many peoples.
  mixed: { label: 'Mixed', mixed: true },
};


/* ------------------------------------------------------------------- kinds */

/* {W} is a stem, {P} a whole place name, {R} a realm. A pattern may appear
 * twice in a list to make it the more common phrasing. */
export const NAME_KINDS = {
  settlement: { label: 'Settlement', patterns: ['{P}', '{P}', '{P}', '{P}', '{P}', '{P}'] },
  region:     { label: 'Region or country', patterns: ['{R}', '{R}', '{R}', 'the {W} March',
                                                       'the {W} Reach', 'Kingdom of {R}', 'the {W} Marches'] },
  river:      { label: 'River', patterns: ['the {W}', 'the {W}', '{W} River', 'River {W}'] },
  mountains:  { label: 'Mountains', patterns: ['the {W} Mountains', '{W} Peaks', 'Mount {W}',
                                               'the {W} Range', 'the {W} Hills'] },
  forest:     { label: 'Forest', patterns: ['{W} Wood', '{W} Forest', '{W}wood', 'the Forest of {W}'] },
  sea:        { label: 'Sea, lake or bay', patterns: ['the {W} Sea', 'Sea of {W}', '{W} Bay',
                                                     'Lake {W}', 'the Gulf of {W}'] },
  island:     { label: 'Island', patterns: ['{W} Isle', 'Isle of {W}', 'the {W} Isles', '{W} Island'] },
};

/** The kind a label is probably naming, from the style it is lettered in. A
 *  map title is nearly always the name of a land. */
export function kindForLabelStyle(style) {
  return { title: 'region', region: 'region', settlement: 'settlement', water: 'sea' }[style] || 'settlement';
}


/* ------------------------------------------------------------------ makers */

const VOWELS = 'aeiouy';

/* Written as fragments rather than words: a stem that contains one of these
 * is dropped, and the generator moves on to the next. Cheaper than finding
 * out at the table. */
const BLOCK = ['nig', 'fag', 'cunt', 'shit', 'rape', 'fuck', 'slut', 'twat', 'cock', 'dick',
               'piss', 'arse', 'anus', 'cum', 'tit', 'kkk', 'nazi', 'jew', 'gay', 'homo', 'wank',
               'poo', 'turd', 'butt', 'sex'];

/** Glue two parts so the seam reads: no three vowels in a row, no letter
 *  three times over, and a doubled vowel where one part ends with the letter
 *  the next begins with is cut to one ("Aelia", not "Aeeia"). */
export function join(a, b) {
  if (!b) return a;
  if (!a) return b;
  const isV = (c) => VOWELS.includes(c.toLowerCase());
  // A part already ending on two vowels takes no third from the next.
  if (a.length > 1 && isV(a[a.length - 1]) && isV(a[a.length - 2]) && isV(b[0])) b = b.slice(1);
  if (b && a[a.length - 1].toLowerCase() === b[0].toLowerCase() && isV(b[0])) b = b.slice(1);
  if (!b) return a;
  // An ending that opens on two vowels keeps them both and the stem gives up
  // its own: "Gunna" and "oy" make "Gunnoy", not "Gunnao".
  if (b.length > 1 && isV(b[0]) && isV(b[1]) && isV(a[a.length - 1]) && a.length > 2) a = a.slice(0, -1);
  let out = a + b;
  // Three vowels running: drop the last. Dropping the middle one made a
  // double of the other two ("Laea" became "Laa").
  out = out.replace(/([aeiouy])([aeiouy])[aeiouy]/gi, '$1$2');
  // A doubled a, i or u reads as a typing slip; ee and oo are English.
  out = out.replace(/([aiu])\1/gi, '$1');
  out = out.replace(/(.)\1\1+/gi, '$1$1');
  return out;
}

const pick = (rand, list) => list[Math.floor(rand() * list.length)];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function clean(word) {
  const w = word.toLowerCase();
  if (w.length < 3 || w.length > 14) return false;
  if (BLOCK.some((b) => w.includes(b))) return false;
  // Four consonants together cannot be said.
  if (/[^aeiouy\s]{4}/.test(w)) return false;
  // Nor a stutter: a part that met itself ("Kharkhar").
  if (/([a-z]{3,})\1/.test(w)) return false;
  return true;
}

function stem(st, rand) { return join(pick(rand, st.starts), pick(rand, st.links)); }
function place(st, rand) {
  // One in four places carries a stem before its ending, for length.
  const head = rand() < 0.25 ? stem(st, rand) : pick(rand, st.starts);
  return join(head, pick(rand, st.ends));
}
function realm(st, rand) { return join(pick(rand, st.starts), pick(rand, st.realms)); }

/** One name of the given kind, or null when the draw produced something the
 *  filter turned away. */
function makeName(style, kind, rand) {
  let st = NAME_STYLES[style] || COMMON;
  if (st.mixed) {
    const real = Object.keys(NAME_STYLES).filter((k) => !NAME_STYLES[k].mixed);
    st = NAME_STYLES[pick(rand, real)];
  }
  const k = NAME_KINDS[kind] || NAME_KINDS.settlement;
  const patterns = k.patterns.concat((st.extra && st.extra[kind]) || []);
  const pattern = pick(rand, patterns);
  const parts = { W: stem(st, rand), P: place(st, rand), R: realm(st, rand) };
  const used = pattern.match(/\{[WPR]\}/g) || [];
  for (const u of used) if (!clean(parts[u[1]])) return null;
  // {W} directly followed by letters is one word ("Ashwood"): the suffix is
  // glued on with the same rules as any other seam.
  const name = pattern.replace(/\{([WPR])\}([a-z]*)/g, (m, key, tail) => cap(join(parts[key], tail)));
  return name;
}

/**
 * `count` different names, seeded. Names in `avoid` (case-insensitive) are
 * skipped, so a map is not offered a second Ashford. Gives up quietly after a
 * generous number of draws rather than looping forever on a tiny style.
 *
 * @param {{seed?: string|number, style?: string, kind?: string, count?: number,
 *          avoid?: Iterable<string>}} params
 * @returns {string[]}
 */
export function suggestNames(params = {}) {
  const style = NAME_STYLES[params.style] ? params.style : 'common';
  const kind = NAME_KINDS[params.kind] ? params.kind : 'settlement';
  const count = Math.max(1, Math.min(48, params.count | 0 || 12));
  const rand = rng(hashString('names|' + String(params.seed == null ? '' : params.seed) + '|' + style + '|' + kind));
  const seen = new Set();
  for (const a of params.avoid || []) if (a) seen.add(String(a).trim().toLowerCase());
  const out = [];
  for (let tries = 0; out.length < count && tries < count * 40; tries++) {
    const name = makeName(style, kind, rand);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Every name already lettered on the open map: label wording and region
 *  names. Passed as `avoid` so the suggestions are new to this map. */
export function namesOnMap(doc = app.doc) {
  const out = [];
  if (!doc) return out;
  for (const layer of doc.layers) {
    if (layer.kind === 'labels') for (const op of layer.ops) if (op.text) out.push(op.text);
    if (layer.kind === 'regions') for (const op of layer.ops) if (op.name) out.push(op.name);
  }
  return out;
}


/* ----------------------------------------------------------------- chooser */

/* The style is remembered between dialogs, because a map tends to be one
 * people's; the kind is not, because it follows what is being named. */

const SUGGESTIONS = 12;

/**
 * A row of name chips with a style and a kind menu and a More button, for
 * putting inside any dialog that asks for a name. `onPick(name)` is called
 * when a chip is clicked. Returns the element.
 */
export function nameChooser({ kind = 'settlement', onPick }) {
  const state = {
    style: NAME_STYLES[toolSetting('names', 'style', 'common')] ? toolSetting('names', 'style', 'common') : 'common',
    kind: NAME_KINDS[kind] ? kind : 'settlement',
    // Where in the sequence this dialog starts. Random, so two dialogs in a
    // row do not offer the same twelve; the seed is on the element so a test
    // can ask suggestNames for the same list.
    seed: Math.floor(Math.random() * 1e9).toString(36),
    step: 0,
    // Every name this chooser has shown for the style and kind in hand. Each
    // page is its own seeded draw, so without this More could offer again a
    // name it had just shown -- up to 21 of 48 over a few pages.
    shown: new Set(),
  };
  const chips = el('div', { class: 'name-chips', 'data-names': 'chips' });
  const styleSel = el('select', { 'data-names': 'style',
    onchange: () => { state.style = styleSel.value; setToolSetting('names', 'style', state.style); state.step = 0; state.shown.clear(); fill(); } },
    Object.entries(NAME_STYLES).map(([id, s]) => el('option', { value: id, text: s.label, selected: id === state.style })));
  const kindSel = el('select', { 'data-names': 'kind',
    onchange: () => { state.kind = kindSel.value; state.step = 0; state.shown.clear(); fill(); } },
    Object.entries(NAME_KINDS).map(([id, k]) => el('option', { value: id, text: k.label, selected: id === state.kind })));
  const more = el('button', { class: 'btn', type: 'button', text: 'More', 'data-names': 'more',
    title: 'Twelve more names in this style',
    onclick: () => { state.step += 1; fill(); } });

  function fill() {
    const seed = state.seed + ':' + state.step;
    chips.dataset.seed = seed;
    chips.dataset.style = state.style;
    chips.dataset.kind = state.kind;
    chips.innerHTML = '';
    const avoid = namesOnMap().concat([...state.shown]);
    for (const name of suggestNames({ seed, style: state.style, kind: state.kind,
                                      count: SUGGESTIONS, avoid })) {
      state.shown.add(name);
      chips.appendChild(el('button', { class: 'name-chip', type: 'button', text: name,
                                       'data-name': name, onclick: () => onPick(name) }));
    }
  }
  fill();
  return el('div', { class: 'name-chooser', 'data-names': 'chooser' }, [
    el('div', { class: 'name-head' }, [
      el('span', { class: 'muted small', text: 'Suggestions' }), styleSel, kindSel, more,
    ]),
    chips,
  ]);
}

/** A dialog that is only the chooser: resolves with the name clicked, or null
 *  when it is closed without one. */
export async function pickName({ kind = 'settlement', title = 'Suggest a name' } = {}) {
  const body = el('div', {}, [
    nameChooser({ kind, onPick: (name) => closeModal(name) }),
    el('p', { class: 'muted small',
      text: 'Click a name to use it. The names are made up on this machine from word parts, '
          + 'so any of them is yours to keep; More gives twelve others.' }),
  ]);
  const chosen = await modal({ title, body, buttons: [{ label: 'Cancel' }] });
  return typeof chosen === 'string' ? chosen : null;
}


/* ------------------------------------------------------------ pending name */

/* A name picked from the palette with nothing selected to give it to waits
 * here for the next label the Label tool places, which opens its dialog with
 * the name already filled in. Taken once. */
let pending = { name: '', doc: null };
// The name is kept with the map it was picked for: it was checked against
// that map's names, and opening or starting another map left it waiting to
// fill the first label drawn there.
export function setPendingName(name) { pending = { name: String(name || ''), doc: app.doc }; }
export function takePendingName() {
  const n = pending.doc === app.doc ? pending.name : '';
  pending = { name: '', doc: null };
  return n;
}
