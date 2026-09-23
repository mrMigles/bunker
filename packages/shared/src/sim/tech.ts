import techJson from "../data/tech.json";
import { ITEMS, itemName } from "../data/items";
import type { World } from "../types";
import { roomsOfType } from "../world/rooms";
import { defAction, emitWork } from "./actions";
import { extraChoreHooks } from "./chores";
import { FURNITURE } from "./cozy";
import { condOk } from "./events";
import { costText, give, hasRes, missingText, payRes } from "./items";
import { nightHooks } from "./time";
import { clamp, log, skillLevel } from "./util";

export interface TechDef {
  name: string;
  tier: number;
  cost: Record<string, number>;
  points: number;
  req: string[];
  desc: string;
}
export const TECH = techJson as Record<string, TechDef>;

export function hasTech(w: World, id: string) {
  return w.tech.includes(id);
}

export function techAvailable(w: World, id: string): string | null {
  const t = TECH[id];
  if (!t) return "Нет такой технологии";
  if (w.tech.includes(id)) return "Уже изучено";
  for (const r of t.req) if (!w.tech.includes(r)) return `Сначала: ${TECH[r]?.name ?? r}`;
  return null;
}

// Research happens at a workbench or the research desk; progress persists between sessions.
defAction({
  id: "research",
  type: "obj",
  kinds: ["workbench", "research_desk"],
  prio: 22,
  avail: ({ w, param }) => {
    if (w.research) return `🔬 Исследовать: ${TECH[w.research.id]?.name} (${Math.round((w.research.progress / (TECH[w.research.id]?.points ?? 1)) * 100)}%)`;
    if (param && techAvailable(w, String(param))) return { label: "🔬 Исследовать", reason: techAvailable(w, String(param))! };
    return "🔬 Выбрать исследование…";
  },
  dur: () => 0,
  anim: "read",
  skill: "radio",
  start: ({ w, param }) => {
    if (w.research) return;
    const id = String(param ?? "");
    const err = techAvailable(w, id);
    if (err) return err;
    const t = TECH[id];
    if (!hasRes(w, t.cost)) return missingText(w, t.cost);
    payRes(w, t.cost);
    w.research = { id, progress: 0 };
    log(w, `🔬 Начато исследование: ${t.name}.`, "info");
  },
  tick: ({ w, c, o }, dt) => {
    const r = w.research;
    if (!r) return true;
    const t = TECH[r.id];
    const desk = o?.kind === "research_desk" ? 1.5 : 1;
    r.progress += dt * desk * (0.6 + c.card.stats.int * 0.15 + skillLevel(c, "radio") * 0.05) * (c.card.prof === "engineer" || c.card.prof === "teacher" ? 1.25 : 1);
    c.skills.radio += dt * 0.03;
    if (r.progress >= t.points) {
      w.tech.push(r.id);
      w.research = null;
      log(w, `💡 Изучено: ${t.name}! ${t.desc}`, "good");
      for (const x of Object.values(w.chars)) if (x.status !== "dead") x.needs.sanity = clamp(x.needs.sanity + 3);
      return true;
    }
    if (c.ctrl === null && w.phaseT > (c.mind.until ?? 0) + 60) return true;
  },
});

extraChoreHooks.push((w, add) => {
  if (!w.research) return;
  const bench = Object.values(w.objs).find((o) => o.kind === "research_desk" || o.kind === "workbench");
  if (bench) add({ kind: "research", obj: bench.id, urgency: 0.3 });
});

// ---------------------------------------------------------------- tech crafting

