import absurd from "../data/events/absurd.json";
import ark from "../data/events/ark.json";
import door from "../data/events/door.json";
import internal from "../data/events/internal.json";
import moral from "../data/events/moral.json";
import radio from "../data/events/radio.json";
import world from "../data/events/world.json";
import { PROFS, STAT_NAMES, SKILL_NAMES } from "../data/characters";
import { itemName } from "../data/items";
import type { Card, Char, StatId, SkillId, Vote, World } from "../types";
import { feetY } from "../world/grid";
import { objsOfKind, roomsOfType, addObj, roomAt } from "../world/rooms";
import { bark } from "./bots";
import { councilHooks, voteWinner } from "./council";
import { foodUnits, takeFood } from "./items";
import { autoTake } from "./lobby";
import { breakObj, igniteRoom } from "./systems";
import { onTick } from "./tick";
import { clamp, firstName, fx, homeChars, log, rng, skillLevel } from "./util";
import { createChar, makeCard } from "../world/create";
import { Rng } from "../rng";
import { admitForecast, doorAllows } from "./colonyplan";

export interface EventOption {
  label: string;
  desc?: string;
  cost?: Record<string, number>;
  req?: Record<string, any>;
  check?: { stat?: StatId; skill?: SkillId; dc: number };
  effects?: Effect[];
  fail?: Effect[];
  risk?: { chance: number; effects: Effect[]; text?: string };
  text?: string;
  failText?: string;
  mood?: string[];
}

export interface EventDef {
  id: string;
  cat: string;
  phase: "night" | "day";
  weight: number;
  tags?: string[];
  conditions?: Record<string, any>;
  title: string;
  text: string;
  options?: EventOption[];
  auto?: Effect[];
}

export type Effect = Record<string, any>;

export const EVENTS: EventDef[] = [...door, ...internal, ...radio, ...world, ...moral, ...absurd, ...ark] as EventDef[];
export const EVENT_BY_ID: Record<string, EventDef> = Object.fromEntries(EVENTS.map((e) => [e.id, e]));

/** Extension points for other modules (raids, expeditions...). */
export const effectHooks: Record<string, (w: World, v: any) => void> = {};

// ---------------------------------------------------------------- conditions

export function condOk(w: World, cond: Record<string, any> | undefined): boolean {
  if (!cond) return true;
  const home = homeChars(w);
  for (const k in cond) {
    const v = cond[k];
    switch (k) {
      case "minDay":
        if (w.day < v) return false;
        break;
      case "maxDay":
        if (w.day > v) return false;
        break;
      case "dayEq":
        if (w.day !== v) return false;
        break;
      case "flag":
        if (!w.flags[v]) return false;
        break;
      case "notFlag":
        if (w.flags[v]) return false;
        break;
      case "flagGte":
        for (const f in v) if ((w.flags[f] ?? 0) < v[f]) return false;
        break;
      case "resGte":
        for (const r in v) {
          const have = r === "food" ? foodUnits(w) : (w.res[r] ?? 0);
          if (have < v[r]) return false;
        }
        break;
      case "hasRoom":
        if (!roomsOfType(w, v).length) return false;
        break;
      case "hasProf":
        if (!home.some((c) => c.card.prof === v)) return false;
        break;
      case "noPet":
        if (w.pet) return false;
        break;
      case "popGte":
        if (home.length < v) return false;
        break;
      case "bedsShort":
        if (objsOfKind(w, "bed").length >= home.length) return false;
        break;
      case "avgSanityLt":
        if (!home.length || home.reduce((s, c) => s + c.needs.sanity, 0) / home.length >= v) return false;
        break;
      case "levelsGte": {
        const maxLv = Math.max(0, ...Object.values(w.rooms).map((r) => r.lv));
        if (maxLv + 1 < v) return false;
        break;
      }
      case "notice":
        if (w.notice < v) return false;
        break;
      case "factionGte":
        for (const f in v) if ((w.factions[f] ?? 0) < v[f]) return false;
        break;
      case "once":
        break;
      case "birthdayToday":
        if (!home.some((c) => c.card.birthday === w.day)) return false;
        break;
      default:
        break;
    }
  }
  return true;
}

