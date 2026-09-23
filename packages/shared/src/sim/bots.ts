import barksJson from "../data/barks.json";
import { PROFS } from "../data/characters";
import { ITEMS } from "../data/items";
import { OBJECTS } from "../data/objects";
import type { Char, Chore, World } from "../types";
import { feetY, findPath, slotAccess, slotAccesses, unnode, walkable } from "../world/grid";
import { ROOMS, roomAt } from "../world/rooms";
import { ACTIONS, CHORE_DEFS, inReach, listActions, startAction, stopTask, type Target, type TargetType } from "./actions";
import { CHORE_ACTION } from "./chores";
import { foodUnits, isStorable } from "./items";
import { REST_ACTIONS } from "./leisure";
import { stepMove } from "./move";
import { onTick } from "./tick";
import { clamp, firstName, hasTrait, rng, skillLevel } from "./util";

const BARKS = barksJson as Record<string, string[]>;
import { BAL } from "../data/balance";
const BAL_BIKE = BAL.bikeKw;

// ---------------------------------------------------------------- barks

export function bark(w: World, c: Char, cat: string, vars: Record<string, string> = {}, to?: string) {
  const list = BARKS[cat];
  if (!list?.length) return;
  const R = rng(w);
  let text = R.pick(list);
  if (text === c.mind.lastBark && list.length > 1) text = R.pick(list);
  c.mind.lastBark = text;
  const others = Object.values(w.chars).filter((o) => o.id !== c.id && o.status !== "dead");
  const other = vars.other ?? (others.length ? firstName(R.pick(others)) : "друг");
  text = text
    .replace("{other}", other)
    .replace("{day}", String(w.day))
    .replace("{item}", vars.item ?? "Генератор")
    .replace("{name}", firstName(c));
  c.bark = { text, t: 4.5, to };
  c.mind.barkCd = 18 + R.range(0, 25);
}

// ---------------------------------------------------------------- schedule

export type Block = "wake" | "meal" | "work" | "leisure";

export function scheduleBlock(w: World, c: Char): Block {
  let h = w.hour;
  if (hasTrait(c, "nightowl")) h -= 1.5;
  if (h < 7.2) return "wake";
  if (h < 12) return "work";
  if (h < 13) return "meal";
  if (h < 18) return "work";
  if (h < 19) return "meal";
  return "leisure";
}

// ---------------------------------------------------------------- navigation

export function targetPos(w: World, tt: TargetType, id: string): { x: number; lv: number } | null {
  switch (tt) {
    case "obj": {
      const o = w.objs[id];
      return o ? { x: o.x + 0.5, lv: o.lv } : null;
    }
    case "item": {
      const it = w.items[id];
      return it ? { x: it.x, lv: it.lv } : null;
    }
    case "slot": {
      const [x, lv] = unnode(w, Number(id));
      const acc = slotAccess(w, x, lv);
      if (!acc) return null;
      if (acc.lv === lv) return { x: acc.x + (acc.x < x ? 0.75 : 0.25), lv };
      return { x: x + 0.5, lv: acc.lv };
    }
    case "room": {
      const r = w.rooms[id];
      if (!r) return null;
      for (let i = 0; i < r.w; i++) {
        const cx = r.x + Math.floor(r.w / 2) + (i % 2 ? -1 : 1) * Math.ceil(i / 2);
        if (walkable(w, cx, r.lv)) return { x: cx + 0.5, lv: r.lv };
      }
      return null;
    }
    case "char": {
      const o = w.chars[id];
      if (!o) return null;
      // stand beside them on whichever side is open floor
      for (const dx of [-0.6, 0.6, 0]) if (walkable(w, Math.floor(o.x + dx), o.lv)) return { x: o.x + dx, lv: o.lv };
      return null;
    }
    default:
      return null;
  }
}

/** Plans a route; returns false if unreachable. */
export function goTo(w: World, c: Char, x: number, lv: number): boolean {
  if (c.climbing) return false;
  const p = findPath(w, c.x, c.lv, x, lv);
  if (!p) return false;
  c.mind.path = p;
  c.mind.dest = { x, lv };
  c.mind.stuckT = 0;
  return true;
}

