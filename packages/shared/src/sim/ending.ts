import { GOALS } from "../data/characters";
import type { World } from "../types";
import { createWorld } from "../world/create";
import { battleEndHooks, bunkerBattle, type BattleMod } from "./battle";
import { registerCmd } from "./commands";
import { councilHooks } from "./council";
import { arriveHooks, exped, roadFight } from "./expedition";
import { checkGoals, goalProgress } from "./goals";
import { offerCards } from "./lobby";
import { nightHooks } from "./time";
import { fx, log } from "./util";

export const ENDINGS: Record<string, { title: string; text: string; good: boolean }> = {
  ark: { title: "Ковчег", text: "Ворота Ковчега открылись. Внутри — свет, тёплый хлеб и люди, которые не стреляют. Бункер остался позади, но его истории вы понесёте с собой.", good: true },
  home: { title: "Дом", text: "Бункер живёт сам: растения, вода, свет — замкнутый круг. Наверху по-прежнему пепел, но внизу теперь — дом. Может быть, однажды вы откроете люк навсегда.", good: true },
  faction: { title: "Дети Вспышки", text: "Вы присоединились к общине. Тепло костров, общие песни, странные молитвы огню. Выжить можно по-разному.", good: true },
  short: { title: "Десять дней", text: "Десять дней под землёй позади. Вы выжили — и это уже победа.", good: true },
  dead: { title: "Тишина", text: "В бункере больше никого нет. Только радио всё ещё шипит на пустой частоте.", good: false },
  fallen: { title: "Бункер пал", text: "Налётчики вынесли всё. Выжившие разбрелись по пустошам.", good: false },
};

export function endGame(w: World, kind: string) {
  if (w.phase === "ending") return;
  checkGoals(w);
  const e = ENDINGS[kind] ?? ENDINGS.short;
  const survivors = Object.values(w.chars).filter((c) => c.status !== "dead");
  const legacy: Record<string, { name: string; points: number; goal?: string; done: boolean }> = {};
  for (const p of Object.values(w.players)) {
    const c = p.char ? w.chars[p.char] : Object.values(w.chars).find((x) => x.ctrl === p.id);
    let pts = 1 + (e.good ? 2 : 0);
    let done = false;
    if (c) {
      const [cur, need] = goalProgress(w, c);
      done = cur >= need || !!w.flags["_goaldone_" + c.id];
      pts += c.legacy + (c.status !== "dead" ? 2 : 0);
    }
    legacy[p.id] = { name: p.name, points: pts, goal: c?.card.goal ? GOALS[c.card.goal]?.name : undefined, done };
  }
  w.phase = "ending";
  w.phaseT = 0;
  w.ending = { kind, text: e.text };
  w.mods.endingInfo = {
    kind,
    title: e.title,
    text: e.text,
    good: e.good,
    day: w.day,
    survivors: survivors.map((c) => c.card.name),
    fallen: Object.values(w.chars).filter((c) => c.status === "dead").map((c) => c.card.name),
    legacy,
    gazettes: w.gazette.length,
    // the milestones taken, in order: what this colony achieved on its way (#31)
    milestones: Object.entries(((w.mods as any).milestones ?? {}) as Record<string, number>).sort((a, b) => a[1] - b[1]).map(([id, day]) => ({ id, day })),
    chronicle: w.gazette.map((g) => ({ day: g.day, headline: g.headline, lines: g.lines })),
  };
  log(w, `🏁 ФИНАЛ: «${e.title}». ${e.text}`, "event");
  fx(w, { k: "toast", text: `🏁 ${e.title}` });
}

export function checkEnding(w: World) {
  if (w.phase === "ending") return;
  const alive = Object.values(w.chars).filter((c) => c.status !== "dead");
  if (!alive.length) return endGame(w, "dead");
  if (w.flags.join_faction) return endGame(w, "faction");
  const need = w.settings.short ? 8 : 30;
  if ((w.flags.stay_home || w.tech.includes("tech_selfsuff")) && w.day >= need) {
    const hydro = Object.values(w.rooms).some((r) => r.type === "hydro" && r.level >= 3);
    const living = Object.values(w.rooms).some((r) => r.type === "living" && r.level >= 2);
    if (hydro && living) return endGame(w, "home");
  }
  if (w.settings.short && w.day > 10) return endGame(w, "short");
}

nightHooks.dayStart.push(checkEnding);
councilHooks.morning.push(checkEnding);

