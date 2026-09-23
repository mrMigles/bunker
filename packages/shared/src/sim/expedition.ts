import { unitAlive, type Cover, type Door, type Field, type UnitInit } from "../combat/combat";
import { BAL } from "../data/balance";
import { ITEMS, itemName } from "../data/items";
import { FACTIONS, LOC, generateMap, mapPath, travelHours, type MapNode, type WasteMap } from "../expedition/map";
import { generateSite, rollLoot, siteRoomAt, siteWorld, type Site, type SiteCont, type SiteThreat } from "../expedition/site";
import { modViews } from "../net/view";
import { Rng } from "../rng";
import type { Char, World } from "../types";
import { feetY, walkable } from "../world/grid";
import { roomsOfType } from "../world/rooms";
import { defAction, stopTask } from "./actions";
import { battle, battleEndHooks, charUnit, startBattle, type BattleMod } from "./battle";
import { inputHooks, registerCmd } from "./commands";
import { nightHooks } from "./time";
import { addNpc, effectHooks } from "./events";
import { spawnItem } from "./items";
import { stepMove } from "./move";
import { decayNeeds, killChar } from "./needs";
import { onTick } from "./tick";
import { timeMult } from "./time";
import { clamp, firstName, fx, hasTrait, hoursPerSec, isBotDriven, log, rng, skillLevel } from "./util";

export interface SquadTask {
  a: string;
  id: string;
  t: number;
  dur: number;
}

export interface Expedition {
  active: boolean;
  stage: "prep" | "map" | "travel" | "site";
  squad: string[];
  gear: Record<string, number>;
  supplies: Record<string, number>;
  loot: Record<string, number>;
  node: string;
  route: string[];
  from?: string;
  travelLeft: number;
  travelTotal: number;
  site: Site | null;
  tasks: Record<string, SquadTask>;
  light: Record<string, boolean>;
  prepT: number;
  coord: number;
  scanUntil: number;
  offlineT: number;
  recruits: number;
  log: string[];
  day0: number;
  ambushBonus?: boolean;
  /** run by the residents themselves (no player in the squad) */
  auto?: string;
}

// ---------------------------------------------------------------- helpers

/** Arrival hooks (story locations). Return true to take over. */
export const arriveHooks: ((w: World, e: Expedition, n: MapNode) => boolean)[] = [];

export function wmap(w: World): WasteMap {
  return (w.mods.wmap ??= generateMap(w.seed));
}

export function exped(w: World): Expedition | undefined {
  const e = w.mods.expedition as Expedition | undefined;
  return e?.active ? e : undefined;
}

function elog(e: Expedition, text: string) {
  e.log.push(text);
  if (e.log.length > 30) e.log.shift();
}

export function weightOf(items: Record<string, number>) {
  let s = 0;
  for (const k in items) s += (ITEMS[k]?.weight ?? 0.5) * (items[k] ?? 0);
  return Math.round(s * 10) / 10;
}

export function capacity(w: World, squad: string[]) {
  return squad.reduce((s, id) => s + (w.chars[id] ? w.chars[id].card.stats.sil * 6 + 10 : 0), 0);
}

const GEAR_KEYS = ["food_can", "water", "meds", "medkit", "flashlight", "batteries", "lockpick", "crowbar", "pistol", "rifle", "shotgun", "pipe", "knife", "ammo", "molotov", "armor", "gasmask", "radpills", "relay", "nvg", "geiger"];

function isStormLocked(w: World) {
  return (w.flags.storm_until ?? 0) >= w.day || w.weather.today === "storm";
}

export function setDoorState(s: Site, d: Site["doors"][number], state: Site["doors"][number]["state"]) {
  d.state = state;
  const v = state === "open" || state === "broken" ? 0 : 8;
  s.grid[d.lv * 2 * s.W + d.x] = v;
  s.grid[(d.lv * 2 + 1) * s.W + d.x] = v;
}

function initSite(s: Site) {
  for (const d of s.doors) setDoorState(s, d, d.state);
}

function squadChars(w: World, e: Expedition): Char[] {
  return e.squad.map((id) => w.chars[id]).filter((c) => c && c.status !== "dead") as Char[];
}

// ---------------------------------------------------------------- prep at the terminal

export function newExpedition(w: World): Expedition {
  return {
    active: true,
    stage: "prep",
    squad: [],
    gear: {},
    supplies: {},
    loot: {},
    node: "home",
    route: [],
    travelLeft: 0,
    travelTotal: 0,
    site: null,
    tasks: {},
    light: {},
    prepT: 0,
    coord: 0,
    scanUntil: 0,
    offlineT: 0,
    recruits: 0,
    log: [],
    day0: w.day,
  } satisfies Expedition;
}

defAction({
  id: "sortie",
  type: "obj",
  kinds: ["sortie_terminal"],
  prio: 5,
  avail: ({ w }) => {
    const e = w.mods.expedition as Expedition | undefined;
    if (e?.active && e.stage !== "prep") return "📡 Связь с отрядом";
    if (isStormLocked(w)) return { label: "🎒 Вылазка", reason: "Буря — выходить нельзя" };
    if (w.phase !== "day") return null;
    return "🎒 Собрать вылазку…";
  },
  dur: () => 0,
  done: ({ w, c }) => {
    const e = w.mods.expedition as Expedition | undefined;
    if (!e?.active) {
      const e = newExpedition(w);
      w.mods.expedition = e;
      wmap(w);
      // sensible defaults: whoever opened the terminal leads, two residents come along, a base kit is packed
      if (c.status === "ok") e.squad.push(c.id);
      autoSquad(w, e);
      baseKit(w, e);
    }
    if (c.ctrl) fx(w, { k: "news", to: c.ctrl, id: "expedition" });
  },
});

registerCmd("expJoin", (w, p, cmd) => {
  const e = exped(w);
  if (!e || e.stage !== "prep") return "Сначала соберите вылазку у терминала";
  const c = p.char ? w.chars[p.char] : undefined;
  if (!c || c.status !== "ok") return "Нет персонажа";
  if (cmd.v === false) e.squad = e.squad.filter((id) => id !== c.id);
  else if (!e.squad.includes(c.id)) {
    if (e.squad.length >= 3) return "В отряде максимум трое";
    e.squad.push(c.id);
    if (c.card.minus === "claustro") c.needs.sanity = clamp(c.needs.sanity + 5);
  }
});

/** Residents fit to go out: healthy, awake, not already someone's character (players join themselves). */
export function sortieCandidates(w: World, e: Expedition): Char[] {
  return Object.values(w.chars)
    .filter((c) => c.status === "ok" && !e.squad.includes(c.id) && isBotDriven(w, c.id) && !w.players[c.ctrl ?? ""]?.online && c.needs.health > 40 && c.needs.energy > 30)
    .sort((a, b) => sortieScore(b) - sortieScore(a));
}

function sortieScore(c: Char) {
  const role = ["soldier", "doctor", "miner", "engineer"].includes(c.card.prof) ? 3 : 0;
  return role + c.card.stats.sil + c.card.stats.lov + c.needs.health / 25;
}

/** Fill the squad up to three, always leaving at least two residents at home. */
export function autoSquad(w: World, e: Expedition) {
  const home = () => Object.values(w.chars).filter((c) => c.status === "ok" && !e.squad.includes(c.id)).length;
  for (const c of sortieCandidates(w, e)) {
    if (e.squad.length >= 3 || home() <= 2) break;
    e.squad.push(c.id);
  }
}

/** A sensible pack for the current squad: food and water for the road, light, meds, whatever weapons we have. */
export function baseKit(w: World, e: Expedition) {
  const n = Math.max(1, e.squad.length);
  const want: [string, number][] = [
    ["water", n * 2],
    ["food_can", n],
    ["meds", 1],
    ["medkit", 1],
    ["flashlight", 1],
    ["batteries", 2],
    ["rifle", 1],
    ["shotgun", 1],
    ["pistol", 1],
    ["ammo", 8],
    ["crowbar", 1],
    ["pipe", 1],
    ["knife", n],
  ];
  e.gear = {};
  const cap = capacity(w, e.squad);
  for (const [k, target] of want) {
    let take = Math.min(target, Math.floor(w.res[k] ?? 0));
    while (take > 0 && weightOf({ ...e.gear, [k]: take }) > cap) take--;
    if (take > 0) e.gear[k] = take;
  }
}

registerCmd("expAdd", (w, p, cmd) => {
  const e = exped(w);
  if (!e || e.stage !== "prep") return;
  const c = w.chars[String(cmd.char)];
  if (!c || !sortieCandidates(w, e).includes(c)) return "Этот жилец не может пойти";
  if (e.squad.length >= 3) return "В отряде максимум трое";
  e.squad.push(c.id);
});

registerCmd("expRemove", (w, p, cmd) => {
  const e = exped(w);
  if (!e || e.stage !== "prep") return;
  const id = String(cmd.char);
  const c = w.chars[id];
  // players leave on their own (expJoin); anyone may send a bot back
  if (c && !isBotDriven(w, id) && c.ctrl !== p.id) return "Игрок решает сам";
  e.squad = e.squad.filter((x) => x !== id);
});

registerCmd("expAuto", (w) => {
  const e = exped(w);
  if (!e || e.stage !== "prep") return;
  autoSquad(w, e);
  baseKit(w, e);
});

registerCmd("expKit", (w) => {
  const e = exped(w);
  if (!e || e.stage !== "prep") return;
  if (!e.squad.length) return "Сначала отряд";
  baseKit(w, e);
});

