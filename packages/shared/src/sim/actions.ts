import { BAL } from "../data/balance";
import choresJson from "../data/chores.json";
import type { Char, Obj, SkillId, Task, World } from "../types";
import { feetY, slotAccess, unnode, walkable } from "../world/grid";
import { roomAt } from "../world/rooms";
import { registerCmd } from "./commands";
import { onTick } from "./tick";
import { addXp, clamp, fx, hasTrait, skillLevel } from "./util";
import { timeMult } from "./time";

export type TargetType = "obj" | "item" | "slot" | "room" | "char" | "self";

export interface Target {
  type: TargetType;
  id: string;
}

export interface ActionCtx {
  w: World;
  c: Char;
  t: Target;
  o?: Obj; // resolved object
  param?: any;
}

export interface ActionDef {
  id: string;
  type: TargetType;
  kinds?: string[]; // object kinds
  /** Return label (enabled), {label, reason} (disabled), or null (not applicable). */
  avail: (x: ActionCtx) => string | { label: string; reason: string } | null;
  dur: (x: ActionCtx) => number; // seconds, 0 = continuous
  hold?: boolean; // player must hold E (cancel on release)
  anim?: string;
  skill?: SkillId;
  xp?: number;
  prio?: number; // sort order in the prompt (lower first)
  start?: (x: ActionCtx) => string | void; // may return error
  tick?: (x: ActionCtx, dt: number) => boolean | void; // return true to finish
  done?: (x: ActionCtx) => void;
  stop?: (x: ActionCtx) => void; // cancelled or finished
  chore?: string; // completing clears chore of this kind on target
  sanity?: number; // small sanity reward on completion ("чувство порядка")
  noHelpers?: boolean;
  bot?: boolean; // bots may use it outside of chores (leisure etc.)
}

export const ACTIONS: Record<string, ActionDef> = {};
export const CHORE_DEFS = choresJson as Record<string, { name: string; icon: string; dur: number; skill: SkillId; obj?: string; mini?: string; desc: string }>;

export function defAction(a: ActionDef) {
  ACTIONS[a.id] = a;
}

export const REACH = 1.0;

export function objCenter(o: Obj) {
  return o.x + 0.5;
}

export function nearObj(c: { x: number; lv: number; climbing?: boolean }, o: Obj, reach = REACH) {
  return !c.climbing && c.lv === o.lv && Math.abs(c.x - objCenter(o)) <= reach;
}

export function resolve(w: World, t: Target): { o?: Obj; ok: boolean; x: number; lv: number } {
  switch (t.type) {
    case "obj": {
      const o = w.objs[t.id];
      return o ? { o, ok: true, x: o.x + 0.5, lv: o.lv } : { ok: false, x: 0, lv: 0 };
    }
    case "item": {
      const it = w.items[t.id];
      return it ? { ok: true, x: it.x, lv: it.lv } : { ok: false, x: 0, lv: 0 };
    }
    case "slot": {
      const [x, lv] = unnode(w, Number(t.id));
      const acc = slotAccess(w, x, lv);
      return acc ? { ok: true, x: acc.x + 0.5, lv: acc.lv } : { ok: false, x: x + 0.5, lv };
    }
    case "room": {
      const r = w.rooms[t.id];
      return r ? { ok: true, x: r.x + r.w / 2, lv: r.lv } : { ok: false, x: 0, lv: 0 };
    }
    case "char": {
      const ch = w.chars[t.id];
      return ch ? { ok: true, x: ch.x, lv: ch.lv } : { ok: false, x: 0, lv: 0 };
    }
    case "self":
      return { ok: true, x: 0, lv: 0 };
  }
}

