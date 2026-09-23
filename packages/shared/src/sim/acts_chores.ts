import { ITEMS } from "../data/items";
import type { World } from "../types";
import { ROOMS } from "../world/rooms";
import { defAction, emitWork } from "./actions";
import { extraChoreHooks } from "./chores";
import { spawnItem } from "./items";
import { onTick } from "./tick";
import { timeMult } from "./time";
import { nightHooks } from "./time";
import { clamp, hasTrait, firstName, hoursPerSec, log, rng, homeChars } from "./util";
import { igniteRoom } from "./systems";

// ---------------------------------------------------------------- incident chores (set by day events)

function roomFlagAction(id: string, flag: string, label: string, dur: number, cost: Record<string, number>, onDone?: (w: World, roomId: string) => void) {
  defAction({
    id,
    type: "room",
    prio: 9,
    avail: ({ w, t }) => {
      if (!w.flags[flag + t.id]) return null;
      for (const k in cost) if ((w.res[k] ?? 0) < cost[k]) return { label, reason: `Нужно: ${Object.keys(cost).map((x) => ITEMS[x]?.name ?? x).join(", ")}` };
      return label;
    },
    dur: () => dur,
    anim: "repair",
    skill: "repair",
    chore: id,
    sanity: 1,
    done: ({ w, t, c }) => {
      delete w.flags[flag + t.id];
      for (const k in cost) w.res[k] = Math.max(0, (w.res[k] ?? 0) - cost[k]);
      onDone?.(w, t.id);
      emitWork(w, c, "Готово", "#8fcf6a");
    },
  });
}

roomFlagAction("fix_leak", "_leak_", "💧 Заварить протечку", 15, { scrap: 1 }, (w, id) => {
  const r = w.rooms[id];
  if (r) r.flood = Math.max(0, r.flood - 10);
});
roomFlagAction("fix_wiring", "_wiring_", "⚡ Починить искрящую проводку", 12, { parts: 1 });
roomFlagAction("replace_bulb", "_bulb_", "💡 Заменить лампу", 6, {});

// leaks keep flooding, sparking wiring may start a fire
onTick("incidents", "day", (w, dt) => {
  const hours = dt * hoursPerSec(w) * timeMult(w);
  const R = rng(w);
  for (const k in w.flags) {
    if (k.startsWith("_leak_")) {
      const r = w.rooms[k.slice(6)];
      if (!r) delete w.flags[k];
      else r.flood = clamp(r.flood + 6 * hours);
    } else if (k.startsWith("_wiring_")) {
      const r = w.rooms[k.slice(8)];
      if (!r) delete w.flags[k];
      else if (R.chance(0.06 * hours)) {
        igniteRoom(w, r, 20);
        delete w.flags[k];
      }
    } else if (k.startsWith("_bulb_")) {
      const r = w.rooms[k.slice(6)];
      if (!r) delete w.flags[k];
      else r.lit = false;
    }
  }
});

extraChoreHooks.push((w, add) => {
  for (const k in w.flags) {
    if (k.startsWith("_leak_")) add({ kind: "fix_leak", room: k.slice(6), urgency: 0.8 });
    else if (k.startsWith("_wiring_")) add({ kind: "fix_wiring", room: k.slice(8), urgency: 0.75 });
    else if (k.startsWith("_bulb_")) add({ kind: "replace_bulb", room: k.slice(6), urgency: 0.4 });
  }
});

// ---------------------------------------------------------------- periodic household chores

function periodic(id: string, kinds: string[], flag: string, every: number, label: string, dur: number, done: (w: World, c: any) => void, cost: Record<string, number> = {}, urgency = 0.3) {
  defAction({
    id,
    type: "obj",
    kinds,
    prio: 35,
    avail: ({ w }) => {
      if (w.day - (w.flags[flag] ?? 0) < every) return null;
      for (const k in cost) if ((w.res[k] ?? 0) < cost[k]) return { label, reason: `Нужно: ${ITEMS[k]?.name ?? k}` };
      return label;
    },
    dur: () => dur,
    anim: "work",
    skill: "cooking",
    chore: id,
    sanity: 2,
    done: ({ w, c }) => {
      w.flags[flag] = w.day;
      for (const k in cost) w.res[k] = Math.max(0, (w.res[k] ?? 0) - cost[k]);
      done(w, c);
    },
  });
  extraChoreHooks.push((w, add) => {
    if (w.day - (w.flags[flag] ?? 0) < every || w.hour < 9) return;
    const o = Object.values(w.objs).find((x) => kinds.includes(x.kind));
    if (o) add({ kind: id, obj: o.id, urgency });
  });
}

periodic("laundry", ["washtub", "sink"], "laundry_day", 2, "👕 Постирать бельё", 18, (w, c) => {
  for (const x of homeChars(w)) x.needs.sanity = clamp(x.needs.sanity + 2);
  emitWork(w, c, "Чистое бельё!", "#8fcf6a");
}, {}, 0.3);

periodic("mend_clothes", ["bed", "workbench"], "mend_day", 4, "🪡 Починить одежду и снаряжение", 14, (w) => {
  w.flags.mended = w.day;
}, { cloth: 1 }, 0.25);