registerCmd("expGear", (w, p, cmd) => {
  const e = exped(w);
  if (!e || e.stage !== "prep") return;
  const k = String(cmd.item);
  if (!GEAR_KEYS.includes(k)) return;
  const n = Math.max(0, Math.min(Math.floor(w.res[k] ?? 0), Math.floor(Number(cmd.n) || 0), 30));
  const next = { ...e.gear, [k]: n };
  if (!n) delete next[k];
  if (weightOf(next) > capacity(w, e.squad) + 0.01 && n > (e.gear[k] ?? 0)) return "Слишком тяжело";
  e.gear = next;
});

registerCmd("expRepeat", (w) => {
  const e = exped(w);
  const last = w.mods.lastGear as Record<string, number> | undefined;
  if (!e || e.stage !== "prep" || !last) return "Прошлой вылазки ещё не было";
  e.gear = {};
  for (const k in last) {
    const n = Math.min(last[k], Math.floor(w.res[k] ?? 0));
    if (n > 0) e.gear[k] = n;
  }
});

registerCmd("expCancel", (w) => {
  const e = exped(w);
  if (e?.stage === "prep") delete w.mods.expedition;
});

registerCmd("expStart", (w) => {
  const e = exped(w);
  if (!e || e.stage !== "prep") return;
  return departExpedition(w, e);
});

export function departExpedition(w: World, e: Expedition): string | void {
  if (!e.squad.length) return "Отряд пуст";
  if (isStormLocked(w)) return "Снаружи буря";
  // gear leaves the storage
  for (const k in e.gear) {
    const n = Math.min(e.gear[k], Math.floor(w.res[k] ?? 0));
    w.res[k] = (w.res[k] ?? 0) - n;
    e.supplies[k] = (e.supplies[k] ?? 0) + n;
  }
  w.mods.lastGear = { ...e.gear };
  for (const c of squadChars(w, e)) {
    stopTask(w, c);
    c.status = "away";
    c.hands = [];
    c.climbing = false;
  }
  if (squadChars(w, e).some((c) => c.ctrl)) w.flags.tut_sortie = 1;
  e.stage = "map";
  e.node = "home";
  const names = squadChars(w, e).map(firstName).join(", ");
  log(w, `🎒 Отряд выходит на поверхность: ${names}.`, "event");
  elog(e, "Отряд поднялся наверх. Пепел хрустит под ногами.");
  fx(w, { k: "sound", id: "door" });
}

// ---------------------------------------------------------------- map & travel

registerCmd("expGo", (w, p, cmd) => {
  const e = exped(w);
  if (!e || (e.stage !== "map" && e.stage !== "site")) return "Сейчас нельзя";
  if (!p.char || !e.squad.includes(p.char)) return "Вы не в отряде";
  if (e.stage === "site") {
    const c = w.chars[p.char];
    if (!e.site || c.lv !== e.site.exitLv || Math.abs(c.x - (e.site.exitX + 0.5)) > 1.2) return "Сначала выйдите из здания";
    leaveSite(w, e);
  }
  const m = wmap(w);
  const to = String(cmd.node);
  if (!m.nodes[to]) return "Нет такого места";
  const path = mapPath(m, e.node, to, true);
  if (!path || path.length < 2) return "Туда нет известной дороги";
  e.route = path.slice(1);
  startLeg(w, e);
});

export { startLeg as startLegPublic };

function startLeg(w: World, e: Expedition) {
  const m = wmap(w);
  const next = e.route[0];
  if (!next) return;
  e.from = e.node;
  e.travelTotal = travelHours(m.nodes[e.node], m.nodes[next], w.weather.today) * (weightOf({ ...e.supplies, ...e.loot }) > capacity(w, e.squad) ? 1.4 : 1);
  e.travelLeft = e.travelTotal;
  e.stage = "travel";
  elog(e, `Путь: ${m.nodes[next].known ? m.nodes[next].name : "неизвестное место"} (~${e.travelTotal.toFixed(1)} ч).`);
}

function arrive(w: World, e: Expedition) {
  const m = wmap(w);
  const id = e.route.shift()!;
  e.node = id;
  const n = m.nodes[id];
  n.known = true;
  n.visited = true;
  for (const j of n.links) if (!m.nodes[j].hidden) m.nodes[j].known = true;
  if (id === "home") {
    returnHome(w, e);
    return;
  }
  elog(e, `Прибыли: ${n.name}.`);
  for (const h of arriveHooks) if (h(w, e, n)) return;
  if ((n.type === "trader" || n.type === "camp") && !w.mods.stock?.[n.id]) (w.mods.stock ??= {})[n.id] = traderStock(w, n.id);
  if (e.route.length) {
    startLeg(w, e);
    return;
  }
  e.stage = "map";
  // hostile faction camps attack on sight
  if (n.type === "camp" && n.faction && (w.factions[n.faction] ?? 0) < -30) {
    elog(e, `${FACTIONS[n.faction].name} встречают отряд огнём!`);
    roadFight(w, e, n.faction === "order" ? ["soldier", "soldier"] : n.faction === "flash" ? ["cultist", "cultist"] : ["raider", "marauder", "marauder"]);
  }
}

registerCmd("expEnter", (w, p) => {
  const e = exped(w);
  if (!e || e.stage !== "map") return;
  if (!p.char || !e.squad.includes(p.char)) return "Вы не в отряде";
  const n = wmap(w).nodes[e.node];
  if (!LOC.types[n.type]) return "Здесь нечего обследовать";
  enterSite(w, e, n);
});

export function enterSite(w: World, e: Expedition, n: MapNode) {
  if (!n.site) {
    const seed = (w.seed * 13 + Number(n.id.replace(/\D/g, "") || 99) * 7919) | 0;
    n.site = generateSite(n.id, n.type, seed, n.danger, n.theme, { radioPart: !!(LOC.types[n.type]?.radioPart && w.flags.ark_goal) });
    initSite(n.site);
  } else {
    // revisits: other scavengers may have come by
    const R = rng(w);
    const s = n.site as Site;
    if (R.chance(0.4)) {
      const r = R.pick(s.rooms.filter((x) => !x.stairs));
      s.threats.push({ id: "t" + w.nextId++, etype: R.pick(["marauder", "dog", "rat"]), x: r.x + 1, lv: r.lv, dir: 1, state: "patrol", detect: 0, room: r.id });
      elog(e, "Похоже, здесь кто-то побывал после нас…");
    }
    s.noise = 0;
    s.spawned = 0;
  }
  e.site = n.site as Site;
  e.stage = "site";
  const s = e.site;
  squadChars(w, e).forEach((c, i) => {
    c.x = s.exitX + 0.5 + i * 0.3;
    c.lv = s.exitLv;
    c.y = feetY(c.lv);
    c.climbing = false;
    c.anim = "idle";
  });
  elog(e, `Вошли: ${n.name}. «${s.theme}».`);
  fx(w, { k: "toast", text: `🏚 ${n.name}` });
}

function leaveSite(w: World, e: Expedition) {
  const m = wmap(w);
  const n = m.nodes[e.node];
  if (e.site) {
    n.site = e.site;
    n.looted = e.site.conts.filter((c) => c.searched >= 1).length / Math.max(1, e.site.conts.length);
  }
  e.site = null;
  e.stage = "map";
  e.tasks = {};
}

registerCmd("expLeaveSite", (w, p) => {
  const e = exped(w);
  if (!e || e.stage !== "site" || !e.site) return;
  const c = p.char ? w.chars[p.char] : undefined;
  if (!c || c.lv !== e.site.exitLv || Math.abs(c.x - (e.site.exitX + 0.5)) > 1.2) return "Выход — на первом этаже слева";
  leaveSite(w, e);
});

registerCmd("expHome", (w, p) => {
  const e = exped(w);
  if (!e || (e.stage !== "map" && e.stage !== "site")) return;
  if (!p.char || !e.squad.includes(p.char)) return "Вы не в отряде";
  if (e.stage === "site") leaveSite(w, e);
  const path = mapPath(wmap(w), e.node, "home", false);
  if (!path) return "Дороги нет";
  if (path.length < 2) return returnHome(w, e);
  e.route = path.slice(1);
  startLeg(w, e);
});

export function returnHome(w: World, e: Expedition) {
  const airlock = roomsOfType(w, "airlock")[0];
  const x0 = airlock ? airlock.x + 1 : 20;
  const lv = airlock?.lv ?? 0;
  for (const c of e.squad.map((id) => w.chars[id]).filter(Boolean)) {
    if (c.status === "dead") continue;
    c.status = "ok";
    c.x = x0 + 0.5;
    c.lv = lv;
    c.y = feetY(lv);
    c.mind.plan = "idle";
    c.mind.idleT = 1;
  }
  // loot & remaining supplies come back as physical items at the airlock
  const all: Record<string, number> = { ...e.supplies };
  for (const k in e.loot) all[k] = (all[k] ?? 0) + e.loot[k];
  const summary: string[] = [];
  const R = rng(w);
  let i = 0;
  for (const k in all) {
    let n = Math.floor(all[k]);
    if (n <= 0) continue;
    if (e.loot[k]) summary.push(`${ITEMS[k]?.icon ?? ""}${itemName(k)}×${Math.floor(e.loot[k])}`);
    if (k === "newspaper") {
      for (let j = 0; j < n; j++) w.unread.push("rand" + R.int(0, 9999));
      continue;
    }
    if (k === "tape") {
      for (let j = 0; j < n; j++) w.tapes.push("tape" + w.tapes.length);
      continue;
    }
    if (k === "book") {
      const unowned = ["medical", "garden", "tactics", "mining", "stealth"].filter((b) => !w.books.includes(b));
      for (let j = 0; j < n && unowned.length; j++) w.books.push(unowned.shift()!);
      continue;
    }
    if (k === "film") {
      for (let j = 0; j < n; j++) w.films.push("film" + w.films.length);
      continue;
    }
    if (k === "radio_part") {
      w.flags.radio_parts = (w.flags.radio_parts ?? 0) + n;
      log(w, `📻 Деталь дальней рации! (${w.flags.radio_parts}/3)`, "good");
      continue;
    }
    if (k === "key") continue;
    if (k.startsWith("bg_")) {
      for (let j = 0; j < n; j++) addBoardGame(w, k === "bg_random" ? undefined : k.slice(3));
      continue;
    }
    while (n > 0) {
      const chunk = ITEMS[k]?.large ? 1 : Math.min(n, 10);
      spawnItem(w, k, chunk, x0 + 1 + (i++ % 3) * 0.35, lv);
      n -= chunk;
    }
  }
  for (let r = 0; r < e.recruits; r++) addNpc(w, "random");
  log(w, `🏠 Отряд вернулся${summary.length ? ": " + summary.slice(0, 10).join(", ") : " с пустыми руками"}. Разберите добычу у шлюза!`, "good");
  fx(w, { k: "toast", text: "🏠 Отряд дома!" });
  fx(w, { k: "sound", id: "door" });
  w.notice = clamp(w.notice + 4);
  delete w.mods.expedition;
}

