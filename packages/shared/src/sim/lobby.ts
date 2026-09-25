import { BAGGAGE, COLORS, GOALS, PHOBIAS, PROFS, TRAITS_MINUS, TRAITS_PLUS } from "../data/characters";
import type { Card } from "../types";
import { Rng } from "../rng";
import type { Player, World } from "../types";
import { createChar, makeCard } from "../world/create";
import { feetY } from "../world/grid";
import { roomsOfType } from "../world/rooms";
import { log, fx } from "./util";

export function addPlayer(w: World, pid: string, name: string): Player {
  let p = w.players[pid];
  const isFirst = !Object.values(w.players).some((x) => x.online && x.host);
  if (!p) {
    const used = new Set(Object.values(w.players).map((x) => x.color));
    p = {
      id: pid,
      name: sanitizeName(name),
      char: null,
      online: true,
      ready: false,
      host: isFirst,
      color: COLORS.find((c) => !used.has(c)) ?? COLORS[0],
      ghost: false,
      aquarium: false,
      joinedDay: w.day,
    };
    w.players[pid] = p;
    if (w.phase === "lobby") offerCards(w, p);
    log(w, `${p.name} заходит в игру.`, "system");
  } else {
    p.online = true;
    if (name) p.name = sanitizeName(name);
    if (isFirst) p.host = true;
    if (p.char && w.chars[p.char] && w.chars[p.char].status !== "dead") {
      w.chars[p.char].ctrl = pid;
    }
  }
  // mid-game: a chat member comes down as their own resident; anyone else takes a free one
  if (w.phase !== "lobby" && !p.char && !(isTg(pid) && tgNewcomer(w, p))) autoTake(w, p);
  return p;
}

/** Telegram players (their ids are signed by the server) play as themselves: their name on their resident. */
export const isTg = (pid: string) => pid.startsWith("tg_");

/** A chat bunker holds at most this many residents before newcomers take over free ones. */
export const MAX_TG_RESIDENTS = 10;

/** A chat member joins a running game: a new resident under their name comes down the hatch. */
function tgNewcomer(w: World, p: Player): boolean {
  const alive = Object.values(w.chars).filter((c) => c.status !== "dead");
  if (alive.length >= MAX_TG_RESIDENTS) return false;
  const R = new Rng(w.rng);
  const card: Card = { ...makeCard(R, new Set(alive.map((c) => c.card.prof))), name: p.name, tg: true };
  const airlock = roomsOfType(w, "airlock")[0];
  const c = createChar(w, card, airlock ? airlock.x + 1 : 20, airlock?.lv ?? 0);
  c.y = feetY(c.lv);
  for (const o of alive) {
    o.rel[c.id] = R.int(-5, 5);
    c.rel[o.id] = R.int(0, 10);
  }
  log(w, `🚪 Новый жилец из чата: ${p.name}, ${(PROFS[card.prof]?.name ?? "без профессии").toLowerCase()}.`, "good");
  takeChar(w, p, c.id);
  return true;
}

export function sanitizeName(n: string) {
  const s = String(n ?? "")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, 16);
  return s || "Выживший";
}

export function offerCards(w: World, p: Player) {
  const rng = new Rng(w.rng);
  const taken = new Set<string>();
  for (const q of Object.values(w.players)) if (q.cards && q.pick !== undefined) taken.add(q.cards[q.pick].prof);
  p.cards = [makeCard(rng, taken, w.settings.traitor && rng.chance(0.25)), makeCard(rng, taken), makeCard(rng, taken)];
  // a Telegram player picks a profession, not a name: every card carries theirs
  if (isTg(p.id)) p.cards = p.cards.map((c) => ({ ...c, name: p.name, tg: true }));
  if (w.settings.traitor) {
    // exactly one traitor overall, assigned on start
  }
  p.pick = undefined;
}

export function setOffline(w: World, pid: string) {
  const p = w.players[pid];
  if (!p) return;
  p.online = false;
  p.ready = false;
  if (p.char && w.chars[p.char]) {
    const c = w.chars[p.char];
    c.ctrl = null; // becomes a bot resident
    c.mx = 0;
    c.my = 0;
    c.run = false;
    if (c.task?.hold) c.task = null;
  }
  if (p.host) {
    p.host = false;
    const next = Object.values(w.players).find((x) => x.online);
    if (next) next.host = true;
  }
  if (w.phase === "lobby") {
    delete w.players[pid];
  }
}

export function freeResidents(w: World) {
  return Object.values(w.chars).filter((c) => !c.ctrl && c.status !== "dead" && c.status !== "away");
}

export function autoTake(w: World, p: Player) {
  const free = freeResidents(w);
  if (!free.length) {
    p.ghost = true;
    return;
  }
  takeChar(w, p, free[0].id);
}

export function takeChar(w: World, p: Player, charId: string): boolean {
  const c = w.chars[charId];
  if (!c || c.ctrl || c.status === "dead") return false;
  if (p.char && w.chars[p.char] && w.chars[p.char].ctrl === p.id) w.chars[p.char].ctrl = null;
  c.ctrl = p.id;
  c.mind.plan = "player";
  c.mind.chore = undefined;
  if (c.task && !c.task.hold) {
    // keep continuous tasks (sleeping etc) until the player moves
  }
  p.char = c.id;
  p.ghost = false;
  fx(w, { k: "toast", to: p.id, text: `Вы теперь — ${c.card.name}` });
  return true;
}

