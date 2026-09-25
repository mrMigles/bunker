import cropsJson from "../data/crops.json";
import { BAL } from "../data/balance";
import { ITEMS, itemName } from "../data/items";
import type { Obj, World } from "../types";
import { objsInRoom } from "../world/rooms";
import { defAction, emitWork } from "./actions";
import { spawnItem } from "./items";
import { powered } from "./systems";
import { onTick } from "./tick";
import { timeMult } from "./time";
import { clamp, firstName, hasTrait, hoursPerSec, log, rng, skillLevel } from "./util";

export interface CropDef {
  name: string;
  days: number;
  yield: [number, number];
  item: string;
  seeds: [number, number];
  water: number;
  nutr: number;
  light: number;
  pollinate: boolean;
  prune: boolean;
  desc: string;
}

export const CROPS = cropsJson as unknown as Record<string, CropDef>;

export function seedItem(crop: string) {
  return crop === "mushroom" ? "spores" : "seed_" + crop;
}

function tankFor(w: World, o: Obj): Obj | undefined {
  if (!o.room) return undefined;
  return objsInRoom(w, o.room).find((x) => x.kind === "nutrient_tank");
}

export function stepHydro(w: World, hours: number) {
  const days = hours / 24;
  const R = rng(w);
  const lightOn = powered(w, "hydro") && w.phase === "day";
  for (const id in w.objs) {
    const o = w.objs[id];
    if (o.kind === "hydro_tray") {
      const s = o.st;
      if (!s.crop) continue;
      const cd = CROPS[s.crop];
      if (!cd) continue;
      const room = o.room ? w.rooms[o.room] : undefined;
      // consumption
      const dripSave = (room && room.level >= 2 ? 0.7 : 1) * (w.tech.includes("tech_hydro3") ? 0.5 : 1);
      s.water = clamp(s.water - 28 * cd.water * days * dripSave);
      const tank = tankFor(w, o);
      const needN = 22 * cd.nutr * days;
      if (tank && tank.st.level > 0) {
        const phOk = Math.abs((tank.st.ph ?? 6.2) - 6.2) < 0.8;
        tank.st.level = Math.max(0, tank.st.level - needN * 0.35);
        s.nutr = clamp(s.nutr + needN * (phOk ? 1.1 : 0.5));
      }
      s.nutr = clamp(s.nutr - needN);
      s.pruned = clamp((s.pruned ?? 1) - (cd.prune ? 0.45 * days : 0), 0, 1);
      // pests & mold
      const dirt = room?.dirt ?? 0;
      if (s.pests <= 0 && R.chance((0.07 + dirt / 400) * days)) s.pests = 5;
      if (s.pests > 0) s.pests = clamp(s.pests + 28 * days);
      if (s.mold <= 0 && s.water > 90 && R.chance(0.08 * days)) s.mold = 5;
      if (s.mold > 0) s.mold = clamp(s.mold + 20 * days);
      // health
      let dh = 10 * days;
      if (s.water < 15) dh -= 40 * days;
      if (s.nutr < 10) dh -= 20 * days;
      if (s.pests > 30) dh -= (s.pests / 3) * days;
      if (s.mold > 30) dh -= (s.mold / 3) * days;
      if (o.broken) dh -= 15 * days;
      s.health = clamp(s.health + dh);
      if (s.health <= 0) {
        log(w, `🥀 Погибло растение: ${cd.name}. Грядка пуста.`, "bad");
        resetTray(o);
        continue;
      }
      // growth
      if (!s.ready) {
        let f = 1;
        f *= lightOn ? 1 : w.phase === "day" ? 0.1 : 0.4;
        if (s.water < 15) f *= 0.2;
        if (s.nutr < 10) f *= 0.5;
        f *= 0.4 + (s.health / 100) * 0.6;
        if (room && room.level >= 3) f *= 1.25;
        if (s.greenthumb) f *= 1.15;
        let g = s.growth + (days / cd.days) * f;
        if (cd.pollinate && !s.pollinated && g > 0.75) g = 0.75;
        s.growth = Math.min(1, g);
        s.stage = s.growth >= 1 ? 4 : Math.min(3, 1 + Math.floor(s.growth * 3));
        if (s.growth >= 1) {
          s.ready = 1;
          s.stage = 4;
        }
      }
      // spread pests to neighbour trays
      if (s.pests > 55 && R.chance(0.5 * days)) {
        for (const nid in w.objs) {
          const n = w.objs[nid];
          if (n.kind === "hydro_tray" && n.id !== o.id && n.lv === o.lv && Math.abs(n.x - o.x) === 1 && n.st.crop && n.st.pests <= 0) n.st.pests = 10;
        }
      }
    } else if (o.kind === "mushroom_bed") {
      const s = o.st;
      if (!s.planted) continue;
      if (s.compost > 0 && !s.ready) {
        s.compost = Math.max(0, s.compost - 0.4 * days);
        s.growth = Math.min(1, (s.growth ?? 0) + (days / 2.5) * (w.tech.includes("tech_mushroom2") ? 2 : 1));
        if (s.growth >= 1) s.ready = 1;
      }
    } else if (o.kind === "rabbit_hutch") {
      const s = o.st;
      if (!s.rabbits) continue;
      s.fed = clamp((s.fed ?? 0) - 35 * days);
      s.dirty = clamp((s.dirty ?? 0) + 25 * days);
      if (s.fed > 30 && s.rabbits >= 2 && s.rabbits < 6 && s.dirty < 70) {
        s.growth = (s.growth ?? 0) + days / 3;
        if (s.growth >= 1) {
          s.growth = 0;
          s.rabbits++;
          log(w, "🐇 В крольчатнике пополнение!", "good");
        }
      }
      if (s.fed <= 0 && R.chance(0.3 * days)) {
        s.rabbits--;
        log(w, "🐇 Кролик умер от голода.", "bad");
      }
    }
  }
}

