// Line icons for the interface (24×24, drawn with currentColor). One small inline set instead of an icon
// font: crisp at any size, tinted by CSS, no extra requests. `icon("food")` → <svg class="ic ic-food">.

const P: Record<string, string> = {
  // resources & needs
  food: '<path d="M6 4h12v3H6z"/><path d="M6 7v12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7"/><path d="M9 12h6M9 15h4"/>',
  fork: '<path d="M7 3v7a2 2 0 0 0 4 0V3M9 10v11"/><path d="M17 3c-2 0-3 2-3 5s1 4 3 4v9"/>',
  water: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
  energy: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  metal: '<path d="m4 14 4-7h12l-4 7z"/><path d="M4 14v3l12 0v-3M16 17l4-7v-3"/>',
  wood: '<circle cx="7" cy="16" r="3"/><circle cx="17" cy="16" r="3"/><circle cx="12" cy="8" r="3"/><path d="M7 13h10M9.5 8H7M14.5 8H17"/>',
  meds: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5h6v2M12 10v7M8.5 13.5h7"/>',
  parts: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  air: '<path d="M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  brain: '<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 3 3h0V4zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-3 3V4z"/>',
  rad: '<circle cx="12" cy="12" r="2"/><path d="M12 10 8.5 4a8 8 0 0 1 7 0zM13.7 13l6.3.2a8 8 0 0 1-3.5 6zM10.3 13 4 13.2a8 8 0 0 0 3.5 6z"/>',
  // time & world
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  map: '<path d="m3 6 6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  home: '<path d="m3 11 9-7 9 7"/><path d="M5 10v10h14V10M10 20v-6h4v6"/>',
  hatch: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 4v5M12 15v5M4 12h5M15 12h5"/>',
  // people
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>',
  userPlus: '<circle cx="10" cy="8" r="4"/><path d="M3 21a7 7 0 0 1 14 0M19 8v6M16 11h6"/>',
  crown: '<path d="m3 8 4 4 5-7 5 7 4-4-2 11H5z"/>',
  bot: '<rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9 16h6"/>',
  // actions & ui
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  hammer: '<path d="m14 12-8.5 8.5a2.1 2.1 0 1 1-3-3L11 9"/><path d="m15 13 6-6-4-4-6 6z"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  backpack: '<path d="M6 20V10a6 6 0 0 1 12 0v10a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1z"/><path d="M9 4.5V3h6v1.5M9 21v-6h6v6M6 13h12"/>',
  exit: '<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/>',
  logout: '<path d="M9 4H5v16h4M15 8l4 4-4 4M19 12H9"/>',
  enter: '<path d="M10 4h9v16h-9M5 12h10M11 8l4 4-4 4"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.5 7.2L4 21l1.8-5A8 8 0 1 1 21 12z"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5M19 19v2H6"/>',
  journal: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6M9 11h6M9 15h4"/>',
  board: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h4M7 12h10M7 16h7"/>',
  news: '<path d="M4 5h13v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M17 9h3v10a2 2 0 0 1-2 2M8 9h5M8 13h5M8 17h3"/>',
  pot: '<path d="M4 10h16v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M2 10h20M9 6c0-1 1-1 1-2M14 6c0-1 1-1 1-2"/>',
  play: '<path d="M7 4v16l13-8z"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M15 8l2 2"/>',
  dice: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 8h.01M16 8h.01M12 12h.01M8 16h.01M16 16h.01" stroke-width="3"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.8-3M4 5v4h4M4 13a8 8 0 0 0 14.8 3M20 19v-4h-4"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  swords: '<path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M9.5 6.5 21 3v3l-4.5 4.5M5 14l4 4M7 17l-3 3M3 19l2 2"/>',
  crosshair: '<circle cx="12" cy="12" r="8"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
  shovel: '<path d="M14 3l7 7-3 1-2-2-6 6 1 1-3 3a2 2 0 0 1-3-3l3-3 1 1 6-6-2-2z"/>',
  radio: '<rect x="3" y="8" width="18" height="12" rx="2"/><path d="m7 8 10-5"/><circle cx="8" cy="14" r="2"/><path d="M14 13h4M14 16h4"/>',
  flashlight: '<path d="M7 3h10l-2 6H9z"/><path d="M9 9h6v10a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2z"/><path d="M12 13v2"/>',
  hand: '<path d="M8 13V5a1.5 1.5 0 0 1 3 0v6M11 10V3.5a1.5 1.5 0 0 1 3 0V10M14 10V5a1.5 1.5 0 0 1 3 0v8a7 7 0 0 1-7 7h-.5A6.5 6.5 0 0 1 4 15.2V12a1.5 1.5 0 0 1 3 0v1"/>',
  run: '<circle cx="14" cy="4" r="2"/><path d="m6 21 4-6 3 2 1 4M8 9l3-2 4 3 3 1M10 15l1-6M4 13l3-1"/>',
  muscle: '<path d="M7 20c-2-4 0-9 3-12l2-4 3 1-1 3 2 3c3 0 5 2 5 5-3 3-8 4-14 4z"/>',
  feather: '<path d="M20 4c-6 0-12 4-13 13L4 20M16 8 7 17M20 4c0 7-4 12-11 13"/>',
  sparkles: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4a3 3 0 0 0 4 4M16 6h4a3 3 0 0 1-4 4M12 13v4M8 21h8M9 17h6"/>',
  skull: '<path d="M12 3a8 8 0 0 0-5 14v4h10v-4a8 8 0 0 0-5-14z"/><circle cx="9" cy="11" r="1.5"/><circle cx="15" cy="11" r="1.5"/><path d="M11 21v-3M13 21v-3"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  gamepad: '<rect x="2" y="7" width="20" height="11" rx="5"/><path d="M7 11v3M5.5 12.5h3M15 12h.01M18 13h.01" />',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  chevronRight: '<path d="m9 5 7 7-7 7"/>',
  chevronDown: '<path d="m5 9 7 7 7-7"/>',
  fullscreen: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  volume: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>',
  telegram: '<path d="m21 4-18 7 6 2 2 6 3-4 5 4z"/><path d="m9 13 8-6"/>',
};

