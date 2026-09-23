import { Rng } from "../rng";
import { LOC } from "./map";

export interface SiteRoom {
  id: string;
  kind: string;
  name: string;
  x: number;
  w: number;
  lv: number;
  dark: boolean;
  revealed: boolean;
  rad: number;
  stairs?: boolean;
}

export interface SiteCont {
  id: string;
  kind: string;
  name: string;
  x: number;
  lv: number;
  size: number;
  table: string;
  searched: number; // 0..1 progress, 1 = empty
  locked: boolean;
  coop?: boolean;
  guaranteed?: string[]; // items always inside
  cover?: "half" | "full";
}

export interface SiteDoor {
  id: string;
  x: number;
  lv: number;
  state: "open" | "closed" | "locked" | "broken";
  key?: string; // detail id of the key
}

export interface SiteThreat {
  id: string;
  etype: string;
  x: number;
  lv: number;
  dir: -1 | 1;
  state: "asleep" | "idle" | "patrol" | "alert";
  detect: number; // 0..100
  room: string;
  tx?: number;
}

export interface SiteHazard {
  id: string;
  kind: "rad" | "weak_floor" | "tripwire" | "glass" | "gas";
  x: number;
  lv: number;
  known: boolean;
  armed: boolean;
}

export interface SiteDetail {
  id: string;
  kind: "note" | "stash" | "blood" | "scratches" | "loose_step" | "key" | "photo";
  x: number;
  lv: number;
  text: string;
  found: boolean;
  taken: boolean;
  needsClue?: string; // only findable after this clue was read
  clue?: string; // reading gives this clue id
  loot?: Record<string, number>;
  unlocks?: string; // door or container id
}

export interface SitePerson {
  id: string;
  kind: "survivor" | "family" | "trader" | "patrol" | "wounded";
  name: string;
  x: number;
  lv: number;
  met: boolean;
  gone: boolean;
}

export interface Site {
  node: string;
  type: string;
  theme: string;
  W: number;
  H: number;
  grid: number[]; // 0 open, 7 wall
  ladders: Record<string, number>;
  rooms: SiteRoom[];
  conts: SiteCont[];
  doors: SiteDoor[];
  threats: SiteThreat[];
  hazards: SiteHazard[];
  details: SiteDetail[];
  people: SitePerson[];
  noise: number;
  exitX: number;
  exitLv: number;
  clues: string[];
  spawned: number; // noise-driven reinforcements so far
  danger: number;
  rad: boolean;
}

const HAZARDS: SiteHazard["kind"][] = ["weak_floor", "tripwire", "glass", "gas", "rad"];