// ---------------------------------------------------------------- the Ark: a two-front finale

arriveHooks.push((w, e, n) => {
  if (n.type !== "ark") return false;
  log(w, "⛰ Врата Ковчега! Охрана не рада гостям. А по следам отряда к бункеру идут чужие…", "event");
  fx(w, { k: "toast", text: "⛰ Финал: Ковчег" });
  w.flags.ark_front = 1;
  roadFight(w, e, ["soldier", "soldier", "drone", "boss", "soldier"], "ark_final", "ark");
  return true;
});

battleEndHooks.ark_final = (w, b: BattleMod) => {
  battleEndHooks.expedition?.(w, b);
  if (b.state.result === "win") {
    w.flags.ark_won = 1;
    // the second front: whoever stayed home must hold the bunker
    const home = Object.values(w.chars).filter((c) => c.status === "ok");
    if (home.length) {
      log(w, "📡 «Ковчег открыт! Держитесь, мы идём за вами!» — а у люка уже стучат…", "event");
      bunkerBattle(w, ["raider", "raider", "marauder", "boss"], "airlock", "ark_home", "ark_home");
    } else endGame(w, "ark");
  } else {
    log(w, "Штурм Ковчега провалился. Отряд отступает.", "bad");
  }
};

battleEndHooks.ark_home = (w, b: BattleMod) => {
  battleEndHooks.raid?.(w, b);
  endGame(w, b.state.result === "lose" ? "ark" : "ark");
  if (b.state.result === "lose") log(w, "Бункер пал, но Ковчег принял тех, кто дошёл.", "bad");
};

// ---------------------------------------------------------------- after the end: a new game

registerCmd("newGame", (w, p) => {
  if (w.phase !== "ending") return "Партия ещё идёт";
  if (!p.host) return "Новую партию начинает хост";
  resetWorld(w);
});

/** A new bunker in place of this one: same code and settings, everyone online back in the lobby. */
export function resetWorld(w: World) {
  const players = Object.values(w.players).filter((x) => x.online);
  const fresh = createWorld(w.code, (w.seed * 48271 + 11) % 2147483647, w.settings);
  for (const k of Object.keys(w) as (keyof World)[]) delete (w as any)[k];
  Object.assign(w, fresh);
  for (const pl of players) {
    w.players[pl.id] = { ...pl, char: null, ready: false, ghost: false, aquarium: false, cards: undefined, pick: undefined };
    offerCards(w, w.players[pl.id]);
  }
  log(w, "Бункер начат заново.", "system");
}

// ---------------------------------------------------------------- «Начать заново» in a running game
// One player asks; the bunker is only wiped when someone else agrees — another player in the game, or
// (in a Telegram chat) any member of the chat with the button under the bot's message.

registerCmd("restartAsk", (w, p) => {
  if (w.phase === "lobby") return "Игра ещё не началась";
  if (w.restart) return "Уже спрашиваем — ждём ответа";
  w.restart = { by: p.id, name: p.name, day: w.day };
  log(w, `🔄 ${p.name} предлагает начать бункер заново. Нужен ещё хотя бы один «за».`, "event");
});

registerCmd("restartYes", (w, p) => restartAgree(w, p.id, p.name));

registerCmd("restartNo", (w, p) => {
  if (w.restart?.by === p.id) {
    log(w, `${p.name} передумал начинать заново.`, "system");
    w.restart = null;
  } else restartRefuse(w, p.name);
});

/** Someone is against starting over: the question is closed. */
export function restartRefuse(w: World, name: string) {
  if (!w.restart) return;
  log(w, `${name} против того, чтобы начинать заново. Играем дальше.`, "system");
  fx(w, { k: "toast", text: `${name}: играем дальше` });
  w.restart = null;
}

/** Someone agrees to start over (from the game or from the chat). Returns an error text, or wipes the bunker. */
export function restartAgree(w: World, pid: string, name: string): string | void {
  const r = w.restart;
  if (!r) return "Никто не предлагал начать заново";
  if (pid === r.by) return "Нужен кто-то ещё — своё предложение не подтвердить";
  log(w, `${name} согласен. Начинаем заново.`, "system");
  resetWorld(w);
}

/** An unanswered question lapses with the next morning. */
export function restartExpire(w: World) {
  if (w.restart && w.day > w.restart.day) w.restart = null;
}
nightHooks.dayStart.push(restartExpire);

export { exped };