/** Is the character in reach of the target? */
export function inReach(w: World, c: Char, t: Target): boolean {
  if (c.climbing) return false;
  switch (t.type) {
    case "obj": {
      const o = w.objs[t.id];
      return !!o && nearObj(c, o);
    }
    case "item": {
      const it = w.items[t.id];
      return !!it && it.lv === c.lv && Math.abs(it.x - c.x) <= REACH;
    }
    case "slot": {
      const [x, lv] = unnode(w, Number(t.id));
      // adjacent horizontally on same level, or directly above/below
      if (c.lv === lv && Math.abs(c.x - (x + 0.5)) <= 1.35) return true;
      if (Math.abs(c.lv - lv) === 1 && Math.abs(c.x - (x + 0.5)) <= 0.6) return true;
      return false;
    }
    case "room": {
      const r = w.rooms[t.id];
      return !!r && r.lv === c.lv && c.x >= r.x - 0.2 && c.x <= r.x + r.w + 0.2;
    }
    case "char": {
      const ch = w.chars[t.id];
      return !!ch && ch.lv === c.lv && Math.abs(ch.x - c.x) <= 1.2 && ch.id !== c.id;
    }
    case "self":
      return true;
  }
}

export interface AvailableAction {
  a: string;
  t: Target;
  label: string;
  reason?: string;
  x: number; // for sorting by distance
}

/** All actions the character can perform right now within reach. Shared by server (validation), client (prompt), bots. */
export function listActions(w: World, c: Char): AvailableAction[] {
  const out: AvailableAction[] = [];
  if (c.status !== "ok" || c.climbing) return out;
  const push = (a: ActionDef, t: Target, x: number, o?: Obj) => {
    const ctx: ActionCtx = { w, c, t, o };
    const r = a.avail(ctx);
    if (!r) return;
    if (typeof r === "string") out.push({ a: a.id, t, label: r, x });
    else out.push({ a: a.id, t, label: r.label, reason: r.reason, x });
  };
  const defs = Object.values(ACTIONS);
  for (const id in w.objs) {
    const o = w.objs[id];
    if (!nearObj(c, o) || o.st.hidden) continue;
    for (const a of defs) if (a.type === "obj" && (!a.kinds || a.kinds.includes(o.kind))) push(a, { type: "obj", id }, objCenter(o), o);
  }
  for (const id in w.items) {
    const it = w.items[id];
    if (it.lv !== c.lv || Math.abs(it.x - c.x) > REACH) continue;
    for (const a of defs) if (a.type === "item") push(a, { type: "item", id }, it.x);
  }
  // dig slots
  for (const key in w.marks) {
    const t: Target = { type: "slot", id: key };
    if (!inReach(w, c, t)) continue;
    const [x] = unnode(w, Number(key));
    for (const a of defs) if (a.type === "slot") push(a, t, x + 0.5);
  }
  const r = roomAt(w, Math.floor(c.x), c.lv);
  if (r) for (const a of defs) if (a.type === "room") push(a, { type: "room", id: r.id }, c.x + 0.01);
  for (const id in w.chars) {
    const o = w.chars[id];
    if (id === c.id) continue;
    const t: Target = { type: "char", id };
    if (!inReach(w, c, t)) continue;
    for (const a of defs) if (a.type === "char") push(a, t, o.x);
  }
  for (const a of defs) if (a.type === "self") push(a, { type: "self", id: c.id }, c.x + 0.02);
  out.sort((p, q) => (ACTIONS[p.a].prio ?? 50) - (ACTIONS[q.a].prio ?? 50) || Math.abs(p.x - c.x) - Math.abs(q.x - c.x));
  return out;
}

export function taskSpeed(w: World, c: Char, a: ActionDef, t: Target): number {
  let s = 1;
  if (a.skill) s *= 1 + (skillLevel(c, a.skill) - 1) * 0.1;
  if (a.skill === "repair" && hasTrait(c, "goldhands")) s *= 1.3;
  if (c.needs.energy < 20) s *= 0.7;
  if (c.drunk > 30) s *= 0.7;
  const r = roomAt(w, Math.floor(c.x), c.lv);
  if (r && !r.lit) s *= 0.75;
  if (c.injury === "arm") s *= 0.7;
  if (!a.noHelpers) {
    let n = 0;
    for (const id in w.chars) {
      const o = w.chars[id];
      if (o.id !== c.id && o.task && o.task.action === a.id && sameTarget(o.task, t)) n++;
    }
    s *= 1 + n * 0.6;
  }
  return s;
}

function sameTarget(task: Task, t: Target) {
  switch (t.type) {
    case "obj":
      return task.obj === t.id;
    case "item":
      return task.item === t.id;
    case "slot":
      return String(task.cell) === t.id;
    case "room":
      return task.room === t.id;
    default:
      return false;
  }
}