export const BOX_POOL = ["cards52", "domino", "checkers", "chess", "backgammon", "dice", "lotto", "magnate", "wasteland", "mafia"];
export const BOX_NAMES: Record<string, string> = { cards36: "Колода 36 карт", cards52: "Колода 52 карты", domino: "Домино", checkers: "Шашки", chess: "Шахматы", backgammon: "Нарды", dice: "Кости «Генерал»", lotto: "Лото «Бочонки»", magnate: "«Бункер-Магнат»", wasteland: "«Пустошь»", mafia: "Мафия" };

export function addBoardGame(w: World, box?: string) {
  const R = rng(w);
  const pool = BOX_POOL.filter((b) => !w.games.includes(b));
  const b = box && !w.games.includes(box) ? box : pool.length ? R.pick(pool) : undefined;
  if (!b) {
    w.res.cards52 = (w.res.cards52 ?? 0) + 1;
    return;
  }
  w.games.push(b);
  if ((b === "chess" || b === "checkers") && R.chance(0.35)) {
    w.flags["incomplete_" + b] = 1;
    log(w, `🎲 На полке у стола: ${BOX_NAMES[b]} (нет двух фигур — выточите в Мастерской).`, "good");
  } else log(w, `🎲 На полке у стола новая игра: ${BOX_NAMES[b]}!`, "good");
}

// ---------------------------------------------------------------- road encounters & fights

function roadField(seed: number): Field {
  const cols = 14;
  const covers: Cover[] = [];
  const R = Rng.from(seed);
  for (let i = 0; i < 4; i++) covers.push({ col: R.int(3, 11), floor: 0, kind: R.chance(0.4) ? "full" : "half", hp: 4, name: "обломки" });
  return { cols, floors: 1, walk: new Array(cols).fill(true), ladders: [], covers, doors: [], exits: [{ col: 0, floor: 0 }], loot: [], originX: 0, originLv: 0 };
}

export function roadFight(w: World, e: Expedition, enemies: string[], onEnd = "expedition", tag = "road") {
  // the residents' own runs avoid set-piece fights: they hide, run, or take a beating
  if (e.auto && tag === "road" && squadChars(w, e).every((c) => isBotDriven(w, c.id))) return autoSkirmish(w, e, enemies);
  const taken: Record<string, number> = {};
  const allies: UnitInit[] = squadChars(w, e).map((c, i) => squadUnit(w, e, c, 1 + i, 0, taken));
  const foes: UnitInit[] = enemies.map((t, i) => ({ id: "e" + i, side: "enemy", name: "", col: 12 - (i % 3), floor: 0, etype: t }));
  startBattle(w, roadField((rng(w).next() * 1e9) | 0), allies, foes, "expedition", { coordination: e.coord, onEnd, tag });
  e.coord = 0;
}

function autoSkirmish(w: World, e: Expedition, enemies: string[]) {
  const R = rng(w);
  const squad = squadChars(w, e);
  const armed = ["pistol", "rifle", "shotgun", "pipe", "knife"].some((k) => (e.supplies[k] ?? 0) > 0);
  const threat = enemies.length * (enemies.some((t) => ["raider", "marauder", "soldier"].includes(t)) ? 1.5 : 1) * (armed ? 0.6 : 1);
  for (const c of squad) {
    const dmg = R.int(8, 18) * threat;
    // wounded, never killed outright: they crawl on
    c.needs.health = clamp(c.needs.health - dmg, 8, 100);
    c.needs.sanity = clamp(c.needs.sanity - 6);
  }
  const lost: string[] = [];
  for (const k of Object.keys(e.loot))
    if (R.chance(0.35)) {
      const n = Math.ceil(e.loot[k] / 2);
      e.loot[k] -= n;
      lost.push(itemName(k));
    }
  const text = `Стычка в пути (${enemies.length} против ${squad.length}): отряд отбился, но потрёпан${lost.length ? `; бросили часть добычи (${lost.slice(0, 3).join(", ")})` : ""}.`;
  elog(e, text);
  log(w, `⚔ ${text}`, "bad");
}

/** Combat unit for a squad member: weapons come from the squad's supplies. */
function squadUnit(w: World, e: Expedition, c: Char, col: number, floor: number, taken: Record<string, number>): UnitInit {
  const pool: Record<string, number> = {};
  for (const k of ["rifle", "shotgun", "pistol", "knife", "pipe", "medkit", "meds", "molotov", "armor"]) pool[k] = (e.supplies[k] ?? 0) + (e.loot[k] ?? 0);
  const fakeW = { ...w, res: pool } as World;
  const u = charUnit(fakeW, c, col, floor, taken);
  u.ammo = Math.min(u.ammo ?? 0, (e.supplies.ammo ?? 0) + 2);
  return u;
}

battleEndHooks.expedition = (w, b: BattleMod) => {
  const e = exped(w);
  if (!e) return;
  const s = b.state;
  const loot = (b as any).loot as Record<string, number>;
  for (const k in loot) e.loot[k] = (e.loot[k] ?? 0) + loot[k];
  // consumed gear
  for (const u of Object.values(s.units)) {
    if (u.side !== "ally") continue;
    const init = b.initItems?.[u.id] ?? {};
    for (const it in init) {
      const used = init[it] - (u.items[it] ?? 0);
      if (used > 0) e.supplies[it] = Math.max(0, (e.supplies[it] ?? 0) - used);
    }
    if (u.maxAmmo) e.supplies.ammo = Math.max(0, (e.supplies.ammo ?? 0) - Math.max(0, u.maxAmmo - u.ammo));
  }
  if (e.site && b.tag === "site") {
    const site = e.site;
    for (const u of Object.values(s.units)) {
      if (u.side !== "enemy") continue;
      const t = site.threats.find((x) => "e_" + x.id === u.id);
      if (!t) continue;
      if (!unitAlive(u)) {
        site.threats = site.threats.filter((x) => x !== t);
        if (u.tags.includes("human")) site.conts.push({ id: "c" + w.nextId++, kind: "corpse", name: `Тело: ${u.name}`, x: Math.max(1, Math.min(site.W - 2, u.col)), lv: u.floor, size: 3, table: "corpse", searched: 0, locked: false });
      } else if (u.fled) site.threats = site.threats.filter((x) => x !== t);
      else {
        t.x = u.col;
        t.lv = u.floor;
        t.state = "alert";
      }
    }
    // squad positions back into the site
    for (const u of Object.values(s.units)) {
      if (u.side !== "ally" || !u.char) continue;
      const c = w.chars[u.char];
      if (c && c.status !== "dead") {
        c.x = u.col + 0.5;
        c.lv = u.floor;
        c.y = feetY(c.lv);
      }
    }
    site.noise = clamp(site.noise + 20);
  }
  if (s.result === "lose") {
    // the squad is overrun: each downed member either dies or crawls home robbed
    const R = rng(w);
    for (const c of squadChars(w, e)) {
      if (c.status === "dead") continue;
      // being overrun costs loot and blood; death is the exception, not the rule
      const n = wmap(w).nodes[e.node];
      if (R.chance(0.05 * (n?.danger ?? 1))) killChar(w, c, "погиб(ла) в вылазке");
      else {
        c.needs.health = Math.max(12, Math.min(c.needs.health, 30));
        c.injury ??= R.chance(0.5) ? "bleed" : null;
      }
    }
    e.loot = {};
    for (const k in e.supplies) e.supplies[k] = Math.floor(e.supplies[k] / 2);
    elog(e, "Отряд разбит. Бросив добычу, раненые отходят домой…");
    const path = mapPath(wmap(w), e.node, "home", false);
    if (squadChars(w, e).length && path) {
      if (e.stage === "site") leaveSite(w, e);
      e.route = path.slice(1);
      if (e.route.length) startLeg(w, e);
      else returnHome(w, e);
    } else {
      delete w.mods.expedition;
    }
  } else if (s.result === "fled") {
    // fleeing costs part of the loot
    for (const k in e.loot) e.loot[k] = Math.floor(e.loot[k] / 2);
    elog(e, "Бежали, бросив часть добычи.");
  }
  // hidden goal "armory": being on the expedition when the checkpoint armory is found is handled on search
};

// ---------------------------------------------------------------- per-tick simulation

