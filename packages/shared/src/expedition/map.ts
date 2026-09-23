import locationsJson from "../data/locations.json";
import mapSlots from "../data/mapslots.json";
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
  district?: string;
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

/**
 * The wasteland map: fixed places on the hand-laid map of Новоград (data/mapslots.json, drawn by
 * scripts/gen-map.mjs into the map picture). What stands in a free slot, its name and theme vary
 * with the seed; the geography — river, bridges, roads, districts — is the same in every game.
 */
export function generateMap(seed: number): WasteMap {
  const R = Rng.from(seed * 31 + 7);
  const nodes: Record<string, MapNode> = {};
  const slots = (mapSlots as { slots: MapSlot[] }).slots;
  const usedNames = new Set<string>();
  for (const s of slots) {
    const type = s.fixed ?? R.pick(s.kinds ?? ["shop"]);
    const lt = LOC.types[type];
    let name = s.name ?? "";
    if (type === "camp" && s.faction) name = `Лагерь: ${FACTIONS[s.faction].name}`;
    else if (type === "signal") name = "Источник сигнала";
    else if (!name) name = `${lt?.name ?? type} ${s.street ?? ""}`.trim();
    if (usedNames.has(name)) name += " (II)";
    usedNames.add(name);
    nodes[s.id] = {
      id: s.id,
      type,
      name,
      x: s.x,
      y: s.y,
      links: [...(s.links ?? [])],
      known: type === "home",
      visited: type === "home",
      faction: s.faction,
      danger: type === "home" ? 0 : lt?.danger ?? (type === "camp" ? 2 : 1),
      hidden: s.hidden || type === "signal" ? true : undefined,
      theme: lt ? R.pick(lt.themes) : undefined,
      district: s.district,
    };
  }
  // fog: the neighbourhood is known — home's neighbours and theirs (a real choice on day one)
  const home = nodes.home;
  for (const j of home.links) {
    if (nodes[j].hidden) continue;
    nodes[j].known = true;
    for (const k of nodes[j].links) if (!nodes[k].hidden) nodes[k].known = true;
  }
  for (const n of Object.values(nodes)) if (!n.hidden && Math.hypot(n.x - home.x, n.y - home.y) < 16) n.known = true;
  return { nodes, home: "home" };
}

interface MapSlot {
  id: string;
  x: number;
  y: number;
  fixed?: string;
  kinds?: string[];
  name?: string;
  street?: string;
  district?: string;
  faction?: string;
  hidden?: boolean;
  links?: string[];
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