function costOk(w: World, cost?: Record<string, number>) {
  if (!cost) return true;
  for (const k in cost) {
    const have = k === "food" ? foodUnits(w) : (w.res[k] ?? 0);
    if (have + 1e-6 < cost[k]) return false;
  }
  return true;
}

function payCost(w: World, cost?: Record<string, number>) {
  if (!cost) return;
  for (const k in cost) {
    if (k === "food") takeFood(w, cost[k], false);
    else w.res[k] = Math.max(0, (w.res[k] ?? 0) - cost[k]);
  }
}

export function costLabel(cost?: Record<string, number>) {
  if (!cost) return "";
  return Object.keys(cost)
    .map((k) => `−${cost[k]} ${k === "food" ? "еды" : itemName(k)}`)
    .join(", ");
}

// ---------------------------------------------------------------- picking

export function eligible(w: World, e: EventDef): boolean {
  if (!condOk(w, e.conditions)) return false;
  if (e.conditions?.once && (w.flags["_ev_" + e.id] ?? 0) > 0) return false;
  // same event not twice in a row / recently
  const last = w.flags["_ev_" + e.id] ?? -99;
  if (w.day - last < 4 && e.weight < 50) return false;
  return true;
}

function weightFor(w: World, e: EventDef): number {
  let wt = e.weight;
  const tags = e.tags ?? [];
  const bad = tags.includes("bad");
  if (w.director.quiet > 0 && (bad || tags.includes("moral"))) return 0; // guaranteed quiet days
  const st = w.settings.storyteller;
  if (bad) wt *= st === "haven" ? 0.4 : st === "scorched" ? 1.6 : 1;
  if (bad) wt *= 1 - w.director.tension / 150;
  if (tags.includes("calm") || tags.includes("good")) wt *= w.director.quiet > 0 ? 3 : st === "haven" ? 1.6 : 1;
  return Math.max(0, wt);
}

/** Events due by timers take priority, then a weighted random pick. */
export function pickEvent(w: World, phase: "night" | "day"): EventDef | null {
  const dueIdx = w.timers.findIndex((t) => t.kind === "event" && t.at <= w.day && EVENT_BY_ID[t.data] && EVENT_BY_ID[t.data].phase === phase && condOk(w, EVENT_BY_ID[t.data].conditions));
  if (dueIdx >= 0) {
    const t = w.timers.splice(dueIdx, 1)[0];
    return EVENT_BY_ID[t.data];
  }
  // pending prisoner etc.
  const forced = EVENTS.find((e) => e.phase === phase && e.weight === 0 && e.id === "captured_raider" && condOk(w, e.conditions));
  if (forced) return forced;
  // birthdays
  if (phase === "night") {
    const bday = homeChars(w).find((c) => c.card.birthday === w.day && !w.flags["_bday_" + c.id]);
    if (bday) return birthdayEvent(w, bday);
  }
  const pool = EVENTS.filter((e) => e.phase === phase && e.weight > 0 && eligible(w, e));
  const R = rng(w);
  return R.weighted(pool, (e) => weightFor(w, e)) ?? null;
}

function birthdayEvent(w: World, c: Char): EventDef {
  w.flags["_bday_" + c.id] = 1;
  return {
    id: "birthday",
    cat: "internal",
    phase: "night",
    weight: 0,
    tags: ["good", "holiday"],
    title: `День рождения: ${c.card.name}`,
    text: `Сегодня ${firstName(c)} исполняется ${c.card.age + 1}. Под землёй праздники особенно нужны. Нужен торт — или хотя бы что-то похожее.`,
    options: [
      { label: "Испечь «торт» из того, что есть (−2 еды)", cost: { food: 2 }, effects: [{ party: true }, { sanityAll: 10 }, { sanityChar: { id: c.id, n: 15 } }], text: "Свеча из огарка, «С днём рождения» хором. Даже боты подпевают." },
      { label: "Клубничный торт! (−3 клубники)", cost: { strawberry: 3 }, effects: [{ party: true }, { sanityAll: 18 }], text: "Настоящая клубника. Кто-то плачет от счастья." },
      { label: "Поздравить на словах", effects: [{ sanityChar: { id: c.id, n: 3 } }], text: "Тёплые слова — тоже подарок." },
    ],
  };
}

