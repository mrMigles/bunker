import { BAL } from "../data/balance";
import { ITEMS, itemName } from "../data/items";
import { OBJECTS } from "../data/objects";
import type { World } from "../types";
import { ROOMS } from "../world/rooms";
import { defAction, emitWork, stopTask } from "./actions";
import { canHold, dropHands, foodUnits, give, holdReason, isStorable, storeHands, takeFood } from "./items";
import { timeMult } from "./time";
import { clamp, firstName, fx, hoursPerSec, isBotDriven, log, rng } from "./util";

const hrs = (w: World, dt: number) => dt * hoursPerSec(w) * timeMult(w);

// ---------------------------------------------------------------- power & water

defAction({
  id: "pedal",
  type: "obj",
  kinds: ["bike_gen"],
  prio: 10,
  avail: ({ o, c }) => {
    if (o!.broken) return { label: "Крутить педали", reason: "Сломан — почините" };
    if (o!.st.rider && o!.st.rider !== c.id) return { label: "Крутить педали", reason: "Занято" };
    if (c.needs.energy < 8) return { label: "Крутить педали", reason: "Нет сил" };
    return "🚲 Крутить педали";
  },
  dur: () => 0,
  anim: "pedal",
  skill: "digging",
  xp: 0,
  start: ({ o, c }) => {
    o!.st.rider = c.id;
    c.x = o!.x + 0.5;
  },
  tick: ({ w, c, o }, dt) => {
    const h = hrs(w, dt);
    c.needs.energy = clamp(c.needs.energy - 5 * h);
    c.needs.water = clamp(c.needs.water - 2 * h);
    c.skills.digging += 0.02 * dt;
    if (!o!.st.rider) o!.st.rider = c.id;
    // pedalling by hand (minigame): the rhythm sets the output; without it the bike runs at the usual pace
    const target = (c.task as any)?.mini ? 0.3 : 1;
    o!.st.boost = target + ((o!.st.boost ?? 1) - target) * Math.exp(-dt / 1.5);
    if (c.needs.energy < 5) return true;
  },
  stop: ({ o, c }) => {
    if (o && o.st.rider === c.id) o.st.rider = undefined;
    if (o) o.st.boost = 1;
  },
});

defAction({
  id: "pump",
  type: "obj",
  kinds: ["hand_pump"],
  prio: 12,
  avail: ({ o }) => (o!.broken ? { label: "Качать воду", reason: "Сломан" } : "⛲ Накачать грязной воды"),
  dur: () => 8,
  anim: "work",
  skill: "digging",
  chore: "pump_water",
  done: ({ w, c, o }) => {
    w.res.water_dirty = (w.res.water_dirty ?? 0) + BAL.pumpDirtyPerAction;
    c.needs.energy = clamp(c.needs.energy - 2);
    o!.wear = Math.max(0, o!.wear - 1.5);
    emitWork(w, c, `+${BAL.pumpDirtyPerAction} 🟤 грязной воды`, "#c9a86b");
  },
});

defAction({
  id: "toggle_diesel",
  type: "obj",
  kinds: ["diesel_gen"],
  prio: 11,
  avail: ({ w, o }) => {
    if (o!.broken) return { label: "Запустить дизель", reason: "Сломан" };
    if (o!.st.running) return "⏹ Заглушить дизель";
    if ((w.res.fuel ?? 0) <= 0) return { label: "Запустить дизель", reason: "Нет топлива" };
    return "▶ Запустить дизель (шумно!)";
  },
  dur: () => 2,
  done: ({ w, o }) => {
    o!.st.running = o!.st.running ? 0 : 1;
    log(w, o!.st.running ? "Дизель затарахтел. Заметность растёт." : "Дизель заглушен.", "info");
  },
});

// ---------------------------------------------------------------- maintenance

defAction({
  id: "clean_air_filter",
  type: "obj",
  kinds: ["air_filter"],
  prio: 20,
  avail: ({ o }) => ((o!.st.dirt ?? 0) > 20 ? `🌬️ Почистить фильтр (${Math.round(o!.st.dirt)}% грязи)` : null),
  dur: () => 14,
  anim: "repair",
  skill: "repair",
  chore: "clean_air_filter",
  sanity: 1,
  done: ({ w, c, o }) => {
    o!.st.dirt = 0;
    emitWork(w, c, "Фильтр чист", "#8fcf6a");
  },
});

