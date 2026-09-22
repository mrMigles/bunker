import { BAL } from "../data/balance";
import type { World } from "../types";
import { beginDay } from "./lobby";
import { onTick } from "./tick";
import { hoursPerSec } from "./util";

export const nightHooks: { start: ((w: World) => void)[]; end: ((w: World) => void)[]; dayStart: ((w: World) => void)[] } = {
  start: [],
  end: [],
  dayStart: [],
};

/** Effective time multiplier for the bunker (skip-time ×3, combat ×0.25). */
export function timeMult(w: World) {
  let m = w.speed;
  if (w.mods.combat?.active && w.mods.combat.where === "expedition") m *= BAL.combatTimeMult;
  return m;
}

onTick("time", "day", (w, dt) => {
  w.hour += dt * hoursPerSec(w) * timeMult(w);
  if (w.hour >= BAL.dayEndHour) {
    w.hour = BAL.dayEndHour;
    startNight(w);
  }
});

onTick("prologue-fallback", "prologue", (w) => {
  if (!w.mods.prologue) beginDay(w);
});

onTick("night-timeout", "night", (w) => {
  if (!w.council && w.phaseT > w.settings.nightLength) endNight(w);
});

export function startNight(w: World) {
  w.phase = "night";
  w.phaseT = 0;
  w.speed = 1;
  for (const h of nightHooks.start) h(w);
}

export function endNight(w: World) {
  for (const h of nightHooks.end) h(w);
  if (w.phase === "ending") return;
  w.day += 1;
  w.hour = BAL.dayStartHour;
  beginDay(w);
  for (const h of nightHooks.dayStart) h(w);
}
