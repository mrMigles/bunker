import recipesJson from "../data/recipes.json";
import { DISH_NAMES, ITEMS, itemName } from "../data/items";
import type { Char, World } from "../types";
import { defAction, emitWork } from "./actions";
import { extraChoreHooks } from "./chores";
import { DISH_NUT, DISH_SANITY, spawnItem } from "./items";
import { addXp, clamp, firstName, log, rng, skillLevel } from "./util";
import { nightHooks } from "./time";

export interface Recipe {
  name: string;
  icon: string;
  in: Record<string, number>;
  out: number;
  nut: number;
  sanity: number;
  desc: string;
}

export const RECIPES = recipesJson as Record<string, Recipe>;
for (const id in RECIPES) {
  DISH_NAMES["dish_" + id] = RECIPES[id].name;
  DISH_NUT["dish_" + id] = RECIPES[id].nut;
  DISH_SANITY["dish_" + id] = RECIPES[id].sanity;
}
DISH_NAMES.dish_weird = "Что-то странное";
DISH_NUT.dish_weird = 0.5;
DISH_SANITY.dish_weird = -2;

/** Finds the recipe exactly matching the ingredient set (counts may be multiples). */
export function matchRecipe(ing: Record<string, number>): { id: string; batches: number } | null {
  const keys = Object.keys(ing).filter((k) => ing[k] > 0);
  for (const id in RECIPES) {
    const r = RECIPES[id];
    const rk = Object.keys(r.in);
    if (rk.length !== keys.length || !rk.every((k) => keys.includes(k))) continue;
    const batches = Math.min(...rk.map((k) => Math.floor(ing[k] / r.in[k])));
    if (batches >= 1 && rk.every((k) => ing[k] === r.in[k] * batches)) return { id, batches };
  }
  return null;
}

export function canCook(w: World, ing: Record<string, number>) {
  for (const k in ing) if ((w.res[k] ?? 0) < ing[k]) return false;
  return Object.values(ing).some((n) => n > 0);
}

/** Best known recipe a bot can cook right now. */
export function botRecipe(w: World): Record<string, number> | null {
  let best: string | null = null;
  let bv = 0;
  for (const id of w.recipes) {
    const r = RECIPES[id];
    if (!r || id === "cold_can") continue;
    if (!canCook(w, r.in)) continue;
    // prefer converting perishable raw food
    const v = r.out * r.nut + r.sanity * 0.1 - Object.keys(r.in).reduce((s, k) => s + (ITEMS[k]?.nut ?? 0) * r.in[k], 0) + (Object.keys(r.in).some((k) => (ITEMS[k]?.spoil ?? 99) < 6) ? 0.5 : 0);
    if (v > bv) {
      bv = v;
      best = id;
    }
  }
  return best ? { ...RECIPES[best].in } : null;
}

function sanitize(param: any): Record<string, number> {
  const out: Record<string, number> = {};
  if (!param || typeof param !== "object") return out;
  let total = 0;
  for (const k in param) {
    if (ITEMS[k]?.cat !== "food") continue;
    const n = Math.max(0, Math.min(6, Math.floor(Number(param[k]) || 0)));
    if (n > 0) {
      out[k] = n;
      total += n;
    }
  }
  return total <= 10 ? out : {};
}

export function cookResult(w: World, c: Char, ing: Record<string, number>): string {
  const m = matchRecipe(ing);
  for (const k in ing) w.res[k] = Math.max(0, (w.res[k] ?? 0) - ing[k]);
  const lvl = skillLevel(c, "cooking");
  const chefBonus = c.card.prof === "cook" ? 1 : 0;
  if (m) {
    const r = RECIPES[m.id];
    let servings = r.out * m.batches;
    if (rng(w).chance(0.1 * (lvl - 1) + chefBonus * 0.3)) servings += 1;
    w.res["dish_" + m.id] = (w.res["dish_" + m.id] ?? 0) + servings;
    const isNew = !w.recipes.includes(m.id);
    if (isNew) {
      w.recipes.push(m.id);
      log(w, `📖 ${firstName(c)} изобретает рецепт: ${r.icon} ${r.name}!`, "good");
    }
    w.stats.cooked[c.id] = (w.stats.cooked[c.id] ?? 0) + 1;
    w.flags["_cooked_" + c.id] = (w.flags["_cooked_" + c.id] ?? 0) + 1;
    addXp(c, "cooking", 8);
    c.needs.sanity = clamp(c.needs.sanity + 3);
    w.flags._dishes = (w.flags._dishes ?? 0) + 2;
    return `${r.icon} ${r.name} ×${servings}${isNew ? " (новый рецепт!)" : ""}`;
  }
  // unknown combination: "something weird"
  let nut = 0;
  for (const k in ing) nut += (ITEMS[k]?.nut ?? 0) * ing[k];
  const servings = Math.max(1, Math.round(nut / DISH_NUT.dish_weird * 0.8));
  w.res.dish_weird = (w.res.dish_weird ?? 0) + servings;
  addXp(c, "cooking", 3);
  return `🫕 Что-то странное ×${servings}. Съедобно. Наверное.`;
}