defAction({
  id: "flush_water_filter",
  type: "obj",
  kinds: ["water_filter"],
  prio: 20,
  avail: ({ o }) => ((o!.st.dirt ?? 0) > 20 ? `🚿 Промыть водоочистку (${Math.round(o!.st.dirt)}%)` : null),
  dur: () => 16,
  anim: "repair",
  skill: "repair",
  chore: "flush_water_filter",
  sanity: 1,
  done: ({ w, c, o }) => {
    o!.st.dirt = 0;
    emitWork(w, c, "Водоочистка промыта", "#8fcf6a");
  },
});

defAction({
  id: "oil_generator",
  type: "obj",
  kinds: ["bike_gen", "diesel_gen"],
  prio: 21,
  avail: ({ o }) => ((o!.st.oil ?? 100) < 60 ? "🛢️ Смазать, сменить ремень" : null),
  dur: () => 12,
  anim: "repair",
  skill: "repair",
  chore: "oil_generator",
  done: ({ o }) => {
    o!.st.oil = 100;
    o!.wear = Math.min(100, o!.wear + 15);
  },
});

defAction({
  id: "repair",
  type: "obj",
  prio: 5,
  avail: ({ w, o }) => {
    const def = OBJECTS[o!.kind];
    if (!def || (!def.wear && !o!.broken)) return null;
    if (o!.broken) {
      const cost = o!.kind === "bike_gen" || o!.kind === "hydro_tray" ? 1 : 2;
      if ((w.res.parts ?? 0) < cost) return { label: `🔧 Починить (${cost}⚙️)`, reason: `Нужно ${cost} запчасти` };
      return `🔧 Починить (${cost}⚙️)`;
    }
    if (o!.wear < 50) return `🔧 Обслужить (износ ${Math.round(100 - o!.wear)}%)`;
    return null;
  },
  dur: ({ o }) => (o!.broken ? 20 : 10),
  anim: "repair",
  skill: "repair",
  xp: 4,
  chore: "repair",
  sanity: 1,
  done: ({ w, c, o }) => {
    if (o!.broken) {
      const cost = o!.kind === "bike_gen" || o!.kind === "hydro_tray" ? 1 : 2;
      w.res.parts = Math.max(0, (w.res.parts ?? 0) - cost);
      o!.broken = false;
      log(w, `${firstName(c)} чинит: ${OBJECTS[o!.kind]?.name}.`, "good");
    }
    o!.wear = 100;
    emitWork(w, c, "Исправно", "#8fcf6a");
  },
});

defAction({
  id: "check_battery",
  type: "obj",
  kinds: ["battery"],
  prio: 30,
  avail: ({ o }) => (o!.wear < 70 ? "🔋 Проверить банки, долить электролит" : null),
  dur: () => 10,
  anim: "repair",
  skill: "repair",
  chore: "charge_batteries",
  done: ({ o }) => {
    o!.wear = 100;
  },
});

// ---------------------------------------------------------------- rest & food

defAction({
  id: "sleep",
  type: "obj",
  kinds: ["bed", "med_bed"],
  prio: 15,
  avail: ({ w, c, o }) => {
    for (const id in w.chars) {
      const x = w.chars[id];
      if (x.id !== c.id && x.task?.obj === o!.id && x.task.action === "sleep") return { label: "Спать", reason: "Койка занята" };
    }
    if (c.needs.energy > 92) return { label: "💤 Спать", reason: "Не хочется спать" };
    return "💤 Спать";
  },
  dur: () => 0,
  anim: "sleep",
  bot: true,
  start: ({ c, o }) => {
    c.x = o!.x + 0.5;
  },
  tick: ({ w, c }) => {
    c.slept = true;
    if (isBotDriven(w, c.id) && c.needs.energy >= 96) return true;
    if (c.ctrl && c.needs.energy >= 100) {
      fx(w, { k: "toast", to: c.ctrl, text: "Вы выспались" });
      return true;
    }
  },
});