/** Follows the planned path. Returns "moving" | "arrived" | "stuck". */
export function followPath(w: World, c: Char, dt: number): "moving" | "arrived" | "stuck" {
  const m = c.mind;
  if (c.climbing) {
    stepMove(w, c, 0, m.cdir ?? 1, dt);
    return "moving";
  }
  const path = m.path;
  if (path && path.length) {
    const [nx, nl] = unnode(w, path[0]);
    if (nl === c.lv) {
      const tx = nx + 0.5;
      const dx = tx - c.x;
      if (Math.abs(dx) < 0.12 || (path.length > 1 && unnode(w, path[1])[1] === nl && Math.sign(dx) === Math.sign(unnode(w, path[1])[0] + 0.5 - c.x) && Math.abs(dx) < 0.6)) {
        path.shift();
        return "moving";
      }
      const before = c.x;
      stepMove(w, c, Math.sign(dx) * Math.min(1, Math.abs(dx) / (dt * 4 + 1e-6)), 0, dt);
      trackStuck(c, before, dt);
    } else {
      // climb at current column
      const cx = Math.floor(c.x);
      if (cx !== nx || Math.abs(c.x - (nx + 0.5)) > 0.4) {
        const before = c.x;
        stepMove(w, c, Math.sign(nx + 0.5 - c.x), 0, dt);
        trackStuck(c, before, dt);
      } else {
        m.cdir = nl > c.lv ? 1 : -1;
        stepMove(w, c, 0, m.cdir, dt);
        if (!c.climbing && c.lv !== nl) m.stuckT += dt;
      }
    }
    if (m.stuckT > 2.5) return "stuck";
    return "moving";
  }
  // final approach
  if (m.dest) {
    if (m.dest.lv !== c.lv) return "stuck";
    const dx = m.dest.x - c.x;
    if (Math.abs(dx) < 0.1) {
      m.dest = undefined;
      m.path = undefined;
      if (c.anim === "walk" || c.anim === "run") c.anim = "idle";
      return "arrived";
    }
    const before = c.x;
    const step = 3.2 * dt;
    stepMove(w, c, Math.abs(dx) < step ? dx / step : Math.sign(dx), 0, dt);
    trackStuck(c, before, dt);
    if (m.stuckT > 1.5) {
      m.dest = undefined;
      return "arrived";
    }
    return "moving";
  }
  return "arrived";
}

function trackStuck(c: Char, before: number, dt: number) {
  if (Math.abs(c.x - before) < 1e-4) c.mind.stuckT += dt;
  else c.mind.stuckT = 0;
}

// ---------------------------------------------------------------- decisions

interface Plan {
  a: string;
  tt: TargetType;
  t: string;
  param?: any;
  thought: string;
  chore?: string;
  leisure?: number; // seconds
}

function bestObj(w: World, c: Char, actionId: string, kinds: string[], filter?: (id: string) => boolean): Plan | null {
  let best: Plan | null = null;
  let bd = Infinity;
  const a = ACTIONS[actionId];
  if (!a) return null;
  for (const id in w.objs) {
    const o = w.objs[id];
    if (!kinds.includes(o.kind) || o.st.hidden) continue;
    if (filter && !filter(id)) continue;
    const av = a.avail({ w, c, t: { type: "obj", id }, o });
    if (typeof av !== "string") continue;
    const d = Math.abs(o.x - c.x) + Math.abs(o.lv - c.lv) * 8;
    if (d < bd) {
      bd = d;
      best = { a: actionId, tt: "obj", t: id, thought: "" };
    }
  }
  return best;
}

const INTEREST: Record<string, string[]> = {
  engineer: ["repair", "clean_air_filter", "flush_water_filter", "oil_generator", "build_frame", "charge_batteries"],
  electrician: ["repair", "charge_batteries", "oil_generator", "build_frame"],
  farmer: ["water_plants", "plant", "harvest", "pollinate", "prune", "treat_pests", "mushrooms", "feed_rabbits", "compost"],
  miner: ["dig", "haul", "reinforce"],
  cook: ["cook", "wash_dishes", "harvest", "feed_rabbits"],
  doctor: ["nurse", "mix_solution", "treat_pests"],
  chemist: ["mix_solution", "treat_pests", "clean_pipes"],
  soldier: ["periscope_watch", "haul", "dig", "pedal"],
  teacher: ["clean_room", "inventory", "check_geiger"],
  radioman: ["check_geiger", "periscope_watch", "repair"],
  priest: ["clean_room", "nurse", "water_plants"],
  conman: ["haul", "periscope_watch", "take_out_trash"],
};

