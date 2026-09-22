import { ITEMS } from "../data/items";
import type { Chore, World } from "../types";
import { walkable, unnode, slotAccess } from "../world/grid";
import { ROOMS, roomCost } from "../world/rooms";
import { CHORE_DEFS, completeChore } from "./actions";
import { registerCmd } from "./commands";
import { CROPS, seedItem } from "./hydro";
import { hasRes, isStorable } from "./items";
import { onTick } from "./tick";
import { homeChars } from "./util";

/** Chore kind → action id used to perform it. */
export const CHORE_ACTION: Record<string, string> = {
  clean_air_filter: "clean_air_filter",
  flush_water_filter: "flush_water_filter",
  oil_generator: "oil_generator",
  repair: "repair",
  clean_room: "clean_room",
  take_out_trash: "take_trash",
  feed_rabbits: "feed_rabbits",
  clean_hutch: "clean_hutch",
  check_geiger: "check_geiger",
  periscope_watch: "periscope",
  charge_batteries: "check_battery",
  reinforce: "reinforce",
  dry_room: "dry_room",
  extinguish: "extinguish",
  water_plants: "water_plants",
  mix_solution: "mix_solution",
  pollinate: "pollinate",
  prune: "prune",
  treat_pests: "treat_pests",
  harvest: "harvest",
  plant: "plant",
  clean_pipes: "clean_pipes",
  mushrooms: "mushrooms",
  compost: "turn_compost",
  pedal: "pedal",
  pump_water: "pump",
  dig: "dig",
  build_frame: "build_frame",
  cook: "cook",
  wash_dishes: "wash_dishes",
  laundry: "laundry",
  mend_clothes: "mend_clothes",
  set_rat_traps: "set_rat_traps",
  inventory: "inventory",
  sort_food: "sort_food",
  nurse: "nurse",
  feed_pet: "feed_pet",
  fix_leak: "fix_leak",
  fix_wiring: "fix_wiring",
  replace_bulb: "replace_bulb",
};

type Want = Omit<Chore, "id" | "created" | "by">;