defAction({
  id: "eat",
  type: "obj",
  kinds: ["dining_table", "shelf"],
  prio: 14,
  avail: ({ w, c }) => {
    if (c.needs.food > 85) return null;
    if (foodUnits(w) < 0.25) return { label: "🍽 Поесть", reason: "Еды нет" };
    return "🍽 Поесть (1 паёк)";
  },
  dur: () => 7,
  anim: "eat",
  bot: true,
  done: ({ w, c, o }) => {
    const [nut, san, names] = takeFood(w, 1);
    c.needs.food = clamp(c.needs.food + nut * BAL.foodPerUnit);
    // eating together at the table is nicer
    let company = 0;
    if (o!.kind === "dining_table") {
      for (const id in w.chars) {
        const x = w.chars[id];
        if (x.id !== c.id && x.task?.action === "eat" && x.lv === c.lv && Math.abs(x.x - c.x) < 3) company++;
      }
    }
    // no free chair: eating on your feet by the table
    c.needs.sanity = clamp(c.needs.sanity + san + company * 3 - (c.task?.standing ? 3 : 0));
    c.meal++;
    w.stats.ate[c.id] = (w.stats.ate[c.id] ?? 0) + nut;
    emitWork(w, c, `🍽 ${names.join(", ")}`, "#e8dcc0");
    w.flags._dishes = (w.flags._dishes ?? 0) + 1;
  },
});

defAction({
  id: "drink",
  type: "obj",
  kinds: ["dining_table", "shelf", "water_tank", "sink"],
  prio: 14,
  avail: ({ w, c }) => {
    if (c.needs.water > 85) return null;
    if ((w.res.water ?? 0) < 1) return { label: "💧 Попить", reason: "Чистой воды нет" };
    return "💧 Попить воды";
  },
  dur: () => 3,
  anim: "eat",
  bot: true,
  done: ({ w, c }) => {
    w.res.water = Math.max(0, (w.res.water ?? 0) - 1);
    c.needs.water = clamp(c.needs.water + BAL.waterPerUnit);
  },
});

// ---------------------------------------------------------------- carrying

defAction({
  id: "pickup",
  type: "item",
  prio: 8,
  avail: ({ w, c, t }) => {
    const it = w.items[t.id];
    if (!it) return null;
    const label = `✋ Поднять: ${ITEMS[it.item]?.icon ?? ""}${itemName(it.item)}${it.n > 1 ? " ×" + it.n : ""}`;
    if (!canHold(c, it.item)) return { label, reason: `${holdReason(c, it.item)} (Q — бросить)` };
    return label;
  },
  dur: () => 0,
  done: ({ w, c, t }) => {
    const it = w.items[t.id];
    if (!it) return;
    const large = !!ITEMS[it.item]?.large;
    const n = large ? 1 : it.n;
    if (give(c, it.item, n)) {
      it.n -= n;
      if (it.n <= 0) delete w.items[t.id];
    }
  },
});

defAction({
  id: "drop",
  type: "self",
  prio: 90,
  avail: ({ c }) => (c.hands.length ? null : null), // exposed via Q key only
  dur: () => 0,
  done: ({ w, c }) => dropHands(w, c),
});

defAction({
  id: "deposit",
  type: "obj",
  kinds: ["shelf", "med_cabinet", "weapon_rack", "tool_rack", "game_shelf"],
  prio: 3,
  avail: ({ c }) => (c.hands.some((h) => isStorable(h.item)) ? "📥 Сложить на склад" : null),
  dur: () => 1.2,
  anim: "work",
  done: ({ w, c }) => {
    const got = storeHands(w, c);
    if (got.length) emitWork(w, c, got.join(", "), "#8fcf6a");
  },
});

/** Carrying loot anywhere in the bunker: one button walks it to the nearest shelf (the client routes). */
defAction({
  id: "carry_to_store",
  type: "self",
  prio: 2,
  avail: ({ w, c }) => {
    if (!c.hands.some((h) => isStorable(h.item))) return null;
    const nearShelf = Object.values(w.objs).some((o) => ["shelf", "med_cabinet", "weapon_rack", "tool_rack", "game_shelf"].includes(o.kind) && o.lv === c.lv && Math.abs(o.x + 0.5 - c.x) <= 1);
    return nearShelf ? null : "📥 Отнести на склад";
  },
  dur: () => 0,
});

