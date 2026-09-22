import roomsJson from "../data/rooms.json";
import type { Obj, RoomInst, World } from "../types";
import { openSlot, slotKey, walkable } from "./grid";

export interface RoomDef {
  name: string;
  w: [number, number];
  cost: Record<string, number>;
  work: number;
  light: boolean;
  objs: [string, number][];
  perW?: boolean;
  perCell?: boolean;
  desc: string;
  comfort: number;
  social?: number;
  entry?: boolean;
  support?: boolean;
  shaft?: boolean;
  power?: number;
  upgrades?: { cost: Record<string, number>; desc: string }[];
}

export const ROOMS = roomsJson as unknown as Record<string, RoomDef>;

export function newId(w: World, prefix: string) {
  return prefix + (w.nextId++).toString(36);
}

export function roomCost(type: string, width: number): Record<string, number> {
  const def = ROOMS[type];
  if (!def) return {};
  const out: Record<string, number> = {};
  for (const k in def.cost) out[k] = def.perCell ? def.cost[k] * width : def.cost[k];
  return out;
}

export function roomAt(w: World, x: number, lv: number): RoomInst | undefined {
  for (const id in w.rooms) {
    const r = w.rooms[id];
    if (r.lv === lv && x >= r.x && x < r.x + r.w) return r;
  }
  return undefined;
}

export function roomsOfType(w: World, type: string, done = true): RoomInst[] {
  const out: RoomInst[] = [];
  for (const id in w.rooms) {
    const r = w.rooms[id];
    if (r.type === type && (!done || r.state === "done")) out.push(r);
  }
  return out;
}

export function objsOfKind(w: World, kind: string): Obj[] {
  const out: Obj[] = [];
  for (const id in w.objs) if (w.objs[id].kind === kind) out.push(w.objs[id]);
  return out;
}

export function objsInRoom(w: World, roomId: string): Obj[] {
  const out: Obj[] = [];
  for (const id in w.objs) if (w.objs[id].room === roomId) out.push(w.objs[id]);
  return out;
}

export function addObj(w: World, kind: string, x: number, lv: number, room?: string, st: Record<string, any> = {}): Obj {
  const o: Obj = { id: newId(w, "o"), kind, x, lv, room, wear: 100, broken: false, on: true, st: { ...defaultObjState(kind), ...st } };
  w.objs[o.id] = o;
  if (kind === "ladder") w.ladders[x + "," + lv] = 1;
  return o;
}

export function defaultObjState(kind: string): Record<string, any> {
  switch (kind) {
    case "hydro_tray":
      return { crop: "", stage: 0, growth: 0, water: 60, nutr: 50, health: 100, pests: 0, mold: 0, pollinated: 0, ready: 0, pruned: 1 };
    case "nutrient_tank":
      return { level: 60, ph: 6.2, npk: 60 };
    case "mushroom_bed":
      return { growth: 0, compost: 0, ready: 0 };
    case "compost":
      return { amount: 2 };
    case "rabbit_hutch":
      return { rabbits: 0, fed: 60, dirty: 0, growth: 0 };
    case "air_filter":
      return { dirt: 0 };
    case "water_filter":
      return { dirt: 0 };
    case "bike_gen":
      return { oil: 100 };
    case "diesel_gen":
      return { running: 0 };
    case "trash_bin":
      return { fill: 0 };
    case "sink":
      return { dishes: 0 };
    case "game_table":
      return { seats: 4 };
    case "radio":
      return {};
    case "door_blast":
      return { closed: 1, barricade: 0 };
    case "turret":
      return { ammo: 20 };
    case "rat_trap":
      return { set: 1, caught: 0 };
    case "geiger":
      return { checked: 0 };
    case "still":
      return { mash: 0, progress: 0 };
    case "drawing_wall":
      return {};
    default:
      return {};
  }
}

/** Places a room instance. If `built`, cells are opened and objects spawned immediately. */
export function placeRoom(w: World, type: string, x: number, lv: number, width: number, built: boolean): RoomInst {
  const r: RoomInst = {
    id: newId(w, "r"),
    type,
    x,
    lv,
    w: width,
    state: built ? "done" : "plan",
    work: 0,
    level: 1,
    dirt: 0,
    fire: 0,
    flood: 0,
    dmg: 0,
    comfort: 50,
    lit: true,
  };
  w.rooms[r.id] = r;
  if (built) {
    for (let i = 0; i < width; i++) openSlot(w, x + i, lv);
    spawnRoomObjects(w, r);
  } else {
    let allOpen = true;
    for (let i = 0; i < width; i++) {
      if (!walkable(w, x + i, lv)) {
        w.marks[slotKey(w, x + i, lv)] = r.id;
        allOpen = false;
      }
    }
    r.state = allOpen ? "frame" : "dig";
  }
  return r;
}

export function spawnRoomObjects(w: World, r: RoomInst) {
  const def = ROOMS[r.type];
  if (!def) return;
  for (const [kind, dx] of def.objs) {
    if (dx >= r.w) continue;
    if (kind === "ladder" && w.ladders[r.x + dx + "," + r.lv]) continue;
    addObj(w, kind, r.x + dx, r.lv, r.id);
  }
}

/** Validates a room placement. Returns error string or null. */
export function canPlaceRoom(w: World, type: string, x: number, lv: number, width: number): string | null {
  const def = ROOMS[type];
  if (!def) return "Неизвестный тип комнаты";
  if (width < def.w[0] || width > def.w[1]) return `Ширина должна быть ${def.w[0]}–${def.w[1]}`;
  if (lv < 0 || lv >= w.H / 2) return "Вне сетки";
  if (x < 1 || x + width > w.W - 1) return "Слишком близко к краю";
  for (let i = 0; i < width; i++) {
    if (roomAt(w, x + i, lv)) return "Место занято другой комнатой";
    if (w.grid[(lv * 2) * w.W + x + i] === 7 || w.grid[(lv * 2 + 1) * w.W + x + i] === 7) return "Коренная порода — не прокопать";
  }
  // must be adjacent to an existing (planned or built) room/corridor, horizontally or via shaft vertically
  let adjacent = false;
  for (let i = -1; i <= width; i++) {
    const cx = x + i;
    if (roomAt(w, cx, lv)) adjacent = true;
  }
  if (def.shaft) {
    if (roomAt(w, x, lv - 1) || roomAt(w, x, lv + 1)) adjacent = true;
  }
  for (let i = 0; i < width && !adjacent; i++) {
    const above = roomAt(w, x + i, lv - 1);
    if (above && above.type === "shaft") adjacent = true;
    const below = roomAt(w, x + i, lv + 1);
    if (below && below.type === "shaft") adjacent = true;
  }
  if (!adjacent) return "Комната должна примыкать к существующей (или к шахте)";
  return null;
}