onTick("expedition", "*", (w, dt) => {
  const e = exped(w);
  if (!e) return;
  if (e.stage === "prep") {
    e.prepT += dt;
    if (w.phase !== "day") delete w.mods.expedition;
    return;
  }
  if (battle(w)) return; // fights pause exploration
  const hours = w.phase === "day" ? dt * hoursPerSec(w) * timeMult(w) : 0;
  const squad = squadChars(w, e);
  if (!squad.length) {
    delete w.mods.expedition;
    return;
  }
  // needs of the squad outside (the bunker tick skips "away" characters)
  if (hours > 0) {
    for (const c of squad) {
      decayNeeds(w, c, hours);
      eatFromSupplies(w, e, c);
      if (w.weather.today === "radrain" || e.site?.rad) c.needs.rad = clamp(c.needs.rad + (w.weather.today === "radrain" ? 6 : 12) * hours * ((e.supplies.gasmask ?? 0) > 0 ? 0.5 : 1));
      if (hasTrait(c, "claustro")) c.needs.sanity = clamp(c.needs.sanity + 1.5 * hours);
      if (c.needs.health <= 0) killChar(w, c, "не вернулся(ась) из вылазки");
    }
  }
  // everyone offline → the squad walks home on its own after 3 minutes
  const online = squad.some((c) => !isBotDriven(w, c.id));
  e.offlineT = online ? 0 : e.offlineT + dt;
  if (e.offlineT > 180 && e.stage !== "travel") {
    elog(e, "Связь с отрядом потеряна — они возвращаются сами.");
    if (e.stage === "site") leaveSite(w, e);
    const path = mapPath(wmap(w), e.node, "home", false);
    if (path && path.length > 1) {
      e.route = path.slice(1);
      startLeg(w, e);
    } else returnHome(w, e);
    e.offlineT = 0;
    return;
  }
  if (e.stage === "travel") {
    if (hours <= 0) return; // camp at night
    // legs play out twice as fast as bunker time: the road is a transition, not the game
    e.travelLeft -= hours * 2;
    // encounters: roughly one roll per hour of travel
    w.flags._encT = (w.flags._encT ?? 0) + hours;
    if (w.flags._encT >= 1) {
      w.flags._encT = 0;
      const n = wmap(w).nodes[e.route[0]];
      const R = rng(w);
      const early = w.day <= 3 ? 0.5 : 1;
      if (R.chance((0.06 + (n?.danger ?? 1) * 0.04) * early)) {
        const kind = R.pick(["dogs", "raiders", "trader", "ruins"]);
        if (kind === "dogs") {
          elog(e, "На дороге — стая диких собак!");
          roadFight(w, e, ["dog", "dog", R.chance(0.5) ? "dog" : "rat"]);
        } else if (kind === "raiders") {
          elog(e, "Засада мародёров!");
          roadFight(w, e, ["marauder", "raider"]);
        } else if (kind === "trader") {
          elog(e, "Встретили бродячего торговца — поменялись мелочами.");
          e.loot.cigarettes = (e.loot.cigarettes ?? 0) + 1;
        } else {
          elog(e, "По пути — развалины. Нашли кое-что.");
          const l = rollLoot("base", R, 1);
          for (const k in l) e.loot[k] = (e.loot[k] ?? 0) + l[k];
        }
      }
    }
    if (e.travelLeft <= 0) arrive(w, e);
    return;
  }
  if (e.stage === "site" && e.site) siteTick(w, e, e.site, dt);
});

function eatFromSupplies(w: World, e: Expedition, c: Char) {
  if (c.needs.food < 45) {
    const k = (e.supplies.food_can ?? 0) >= 1 ? "supplies" : (e.loot.food_can ?? 0) >= 1 ? "loot" : null;
    if (k) {
      (e as any)[k].food_can -= 1;
      c.needs.food = clamp(c.needs.food + BAL.foodPerUnit);
    }
  }
  if (c.needs.water < 45) {
    const k = (e.supplies.water ?? 0) >= 1 ? "supplies" : (e.loot.water ?? 0) >= 1 ? "loot" : null;
    if (k) {
      (e as any)[k].water -= 1;
      c.needs.water = clamp(c.needs.water + BAL.waterPerUnit);
    }
  }
}

// the squad camps at night: 8 hours of needs from their own supplies
nightHooks.end.push((w) => {
  const e = exped(w);
  if (!e || e.stage === "prep") return;
  for (const c of squadChars(w, e)) {
    decayNeeds(w, c, 8, { asleep: true, sleepRate: 6 });
    eatFromSupplies(w, e, c);
    eatFromSupplies(w, e, c);
  }
});

// ---------------------------------------------------------------- inside a site

const SNEAK_SPEED = 0.55;

inputHooks.push((w, c, inp) => {
  if (c.status !== "away") return false;
  const e = exped(w);
  if (!e || e.stage !== "site" || !e.site || battle(w)) {
    c.seq = inp.seq;
    return true;
  }
  const mx = Math.sign(Number(inp.mx) || 0);
  const my = Math.sign(Number(inp.my) || 0);
  const dt = Math.max(0, Math.min(0.1, Number(inp.dt) || 0));
  if ((mx || my) && e.tasks[c.id]) delete e.tasks[c.id];
  const sneak = !!inp.run; // in a site Shift means sneaking
  c.run = false;
  const before = c.x;
  // walking into an unlocked door opens it (quietly when sneaking); a locked one says what it needs
  if (mx && !c.climbing) {
    const cell = Math.floor(c.x + mx * 0.62);
    const d = e.site.doors.find((x) => x.lv === c.lv && x.x === cell);
    if (d?.state === "closed") {
      setDoorState(e.site, d, "open");
      e.site.noise = clamp(e.site.noise + (sneak ? 1 : 4));
      fx(w, { k: "sound", id: "door" });
    } else if (d?.state === "locked" && !(d as any).hinted) {
      (d as any).hinted = 1;
      elog(e, "🔒 Дверь заперта: отмычка, лом или выбить (подойдите и нажмите E).");
      fx(w, { k: "toast", text: "🔒 Заперто — отмычка, лом или выбить (E)" });
    }
  }
  stepMove(siteWorld(e.site), c, mx, my, sneak ? dt * SNEAK_SPEED : dt);
  c.seq = inp.seq;
  if (mx || my) {
    (c as any).__sneak = sneak;
    const moved = Math.abs(c.x - before);
    e.site.noise = clamp(e.site.noise + (sneak ? 0 : moved * 1.2));
    onStep(w, e, e.site, c);
  }
  return true;
});

function onStep(w: World, e: Expedition, s: Site, c: Char) {
  const cx = Math.floor(c.x);
  const R = rng(w);
  for (const hz of s.hazards) {
    if (!hz.armed || hz.lv !== c.lv || hz.x !== cx) continue;
    // a spotted wire is simply stepped over
    if (hz.known && hz.kind === "tripwire") continue;
    switch (hz.kind) {
      case "tripwire":
        hz.armed = false;
        hz.known = true;
        c.needs.health = clamp(c.needs.health - 14);
        s.noise = clamp(s.noise + 30);
        elog(e, `💥 ${firstName(c)} задевает растяжку!`);
        fx(w, { k: "sound", id: "boom" });
        break;
      case "weak_floor": {
        // a floor you were warned about is crossed carefully along the wall
        const careful = hz.known ? 8 : 0;
        hz.known = true;
        if (R.d20() + c.card.stats.lov + careful < 13) {
          hz.armed = false;
          c.needs.health = clamp(c.needs.health - 12);
          c.injury = R.chance(0.4) ? "leg" : c.injury;
          s.noise = clamp(s.noise + 25);
          elog(e, `🕳 Пол проваливается под ${firstName(c)}!`);
          // fall one level if possible
          if (c.lv + 1 < s.H / 2 && walkable(siteWorld(s), cx, c.lv + 1)) {
            c.lv += 1;
            c.y = feetY(c.lv);
          }
        }
        break;
      }
      case "glass":
        hz.known = true;
        if (!(c as any).__sneak) s.noise = clamp(s.noise + 5);
        break;
      case "gas":
        hz.known = true;
        if (e.light[c.id] && R.chance(0.02)) {
          elog(e, "⚠ Пахнет газом. Лучше не щёлкать зажигалкой…");
        }
        break;
      case "rad":
        hz.known = true;
        break;
    }
  }
}

