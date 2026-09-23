import locationsJson from "../data/locations.json";
import { Rng } from "../rng";

export const LOC = locationsJson as any;

export interface MapNode {
  id: string;
  type: string; // location type or "home" / "trader" / "camp"
  name: string;
  x: number;
  y: number;
  links: string[];
  known: boolean;
  visited: boolean;
  faction?: string;
  danger: number;
  hidden?: boolean; // revealed only by events (ark, cache)
  theme?: string;
  site?: any; // persisted site state after the first visit
  looted?: number; // share of containers searched
}

export interface WasteMap {
  nodes: Record<string, MapNode>;
  home: string;
}

export const FACTIONS: Record<string, { name: string; icon: string; desc: string }> = {
  order: { name: "Порядок", icon: "🪖", desc: "Военные остатки. Строгие, но держат слово." },
  caravan: { name: "Караванщики", icon: "🐫", desc: "Торговцы. Всё продаётся." },
  flash: { name: "Дети Вспышки", icon: "🔥", desc: "Секта. Огонь очистит мир." },
  ratking: { name: "Крысиный король", icon: "👑", desc: "Бандиты промзоны." },
};

const NEAR = ["shop", "school", "farm", "gas", "shop"];
const MID = ["hospital", "metro", "shop", "school", "farm", "gas"];
const FAR = ["checkpoint", "crater", "hospital", "rival", "metro"];

export function nodeName(type: string, R: Rng): string {
  const streets = ["на Кирпичной", "у Кольцевой", "на Проспекте Созидания", "в промзоне", "на Слесарном", "у реки", "на Холме", "в Заречье", "у Парка Мира", "на Вокзальной"];
  if (type === "trader") return R.pick(["Торговец у моста", "Барахолка «Пятак»", "Караван-сарай"]);
  if (type === "camp") return "Лагерь";
  if (type === "home") return "Наш бункер";
  const base = LOC.types[type]?.name ?? type;
  return `${base} ${R.pick(streets)}`;
}