export type IconName = keyof typeof P | string;

/** An inline SVG icon; size in px (default 1em-ish via CSS). */
export function icon(name: IconName, opts: { size?: number; color?: string; cls?: string; title?: string } = {}): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", `ic ic-${name}${opts.cls ? " " + opts.cls : ""}`);
  svg.setAttribute("aria-hidden", "true");
  if (opts.size) {
    svg.setAttribute("width", String(opts.size));
    svg.setAttribute("height", String(opts.size));
  }
  if (opts.color) svg.style.color = opts.color;
  svg.innerHTML = (opts.title ? `<title>${opts.title}</title>` : "") + (P[name] ?? P.info);
  return svg;
}

/** Colours that go with each icon wherever it appears (stats, needs, skills, resources). */
export const IC_COLOR: Record<string, string> = {
  food: "#e8a45a",
  fork: "#e8a45a",
  water: "#5fb0f0",
  energy: "#f2c14e",
  metal: "#b8bec4",
  wood: "#c0874f",
  meds: "#e45a4a",
  parts: "#9aa4ad",
  heart: "#e2524a",
  brain: "#e58fb5",
  rad: "#b6e04a",
  star: "#f2c14e",
  muscle: "#e8664a",
  run: "#f2b53c",
  book: "#5fa0f0",
  users: "#a88cf0",
  shield: "#6fce7a",
};

/** Icon + colour for the five stats, the needs and the skills, shared by every screen. */
export const STAT_IC: Record<string, [string, string]> = {
  sil: ["muscle", "#ef6a4c"],
  lov: ["run", "#f2b53c"],
  int: ["book", "#5fa0f0"],
  vyn: ["heart", "#6fd07a"],
  har: ["users", "#a88cf0"],
};
export const NEED_IC: Record<string, [string, string]> = {
  food: ["fork", "#e8a45a"],
  water: ["water", "#5fb0f0"],
  energy: ["energy", "#f2c14e"],
  sanity: ["brain", "#e58fb5"],
  health: ["heart", "#e2524a"],
  rad: ["rad", "#b6e04a"],
};
export const SKILL_IC: Record<string, [string, string]> = {
  repair: ["wrench", "#e0a458"],
  medicine: ["meds", "#e45a4a"],
  cooking: ["pot", "#e8a45a"],
  shooting: ["crosshair", "#e0c05a"],
  melee: ["swords", "#e8864a"],
  digging: ["shovel", "#c0874f"],
  radio: ["radio", "#8fb8d0"],
  stealth: ["eye", "#a0c8a0"],
};

/** A coloured icon from one of the maps above. */
export function cic(map: Record<string, [string, string]>, key: string, size?: number) {
  const [n, c] = map[key] ?? ["info", "#ccc"];
  return icon(n, { color: c, size });
}