// ---------------------------------------------------------------- votes

export function makeVote(w: World, e: EventDef, phaseT: number, dur: number): Vote {
  return {
    id: "v" + w.nextId++,
    kind: "event",
    title: e.title,
    text: e.text,
    options: (e.options ?? []).map((o) => {
      const affordable = costOk(w, o.cost);
      const reqOk = condOk(w, o.req);
      const label = o.label + (o.cost && !o.label.includes("−") ? ` (${costLabel(o.cost)})` : "");
      const checkTxt = o.check ? checkLabel(o.check) : "";
      return { label, desc: [checkTxt, !affordable ? "не хватает ресурсов" : "", !reqOk ? "недоступно" : ""].filter(Boolean).join("; ") || undefined, disabled: !affordable || !reqOk };
    }),
    votes: {},
    ends: phaseT + dur,
    ...((e.options ?? []).some((o) => (o.effects ?? []).some((ef: any) => ef.addNpc)) ? { text: `${e.text}\n\n📊 ${admitForecast(w)}` } : {}),
    eventId: e.id,
    data: { def: e.id === "birthday" ? e : undefined },
  };
}

function checkLabel(c: { stat?: StatId; skill?: SkillId; dc: number }) {
  return `🎲 проверка ${[c.stat ? STAT_NAMES[c.stat] : "", c.skill ? SKILL_NAMES[c.skill] : ""].filter(Boolean).join("+")} против ${c.dc}`;
}

/** Bots voice their opinion (they don't vote). */
export function botOpinions(w: World, v: Vote) {
  const e = v.data?.def ?? EVENT_BY_ID[v.eventId ?? ""];
  if (!e?.options) return;
  const R = rng(w);
  for (const c of homeChars(w)) {
    if (c.ctrl || c.status !== "ok") continue;
    const pref = moodOf(c);
    let best = -1,
      bs = -1;
    e.options.forEach((o: EventOption, i: number) => {
      if (v.options[i]?.disabled) return;
      const s = (o.mood ?? []).includes(pref) ? 2 + R.next() : R.next();
      if (s > bs) {
        bs = s;
        best = i;
      }
    });
    if (best >= 0 && R.chance(0.7)) {
      const phrases = ["Я бы выбрал: «{o}».", "Голосую сердцем: «{o}».", "По-моему, «{o}» — единственный вариант.", "«{o}». И не спорьте.", "Эх… «{o}», наверное."];
      c.bark = { text: R.pick(phrases).replace("{o}", e.options[best].label.replace(/\s*\(.*\)$/, "")), t: 7 };
    }
  }
}

function moodOf(c: Char): string {
  const p = c.card.prof;
  if (["priest", "doctor", "teacher"].includes(p)) return "kind";
  if (["soldier", "miner"].includes(p)) return "brave";
  if (p === "conman") return "greedy";
  if (c.card.minus === "coward") return "cautious";
  return ["kind", "cautious", "brave"][(c.id.charCodeAt(1) ?? 0) % 3];
}

// ---------------------------------------------------------------- resolution

