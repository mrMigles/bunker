import { sanityGainMult } from "./needs";
import { GAMES, tryMove, type GameResult } from "../boardgames/framework";
import "../boardgames/durak";
import "../boardgames/cardgames";
import "../boardgames/dicegames";
import "../boardgames/boards";
import "../boardgames/party";
import { itemName } from "../data/items";
import { modViews } from "../net/view";
import { Rng } from "../rng";
import type { Char, World } from "../types";
import { defAction, stopTask } from "./actions";
import { registerCmd } from "./commands";
import { onTick } from "./tick";
import { clamp, firstName, hasTrait, isBotDriven, log, rng, skillLevel } from "./util";

/** Which board games a box on the shelf unlocks. */
export const BOX_GAMES: Record<string, string[]> = {
  cards36: ["durak"],
  cards52: ["poker", "drunkard", "cheat"],
  domino: ["domino"],
  checkers: ["checkers"],
  chess: ["chess"],
  backgammon: ["backgammon"],
  dice: ["generala"],
  lotto: ["lotto"],
  magnate: ["magnate"],
  wasteland: ["wasteland"],
  mafia: ["mafia"],
};

export interface TableState {
  obj: string;
  seats: (string | null)[];
  game: string | null;
  opts: Record<string, any>;
  state: any;
  status: "idle" | "playing" | "over";
  turnT: number;
  stake: { item: string; n: number } | null;
  pot: Record<string, number>;
  result: GameResult | null;
  talk: { who: string; text: string }[];
  thinkT: Record<string, number>;
  paused: boolean;
  overT: number;
  host?: string;
}

export function tables(w: World): Record<string, TableState> {
  return (w.mods.tables ??= {});
}

export function tableFor(w: World, objId: string): TableState {
  const t = tables(w);
  if (!t[objId]) {
    const o = w.objs[objId];
    const n = o?.st.seats ?? 4;
    t[objId] = { obj: objId, seats: Array(n).fill(null), game: null, opts: {}, state: null, status: "idle", turnT: 0, stake: null, pot: {}, result: null, talk: [], thinkT: {}, paused: false, overT: 0 };
  }
  return t[objId];
}

export function availableGames(w: World): string[] {
  const out: string[] = [];
  for (const box of w.games) for (const g of BOX_GAMES[box] ?? []) if (GAMES[g] && !out.includes(g) && !w.flags["incomplete_" + box]) out.push(g);
  return out;
}

function seated(t: TableState) {
  return t.seats.filter((s): s is string => !!s);
}

/** Thinking games get a longer clock. */
function turnTime(w: World, t: TableState) {
  return w.settings.tableTurnTime * (["chess", "checkers", "backgammon"].includes(t.game ?? "") ? 3 : 1);
}

/** Games talk about seats by character id; show first names instead. */
function named(w: World, text: string) {
  return text.replace(/\bc[0-9a-z]+\b/g, (id) => (w.chars[id] ? firstName(w.chars[id]) : id));
}

function say(t: TableState, who: string, text: string) {
  t.talk.push({ who, text });
  if (t.talk.length > 8) t.talk.shift();
}

// ---------------------------------------------------------------- sitting down

defAction({
  id: "sit_table",
  type: "obj",
  kinds: ["game_table"],
  prio: 15,
  bot: true,
  avail: ({ w, c, o }) => {
    const t = tableFor(w, o!.id);
    if (t.seats.includes(c.id)) return "🃏 За игровым столом";
    if (!t.seats.includes(null)) return { label: "🃏 Сесть за стол", reason: "Все места заняты — можно смотреть" };
    return `🃏 Сесть за игровой стол (${seated(t).length}/${t.seats.length})`;
  },
  dur: () => 0,
  anim: "play",
  start: ({ w, c, o }) => {
    const t = tableFor(w, o!.id);
    if (!t.seats.includes(c.id)) {
      const i = t.seats.indexOf(null);
      if (i < 0) return "Нет мест";
      t.seats[i] = c.id;
    }
    c.seat = o!.id;
    t.paused = false;
  },
  tick: ({ w, c, o }) => {
    const t = tableFor(w, o!.id);
    c.anim = "play";
    // bots leave when their leisure time is over and no game is running
    if (isBotDriven(w, c.id) && t.status !== "playing" && w.phaseT > (c.mind.until ?? 0) + 20) return true;
    if (c.needs.food < 15 || c.needs.water < 15) return true;
  },
  stop: ({ w, c, o }) => {
    if (!o) return;
    const t = tableFor(w, o.id);
    const i = t.seats.indexOf(c.id);
    if (i < 0) return;
    const inGame = t.status === "playing" && t.state && (t.state.players ?? []).includes(c.id);
    if (inGame && !isBotDriven(w, c.id) && w.settings.tableLeave === "pause") {
      t.paused = true; // keep the seat
      say(t, "стол", `${firstName(c)} отошёл — партия на паузе`);
      return;
    }
    if (!inGame) t.seats[i] = null;
    else say(t, "стол", `${firstName(c)} встаёт — за него доиграет бот`);
  },
});

