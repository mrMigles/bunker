import { BAL } from "../data/balance";
import { OBJECTS } from "../data/objects";
import type { World } from "../types";
import { objsOfKind, roomAt } from "../world/rooms";
import { defAction } from "./actions";
import { battle, battleEndHooks, battleRoundHooks, bunkerBattle, type BattleMod } from "./battle";
import { debugOps } from "./debug";
import { effectHooks } from "./events";
import { exped } from "./expedition";
import { breakObj } from "./systems";
import { onTick } from "./tick";
import { nightHooks } from "./time";
import { clamp, fx, log, rng } from "./util";

export const RAIDS: Record<string, { name: string; enemies: (w: World) => string[]; minDay: number; warn: string }> = {
  raiders: {
    name: "Налётчики Крысиного короля",
    minDay: 5,
    warn: "У входа следы сапог и окурки. Кто-то приглядывается к люку.",
    enemies: (w) => {
      const n = 3 + Math.floor(w.day / 6);
      const out = ["marauder", "raider"];
      while (out.length < n) out.push(rng(w).pick(["marauder", "raider", "marauder", "dog"]));
      if (w.day >= 10) out.push("boss");
      return out;
    },
  },
  raiders_trap: { name: "Засада налётчиков", minDay: 0, warn: "Ночью у двери шептались.", enemies: () => ["marauder", "marauder", "raider"] },
  order_patrol: { name: "Карательный патруль «Порядка»", minDay: 0, warn: "По радио «Порядка» зачитали название нашего квартала.", enemies: (w) => ["soldier", "soldier", w.day > 8 ? "drone" : "soldier"] },
  mutants: { name: "Стая мутантов", minDay: 6, warn: "Ночью что-то скреблось о люк.", enemies: (w) => ["glowing", "dog", "dog", ...(w.day > 12 ? ["glowing"] : [])] },
  cultists: { name: "Дети Вспышки", minDay: 8, warn: "На люке нарисовали знак солнца.", enemies: () => ["cultist", "cultist", "cultist"] },
  moles: { name: "Кротовики из-под земли", minDay: 6, warn: "Из-под пола доносится скрежет.", enemies: () => ["mole", "mole", "rat", "rat"] },
  bulldozer: { name: "Бронированный Бульдозер", minDay: 14, warn: "Земля дрожит от далёкого рёва мотора.", enemies: () => ["bulldozer", "raider", "marauder"] },
};

function scheduleRaid(w: World, kind: string, inDays = 1, entry?: string) {
  const d = w.director;
  if (d.raidWarn) return;
  d.raidWarn = w.day + inDays;
  d.raidKind = kind;
  d.raidEntry = entry ?? (w.flags.metro && rng(w).chance(0.4) ? "metro" : kind === "bulldozer" ? "top" : "airlock");
  w.flags._raid_spotted = 0;
  w.flags._raid_hour = 10 + rng(w).int(0, 7);
  if (!w.flags._firstRaid) {
    // the first time, the scouts give themselves away: something to prepare for, not a bolt from the blue
    w.flags._firstRaid = w.day;
    log(w, "👣 У люка следы чужих сапог, ночью наверху мигал фонарь — бункер нашли. Укрепите шлюз, раздайте оружие, приготовьте аптечки.", "bad");
  }
  log(w, `⚠ ${RAIDS[kind]?.warn ?? "Что-то не так."} Готовьтесь к налёту${inDays === 0 ? " — сегодня!" : " — завтра!"}`, "bad");
  fx(w, { k: "toast", text: "⚠ Готовьтесь к налёту!" });
}

// scheduling by noticeability and relations
nightHooks.dayStart.push((w) => {
  const d = w.director;
  if (d.raidWarn || w.day < BAL.firstRaidDay || d.quiet > 0) return;
  const st = BAL.storyteller[w.settings.storyteller] ?? BAL.storyteller.classic;
  let chance = Math.max(0, (w.notice - 20) / 100) * st.raidMult;
  if ((w.factions.ratking ?? 0) < -40) chance += 0.08;
  if ((w.factions.order ?? 0) < -40) chance += 0.06;
  if (w.notice >= BAL.noticeRaidThreshold) chance += 0.15;
  if (w.day - d.lastRaidDay < 3) chance *= 0.3;
  // the first raid comes within a window: the defence pillar must switch on in a normal game (#29)
  const lastDay = w.settings.storyteller === "haven" ? 16 : w.settings.storyteller === "scorched" ? 9 : 12;
  if (!w.flags._firstRaid && w.day >= lastDay) chance = 1;
  if (!rng(w).chance(chance)) return;
  const R = rng(w);
  const options = Object.keys(RAIDS).filter((k) => k !== "raiders_trap" && k !== "order_patrol" && RAIDS[k].minDay <= w.day);
  let kind = R.pick(options);
  if ((w.factions.order ?? 0) < -40 && R.chance(0.5)) kind = "order_patrol";
  if (kind === "moles" && !w.flags.nest_found) kind = "raiders";
  scheduleRaid(w, kind, 1);
});

