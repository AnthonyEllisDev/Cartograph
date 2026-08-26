/* Inline icons. Drawn here rather than fetched so the program has no asset
   dependencies of its own and works the moment the server is up. */

const P = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;

export const ICONS = {
  brush: P('<path d="M4 20c3 1 6-1 6-4l7-9a2.5 2.5 0 0 0-3.5-3.5l-9 7c-3 0-5 3-4 6z"/><path d="M10 16l-2-2"/>'),
  erase: P('<path d="M4 16l7-7 6 6-4 4H7z"/><path d="M9 21h11"/><path d="M11 9l6 6"/>'),
  land: P('<path d="M3 15c3-4 5 1 8-2s5 2 9-3"/><path d="M3 20c3-4 5 1 8-2s5 2 9-3"/><path d="M6 9l3-5 4 6"/>'),
  stamp: P('<path d="M12 3l3 6 6 .8-4.4 4.2 1.1 6L12 17.2 6.3 20l1.1-6L3 9.8 9 9z"/>'),
  path: P('<path d="M4 20c4 0 3-6 7-6s3-8 9-8"/>'),
  text: P('<path d="M5 6h14"/><path d="M12 6v13"/><path d="M8 19h8"/>'),
  select: P('<path d="M5 3l14 8-6 1.6L10.5 19z"/>'),
  pan: P('<path d="M12 3v9"/><path d="M8 8l4-4 4 4"/><path d="M3 12h9"/><path d="M8 8"/><path d="M12 21v-9"/><path d="M16 16l-4 4-4-4"/><path d="M21 12h-9"/>'),
  scatter: P('<circle cx="7" cy="8" r="2"/><circle cx="15" cy="6" r="1.4"/><circle cx="12" cy="12" r="2.4"/><circle cx="18" cy="13" r="1.8"/><circle cx="8" cy="17" r="1.6"/><circle cx="15" cy="18" r="2.2"/>'),
  soften: P('<path d="M12 3s6 6.4 6 10.2A6 6 0 0 1 6 13.2C6 9.4 12 3 12 3z"/>'),
  fill: P('<path d="M6 11l6-6 7 7-6 6a2 2 0 0 1-2.8 0L6 13.8A2 2 0 0 1 6 11z"/><path d="M9 8L7 6"/><path d="M20 15c1.4 2 1.4 4-.6 4S18 17 20 15z"/>'),
  shape: P('<rect x="3" y="6" width="11" height="11" rx="1"/><circle cx="16" cy="14" r="5"/>'),
  wall: P('<path d="M3 8h18M3 16h18"/><path d="M3 8v8M9 8v8M15 8v8M21 8v8"/>'),
  measure: P('<rect x="2" y="9" width="20" height="6" rx="1" transform="rotate(-12 12 12)"/><path d="M7 10v2M11 9v3M15 8v2"/>'),
  floor: P('<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 12h18M12 3v18"/><path d="M7.5 7.5h1M15.5 7.5h1M7.5 16.5h1M15.5 16.5h1"/>'),
  eye: P('<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.6"/>'),
  eyeOff: P('<path d="M4 4l16 16"/><path d="M9.5 5.4A9.6 9.6 0 0 1 12 5c6.4 0 10 6 10 6a17 17 0 0 1-3.3 3.9"/><path d="M6.3 7.8A16.6 16.6 0 0 0 2 11s3.6 6 10 6a9.9 9.9 0 0 0 3.6-.7"/>'),
  lock: P('<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>'),
  water: P('<path d="M3 9c3-2 6 2 9 0s6 2 9 0"/><path d="M3 14c3-2 6 2 9 0s6 2 9 0"/><path d="M3 19c3-2 6 2 9 0s6 2 9 0"/>'),
  grid: P('<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/>'),
  paper: P('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>'),
  trash: P('<path d="M4 7h16"/><path d="M9 7V5h6v2"/><rect x="6" y="7" width="12" height="14" rx="2"/>'),
  up: P('<path d="M12 19V5"/><path d="M6 11l6-6 6 6"/>'),
  down: P('<path d="M12 5v14"/><path d="M6 13l6 6 6-6"/>'),
};

export function icon(name) {
  return ICONS[name] || ICONS.brush;
}