function siteTick(w: World, e: Expedition, s: Site, dt: number) {
  const squad = squadChars(w, e);
  const R = rng(w);
  s.noise = clamp(s.noise - 3.5 * dt);
  // flashlights eat batteries
  for (const id in e.light) {
    if (!e.light[id]) continue;
    e.supplies.batteries = Math.max(0, (e.supplies.batteries ?? 0) - 0.004 * dt);
    if ((e.supplies.batteries ?? 0) <= 0) {
      e.light[id] = false;
      elog(e, "🔦 Батарейки сели.");
    }
  }
  // bot squad members follow the nearest player, help with searches
  const leader = squad.find((c) => !isBotDriven(w, c.id)) ?? squad[0];
  for (const c of squad) {
    if (!isBotDriven(w, c.id) || c === leader) continue;
    const lt = e.tasks[leader.id];
    if (lt && !e.tasks[c.id] && Math.abs(c.x - leader.x) < 1.5 && c.lv === leader.lv) e.tasks[c.id] = { ...lt, t: 0 };
    if (e.tasks[c.id]) continue;
    const tx = leader.x - 0.9;
    if (c.lv !== leader.lv) {
      // go to the stairs and climb
      const stairX = 2.5;
      if (Math.abs(c.x - stairX) > 0.1 && !c.climbing) stepMove(siteWorld(s), c, Math.sign(stairX - c.x), 0, dt);
      else stepMove(siteWorld(s), c, 0, Math.sign(leader.lv - c.lv), dt);
    } else if (Math.abs(tx - c.x) > 0.4) stepMove(siteWorld(s), c, Math.sign(tx - c.x), 0, dt * ((leader as any).__sneak ? SNEAK_SPEED : 1));
  }
  // reveal rooms
  for (const c of squad) {
    const r = siteRoomAt(s, Math.floor(c.x), c.lv);
    if (r && !r.revealed) {
      r.revealed = true;
      if (r.dark && !e.light[c.id]) elog(e, `Темно: ${r.name}. Нужен фонарик (L).`);
    }
    // peeking through an open door
    for (const d of s.doors) {
      if (d.lv !== c.lv || d.state === "closed" || d.state === "locked" || Math.abs(d.x + 0.5 - c.x) > 1.1) continue;
      for (const nx of [d.x - 1, d.x + 1]) {
        const nr = siteRoomAt(s, nx, d.lv);
        if (nr) nr.revealed = true;
      }
    }
    // spotting traps a couple of steps ahead: easy with light, a gamble in the dark
    const lit = e.light[c.id] || (r && !r.dark);
    for (const hz of s.hazards) {
      if (hz.known || !hz.armed || hz.lv !== c.lv || hz.kind === "glass") continue;
      const d = (hz.x + 0.5 - c.x) * (c.dir || 1);
      if (d < -0.3 || d > 2.8) continue;
      if (R.chance(dt * (lit ? 1.6 : 0.5) * (1 + skillLevel(c, "stealth") * 0.1))) {
        hz.known = true;
        const what = hz.kind === "tripwire" ? "растяжка" : hz.kind === "weak_floor" ? "гнилой пол" : hz.kind === "gas" ? "запах газа" : "радиация";
        elog(e, `⚠ ${firstName(c)}: «Стой! Впереди ${what}»`);
        fx(w, { k: "toast", text: `⚠ Впереди ${what}` });
      }
    }
    if (r?.rad) c.needs.rad = clamp(c.needs.rad + dt * 0.25 * ((e.supplies.gasmask ?? 0) > 0 ? 0.5 : 1));
    for (const hz of s.hazards) if (hz.kind === "rad" && hz.lv === c.lv && Math.abs(hz.x + 0.5 - c.x) < 1.5) c.needs.rad = clamp(c.needs.rad + dt * 0.6);
  }
  // tasks
  for (const id in e.tasks) {
    const t = e.tasks[id];
    const c = w.chars[id];
    if (!c || c.status === "dead") {
      delete e.tasks[id];
      continue;
    }
    c.anim = "work";
    // co-op containers progress only with two people
    const cont = s.conts.find((x) => x.id === t.id);
    const helpers = Object.values(e.tasks).filter((o) => o.id === t.id && o.a === t.a).length;
    if (cont?.coop && t.a === "search" && helpers < 2) continue;
    t.t += dt * (1 + (helpers - 1) * 0.5);
    if (t.t >= t.dur) {
      delete e.tasks[id];
      finishSiteTask(w, e, s, c, t);
    }
  }
  // threats
  const tAcc = (w.flags._thrT = (w.flags._thrT ?? 0) + dt);
  if (tAcc >= 0.25) {
    w.flags._thrT = 0;
    threatsThink(w, e, s, squad, 0.25, R);
  }
  // reinforcements drawn by noise
  if (s.noise >= 55 && s.spawned < 1) {
    s.spawned = 1;
    for (let i = 0; i < 2; i++) s.threats.push({ id: "t" + w.nextId++, etype: "dog", x: s.exitX + i, lv: s.exitLv, dir: 1, state: "alert", detect: 60, room: s.rooms[0].id, tx: leader.x });
    elog(e, "🐕 Лай у входа — на шум сбегаются собаки!");
    fx(w, { k: "sound", id: "alarm" });
  } else if (s.noise >= 80 && s.spawned < 2) {
    s.spawned = 2;
    for (const t of ["marauder", "raider"]) s.threats.push({ id: "t" + w.nextId++, etype: t, x: s.exitX, lv: s.exitLv, dir: 1, state: "alert", detect: 60, room: s.rooms[0].id, tx: leader.x });
    elog(e, "🏴 На шум пришли мародёры с улицы!");
  }
}

function doorBetween(s: Site, lv: number, a: number, b: number) {
  const lo = Math.min(a, b),
    hi = Math.max(a, b);
  return s.doors.some((d) => d.lv === lv && d.x > lo && d.x < hi && (d.state === "closed" || d.state === "locked"));
}

function threatsThink(w: World, e: Expedition, s: Site, squad: Char[], dt: number, R: Rng) {
  for (const t of s.threats) {
    const room = s.rooms.find((r) => r.id === t.room) ?? siteRoomAt(s, t.x, t.lv);
    // waking up
    if (t.state === "asleep") {
      const close = squad.some((c) => c.lv === t.lv && Math.abs(c.x - t.x) < 5);
      if ((s.noise > 35 && close) || s.noise > 65) {
        t.state = "idle";
        elog(e, t.etype === "rat" ? "Крысы просыпаются и пищат…" : t.etype === "dog" ? "Собака поднимает голову…" : "Кто-то шевелится в темноте…");
      } else continue;
    }
    // movement
    const speed = t.etype === "dog" || t.etype === "rat" ? 1.6 : 0.9;
    if (t.state === "patrol" && room) {
      const nx = t.x + t.dir * speed * dt;
      if (nx < room.x || nx > room.x + room.w - 1) t.dir = (t.dir * -1) as 1 | -1;
      else t.x = nx;
    } else if (t.state === "alert" && t.tx !== undefined) {
      const dx = t.tx - t.x;
      t.dir = dx >= 0 ? 1 : -1;
      if (Math.abs(dx) > 0.3) {
        const nx = t.x + Math.sign(dx) * speed * 1.4 * dt;
        const cell = Math.floor(nx);
        if (s.grid[t.lv * 2 * s.W + cell] === 0) t.x = nx;
        else if (t.etype === "raider" || t.etype === "marauder") {
          // they open doors
          const d = s.doors.find((x) => x.lv === t.lv && x.x === cell);
          if (d && d.state === "closed") setDoorState(s, d, "open");
        }
      }
    } else if (t.state === "idle" && R.chance(0.02)) t.dir = (t.dir * -1) as 1 | -1;
    // perception
    let seen: Char | null = null;
    for (const c of squad) {
      if (c.lv !== t.lv) continue;
      const dx = c.x - t.x;
      const cr = siteRoomAt(s, Math.floor(c.x), c.lv);
      const lit = e.light[c.id] || (cr && !cr.dark);
      let range = 4.5 + (e.light[c.id] ? 3 : 0) - ((c as any).__sneak ? 1.5 : 0) - (cr?.dark && !e.light[c.id] ? 2 : 0);
      if (t.etype === "dog") range += 1.5;
      const inFront = Math.sign(dx) === t.dir || Math.abs(dx) < 1.1;
      if (!inFront || Math.abs(dx) > range || doorBetween(s, c.lv, c.x, t.x)) continue;
      const rate = ((c as any).__sneak ? 25 : 55) * (lit ? 1 : 0.6) * (1.3 - Math.abs(dx) / range) * (1 - skillLevel(c, "stealth") * 0.04);
      t.detect = clamp(t.detect + rate * dt);
      seen = c;
    }
    if (!seen) t.detect = clamp(t.detect - 25 * dt);
    else if (t.detect > 40 && t.state !== "alert") {
      t.state = "alert";
      t.tx = seen.x;
    }
    if (t.detect >= 100) {
      elog(e, `⚠ Вас заметили!`);
      siteFight(w, e, s, false);
      return;
    }
    // noise attracts awake threats
    if (t.state !== "alert" && s.noise > 45 && squad.length) {
      t.state = "alert";
      t.tx = squad[0].x;
    }
  }
}

/** Converts the site into a battlefield and starts a fight with nearby threats. */
export function siteFight(w: World, e: Expedition, s: Site, ambush: boolean) {
  const walk: boolean[] = [];
  const floors = s.H / 2;
  for (let lv = 0; lv < floors; lv++) for (let x = 0; x < s.W; x++) walk.push(s.grid[lv * 2 * s.W + x] === 0 || s.grid[lv * 2 * s.W + x] === 8);
  const doors: Door[] = s.doors.map((d) => ({ col: d.x, floor: d.lv, closed: d.state === "closed" || d.state === "locked", hp: d.state === "locked" ? 14 : 8 }));
  const covers: Cover[] = s.conts.filter((c) => c.cover).map((c) => ({ col: c.x, floor: c.lv, kind: c.cover!, hp: 5, name: c.name }));
  const ladders = Object.keys(s.ladders);
  const field: Field = { cols: s.W, floors, walk, ladders, covers, doors, exits: [{ col: s.exitX, floor: s.exitLv }], loot: [], originX: 0, originLv: 0 };
  const squad = squadChars(w, e);
  const taken: Record<string, number> = {};
  const allies = squad.map((c) => squadUnit(w, e, c, Math.floor(c.x), c.lv, taken));
  const near = s.threats.filter((t) => squad.some((c) => c.lv === t.lv && Math.abs(c.x - t.x) < (t.state === "alert" ? 9 : t.state === "asleep" ? 3 : 6)));
  const foes: UnitInit[] = (near.length ? near : s.threats.slice(0, 2)).map((t) => ({ id: "e_" + t.id, side: "enemy", name: "", col: Math.max(1, Math.min(s.W - 2, Math.round(t.x))), floor: t.lv, etype: t.etype }));
  if (!foes.length) return;
  startBattle(w, field, allies, foes, "expedition", { coordination: e.coord + (ambush ? 1 : 0), onEnd: "expedition", tag: "site" });
  e.coord = 0;
  e.tasks = {};
  if (ambush) {
    const b = battle(w)!;
    for (const u of Object.values(b.state.units)) if (u.side === "enemy") u.ap = Math.max(1, u.ap - 2);
  }
}

