import { BAL } from "../data/balance";
import { BAGGAGE, COLORS, GOALS, NAMES_F, NAMES_M, PHOBIAS, PROFS, SURNAMES, TRAITS_MINUS, TRAITS_PLUS } from "../data/characters";
import { hash2, Rng, seedState } from "../rng";
import type { Card, Char, Settings, SkillId, World } from "../types";
import { feetY, GRID_H, GRID_W, T_BEDROCK, T_CLAY, T_CONCRETE, T_GRANITE, T_SOIL, T_STONE, T_WATER } from "./grid";
import { addObj, placeRoom } from "./rooms";

export const DEFAULT_SETTINGS: Settings = {
  dayLength: BAL.defaultDayLength,
  nightLength: BAL.defaultNightLength,
  residents: 6,
  storyteller: "classic",
  short: false,
  traitor: false,
  combatTurnTime: 20,
  tableTurnTime: 30,
  tableLeave: "bot",
  skipPrologue: false,
  botInitiative: true,
};

export function createWorld(code: string, seed: number, settings: Partial<Settings> = {}): World {
  const w: World = {
    v: 1,
    code,
    seed,
    rng: seedState(seed),
    settings: { ...DEFAULT_SETTINGS, ...settings },
    phase: "lobby",
    phaseT: 0,
    day: 1,
    hour: BAL.dayStartHour,
    speed: 1,
    paused: false,
    W: GRID_W,
    H: GRID_H,
    grid: [],
    dig: {},
    marks: {},
    finds: {},
    found: {},
    ladders: {},
    rooms: {},
    objs: {},
    items: {},
    chars: {},
    players: {},
    res: {},
    power: { battery: 2, cap: BAL.batteryCap, gen: 0, use: 0, demand: 0, prio: ["air", "water", "hydro", "light", "kitchen", "radio", "defense", "work", "comfort"], off: [] },
    air: { co2: 0, filterOffT: 0 },
    chores: {},
    council: null,
    vote: null,
    flags: {},
    timers: [],
    log: [],
    gazette: [],
    stats: emptyStats(),
    director: { tension: 0, quiet: 0, lastRaidDay: 0, raidWarn: 0 },
    notice: 5,
    pet: null,
    elder: null,
    nextId: 1,
    archive: [],
    unread: [],
    tapes: [],
    books: ["handbook_electric", "poems"],
    films: [],
    games: ["cards36"],
    recipes: ["cold_can"],
    tech: [],
    research: null,
    factions: { order: 0, caravan: 10, flash: -10, ratking: -20 },
    canvas: "",
    radio: { station: 0, on: false, freq: 88 },
    mods: {},
    ending: null,
    temp: 0,
    weather: { today: "ash", forecast: ["ash", "clear"] },
    history: [],
  };
  genTerrain(w);
  buildStartBunker(w);
  return w;
}

export function emptyStats() {
  return { dug: {}, harvest: {}, chores: {}, cooked: {}, events: [], deaths: [], wins: {}, ate: {} };
}

export function genTerrain(w: World) {
  const s = w.seed >>> 0;
  const grid: number[] = new Array(w.W * w.H);
  for (let y = 0; y < w.H; y++) {
    for (let x = 0; x < w.W; x++) {
      let t: number;
      const n = hash2(s, x >> 2, y >> 1) * 0.6 + hash2(s + 7, x, y) * 0.4;
      const d = y + (hash2(s + 3, x >> 3, 0) - 0.5) * 4; // wavy strata
      if (d < 6) t = n < 0.8 ? T_SOIL : T_CLAY;
      else if (d < 12) t = n < 0.5 ? T_CLAY : n < 0.85 ? T_SOIL : T_STONE;
      else if (d < 20) t = n < 0.25 ? T_CLAY : n < 0.85 ? T_STONE : T_GRANITE;
      else if (d < 27) t = n < 0.6 ? T_STONE : T_GRANITE;
      else t = n < 0.3 ? T_STONE : T_GRANITE;
      if (x === 0 || x === w.W - 1 || y === w.H - 1) t = T_BEDROCK;
      grid[y * w.W + x] = t;
    }
  }
  w.grid = grid;
  const rng = new Rng(seedState(s ^ 0x5eed));
  // water pockets (aquifers)
  for (let i = 0; i < 5; i++) {
    const cx = rng.int(3, w.W - 5);
    const cy = rng.int(8, w.H - 6);
    const rw = rng.int(2, 4);
    for (let dx = 0; dx < rw; dx++) for (let dy = 0; dy < 2; dy++) grid[(cy + dy) * w.W + cx + dx] = T_WATER;
  }
  // old concrete patches near the bunker
  for (let i = 0; i < 3; i++) {
    const cx = rng.int(8, w.W - 10);
    const cy = rng.int(2, 10);
    for (let dx = 0; dx < rng.int(2, 4); dx++) grid[cy * w.W + cx + dx] = T_CONCRETE;
  }
  // finds: slot key → find id. Placed away from the starting bunker.
  const findList: [string, number, number][] = [
    ["cache", 2, 8],
    ["cache", 3, 12],
    ["stream", 3, 9],
    ["mushroom_cave", 2, 10],
    ["metro", 4, 7],
    ["bones", 1, 10],
    ["bones", 4, 12],
    ["ai_capsule", 7, 13],
    ["rad_pocket", 5, 12],
    ["nest", 6, 13],
    ["thermal", 8, 14],
    ["metal", 3, 12],
    ["metal", 6, 13],
    ["newspaper_bundle", 1, 6],
    ["boardgame_box", 2, 9],
  ];
  for (const [id, minLv, maxLv] of findList) {
    for (let tries = 0; tries < 30; tries++) {
      const lv = rng.int(minLv, Math.min(maxLv, w.H / 2 - 2));
      const x = rng.int(2, w.W - 3);
      if (lv <= 1 && x > 12 && x < 34) continue; // keep away from start bunker
      const key = String((lv + 1) * w.W + x);
      if (w.finds[key]) continue;
      w.finds[key] = id;
      break;
    }
  }
}

