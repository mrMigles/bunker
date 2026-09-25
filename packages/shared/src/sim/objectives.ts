// «Задачи»: what the colony should do right now, in plain words.
// Two layers: a short first-days tutorial (each step completes by doing it) and live priorities
// computed from the bunker's state (food, water, power, air, breakdowns, the wounded, fires, raids).
// The list is public: everyone sees the same priorities, clicking one walks you to its target.
import { OBJECTS } from "../data/objects";
import type { World } from "../types";
import { objsOfKind, roomsOfType } from "../world/rooms";
import { foodUnits } from "./items";
import { toolFor } from "./build";
import { unnode } from "../world/grid";
import { onTick } from "./tick";
import { firstName } from "./util";
import { maxGeneration } from "./foreman";

export interface Objective {
  id: string;
  kind: "urgent" | "need" | "quest" | "tutorial";
  text: string;
  hint?: string;
  done?: boolean;
  /** where to go: an object or a character */
  obj?: string;
  char?: string;
}

const TUTORIAL: { id: string; text: string; hint: string; done: (w: World) => boolean; obj?: (w: World) => string | undefined }[] = [
  {
    id: "pedal",
    text: "Покрутите генератор-велосипед",
    hint: "Подойдите к велосипеду в техотсеке и нажмите E. Энергия нужна фильтрам, свету и грядкам.",
    done: (w) => !!w.flags.tut_pedal,
    obj: (w) => objsOfKind(w, "bike_gen")[0]?.id,
  },
  {
    id: "plan",
    text: "Разметьте новую комнату",
    hint: "Режим стройки — B. Гидропоника кормит, жилой отсек даёт койки. Жильцы выкопают сами.",
    done: (w) => (w.flags._humanPlanDay ?? 0) > 0,
  },
  {
    id: "sortie",
    text: "Соберите вылазку за припасами",
    hint: "Терминал в шлюзе. Отряд из 2–3 человек почти не рискует; в одиночку опасно.",
    done: (w) => !!w.flags.tut_sortie,
    obj: (w) => objsOfKind(w, "sortie_terminal")[0]?.id,
  },
  {
    id: "night",
    text: "Переживите первую ночь",
    hint: "В 22:00 соберётся совет: пайки, событие дня, план на завтра.",
    done: (w) => w.day >= 2,
  },
];

