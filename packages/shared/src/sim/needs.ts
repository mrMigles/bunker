import { BAL } from "../data/balance";
import type { Char, World } from "../types";
import { feetY } from "../world/grid";
import { addObj, roomAt } from "../world/rooms";
import { autoTake } from "./lobby";
import { onTick } from "./tick";
import { timeMult } from "./time";
import { clamp, firstName, fx, hasTrait, hoursPerSec, log, rng } from "./util";

export const deathHooks: ((w: World, c: Char, cause: string) => void)[] = [];

function storyMult(w: World) {
  return BAL.storyteller[w.settings.storyteller] ?? BAL.storyteller.classic;
}

/** Applies `hours` of need decay to a character. `asleep` → energy recovers instead of dropping. */
export function decayNeeds(w: World, c: Char, hours: number, opts: { asleep?: boolean; sleepRate?: number } = {}) {
  const f = hours / 24;
  const m = storyMult(w).needMult;
  const n = c.needs;
  let foodMul = 1;
  if (hasTrait(c, "glutton")) foodMul = 1.3;
  if (hasTrait(c, "frugal")) foodMul = 0.8;
  n.food = clamp(n.food - BAL.needDecay.food * f * m * foodMul);
  n.water = clamp(n.water - BAL.needDecay.water * f * m);
  if (opts.asleep) {
    n.energy = clamp(n.energy + (opts.sleepRate ?? 30) * hours);
  } else {
    let em = 1;
    if (hasTrait(c, "sleepy")) em *= 1.25;
    if (hasTrait(c, "tough")) em *= 0.8;
    if (hasTrait(c, "nightowl") && w.hour > 18) em *= 0.6;
    n.energy = clamp(n.energy - BAL.needDecay.energy * f * m * em);
  }
  // sanity drift
  let sd = -BAL.needDecay.sanity * f * m;
  if (hasTrait(c, "optimist")) sd *= 0.5;
  if (n.food < 20) sd -= 10 * f;
  if (n.water < 20) sd -= 10 * f;
  if (n.health < 40) sd -= 8 * f;
  n.sanity = clamp(n.sanity + sd);
  // health
  let dh = 0;
  if (n.food <= 0) dh -= BAL.starveDmgPerDay * f;
  if (n.water <= 0) dh -= BAL.thirstDmgPerDay * f;
  if (n.energy <= 0) dh -= BAL.exhaustDmgPerDay * f;
  if (n.rad > BAL.radDmgThreshold) dh -= BAL.radDmgPerDay * f * ((n.rad - BAL.radDmgThreshold) / 40 + 0.5);
  if (c.sick > 0) dh -= c.sick * 0.3 * f;
  if (c.injury === "bleed") dh -= 30 * f;
  if (c.injury === "infection") dh -= 15 * f;
  if (w.air.co2 > 60) dh -= BAL.co2DmgPerDay * f * ((w.air.co2 - 60) / 40);
  if (dh === 0 && n.food > 30 && n.water > 30) dh += BAL.healthRegenPerDay * f * (hasTrait(c, "tough") ? 1.3 : 1);
  if (hasTrait(c, "tough") && dh < 0) dh *= 0.8;
  n.health = clamp(n.health + dh);
  if (w.air.co2 > 30) n.energy = clamp(n.energy - (w.air.co2 - 30) * 0.6 * f);
  c.drunk = Math.max(0, c.drunk - 40 * hours);
}

/**
 * Leisure pays off less the calmer you already are: full value around 40, a fifth near 95.
 * Keeps sanity a resource to manage instead of a bar pinned at 100.
 */
export function sanityGainMult(sanity: number) {
  return Math.max(0.15, Math.min(1.2, 1.35 - sanity / 80));
}

