import { GOALS } from "../data/characters";
import type { Char, World } from "../types";
import { councilHooks } from "./council";
import { fx, log } from "./util";

/** Progress of a hidden goal: [current, target]. */
export function goalProgress(w: World, c: Char): [number, number] {
  const f = (k: string) => w.flags[k] ?? 0;
  switch (c.card.goal) {
    case "album":
      return [f("album_home"), 1];
    case "stranger":
      return [f("_goal_stranger_" + c.id), 1];
    case "armory":
      return [f("_goal_armory_" + c.id), 1];
    case "stash5":
      return [c.stash.food_can ?? 0, 5];
    case "digger":
      return [f("_dug_" + c.id), 40];
    case "cook10":
      return [f("_cooked_" + c.id), 10];
    case "gardener":
      return [f("_straw_" + c.id), 3];
    case "cards":
      return [f("_durak_wins_" + c.id), 5];
    case "radio":
      return [f("_numbers_" + c.id), 3];
    case "reader":
      return [f("_read_" + c.id), 12];
    case "medic":
      return [f("_goal_medic_" + c.id), 1];
    case "survivor":
      return [w.phase === "ending" && c.needs.health > 50 ? 1 : 0, 1];
    case "saboteur":
      return [f("_sabotage_" + c.id), 3];
    default:
      return [0, 1];
  }
}

/** Checks goals, awards legacy once. */
export function checkGoals(w: World) {
  for (const c of Object.values(w.chars)) {
    if (!c.card.goal || c.status === "dead") continue;
    const key = "_goaldone_" + c.id;
    if (w.flags[key]) continue;
    const [cur, need] = goalProgress(w, c);
    if (cur >= need) {
      w.flags[key] = 1;
      const g = GOALS[c.card.goal];
      const pts = g?.hostile ? 5 : 3;
      c.legacy += pts;
      if (c.ctrl) fx(w, { k: "toast", to: c.ctrl, text: `🔒 Тайная цель выполнена: «${g?.name}»! +${pts} наследия` });
      if (!c.ctrl) log(w, `${c.card.name} выглядит довольным собой.`, "info");
    }
  }
}

councilHooks.morning.push(checkGoals);