/** Bot residents a new bunker starts with (players aside). */
export const MAX_START_BOTS = 3;

export function startGame(w: World) {
  const players = Object.values(w.players).filter((p) => p.online);
  const rng = new Rng(w.rng);
  // at most three residents besides the players at the start: the rest knock on the intercom
  // or are found on sorties later
  const total = Math.max(players.length, Math.min(6, w.settings.residents, players.length + MAX_START_BOTS));
  const airlock = roomsOfType(w, "airlock")[0];
  const spawnX = airlock ? airlock.x + 1 : 20;
  const taken = new Set<string>();
  let i = 0;
  for (const p of players) {
    let card = p.cards && p.pick !== undefined ? p.cards[p.pick] : makeCard(rng, taken);
    if (isTg(p.id)) card = { ...card, name: p.name, tg: true };
    taken.add(card.prof);
    const c = createChar(w, card, spawnX + (i % 3), 0);
    c.ctrl = p.id;
    c.mind.plan = "player";
    p.char = c.id;
    p.cards = undefined;
    i++;
  }
  while (i < total) {
    const card = makeCard(rng, taken);
    taken.add(card.prof);
    const c = createChar(w, card, spawnX + (i % 4), i % 2);
    c.y = feetY(c.lv);
    i++;
  }
  // traitor: one random player gets the hostile goal
  if (w.settings.traitor && players.length >= 3) {
    const pl = rng.pick(players);
    const c = pl.char ? w.chars[pl.char] : undefined;
    if (c) c.card.goal = "saboteur";
  }
  // relationships start neutral with slight noise
  const ids = Object.keys(w.chars);
  for (const a of ids) for (const b of ids) if (a !== b) w.chars[a].rel[b] = rng.int(-5, 10);
  w.elder = players[0]?.id ?? null;
  // common kitchen knowledge; a professional cook knows more
  for (const r of ["can_stew", "rat_skewer"]) if (!w.recipes.includes(r)) w.recipes.push(r);
  if (Object.values(w.chars).some((c) => c.card.prof === "cook")) for (const r of ["potato_stew", "mushroom_soup", "salad"]) if (!w.recipes.includes(r)) w.recipes.push(r);
  if (Object.values(w.chars).some((c) => c.card.prof === "farmer")) for (const r of ["veggie_mash", "soy_cutlets"]) if (!w.recipes.includes(r)) w.recipes.push(r);
  for (const p of players) p.ready = false;
  if (w.settings.skipPrologue) beginDay(w);
  else {
    w.phase = "prologue";
    w.phaseT = 0;
  }
}

export function beginDay(w: World) {
  w.phase = "day";
  w.phaseT = 0;
  w.hour = 6;
  log(w, `День ${w.day}. Утро под землёй.`, "system");
  fx(w, { k: "toast", text: `День ${w.day}` });
}

/** Stat points a custom character may spread (each stat 1..5). */
export const CUSTOM_STAT_POINTS = 15;
export const HAT_COUNT = 14;
export const HAIR_COUNT = 6;

/** Checks a card from the editor; returns the clean card or an error text. */
export function validateCustomCard(raw: any, goal: string): Card | string {
  if (!raw || typeof raw !== "object") return "Пустая карточка";
  const name = sanitizeName(String(raw.name ?? "")).slice(0, 24);
  if (name.length < 2) return "Нужно имя";
  const prof = String(raw.prof);
  if (!PROFS[prof] || PROFS[prof].npcOnly) return "Нет такой профессии";
  const stats: any = {};
  let sum = 0;
  for (const k of ["sil", "lov", "int", "vyn", "har"]) {
    const v = Math.round(Number(raw.stats?.[k]));
    if (!(v >= 1 && v <= 5)) return "Характеристики — от 1 до 5";
    stats[k] = v;
    sum += v;
  }
  if (sum > CUSTOM_STAT_POINTS) return `Очков характеристик не больше ${CUSTOM_STAT_POINTS}`;
  if (!TRAITS_PLUS[raw.plus] || !TRAITS_MINUS[raw.minus]) return "Выберите черты";
  const pick = <T>(v: any, list: T[], d: T) => (list.includes(v) ? v : d);
  const goals = Object.keys(GOALS).filter((g) => !GOALS[g].hostile && g !== "saboteur");
  return {
    name,
    prof,
    plus: raw.plus,
    minus: raw.minus,
    goal: GOALS[goal] ? goal : goals[0],
    stats,
    color: pick(Number(raw.color), COLORS, COLORS[0]),
    hat: Math.max(0, Math.min(HAT_COUNT - 1, Math.round(Number(raw.hat) || 0))),
    gender: raw.gender === 1 ? 1 : 0,
    age: Math.max(18, Math.min(80, Math.round(Number(raw.age) || 30))),
    phobia: pick(String(raw.phobia), PHOBIAS, PHOBIAS[0]),
    baggage: pick(String(raw.baggage), BAGGAGE, BAGGAGE[0]),
    birthday: Math.max(3, Math.min(38, Math.round(Number(raw.birthday) || 10))),
    skin: Math.max(0, Math.min(4, Math.round(Number(raw.skin) || 0))),
    hair: Math.max(0, Math.min(HAIR_COUNT - 1, Math.round(Number(raw.hair) || 0))),
    custom: true,
  };
}