function choreScore(w: World, c: Char, ch: Chore): number {
  const def = CHORE_DEFS[ch.kind];
  let s = ch.urgency + (ch.prio ? 0.35 : 0);
  if (def?.skill) s *= 1 + (skillLevel(c, def.skill) - 1) * 0.08;
  if (INTEREST[c.card.prof]?.includes(ch.kind)) s *= 1.35;
  if (ch.kind === "pedal" && c.needs.energy < 45) return -1;
  if ((ch.kind === "dig" || ch.kind === "haul") && c.needs.energy < 25) return -1;
  const pos = choreTarget(w, ch);
  if (!pos) return -1;
  const tp = targetPos(w, pos.tt, pos.t);
  if (!tp) return -1;
  const d = Math.abs(tp.x - c.x) + Math.abs(tp.lv - c.lv) * 6;
  s /= 1 + d / 20;
  return s;
}

function choreTarget(w: World, ch: Chore): { tt: TargetType; t: string } | null {
  if (ch.obj) return { tt: "obj", t: ch.obj };
  if (ch.room) return { tt: "room", t: ch.room };
  if (ch.item) return { tt: "item", t: ch.item };
  if (ch.cell !== undefined) return { tt: "slot", t: String(ch.cell) };
  if (ch.char) return { tt: "char", t: ch.char };
  return null;
}

function pickChore(w: World, c: Char): Plan | null {
  let best: Chore | null = null;
  let bs = 0.05;
  for (const id in w.chores) {
    const ch = w.chores[id];
    if (ch.by && ch.by !== c.id) continue;
    if (ch.pinnedBy) continue; // player took it
    // haul needs empty hands; dig/build need no junk in hands
    const s = choreScore(w, c, ch);
    if (s > bs) {
      // check availability
      if (ch.kind !== "haul") {
        const t = choreTarget(w, ch)!;
        const aid = CHORE_ACTION[ch.kind];
        const a = aid ? ACTIONS[aid] : undefined;
        if (!a) continue;
        const o = t.tt === "obj" ? w.objs[t.t] : undefined;
        const av = a.avail({ w, c, t: { type: t.tt, id: t.t }, o });
        if (typeof av !== "string") continue;
      } else if (c.hands.length) continue;
      bs = s;
      best = ch;
    }
  }
  if (!best) return null;
  best.by = c.id;
  const t = choreTarget(w, best)!;
  if (best.kind === "haul") return { a: "pickup", tt: "item", t: t.t, chore: best.id, thought: `Тащу: ${ITEMS[w.items[t.t]?.item]?.name ?? "вещь"}` };
  return { a: CHORE_ACTION[best.kind], tt: t.tt, t: t.t, chore: best.id, thought: CHORE_DEFS[best.kind]?.name ?? best.kind };
}

function leisurePlan(w: World, c: Char): Plan | null {
  const likes = PROFS[c.card.prof]?.likes ?? [];
  const R = rng(w);
  const options: { p: Plan; score: number }[] = [];
  for (const id in w.objs) {
    const o = w.objs[id];
    for (const a of Object.values(ACTIONS)) {
      if (!a.bot || a.type !== "obj" || !a.kinds?.includes(o.kind) || !REST_ACTIONS.has(a.id) || a.id === "sleep") continue;
      const av = a.avail({ w, c, t: { type: "obj", id }, o });
      if (typeof av !== "string") continue;
      let score = 1 + R.next();
      if (likes.includes(o.kind)) score += 1.5;
      if (OBJECTS[o.kind]?.social) score += c.needs.sanity < 50 ? 1 : 0.3;
      const d = Math.abs(o.x - c.x) + Math.abs(o.lv - c.lv) * 6;
      score /= 1 + d / 25;
      options.push({ p: { a: a.id, tt: "obj", t: id, thought: `Отдыхаю: ${av.replace(/^\S+\s/, "")}`, leisure: 25 + R.range(0, 40) }, score });
    }
  }
  options.sort((a, b) => b.score - a.score);
  return options[0]?.p ?? null;
}

function freeBed(w: World, c: Char): Plan | null {
  return bestObj(w, c, "sleep", ["bed", "med_bed"]);
}