// ---------------------------------------------------------------- site actions (shared by server validation & client prompt)

export interface SiteAction {
  a: string;
  id: string;
  label: string;
  reason?: string;
  dur: number;
}

export function listSiteActions(e: Expedition, s: Site, c: Char, flags: Record<string, number> = {}): SiteAction[] {
  const out: SiteAction[] = [];
  if (c.climbing) return out;
  const cx = c.x;
  const near = (x: number, lv: number, r = 1.05) => lv === c.lv && Math.abs(x + 0.5 - cx) <= r;
  const light = !!e.light[c.id];
  const room = siteRoomAt(s, Math.floor(cx), c.lv);
  const darkMul = room?.dark && !light ? 2 : 1;
  const has = (k: string) => (e.supplies[k] ?? 0) + (e.loot[k] ?? 0) >= 1;
  for (const ct of s.conts) {
    if (!near(ct.x, ct.lv) || ct.searched >= 1) continue;
    if (ct.locked) {
      const keyDet = s.details.find((d) => d.unlocks === ct.id && d.taken);
      if (keyDet) out.push({ a: "unlock", id: ct.id, label: `🔑 Открыть ключом: ${ct.name}`, dur: 1.5 });
      if (has("lockpick")) out.push({ a: "pick", id: ct.id, label: `🗝️ Отмычка: ${ct.name} (тихо)`, dur: 7 });
      if (has("crowbar")) out.push({ a: "pry", id: ct.id, label: `🦯 Вскрыть ломом: ${ct.name} (шумно)`, dur: 3 });
      if (!has("lockpick") && !has("crowbar") && !keyDet) out.push({ a: "pry", id: ct.id, label: `🔒 ${ct.name}`, reason: "Заперто: нужны отмычки, лом или ключ", dur: 0 });
      continue;
    }
    out.push({ a: "search", id: ct.id, label: `${ct.coop ? "🤝 Разобрать (нужны двое)" : "🔍 Обыскать"}: ${ct.name}${ct.searched > 0 ? ` (${Math.round(ct.searched * 100)}%)` : ""}`, dur: Math.max(2, ct.size * 1.2 * darkMul * (1 - skillLevel(c, "stealth") * 0.03)) });
  }
  for (const d of s.doors) {
    if (!near(d.x, d.lv, 1.25)) continue;
    if (d.state === "open") out.push({ a: "close", id: d.id, label: "🚪 Закрыть дверь", dur: 0.6 });
    else if (d.state === "closed") out.push({ a: "open", id: d.id, label: "🚪 Открыть дверь", dur: 0.6 });
    else if (d.state === "locked") {
      if (s.details.some((x) => x.unlocks === d.id && x.taken)) out.push({ a: "unlockDoor", id: d.id, label: "🔑 Открыть ключом", dur: 1.5 });
      if (has("lockpick")) out.push({ a: "pickDoor", id: d.id, label: "🗝️ Отмычка (тихо)", dur: 6 });
      if (has("crowbar")) out.push({ a: "pryDoor", id: d.id, label: "🦯 Лом (шумно)", dur: 3 });
      out.push({ a: "kick", id: d.id, label: "🦶 Выбить (очень шумно)", dur: 1.2 });
    }
  }
  for (const dt of s.details) {
    if (!dt.found || dt.taken || !near(dt.x, dt.lv, 1.3)) continue;
    out.push({ a: "take", id: dt.id, label: dt.kind === "note" ? `📝 Прочитать записку` : dt.loot ? `✋ Забрать: ${dt.kind === "loose_step" ? "тайник под ступенькой" : "находку"}` : `👁 ${dt.text.slice(0, 40)}…`, dur: 1.5 });
  }
  for (const hz of s.hazards) if (hz.known && hz.armed && hz.kind === "tripwire" && near(hz.x, hz.lv, 1.3)) out.push({ a: "disarm", id: hz.id, label: "✂️ Обезвредить растяжку (Ремонт)", dur: 5 });
  for (const p of s.people) if (!p.gone && near(p.x, p.lv, 1.5)) out.push({ a: "talk", id: p.id, label: `💬 Поговорить: ${p.name}`, dur: 0 });
  for (const t of s.threats) if (t.state !== "alert" && near(t.x - 0.5, t.lv, 1.6)) out.push({ a: "ambush", id: t.id, label: `🗡 Напасть исподтишка`, dur: 0 });
  if (room) out.push({ a: "inspect", id: room.id, label: "🔎 Детальный осмотр (R)", dur: 3 * darkMul });
  if (c.lv === s.exitLv && Math.abs(c.x - (s.exitX + 0.5)) <= 1.2) out.push({ a: "exit", id: "exit", label: "🚪 Выйти из здания", dur: 0 });
  if (has("relay") && !flags["relay_" + s.node]) out.push({ a: "relay", id: "relay", label: "📡 Установить ретранслятор", dur: 4 });
  out.push({ a: "stone", id: "stone", label: "🪨 Бросить камень (отвлечь)", dur: 0 });
  return out;
}

registerCmd("sdo", (w, p, cmd) => {
  const e = exped(w);
  if (!e || e.stage !== "site" || !e.site || battle(w)) return "Сейчас нельзя";
  const c = p.char ? w.chars[p.char] : undefined;
  if (!c || !e.squad.includes(c.id)) return "Вы не в отряде";
  const act = listSiteActions(e, e.site, c, w.flags).find((a) => a.a === cmd.a && a.id === String(cmd.id));
  if (!act) return "Недоступно";
  if (act.reason) return act.reason;
  if (act.dur <= 0) return instantSiteAction(w, e, e.site, c, act, cmd);
  e.tasks[c.id] = { a: act.a, id: act.id, t: 0, dur: act.dur };
  if (act.a === "kick") e.site.noise = clamp(e.site.noise + 10);
});

registerCmd("sstop", (w, p) => {
  const e = exped(w);
  if (e && p.char) delete e.tasks[p.char];
});

registerCmd("expLight", (w, p) => {
  const e = exped(w);
  if (!e || !p.char) return;
  if (!e.light[p.char] && (e.supplies.flashlight ?? 0) < 1) return "Нет фонарика";
  if (!e.light[p.char] && (e.supplies.batteries ?? 0) <= 0) return "Нет батареек";
  e.light[p.char] = !e.light[p.char];
});

function instantSiteAction(w: World, e: Expedition, s: Site, c: Char, act: SiteAction, cmd: any): string | void {
  const R = rng(w);
  switch (act.a) {
    case "exit":
      leaveSite(w, e);
      return;
    case "ambush": {
      const t = s.threats.find((x) => x.id === act.id);
      if (!t) return;
      elog(e, `${firstName(c)} нападает из темноты!`);
      c.skills.stealth += 4;
      siteFight(w, e, s, true);
      return;
    }
    case "stone": {
      // noise on the far side of the room draws attention away
      const room = siteRoomAt(s, Math.floor(c.x), c.lv);
      const tx = room ? (c.x - room.x < room.w / 2 ? room.x + room.w - 0.5 : room.x + 0.5) : c.x + 3;
      for (const t of s.threats) if (t.lv === c.lv && t.state !== "asleep") ((t.state = "alert"), (t.tx = tx), (t.detect = Math.max(0, t.detect - 30)));
      s.noise = clamp(s.noise + 4);
      elog(e, "🪨 Камень стучит в дальнем углу…");
      return;
    }
    case "talk": {
      const person = s.people.find((x) => x.id === act.id);
      if (!person) return;
      const opt = cmd.opt as string | undefined;
      if (!opt) {
        person.met = true;
        if (c.ctrl) fx(w, { k: "news", to: c.ctrl, id: "talk", data: { person, options: personOptions(person.kind) } });
        return;
      }
      return talkResult(w, e, s, c, person, opt, R);
    }
  }
}

export function personOptions(kind: string): { id: string; label: string }[] {
  switch (kind) {
    case "survivor":
      return [
        { id: "invite", label: "Позвать в бункер (проверка ХАР)" },
        { id: "trade", label: "Поменяться (патроны → еда)" },
        { id: "bye", label: "Разойтись миром" },
      ];
    case "family":
      return [
        { id: "share", label: "Поделиться едой (−2 консервы)" },
        { id: "invite", label: "Позвать в бункер одного из них" },
        { id: "bye", label: "Уйти тихо" },
      ];
    case "trader":
      return [
        { id: "trade", label: "Поторговать (запчасти → медикаменты)" },
        { id: "rumor", label: "Спросить о слухах" },
        { id: "bye", label: "Уйти" },
      ];
    case "wounded":
      return [
        { id: "heal", label: "Перевязать (1 медикамент)" },
        { id: "bye", label: "Оставить" },
      ];
    default:
      return [
        { id: "talk", label: "Договориться (проверка ХАР)" },
        { id: "bribe", label: "Откупиться (3 консервы)" },
        { id: "fight", label: "Атаковать" },
      ];
  }
}

function takeSupply(e: Expedition, k: string, n: number) {
  const fromS = Math.min(n, e.supplies[k] ?? 0);
  e.supplies[k] = (e.supplies[k] ?? 0) - fromS;
  e.loot[k] = Math.max(0, (e.loot[k] ?? 0) - (n - fromS));
}

