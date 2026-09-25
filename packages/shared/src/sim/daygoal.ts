// «Цель дня» (#30): one concrete goal each morning, taken from the colony's worst shortage, so a short
// session always has a clear first step. Done → experience for everyone and a line in tomorrow's paper;
// several days in a row → a streak that lifts spirits.
import { ROOMS, objsOfKind, roomCost, roomsOfType } from "../world/rooms";
import type { World } from "../types";
import { foodUnits, missingText } from "./items";
import { neededRoom } from "./foreman";
import { grantXp } from "./progress";
import { onTick } from "./tick";
import { nightHooks } from "./time";
import { clamp, fx, log } from "./util";

export interface DayGoal {
  day: number;
  kind: "water" | "food" | "power" | "materials" | "room" | "calm";
  text: string;
  hint: string;
  /** numbers the check compares against */
  target?: Record<string, number>;
  room?: string;
  done?: boolean;
  failed?: boolean;
  progress?: string;
  obj?: string;
}

function people(w: World) {
  return Math.max(1, Object.values(w.chars).filter((c) => c.status !== "dead" && c.status !== "away").length);
}

/** News for the next «Вестник»: read by makeGazette. */
export function newsLine(w: World, text: string) {
  ((w.mods as any)._newsLines ??= []).push(text);
}

export function pickGoal(w: World): DayGoal {
  const n = people(w);
  const day = w.day;
  const water = w.res.water ?? 0;
  const food = foodUnits(w);
  const cap = w.power.cap || 1;
  if (water < n * 2 * 1.5) {
    const t = Math.ceil(Math.max(water + n * 2, n * 4));
    return { day, kind: "water", text: `Запас воды ${t} л к вечеру`, hint: "Качайте насос и держите фильтр воды чистым и под током. Смена на насосе — в совете.", target: { water: t }, obj: objsOfKind(w, "hand_pump")[0]?.id };
  }
  if (food < n * 3) {
    const t = Math.ceil(food + n);
    return { day, kind: "food", text: `Еды на ${(t / n).toFixed(1)} дн. к вечеру`, hint: "Урожай, грибы, вылазка в магазин или на ферму.", target: { food: t }, obj: objsOfKind(w, "sortie_terminal")[0]?.id };
  }
  if ((w.flags._demAvg ?? w.power.demand) > w.power.gen && w.power.battery / cap < 0.8) {
    return { day, kind: "power", text: "Заряд выше 40% в 18:00", hint: "Крутите велогенератор днём, лишний свет и лампы — выключить. Смены на генераторе — в совете.", target: { frac: 0.4 }, obj: objsOfKind(w, "bike_gen")[0]?.id };
  }
  // a marked room that waits for materials
  const waiting = Object.values(w.rooms).find((r) => r.state !== "done" && !(r as any).paid && missingText(w, roomCost(r.type, r.w)));
  if (waiting) {
    const cost = roomCost(waiting.type, waiting.w);
    const target: Record<string, number> = {};
    for (const k in cost) if ((w.res[k] ?? 0) < cost[k]) target[k] = cost[k];
    const what = Object.keys(target).map((k) => `${k === "scrap" ? "металлолом" : k === "wood" ? "дерево" : k === "parts" ? "детали" : k === "chem" ? "химия" : k === "cloth" ? "ткань" : k} ${target[k]}`).join(", ");
    return { day, kind: "materials", text: `Материалы для «${ROOMS[waiting.type]?.name}»: ${what}`, hint: "Вылазка в школу, гараж или магазин, разбор мусора на верстаке.", target, room: waiting.id };
  }
  const need = neededRoom(w);
  if (need) {
    return { day, kind: "room", text: `Разметить: ${ROOMS[need.type]?.name}`, hint: `${need.why[0].toUpperCase()}${need.why.slice(1)}. Режим стройки — B.`, target: { rooms: roomsOfType(w, need.type).length + 1 }, room: need.type };
  }
  return { day, kind: "calm", text: "День без падений и смертей", hint: "Следите за едой, водой и ранеными до 20:00." };
}

function check(w: World, g: DayGoal): { done: boolean; progress?: string } {
  const t = g.target ?? {};
  switch (g.kind) {
    case "water": {
      const v = Math.floor(w.res.water ?? 0);
      return { done: v >= t.water, progress: `${v} / ${t.water} л` };
    }
    case "food": {
      const v = foodUnits(w);
      return { done: v >= t.food, progress: `${v.toFixed(1)} / ${t.food}` };
    }
    case "power": {
      const f = w.power.battery / (w.power.cap || 1);
      return { done: w.hour >= 18 && f >= t.frac, progress: `заряд ${Math.round(f * 100)}%` };
    }
    case "materials": {
      const left = Object.keys(t).filter((k) => (w.res[k] ?? 0) < t[k]);
      const r = g.room ? w.rooms[g.room] : undefined;
      return { done: !left.length || !r || !!(r as any).paid || r.state === "done", progress: left.map((k) => `${k === "scrap" ? "металлолом" : k === "wood" ? "дерево" : k} ${Math.floor(w.res[k] ?? 0)}/${t[k]}`).join(", ") };
    }
    case "room": {
      const v = Object.values(w.rooms).filter((r) => r.type === g.room).length;
      return { done: v >= t.rooms };
    }
    default:
      return { done: w.hour >= 20 && (w.flags._downDay ?? -1) !== w.day && (w.flags._deathDay ?? -1) !== w.day };
  }
}

function goal(w: World): DayGoal | undefined {
  return (w.mods as any).dayGoal;
}

nightHooks.dayStart.push((w) => {
  (w.mods as any).dayGoal = pickGoal(w);
});

nightHooks.start.push((w) => {
  const g = goal(w);
  if (!g || g.done) return;
  g.failed = true;
  w.flags._goalStreak = 0;
  newsLine(w, `🎯 Цель дня не взята: «${g.text}».`);
});

onTick("daygoal", "day", (w, dt) => {
  if (w.phase !== "day") return;
  w.flags._goalT = (w.flags._goalT ?? 0) + dt;
  if (w.flags._goalT < 2) return;
  w.flags._goalT = 0;
  let g = goal(w);
  if (!g || g.day !== w.day) g = (w.mods as any).dayGoal = pickGoal(w);
  if (g.done || g.failed) return;
  const r = check(w, g);
  g.progress = r.progress;
  if (!r.done) return;
  g.done = true;
  const streak = (w.flags._goalStreak = (w.flags._goalStreak ?? 0) + 1);
  for (const c of Object.values(w.chars)) if (c.status !== "dead") grantXp(c, 8);
  if (streak >= 3) for (const c of Object.values(w.chars)) if (c.status !== "dead") c.needs.sanity = clamp(c.needs.sanity + 4);
  const tail = streak >= 2 ? ` Серия: ${streak} дн. подряд${streak >= 3 ? " — настроение лучше" : ""}.` : "";
  log(w, `🎯 Цель дня выполнена: «${g.text}». Всем +8 опыта.${tail}`, "good");
  fx(w, { k: "toast", text: `🎯 Цель дня выполнена!${streak >= 2 ? ` Серия ${streak}` : ""}` });
  newsLine(w, `🎯 Колония выполнила цель дня: «${g.text}».${tail}`);
});
