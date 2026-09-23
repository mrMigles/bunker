// Прокачка: residents earn experience from everything useful (work, searching, fights, sorties),
// level up, and on every level pick one of three perks. Perks share `hasTrait` with the card traits,
// so a perk named like a trait simply gives that trait's effect; the rest are wired into combat and sorties.
import { TRAITS_PLUS } from "../data/characters";
import { Rng } from "../rng";
import type { Char, World } from "../types";
import { registerCmd } from "./commands";
import { onTick } from "./tick";
import { clamp, firstName, fx, isBotDriven, log } from "./util";

export interface PerkDef {
  name: string;
  icon: string;
  desc: string;
  /** what bots prefer by profession */
  for?: string[];
}

export const PERKS: Record<string, PerkDef> = {
  // combat
  marksman: { name: "Меткий", icon: "🎯", desc: "+10% к попаданию в бою.", for: ["soldier", "radioman"] },
  quick: { name: "Проворный", icon: "💨", desc: "+1 очко действия в каждом ходу боя.", for: ["soldier", "conman"] },
  sturdy: { name: "Живучий", icon: "🛡", desc: "+8 здоровья в бою.", for: ["miner", "soldier"] },
  medic: { name: "Санитар", icon: "✚", desc: "Лечение в бою и в лазарете на 50% сильнее.", for: ["doctor", "priest"] },
  // sorties
  shadow: { name: "Тень", icon: "🌒", desc: "Во время вылазок вас замечают на треть медленнее.", for: ["conman", "radioman"] },
  scavenger: { name: "Мародёр", icon: "🎒", desc: "Из каждого обысканного ящика — ещё одна находка.", for: ["conman", "cook"] },
  // the bunker (shared with card traits: same effects)
  tough: { name: TRAITS_PLUS.tough.name, icon: "💪", desc: TRAITS_PLUS.tough.desc, for: ["miner"] },
  goldhands: { name: TRAITS_PLUS.goldhands.name, icon: "🔧", desc: TRAITS_PLUS.goldhands.desc, for: ["engineer", "electrician"] },
  strongback: { name: TRAITS_PLUS.strongback.name, icon: "⛏", desc: TRAITS_PLUS.strongback.desc, for: ["miner"] },
  greenthumb: { name: TRAITS_PLUS.greenthumb.name, icon: "🌱", desc: TRAITS_PLUS.greenthumb.desc, for: ["farmer", "cook"] },
  optimist: { name: TRAITS_PLUS.optimist.name, icon: "☀", desc: TRAITS_PLUS.optimist.desc, for: ["priest", "teacher"] },
  frugal: { name: TRAITS_PLUS.frugal.name, icon: "🥄", desc: TRAITS_PLUS.frugal.desc, for: ["cook"] },
  eagleeye: { name: TRAITS_PLUS.eagleeye.name, icon: "🦅", desc: "+10% к попаданию, замечает тайники и ловушки.", for: ["radioman", "soldier"] },
};

/** Experience needed to reach `level` (level 1 = 0): 60, 180, 360, 600, 900… */
export function xpForLevel(level: number) {
  return 30 * (level - 1) * level;
}

export const MAX_LEVEL = 10;

export function levelOf(c: Char) {
  return c.level ?? 1;
}

/** Adds experience; level-ups are processed on the next progress tick (needs the world for logs). */
export function grantXp(c: Char, n: number) {
  if (c.status === "dead" || n <= 0) return;
  c.xp = (c.xp ?? 0) + n;
}

function offerPerks(w: World, c: Char) {
  const R = new Rng([Math.floor((c.xp ?? 0) * 7919 + w.seed) >>> 0, levelOf(c) * 131, c.id.length * 17, w.day]);
  const have = new Set([...(c.perks ?? []), c.card.plus]);
  const pool = Object.keys(PERKS).filter((k) => !have.has(k));
  R.shuffle(pool);
  // one perk that suits the profession, if any, then random ones
  const fit = pool.find((k) => PERKS[k].for?.includes(c.card.prof));
  const offer = [...new Set([...(fit ? [fit] : []), ...pool])].slice(0, 3);
  c.perkOffer = offer;
}

export function pickPerk(w: World, c: Char, id: string): string | void {
  if (!c.perkOffer?.includes(id)) return "Этого умения нет в выборе";
  (c.perks ??= []).push(id);
  c.perkOffer = undefined;
  log(w, `⭐ ${firstName(c)} осваивает умение «${PERKS[id].name}».`, "good");
  // another level waiting?
  if ((c.perkPending ?? 0) > 0) {
    c.perkPending!--;
    offerPerks(w, c);
  }
}

registerCmd("perkPick", (w, p, cmd) => {
  const c = p.char ? w.chars[p.char] : undefined;
  if (!c) return "Нет персонажа";
  return pickPerk(w, c, String(cmd.perk));
});

onTick("progress", "*", (w, dt) => {
  w.flags._progT = (w.flags._progT ?? 0) + dt;
  if (w.flags._progT < 0.5) return;
  w.flags._progT = 0;
  for (const c of Object.values(w.chars)) {
    if (c.status === "dead") continue;
    let lv = levelOf(c);
    while (lv < MAX_LEVEL && (c.xp ?? 0) >= xpForLevel(lv + 1)) {
      lv++;
      c.level = lv;
      c.needs.sanity = clamp(c.needs.sanity + 5);
      log(w, `⭐ ${c.card.name} — уровень ${lv}!${isBotDriven(w, c.id) ? "" : " Выберите новое умение."}`, "good");
      if (c.ctrl) fx(w, { k: "toast", to: c.ctrl, text: `⭐ Уровень ${lv}! Выберите умение` });
      if (c.perkOffer) c.perkPending = (c.perkPending ?? 0) + 1;
      else offerPerks(w, c);
    }
    // bots choose on their own: the perk that suits them best (the first offer is the profession fit)
    if (c.perkOffer && isBotDriven(w, c.id)) pickPerk(w, c, c.perkOffer[0]);
  }
});

/** Combat numbers from level and perks (used when a resident becomes a combat unit). */
export function combatBonuses(c: Char) {
  const perks = c.perks ?? [];
  const has = (k: string) => perks.includes(k) || c.card.plus === k;
  return {
    hpBonus: (levelOf(c) - 1) + (has("sturdy") ? 8 : 0),
    aimBonus: (has("marksman") ? 10 : 0) + (has("eagleeye") ? 10 : 0),
    apBonus: has("quick") ? 1 : 0,
  };
}

/**
 * Threat level of the wasteland (1..10): grows with the survivors' levels and slowly with days.
 * Enemies get tougher and more accurate, buildings hold more of them, raids come bigger.
 */
export function threatLevel(w: World) {
  const people = Object.values(w.chars).filter((c) => c.status !== "dead" && !c.npc);
  const players = people.filter((c) => c.ctrl);
  const pool = players.length ? players : people;
  const avg = pool.length ? pool.reduce((a, c) => a + levelOf(c), 0) / pool.length : 1;
  return Math.max(1, Math.min(10, 1 + Math.floor((avg - 1) * 0.7 + Math.max(0, w.day - 1) / 5)));
}

// announce when the wasteland gets meaner
onTick("threat", "day", (w) => {
  const tl = threatLevel(w);
  if (tl > (w.flags.threatLv ?? 1)) {
    w.flags.threatLv = tl;
    log(w, `☢ Пустошь становится опаснее: угроза ${tl}. Враги крепче и метче, в зданиях их больше — но и опыт растёт.`, "bad");
  }
});