function talkResult(w: World, e: Expedition, s: Site, c: Char, p: Site["people"][number], opt: string, R: Rng): string | void {
  const har = c.card.stats.har + skillLevel(c, "stealth");
  const have = (k: string) => (e.supplies[k] ?? 0) + (e.loot[k] ?? 0);
  switch (opt) {
    case "invite":
      if (R.d20() + har >= 13) {
        e.recruits++;
        p.gone = true;
        elog(e, `${p.name}: «Спасибо. Я пойду с вами». Новый жилец придёт с отрядом.`);
      } else elog(e, `${p.name} не верит вам и уходит.`);
      p.gone = true;
      break;
    case "trade":
      if (p.kind === "trader") {
        if (have("parts") < 2) return "Нужно 2 запчасти";
        takeSupply(e, "parts", 2);
        e.loot.meds = (e.loot.meds ?? 0) + 2;
        elog(e, "Сделка: 2 запчасти → 2 медикамента.");
      } else {
        if (have("ammo") < 3) return "Нужно 3 патрона";
        takeSupply(e, "ammo", 3);
        e.loot.food_can = (e.loot.food_can ?? 0) + 2;
        elog(e, "Обмен: 3 патрона → 2 консервы.");
      }
      break;
    case "share":
      if (have("food_can") < 2) return "Нет еды";
      takeSupply(e, "food_can", 2);
      w.flags.karma = (w.flags.karma ?? 0) + 2;
      for (const x of squadChars(w, e)) x.needs.sanity = clamp(x.needs.sanity + 6);
      elog(e, "Дети едят молча. Мать плачет. Всем стало немного теплее.");
      p.gone = true;
      break;
    case "rumor": {
      const m = wmap(w);
      const hidden = Object.values(m.nodes).filter((n) => !n.known && !n.hidden);
      if (hidden.length) {
        const n = R.pick(hidden);
        n.known = true;
        elog(e, `Торговец рассказывает про «${n.name}». Отмечено на карте.`);
      } else elog(e, "«Всё, что знал, уже рассказал».");
      break;
    }
    case "heal":
      if (have("meds") < 1) return "Нет медикаментов";
      takeSupply(e, "meds", 1);
      w.flags.karma = (w.flags.karma ?? 0) + 1;
      e.loot[R.pick(["ammo", "batteries", "parts"])] = (e.loot.ammo ?? 0) + 2;
      elog(e, "Раненый благодарит и отдаёт всё, что у него было.");
      p.gone = true;
      break;
    case "talk":
      if (R.d20() + har >= 12) {
        elog(e, "Патруль «Порядка» проверяет лица и отпускает вас.");
        w.factions.order = clamp((w.factions.order ?? 0) + 3, -100, 100);
        p.gone = true;
      } else {
        elog(e, "«Документы!» — договориться не вышло.");
        p.gone = true;
        s.threats.push({ id: "t" + w.nextId++, etype: "soldier", x: p.x, lv: p.lv, dir: -1, state: "alert", detect: 100, room: s.rooms[0].id });
        siteFight(w, e, s, false);
      }
      break;
    case "bribe":
      if (have("food_can") < 3) return "Нечем откупиться";
      takeSupply(e, "food_can", 3);
      p.gone = true;
      elog(e, "Патруль берёт консервы и отворачивается.");
      break;
    case "fight":
      p.gone = true;
      s.threats.push({ id: "t" + w.nextId++, etype: "soldier", x: p.x, lv: p.lv, dir: -1, state: "alert", detect: 100, room: s.rooms[0].id });
      w.factions.order = clamp((w.factions.order ?? 0) - 15, -100, 100);
      siteFight(w, e, s, true);
      break;
    default:
      p.gone = true;
  }
}

registerCmd("stalk", (w, p, cmd) => {
  const e = exped(w);
  if (!e?.site || !p.char) return;
  const c = w.chars[p.char];
  const person = e.site.people.find((x) => x.id === String(cmd.person));
  if (!person || person.gone) return;
  if (person.lv !== c.lv || Math.abs(person.x + 0.5 - c.x) > 2) return "Слишком далеко";
  return talkResult(w, e, e.site, c, person, String(cmd.opt), rng(w));
});

function addLoot(w: World, e: Expedition, loot: Record<string, number>, c: Char): string[] {
  const got: string[] = [];
  const cap = capacity(w, e.squad);
  for (const k in loot) {
    let n = loot[k];
    if (k === "bg_random" || k.startsWith("bg_")) {
      e.loot[k] = (e.loot[k] ?? 0) + n;
      got.push("🎲 настольная игра");
      continue;
    }
    const wgt = ITEMS[k]?.weight ?? 0.5;
    const free = cap - weightOf({ ...e.supplies, ...e.loot });
    if (wgt * n > free + 10) n = Math.max(0, Math.floor((free + 10) / wgt));
    if (n <= 0) {
      got.push(`(${itemName(k)} — рюкзаки полны)`);
      continue;
    }
    e.loot[k] = (e.loot[k] ?? 0) + n;
    got.push(`${ITEMS[k]?.icon ?? ""}${itemName(k)}×${n}`);
  }
  void c;
  return got;
}

function finishSiteTask(w: World, e: Expedition, s: Site, c: Char, t: SquadTask) {
  const R = rng(w);
  const cont = s.conts.find((x) => x.id === t.id);
  const door = s.doors.find((x) => x.id === t.id);
  switch (t.a) {
    case "search": {
      if (!cont || cont.searched >= 1) return;
      const dark = siteRoomAt(s, cont.x, cont.lv)?.dark && !e.light[c.id];
      const rolls = Math.max(1, Math.round(cont.size / 3) + R.int(-1, 1) - (dark ? 1 : 0));
      const loot = rollLoot(cont.table, R, rolls);
      for (const g of cont.guaranteed ?? []) loot[g] = (loot[g] ?? 0) + 1;
      cont.searched = 1;
      s.noise = clamp(s.noise + ((c as any).__sneak ? 1 : 3));
      const got = addLoot(w, e, loot, c);
      elog(e, `${firstName(c)} обыскивает «${cont.name}»: ${got.length ? got.join(", ") : "пусто"}${dark ? " (в темноте могли что-то упустить)" : ""}.`);
      if (cont.kind === "weapon_crate") for (const id of e.squad) if (w.chars[id]?.card.goal === "armory") w.flags["_goal_armory_" + id] = 1;
      c.skills.stealth += 1;
      break;
    }
    case "unlock":
    case "pick":
    case "pry":
      if (!cont) return;
      if (t.a === "pick" && R.d20() + c.card.stats.lov + skillLevel(c, "stealth") < 11) {
        elog(e, "Отмычка соскальзывает… ещё попытка.");
        s.noise = clamp(s.noise + 2);
        return;
      }
      cont.locked = false;
      s.noise = clamp(s.noise + (t.a === "pry" ? 18 : 1));
      elog(e, `${cont.name} открыт${t.a === "pry" ? " с жутким скрежетом" : ""}.`);
      break;
    case "open":
      if (door) setDoorState(s, door, "open");
      s.noise = clamp(s.noise + 1);
      break;
    case "close":
      if (door) setDoorState(s, door, "closed");
      break;
    case "unlockDoor":
    case "pickDoor":
    case "pryDoor":
      if (!door) return;
      if (t.a === "pickDoor" && R.d20() + c.card.stats.lov + skillLevel(c, "stealth") < 11) {
        elog(e, "Замок не поддаётся…");
        return;
      }
      setDoorState(s, door, "open");
      s.noise = clamp(s.noise + (t.a === "pryDoor" ? 15 : 1));
      break;
    case "kick":
      if (!door) return;
      if (R.d20() + c.card.stats.sil * 2 >= 14) {
        setDoorState(s, door, "broken");
        elog(e, `${firstName(c)} вышибает дверь!`);
      } else elog(e, "Дверь выдержала удар.");
      s.noise = clamp(s.noise + 28);
      break;
    case "take": {
      const d = s.details.find((x) => x.id === t.id);
      if (!d || d.taken) return;
      d.taken = true;
      if (d.clue && !s.clues.includes(d.clue)) {
        s.clues.push(d.clue);
        elog(e, `📝 ${d.text}`);
      } else if (d.kind === "note" || d.kind === "photo") elog(e, `📝 ${d.text}`);
      if (d.loot) {
        const got = addLoot(w, e, d.loot, c);
        elog(e, `Найдено: ${got.join(", ")}.`);
      }
      if (c.ctrl && (d.kind === "note" || d.kind === "photo")) fx(w, { k: "toast", to: c.ctrl, text: d.text.slice(0, 120) });
      break;
    }
    case "inspect": {
      const room = s.rooms.find((r) => r.id === t.id);
      if (!room) return;
      let found = 0;
      const chance = 0.35 + c.card.stats.int * 0.1 + (e.light[c.id] || !room.dark ? 0.2 : -0.15) + (hasTrait(c, "eagleeye") ? 0.2 : 0);
      for (const d of s.details) {
        if (d.found || d.lv !== room.lv || d.x < room.x || d.x >= room.x + room.w) continue;
        if (d.needsClue && !s.clues.includes(d.needsClue)) continue;
        if (R.chance(Math.min(0.95, chance + (d.needsClue ? 0.4 : 0)))) {
          d.found = true;
          found++;
        }
      }
      for (const hz of s.hazards) if (!hz.known && hz.lv === room.lv && hz.x >= room.x && hz.x < room.x + room.w && R.chance(chance)) ((hz.known = true), found++);
      elog(e, found ? `🔎 ${firstName(c)} замечает детали (${found}).` : "🔎 Ничего особенного.");
      break;
    }
    case "disarm": {
      const hz = s.hazards.find((x) => x.id === t.id);
      if (!hz) return;
      if (R.d20() + skillLevel(c, "repair") * 2 >= 10) {
        hz.armed = false;
        e.loot.parts = (e.loot.parts ?? 0) + 1;
        elog(e, "✂️ Растяжка обезврежена. +1 запчасть.");
      } else {
        hz.armed = false;
        c.needs.health = clamp(c.needs.health - 15);
        s.noise = clamp(s.noise + 40);
        elog(e, "💥 Растяжка сработала в руках!");
      }
      break;
    }
    case "relay":
      takeSupply(e, "relay", 1);
      w.flags["relay_" + s.node] = 1;
      w.flags.relays = (w.flags.relays ?? 0) + 1;
      elog(e, "📡 Ретранслятор установлен — связь с бункером дальше.");
      break;
  }
}