export function resolveVote(w: World, v: Vote) {
  const e: EventDef | undefined = v.data?.def ?? EVENT_BY_ID[v.eventId ?? ""];
  if (!e?.options) return;
  // nobody voted on a stranger at the door: the council's door policy decides, not a coin (#27)
  const admits = e.options.map((o) => (o.effects ?? []).some((ef: any) => ef.addNpc));
  let i = v.result ?? voteWinner(w, v);
  if (v.result === undefined && !Object.keys(v.votes).length && admits.some(Boolean)) {
    const want = doorAllows(w);
    const fits = e.options.map((_, k) => k).filter((k) => admits[k] === want && !v.options[k]?.disabled);
    if (fits.length) i = fits[0];
  }
  const o = e.options[i];
  if (!o) return;
  w.flags["_ev_" + e.id] = w.day;
  w.stats.events.push(e.title);
  w.history.push({ day: w.day, id: e.id, choice: i });
  if (w.history.length > 300) w.history.shift();
  payCost(w, o.cost);
  let ok = true;
  let checkTxt = "";
  if (o.check) {
    const [success, txt] = rollCheck(w, o.check);
    ok = success;
    checkTxt = txt;
  }
  const effects = ok ? (o.effects ?? []) : (o.fail ?? []);
  const text = ok ? o.text : (o.failText ?? o.text);
  // hidden goal: "Гостеприимство" — the player voted to admit a stranger
  if (ok && effects.some((ef) => ef.addNpc)) {
    for (const pid in v.votes) {
      if (v.votes[pid] !== i) continue;
      const ch = w.players[pid]?.char;
      if (ch && w.chars[ch]?.card.goal === "stranger") w.flags["_goal_stranger_" + ch] = 1;
    }
  }
  for (const ef of effects) applyEffect(w, ef);
  let riskTxt = "";
  if (ok && o.risk && rng(w).chance(o.risk.chance)) {
    for (const ef of o.risk.effects) applyEffect(w, ef);
    riskTxt = o.risk.text ?? "";
  }
  v.resultText = [checkTxt, text, riskTxt].filter(Boolean).join(" ");
  log(w, `📜 ${e.title}: «${o.label}». ${v.resultText}`, "event");
  fx(w, { k: "toast", text: `📜 ${o.label}` });
}

/** d20 + stat + skill level of the best-suited living resident. */
export function rollCheck(w: World, chk: { stat?: StatId; skill?: SkillId; dc: number }): [boolean, string] {
  const home = homeChars(w).filter((c) => c.status === "ok");
  if (!home.length) return [false, ""];
  let best = home[0],
    bv = -1;
  for (const c of home) {
    const val = (chk.stat ? c.card.stats[chk.stat] : 0) + (chk.skill ? skillLevel(c, chk.skill) : 0);
    if (val > bv) {
      bv = val;
      best = c;
    }
  }
  const roll = rng(w).d20();
  const total = roll + bv;
  const ok = roll === 20 || (roll !== 1 && total >= chk.dc);
  return [ok, `🎲 ${firstName(best)}: ${roll}+${bv}=${total} против ${chk.dc} — ${ok ? "успех!" : "провал."}`];
}

// ---------------------------------------------------------------- effects

const NPC_PROFS: Record<string, string> = { doctor: "doctor", soldier: "soldier", cook: "cook", engineer: "engineer", conman: "conman", child: "child" };

export function addNpc(w: World, kind: string, known?: Card): Char {
  const R = new Rng(w.rng);
  const card = known ? { ...known } : makeCard(R);
  if (kind !== "random" && NPC_PROFS[kind]) card.prof = NPC_PROFS[kind];
  if (kind === "child") {
    card.age = R.int(7, 12);
    card.stats = { sil: 1, lov: 3, int: 2, vyn: 2, har: 4 };
    card.hat = 0;
    card.plus = "optimist";
  }
  if (kind === "cook" && card.age < 55) card.age = R.int(62, 78);
  const airlock = roomsOfType(w, "airlock")[0];
  const c = createChar(w, card, airlock ? airlock.x + 1 : 20, airlock?.lv ?? 0);
  c.npc = true;
  c.y = feetY(c.lv);
  for (const o of Object.values(w.chars)) {
    if (o.id === c.id) continue;
    o.rel[c.id] = R.int(-5, 5);
    c.rel[o.id] = R.int(0, 10);
  }
  log(w, `🚪 В бункере новый жилец: ${card.name}, ${PROFS[card.prof]?.name ?? "без профессии"}.`, "good");
  // a dead player takes the new body
  const ghost = Object.values(w.players).find((p) => p.ghost && p.online);
  if (ghost) autoTake(w, ghost);
  return c;
}