effectHooks.startRaid = (w, kind) => scheduleRaid(w, String(kind), kind === "raiders_trap" ? 0 : 1);

// the attack itself
onTick("raids", "day", (w) => {
  const d = w.director;
  if (!d.raidWarn || d.raidWarn > w.day || battle(w)) return;
  if (w.hour < (w.flags._raid_hour ?? 12)) return;
  const kind = d.raidKind ?? "raiders";
  const def = RAIDS[kind] ?? RAIDS.raiders;
  const st = BAL.storyteller[w.settings.storyteller] ?? BAL.storyteller.classic;
  let enemies = def.enemies(w);
  if (st.raidStrength < 1) enemies = enemies.slice(0, Math.max(2, Math.round(enemies.length * st.raidStrength)));
  else if (st.raidStrength > 1) enemies.push(...enemies.slice(0, Math.round(enemies.length * (st.raidStrength - 1))));
  const entry = (d.raidEntry as "airlock" | "metro" | "top") ?? "airlock";
  d.raidWarn = 0;
  d.lastRaidDay = w.day;
  log(w, `🚨 НАЛЁТ! ${def.name}${entry === "metro" ? " лезут из туннеля метро" : entry === "top" ? " ломятся сверху" : " у гермодвери"}!`, "bad");
  fx(w, { k: "sound", id: "siren" });
  fx(w, { k: "toast", text: `🚨 Налёт: ${def.name}` });
  fx(w, { k: "shake", data: 0.8 });
  const e = exped(w);
  if (e) e.log.push("📡 Бункер: «Нас атакуют! Держимся!»");
  bunkerBattle(w, enemies, entry, kind, "raid");
});

// raiders sabotage machines they stand next to
battleRoundHooks.push((w, b) => {
  if (b.where !== "bunker") return;
  const R = rng(w);
  for (const u of Object.values(b.state.units)) {
    if (u.side !== "enemy" || u.dead || u.down || u.fled) continue;
    const lv = b.state.field.originLv + u.floor;
    for (const o of Object.values(w.objs)) {
      if (o.lv !== lv || Math.abs(o.x - u.col) > 0 || o.broken) continue;
      if (["bike_gen", "air_filter", "water_filter", "diesel_gen", "battery", "radio", "stove"].includes(o.kind) && R.chance(0.35)) {
        breakObj(w, o, R.chance(0.15));
        b.state.log.push(`${u.name} крушит: ${OBJECTS[o.kind]?.name}!`);
      }
    }
    // looters carry off loot when they flee
  }
});

battleEndHooks.raid = (w, b: BattleMod) => {
  const s = b.state;
  const R = rng(w);
  const stolen: Record<string, number> = {};
  for (const u of Object.values(s.units)) {
    if (u.side !== "enemy") continue;
    const n = u.carried?.__steal ?? 0;
    if (!n || !u.fled) continue;
    for (let i = 0; i < n * 3; i++) {
      const keys = Object.keys(w.res).filter((k) => (w.res[k] ?? 0) >= 1 && k !== "water_dirty");
      if (!keys.length) break;
      const k = R.pick(keys);
      w.res[k] -= 1;
      stolen[k] = (stolen[k] ?? 0) + 1;
    }
  }
  const list = Object.entries(stolen).map(([k, n]) => `${k}×${n}`).join(", ");
  if (list) log(w, `💰 Налётчики унесли: ${list}.`, "bad");
  // damage to rooms where the fight raged
  for (const e of s.events) {
    if (e.k !== "shoot" && e.k !== "fire") continue;
    const u = s.units[e.u];
    if (!u) continue;
    const r = roomAt(w, u.col, s.field.originLv + u.floor);
    if (r) r.dmg = clamp(r.dmg + 2);
  }
  // turret ammo spent
  for (const t of objsOfKind(w, "turret")) {
    const u = s.units["tur_" + t.id];
    if (u) t.st.ammo = Math.max(0, (t.st.ammo ?? 0) - Math.max(0, 5 - u.ammo));
  }
  // barricade gets broken
  const door = s.field.doors[0];
  const blast = objsOfKind(w, "door_blast")[0];
  if (blast && door) {
    blast.st.closed = door.closed ? 1 : 0;
    if (!door.barricaded) blast.st.barricade = 0;
  }
  if (s.result === "win") {
    w.notice = clamp(w.notice - 15);
    w.factions.ratking = clamp((w.factions.ratking ?? 0) - 5, -100, 100);
  } else if (s.result === "lose") {
    // the raiders take whatever they want
    for (const k of ["food_can", "water", "meds", "ammo", "parts"]) w.res[k] = Math.floor((w.res[k] ?? 0) * 0.5);
    log(w, "Бункер разграблен. Налётчики забрали половину припасов.", "bad");
  }
  w.stats.events.push(s.result === "win" ? "Отбили налёт" : "Налёт");
};

