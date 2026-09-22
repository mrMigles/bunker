import type { World } from "../types";

export type TickHook = (w: World, dt: number) => void;

/** Subsystems register per-phase tick hooks; order of registration = order of execution. */
const hooks: { phase: World["phase"] | "*"; fn: TickHook; name: string }[] = [];

export function onTick(name: string, phase: World["phase"] | "*", fn: TickHook) {
  const i = hooks.findIndex((h) => h.name === name);
  if (i >= 0) hooks[i] = { name, phase, fn };
  else hooks.push({ name, phase, fn });
}

export function tickWorld(w: World, dt: number) {
  if (w.paused) return;
  w.phaseT += dt;
  for (const h of hooks) {
    if (h.phase === "*" || h.phase === w.phase) h.fn(w, dt);
  }
}