export function applyEffect(w: World, ef: Effect) {
  const R = rng(w);
  const home = homeChars(w).filter((c) => c.status !== "dead");
  for (const k in ef) {
    const v = ef[k];
    switch (k) {
      case "res":
        for (const r in v) w.res[r] = Math.max(0, (w.res[r] ?? 0) + v[r]);
        break;
      case "addNpc":
        addNpc(w, String(v));
        break;
      case "setFlag":
        w.flags[v] = 1;
        break;
      case "clearFlag":
        delete w.flags[v];
        break;
      case "flag":
        for (const f in v) w.flags[f] = (w.flags[f] ?? 0) + v[f];
        break;
      case "flagDays":
        for (const f in v) w.flags[f] = w.day + v[f];
        break;
      case "karma":
        w.flags.karma = (w.flags.karma ?? 0) + v;
        break;
      case "sanityAll":
        for (const c of home) c.needs.sanity = clamp(c.needs.sanity + v);
        break;
      case "healthAll":
        for (const c of home) c.needs.health = clamp(c.needs.health + v);
        break;
      case "energyAll":
        for (const c of home) c.needs.energy = clamp(c.needs.energy + v);
        break;
      case "radAll":
        for (const c of home) c.needs.rad = clamp(c.needs.rad + v);
        break;
      case "sanityRandom":
        if (home.length) {
          const c = R.pick(home);
          c.needs.sanity = clamp(c.needs.sanity + v);
        }
        break;
      case "sanityChar": {
        const c = w.chars[v.id];
        if (c) c.needs.sanity = clamp(c.needs.sanity + v.n);
        break;
      }
      case "injureRandom":
        if (home.length) R.pick(home).injury = v;
        break;
      case "sickRandom":
        if (home.length) {
          const c = R.pick(home);
          c.sick = clamp(c.sick + v);
        }
        break;
      case "faction":
        for (const f in v) w.factions[f] = clamp((w.factions[f] ?? 0) + v[f], -100, 100);
        break;
      case "notice":
        w.notice = clamp(w.notice + v);
        break;
      case "timer":
        w.timers.push({ at: w.day + v.days, kind: "event", data: v.event });
        break;
      case "pet":
        if (!w.pet) createPet(w, v);
        break;
      case "petIfNone":
        if (!w.pet) createPet(w, v);
        break;
      case "tape":
        if (!w.tapes.includes(v)) w.tapes.push(v);
        break;
      case "recipe":
        if (!w.recipes.includes(v)) w.recipes.push(v);
        break;
      case "tech":
        if (!w.tech.includes(v)) w.tech.push(v);
        break;
      case "weather":
        w.weather.forecast[0] = v;
        break;
      case "quake":
        w.flags.quake_day = w.day + 1;
        for (const id in w.rooms) if (!w.rooms[id].sturdy && R.chance(0.3 * v)) w.rooms[id].dmg = clamp(w.rooms[id].dmg + 30 * v);
        fx(w, { k: "shake", data: 1.5 });
        break;
      case "flood": {
        const rooms = Object.values(w.rooms).filter((r) => r.state === "done");
        const lowest = rooms.sort((a, b) => b.lv - a.lv)[0];
        if (lowest) for (const r of rooms) if (r.lv === lowest.lv) r.flood = clamp(r.flood + v);
        break;
      }
      case "fire": {
        const r = roomsOfType(w, v)[0] ?? R.pick(Object.values(w.rooms).filter((x) => x.state === "done"));
        if (r) igniteRoom(w, r, 30);
        break;
      }
      case "breakObj": {
        const o = objsOfKind(w, v)[0];
        if (o) breakObj(w, o, false);
        break;
      }
      case "wearObj":
        for (const kind in v) for (const o of objsOfKind(w, kind)) o.wear = clamp(o.wear + v[kind]);
        break;
      case "power":
        w.power.battery = clamp(w.power.battery + v, 0, w.power.cap);
        break;
      case "party":
        w.flags.party_day = w.day;
        w.flags.harvests = 0;
        break;
      case "rabbits": {
        const h = objsOfKind(w, "rabbit_hutch")[0];
        if (h) h.st.rabbits = (h.st.rabbits ?? 0) + v;
        break;
      }
      case "addBed": {
        const r = roomsOfType(w, "living")[0];
        if (r) addObj(w, "bed", r.x + R.int(0, r.w - 1), r.lv, r.id);
        break;
      }
      case "removeBot": {
        const bots = home.filter((c) => !c.ctrl);
        if (bots.length) {
          const c = R.pick(bots);
          c.status = "dead";
          c.anim = "dead";
          delete w.chars[c.id];
          log(w, `${c.card.name} уходит с караваном. Навсегда.`, "bad");
        }
        break;
      }
      case "revealGlutton": {
        const g = home.find((c) => c.card.minus === "glutton");
        log(w, g ? `Под подушкой у ${firstName(g)} нашлись пустые банки…` : "Виноватого так и не нашли.", "event");
        if (g) g.needs.sanity = clamp(g.needs.sanity - 10);
        break;
      }
      case "leak": {
        const r = roomsOfType(w, v)[0];
        if (r) {
          r.flood = clamp(r.flood + 15);
          w.flags["_leak_" + r.id] = 1;
          const tank = Object.values(w.objs).find((o) => o.kind === "nutrient_tank" && o.room === r.id);
          if (tank) tank.st.level = Math.max(0, (tank.st.level ?? 0) - 25);
        }
        break;
      }
      case "wiring": {
        const rooms = Object.values(w.rooms).filter((r) => r.state === "done" && r.type !== "support");
        if (rooms.length) w.flags["_wiring_" + R.pick(rooms).id] = 1;
        break;
      }
      case "bulb": {
        const rooms = Object.values(w.rooms).filter((r) => r.state === "done" && r.type !== "support" && r.type !== "shaft");
        if (rooms.length) w.flags["_bulb_" + R.pick(rooms).id] = 1;
        break;
      }
      case "clipping":
        for (let i = 0; i < v; i++) w.unread.push("rand" + R.int(0, 9999));
        break;
      case "log":
        log(w, v, "event");
        break;
      default:
        effectHooks[k]?.(w, v);
    }
  }
}