export function decide(w: World, c: Char): Plan | null {
  const block = scheduleBlock(w, c);
  const n = c.needs;
  // emergencies: fire
  for (const id in w.rooms) {
    const r = w.rooms[id];
    if (r.fire > 0 && ((w.res.extinguisher ?? 0) >= 1 || (w.res.water ?? 0) + (w.res.water_dirty ?? 0) >= 1) && c.needs.health > 30) {
      return { a: "extinguish", tt: "room", t: id, thought: "Тушу пожар!" };
    }
  }
  // someone down
  for (const id in w.chars) {
    const o = w.chars[id];
    if (o.status === "down" && ((w.res.meds ?? 0) >= 1 || (w.res.medkit ?? 0) >= 1)) return { a: "rescue", tt: "char", t: id, thought: `Спасаю ${firstName(o)}!` };
  }
  // help request from a player
  const hr = (w.mods as any)._helpReq as { char: string; t: number } | undefined;
  if (hr && hr.char !== c.id && !(w.mods as any)._helpBy) {
    const pc = w.chars[hr.char];
    if (pc?.task && pc.task.obj) {
      (w.mods as any)._helpBy = c.id;
      return { a: pc.task.action, tt: "obj", t: pc.task.obj, thought: `Помогаю ${firstName(pc)}` };
    }
  }
  if (n.water < 40 && (w.res.water ?? 0) >= 1) {
    const p = bestObj(w, c, "drink", ["water_tank", "sink", "dining_table", "shelf"]);
    if (p) return { ...p, thought: "Хочу пить" };
  }
  // the night ration is the main meal; bots only snack when really hungry
  if ((n.food < 35 || (block === "meal" && n.food < 45 && c.meal < 1)) && foodUnits(w) >= 0.25) {
    const p = bestObj(w, c, "eat", ["dining_table", "shelf"]);
    if (p) return { ...p, thought: n.food < 38 ? "Голоден" : "Время обеда" };
  }
  if (n.energy < 22 || (block === "leisure" && w.hour > 21 && n.energy < 60)) {
    const p = freeBed(w, c);
    if (p) return { ...p, thought: n.energy < 22 ? "Валюсь с ног" : "Пора спать" };
    const chair = bestObj(w, c, "sit", ["armchair"]);
    if (chair) return { ...chair, thought: "Коек нет — вздремну в кресле", leisure: 60 };
  }
  if (c.hands.length) {
    // finish carrying whatever is in hands
    const h = c.hands[0];
    if (h.item === "dirt" || h.item === "trash") {
      const p = bestObj(w, c, "dump", ["hatch_ladder", "dirt_chute"]);
      if (p) return { ...p, thought: "Несу грунт к сбросу" };
    } else if (isStorable(h.item)) {
      const p = bestObj(w, c, "deposit", ["shelf"]);
      if (p) return { ...p, thought: "Несу на склад" };
    }
  }
  if (n.sanity < 35 || block === "leisure" || block === "wake") {
    if (block === "wake" && rng(w).chance(0.3)) {
      c.anim = "yawn";
      bark(w, c, "morning");
    }
    const p = leisurePlan(w, c);
    if (p && (block !== "wake" || rng(w).chance(0.5))) return p;
  }
  if (block === "work" || block === "wake" || block === "meal") {
    const p = pickChore(w, c);
    if (p) return p;
  }
  if (block === "leisure" || n.sanity < 70) {
    const p = leisurePlan(w, c);
    if (p) return p;
  }
  return null;
}

function execPlan(w: World, c: Char, p: Plan) {
  const m = c.mind;
  m.act = { a: p.a, tt: p.tt, t: p.t, param: p.param };
  m.chore = p.chore;
  m.thought = p.thought;
  m.plan = "go";
  if (p.leisure) m.until = w.phaseT + p.leisure;
  const pos = targetPos(w, p.tt, p.t);
  const t: Target = { type: p.tt, id: p.t };
  if (inReach(w, c, t)) {
    m.path = [];
    m.dest = undefined;
    return;
  }
  // digging: a freshly dug pit next to the slot may be unreachable — try every side
  let routed = !!pos && goTo(w, c, pos.x, pos.lv);
  if (!routed && p.tt === "slot") {
    const [sx, slv] = unnode(w, Number(p.t));
    for (const a of slotAccesses(w, sx, slv)) {
      const tx = a.lv === slv ? a.x + (a.x < sx ? 0.75 : 0.25) : sx + 0.5;
      if (goTo(w, c, tx, a.lv)) {
        routed = true;
        break;
      }
    }
  }
  if (!routed) {
    const d = ((w.mods as any)._botErr ??= {}) as Record<string, number>;
    d[p.a + ": нет пути"] = (d[p.a + ": нет пути"] ?? 0) + 1;
    releaseChore(w, c);
    m.plan = "idle";
    m.act = undefined;
    m.idleT = 2;
  }
}