/** Builds a building side view: floors of rooms joined by doors; a stair hall on the left joins the floors. */
export function generateSite(nodeId: string, type: string, seed: number, danger: number, theme?: string, opts: { radioPart?: boolean } = {}): Site {
  const R = Rng.from(seed);
  const T = LOC.types[type] ?? LOC.types.shop;
  const nf = R.int(T.floors[0], T.floors[1]);
  const basement = T.basement && R.chance(0.7);
  const levels = nf + (basement ? 1 : 0);
  const groundLv = nf - 1;
  let uid = 0;
  const id = (p: string) => p + uid++;
  // plan rooms per level
  interface Plan {
    kind: string;
    w: number;
  }
  const plans: Plan[][] = [];
  let maxW = 0;
  for (let lv = 0; lv < levels; lv++) {
    const row: Plan[] = [{ kind: "stair_hall", w: 2 }];
    const isBase = lv === levels - 1 && basement;
    const nRooms = isBase ? R.int(1, 2) : R.int(2, 4);
    const pool = (T.rooms as string[]).filter((k) => k !== "stair_hall");
    for (let i = 0; i < nRooms; i++) {
      const kind = isBase ? R.pick(["storeroom", "cellar_room", ...pool.slice(0, 2)].filter((k) => LOC.rooms[k])) : R.pick(pool);
      const d = LOC.rooms[kind];
      row.push({ kind, w: R.int(d.w[0], d.w[1]) });
    }
    const width = row.reduce((s, r) => s + r.w, 0) + row.length - 1;
    maxW = Math.max(maxW, width);
    plans.push(row);
  }
  const W = maxW + 2;
  const H = levels * 2;
  const grid = new Array(W * H).fill(7);
  const ladders: Record<string, number> = {};
  const site: Site = {
    node: nodeId,
    type,
    theme: theme ?? T.themes[0],
    W,
    H,
    grid,
    ladders,
    rooms: [],
    conts: [],
    doors: [],
    threats: [],
    hazards: [],
    details: [],
    people: [],
    noise: 0,
    exitX: 1,
    exitLv: groundLv,
    clues: [],
    spawned: 0,
    danger,
    rad: !!T.rad,
  };
  const open = (x: number, lv: number) => {
    grid[lv * 2 * W + x] = 0;
    grid[(lv * 2 + 1) * W + x] = 0;
  };
  for (let lv = 0; lv < levels; lv++) {
    let x = 1;
    plans[lv].forEach((p, i) => {
      const d = LOC.rooms[p.kind];
      const isBase = lv === levels - 1 && basement;
      const room: SiteRoom = { id: id("r"), kind: p.kind, name: d.name, x, w: p.w, lv, dark: isBase || R.chance(d.dark ?? 0.25), revealed: false, rad: d.rad ? 1 : 0, stairs: p.kind === "stair_hall" };
      site.rooms.push(room);
      for (let k = 0; k < p.w; k++) open(x + k, lv);
      // containers
      const cs: string[] = [...(d.conts ?? [])];
      R.shuffle(cs);
      const slots = R.shuffle([...Array(p.w).keys()]);
      cs.slice(0, p.w).forEach((ck, j) => {
        const cd = LOC.containers[ck];
        if (!cd) return;
        site.conts.push({ id: id("c"), kind: ck, name: cd.name, x: x + slots[j], lv, size: cd.size, table: cd.table, searched: 0, locked: !!cd.locked && R.chance(0.7), coop: !!cd.coop, cover: cd.cover ?? (d.cover ? "half" : undefined) });
      });
      x += p.w;
      // door column to the next room
      if (i < plans[lv].length - 1) {
        open(x, lv);
        const nextD = LOC.rooms[plans[lv][i + 1].kind];
        const roll = R.next();
        const state: SiteDoor["state"] = R.chance(nextD.locked ?? 0.12) ? "locked" : roll < 0.45 ? "closed" : "open";
        site.doors.push({ id: id("d"), x, lv, state });
        x += 1;
      }
    });
    // stairs: ladder in the stair hall connecting to the level above
    if (lv > 0) ladders[`2,${lv}`] = 1;
  }
  // the entrance
  site.exitX = 1;
  site.exitLv = groundLv;
  // threats
  const nThreats = Math.max(0, R.int(danger - 1, danger + 1));
  const rooms = site.rooms.filter((r) => !(r.lv === groundLv && r.x === 1));
  for (let i = 0; i < nThreats && rooms.length; i++) {
    const r = R.pick(rooms);
    const etype = R.pick(T.threats as string[]);
    const n = etype === "rat" ? R.int(2, 3) : etype === "dog" ? R.int(1, 2) : 1;
    for (let k = 0; k < n; k++) site.threats.push({ id: id("t"), etype, x: r.x + R.int(0, r.w - 1), lv: r.lv, dir: R.chance(0.5) ? 1 : -1, state: R.chance(0.55) ? "asleep" : "patrol", detect: 0, room: r.id });
  }
  // hazards
  for (const r of site.rooms) {
    const d = LOC.rooms[r.kind];
    if (r.stairs) continue;
    if (R.chance(d.hazard ?? 0.15)) {
      const kind = r.rad || site.rad ? (R.chance(0.6) ? "rad" : R.pick(HAZARDS)) : R.pick(HAZARDS.slice(0, 4));
      site.hazards.push({ id: id("h"), kind, x: r.x + R.int(0, r.w - 1), lv: r.lv, known: kind === "glass", armed: true });
    }
  }
  // flavour details (found with R — detailed inspection)
  for (const r of site.rooms) {
    if (r.stairs || !R.chance(0.45)) continue;
    const kind = R.pick(["blood", "scratches", "note", "stash", "photo"] as SiteDetail["kind"][]);
    const texts: Record<string, string[]> = {
      blood: ["Кровавый след тянется к соседней двери.", "Бурые пятна на полу. Свежие?"],
      scratches: ["Глубокие царапины на стене — когти.", "Кто-то отмечал дни чёрточками. Сорок две."],
      note: ["«Ушли на юг. Если найдёте Лиду — скажите, что мы ждём у моста».", "«Не спускайтесь в подвал. Там что-то дышит».", "«Воду брали в колонке у школы. Колонка сломалась»."],
      stash: ["Под отошедшей половицей — тряпичный свёрток."],
      photo: ["Выцветшее фото: семья на фоне трамвая. На обороте — «Новоград, лето»."],
    };
    const det: SiteDetail = { id: id("x"), kind, x: r.x + R.int(0, r.w - 1), lv: r.lv, text: R.pick(texts[kind]), found: false, taken: false };
    if (kind === "stash") det.loot = { [R.pick(["meds", "ammo", "food_can", "batteries"])]: R.int(1, 3) };
    if (kind === "note" && R.chance(0.4)) det.loot = { newspaper: 1 };
    site.details.push(det);
  }
  // the secret: a clue in a "clue" room points at a loose step in the stair hall with a key to a locked safe (or a stash)
  const clueRoom = R.pick(site.rooms.filter((r) => LOC.rooms[r.kind]?.clue) as SiteRoom[]) ?? R.pick(site.rooms.filter((r) => !r.stairs));
  const stair = R.pick(site.rooms.filter((r) => r.stairs));
  if (clueRoom && stair) {
    const safe = site.conts.find((c) => c.locked && c.kind === "safe");
    const keyDet: SiteDetail = { id: id("x"), kind: "loose_step", x: stair.x, lv: stair.lv, text: "Третья ступенька шатается. Под ней — ключ и свёрток.", found: false, taken: false, needsClue: "step", loot: safe ? { key: 1 } : { meds: 2, ammo: 4, seed_strawberry: 1 }, unlocks: safe?.id };
    const lvName = stair.lv === groundLv ? "первого этажа" : stair.lv > groundLv ? "подвала" : `${groundLv - stair.lv + 1}-го этажа`;
    site.details.push({ id: id("x"), kind: "note", x: clueRoom.x + R.int(0, clueRoom.w - 1), lv: clueRoom.lv, text: `Записка: «Ключ от сейфа — под третьей ступенькой лестницы ${lvName}. Никому не говори. — В.»`, found: false, taken: false, clue: "step" });
    site.details.push(keyDet);
    if (safe) safe.guaranteed = ["meds", "meds", "ammo", "parts", "bg_random"];
  }
  // quest items
  if (opts.radioPart) {
    const c = R.pick(site.conts.filter((c) => c.table === "radio" || c.table === "rare" || c.kind === "safe")) ?? R.pick(site.conts);
    if (c) (c.guaranteed ??= []).push("radio_part");
  }
  // people
  if (R.chance(0.45) && type !== "ark") {
    const r = R.pick(site.rooms.filter((x) => !x.stairs));
    // survivors are the most common: sorties are one of the two ways the bunker grows
    const kind = R.pick(["survivor", "survivor", "family", "trader", "wounded", "patrol"] as SitePerson["kind"][]);
    const names = { survivor: "Одинокий выживший", family: "Прячущаяся семья", trader: "Бродячий торговец", wounded: "Раненый", patrol: "Патруль «Порядка»" };
    site.people.push({ id: id("p"), kind, name: names[kind], x: r.x + R.int(0, r.w - 1), lv: r.lv, met: false, gone: false });
  }
  // the entrance room is revealed
  const entry = site.rooms.find((r) => r.lv === groundLv && r.x === 1);
  if (entry) entry.revealed = true;
  return site;
}

export function siteRoomAt(s: Site, x: number, lv: number): SiteRoom | undefined {
  return s.rooms.find((r) => r.lv === lv && x >= r.x && x < r.x + r.w);
}

/** Minimal world-like object so the shared movement code works inside a site. */
export function siteWorld(s: Site): any {
  return { W: s.W, H: s.H, grid: s.grid, ladders: s.ladders, phaseT: 0 };
}

/** Rolls loot from a table. */
export function rollLoot(table: string, R: Rng, rolls: number): Record<string, number> {
  const t: [string, number, [number, number]][] = LOC.loot[table] ?? LOC.loot.base;
  const out: Record<string, number> = {};
  for (let i = 0; i < rolls; i++) {
    const e = R.weighted(t, (x) => x[1]);
    if (!e) continue;
    const n = R.int(e[2][0], e[2][1]);
    out[e[0]] = (out[e[0]] ?? 0) + n;
  }
  return out;
}
