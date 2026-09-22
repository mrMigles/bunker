import type { World } from "../types";
import { createWorld } from "./create";

/** Brings older saves up to the current shape by filling in missing fields with defaults. */
export function migrateWorld(saved: World): World {
  const fresh = createWorld(saved.code, saved.seed, saved.settings);
  const w = saved as any;
  for (const k of Object.keys(fresh) as (keyof World)[]) {
    if (w[k] === undefined) w[k] = (fresh as any)[k];
  }
  w.settings = { ...fresh.settings, ...saved.settings };
  w.fx = [];
  return w as World;
}