function resetTray(o: Obj) {
  Object.assign(o.st, { crop: "", stage: 0, growth: 0, health: 100, pests: 0, mold: 0, pollinated: 0, ready: 0, pruned: 1, greenthumb: 0 });
}

onTick("hydro", "day", (w, dt) => stepHydro(w, dt * hoursPerSec(w) * timeMult(w)));

// ---------------------------------------------------------------- actions

defAction({
  id: "plant",
  type: "obj",
  kinds: ["hydro_tray"],
  prio: 20,
  avail: ({ w, o, param }) => {
    if (o!.st.crop) return null;
    const crops = Object.keys(CROPS).filter((k) => (w.res[seedItem(k)] ?? 0) >= 1);
    if (!crops.length) return { label: "🌱 Посадить", reason: "Нет семян" };
    if (param && !crops.includes(param)) return { label: "🌱 Посадить", reason: "Нет таких семян" };
    return `🌱 Посадить…`;
  },
  dur: () => 8,
  anim: "work",
  skill: "cooking",
  chore: "plant",
  sanity: 1,
  start: ({ w, o, param, c }) => {
    let crop = param as string | undefined;
    if (!crop || !CROPS[crop] || (w.res[seedItem(crop)] ?? 0) < 1) {
      // bots / default: pick best available crop (prefer food)
      const pref = ["potato", "soy", "tomato", "carrot", "peas", "lettuce", "strawberry", "herbs", "sunflower", "hops", "tobacco"];
      crop = pref.find((k) => (w.res[seedItem(k)] ?? 0) >= 1);
    }
    if (!crop) return "Нет семян";
    o!.st._planting = crop;
    void c;
  },
  done: ({ w, c, o }) => {
    const crop = o!.st._planting;
    if (!crop || (w.res[seedItem(crop)] ?? 0) < 1) return;
    w.res[seedItem(crop)] -= 1;
    resetTray(o!);
    Object.assign(o!.st, { crop, stage: 1, growth: 0.02, water: Math.max(o!.st.water ?? 0, 60), nutr: Math.max(o!.st.nutr ?? 0, 40), greenthumb: hasTrait(c, "greenthumb") || c.card.prof === "farmer" ? 1 : 0 });
    delete o!.st._planting;
    emitWork(w, c, `🌱 ${CROPS[crop].name}`, "#8fcf6a");
  },
});

