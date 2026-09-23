// One-off generator for the wasteland map «Новоград»: `node scripts/gen-map.mjs`
// Draws a detailed district map (river, bridges, roads, blocks, the crater, hills, forest, rail)
// into packages/client/public/assets/wasteland-map.svg and writes the fixed location slots and
// the road graph between them into packages/shared/src/data/mapslots.json.
// Map coordinates are 0..100 × 0..80 (the game map's viewBox); the SVG is drawn at ×10.
// Run it again only when the layout changes — both files are committed.
import { writeFileSync } from "node:fs";

// ---------------------------------------------------------------- the layout (hand-placed)

/** Location slots. `kinds`: what may stand there (seeded per game); `fixed`: always this type. */
const SLOTS = [
  { id: "home", x: 50, y: 46, fixed: "home", street: "", district: "Заречье" },
  // Заречье — south bank around the bunker: the easy first sorties
  { id: "n1", x: 42.5, y: 50.5, kinds: ["shop"], street: "на Кирпичной", district: "Заречье" },
  { id: "n2", x: 57, y: 51.5, kinds: ["school", "shop"], street: "на Слесарном", district: "Заречье" },
  { id: "n3", x: 48, y: 58.5, kinds: ["gas", "shop"], street: "на Южном шоссе", district: "Заречье" },
  { id: "n4", x: 37.5, y: 44.5, kinds: ["farm", "shop"], street: "у Парка Мира", district: "Заречье" },
  { id: "n5", x: 62, y: 44.5, fixed: "trader", name: "Торговец у моста", district: "Заречье" },
  { id: "n6", x: 54, y: 63, kinds: ["farm", "shop", "school"], street: "в Заречье", district: "Заречье" },
  { id: "b2", x: 56.5, y: 38.5, kinds: ["shop", "gas"], street: "у Центрального моста", district: "Заречье" },
  // Центр — north bank
  { id: "c1", x: 55, y: 27.5, fixed: "hospital", name: "Городская больница на Проспекте Созидания", district: "Центр" },
  { id: "c2", x: 46.5, y: 23.5, kinds: ["school", "shop"], street: "на Проспекте Созидания", district: "Центр" },
  { id: "c3", x: 63.5, y: 21.5, fixed: "metro", name: "Метро «Площадь Свободы»", district: "Центр" },
  { id: "c4", x: 41, y: 25.5, kinds: ["shop", "school"], street: "на Садовой", district: "Центр" },
  { id: "c5", x: 52, y: 15, fixed: "hospital", name: "Ведомственная поликлиника", district: "Центр" },
  { id: "c6", x: 69, y: 30.5, fixed: "camp", faction: "order", district: "Центр" },
  // bridges and the cordon
  { id: "b1", x: 28.5, y: 23.5, fixed: "checkpoint", name: "КПП у Западного моста", district: "Мосты" },
  { id: "b3", x: 80.5, y: 45.5, fixed: "checkpoint", name: "Пост у Восточного моста", district: "Мосты" },
  { id: "k3", x: 11, y: 23, kinds: ["checkpoint", "hospital"], street: "на Санитарном кордоне", district: "Кратер" },
  // Промзона — east
  { id: "e1", x: 76.5, y: 21.5, kinds: ["gas", "shop"], street: "в промзоне", district: "Промзона" },
  { id: "e2", x: 87, y: 28, fixed: "rival", name: "Бункер «Крысиного короля»", district: "Промзона" },
  { id: "e3", x: 90, y: 15.5, fixed: "camp", faction: "ratking", district: "Промзона" },
  { id: "e4", x: 80.5, y: 35, fixed: "metro", name: "Депо «Восточное»", district: "Промзона" },
  { id: "e5", x: 70, y: 13, kinds: ["gas", "shop", "school"], street: "у Элеватора", district: "Промзона" },
  // Холм — west
  { id: "w1", x: 18.5, y: 46.5, kinds: ["farm"], street: "на Холме", district: "Холм" },
  { id: "w2", x: 11.5, y: 57, kinds: ["farm"], street: "в Дачах", district: "Холм" },
  { id: "w3", x: 21.5, y: 35.5, fixed: "radiotower", name: "Телевышка на Холме", district: "Холм" },
  { id: "w4", x: 7.5, y: 39.5, fixed: "signal", district: "Холм" },
  { id: "w5", x: 28.5, y: 54, kinds: ["school", "shop", "farm"], street: "у Водокачки", district: "Холм" },
  { id: "w6", x: 20, y: 67, fixed: "camp", faction: "flash", district: "Лес" },
  // Вокзал — south-east
  { id: "s1", x: 72, y: 61.5, fixed: "trader", name: "Барахолка «Пятак» у вокзала", district: "Вокзал" },
  { id: "s2", x: 83, y: 66, fixed: "metro", name: "Метро «Вокзальная»", district: "Вокзал" },
  { id: "s3", x: 63.5, y: 70, fixed: "camp", faction: "caravan", district: "Вокзал" },
  { id: "s4", x: 90.5, y: 56.5, kinds: ["farm", "gas"], street: "за Вокзалом", district: "Вокзал" },
  { id: "s5", x: 37.5, y: 67.5, kinds: ["gas", "farm", "shop"], street: "на Южном шоссе, 40 км", district: "Лес" },
  // Кратер — where the warhead fell
  { id: "k1", x: 19.5, y: 11, fixed: "crater", name: "Воронка — эпицентр", district: "Кратер" },
  { id: "k2", x: 33, y: 11.5, kinds: ["hospital", "school", "metro"], street: "в Мёртвом квартале", district: "Кратер" },
  // hidden until the story reveals them
  { id: "cache", x: 33, y: 39, fixed: "cache", name: "Склад ГО по карте", district: "Холм", hidden: true },
  { id: "ark", x: 95, y: 5.5, fixed: "ark", name: "Ковчег — Северный горный узел", district: "Горы", hidden: true },
];