export function computeObjectives(w: World): Objective[] {
  const out: Objective[] = [];
  const home = Object.values(w.chars).filter((c) => c.status !== "dead" && c.status !== "away");
  const n = Math.max(1, home.length);
  // --- urgent: people and fire first
  for (const c of home)
    if (c.status === "down") out.push({ id: "down_" + c.id, kind: "urgent", text: `${firstName(c)} без сознания`, hint: "Нужны медикаменты или аптечка: подойдите и нажмите E.", char: c.id });
  for (const r of Object.values(w.rooms))
    if (r.fire > 0) {
      const o = Object.values(w.objs).find((x) => x.room === r.id);
      out.push({ id: "fire_" + r.id, kind: "urgent", text: "Пожар!", hint: "Тушите огнетушителем или водой — огонь портит всё вокруг.", obj: o?.id });
    }
  const call = w.mods.intercom as { kind: string; done?: string; until: number } | undefined;
  if (call && !call.done)
    out.push({ id: "intercom", kind: "urgent", text: call.kind === "trader" ? "📞 У двери торговец" : call.kind === "refugee" ? "📞 Просят впустить" : "📞 Звонят в интерком", hint: `Подойдите к интеркому у гермодвери. Уйдут через ~${Math.max(0, call.until - w.hour).toFixed(1)} ч.`, obj: objsOfKind(w, "intercom")[0]?.id });
  if (w.director?.raidWarn) out.push({ id: "raid", kind: "urgent", text: "К бункеру идут налётчики", hint: "Займите позиции у шлюза, заприте люк, раздайте оружие." });
  // --- needs
  const food = foodUnits(w) / n;
  if (food < 2) out.push({ id: "food", kind: food < 1 ? "urgent" : "need", text: food < 0.5 ? "Еда закончилась" : `Еды на ${food.toFixed(1)} дн.`, hint: "Вылазка в магазин или на ферму; соберите урожай, посадите грядки.", obj: objsOfKind(w, "sortie_terminal")[0]?.id });
  const water = (w.res.water ?? 0) / (2 * n);
  if (water < 1.5) out.push({ id: "water", kind: water < 0.7 ? "urgent" : "need", text: `Воды на ${water.toFixed(1)} дн.`, hint: "Качайте насос (грязная вода) и держите фильтр воды чистым и под током.", obj: objsOfKind(w, "hand_pump")[0]?.id });
  const cap = w.power.cap || 1;
  if (w.power.battery / cap < 0.25 && w.power.gen < w.power.demand) out.push({ id: "power", kind: w.power.battery <= 0.05 ? "urgent" : "need", text: w.power.battery <= 0.05 ? "Нет энергии — свет и фильтры отключаются" : "Аккумулятор садится", hint: "Крутите велогенератор (E). Ещё один велосипед можно собрать как мебель.", obj: objsOfKind(w, "bike_gen").find((o) => !o.broken && !o.st.rider)?.id });
  // the bunker has outgrown its generators: even non-stop pedalling would not keep up
  const bikes = objsOfKind(w, "bike_gen").filter((o) => !o.broken).length;
  if ((w.flags._demAvg ?? 0) > maxGeneration(w) * 0.85 && w.power.battery / cap < 0.6)
    out.push({ id: "power_more", kind: "need", text: bikes <= 1 ? "Одного велосипеда уже мало" : "Генераторов не хватает", hint: `Бункер берёт ${(w.flags._demAvg ?? 0).toFixed(1)} кВт — больше, чем дают генераторы. Соберите ещё велосипед на верстаке (🚲) или поставьте генератор в генераторной.`, obj: objsOfKind(w, "workbench")[0]?.id });
  if (w.air.co2 > 45) out.push({ id: "air", kind: w.air.co2 > 65 ? "urgent" : "need", text: "Душно: CO₂ растёт", hint: "Почистите фильтр воздуха и дайте ему энергию.", obj: objsOfKind(w, "air_filter")[0]?.id });
  for (const o of Object.values(w.objs))
    if (o.broken && OBJECTS[o.kind]) out.push({ id: "broken_" + o.id, kind: "need", text: `Сломан: ${OBJECTS[o.kind].name}`, hint: "Почините (E) — нужны детали или хлам.", obj: o.id });
  // planned digging that no one can do: stone without a pickaxe, granite without a drill
  for (const key in w.marks) {
    const [mx, mlv] = unnode(w, Number(key));
    const tool = toolFor(w, mx, mlv);
    if (tool.ok) continue;
    out.push({ id: "tool_" + key, kind: "need", text: tool.need!, hint: "Разметка упёрлась в породу. Кирку находят в ящиках с инструментами на вылазках; бур — редкая находка." });
    break;
  }
  const beds = objsOfKind(w, "bed").length;
  if (beds < n && roomsOfType(w, "living").length) out.push({ id: "beds", kind: "need", text: `Коек ${beds} на ${n} человек`, hint: "Спящие на полу хуже отдыхают. Постройте жилой отсек (B) или соберите нары." });
  // --- promises made in conversations
  for (const q of (w.mods.quests ?? []) as { id: string; giver: string; by: string; text: string; kind: string; target: string; done?: boolean }[]) {
    if (q.done) continue;
    const giver = w.chars[q.giver];
    if (!giver) continue;
    const chore = q.kind === "chore" ? w.chores[q.target] : undefined;
    out.push({
      id: "quest_" + q.id,
      kind: "quest",
      text: `${firstName(giver)} просит: ${q.text}`,
      hint: q.kind === "room" ? "Режим стройки — B." : q.kind === "bring" ? "Найдите на вылазке и сложите на склад." : "Подойдите и нажмите E.",
      obj: chore?.obj,
      char: chore?.obj ? undefined : giver.id,
    });
  }
  // --- tutorial: the first unfinished step, plus the ones already done today (to see progress)
  if (w.day <= 3) {
    for (const t of TUTORIAL) {
      const done = t.done(w);
      if (done && (w.flags["_tutshow_" + t.id] ?? 0) < w.phaseT - 25) continue; // done steps fade after a bit
      if (!done) w.flags["_tutshow_" + t.id] = w.phaseT;
      out.push({ id: "tut_" + t.id, kind: "tutorial", text: t.text, hint: t.hint, done, obj: t.obj?.(w) });
      if (!done) break;
    }
  }
  const order = { urgent: 0, need: 1, quest: 2, tutorial: 3 };
  return out.sort((a, b) => order[a.kind] - order[b.kind]).slice(0, 7);
}

onTick("objectives", "*", (w, dt) => {
  if (w.phase !== "day" && w.phase !== "night") return;
  w.flags._objT = (w.flags._objT ?? 0) + dt;
  if (w.flags._objT < 1) return;
  w.flags._objT = 0;
  // tutorial progress that is easiest to catch here
  for (const c of Object.values(w.chars)) if (c.task?.action === "pedal" && c.ctrl) w.flags.tut_pedal = 1;
  w.mods.objectives = computeObjectives(w);
});