defAction({
  id: "cook",
  type: "obj",
  kinds: ["stove"],
  prio: 12,
  avail: ({ w, o }) => {
    if (o!.broken) return { label: "🍲 Готовить", reason: "Плита сломана" };
    const hasRaw = Object.keys(w.res).some((k) => ITEMS[k]?.cat === "food" && (w.res[k] ?? 0) >= 1);
    if (!hasRaw) return { label: "🍲 Готовить", reason: "Нет продуктов" };
    return "🍲 Готовить…";
  },
  dur: () => 18,
  anim: "cook",
  skill: "cooking",
  chore: "cook",
  start: ({ w, o, param, c }) => {
    let ing = sanitize(param);
    if (!Object.keys(ing).length) ing = botRecipe(w) ?? {};
    if (!Object.keys(ing).length || !canCook(w, ing)) return "Не хватает продуктов";
    o!.st.cooking = 1;
    o!.st._ing = ing;
    o!.st._cook = c.id;
  },
  done: ({ w, c, o }) => {
    const ing = o!.st._ing as Record<string, number>;
    if (!ing || !canCook(w, ing)) return;
    const txt = cookResult(w, c, ing);
    emitWork(w, c, txt, "#ffe08a");
    o!.wear = Math.max(0, o!.wear - 1);
  },
  stop: ({ o }) => {
    if (!o) return;
    o.st.cooking = 0;
    delete o.st._ing;
  },
});

defAction({
  id: "wash_dishes",
  type: "obj",
  kinds: ["sink"],
  prio: 30,
  avail: ({ w }) => ((w.flags._dishes ?? 0) >= 4 ? `🍽️ Помыть посуду (${Math.floor(w.flags._dishes)})` : null),
  dur: () => 10,
  anim: "work",
  skill: "cooking",
  chore: "wash_dishes",
  sanity: 2,
  done: ({ w }) => {
    w.flags._dishes = 0;
    if ((w.res.water_dirty ?? 0) >= 0.5) w.res.water_dirty -= 0.5;
  },
});

defAction({
  id: "tea",
  type: "obj",
  kinds: ["kettle"],
  prio: 40,
  bot: true,
  avail: ({ w }) => ((w.res.herbs ?? 0) >= 1 && (w.res.water ?? 0) >= 0.5 ? "🍵 Заварить травяной чай" : null),
  dur: () => 8,
  anim: "cook",
  done: ({ w, c }) => {
    w.res.herbs -= 1;
    w.res.water -= 0.5;
    c.needs.sanity = clamp(c.needs.sanity + 8);
    c.needs.water = clamp(c.needs.water + 10);
    for (const id in w.chars) {
      const o = w.chars[id];
      if (o.id !== c.id && o.lv === c.lv && Math.abs(o.x - c.x) < 3) o.needs.sanity = clamp(o.needs.sanity + 3);
    }
    emitWork(w, c, "🍵 Уютно", "#8fcf6a");
  },
});

// cook chore: raw perishables and a known recipe → cook
extraChoreHooks.push((w, add) => {
  const stove = Object.values(w.objs).find((o) => o.kind === "stove" && !o.broken);
  if (!stove) return;
  let dishes = 0;
  for (const k in w.res) if (k.startsWith("dish_")) dishes += w.res[k];
  const people = Object.values(w.chars).filter((c) => c.status !== "dead" && c.status !== "away").length;
  if (dishes < people && botRecipe(w)) add({ kind: "cook", obj: stove.id, urgency: 0.45 });
});

/** Spoilage of perishable food each morning. */
export function spoilFood(w: World) {
  const fridge = Object.values(w.rooms).some((r) => r.type === "storage" && r.level >= 3);
  const sorted = (w.flags.sort_day ?? -9) >= w.day - 1;
  let rotten = 0;
  for (const k in w.res) {
    const sp = ITEMS[k]?.spoil;
    if (!sp || (w.res[k] ?? 0) < 1) continue;
    const frac = (1 / sp) * 0.5 * (fridge ? 0.5 : 1) * (sorted ? 0.5 : 1);
    const n = Math.floor(w.res[k] * frac + rng(w).next());
    if (n > 0) {
      w.res[k] -= Math.min(n, w.res[k]);
      rotten += n;
    }
  }
  if (rotten > 0) {
    const comp = Object.values(w.objs).find((o) => o.kind === "compost");
    if (comp) comp.st.amount = (comp.st.amount ?? 0) + rotten * 0.5;
    log(w, `🥴 Испортилось продуктов: ${rotten}${comp ? " (ушло в компост)" : ""}.`, "info");
  }
}

nightHooks.dayStart.push(spoilFood);

export { itemName, spawnItem };