// ---------------------------------------------------------------- commands

registerCmd("tableStart", (w, p, cmd) => {
  const c = p.char ? w.chars[p.char] : undefined;
  if (!c || !c.seat) return "Сначала сядьте за стол";
  const t = tableFor(w, c.seat);
  if (t.status === "playing") return "Партия уже идёт";
  const gid = String(cmd.game);
  const g = GAMES[gid];
  if (!g || !availableGames(w).includes(gid)) return "Такой игры нет на полке";
  const players = seated(t);
  if (players.length < g.minPlayers) return `Нужно минимум ${g.minPlayers} игрока`;
  if (players.length > g.maxPlayers) return `Максимум ${g.maxPlayers}`;
  const opts: Record<string, any> = {};
  for (const k in g.options ?? {}) if (cmd.opts?.[k] !== undefined && g.options![k].values.some(([v]) => v === cmd.opts[k])) opts[k] = cmd.opts[k];
  // stakes from personal stashes
  let stake: TableState["stake"] = null;
  if (cmd.stake && ["food_can", "cigarettes", "ammo"].includes(cmd.stake.item)) {
    const n = Math.max(1, Math.min(3, Math.floor(Number(cmd.stake.n) || 1)));
    for (const id of players) if ((w.chars[id].stash[cmd.stake.item] ?? 0) < n) return `${firstName(w.chars[id])}: в тайнике не хватает «${itemName(cmd.stake.item)}»`;
    stake = { item: cmd.stake.item, n };
  }
  startTableGame(w, t, gid, opts, stake);
  t.host = p.id;
});

export function startTableGame(w: World, t: TableState, gid: string, opts: Record<string, any>, stake: TableState["stake"]) {
  const g = GAMES[gid];
  const players = seated(t);
  t.game = gid;
  t.opts = opts;
  t.state = g.setup(players, (rng(w).next() * 2 ** 31) | 0, opts);
  t.status = "playing";
  t.result = null;
  t.turnT = turnTime(w, t);
  t.stake = stake;
  t.pot = {};
  t.thinkT = {};
  t.talk = [];
  if (stake) for (const id of players) {
    w.chars[id].stash[stake.item] -= stake.n;
    t.pot[stake.item] = (t.pot[stake.item] ?? 0) + stake.n;
  }
  say(t, "стол", `Новая партия: ${g.name}${opts.variant ? " (" + g.options?.variant?.values.find(([v]) => v === opts.variant)?.[1] + ")" : ""}${stake ? `, ставка ${stake.n} × ${itemName(stake.item)}` : " на интерес"}`);
}

registerCmd("tableMove", (w, p, cmd) => {
  const c = p.char ? w.chars[p.char] : undefined;
  if (!c || !c.seat) return "Вы не за столом";
  const t = tableFor(w, c.seat);
  if (t.status !== "playing" || !t.game) return "Партия не идёт";
  if (t.paused) return "Партия на паузе";
  const g = GAMES[t.game];
  const r = tryMove(g, t.state, c.id, cmd.move);
  if (r.error) return r.error;
  t.state = r.state;
  const d = g.describe?.(t.state, c.id, cmd.move);
  if (d) say(t, firstName(c), named(w, d));
  t.turnT = turnTime(w, t);
  afterMove(w, t);
});

registerCmd("tableInvite", (w, p) => {
  const c = p.char ? w.chars[p.char] : undefined;
  if (!c || !c.seat) return "Сначала сядьте за стол";
  const t = tableFor(w, c.seat);
  if (!t.seats.includes(null)) return "Мест нет";
  const table = w.objs[c.seat];
  const bot = Object.values(w.chars)
    .filter((x) => x.status === "ok" && isBotDriven(w, x.id) && !x.seat && x.lv === table.lv)
    .sort((a, b) => Math.abs(a.x - table.x) - Math.abs(b.x - table.x))[0] ?? Object.values(w.chars).find((x) => x.status === "ok" && isBotDriven(w, x.id) && !x.seat);
  if (!bot) return "Свободных жильцов нет";
  stopTask(w, bot);
  const i = t.seats.indexOf(null);
  t.seats[i] = bot.id;
  bot.seat = table.id;
  bot.x = table.x + 0.5 + (i % 2 ? 0.55 : -0.55);
  bot.lv = table.lv;
  bot.task = { action: "sit_table", obj: table.id, t: 0, dur: 0, hold: false };
  bot.mind.until = w.phaseT + 180;
  bot.bark = { text: "Раздавай!", t: 3 };
});