export function generateMap(seed: number): WasteMap {
  const R = Rng.from(seed * 31 + 7);
  const nodes: Record<string, MapNode> = {};
  const home: MapNode = { id: "home", type: "home", name: "Наш бункер", x: 50, y: 40, links: [], known: true, visited: true, danger: 0 };
  nodes.home = home;
  const count = 30 + (Math.abs(seed) % 21);
  const pts: { x: number; y: number }[] = [{ x: 50, y: 40 }];
  let guard = 0;
  while (pts.length < count + 1 && guard++ < 5000) {
    const x = R.range(4, 96),
      y = R.range(4, 76);
    if (pts.every((p) => Math.hypot(p.x - x, p.y - y) > 8.5)) pts.push({ x, y });
  }
  // types by distance, with guaranteed specials
  const specials = ["hospital", "hospital", "checkpoint", "radiotower", "metro", "trader", "trader", "signal", "crater", "camp", "camp", "camp", "camp", "rival"];
  const others = pts.slice(1).map((p, i) => ({ ...p, i, d: Math.hypot(p.x - 50, p.y - 40) }));
  others.sort((a, b) => a.d - b.d);
  const types: string[] = new Array(others.length).fill("");
  // near ring (closest 20%) gets easy places; specials spread across mid/far
  const nearN = Math.floor(others.length * 0.25);
  for (let k = 0; k < others.length; k++) {
    if (k < nearN) types[k] = R.pick(NEAR);
    else if (k < others.length * 0.6) types[k] = R.pick(MID);
    else types[k] = R.pick(FAR);
  }
  // place specials on random mid/far slots (one trader near)
  const slots = R.shuffle([...Array(others.length).keys()].filter((k) => k >= nearN));
  let si = 0;
  for (const sp of specials) {
    if (sp === "trader" && !types.slice(0, nearN).includes("trader")) {
      types[R.int(0, Math.max(0, nearN - 1))] = "trader";
      continue;
    }
    if (si < slots.length) types[slots[si++]] = sp;
  }
  const factions = ["order", "caravan", "flash", "ratking"];
  let fi = 0;
  others.forEach((p, k) => {
    const type = types[k];
    const id = "n" + k;
    const lt = LOC.types[type];
    const n: MapNode = {
      id,
      type,
      name: nodeName(type, R),
      x: Math.round(p.x * 10) / 10,
      y: Math.round(p.y * 10) / 10,
      links: [],
      known: false,
      visited: false,
      danger: lt?.danger ?? (type === "camp" ? 2 : 1),
      theme: lt ? R.pick(lt.themes) : undefined,
    };
    if (type === "camp") {
      n.faction = factions[fi++ % 4];
      n.name = `Лагерь: ${FACTIONS[n.faction].name}`;
    }
    if (type === "signal") n.hidden = true;
    nodes[id] = n;
  });
  // hidden story nodes: the Ark (far corner) and a cache
  const far = others[others.length - 1];
  nodes.ark = { id: "ark", type: "ark", name: "Ковчег — Северный горный узел", x: Math.min(97, far.x + 3), y: Math.max(3, far.y - 3), links: [], known: false, visited: false, danger: 4, hidden: true, theme: "Врата Ковчега" };
  const cachePt = others[Math.floor(others.length / 2)];
  nodes.cache = { id: "cache", type: "cache", name: "Склад ГО по карте", x: Math.min(97, cachePt.x + 4), y: Math.min(77, cachePt.y + 4), links: [], known: false, visited: false, danger: 1, hidden: true, theme: "Довоенный склад гражданской обороны" };
  // links: each node to its 2–3 nearest, plus MST for connectivity
  const ids = Object.keys(nodes);
  const dist = (a: MapNode, b: MapNode) => Math.hypot(a.x - b.x, a.y - b.y);
  const link = (a: MapNode, b: MapNode) => {
    if (a.id === b.id || a.links.includes(b.id)) return;
    a.links.push(b.id);
    b.links.push(a.id);
  };
  for (const id of ids) {
    const a = nodes[id];
    const near = ids.filter((j) => j !== id).sort((p, q) => dist(a, nodes[p]) - dist(a, nodes[q]));
    const k = id === "home" ? 4 : R.int(2, 3);
    for (const j of near.slice(0, k)) if (dist(a, nodes[j]) < 30) link(a, nodes[j]);
  }
  // MST (Prim) to guarantee connectivity
  const inTree = new Set(["home"]);
  while (inTree.size < ids.length) {
    let best: [string, string, number] | null = null;
    for (const a of inTree)
      for (const b of ids) {
        if (inTree.has(b)) continue;
        const d = dist(nodes[a], nodes[b]);
        if (!best || d < best[2]) best = [a, b, d];
      }
    if (!best) break;
    link(nodes[best[0]], nodes[best[1]]);
    inTree.add(best[1]);
  }
  // fog: the neighbourhood is known — home's neighbours and their neighbours (a real choice on day one),
  // plus anything within a short walk
  for (const j of home.links) {
    nodes[j].known = true;
    for (const k of nodes[j].links) if (!nodes[k].hidden) nodes[k].known = true;
  }
  for (const n of Object.values(nodes)) if (!n.hidden && Math.hypot(n.x - home.x, n.y - home.y) < 22) n.known = true;
  return { nodes, home: "home" };
}

/** Travel time in game hours between linked nodes. */
export function travelHours(a: MapNode, b: MapNode, weather = "ash") {
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  return (d / 9) * (weather === "storm" ? 1.8 : weather === "cold" ? 1.3 : 1);
}

/** Shortest path (by distance) through known nodes. */
export function mapPath(m: WasteMap, from: string, to: string, onlyKnown = true): string[] | null {
  const dist: Record<string, number> = { [from]: 0 };
  const prev: Record<string, string> = {};
  const q = new Set(Object.keys(m.nodes));
  while (q.size) {
    let u: string | null = null;
    for (const k of q) if (dist[k] !== undefined && (u === null || dist[k] < dist[u])) u = k;
    if (u === null) break;
    q.delete(u);
    if (u === to) break;
    for (const v of m.nodes[u].links) {
      const nv = m.nodes[v];
      if (onlyKnown && !nv.known && v !== to) continue;
      const d = dist[u] + Math.hypot(nv.x - m.nodes[u].x, nv.y - m.nodes[u].y);
      if (dist[v] === undefined || d < dist[v]) {
        dist[v] = d;
        prev[v] = u;
      }
    }
  }
  if (dist[to] === undefined) return null;
  const path = [to];
  while (path[0] !== from) path.unshift(prev[path[0]]);
  return path;
}