function releaseChore(w: World, c: Char) {
  const id = c.mind.chore;
  if (id && w.chores[id]?.by === c.id) w.chores[id].by = undefined;
  c.mind.chore = undefined;
}

/** Stop rules for continuous tasks run by bots. */
function shouldStop(w: World, c: Char): boolean {
  const t = c.task!;
  if (t.action === "pedal") {
    const frac = w.power.cap ? w.power.battery / w.power.cap : 1;
    if (c.needs.energy < 30 || frac > 0.97) return true;
    if (w.hour < 15 && frac > 0.7 && w.power.gen - BAL_BIKE > w.power.demand) return true;
    if (c.needs.water < 30 || c.needs.food < 25) return true;
  }
  if (t.action === "sleep") {
    if (c.needs.energy >= 96) return true;
    if (c.needs.water < 20 || c.needs.food < 15) return true;
  }
  if (REST_ACTIONS.has(t.action) && t.action !== "sleep") {
    if (c.needs.water < 30 || c.needs.food < 30) return true;
    // the work day started and something real waits: back to work (unless the mind really needs the rest)
    if (scheduleBlock(w, c) === "work" && c.needs.sanity >= 35 && Object.values(w.chores).some((ch) => !ch.by && ch.urgency >= 0.4)) return true;
    if (c.needs.energy < 18 && t.action !== "sit") return true;
  }
  return false;
}

export function botTick(w: World, c: Char, dt: number) {
  const m = c.mind;
  m.barkCd -= dt;
  m.talkCd -= dt;
  if (c.task) {
    if (shouldStop(w, c)) {
      stopTask(w, c);
      releaseChore(w, c);
    } else {
      if (m.barkCd <= 0 && rng(w).chance(0.02)) {
        const cat = c.task.action === "dig" ? "work_dig" : c.task.action === "pedal" ? "work_pedal" : ["repair", "clean_air_filter", "flush_water_filter"].includes(c.task.action) ? "work_repair" : ["water_plants", "harvest", "plant", "pollinate", "prune"].includes(c.task.action) ? "work_garden" : c.task.action === "listen_radio" ? "radio" : REST_ACTIONS.has(c.task.action) && c.task.action !== "sleep" ? "rest" : "";
        if (cat) bark(w, c, cat);
      }
      return;
    }
  }
  if (m.plan === "go" && m.act) {
    const t: Target = { type: m.act.tt as TargetType, id: m.act.t };
    if (!inReach(w, c, t) || m.dest) {
      const st = followPath(w, c, dt);
      if (st === "stuck") {
        m.plan = "idle";
        m.act = undefined;
        m.path = undefined;
        m.dest = undefined;
        releaseChore(w, c);
        m.idleT = 1;
        return;
      }
      if (st === "moving") return;
    }
    // arrived: start
    const act = m.act;
    m.plan = "busy";
    m.act = undefined;
    const err = startAction(w, c, act.a, { type: act.tt as TargetType, id: act.t }, act.param);
    if (err) {
      // diagnostics for the balance simulator (hidden from clients)
      const k = act.a + ": " + err;
      const d = ((w.mods as any)._botErr ??= {}) as Record<string, number>;
      d[k] = (d[k] ?? 0) + 1;
      releaseChore(w, c);
      m.plan = "idle";
      m.idleT = 1.5;
      return;
    }
    if (act.a === "pickup") {
      // then carry it where it belongs (decide will route it next think)
      releaseChore(w, c);
    }
    if ((w.mods as any)._helpBy === c.id) {
      delete (w.mods as any)._helpBy;
      delete (w.mods as any)._helpReq;
    }
    return;
  }
  if (m.plan === "wander" && m.dest) {
    const st = followPath(w, c, dt);
    if (st !== "moving") m.plan = "idle";
    return;
  }
  // idle / think
  m.idleT -= dt;
  if (m.idleT > 0) return;
  if (!c.task && m.plan === "busy") {
    releaseChore(w, c);
    m.plan = "idle";
  }
  const p = decide(w, c);
  if (p) {
    execPlan(w, c, p);
    return;
  }
  // nothing to do: chat, idle animations, wander
  m.thought = "Бездельничаю";
  const R = rng(w);
  if (m.talkCd <= 0) {
    const mate = Object.values(w.chars).find((o) => o.id !== c.id && o.status === "ok" && !o.ctrl && o.lv === c.lv && Math.abs(o.x - c.x) < 3.5 && !o.task);
    if (mate) {
      converse(w, c, mate);
      m.talkCd = 40 + R.range(0, 40);
      m.idleT = 4;
      return;
    }
  }
  if (m.barkCd <= 0 && R.chance(0.3)) {
    const cat = c.needs.food < 45 ? "hungry" : c.needs.water < 45 ? "thirsty" : c.needs.energy < 35 ? "tired" : c.needs.sanity < 40 ? "sad" : c.needs.sanity > 80 ? "happy" : "idle";
    bark(w, c, cat);
  }
  const r = roomAt(w, Math.floor(c.x), c.lv);
  if (r && R.chance(0.5)) {
    const tx = r.x + 0.5 + R.range(0, r.w - 1);
    if (goTo(w, c, tx, r.lv)) m.plan = "wander";
  } else {
    c.anim = R.pick(["idle", "idle", "scratch", "yawn", "idle"]);
  }
  m.idleT = 3 + R.range(0, 4);
}