registerCmd("tableKick", (w, p, cmd) => {
  // free a bot seat (only bots can be asked to leave)
  const c = p.char ? w.chars[p.char] : undefined;
  if (!c?.seat) return;
  const t = tableFor(w, c.seat);
  const id = String(cmd.char);
  if (t.status === "playing") return "Дождитесь конца партии";
  const b = w.chars[id];
  if (!b || !isBotDriven(w, id)) return "Попросить можно только бота";
  const i = t.seats.indexOf(id);
  if (i >= 0) t.seats[i] = null;
  if (b.task?.action === "sit_table") stopTask(w, b);
});

// ---------------------------------------------------------------- simulation

function afterMove(w: World, t: TableState) {
  const g = GAMES[t.game!];
  if (!g.isOver(t.state)) return;
  const res = g.result(t.state);
  t.result = res;
  t.status = "over";
  t.overT = 10;
  const names = (ids: string[]) => ids.map((id) => (w.chars[id] ? firstName(w.chars[id]) : id)).join(", ");
  // rewards
  for (const id of [...res.winners, ...res.losers]) {
    const c = w.chars[id];
    if (!c) continue;
    const win = res.winners.includes(id) && !res.draw;
    c.needs.sanity = clamp(c.needs.sanity + (win ? 8 : res.draw ? 6 : 4) * sanityGainMult(c.needs.sanity));
    const lk = "_lose_streak_" + id;
    if (win) {
      w.flags[lk] = 0;
      if (t.game === "durak") w.flags["_durak_wins_" + id] = (w.flags["_durak_wins_" + id] ?? 0) + 1;
      w.stats.wins[id] = (w.stats.wins[id] ?? 0) + 1;
    } else if (!res.draw) {
      w.flags[lk] = (w.flags[lk] ?? 0) + 1;
      if (hasTrait(c, "gambler") && w.flags[lk] >= 2) c.needs.sanity = clamp(c.needs.sanity - 6 * w.flags[lk]);
    }
    for (const o of [...res.winners, ...res.losers]) if (o !== id) c.rel[o] = (c.rel[o] ?? 0) + 1.5;
  }
  // stakes: winners share the pot
  if (t.stake) {
    const winners = res.draw || !res.winners.length ? seated(t) : res.winners;
    const total = t.pot[t.stake.item] ?? 0;
    const each = Math.floor(total / winners.length);
    let rest = total - each * winners.length;
    for (const id of winners) {
      const c = w.chars[id];
      if (!c) continue;
      c.stash[t.stake.item] = (c.stash[t.stake.item] ?? 0) + each + (rest-- > 0 ? 1 : 0);
    }
  }
  const g2 = GAMES[t.game!];
  const text = `🃏 ${g2.name}: ${res.draw ? "ничья" : t.game === "durak" && res.losers.length ? `в дураках — ${names(res.losers)}` : res.winners.length ? `победа: ${names(res.winners)}` : `проиграли все`}${res.text ? ` (${named(w, res.text)})` : ""}${t.stake ? ` (на кону ${t.pot[t.stake.item]} × ${itemName(t.stake.item)})` : ""}.`;
  log(w, text, "info");
  say(t, "стол", text);
  const gz = w.gazette[w.gazette.length - 1];
  if (t.stake && gz && gz.day === w.day - 1) gz.lines.push(text);
  (w.mods._tableResults ??= []).push({ day: w.day, text });
}

function botSkill(c: Char) {
  return Math.min(1, 0.25 + c.card.stats.int * 0.12 + skillLevel(c, "stealth") * 0.02);
}