onTick("needs", "day", (w, dt) => {
  const beds = Object.values(w.objs).filter((o) => o.kind === "bed" || o.kind === "med_bed").length;
  const home = Object.values(w.chars).filter((c) => c.status !== "dead" && c.status !== "away").length;
  const crowded = home > beds;
  const hours = dt * hoursPerSec(w) * timeMult(w);
  for (const id in w.chars) {
    const c = w.chars[id];
    if (c.status === "dead" || c.status === "away") continue;
    const sleeping = c.task?.action === "sleep";
    decayNeeds(w, c, hours, { asleep: sleeping, sleepRate: sleepRate(w, c) });
    // environment effects on sanity (per hour)
    const r = roomAt(w, Math.floor(c.x), c.lv);
    // (softened: the old rates emptied the bar of a resident in a bare, dim bunker within one day)
    let s = 0;
    if (r) {
      s += ((r.comfort - 50) / 50) * (r.comfort < 50 ? 0.6 : 1.2);
      if (!r.lit) s -= hasTrait(c, "darkfear") ? 3 : 0.7;
      if (r.fire > 0) s -= 6;
      if (hasTrait(c, "claustro") && (r.w <= 3 || c.lv >= 3)) s -= 0.8;
    }
    if (hasTrait(c, "smoker") && (w.flags["_smoke_" + c.id] ?? 0) < w.day - 1) s -= 0.6;
    // bodily misery and crowding wear the mind down
    if (c.needs.food < 30) s -= 1;
    if (c.needs.water < 30) s -= 1;
    if (c.needs.health < 50) s -= 0.6;
    if (crowded) s -= 0.3;
    // sleep mends the mind a little
    if (sleeping) s += 1.2;
    const before = c.needs.sanity;
    c.needs.sanity = clamp(c.needs.sanity + s * hours);
    sanityWarning(w, c, before);
    // status
    if (c.status === "ok" && c.needs.health <= 0) knockDown(w, c, "здоровье");
    else if (c.status === "ok" && c.needs.sanity <= 0) breakdown(w, c);
  }
});

/** A player's resident slipping: say so, and say what helps, before it turns into a breakdown. */
function sanityWarning(w: World, c: Char, before: number) {
  if (!c.ctrl) return;
  const now = c.needs.sanity;
  const cross = (t: number) => before >= t && now < t;
  if (cross(35))
    fx(w, { k: "toast", to: c.ctrl, text: "🧠 Рассудок падает (35). Поговорите с кем-нибудь, послушайте радио или музыку, сыграйте в настолку, посидите в уютной светлой комнате." });
  else if (cross(15))
    fx(w, { k: "toast", to: c.ctrl, text: "🧠 На грани срыва (15)! Срочно отдых: разговор, музыка, настолки, сон. На нуле — нервный срыв." });
}

export function sleepRate(w: World, c: Char) {
  const bed = c.task?.obj ? w.objs[c.task.obj] : undefined;
  let r = bed?.kind === "bed" || bed?.kind === "med_bed" ? 32 : 16;
  if (bed) {
    const room = bed.room ? w.rooms[bed.room] : undefined;
    if (room && room.level >= 2) r *= 1.15;
    // snoring roommates
    for (const id in w.chars) {
      const o = w.chars[id];
      if (o.id === c.id || !hasTrait(o, "snorer") || o.task?.action !== "sleep") continue;
      if (roomAt(w, Math.floor(o.x), o.lv) === room && !hasTrait(c, "lightsleeper")) r *= 0.75;
    }
  }
  return r;
}

// Timers for downed / breakdown characters (real seconds, any phase).
onTick("status", "*", (w, dt) => {
  for (const id in w.chars) {
    const c = w.chars[id];
    if (c.bark) {
      c.bark.t -= dt;
      if (c.bark.t <= 0) c.bark = null;
    }
    if (c.emote) {
      c.emote.t -= dt;
      if (c.emote.t <= 0) c.emote = null;
    }
    if (w.phase !== "day") continue;
    if (c.status === "down") {
      const before = c.downT;
      c.downT -= dt;
      c.anim = "down";
      // half a minute left and nobody on the way: say it loudly (#22)
      if (before > 30 && c.downT <= 30) {
        const rescuer = Object.values(w.chars).some((o) => o.status === "ok" && (o.task?.action === "rescue" || o.mind?.act?.a === "rescue") && ((o.task as any)?.char === c.id || o.mind?.act?.t === c.id));
        if (!rescuer) {
          const meds = (w.res.meds ?? 0) + (w.res.medkit ?? 0) >= 1;
          fx(w, { k: "toast", text: `🚑 ${firstName(c)}: 30 с до смерти — ${meds ? "подойдите с аптечкой (E)" : "нет ни одной аптечки!"}` });
          fx(w, { k: "sound", id: "alarm", x: c.x, lv: c.lv });
        }
      }
      if (c.downT <= 0) killChar(w, c, `${c.downCause ?? "без сознания"} — не дождался помощи`);
    } else if (c.status === "breakdown") {
      c.breakT -= dt;
      c.anim = "breakdown";
      if (c.breakT <= 0) {
        c.status = "ok";
        c.needs.sanity = 22;
        c.anim = "idle";
        log(w, `${firstName(c)} приходит в себя после срыва.`, "info");
      }
    }
  }
});

