import { BAL } from "../data/balance";
import type { World } from "../types";
import { beginDay } from "./lobby";
import { onTick } from "./tick";
import { fx, hoursPerSec, log } from "./util";

export const nightHooks: { start: ((w: World) => void)[]; end: ((w: World) => void)[]; dayStart: ((w: World) => void)[] } = {
  start: [],
  end: [],
  dayStart: [],
};

/** Effective time multiplier for the bunker (skip-time ×3, combat ×0.25). */
export function timeMult(w: World) {
  let m = w.speed * (w.flags._dbgSpeed || 1);
  if (w.mods.combat?.active && w.mods.combat.where === "expedition") m *= BAL.combatTimeMult;
  if (w.mods.combat?.active && w.mods.combat.where !== "expedition") m = 0; // a fight inside the bunker freezes the clock
  return m;
}

onTick("time", "day", (w, dt) => {
  const was = w.hour;
  w.hour += dt * hoursPerSec(w) * timeMult(w);
  // an hour before lights out: finish what you are doing, get home from the pantry
  if (was < BAL.dayEndHour - 1 && w.hour >= BAL.dayEndHour - 1) {
    fx(w, { k: "toast", text: "🌙 22:00 — через час отбой. Заканчивайте дела." });
    log(w, "22:00 — через час отбой.", "system");
  }
  if (w.hour >= BAL.dayEndHour) {
    w.hour = BAL.dayEndHour;
    startNight(w);
  }
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
