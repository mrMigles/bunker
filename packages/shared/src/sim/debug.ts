import type { World } from "../types";
import { registerCmd } from "./commands";
import { startNight } from "./time";
import { fx, log } from "./util";

/** Dev-only commands (the server rejects `debug*` commands in production). */
export const debugOps: Record<string, (w: World, arg: any, pid: string) => string | void> = {
  hour: (w, h) => {
    w.hour = Math.max(6, Math.min(21.99, Number(h) || 12));
  },
  night: (w) => {
    if (w.phase === "day") startNight(w);
  },
  res: (w, a) => {
    const k = String(a?.k ?? "food_can");
    w.res[k] = (w.res[k] ?? 0) + (Number(a?.n) || 10);
  },
  rich: (w) => {
    for (const k of ["food_can", "water", "parts", "scrap", "wood", "cloth", "chem", "meds", "ammo", "fuel"]) w.res[k] = (w.res[k] ?? 0) + 50;
    w.res.pickaxe = (w.res.pickaxe ?? 0) + 2;
    w.res.drill = (w.res.drill ?? 0) + 1;
    w.power.battery = w.power.cap;
  },
  heal: (w) => {
    for (const c of Object.values(w.chars)) if (c.status !== "dead") Object.assign(c.needs, { food: 100, water: 100, energy: 100, sanity: 100, health: 100, rad: 0 });
  },
  tired: (w) => {
    for (const c of Object.values(w.chars)) if (c.status !== "dead") c.needs.energy = 30;
  },
  tech: (w, t) => {
    if (t && !w.tech.includes(t)) w.tech.push(String(t));
  },
  alltech: (w) => {
    for (const t of ["tech_turret", "tech_diesel", "tech_chem", "tech_radio", "tech_lift"]) if (!w.tech.includes(t)) w.tech.push(t);
  },
  speed: (w, s) => {
    w.flags._dbgSpeed = Math.max(0.25, Math.min(20, Number(s) || 1));
  },
  notice: (w, n) => {
    w.notice = Number(n) || 0;
  },
  event: (w, id) => {
    const e = EVENT_BY_ID[String(id)];
    if (!e) return "Нет события";
    if (e.auto) {
      for (const ef of e.auto) applyEffect(w, ef);
      log(w, `⚠ ${e.title} ${e.text}`, "bad");
      return;
    }
    if (w.phase === "night" && w.council) {
      w.council.vote = makeVote(w, e, w.phaseT, 35);
      w.council.step = "event";
      w.council.stepEnds = w.phaseT + 35;
    } else w.vote = makeVote(w, e, w.phaseT, 30);
  },
  /** teleport to the game table and sit down */
  sit: (w, _a, pid) => {
    const c = w.chars[w.players[pid]?.char ?? ""];
    const o = objsOfKind(w, "game_table")[0];
    if (!c || !o) return "Нет стола";
    c.x = o.x + 0.5;
    c.lv = o.lv;
    c.y = o.lv * 2 + 2;
    return startAction(w, c, "sit_table", { type: "obj", id: o.id });
  },
  /** stop the table game and keep `arg` bots seated next to me */
  table: (w, n, pid) => {
    const me = w.players[pid]?.char;
    for (const t of Object.values((w.mods.tables ?? {}) as Record<string, any>)) {
      if (!t.seats.includes(me)) continue;
      t.status = "idle";
      t.state = null;
      t.game = null;
      let keep = Number(n) || 0;
      t.seats = t.seats.map((s: string | null) => (s === me ? s : s && keep-- > 0 ? s : null));
      for (const c of Object.values(w.chars)) if (c.seat === t.obj && !t.seats.includes(c.id)) c.seat = undefined;
    }
  },
  /** experience for my character (to test levels and perks) */
  xp: (w, n, pid) => {
    const c = w.chars[w.players[pid]?.char ?? ""];
    if (!c) return "Нет персонажа";
    c.xp = (c.xp ?? 0) + (Number(n) || 100);
  },
  games: (w) => {
    for (const g of ["cards36", "cards52", "domino", "checkers", "chess", "backgammon", "dice", "lotto", "magnate", "wasteland", "mafia"]) if (!w.games.includes(g)) w.games.push(g);
  },
  /** Put the current player into an instrument action for touch/audio UI checks. */
  music: (w, _a, pid) => {
    const c = w.chars[w.players[pid]?.char ?? ""];
    if (!c) return "Нет персонажа";
    w.res.harmonica = Math.max(1, w.res.harmonica ?? 0);
    c.hands = [];
    return startAction(w, c, "play_harmonica", { type: "self", id: c.id });
  },
};

import { EVENT_BY_ID, applyEffect, makeVote } from "./events";
import { startAction } from "./actions";
import { objsOfKind } from "../world/rooms";

registerCmd("debug", (w, p, cmd) => {
  const op = debugOps[String(cmd.op)];
  if (!op) return "Нет такой debug-команды: " + Object.keys(debugOps).join(", ");
  const r = op(w, cmd.arg, p.id);
  log(w, `[debug] ${p.name}: ${cmd.op} ${cmd.arg !== undefined ? JSON.stringify(cmd.arg) : ""}`, "system");
  fx(w, { k: "toast", to: p.id, text: "debug: " + cmd.op });
  return r;
});
