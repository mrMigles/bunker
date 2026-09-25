import { sanityGainMult } from "./needs";
import type { Char, World } from "../types";
import { defAction, type ActionCtx } from "./actions";
import { timeMult } from "./time";
import { clamp, hasTrait, hoursPerSec, isBotDriven, rng } from "./util";
import barksJson from "../data/barks.json";

/** Actions that count as resting for "Скоротать время". */
export const REST_ACTIONS = new Set(["sleep", "listen_radio", "read_book", "sit", "chat_table", "play_piano", "play_guitar", "pray", "visit_grave", "pet_pet", "watch_film", "tape", "draw", "sit_table", "darts", "pullups", "shower", "tea", "smoke", "drink_moonshine"]);

/** Number of other characters doing leisure near c (for the social bonus). */
export function company(w: World, c: Char, radius = 4) {
  let n = 0;
  for (const id in w.chars) {
    const o = w.chars[id];
    if (o.id === c.id || o.status !== "ok" || o.lv !== c.lv || Math.abs(o.x - c.x) > radius) continue;
    if (o.task && REST_ACTIONS.has(o.task.action)) n++;
  }
  return n;
}

function leisure(
  id: string,
  kinds: string[],
  label: string | ((x: ActionCtx) => string | null),
  anim: string,
  sanityPerHour: number,
  opts: { social?: boolean; energy?: number; seat?: boolean; extra?: (x: ActionCtx, h: number) => void; reason?: (x: ActionCtx) => string | null } = {},
) {
  defAction({
    id,
    type: "obj",
    kinds,
    prio: 45,
    bot: true,
    avail: (x) => {
      const l = typeof label === "function" ? label(x) : label;
      if (!l) return null;
      const r = opts.reason?.(x);
      if (r) return { label: l, reason: r };
      if (opts.seat) {
        for (const cid in x.w.chars) {
          const o = x.w.chars[cid];
          if (o.id !== x.c.id && o.task?.obj === x.o!.id && o.task.action === id) return { label: l, reason: "Занято" };
        }
      }
      return l;
    },
    dur: () => 0,
    anim,
    start: (x) => {
      if (opts.seat && x.o) x.c.x = x.o.x + 0.5;
    },
    tick: (x, dt) => {
      const h = dt * hoursPerSec(x.w) * timeMult(x.w);
      let gain = sanityPerHour;
      if (opts.social) gain *= 1 + company(x.w, x.c) * 0.5 * (hasCompanyStoryteller(x.w, x.c) ? 1.5 : 1);
      x.c.needs.sanity = clamp(x.c.needs.sanity + gain * sanityGainMult(x.c.needs.sanity) * h);
      if (opts.energy) x.c.needs.energy = clamp(x.c.needs.energy + opts.energy * h);
      opts.extra?.(x, h);
      // a leisure with its own hours (the morning coffee) ends when its time is over, for bots and players alike
      if (typeof label === "function" && !label(x)) return true;
      if (isBotDriven(x.w, x.c.id)) {
        const until = x.c.mind.until ?? 0;
        if (x.w.phaseT > until || x.c.needs.sanity >= 98) return true;
      }
    },
  });
}

function hasCompanyStoryteller(w: World, c: Char) {
  for (const id in w.chars) {
    const o = w.chars[id];
    if (o.id !== c.id && o.lv === c.lv && Math.abs(o.x - c.x) < 4 && hasTrait(o, "storyteller")) return true;
  }
  return false;
}

// listen_radio lives in radio.ts
leisure("sit", ["armchair"], "🛋 Посидеть в кресле", "sit", 6, { seat: true, energy: 3 });
leisure("chat_table", ["dining_table"], "💬 Посидеть за столом, поболтать", "sit", 5, { social: true });
// the morning ritual: whoever is up sits at the table with a mug of chicory "coffee" and talks
leisure("morning_coffee", ["dining_table"], (x) => (x.w.hour >= 6 && x.w.hour < 9.5 ? "☕ Утренний кофе за общим столом" : null), "eat", 9, {
  social: true,
  extra: (x, h) => {
    x.c.needs.energy = clamp(x.c.needs.energy + 4 * h);
    x.c.needs.water = clamp(x.c.needs.water + 3 * h);
    // no chair left: drinking it standing up is not quite the same
    if (x.c.task?.standing) x.c.needs.sanity = clamp(x.c.needs.sanity - 5 * h);
    const mates = Object.values(x.w.chars).filter((o) => o.id !== x.c.id && o.task?.action === "morning_coffee" && o.task.obj === x.o?.id);
    if (mates.length && !x.c.bark && x.c.mind.barkCd <= 0 && rng(x.w).chance(h * 3)) coffeeTalk(x.w, x.c);
  },
});
leisure("read_book", ["bookshelf"], "📖 Почитать книгу", "read", 7, {
  extra: (x, h) => {
    x.c.skills.repair += h * 0.8; // «Справочник электрика» и прочее
  },
});
leisure("play_piano", ["piano"], "🎹 Поиграть на пианино", "play", 9, { social: true, seat: true });
leisure("pray", ["altar"], "🕯 Помолчать у свечей", "sit", 10, {});
leisure("visit_grave", ["grave"], (x) => `🥀 Помянуть: ${x.o!.st.name ?? "погибшего"}`, "idle", 8, {});
leisure("pet_bed_rest", ["pet_bed"], "🐾 Посидеть с питомцем", "pet", 9, { social: true });
leisure("darts", ["darts"], "🎯 Бросать дартс", "work", 7, { social: true, extra: (x, h) => (x.c.skills.shooting += h * 0.6) });
leisure("pullups", ["pullup_bar"], "💪 Подтягиваться", "work", 4, { extra: (x, h) => ((x.c.skills.melee += h * 0.8), (x.c.needs.energy = clamp(x.c.needs.energy - 3 * h))) });
leisure("tape", ["tape_player"], "📼 Послушать кассету", "sit", 7, { social: true, reason: (x) => (x.w.tapes.length ? null : "Нет кассет") });

/** A line over the morning coffee (small talk, a joke, the day ahead). */
function coffeeTalk(w: World, c: Char) {
  const R = rng(w);
  const B = barksJson as Record<string, string[]>;
  const pool = R.chance(0.2) ? B.joke : R.chance(0.5) ? B.coffee : B.morning;
  c.bark = { text: R.pick(pool), t: 4.5 };
  c.mind.barkCd = 10 + R.range(0, 12);
}