periodic("set_rat_traps", ["shelf", "trash_bin"], "traps_day", 3, "🐀 Расставить крысоловки", 8, (w, c) => {
  if (rng(w).chance(0.45)) {
    spawnItem(w, "rat", 1, c.x + 0.4, c.lv);
    emitWork(w, c, "🐀 Попалась!", "#e8c14a");
  }
}, {}, 0.25);

periodic("inventory", ["shelf"], "inventory_day", 2, "📋 Учёт склада", 15, (w, c) => {
  w.flags.sort_day = w.day;
  log(w, `📋 ${firstName(c)} провёл(а) учёт склада. Испорченное отложено.`, "info");
}, {}, 0.2);

periodic("sort_food", ["shelf"], "sort_day", 2, "🥴 Перебрать продукты", 10, (w) => {
  w.flags.sort_day = w.day;
}, {}, 0.3);

// laundry neglect & morning chores
nightHooks.dayStart.push((w) => {
  if (w.day - (w.flags.laundry_day ?? 0) >= 4) {
    for (const c of homeChars(w)) c.needs.sanity = clamp(c.needs.sanity - 3);
    log(w, "Одежда грязная уже несколько дней. Настроение хуже.", "bad");
  }
  if (w.day - (w.flags.mend_day ?? 0) >= 8 && w.flags.winter) for (const c of homeChars(w)) c.sick = clamp(c.sick + 5);
});

// ---------------------------------------------------------------- nursing & medicine

defAction({
  id: "nurse",
  type: "char",
  prio: 8,
  avail: ({ w, t }) => {
    const x = w.chars[t.id];
    if (!x || x.status === "dead" || (x.sick < 15 && !x.injury && x.needs.rad < 40)) return null;
    const what = x.injury ? "перевязать" : x.sick >= 15 ? "лечить" : "дать антирад";
    if ((w.res.meds ?? 0) < 0.5 && (w.res.radpills ?? 0) < 1) return { label: `🩺 ${what} ${firstName(x)}`, reason: "Нет медикаментов" };
    return `🩺 ${what} ${firstName(x)}`;
  },
  dur: () => 12,
  anim: "work",
  skill: "medicine",
  xp: 5,
  chore: "nurse",
  done: ({ w, c, t }) => {
    const x = w.chars[t.id];
    if (!x) return;
    const bonus = (c.card.prof === "doctor" ? 2 : 1) * (hasTrait(c, "medic") ? 1.5 : 1);
    if (x.needs.rad >= 40 && (w.res.radpills ?? 0) >= 1) {
      w.res.radpills -= 1;
      x.needs.rad = clamp(x.needs.rad - 40 * bonus);
    } else {
      w.res.meds = Math.max(0, (w.res.meds ?? 0) - 0.5);
      x.sick = clamp(x.sick - 35 * bonus);
      if (x.injury && rng(w).chance(0.5 * bonus)) x.injury = null;
      x.needs.rad = clamp(x.needs.rad - 10 * bonus);
    }
    x.needs.health = clamp(x.needs.health + 10 * (hasTrait(c, "medic") ? 1.5 : 1));
    x.rel[c.id] = (x.rel[c.id] ?? 0) + 5;
  },
});

extraChoreHooks.push((w, add) => {
  for (const c of homeChars(w)) if (c.status !== "dead" && (c.sick >= 20 || c.injury || c.needs.rad >= 50)) add({ kind: "nurse", char: c.id, urgency: 0.6 });
});

// sickness spreads a little and slowly heals by itself
onTick("sickness", "day", (w, dt) => {
  const hours = dt * hoursPerSec(w) * timeMult(w);
  const R = rng(w);
  const dirtyRooms = Object.values(w.rooms).filter((r) => r.dirt > 60).length;
  for (const c of homeChars(w)) {
    if (c.sick > 0) c.sick = clamp(c.sick - 1.5 * hours);
    if (c.sick <= 0 && R.chance((0.004 + dirtyRooms * 0.002) * hours)) c.sick = 15;
    if (c.sick > 30) {
      for (const o of homeChars(w)) if (o.id !== c.id && o.lv === c.lv && Math.abs(o.x - c.x) < 2 && R.chance(0.01 * hours)) o.sick = clamp(o.sick + 10);
    }
  }
});

// ---------------------------------------------------------------- personal stash (hidden goal "Чёрный день")

defAction({
  id: "stash",
  type: "obj",
  kinds: ["shelf"],
  prio: 95,
  avail: ({ w, c }) => (c.ctrl && (w.res.food_can ?? 0) >= 1 ? "🤫 Припрятать консерву в личный тайник" : null),
  dur: () => 4,
  anim: "work",
  done: ({ w, c }) => {
    if ((w.res.food_can ?? 0) < 1) return;
    w.res.food_can -= 1;
    c.stash.food_can = (c.stash.food_can ?? 0) + 1;
  },
});

defAction({
  id: "unstash",
  type: "obj",
  kinds: ["shelf"],
  prio: 96,
  avail: ({ c }) => (c.ctrl && (c.stash.food_can ?? 0) >= 1 ? `🥫 Съесть консерву из тайника (${c.stash.food_can})` : null),
  dur: () => 5,
  anim: "eat",
  done: ({ c }) => {
    c.stash.food_can -= 1;
    c.needs.food = clamp(c.needs.food + 40);
  },
});

export { ROOMS };
