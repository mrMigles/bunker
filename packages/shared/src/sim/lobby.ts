import { COLORS } from "../data/characters";
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
  // mid-game: take a free resident automatically if possible
  if (w.phase !== "lobby" && !p.char) autoTake(w, p);
  return p;
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

export function startGame(w: World) {
  const players = Object.values(w.players).filter((p) => p.online);
  const rng = new Rng(w.rng);
  const total = Math.max(players.length, Math.min(6, w.settings.residents));
  const airlock = roomsOfType(w, "airlock")[0];
  const spawnX = airlock ? airlock.x + 1 : 20;
  const taken = new Set<string>();
  let i = 0;
  for (const p of players) {
    const card = p.cards && p.pick !== undefined ? p.cards[p.pick] : makeCard(rng, taken);
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