/** The real reason health ran out — the chronicle says «жажда», not just «не дождался помощи» (#22). */
function healthCause(w: World, c: Char): string {
  const n = c.needs;
  if (c.injury === "bleed") return "кровотечение";
  if (n.water <= 0) return "жажда";
  if (n.food <= 0) return "голод";
  if (w.air.co2 > 60) return "удушье (CO₂)";
  if (c.injury === "infection") return "заражение";
  if (n.rad > BAL.radDmgThreshold) return "радиация";
  if (c.sick > 0) return "болезнь";
  if (n.energy <= 0) return "истощение";
  return "раны";
}

export function knockDown(w: World, c: Char, why: string) {
  if (c.status === "dead") return;
  if (why === "здоровье") why = healthCause(w, c);
  c.downCause = why;
  w.flags._downDay = w.day;
  c.status = "down";
  c.downT = BAL.downSeconds;
  c.task = null;
  c.climbing = false;
  c.y = feetY(c.lv);
  log(w, `${c.card.name} без сознания (${why})! Нужна аптечка — удерживайте E рядом.`, "bad");
  fx(w, { k: "sound", id: "alarm", x: c.x, lv: c.lv });
  fx(w, { k: "toast", text: `🚑 ${firstName(c)} без сознания!` });
}

export function breakdown(w: World, c: Char) {
  c.status = "breakdown";
  c.breakT = BAL.breakdownSeconds;
  c.task = null;
  log(w, `${c.card.name} срывается: кричит, швыряет вещи!`, "bad");
  c.bark = { text: rng(w).pick(["Мы все здесь умрём!!!", "Выпустите меня!", "Я больше не могу!", "Хватит! ХВАТИТ!"]), t: 5 };
  // may damage a nearby object
  const r = rng(w);
  for (const id in w.objs) {
    const o = w.objs[id];
    if (o.lv === c.lv && Math.abs(o.x + 0.5 - c.x) < 3 && r.chance(0.35)) {
      o.wear = Math.max(0, o.wear - 40);
      log(w, `${firstName(c)} в ярости портит: ${o.kind === "radio" ? "радио" : "оборудование"}.`, "bad");
      break;
    }
  }
  for (const id in w.chars) {
    const o = w.chars[id];
    if (o.id !== c.id && o.status === "ok" && o.lv === c.lv && Math.abs(o.x - c.x) < 6) o.needs.sanity = clamp(o.needs.sanity - 5);
  }
}

export function killChar(w: World, c: Char, cause: string) {
  if (c.status === "dead") return;
  c.status = "dead";
  c.deathCause = cause;
  w.flags._deathDay = w.day;
  c.task = null;
  c.anim = "dead";
  c.hands = [];
  w.stats.deaths.push(c.id);
  log(w, `☠ ${c.card.name} погиб(ла): ${cause}.`, "bad");
  fx(w, { k: "toast", text: `☠ ${c.card.name} погиб(ла)` });
  for (const id in w.chars) {
    const o = w.chars[id];
    if (o.id !== c.id && o.status !== "dead") o.needs.sanity = clamp(o.needs.sanity - 15 - Math.max(0, (o.rel[c.id] ?? 0) / 5));
  }
  w.director.tension = clamp(w.director.tension + 30);
  w.director.quiet = Math.max(w.director.quiet, 1);
  // memorial
  const r = roomAt(w, Math.floor(c.x), c.lv);
  addObj(w, "grave", Math.floor(c.x), c.lv, r?.id, { name: c.card.name, day: w.day });
  const pid = c.ctrl;
  c.ctrl = null;
  if (pid && w.players[pid]) {
    const p = w.players[pid];
    p.char = null;
    p.ghost = true;
    fx(w, { k: "toast", to: pid, text: "Ваш персонаж погиб. Вы — «голос в рации», пока не найдётся новое тело." });
    autoTake(w, p);
  }
  for (const h of deathHooks) h(w, c, cause);
}