// ---------------------------------------------------------------- radio operator (in the bunker)

export function radioRange(w: World) {
  return 2 + (roomsOfType(w, "radioroom").length ? 3 : 0) + (w.flags.relays ?? 0);
}

export function radioLink(w: World): { ok: boolean; why?: string } {
  const e = exped(w);
  if (!e) return { ok: false, why: "Отряда нет" };
  if (w.weather.today === "storm") return { ok: false, why: "Буря глушит связь" };
  const path = mapPath(wmap(w), "home", e.node, false);
  const hops = path ? path.length - 1 : 99;
  if (hops > radioRange(w)) return { ok: false, why: `Слишком далеко (${hops} > ${radioRange(w)}). Нужны Радиорубка или ретрансляторы.` };
  return { ok: true };
}

function operatorChar(w: World, pid: string): Char | undefined {
  const c = w.players[pid]?.char ? w.chars[w.players[pid].char!] : undefined;
  if (!c || c.status !== "ok") return undefined;
  const station = Object.values(w.objs).find((o) => (o.kind === "sortie_terminal" || o.kind === "radio_station") && o.lv === c.lv && Math.abs(o.x + 0.5 - c.x) < 1.5);
  return station ? c : undefined;
}

registerCmd("opScan", (w, p) => {
  const e = exped(w);
  if (!e) return "Отряда нет";
  if (!operatorChar(w, p.id)) return "Нужно быть у терминала или рации";
  const link = radioLink(w);
  if (!link.ok) return link.why;
  if (w.power.battery < 0.5) return "Не хватает энергии (0.5 кВт·ч)";
  w.power.battery -= 0.5;
  if (e.site) {
    for (const hz of e.site.hazards) hz.known = true;
    e.scanUntil = w.phaseT + 60;
    elog(e, "📡 Бункер: «Смотрите схему — отметили опасности и движение».");
  } else {
    const m = wmap(w);
    const next = e.route[0] ?? e.node;
    for (const j of m.nodes[next]?.links ?? []) m.nodes[j].known = true;
    elog(e, "📡 Бункер подсветил окрестности на карте.");
  }
});

registerCmd("opCoord", (w, p) => {
  const e = exped(w);
  if (!e) return "Отряда нет";
  const op = operatorChar(w, p.id);
  if (!op) return "Нужно быть у терминала или рации";
  const link = radioLink(w);
  if (!link.ok) return link.why;
  e.coord = 1;
  op.skills.radio += 3;
  elog(e, `📡 ${firstName(op)} на связи: «Я вас веду». Координация: +1 ОД в первом ходу боя.`);
});

registerCmd("opCall", (w, p, cmd) => {
  const e = exped(w);
  if (!e || !operatorChar(w, p.id)) return;
  const link = radioLink(w);
  if (!link.ok) return link.why;
  const text = String(cmd.text ?? "").slice(0, 120);
  if (text) elog(e, `📡 Бункер: «${text}»`);
});

// ---------------------------------------------------------------- trading at trader nodes & camps

export function traderStock(w: World, nodeId: string): Record<string, number> {
  const R = Rng.from(w.seed + w.day * 17 + nodeId.length * 131);
  const base = ["food_can", "water", "meds", "ammo", "parts", "batteries", "seed_tomato", "seed_soy", "seed_strawberry", "fuel", "chem", "cloth", "lockpick", "crowbar", "pistol", "medkit", "gasmask", "radpills", "cards52"];
  const out: Record<string, number> = {};
  for (let i = 0; i < 8; i++) {
    const k = R.pick(base);
    out[k] = (out[k] ?? 0) + R.int(1, 4);
  }
  return out;
}

export function priceMult(w: World, nodeId: string) {
  const n = wmap(w).nodes[nodeId];
  const f = n?.faction ?? "caravan";
  const rel = w.factions[f] ?? 0;
  return 1.3 - rel / 250; // good relations → cheaper
}

registerCmd("trade", (w, p, cmd) => {
  const e = exped(w);
  if (!e || e.stage !== "map") return "Торговать можно в пункте торговли";
  const n = wmap(w).nodes[e.node];
  if (n.type !== "trader" && n.type !== "camp") return "Здесь не торгуют";
  if (n.type === "camp" && n.faction === "ratking" && (w.factions.ratking ?? 0) < 0) return "Бандиты не торгуют с чужими";
  const give = (cmd.give ?? {}) as Record<string, number>;
  const take = (cmd.take ?? {}) as Record<string, number>;
  const stock = (w.mods.stock ??= {})[n.id] ?? ((w.mods.stock[n.id] = traderStock(w, n.id)), w.mods.stock[n.id]);
  let gv = 0,
    tv = 0;
  for (const k in give) {
    const q = Math.max(0, Math.floor(give[k]));
    if ((e.supplies[k] ?? 0) + (e.loot[k] ?? 0) < q) return `Нет столько: ${itemName(k)}`;
    gv += (ITEMS[k]?.value ?? 1) * q;
  }
  for (const k in take) {
    const q = Math.max(0, Math.floor(take[k]));
    if ((stock[k] ?? 0) < q) return `У торговца нет столько: ${itemName(k)}`;
    tv += (ITEMS[k]?.value ?? 1) * q;
  }
  if (gv < tv * priceMult(w, n.id) - 0.01) return "Торговец недоволен ценой";
  for (const k in give) takeSupply(e, k, Math.floor(give[k]));
  for (const k in take) {
    stock[k] -= Math.floor(take[k]);
    e.loot[k] = (e.loot[k] ?? 0) + Math.floor(take[k]);
  }
  const f = n.faction ?? "caravan";
  w.factions[f] = clamp((w.factions[f] ?? 0) + 2, -100, 100);
  elog(e, "🤝 Сделка состоялась.");
});

// reveal nodes from events
effectHooks.revealNode = (w, v) => {
  const m = wmap(w);
  const n = Object.values(m.nodes).find((x) => x.id === v || x.type === v);
  if (n) {
    n.known = true;
    n.hidden = false;
    log(w, `🗺 На карте пустошей отмечено: ${n.name}.`, "event");
  }
};

// ---------------------------------------------------------------- views

modViews.wmap = {
  pub: (w, m: WasteMap) => {
    const nodes: Record<string, any> = {};
    for (const id in m.nodes) {
      const n = m.nodes[id];
      if (!n.known) continue;
      nodes[id] = { id, type: n.type, name: n.name, x: n.x, y: n.y, links: n.links.filter((l) => m.nodes[l].known), visited: n.visited, faction: n.faction, danger: n.danger, looted: n.looted, theme: n.theme };
    }
    return { nodes, home: m.home };
  },
};

modViews.expedition = {
  pub: (w, e: Expedition) => {
    if (!e?.active) return undefined;
    const s = e.site;
    const scan = w.phaseT < e.scanUntil;
    const site = s
      ? {
          node: s.node,
          type: s.type,
          theme: s.theme,
          W: s.W,
          H: s.H,
          grid: s.grid,
          ladders: s.ladders,
          rooms: s.rooms,
          conts: s.conts.filter((c) => s.rooms.find((r) => r.revealed && c.lv === r.lv && c.x >= r.x && c.x < r.x + r.w)).map((c) => ({ id: c.id, kind: c.kind, name: c.name, x: c.x, lv: c.lv, searched: c.searched, locked: c.locked, coop: c.coop, cover: c.cover })),
          doors: s.doors,
          threats: s.threats.filter((t) => scan || s.rooms.find((r) => r.revealed && t.lv === r.lv && t.x >= r.x - 0.5 && t.x < r.x + r.w)).map((t) => ({ id: t.id, etype: t.etype, x: Math.round(t.x * 100) / 100, lv: t.lv, dir: t.dir, state: t.state, detect: Math.round(t.detect) })),
          hazards: s.hazards.filter((h) => h.known),
          details: s.details.filter((d) => d.found),
          people: s.people.filter((p) => !p.gone && s.rooms.find((r) => r.revealed && p.lv === r.lv && p.x >= r.x && p.x < r.x + r.w)),
          noise: Math.round(s.noise),
          exitX: s.exitX,
          exitLv: s.exitLv,
          clues: s.clues,
        }
      : null;
    return {
      active: true,
      stage: e.stage,
      squad: e.squad,
      gear: e.gear,
      supplies: e.supplies,
      loot: e.loot,
      weight: weightOf({ ...e.supplies, ...e.loot }),
      cap: capacity(w, e.squad),
      gearWeight: weightOf(e.gear),
      node: e.node,
      route: e.route,
      from: e.from,
      progress: e.travelTotal > 0 ? Math.round((1 - e.travelLeft / e.travelTotal) * 100) / 100 : 0,
      site,
      tasks: e.tasks,
      light: e.light,
      coord: e.coord,
      log: e.log.slice(-12),
      prepT: Math.floor(e.prepT),
      recruits: e.recruits,
      radio: radioLink(w),
      stock: w.mods.stock?.[e.node],
      priceMult: priceMult(w, e.node),
    };
  },
};

export { FACTIONS, LOC };