function converse(w: World, a: Char, b: Char) {
  const rel = a.rel[b.id] ?? 0;
  const R = rng(w);
  const grumpy = hasTrait(a, "grump") || hasTrait(b, "grump");
  if (rel < -20 || (grumpy && R.chance(0.3))) {
    bark(w, a, "quarrel", { other: firstName(b) }, b.id);
    a.rel[b.id] = rel - 3;
    b.rel[a.id] = (b.rel[a.id] ?? 0) - 3;
    a.needs.sanity = clamp(a.needs.sanity - 2);
    b.needs.sanity = clamp(b.needs.sanity - 2);
  } else if (rel > 40 && R.chance(0.4)) {
    bark(w, a, "friendly", { other: firstName(b) }, b.id);
    a.rel[b.id] = rel + 2;
    b.rel[a.id] = (b.rel[a.id] ?? 0) + 2;
    a.needs.sanity = clamp(a.needs.sanity + 3);
    b.needs.sanity = clamp(b.needs.sanity + 3);
  } else {
    bark(w, a, "talk_open", { other: firstName(b) }, b.id);
    a.rel[b.id] = rel + 1.5;
    b.rel[a.id] = (b.rel[a.id] ?? 0) + 1.5;
    a.needs.sanity = clamp(a.needs.sanity + 2);
    b.needs.sanity = clamp(b.needs.sanity + 2);
    (w.mods as any)._replies = [...((w.mods as any)._replies ?? []), { who: b.id, to: a.id, at: w.phaseT + 2.2 }];
  }
  a.dir = b.x > a.x ? 1 : -1;
  b.dir = a.x > b.x ? 1 : -1;
}

onTick("bots", "day", (w, dt) => {
  // delayed replies in conversations
  const reps = (w.mods as any)._replies as { who: string; to: string; at: number }[] | undefined;
  if (reps?.length) {
    const due = reps.filter((r) => r.at <= w.phaseT);
    (w.mods as any)._replies = reps.filter((r) => r.at > w.phaseT);
    for (const r of due) {
      const c = w.chars[r.who];
      if (c && c.status === "ok") bark(w, c, "talk_reply", {}, r.to);
    }
  }
  const hr = (w.mods as any)._helpReq;
  if (hr) {
    hr.t -= dt;
    if (hr.t <= 0) {
      delete (w.mods as any)._helpReq;
      delete (w.mods as any)._helpBy;
    }
  }
  for (const id in w.chars) {
    const c = w.chars[id];
    if (c.status !== "ok" || c.mind.plan === "combat") continue;
    if (c.ctrl) {
      const p = w.players[c.ctrl];
      if (p && p.online && !p.aquarium) continue; // a live player drives this one
    }
    botTick(w, c, dt);
  }
});

/** Resets bot minds (e.g. after night teleport). */
export function resetMind(c: Char) {
  c.mind.plan = "idle";
  c.mind.path = undefined;
  c.mind.dest = undefined;
  c.mind.act = undefined;
  c.mind.chore = undefined;
  c.mind.idleT = 0.5;
  c.climbing = false;
  c.y = feetY(c.lv);
}

export { listActions, ROOMS };
