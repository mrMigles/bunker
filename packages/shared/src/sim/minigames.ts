// Мини-игры: a player doing bunker work by hand opens a small window and actually does it —
// pumps the handle, scrubs the filter, turns the valve, screws in the bulb, tightens bolts.
// The client reports "pulses" (a finished stroke, a wiped patch, a bolt in the green zone);
// each pulse is a chunk of the task. While the window is open the task barely moves on its own;
// closing it lets the character finish at the normal automatic pace. Bots never play.
import type { Char, World } from "../types";
import { ACTIONS, taskTarget, type ActionCtx } from "./actions";
import { registerCmd } from "./commands";
import { clamp } from "./util";

export type MiniKind = "pump" | "pedal" | "scrub" | "turn" | "timing" | "pour" | "ph" | "clicks";

export interface MiniDef {
  kind: MiniKind;
  /** pulses that finish a timed task */
  pulses: number;
  title: string;
  hint: string;
  /** drawing flavour for shared mechanics (valve / bulb / ladle, wrench / pick / hammer…) */
  skin?: string;
}

const M = (kind: MiniKind, pulses: number, title: string, hint: string, skin?: string): MiniDef => ({ kind, pulses, title, hint, skin });

export const MINIGAMES: Record<string, MiniDef> = {
  pump: M("pump", 6, "Качаем воду", "Тяните рукоять вниз и вверх — мышью или W/S. Каждый полный качок — вода в ведро."),
  pedal: M("pedal", 0, "Крутим педали", "Жмите A и D по очереди, ровно, без спешки: ровный ритм даёт больше тока."),
  clean_air_filter: M("scrub", 10, "Чистим фильтр воздуха", "Зажмите мышь и протрите грязь с картриджа.", "filter"),
  clean_room: M("scrub", 10, "Уборка", "Зажмите мышь и оттирайте пятна.", "floor"),
  wash_dishes: M("scrub", 8, "Моем посуду", "Оттирайте тарелки мочалкой.", "dish"),
  clean_hutch: M("scrub", 8, "Чистим клетку", "Выгребайте опилки.", "floor"),
  clean_pipes: M("scrub", 8, "Чистим трубки", "Прочищайте ёршиком налёт.", "filter"),
  flush_water_filter: M("turn", 5, "Промываем водоочистку", "Крутите вентиль по часовой стрелке — ведите мышь по кругу.", "valve"),
  cook: M("turn", 6, "Готовим", "Мешайте половником по кругу — не слишком быстро, а то расплещете.", "ladle"),
  tea: M("turn", 3, "Завариваем чай", "Помешивайте по кругу.", "ladle"),
  repair: M("timing", 5, "Ремонт", "Бегунок ходит по шкале. Жмите ПРОБЕЛ или кликайте, когда он в зелёной зоне, — болт затянут.", "wrench"),
  oil_generator: M("timing", 4, "Обслуживаем генератор", "Ловите зелёную зону — ПРОБЕЛ или клик.", "wrench"),
  reinforce: M("timing", 5, "Укрепляем стены", "Бейте молотком, когда бегунок в зелёной зоне.", "hammer"),
  build_frame: M("timing", 6, "Строим каркас", "Забивайте гвозди в такт: ПРОБЕЛ в зелёной зоне.", "hammer"),
  dig: M("timing", 6, "Копаем", "Удар киркой в зелёной зоне — порода поддаётся быстрее.", "pick"),
  water_plants: M("pour", 3, "Поливаем грядки", "Зажмите мышь — вода льётся. Отпустите на зелёной черте.", "can"),
  mix_solution: M("ph", 3, "Смешиваем раствор", "Добавляйте кислоту или щёлочь, чтобы стрелка встала в зелёную зону, и держите её там.", "ph"),
  harvest: M("clicks", 6, "Собираем урожай", "Кликайте по спелым плодам.", "fruit"),
  treat_pests: M("clicks", 6, "Травим вредителей", "Давите жуков кликами, пока не расползлись.", "bug"),
  pollinate: M("clicks", 5, "Опыляем", "Коснитесь кисточкой каждого цветка.", "flower"),
  prune: M("clicks", 5, "Обрезаем", "Срезайте сухие листья.", "leaf"),
};

/** The minigame for a task, if it has one (the bulb is its own flavour of repair). */
export function miniFor(w: World, c: Char): (MiniDef & { action: string }) | null {
  const task = c.task;
  if (!task) return null;
  const def = MINIGAMES[task.action];
  if (!def) return null;
  const o = task.obj ? w.objs[task.obj] : undefined;
  if (task.action === "repair" && o?.kind === "lamp") return { ...def, kind: "turn", skin: "bulb", title: "Вкручиваем лампочку", hint: "Крутите лампочку по кругу мышью, пока не загорится.", pulses: 4, action: task.action };
  return { ...def, action: task.action };
}

/** Automatic progress while the minigame window is open (the player works with their hands instead). */
export const MINI_AUTO_SPEED = 0.25;

registerCmd("mgOpen", (w, p, cmd) => {
  const c = p.char ? w.chars[p.char] : undefined;
  if (!c?.task || !miniFor(w, c)) return;
  (c.task as any).mini = cmd.on ? 1 : 0;
});

/** One pulse of hand work: q = quality 0..1 (a sloppy stroke still helps a little). */
registerCmd("mg", (w, p, cmd) => {
  const c = p.char ? w.chars[p.char] : undefined;
  const task = c?.task;
  if (!c || !task) return;
  const mg = miniFor(w, c);
  if (!mg) return;
  // anti-spam: pulses come at human speed
  const last = (task as any).mgT ?? -1;
  if (w.phaseT - last < 0.12) return;
  (task as any).mgT = w.phaseT;
  const q = clamp(Number(cmd.q) || 0, 0, 1);
  const a = ACTIONS[task.action];
  const t = taskTarget(task);
  const ctx: ActionCtx = { w, c, t, o: t.type === "obj" ? w.objs[t.id] : undefined, param: (task as any).param };
  if (mg.kind === "pedal") {
    // cadence drives the generator: 0.6× for a stumble … 1.8× for a steady rhythm
    const o = ctx.o;
    if (o) o.st.boost = 0.6 + q * 1.2;
    return;
  }
  if (task.dur > 0) {
    task.t += (task.dur / mg.pulses) * (0.35 + 0.65 * q);
    (task as any).mgDone = ((task as any).mgDone ?? 0) + 1;
  } else if (a?.tick) {
    // open-ended work (digging, framing): a pulse is a few seconds of good work
    a.tick(ctx, 2.2 * (0.35 + 0.65 * q));
  }
});