onTick("tables", "*", (w, dt) => {
  const all = tables(w);
  for (const id in all) {
    const t = all[id];
    if (!w.objs[id]) {
      delete all[id];
      continue;
    }
    // clean seats of characters that went away (not sitting, not playing)
    t.seats = t.seats.map((s) => {
      if (!s) return s;
      const c = w.chars[s];
      if (!c || c.status === "dead" || c.status === "away") return null;
      const sitting = c.task?.action === "sit_table" && c.task.obj === id;
      const inGame = t.status === "playing" && (t.state?.players ?? []).includes(s);
      if (!sitting && !inGame && !t.paused) {
        if (c.seat === id) c.seat = undefined;
        return null;
      }
      return s;
    });
    if (t.status === "over") {
      t.overT -= dt;
      if (t.overT <= 0) {
        t.status = "idle";
        t.state = null;
      }
      continue;
    }
    if (t.status === "idle") {
      // bots start a game among themselves when no human is seated
      const s = seated(t);
      const humans = s.filter((x) => !isBotDriven(w, x));
      const fits = availableGames(w).filter((gid) => s.length >= GAMES[gid].minPlayers && s.length <= GAMES[gid].maxPlayers && gid !== "chess");
      if (s.length >= 2 && humans.length === 0 && fits.length) {
        w.flags["_tbl_idle_" + id] = (w.flags["_tbl_idle_" + id] ?? 0) + dt;
        if (w.flags["_tbl_idle_" + id] > 4) {
          w.flags["_tbl_idle_" + id] = 0;
          const R = rng(w);
          const gid = fits.includes("durak") && R.chance(0.5) ? "durak" : R.pick(fits);
          startTableGame(w, t, gid, gid === "durak" ? { variant: R.chance(0.3) ? "perevodnoy" : "podkidnoy" } : {}, null);
        }
      }
      continue;
    }
    if (t.paused || !t.game) continue;
    const g = GAMES[t.game];
    const actors = g.toAct(t.state);
    t.turnT -= dt;
    const R = rng(w);
    for (const p of actors) {
      const c = w.chars[p];
      const botPlays = !c || isBotDriven(w, p) || c.task?.action !== "sit_table" || c.seat !== id;
      const timeout = t.turnT <= 0;
      if (!botPlays && !timeout) continue;
      t.thinkT[p] = (t.thinkT[p] ?? R.range(0.8, 2.2)) - dt;
      if (t.thinkT[p] > 0 && !timeout) continue;
      delete t.thinkT[p];
      const cheater = !!c && c.card.prof === "conman" && botPlays;
      const m = g.botMove(t.state, p, c ? botSkill(c) : 0.5, new Rng(w.rng), cheater);
      let move = m;
      if (!move) {
        const legal = g.legalMoves(t.state, p);
        move = legal.find((x: any) => x.t === "pass") ?? legal.find((x: any) => x.t === "take") ?? legal[0];
      }
      if (!move) continue;
      const trusted = cheater && (move as any).cheat;
      const r = tryMove(g, t.state, p, move, trusted);
      if (r.error) continue;
      t.state = r.state;
      const d = g.describe?.(t.state, p, move);
      if (d && c) say(t, firstName(c), named(w, d));
      if (c && R.chance(0.15)) c.bark = { text: R.pick(["Ха!", "Ну-ну…", "Бито!", "А вот так?", "Эх…", "Кто так ходит?!", "Держи козыря!"]), t: 2.5 };
      t.turnT = turnTime(w, t);
      afterMove(w, t);
      break; // one bot move per tick keeps it watchable
    }
  }
});

// ---------------------------------------------------------------- views

modViews.tables = {
  pub: (w, m: Record<string, TableState>) => {
    const out: Record<string, any> = {};
    for (const id in m) {
      const t = m[id];
      const g = t.game ? GAMES[t.game] : null;
      out[id] = {
        obj: id,
        seats: t.seats,
        game: t.game,
        opts: t.opts,
        status: t.status,
        turnT: Math.ceil(t.turnT),
        stake: t.stake,
        pot: t.pot,
        result: t.result,
        talk: t.talk,
        paused: t.paused,
        view: g && t.state ? g.viewFor(t.state, null) : null,
        toAct: g && t.state && t.status === "playing" ? g.toAct(t.state) : [],
        games: availableGames(w),
      };
    }
    return out;
  },
  priv: (w, m: Record<string, TableState>, pid) => {
    const ch = w.players[pid]?.char;
    if (!ch) return undefined;
    for (const id in m) {
      const t = m[id];
      if (!t.state || !t.game || !t.seats.includes(ch)) continue;
      const g = GAMES[t.game];
      return { obj: id, view: g.viewFor(t.state, ch), legal: t.status === "playing" && !t.paused ? g.legalMoves(t.state, ch) : [] };
    }
    return undefined;
  },
};