defAction({
  id: "dump",
  type: "obj",
  kinds: ["hatch_ladder", "dirt_chute"],
  prio: 2,
  avail: ({ c }) => {
    const h = c.hands.find((x) => x.item === "dirt" || x.item === "trash" || x.item === "laundry");
    if (!h) return null;
    return h.item === "dirt" ? "⛰️ Выбросить грунт наверх" : h.item === "trash" ? "🗑️ Выбросить мусор" : null;
  },
  dur: () => 1.5,
  anim: "work",
  done: ({ w, c }) => {
    const dirt = c.hands.filter((h) => h.item === "dirt").reduce((s, h) => s + h.n, 0);
    c.hands = c.hands.filter((h) => h.item !== "dirt" && h.item !== "trash");
    if (dirt) {
      w.flags.dirt_dumped = (w.flags.dirt_dumped ?? 0) + dirt;
      w.notice = clamp(w.notice + 0.15 * dirt);
    }
    c.needs.sanity = clamp(c.needs.sanity + 0.5);
  },
});

/** «Разобрать хлам» (#25): a bag of rubbish on the workbench gives back a little scrap, wood or cloth. */
defAction({
  id: "salvage_trash",
  type: "obj",
  kinds: ["workbench"],
  prio: 19,
  avail: ({ c }) => (c.hands.some((h) => h.item === "trash") ? "🔨 Разобрать хлам на материалы" : null),
  dur: () => 10,
  anim: "repair",
  skill: "repair",
  xp: 2,
  done: ({ w, c }) => {
    const i = c.hands.findIndex((h) => h.item === "trash");
    if (i < 0) return;
    c.hands.splice(i, 1);
    const R = rng(w);
    const got: Record<string, number> = {};
    // a slow but sure source: at least one piece of something from every bag
    for (const [k, p] of [["scrap", 0.6], ["wood", 0.5], ["cloth", 0.35], ["chem", 0.15]] as const) if (R.chance(p)) got[k] = 1;
    if (!Object.keys(got).length) got.scrap = 1;
    for (const k in got) w.res[k] = (w.res[k] ?? 0) + got[k];
    emitWork(w, c, "🔨 " + Object.keys(got).map((k) => `+${got[k]} ${itemName(k)}`).join(", "), "#8fcf6a");
  },
});

defAction({
  id: "take_trash",
  type: "obj",
  kinds: ["trash_bin"],
  prio: 20,
  avail: ({ c, o }) => {
    if ((o!.st.fill ?? 0) < 50) return null;
    if (c.hands.length) return { label: "🗑️ Вынести мусор", reason: "Руки заняты" };
    return "🗑️ Вынести мусор";
  },
  dur: () => 3,
  anim: "work",
  chore: "take_out_trash",
  done: ({ c, o }) => {
    o!.st.fill = 0;
    give(c, "trash", 1);
  },
});

// ---------------------------------------------------------------- rooms: cleaning, fire

defAction({
  id: "clean_room",
  type: "room",
  prio: 40,
  avail: ({ w, t }) => {
    const r = w.rooms[t.id];
    if (!r || r.dirt < 25 || r.fire > 0) return null;
    return `🧹 Убраться (грязь ${Math.round(r.dirt)}%)`;
  },
  dur: () => 12,
  anim: "work",
  skill: "cooking",
  chore: "clean_room",
  sanity: 2,
  done: ({ w, t }) => {
    const r = w.rooms[t.id];
    if (r) r.dirt = Math.max(0, r.dirt - 70);
  },
});

defAction({
  id: "extinguish",
  type: "room",
  prio: 1,
  avail: ({ w, t }) => {
    const r = w.rooms[t.id];
    if (!r || r.fire <= 0) return null;
    if ((w.res.extinguisher ?? 0) < 1 && (w.res.water ?? 0) + (w.res.water_dirty ?? 0) < 1) return { label: "🧯 Тушить", reason: "Нет огнетушителя и воды!" };
    return (w.res.extinguisher ?? 0) >= 1 ? "🧯 Тушить огнетушителем" : "🪣 Тушить водой";
  },
  dur: () => 0,
  anim: "work",
  skill: "repair",
  hold: true,
  tick: ({ w, t }, dt) => {
    const r = w.rooms[t.id];
    if (!r) return true;
    const ext = (w.res.extinguisher ?? 0) >= 1;
    r.fire = Math.max(0, r.fire - (ext ? 14 : 8) * dt);
    if (!ext) {
      const k = (w.res.water_dirty ?? 0) >= 0.2 ? "water_dirty" : "water";
      w.res[k] = Math.max(0, (w.res[k] ?? 0) - 0.3 * dt);
    } else {
      w.flags._ext_use = (w.flags._ext_use ?? 0) + dt;
      if (w.flags._ext_use > 25) {
        w.flags._ext_use = 0;
        w.res.extinguisher = Math.max(0, (w.res.extinguisher ?? 0) - 1);
        log(w, "Огнетушитель опустел.", "info");
      }
    }
    if (r.fire <= 0) {
      log(w, `Пожар в ${ROOMS[r.type]?.name} потушен.`, "good");
      r.dirt = clamp(r.dirt + 20);
      return true;
    }
  },
});