export const CRAFTS: Record<string, { name: string; tech: string; cost: Record<string, number>; out: Record<string, number>; furn?: string }> = {
  meds: { name: "Медикаменты ×2", tech: "tech_medicine", cost: { chem: 1, cloth: 1 }, out: { meds: 2 } },
  molotov: { name: "Коктейль Молотова ×2", tech: "tech_molotov", cost: { chem: 1, cloth: 1, fuel: 1 }, out: { molotov: 2 } },
  ammo: { name: "Патроны ×6", tech: "tech_ammo", cost: { scrap: 2, chem: 1 }, out: { ammo: 6 } },
  armor: { name: "Бронежилет", tech: "tech_armor", cost: { scrap: 4, cloth: 3 }, out: { armor: 1 } },
  drill: { name: "Бур", tech: "tech_drill", cost: { parts: 4, scrap: 4 }, out: { drill: 1 } },
  nvg: { name: "ПНВ", tech: "tech_nvg", cost: { parts: 4, batteries: 2 }, out: { nvg: 1 } },
  relay: { name: "Ретранслятор", tech: "tech_relay", cost: { parts: 2, scrap: 2 }, out: { relay: 1 } },
  pistol: { name: "Пистолет", tech: "tech_pistol", cost: { parts: 3, scrap: 3 }, out: { pistol: 1 } },
  shotgun: { name: "Обрез", tech: "tech_pistol", cost: { parts: 4, scrap: 4, wood: 1 }, out: { shotgun: 1 } },
  moonshine: { name: "Самогон (из картошки)", tech: "tech_moonshine", cost: { potato: 3 }, out: { moonshine: 1 } },
  beer: { name: "Пиво (из хмеля)", tech: "tech_moonshine", cost: { hops: 2, water: 1 }, out: { beer: 2 } },
  solar: { name: "Солнечная панель", tech: "tech_solar", cost: { parts: 4, scrap: 4, chem: 1 }, out: {}, furn: "furn_solar" },
  thermal: { name: "Термоэлемент", tech: "tech_thermal", cost: { parts: 5, scrap: 5 }, out: {}, furn: "furn_thermal" },
  chess_pieces: { name: "Выточить недостающие фигуры", tech: "", cost: { wood: 1 }, out: {} },
};

FURNITURE.furn_solar = { name: "Солнечная панель", icon: "🔆", obj: "solar_panel", cost: {}, comfort: 0 };
FURNITURE.furn_thermal = { name: "Термоэлемент", icon: "🔥", obj: "thermal_gen", cost: {}, comfort: 0 };
ITEMS.furn_solar = { name: "Солнечная панель", icon: "🔆", cat: "misc", large: true, value: 20, weight: 8, store: false };
ITEMS.furn_thermal = { name: "Термоэлемент", icon: "🔥", cat: "misc", large: true, value: 25, weight: 10, store: false };

defAction({
  id: "craft_item",
  type: "obj",
  kinds: ["workbench", "chem_bench", "ammo_bench"],
  prio: 21,
  avail: ({ w, c, param }) => {
    const opts = Object.keys(CRAFTS).filter((k) => craftOpen(w, k));
    if (!opts.length) return null;
    if (param && CRAFTS[param]) {
      const cr = CRAFTS[param];
      if (!craftOpen(w, param)) return { label: "🛠 Изготовить", reason: "Не изучено" };
      if (!hasRes(w, cr.cost)) return { label: `🛠 ${cr.name}`, reason: missingText(w, cr.cost) };
      if (cr.furn && c.hands.length) return { label: `🛠 ${cr.name}`, reason: "Освободите руки" };
    }
    return "🛠 Изготовить по технологии…";
  },
  dur: () => 15,
  anim: "repair",
  skill: "repair",
  xp: 5,
  start: ({ w, param }) => {
    const cr = CRAFTS[String(param)];
    if (!cr || !craftOpen(w, String(param))) return "Выберите, что делать";
    if (!hasRes(w, cr.cost)) return missingText(w, cr.cost);
    payRes(w, cr.cost);
  },
  done: ({ w, c, param }) => {
    const k = String(param);
    const cr = CRAFTS[k];
    if (!cr) return;
    for (const r in cr.out) w.res[r] = (w.res[r] ?? 0) + cr.out[r];
    if (cr.furn) give(c, cr.furn, 1);
    if (k === "chess_pieces") {
      for (const g of ["chess", "checkers"]) delete w.flags["incomplete_" + g];
      log(w, "Недостающие фигуры выточены из дерева. Партия!", "good");
    }
    emitWork(w, c, `🛠 ${cr.name}`, "#8fcf6a");
  },
});

export function craftOpen(w: World, k: string) {
  const cr = CRAFTS[k];
  if (!cr) return false;
  if (k === "chess_pieces") return !!(w.flags.incomplete_chess || w.flags.incomplete_checkers);
  return !cr.tech || w.tech.includes(cr.tech);
}

export { costText, itemName };

// ---------------------------------------------------------------- story glue: the long-range radio

nightHooks.dayStart.push((w) => {
  if (w.flags.ark_goal && !w.flags.ark_contact && (w.flags.radio_parts ?? 0) >= 3 && roomsOfType(w, "radioroom").length && hasTech(w, "tech_longradio")) {
    if (!w.timers.some((t) => t.data === "ark_4")) {
      w.timers.push({ at: w.day, kind: "event", data: "ark_4" });
      log(w, "📻 Дальняя рация собрана! Этой ночью попробуем выйти на связь.", "good");
    }
  }
  void condOk;
});