export function buildStartBunker(w: World) {
  // Level 0: Кладовая | Шлюз | Столовая      Level 1: Жилой | Техотсек | Гидропоника
  const storage = placeRoom(w, "storage", 17, 0, 3, true);
  const airlock = placeRoom(w, "airlock", 20, 0, 4, true);
  const mess = placeRoom(w, "mess", 24, 0, 8, true);
  placeRoom(w, "living", 12, 1, 8, true);
  const tech = placeRoom(w, "tech", 20, 1, 5, true);
  const hydro = placeRoom(w, "hydro", 25, 1, 4, true);
  void storage;
  void mess;
  // Ladder Шлюз → Техотсек
  addObj(w, "ladder", 23, 1, tech.id);
  // Starting kitchen corner in the mess hall: a small stove
  addObj(w, "stove", 30, 0, mess.id);
  addObj(w, "trash_bin", 31, 0, mess.id);
  addObj(w, "bookshelf", 16 + 3, 1, undefined);
  addObj(w, "periscope", 22, 0, airlock.id);
  for (const id in w.rooms) w.rooms[id].sturdy = true;
  // start with two planted trays
  const trays = Object.values(w.objs).filter((o) => o.kind === "hydro_tray" && o.room === hydro.id);
  // the previous owners left a working garden: harvests start on day 1–2
  if (trays[0]) Object.assign(trays[0].st, { crop: "potato", stage: 3, growth: 0.7 });
  if (trays[1]) Object.assign(trays[1].st, { crop: "lettuce", stage: 3, growth: 0.6 });
  if (trays[2]) Object.assign(trays[2].st, { crop: "carrot", stage: 2, growth: 0.35 });
  w.res = { ...BAL.startRes, seed_lettuce: 2, seed_potato: 2, seed_tomato: 1, seed_herbs: 1, spores: 1, shovel: 2, extinguisher: 1, flashlight: 1 };
}

export function makeCard(rng: Rng, taken: Set<string> = new Set(), allowHostile = false): Card {
  const gender = rng.chance(0.5) ? 0 : 1;
  const first = rng.pick(gender === 0 ? NAMES_M : NAMES_F);
  let sur = rng.pick(SURNAMES);
  if (gender === 1) sur = feminize(sur);
  const allProfs = Object.keys(PROFS).filter((p) => !PROFS[p].npcOnly);
  const profKeys = allProfs.filter((p) => !taken.has(p));
  const prof = rng.pick(profKeys.length ? profKeys : allProfs);
  const goals = Object.keys(GOALS).filter((g) => allowHostile || !GOALS[g].hostile);
  const stats = { sil: rng.int(1, 4), lov: rng.int(1, 4), int: rng.int(1, 4), vyn: rng.int(1, 4), har: rng.int(1, 4) };
  const pd = PROFS[prof];
  stats[pd.stat] = Math.min(5, stats[pd.stat] + 1);
  return {
    name: `${first} ${sur}`,
    prof,
    plus: rng.pick(Object.keys(TRAITS_PLUS)),
    minus: rng.pick(Object.keys(TRAITS_MINUS)),
    goal: rng.pick(goals.filter((g) => g !== "saboteur")),
    stats,
    color: rng.pick(COLORS),
    hat: pd.hat,
    gender,
    age: rng.int(19, 67),
    phobia: rng.pick(PHOBIAS),
    baggage: rng.pick(BAGGAGE),
    birthday: rng.int(3, 38),
  };
}

function feminize(s: string) {
  if (s.endsWith("ов") || s.endsWith("ев") || s.endsWith("ин") || s.endsWith("ёв")) return s + "а";
  if (s.endsWith("ый") || s.endsWith("ий")) return s.slice(0, -2) + "ая";
  return s;
}

export function createChar(w: World, card: Card, x: number, lv: number): Char {
  const id = "c" + (w.nextId++).toString(36);
  const skills: Record<SkillId, number> = { repair: 0, medicine: 0, cooking: 0, shooting: 0, melee: 0, digging: 0, radio: 0, stealth: 0 };
  skills[PROFS[card.prof]?.skill ?? "repair"] = 40;
  const c: Char = {
    id,
    card,
    needs: { food: 80, water: 80, energy: 90, sanity: 80, health: 100, rad: 0 },
    skills,
    x: x + 0.5,
    y: feetY(lv),
    lv,
    dir: 1,
    mx: 0,
    my: 0,
    run: false,
    climbing: false,
    task: null,
    hands: [],
    stash: {},
    ctrl: null,
    mind: { plan: "idle", thought: "Осматриваюсь", barkCd: 5, idleT: 0, stuckT: 0, talkCd: 10 },
    status: "ok",
    downT: 0,
    breakT: 0,
    anim: "idle",
    bark: null,
    rel: {},
    slept: false,
    meal: 0,
    seq: 0,
    emote: null,
    drunk: 0,
    sick: 0,
    injury: null,
    legacy: 0,
    npc: false,
  };
  w.chars[id] = c;
  return c;
}

export function residentCards(w: World, n: number): Card[] {
  const rng = new Rng(w.rng);
  const taken = new Set<string>();
  const out: Card[] = [];
  for (let i = 0; i < n; i++) {
    const c = makeCard(rng, taken);
    taken.add(c.prof);
    out.push(c);
  }
  return out;
}