// ---------------------------------------------------------------- preparation

defAction({
  id: "blast_door",
  type: "obj",
  kinds: ["door_blast"],
  prio: 8,
  avail: ({ o }) => (o!.st.closed ? "🚪 Открыть гермодверь" : "🚪 Задраить гермодверь"),
  dur: () => 2,
  done: ({ w, o }) => {
    o!.st.closed = o!.st.closed ? 0 : 1;
    fx(w, { k: "sound", id: "door", x: o!.x, lv: o!.lv });
  },
});

/** Defence chores only show up once raiders are a real prospect: the bunker is noticed or a warning came. */
function defenseRelevant(w: World) {
  return w.notice >= 30 || !!w.director?.raidWarn || w.day >= 4;
}

defAction({
  id: "barricade",
  type: "obj",
  kinds: ["door_blast"],
  prio: 9,
  avail: ({ w, o }) => {
    if (o!.st.barricade || !defenseRelevant(w)) return null;
    if ((w.res.wood ?? 0) < 2 || (w.res.scrap ?? 0) < 2) return { label: "🪵 Заложить дверь", reason: "Нужно 2 дерева и 2 металлолома" };
    return "🪵 Заложить дверь (2🪵 2🔩)";
  },
  dur: () => 10,
  anim: "repair",
  skill: "repair",
  done: ({ w, o }) => {
    w.res.wood -= 2;
    w.res.scrap -= 2;
    o!.st.barricade = 1;
    o!.st.closed = 1;
    log(w, "Гермодверь заложена брёвнами и железом.", "good");
  },
});

defAction({
  id: "set_trap",
  type: "obj",
  kinds: ["door_blast", "hatch_ladder"],
  prio: 12,
  avail: ({ w }) => {
    if ((w.flags.raid_traps ?? 0) >= 3 || !defenseRelevant(w)) return null;
    if ((w.res.parts ?? 0) < 1 || (w.res.scrap ?? 0) < 1) return { label: "⚠ Растяжка у входа", reason: "Нужны запчасть и металлолом" };
    return `⚠ Поставить растяжку у входа (${w.flags.raid_traps ?? 0}/3)`;
  },
  dur: () => 8,
  anim: "repair",
  skill: "repair",
  done: ({ w }) => {
    w.res.parts -= 1;
    w.res.scrap -= 1;
    w.flags.raid_traps = (w.flags.raid_traps ?? 0) + 1;
  },
});

defAction({
  id: "load_turret",
  type: "obj",
  kinds: ["turret"],
  prio: 10,
  avail: ({ w, o }) => ((o!.st.ammo ?? 0) >= 20 ? null : (w.res.ammo ?? 0) >= 5 ? "🔸 Зарядить турель (5 патронов)" : { label: "🔸 Зарядить турель", reason: "Нужно 5 патронов" }),
  dur: () => 5,
  done: ({ w, o }) => {
    w.res.ammo -= 5;
    o!.st.ammo = (o!.st.ammo ?? 0) + 5;
  },
});

debugOps.raid = (w, arg) => {
  if (battle(w)) return "Уже бой";
  const kind = arg === "metro" ? "raiders" : String(arg || "raiders");
  if (arg === "metro") {
    if (!w.flags.metro) {
      // dig a quick tunnel for testing
      w.flags.metro = 1;
      w.flags.metro_x = 17;
      w.flags.metro_lv = 1;
    }
  }
  w.director.raidWarn = w.day;
  w.director.raidKind = RAIDS[kind] ? kind : "raiders";
  w.director.raidEntry = arg === "metro" ? "metro" : "airlock";
  w.flags._raid_hour = 0;
};