/** This tray and the other beds in its room that want water (the tray itself first). */
function thirstyBeds(w: World, o: Obj): Obj[] {
  const others = Object.values(w.objs).filter((x) => x.id !== o.id && x.kind === "hydro_tray" && x.room === o.room && x.st.crop && x.st.water <= 80);
  return [o, ...others];
}

defAction({
  id: "water_plants",
  type: "obj",
  kinds: ["hydro_tray"],
  prio: 18,
  avail: ({ w, o }) => {
    if (!o!.st.crop || o!.st.water > 60) return null;
    const beds = thirstyBeds(w, o!);
    const need = 0.2 * beds.length;
    if ((w.res.water_dirty ?? 0) + (w.res.water ?? 0) < need) return { label: "🚿 Полить", reason: "Нет воды" };
    const dirty = (w.res.water_dirty ?? 0) >= need;
    return `🚿 Полить ${beds.length > 1 ? `грядки (${beds.length})` : "грядку"} · вода ${Math.round(o!.st.water)}%${dirty ? " · грязной водой" : ""}`;
  },
  dur: () => 5,
  anim: "work",
  skill: "cooking",
  chore: "water_plants",
  // one round of the can waters every thirsty bed of the room (the minigame's «грядка 1 из 3»)
  done: ({ w, o }) => {
    for (const b of thirstyBeds(w, o!)) {
      // plants don't mind dirty water: it goes first and saves the clean water for people
      const k = (w.res.water_dirty ?? 0) >= 0.2 ? "water_dirty" : "water";
      if ((w.res[k] ?? 0) < 0.2) break;
      w.res[k] = (w.res[k] ?? 0) - 0.2;
      b.st.water = 100;
    }
  },
});

defAction({
  id: "pollinate",
  type: "obj",
  kinds: ["hydro_tray"],
  prio: 19,
  avail: ({ o }) => {
    const cd = CROPS[o!.st.crop];
    if (!cd?.pollinate || o!.st.pollinated || o!.st.growth < 0.5) return null;
    return "🖌️ Опылить кисточкой";
  },
  dur: () => 8,
  anim: "work",
  skill: "cooking",
  chore: "pollinate",
  sanity: 2,
  done: ({ o }) => {
    o!.st.pollinated = 1;
  },
});

defAction({
  id: "prune",
  type: "obj",
  kinds: ["hydro_tray"],
  prio: 22,
  avail: ({ o }) => {
    const cd = CROPS[o!.st.crop];
    if (!cd?.prune || (o!.st.pruned ?? 1) > 0.5) return null;
    return "✂️ Подрезать и подвязать";
  },
  dur: () => 7,
  anim: "work",
  skill: "cooking",
  chore: "prune",
  sanity: 1,
  done: ({ o }) => {
    o!.st.pruned = 1;
  },
});

defAction({
  id: "treat_pests",
  type: "obj",
  kinds: ["hydro_tray"],
  prio: 17,
  avail: ({ w, o }) => {
    if ((o!.st.pests ?? 0) < 15 && (o!.st.mold ?? 0) < 15) return null;
    const what = o!.st.pests >= 15 ? "тля" : "плесень";
    if ((w.res.chem ?? 0) < 0.5 && (w.res.herbs ?? 0) < 1) return { label: `🐛 Обработать (${what})`, reason: "Нужны химикаты или травы" };
    return `🐛 Обработать (${what})`;
  },
  dur: () => 10,
  anim: "work",
  skill: "medicine",
  chore: "treat_pests",
  done: ({ w, o }) => {
    if ((w.res.chem ?? 0) >= 0.5) w.res.chem -= 0.5;
    else w.res.herbs = Math.max(0, (w.res.herbs ?? 0) - 1);
    o!.st.pests = 0;
    o!.st.mold = 0;
  },
});