export function createPet(w: World, kind: "dog" | "cat" | "roach") {
  const names = { dog: ["Рыжик", "Бункер", "Граф", "Шарик"], cat: ["Кузя", "Мурка", "Фильтр", "Бублик"], roach: ["Валерий", "Усач", "Генерал"] };
  const airlock = roomsOfType(w, "airlock")[0];
  w.pet = { kind, name: rng(w).pick(names[kind]), x: (airlock?.x ?? 20) + 1.5, lv: airlock?.lv ?? 0, mood: 70, fed: 80, anim: "idle" };
  log(w, `🐾 У бункера появился питомец: ${w.pet.name}!`, "good");
}

// ---------------------------------------------------------------- wiring into the council & day

councilHooks.pickEvent = (w) => {
  const e = pickEvent(w, "night");
  if (!e) return null;
  const v = makeVote(w, e, w.phaseT, 35);
  botOpinions(w, v);
  return v;
};
councilHooks.resolveVote = resolveVote;

// Day events: quick incidents (auto) and occasional daytime votes.
onTick("day-events", "day", (w, dt) => {
  // resolve a running daytime vote
  if (w.vote && w.vote.result === undefined) {
    const players = Object.values(w.players).filter((p) => p.online && !p.ghost);
    const allVoted = players.length > 0 && players.every((p) => w.vote!.votes[p.id] !== undefined);
    if (w.phaseT >= w.vote.ends || allVoted) {
      w.vote.result = voteWinner(w, w.vote);
      resolveVote(w, w.vote);
      w.flags._voteShowUntil = w.phaseT + 6;
    }
    return;
  }
  if (w.vote && w.phaseT > (w.flags._voteShowUntil ?? 0)) w.vote = null;
  w.flags._dayEvT = (w.flags._dayEvT ?? 0) + dt;
  if (w.flags._dayEvT < 20) return;
  w.flags._dayEvT = 0;
  // ~1.2 day events per day on average
  const perCheck = (1.2 * 20) / w.settings.dayLength;
  if (!rng(w).chance(perCheck)) return;
  if (w.mods.combat?.active) return;
  const e = pickEvent(w, "day");
  if (!e) return;
  w.flags["_ev_" + e.id] = w.day;
  if (e.auto) {
    for (const ef of e.auto) applyEffect(w, ef);
    log(w, `⚠ ${e.title} ${e.text}`, "bad");
    fx(w, { k: "toast", text: `⚠ ${e.title}` });
    fx(w, { k: "sound", id: "alarm" });
  } else if (e.options) {
    w.vote = makeVote(w, e, w.phaseT, 30);
    botOpinions(w, w.vote);
    fx(w, { k: "toast", text: `🗳 ${e.title}` });
  }
});

export { bark, roomAt };
