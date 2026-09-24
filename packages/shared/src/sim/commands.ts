import { Rng } from "../rng";
import { GOALS } from "../data/characters";
import type { Cmd, InputMsg } from "../net/protocol";
import type { Player, World } from "../types";
import { addPlayer, offerCards, sanitizeName, startGame, takeChar, validateCustomCard } from "./lobby";
import { stepMove } from "./move";
import { fx } from "./util";

export type CmdHandler = (w: World, p: Player, cmd: Cmd) => string | void;

const handlers: Record<string, CmdHandler> = {};

export function registerCmd(k: string, h: CmdHandler) {
  handlers[k] = h;
}

/** Applies a validated command. Returns an error message for the client, or undefined. */
export function applyCmd(w: World, pid: string, cmd: Cmd): string | void {
  const p = w.players[pid];
  if (!p || !cmd || typeof cmd.k !== "string") return "bad";
  const h = handlers[cmd.k];
  if (!h) return "Неизвестная команда";
  return h(w, p, cmd);
}

/** Other modules (expeditions) may take over movement input for away characters. */
export const inputHooks: ((w: World, c: import("../types").Char, inp: InputMsg) => boolean)[] = [];

/** Movement input from a player (applied immediately, prediction-compatible). */
export function applyInput(w: World, pid: string, inp: InputMsg) {
  const p = w.players[pid];
  if (!p?.char) return;
  const c = w.chars[p.char];
  if (!c || c.ctrl !== pid) return;
  for (const h of inputHooks) if (h(w, c, inp)) return;
  if (c.status !== "ok" || w.phase !== "day" || w.paused || p.aquarium || c.mind.plan === "combat") {
    c.seq = inp.seq;
    return;
  }
  const mx = clampInt(inp.mx);
  const my = clampInt(inp.my);
  const dt = Math.max(0, Math.min(0.1, Number(inp.dt) || 0));
  c.run = !!inp.run;
  if ((mx !== 0 || my !== 0) && c.task) {
    c.task = null; // moving cancels current action
    if (c.seat) c.seat = undefined;
  }
  if (c.task) {
    c.seq = inp.seq;
    return;
  }
  c.mx = mx;
  c.my = my;
  stepMove(w, c, mx, my, dt);
  c.seq = inp.seq;
}

function clampInt(v: any) {
  const n = Number(v) || 0;
  return n > 0.1 ? 1 : n < -0.1 ? -1 : 0;
}

// ---------------- lobby commands
registerCmd("name", (w, p, c) => {
  p.name = sanitizeName(c.name);
});

registerCmd("pick", (w, p, c) => {
  if (w.phase !== "lobby" || !p.cards) return;
  const i = Number(c.i);
  if (i >= 0 && i < p.cards.length) p.pick = i;
});

/** A card made or edited in the character editor: validated, then offered as the 4th card and picked. */
registerCmd("customCard", (w, p, c) => {
  if (w.phase !== "lobby" || !p.cards) return "Только в лобби";
  // the secret goal stays secret: an edited card keeps its own, a new one draws a random one
  const goals = Object.keys(GOALS).filter((g) => !GOALS[g].hostile && g !== "saboteur");
  const card = validateCustomCard(c.card, c.card?.goal && p.cards.some((x) => x.goal === c.card.goal) ? c.card.goal : new Rng(w.rng).pick(goals));
  if (typeof card === "string") return card;
  p.cards = [...p.cards.slice(0, 3), card];
  p.pick = 3;
});

registerCmd("reroll", (w, p) => {
  if (w.phase !== "lobby") return;
  if ((p as any).rerolls >= 2) return "Больше перевыборов нет";
  (p as any).rerolls = ((p as any).rerolls ?? 0) + 1;
  offerCards(w, p);
});

registerCmd("ready", (w, p, c) => {
  p.ready = !!c.v;
});

registerCmd("settings", (w, p, c) => {
  if (!p.host || w.phase !== "lobby") return "Только хост меняет настройки";
  const s = w.settings;
  const n = c.s ?? {};
  if (n.dayLength) s.dayLength = Math.max(60, Math.min(1200, Number(n.dayLength)));
  if (n.residents) s.residents = Math.max(1, Math.min(6, Number(n.residents)));
  if (n.storyteller && ["haven", "classic", "scorched"].includes(n.storyteller)) s.storyteller = n.storyteller;
  if (n.short !== undefined) s.short = !!n.short;
  if (n.traitor !== undefined) s.traitor = !!n.traitor;
  if (n.skipPrologue !== undefined) s.skipPrologue = !!n.skipPrologue;
  if (n.botInitiative !== undefined) s.botInitiative = !!n.botInitiative;
  if (n.combatTurnTime) s.combatTurnTime = Math.max(5, Math.min(90, Number(n.combatTurnTime)));
  if (n.tableTurnTime) s.tableTurnTime = Math.max(5, Math.min(120, Number(n.tableTurnTime)));
  if (n.tableLeave && ["bot", "pause"].includes(n.tableLeave)) s.tableLeave = n.tableLeave;
});

registerCmd("start", (w, p) => {
  if (w.phase !== "lobby") return;
  if (!p.host) return "Начать может только хост";
  startGame(w);
});

registerCmd("take", (w, p, c) => {
  if (w.phase === "lobby") return;
  if (!takeChar(w, p, String(c.char))) return "Этот жилец занят";
});

registerCmd("emote", (w, p, c) => {
  const ch = p.char ? w.chars[p.char] : undefined;
  const id = String(c.id).slice(0, 8);
  if (!ch || !["help", "here", "no", "lol"].includes(id)) return;
  ch.emote = { id, t: 3 };
  fx(w, { k: "emote", id, x: ch.x, lv: ch.lv, who: ch.id });
});

registerCmd("chat", (w, p, c) => {
  const text = String(c.text ?? "")
    .replace(/[\u0000-\u001f]/g, "")
    .trim()
    .slice(0, 200);
  if (!text) return;
  const ch = p.char ? w.chars[p.char] : undefined;
  const who = p.ghost ? `👻 ${p.name}` : ch ? `${p.name} (${ch.card.name.split(" ")[0]})` : p.name;
  w.log.push({ t: w.day * 100 + w.hour, day: w.day, text, kind: "chat", who });
  if (w.log.length > 200) w.log.shift();
  if (ch && !p.ghost) ch.bark = { text, t: 4 };
});

export { addPlayer };