defAction({
  id: "harvest",
  type: "obj",
  kinds: ["hydro_tray"],
  prio: 7,
  avail: ({ o }) => (o!.st.ready ? `🧺 Собрать урожай: ${CROPS[o!.st.crop]?.name}` : null),
  dur: () => 8,
  anim: "work",
  skill: "cooking",
  xp: 6,
  chore: "harvest",
  sanity: 4,
  done: ({ w, c, o }) => {
    const cd = CROPS[o!.st.crop];
    if (!cd) return;
    const R = rng(w);
    const techMul = (w.tech.includes("tech_hydro2") ? 1.2 : 1) * (w.tech.includes("tech_hydro3") ? 1.25 : 1);
    const q = (o!.st.health / 100) * (cd.prune && (o!.st.pruned ?? 1) < 0.3 ? 0.6 : 1) * (1 + (skillLevel(c, "cooking") - 1) * 0.04) * techMul;
    const st = BAL.storyteller[w.settings.storyteller] ?? BAL.storyteller.classic;
    const n = Math.max(1, Math.round(R.int(cd.yield[0], cd.yield[1]) * q * st.yieldMult));
    const seeds = Math.max(w.tech.includes("tech_seedbank") ? 1 : 0, R.int(cd.seeds[0], cd.seeds[1]));
    spawnItem(w, cd.item, n, o!.x + 0.3, o!.lv);
    if (seeds > 0) spawnItem(w, seedItem(o!.st.crop), seeds, o!.x + 0.7, o!.lv);
    w.stats.harvest[cd.item] = (w.stats.harvest[cd.item] ?? 0) + n;
    if (cd.item === "strawberry") w.flags["_straw_" + c.id] = (w.flags["_straw_" + c.id] ?? 0) + 1;
    log(w, `🧺 ${firstName(c)} собирает урожай: ${cd.name} ×${n}${seeds ? `, семян ×${seeds}` : ""}. Отнесите на склад!`, "good");
    emitWork(w, c, `${ITEMS[cd.item]?.icon ?? ""} ×${n}`, "#8fcf6a");
    resetTray(o!);
  },
});

defAction({
  id: "mix_solution",
  type: "obj",
  kinds: ["nutrient_tank"],
  prio: 18,
  avail: ({ w, o }) => {
    if ((o!.st.level ?? 0) > 70) return null;
    if ((w.res.chem ?? 0) < 1 && (w.res.compost ?? 0) < 2) return { label: "⚗️ Смешать раствор", reason: "Нужен 1 химикат или 2 компоста" };
    return `⚗️ Смешать раствор (бак ${Math.round(o!.st.level ?? 0)}%)`;
  },
  dur: () => 12,
  anim: "work",
  skill: "medicine",
  chore: "mix_solution",
  sanity: 1,
  done: ({ w, c, o, param }) => {
    if ((w.res.compost ?? 0) >= 2) w.res.compost -= 2;
    else w.res.chem = Math.max(0, (w.res.chem ?? 0) - 1);
    o!.st.level = 100;
    // mini-game result (0..1 accuracy) or skill-based for bots
    const acc = typeof param === "number" ? Math.max(0, Math.min(1, param)) : 0.5 + skillLevel(c, "medicine") * 0.05;
    o!.st.ph = 6.2 + (1 - acc) * (rng(w).chance(0.5) ? 1 : -1) * 1.2;
    emitWork(w, c, `pH ${o!.st.ph.toFixed(1)}`, acc > 0.7 ? "#8fcf6a" : "#e8c14a");
  },
});

defAction({
  id: "clean_pipes",
  type: "obj",
  kinds: ["nutrient_tank"],
  prio: 30,
  avail: ({ o }) => (o!.wear < 60 ? "🪠 Прочистить трубы" : null),
  dur: () => 12,
  anim: "repair",
  skill: "repair",
  chore: "clean_pipes",
  done: ({ o }) => {
    o!.wear = 100;
  },
});

// ---------------------------------------------------------------- mushrooms, compost, rabbits