export function taskTarget(task: Task): Target {
  if (task.obj) return { type: "obj", id: task.obj };
  if (task.item) return { type: "item", id: task.item };
  if (task.cell !== undefined) return { type: "slot", id: String(task.cell) };
  if (task.room) return { type: "room", id: task.room };
  if ((task as any).char) return { type: "char", id: (task as any).char };
  return { type: "self", id: "" };
}

/** Starts an action for a character (validates reach & availability). Returns error text or undefined. */
export function startAction(w: World, c: Char, actionId: string, t: Target, param?: any): string | undefined {
  const a = ACTIONS[actionId];
  if (!a) return "Нет такого действия";
  if (c.status !== "ok") return "Персонаж не может действовать";
  if (!inReach(w, c, t)) return "Слишком далеко";
  const o = t.type === "obj" ? w.objs[t.id] : undefined;
  const ctx: ActionCtx = { w, c, t, o, param };
  const av = a.avail(ctx);
  if (!av) return "Недоступно";
  if (typeof av !== "string") return av.reason;
  if (c.task) stopTask(w, c);
  const err = a.start?.(ctx);
  if (err) return err;
  const task: Task = { action: a.id, t: 0, dur: a.dur(ctx), hold: !!a.hold };
  if (t.type === "obj") task.obj = t.id;
  else if (t.type === "item") task.item = t.id;
  else if (t.type === "slot") task.cell = Number(t.id);
  else if (t.type === "room") task.room = t.id;
  else if (t.type === "char") (task as any).char = t.id;
  if (param !== undefined) (task as any).param = param;
  c.task = task;
  if (o) claimSeat(w, c, o, task);
  c.anim = task.standing ? "sip" : (a.anim ?? "work");
  if (o) c.dir = objCenter(o) >= c.x ? 1 : -1;
  if (a.dur(ctx) === 0 && a.tick === undefined && a.done) {
    // instant
    a.done(ctx);
    finishTask(w, c, a, ctx);
  }
  return undefined;
}

/** Where people sit at shared furniture: one person per seat, the rest stand beside it. */
const SEATS: Record<string, number[]> = { dining_table: [0.3, 1.0, 1.7] };

export function claimSeat(w: World, c: Char, o: Obj, task: Task) {
  const seats = SEATS[o.kind];
  if (!seats) return;
  const others = Object.values(w.chars).filter((x) => x.id !== c.id && x.task?.obj === o.id);
  const taken = new Set(others.map((x) => x.task!.seat).filter((s) => s !== undefined));
  const i = seats.findIndex((_, k) => !taken.has(k));
  if (i >= 0) {
    task.seat = i;
    c.x = o.x + seats[i];
    c.dir = i < seats.length / 2 ? 1 : -1;
    return;
  }
  // no free chair: stand at the end of the table, a step apart from the others standing
  const standing = others.filter((x) => x.task!.standing).length;
  task.standing = true;
  const left = standing % 2 === 0;
  let x = left ? o.x - 0.3 - Math.floor(standing / 2) * 0.6 : o.x + 2.3 + Math.floor(standing / 2) * 0.6;
  const r = o.room ? w.rooms[o.room] : undefined;
  if (r) x = Math.max(r.x + 0.3, Math.min(r.x + r.w - 0.3, x));
  c.x = x;
  c.dir = x < o.x + 1 ? 1 : -1;
}

export function stopTask(w: World, c: Char) {
  const task = c.task;
  if (!task) return;
  const a = ACTIONS[task.action];
  c.task = null;
  c.seat = undefined;
  if (a?.stop) {
    const t = taskTarget(task);
    a.stop({ w, c, t, o: t.type === "obj" ? w.objs[t.id] : undefined, param: (task as any).param });
  }
  if (c.anim !== "walk" && c.anim !== "run") c.anim = "idle";
  c.y = feetY(c.lv);
}

