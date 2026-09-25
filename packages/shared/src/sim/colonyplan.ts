// Decisions the council makes for tomorrow that the residents act on:
// «Смены на завтра» — who keeps the generator and the pump going in work hours (#26),
// «Политика двери» — whom the residents let in when no player is there to decide (#27).
import { BAL } from "../data/balance";
import type { Char, World } from "../types";
import { objsOfKind } from "../world/rooms";
import { registerCmd } from "./commands";
import { foodUnits } from "./items";
import { nightHooks } from "./time";
import { clamp, firstName, log } from "./util";

export type ShiftJob = "gen" | "pump";
export type DoorPolicy = "all" | "food3" | "none";
export const SHIFT_MAX = 2;

export function shifts(w: World): Record<ShiftJob, string[]> {
  return ((w.mods as any).shifts ??= { gen: [], pump: [] });
}

export function onShift(w: World, c: Char, job: ShiftJob): boolean {
  return ((w.mods as any).shifts?.[job] ?? []).includes(c.id);
}

registerCmd("shift", (w, _p, cmd) => {
  const job = String(cmd.job) as ShiftJob;
  const id = String(cmd.char);
  const c = w.chars[id];
  if (!c || c.status === "dead" || (job !== "gen" && job !== "pump")) return "bad";
  const s = shifts(w);
  const other: ShiftJob = job === "gen" ? "pump" : "gen";
  if (s[job].includes(id)) {
    s[job] = s[job].filter((x) => x !== id);
    return;
  }
  if (s[job].length >= SHIFT_MAX) return `На смене уже ${SHIFT_MAX}`;
  s[other] = s[other].filter((x) => x !== id);
  s[job].push(id);
});

registerCmd("doorPolicy", (w, p, cmd) => {
  const v = String(cmd.v) as DoorPolicy;
  if (!["all", "food3", "none"].includes(v)) return "bad";
  w.settings.doorPolicy = v;
  log(w, `🚪 ${p.name}: политика двери — ${DOOR_POLICY_NAMES[v]}.`, "info");
});

export const DOOR_POLICY_NAMES: Record<DoorPolicy, string> = {
  all: "впускать всех",
  food3: "впускать, если еды больше чем на 3 дня",
  none: "никого не впускать",
};

function people(w: World) {
  return Object.values(w.chars).filter((c) => c.status !== "dead" && c.status !== "away").length;
}

/** Days of food at one ration a day, now and with one more mouth. */
export function admitNumbers(w: World) {
  const n = people(w);
  const food = foodUnits(w) / BAL.rationFood;
  const beds = objsOfKind(w, "bed").length + objsOfKind(w, "med_bed").length;
  return { n, beds, daysNow: food / Math.max(1, n), daysAfter: food / (n + 1) };
}

/** «Еды на 4.2 дн. → 3.6 · Коек 5/6 → 6/6» — shown wherever someone asks to be let in (#27). */
export function admitForecast(w: World): string {
  const a = admitNumbers(w);
  return `Еды на ${a.daysNow.toFixed(1)} дн. → станет ${a.daysAfter.toFixed(1)} · Людей ${a.n} → ${a.n + 1}, коек ${a.beds}${a.n + 1 > a.beds ? " — кто-то будет спать на полу" : ""}`;
}

/** What the residents do at the door on their own. */
export function doorAllows(w: World): boolean {
  const pol: DoorPolicy = w.settings.doorPolicy ?? "food3";
  if (pol === "all") return true;
  if (pol === "none") return false;
  return admitNumbers(w).daysAfter > 3;
}

// a shift is work: tired minds, trained hands
nightHooks.dayStart.push((w) => {
  const s = (w.mods as any).shifts as Record<ShiftJob, string[]> | undefined;
  if (!s) return;
  for (const job of ["gen", "pump"] as ShiftJob[]) {
    s[job] = s[job].filter((id) => w.chars[id] && w.chars[id].status !== "dead");
    for (const id of s[job]) {
      const c = w.chars[id];
      c.needs.sanity = clamp(c.needs.sanity - 3);
      c.skills.digging = (c.skills.digging ?? 0) + 1;
    }
  }
  const names = (job: ShiftJob) => s[job].map((id) => firstName(w.chars[id])).join(", ");
  if (s.gen.length || s.pump.length)
    log(w, `🔧 Смены на сегодня: ${s.gen.length ? "генератор — " + names("gen") : ""}${s.gen.length && s.pump.length ? "; " : ""}${s.pump.length ? "насос — " + names("pump") : ""}.`, "info");
});