defAction({
  id: "mushrooms",
  type: "obj",
  kinds: ["mushroom_bed"],
  prio: 15,
  avail: ({ w, o }) => {
    const s = o!.st;
    if (s.ready) return "🍄 Собрать грибы";
    if (!s.planted) return (w.res.spores ?? 0) >= 1 ? "🦠 Засеять грибницу" : { label: "🦠 Засеять грибницу", reason: "Нет грибницы" };
    if ((s.compost ?? 0) < 0.5) return (w.res.compost ?? 0) >= 1 ? "🟫 Подсыпать компост" : { label: "🟫 Подсыпать компост", reason: "Нет компоста" };
    return null;
  },
  dur: () => 8,
  anim: "work",
  skill: "cooking",
  chore: "mushrooms",
  sanity: 1,
  done: ({ w, c, o }) => {
    const s = o!.st;
    if (s.ready) {
      const n = rng(w).int(3, 5);
      spawnItem(w, "mushroom", n, o!.x + 0.5, o!.lv);
      if (rng(w).chance(0.3)) spawnItem(w, "spores", 1, o!.x + 0.7, o!.lv);
      s.ready = 0;
      s.growth = 0;
      w.stats.harvest.mushroom = (w.stats.harvest.mushroom ?? 0) + n;
      emitWork(w, c, `🍄 ×${n}`, "#8fcf6a");
    } else if (!s.planted) {
      w.res.spores -= 1;
      s.planted = 1;
      s.growth = 0;
    } else {
      w.res.compost -= 1;
      s.compost = (s.compost ?? 0) + 2;
    }
  },
});

defAction({
  id: "turn_compost",
  type: "obj",
  kinds: ["compost"],
  prio: 25,
  avail: ({ o }) => ((o!.st.amount ?? 0) >= 1 ? `♻️ Выгрести компост (${Math.floor(o!.st.amount)})` : null),
  dur: () => 6,
  anim: "work",
  skill: "cooking",
  chore: "compost",
  sanity: 1,
  done: ({ w, o }) => {
    const n = Math.floor(o!.st.amount ?? 0);
    o!.st.amount -= n;
    w.res.compost = (w.res.compost ?? 0) + n;
  },
});

defAction({
  id: "feed_rabbits",
  type: "obj",
  kinds: ["rabbit_hutch"],
  prio: 16,
  avail: ({ w, o }) => {
    if (!o!.st.rabbits || o!.st.fed > 60) return null;
    const feed = ["lettuce", "carrot", "peas", "herbs"].find((k) => (w.res[k] ?? 0) >= 1);
    return feed ? `🐇 Покормить (${itemName(feed)})` : { label: "🐇 Покормить", reason: "Нет корма (салат, морковь, горох)" };
  },
  dur: () => 6,
  anim: "work",
  skill: "cooking",
  chore: "feed_rabbits",
  sanity: 2,
  done: ({ w, o }) => {
    const feed = ["lettuce", "carrot", "peas", "herbs"].find((k) => (w.res[k] ?? 0) >= 1);
    if (!feed) return;
    w.res[feed] -= 1;
    o!.st.fed = 100;
  },
});

defAction({
  id: "clean_hutch",
  type: "obj",
  kinds: ["rabbit_hutch"],
  prio: 26,
  avail: ({ o }) => ((o!.st.dirty ?? 0) > 50 ? "🧤 Почистить клетки" : null),
  dur: () => 12,
  anim: "work",
  skill: "cooking",
  chore: "clean_hutch",
  done: ({ w, o }) => {
    o!.st.dirty = 0;
    w.res.compost = (w.res.compost ?? 0) + 1;
  },
});

defAction({
  id: "butcher",
  type: "obj",
  kinds: ["rabbit_hutch"],
  prio: 60,
  avail: ({ o }) => ((o!.st.rabbits ?? 0) >= 3 ? "🔪 Забить кролика (мясо)" : null),
  dur: () => 8,
  anim: "work",
  skill: "cooking",
  done: ({ w, c, o }) => {
    o!.st.rabbits -= 1;
    spawnItem(w, "meat", 2, o!.x + 0.5, o!.lv);
    c.needs.sanity = clamp(c.needs.sanity - 3);
  },
});