/** Recomputes the set of needed chores from world state. */
export function refreshChores(w: World) {
  const want = new Map<string, Want>();
  const add = (c: Want) => {
    const key = `${c.kind}:${c.obj ?? c.room ?? c.item ?? c.cell ?? ""}`;
    want.set(key, c);
  };
  const people = homeChars(w).length || 1;
  for (const id in w.objs) {
    const o = w.objs[id];
    const s = o.st;
    if (o.broken) add({ kind: "repair", obj: id, urgency: o.kind === "air_filter" || o.kind === "water_filter" ? 0.95 : 0.8 });
    else if (o.wear < 35 && ["bike_gen", "air_filter", "water_filter", "diesel_gen", "stove", "hand_pump"].includes(o.kind)) add({ kind: "repair", obj: id, urgency: 0.35 });
    switch (o.kind) {
      case "air_filter":
        if ((s.dirt ?? 0) > 40) add({ kind: "clean_air_filter", obj: id, urgency: Math.min(1, s.dirt / 90) });
        break;
      case "water_filter":
        if ((s.dirt ?? 0) > 40) add({ kind: "flush_water_filter", obj: id, urgency: Math.min(1, s.dirt / 100) });
        break;
      case "bike_gen":
        if ((s.oil ?? 100) < 55) add({ kind: "oil_generator", obj: id, urgency: 0.4 });
        break;
      case "trash_bin":
        if ((s.fill ?? 0) > 60) add({ kind: "take_out_trash", obj: id, urgency: 0.35 });
        break;
      case "battery":
        if (o.wear < 60) add({ kind: "charge_batteries", obj: id, urgency: 0.25 });
        break;
      case "geiger":
        if ((w.flags.geiger_day ?? 0) < w.day && w.hour > 8) add({ kind: "check_geiger", obj: id, urgency: 0.15 });
        break;
      case "periscope":
        if ((w.flags.periscope_day ?? 0) < w.day && w.hour > 10) add({ kind: "periscope_watch", obj: id, urgency: w.director.raidWarn ? 0.7 : 0.2 });
        break;
      case "hydro_tray": {
        if (!s.crop) {
          if (Object.keys(CROPS).some((k) => (w.res[seedItem(k)] ?? 0) >= 1)) add({ kind: "plant", obj: id, urgency: 0.55 });
          break;
        }
        const cd = CROPS[s.crop];
        if (s.ready) add({ kind: "harvest", obj: id, urgency: 0.75 });
        if (s.water < 40) add({ kind: "water_plants", obj: id, urgency: s.water < 15 ? 0.85 : 0.5 });
        if (s.pests >= 15 || s.mold >= 15) add({ kind: "treat_pests", obj: id, urgency: 0.8 });
        if (cd?.pollinate && !s.pollinated && s.growth >= 0.5) add({ kind: "pollinate", obj: id, urgency: 0.6 });
        if (cd?.prune && (s.pruned ?? 1) <= 0.5) add({ kind: "prune", obj: id, urgency: 0.35 });
        break;
      }
      case "nutrient_tank":
        if ((s.level ?? 0) < 45) add({ kind: "mix_solution", obj: id, urgency: s.level < 15 ? 0.8 : 0.45 });
        if (o.wear < 60) add({ kind: "clean_pipes", obj: id, urgency: 0.3 });
        break;
      case "mushroom_bed":
        if (s.ready || (!s.planted && (w.res.spores ?? 0) >= 1) || (s.planted && (s.compost ?? 0) < 0.5 && (w.res.compost ?? 0) >= 1)) add({ kind: "mushrooms", obj: id, urgency: 0.45 });
        break;
      case "compost":
        if ((s.amount ?? 0) >= 2) add({ kind: "compost", obj: id, urgency: 0.25 });
        break;
      case "rabbit_hutch":
        if (s.rabbits && s.fed < 50) add({ kind: "feed_rabbits", obj: id, urgency: 0.6 });
        if (s.rabbits && s.dirty > 55) add({ kind: "clean_hutch", obj: id, urgency: 0.35 });
        break;
      case "sink":
        if ((w.flags._dishes ?? 0) >= 6) add({ kind: "wash_dishes", obj: id, urgency: 0.3 });
        break;
    }
  }
  for (const id in w.rooms) {
    const r = w.rooms[id];
    if (r.fire > 0) add({ kind: "extinguish", room: id, urgency: 1 });
    if (r.state === "done" && r.dirt > 40) add({ kind: "clean_room", room: id, urgency: Math.min(0.7, r.dirt / 120) });
    if (r.flood > 10) add({ kind: "dry_room", room: id, urgency: 0.6 });
    if (r.state === "done" && (r.dmg > 30 || w.flags["_crack_" + id])) add({ kind: "reinforce", room: id, urgency: w.flags["_crack_" + id] ? 0.95 : 0.5 });
    if (r.state === "frame" && ((r as any).paid || hasRes(w, roomCost(r.type, r.w)))) add({ kind: "build_frame", room: id, urgency: 0.5 });
  }
  for (const id in w.items) {
    const it = w.items[id];
    const d = ITEMS[it.item];
    if (it.item === "dirt" || it.item === "trash") add({ kind: "haul", item: id, urgency: 0.42 });
    else if (isStorable(it.item)) add({ kind: "haul", item: id, urgency: d?.cat === "food" ? 0.6 : 0.45 });
  }
  for (const key in w.marks) {
    const [x, lv] = unnode(w, Number(key));
    if (walkable(w, x, lv)) continue;
    if (!slotAccess(w, x, lv)) continue;
    add({ kind: "dig", cell: Number(key), urgency: 0.4 });
  }
  // power: somebody should pedal when the battery is low
  const p = w.power;
  const frac = p.cap > 0 ? p.battery / p.cap : 1;
  // …and top the battery up in the evening so the air filter survives the night
  if ((p.gen < p.demand && frac < 0.6) || (w.hour > 15 && frac < 0.9 && p.gen < p.demand + 0.3)) {
    for (const id in w.objs) {
      const o = w.objs[id];
      if (o.kind === "bike_gen" && !o.broken) add({ kind: "pedal", obj: id, urgency: Math.min(1, 0.4 + (0.6 - frac)) });
    }
  }
  // water supply
  if ((w.res.water_dirty ?? 0) < 4 && (w.res.water ?? 0) < people * 3) {
    for (const id in w.objs) if (w.objs[id].kind === "hand_pump" && !w.objs[id].broken) add({ kind: "pump_water", obj: id, urgency: (w.res.water ?? 0) < people ? 0.85 : 0.45 });
  }
  extraChoreHooks.forEach((h) => h(w, add));

  // merge with existing (keep reservations)
  const next: Record<string, Chore> = {};
  for (const [key, c] of want) {
    const old = w.chores[key];
    if (old) {
      old.urgency = c.urgency;
      next[key] = old;
    } else next[key] = { ...c, id: key, created: w.day * 100 + w.hour };
  }
  // drop reservations of characters that no longer do it
  for (const key in next) {
    const ch = next[key];
    if (ch.by) {
      const c = w.chars[ch.by];
      if (!c || c.status !== "ok" || c.mind.chore !== key) ch.by = undefined;
    }
  }
  w.chores = next;
}

export const extraChoreHooks: ((w: World, add: (c: Want) => void) => void)[] = [];

onTick("chores", "day", (w, dt) => {
  w.flags._choreAcc = (w.flags._choreAcc ?? 0) + dt;
  if (w.flags._choreAcc < 1) return;
  w.flags._choreAcc = 0;
  refreshChores(w);
});

// Player pins a chore to themselves or marks it as priority
registerCmd("pinChore", (w, p, cmd) => {
  const ch = w.chores[String(cmd.id)];
  if (!ch) return "Дело уже сделано";
  if (cmd.prio) {
    ch.prio = !ch.prio;
    return;
  }
  ch.pinnedBy = ch.pinnedBy === p.id ? undefined : p.id;
});

registerCmd("help", (w, p) => {
  // "Помоги!" ping: nearest free bot comes to help with whatever the player is doing
  const me = p.char ? w.chars[p.char] : undefined;
  if (!me) return;
  (w.mods as any)._helpReq = { char: me.id, t: 20 };
});

export function choreName(kind: string) {
  return CHORE_DEFS[kind]?.name ?? kind;
}

export { completeChore, ROOMS };