function finishTask(w: World, c: Char, a: ActionDef, ctx: ActionCtx) {
  if (a.skill) addXp(c, a.skill, a.xp ?? BAL.xpPerAction);
  if (a.sanity) c.needs.sanity = clamp(c.needs.sanity + a.sanity);
  if (a.chore) completeChore(w, a.chore, ctx.t, c);
  c.task = null;
  a.stop?.(ctx);
  c.seat = undefined;
  if (c.anim !== "walk") c.anim = "idle";
  c.y = feetY(c.lv);
  // other characters doing the same thing on the same target are done too
  for (const id in w.chars) {
    const o = w.chars[id];
    if (o.id !== c.id && o.task && o.task.action === a.id && sameTarget(o.task, ctx.t) && a.dur(ctx) > 0) {
      o.task = null;
      o.anim = "idle";
    }
  }
}

export function completeChore(w: World, kind: string, t: Target, c?: Char) {
  for (const id in w.chores) {
    const ch = w.chores[id];
    if (ch.kind !== kind) continue;
    const match =
      (t.type === "obj" && ch.obj === t.id) ||
      (t.type === "room" && ch.room === t.id) ||
      (t.type === "item" && ch.item === t.id) ||
      (t.type === "slot" && String(ch.cell) === t.id) ||
      (t.type === "char" && ch.char === t.id);
    if (match) {
      delete w.chores[id];
      if (c) {
        w.stats.chores[c.id] = (w.stats.chores[c.id] ?? 0) + 1;
        c.needs.sanity = clamp(c.needs.sanity + 1.5);
      }
    }
  }
}

/** Per-tick task execution. */
export function tickTasks(w: World, dt: number) {
  for (const id in w.chars) {
    const c = w.chars[id];
    const task = c.task;
    if (!task) continue;
    if (c.status !== "ok") {
      stopTask(w, c);
      continue;
    }
    const a = ACTIONS[task.action];
    if (!a) {
      c.task = null;
      continue;
    }
    const t = taskTarget(task);
    const ctx: ActionCtx = { w, c, t, o: t.type === "obj" ? w.objs[t.id] : undefined, param: (task as any).param };
    if (t.type !== "self" && !resolve(w, t).ok) {
      stopTask(w, c);
      continue;
    }
    if (t.type !== "self" && t.type !== "char" && !inReach(w, c, t)) {
      stopTask(w, c);
      continue;
    }
    // a player with the minigame open works by hand: the task barely moves on its own
    const sp = taskSpeed(w, c, a, t) * ((task as any).mini ? 0.25 : 1);
    // timed work follows the game clock: when time is skipped (everyone resting ×3, debug speed) the
    // colony's work speeds up with it — before, needs ran 3× faster while work did not, and a
    // fast-forwarded colony starved (open-ended ticks like digging scale by the clock themselves)
    task.t += dt * sp * timeMult(w);
    c.anim = task.standing ? "sip" : (a.anim ?? "work");
    const fin = a.tick?.(ctx, dt * sp);
    if (!c.task) continue; // tick may stop it
    if (fin === true || (task.dur > 0 && task.t >= task.dur)) {
      a.done?.(ctx);
      // finished work teaches a little (rest and chatter don't)
      if (task.dur > 0 && a.skill) c.xp = (c.xp ?? 0) + 2;
      finishTask(w, c, a, ctx);
    }
  }
}

onTick("tasks", "day", tickTasks);

// ---- commands
registerCmd("do", (w, p, cmd) => {
  const c = p.char ? w.chars[p.char] : undefined;
  if (!c || c.ctrl !== p.id) return "Нет персонажа";
  if (w.phase !== "day") return "Сейчас не время";
  const type = String(cmd.tt) as TargetType;
  if (!["obj", "item", "slot", "room", "char", "self"].includes(type)) return "bad";
  return startAction(w, c, String(cmd.a), { type, id: String(cmd.t ?? c.id) }, cmd.x);
});

registerCmd("stop", (w, p, cmd) => {
  const c = p.char ? w.chars[p.char] : undefined;
  if (!c || !c.task) return;
  if (cmd.holdOnly && !c.task.hold) return;
  stopTask(w, c);
});

export function emitWork(w: World, c: Char, text: string, color = "#ffe08a") {
  fx(w, { k: "float", x: c.x, lv: c.lv, text, color });
}

export { walkable };