/** Roads: each chain links its slots in order (these are the only ways to travel). */
const ROADS = [
  ["w6", "s5", "n3", "n6", "s3", "s1", "s2", "s4"], // Южное шоссе и объездная
  ["home", "n1"],
  ["home", "n2"],
  ["home", "n3"],
  ["home", "n4"],
  ["home", "b2"],
  ["n1", "n4", "cache", "w5"],
  ["n4", "w1", "w2"],
  ["w1", "w3", "w4"],
  ["w3", "b1"],
  ["w5", "w6"],
  ["w5", "s5"],
  ["n1", "n3"],
  ["n2", "n5", "b3"],
  ["n2", "n6"],
  ["n5", "b2"],
  ["b2", "c1"],
  ["c1", "c2", "c4", "b1"],
  ["c1", "c3"],
  ["c1", "c6"],
  ["c2", "c5", "c3"],
  ["c5", "k2"],
  ["c3", "e1", "e2", "e3"],
  ["c3", "e5", "e3"],
  ["e1", "e4"],
  ["c6", "e4", "b3"],
  ["b3", "s4"],
  ["b3", "s1"],
  ["b1", "k3", "k1", "k2"],
  ["e3", "ark"],
];

// ---------------------------------------------------------------- drawing helpers

let seed = 20240917;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const S = 10; // svg units per map unit
const P = (v) => (v * S).toFixed(1);