// ---------------------------------------------------------------- people

defAction({
  id: "rescue",
  type: "char",
  prio: 0,
  avail: ({ w, t }) => {
    const x = w.chars[t.id];
    if (!x || x.status !== "down") return null;
    if ((w.res.meds ?? 0) < 1 && (w.res.medkit ?? 0) < 1) return { label: "🩹 Спасти", reason: "Нужна аптечка или медикаменты" };
    return `🩹 Спасти ${firstName(x)} (удерживать E)`;
  },
  dur: () => 6,
  hold: true,
  anim: "work",
  skill: "medicine",
  xp: 6,
  done: ({ w, c, t }) => {
    const x = w.chars[t.id];
    if (!x || x.status !== "down") return;
    if ((w.res.medkit ?? 0) >= 1) w.res.medkit -= 1;
    else w.res.meds = Math.max(0, (w.res.meds ?? 0) - 1);
    x.status = "ok";
    x.downT = 0;
    x.needs.health = Math.max(x.needs.health, 25);
    // back on their feet with the same empty stomach they would just fall again: a sip and a bite first (#22)
    if (x.needs.water < 25 && (w.res.water ?? 0) >= 1) ((w.res.water -= 1), (x.needs.water = 25));
    if (x.needs.food < 25 && takeFood(w, 1)[0] > 0) x.needs.food = 25;
    x.downCause = undefined;
    x.anim = "idle";
    x.rel[c.id] = (x.rel[c.id] ?? 0) + 25;
    log(w, `${firstName(c)} спасает ${firstName(x)}!`, "good");
    if (c.card.goal === "medic") w.flags["_goal_medic_" + c.id] = 1;
  },
});

defAction({
  id: "wake",
  type: "char",
  prio: 60,
  avail: ({ w, t }) => {
    const x = w.chars[t.id];
    return x && x.task?.action === "sleep" && !x.ctrl ? "👋 Разбудить" : null;
  },
  dur: () => 1,
  done: ({ w, c, t }) => {
    const x = w.chars[t.id];
    if (!x) return;
    stopTask(w, x);
    x.bark = { text: "А? Что? Уже утро?..", t: 3 };
    x.rel[c.id] = (x.rel[c.id] ?? 0) - 3;
  },
});

// ---------------------------------------------------------------- misc stations

defAction({
  id: "check_geiger",
  type: "obj",
  kinds: ["geiger"],
  prio: 30,
  avail: () => "📟 Проверить фон у шлюза",
  dur: () => 4,
  skill: "radio",
  chore: "check_geiger",
  done: ({ w, c }) => {
    const lvl = w.weather.today === "radrain" ? "высокий" : w.weather.today === "storm" ? "опасный" : w.weather.today === "ash" ? "повышенный" : "терпимый";
    w.flags.geiger_day = w.day;
    emitWork(w, c, `Фон снаружи: ${lvl}`, "#e8c14a");
  },
});

defAction({
  id: "periscope",
  type: "obj",
  kinds: ["periscope"],
  prio: 25,
  avail: () => "🔭 Посмотреть в перископ",
  dur: () => 8,
  anim: "work",
  skill: "stealth",
  chore: "periscope_watch",
  bot: true,
  done: ({ w, c }) => {
    c.needs.sanity = clamp(c.needs.sanity + 2);
    w.flags.periscope_day = w.day;
    if (w.director.raidWarn && !w.flags._raid_spotted) {
      w.flags._raid_spotted = 1;
      log(w, `${firstName(c)} замечает в перископ чужаков у входа. Готовьтесь к налёту!`, "bad");
      fx(w, { k: "toast", text: "👁 У входа видели чужаков!" });
    }
    if (c.ctrl && !isBotDriven(w, c.id)) fx(w, { k: "news", to: c.ctrl, id: "periscope", data: { weather: w.weather.today, day: w.day } });
  },
});

import { registerCmd } from "./commands";
registerCmd("drop", (w, p) => {
  const c = p.char ? w.chars[p.char] : undefined;
  if (!c || !c.hands.length || w.phase !== "day") return;
  dropHands(w, c);
});