/** Smooth path through points (Catmull-Rom → cubic Bézier). */
function smooth(pts, closed = false) {
  const p = pts.map(([x, y]) => [x * S, y * S]);
  let d = `M${p[0][0].toFixed(1)},${p[0][1].toFixed(1)}`;
  const n = p.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const p0 = p[(i - 1 + n) % n] ?? p[i],
      p1 = p[i],
      p2 = p[(i + 1) % n],
      p3 = p[(i + 2) % n] ?? p2;
    const a = closed || i > 0 ? p0 : p1;
    const b = closed || i < n - 2 ? p3 : p2;
    const c1 = [p1[0] + (p2[0] - a[0]) / 6, p1[1] + (p2[1] - a[1]) / 6];
    const c2 = [p2[0] - (b[0] - p1[0]) / 6, p2[1] - (b[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d + (closed ? "Z" : "");
}

const RIVER = [
  [-2, 19],
  [8, 21],
  [18, 18.5],
  [27, 21.5],
  [36, 28],
  [46, 34],
  [56, 35.5],
  [66, 38],
  [74, 42.5],
  [82, 47],
  [92, 50],
  [102, 51],
];

function riverY(x) {
  for (let i = 0; i < RIVER.length - 1; i++) {
    const [x0, y0] = RIVER[i],
      [x1, y1] = RIVER[i + 1];
    if (x >= x0 && x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return 40;
}

const slot = Object.fromEntries(SLOTS.map((s) => [s.id, s]));
const out = [];
const add = (s) => out.push(s);

// ---------------------------------------------------------------- the SVG

add(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 800" width="1000" height="800">`);
add(`<defs>
  <radialGradient id="burn" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#2a0f06" stop-opacity="0.95"/><stop offset="0.45" stop-color="#5a2410" stop-opacity="0.55"/><stop offset="1" stop-color="#5a2410" stop-opacity="0"/></radialGradient>
  <radialGradient id="vignette" cx="0.5" cy="0.5" r="0.75"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.55"/></radialGradient>
  <linearGradient id="paper" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1c2622"/><stop offset="0.5" stop-color="#1a2320"/><stop offset="1" stop-color="#161d1b"/></linearGradient>
  <pattern id="field" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="14" height="14" fill="#2b3325"/><line x1="0" y1="0" x2="0" y2="14" stroke="#3b4530" stroke-width="5"/></pattern>
  <pattern id="ruin" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)"><rect width="10" height="10" fill="#2a2522"/><line x1="0" y1="0" x2="0" y2="10" stroke="#3a302a" stroke-width="3"/></pattern>
  <filter id="rough"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="7"/><feDisplacementMap in="SourceGraphic" scale="6"/></filter>
  <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3" result="n"/><feColorMatrix type="matrix" values="0 0 0 0 0.6  0 0 0 0 0.55  0 0 0 0 0.45  0 0 0 0.09 0"/></filter>
</defs>`);
add(`<rect width="1000" height="800" fill="url(#paper)"/>`);
add(`<rect width="1000" height="800" filter="url(#grain)"/>`);

// mountains in the north-east
for (let i = 0; i < 26; i++) {
  const x = 740 + rnd() * 270,
    y = 10 + rnd() * 95 - (x - 740) * 0.08;
  const w = 26 + rnd() * 34,
    h = 20 + rnd() * 30;
  add(`<path d="M${(x - w).toFixed(0)},${(y + h).toFixed(0)} L${x.toFixed(0)},${y.toFixed(0)} L${(x + w).toFixed(0)},${(y + h).toFixed(0)}" fill="#252e2b" stroke="#56645c" stroke-width="1.6"/>`);
  add(`<path d="M${x.toFixed(0)},${y.toFixed(0)} L${(x + w * 0.35).toFixed(0)},${(y + h * 0.5).toFixed(0)}" stroke="#7d8a80" stroke-width="1.2"/>`);
}
// the hill (contour lines) in the west
for (let r = 1; r <= 7; r++)
  add(`<ellipse cx="190" cy="400" rx="${40 + r * 22}" ry="${28 + r * 16}" fill="none" stroke="#3c4a3f" stroke-width="1.2" stroke-dasharray="${r % 2 ? "0" : "5 4"}" filter="url(#rough)"/>`);
// forest in the south-west
for (let i = 0; i < 260; i++) {
  const x = 30 + rnd() * 340,
    y = 590 + rnd() * 200;
  if (x > 300 && y < 640) continue;
  add(`<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${(4 + rnd() * 5).toFixed(1)}" fill="#1f2c22" stroke="#34473a" stroke-width="1"/>`);
}
// fields around the farms and dachas
for (const [x, y, w, h, rot] of [
  [60, 480, 120, 70, -12],
  [120, 560, 90, 60, 8],
  [250, 470, 70, 50, 20],
  [860, 560, 110, 60, -6],
  [480, 640, 90, 50, 10],
  [360, 690, 80, 50, -18],
])
  add(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#field)" stroke="#48553b" stroke-width="1.4" transform="rotate(${rot} ${x + w / 2} ${y + h / 2})"/>`);

// city blocks: the centre (north bank) and Заречье (south), the industrial zone
function blocks(x0, y0, x1, y1, step, density, ruined) {
  for (let x = x0; x < x1; x += step)
    for (let y = y0; y < y1; y += step) {
      if (rnd() > density) continue;
      const my = riverY(x / S) * S;
      if (Math.abs(y + step / 2 - my) < 34) continue; // keep the river banks clear
      const w = step * (0.45 + rnd() * 0.4),
        h = step * (0.45 + rnd() * 0.4);
      const broken = rnd() < ruined;
      add(`<rect x="${(x + 4).toFixed(0)}" y="${(y + 4).toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}" fill="${broken ? "url(#ruin)" : "#2c3431"}" stroke="${broken ? "#5a4a3c" : "#4a5752"}" stroke-width="1" ${broken ? 'stroke-dasharray="4 3"' : ""}/>`);
    }
}
blocks(330, 100, 720, 330, 26, 0.72, 0.35); // центр
blocks(340, 400, 660, 660, 28, 0.6, 0.2); // заречье
blocks(700, 110, 960, 400, 34, 0.55, 0.4); // промзона (big sheds)
blocks(640, 560, 940, 740, 30, 0.5, 0.25); // вокзал
blocks(220, 60, 400, 180, 26, 0.5, 0.85); // мёртвый квартал у воронки
// chimneys and tanks in the industrial zone
for (const [x, y] of [
  [760, 170],
  [800, 150],
  [905, 240],
  [840, 330],
]) {
  add(`<circle cx="${x}" cy="${y}" r="9" fill="#2b3130" stroke="#6d7671" stroke-width="1.5"/><circle cx="${x}" cy="${y}" r="3" fill="#6d7671"/>`);
}
// the park of peace near home
add(`<ellipse cx="400" cy="430" rx="45" ry="30" fill="#233327" stroke="#3f5a45" stroke-width="1.4"/>`);
for (let i = 0; i < 26; i++) add(`<circle cx="${(365 + rnd() * 70).toFixed(0)}" cy="${(410 + rnd() * 40).toFixed(0)}" r="4" fill="#2c4432"/>`);

// the crater: scorched ground, rings and radial cracks
const K = slot.k1;
add(`<circle cx="${P(K.x)}" cy="${P(K.y)}" r="210" fill="url(#burn)"/>`);
for (const r of [18, 34, 56]) add(`<circle cx="${P(K.x)}" cy="${P(K.y)}" r="${r}" fill="none" stroke="#7a3a22" stroke-width="${r === 18 ? 3 : 1.4}" stroke-dasharray="${r === 56 ? "6 5" : "0"}" filter="url(#rough)"/>`);
for (let i = 0; i < 14; i++) {
  const a = (i / 14) * Math.PI * 2 + rnd() * 0.2,
    r0 = 60,
    r1 = 110 + rnd() * 90;
  add(`<line x1="${(K.x * S + Math.cos(a) * r0).toFixed(0)}" y1="${(K.y * S + Math.sin(a) * r0).toFixed(0)}" x2="${(K.x * S + Math.cos(a) * r1).toFixed(0)}" y2="${(K.y * S + Math.sin(a) * r1).toFixed(0)}" stroke="#5a2a18" stroke-width="1.3"/>`);
}

// the river «Сорока»
const riverD = smooth(RIVER);
add(`<path d="${riverD}" fill="none" stroke="#1d3a44" stroke-width="44" stroke-linecap="round"/>`);
add(`<path id="river" d="${riverD}" fill="none" stroke="#2c5563" stroke-width="30" stroke-linecap="round"/>`);
add(`<path d="${riverD}" fill="none" stroke="#3f7182" stroke-width="2" stroke-dasharray="14 10" opacity="0.7"/>`);
add(`<text font-family="Georgia, serif" font-style="italic" font-size="17" fill="#7fb0bf" letter-spacing="6"><textPath href="#river" startOffset="62%">р. Сорока</textPath></text>`);

// the railway: from the west through the centre to the station
const RAIL = [
  [0, 31],
  [15, 30],
  [30, 34],
  [44, 40],
  [60, 55],
  [72, 60],
  [86, 64],
  [101, 67],
];
const railD = smooth(RAIL);
add(`<path d="${railD}" fill="none" stroke="#6b645a" stroke-width="3.2"/>`);
add(`<path d="${railD}" fill="none" stroke="#1a2320" stroke-width="1.6" stroke-dasharray="7 7"/>`);

// roads between the slots: main roads are drawn wide, the rest narrow
const MAIN = new Set(["home-b2", "b2-c1", "c1-c3", "w6-s5", "s5-n3", "n3-n6", "n6-s3", "s3-s1", "s1-s2", "s2-s4", "c3-e1", "e1-e2", "b3-s1", "n2-n5", "n5-b3", "c1-c2", "c2-c4", "c4-b1"]);
const edges = [];
for (const chain of ROADS) for (let i = 0; i < chain.length - 1; i++) edges.push([chain[i], chain[i + 1]]);
for (const [a, b] of edges) {
  const A = slot[a],
    B = slot[b];
  // a gentle bend so roads don't look ruled
  const mx = (A.x + B.x) / 2 + (rnd() - 0.5) * 2.2,
    my = (A.y + B.y) / 2 + (rnd() - 0.5) * 2.2;
  const d = smooth([
    [A.x, A.y],
    [mx, my],
    [B.x, B.y],
  ]);
  const main = MAIN.has(`${a}-${b}`) || MAIN.has(`${b}-${a}`);
  const hidden = A.hidden || B.hidden;
  add(`<path d="${d}" fill="none" stroke="#12181a" stroke-width="${main ? 9 : 6}" stroke-linecap="round" ${hidden ? 'stroke-dasharray="2 8"' : ""}/>`);
  add(`<path d="${d}" fill="none" stroke="${main ? "#8a7f68" : "#655f52"}" stroke-width="${main ? 5 : 3}" stroke-linecap="round" ${hidden ? 'stroke-dasharray="2 8"' : ""}/>`);
}
// bridges where roads cross the river
for (const id of ["b1", "b2", "b3"]) {
  const s = slot[id];
  const x = s.x * S,
    y = riverY(s.x) * S;
  add(`<g transform="translate(${x.toFixed(0)} ${y.toFixed(0)}) rotate(${id === "b1" ? -30 : id === "b3" ? 30 : 5})"><rect x="-9" y="-30" width="18" height="60" fill="#6f6857" stroke="#1a1f1f" stroke-width="2"/><line x1="-9" y1="-30" x2="-9" y2="30" stroke="#b5a988" stroke-width="1.5"/><line x1="9" y1="-30" x2="9" y2="30" stroke="#b5a988" stroke-width="1.5"/></g>`);
}
// fixed places get a small plot around them (where the building stands)
for (const s of SLOTS) {
  if (s.hidden) continue;
  add(`<circle cx="${P(s.x)}" cy="${P(s.y)}" r="22" fill="#10151688" stroke="#a79a7a55" stroke-width="1.2" stroke-dasharray="3 4"/>`);
}

// district names
for (const [text, x, y, size, rot] of [
  ["ЦЕНТР", 560, 120, 26, 0],
  ["ЗАРЕЧЬЕ", 470, 610, 24, 0],
  ["ПРОМЗОНА", 840, 110, 22, 0],
  ["ХОЛМ", 130, 330, 22, -8],
  ["ВОКЗАЛ", 790, 740, 22, 0],
  ["МЁРТВЫЙ КВАРТАЛ", 300, 160, 15, -4],
  ["ЛЕС", 110, 650, 22, 0],
  ["СЕВЕРНЫЕ ГОРЫ", 880, 40, 14, 0],
])
  add(`<text x="${x}" y="${y}" font-family="Georgia, serif" font-size="${size}" fill="#c9bb96" fill-opacity="0.38" letter-spacing="${Math.round(size / 3)}" text-anchor="middle" transform="rotate(${rot} ${x} ${y})">${text}</text>`);

// cartouche, compass, scale
add(`<g transform="translate(24 718)"><rect width="248" height="62" fill="#141a1a" stroke="#8d8062" stroke-width="1.5"/><rect x="4" y="4" width="240" height="54" fill="none" stroke="#8d806266"/><text x="14" y="28" font-family="Georgia, serif" font-size="20" fill="#e2d4ae" letter-spacing="3">НОВОГРАД</text><text x="14" y="47" font-family="Georgia, serif" font-size="11" fill="#a89a78">Карта гражданской обороны · лист 7</text><text x="236" y="28" text-anchor="end" font-family="monospace" font-size="10" fill="#b0513a">ДСП</text></g>`);
add(`<g transform="translate(944 730)"><circle r="30" fill="none" stroke="#8d8062" stroke-width="1.2"/><path d="M0,-38 L7,0 L0,38 L-7,0 Z" fill="#8d8062" fill-opacity="0.35" stroke="#8d8062"/><path d="M0,-38 L7,0 L-7,0 Z" fill="#d8c79c"/><text y="-44" text-anchor="middle" font-family="Georgia, serif" font-size="13" fill="#d8c79c">С</text></g>`);
add(`<g transform="translate(300 764)"><rect width="100" height="6" fill="#d8c79c"/><rect x="50" width="50" height="6" fill="#141a1a" stroke="#d8c79c"/><text y="-6" font-family="monospace" font-size="10" fill="#a89a78">0</text><text x="100" y="-6" text-anchor="middle" font-family="monospace" font-size="10" fill="#a89a78">2 км</text></g>`);
add(`<rect width="1000" height="800" fill="url(#vignette)"/>`);
add(`<rect x="3" y="3" width="994" height="794" fill="none" stroke="#8d806299" stroke-width="2"/>`);
add(`</svg>`);

writeFileSync("packages/client/public/assets/wasteland-map.svg", out.join("\n"));
const links = {};
for (const [a, b] of edges) {
  (links[a] ??= []).push(b);
  (links[b] ??= []).push(a);
}
// one slot per line: easy to read and to diff
const rows = SLOTS.map((s) => "  " + JSON.stringify({ ...s, links: links[s.id] ?? [] }));
const NL = String.fromCharCode(10);
writeFileSync("packages/shared/src/data/mapslots.json", `{"slots": [${NL}${rows.join("," + NL)}${NL}]}${NL}`);
console.log(`map: ${SLOTS.length} slots, ${edges.length} roads, svg ${(out.join("\n").length / 1024).toFixed(0)} KB`);
