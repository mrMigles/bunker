import { BAL } from "../data/balance";
import type { Char, RoomInst, World } from "../types";
import { T_AIR, T_GRANITE, T_STONE, T_WATER, TERRAIN_NAMES, cellAt, node, openSlot, slotAccess, slotKey, slotTerrain, unnode, walkable } from "../world/grid";
import { ROOMS, addObj, canPlaceRoom, objsInRoom, roomAt, roomCost, spawnRoomObjects } from "../world/rooms";
import { defAction, emitWork } from "./actions";
import { registerCmd } from "./commands";
import { costText, hasRes, missingText, payRes, spawnItem } from "./items";
import { knockDown } from "./needs";
import { onTick } from "./tick";
import { timeMult } from "./time";
import { addXp, clamp, firstName, fx, hasTrait, hoursPerSec, log, rng, skillLevel } from "./util";

export const findHooks: Record<string, (w: World, c: Char, x: number, lv: number) => void> = {};

/** Seconds of work to dig a slot at skill 1 with the right tool. */
export function slotWork(w: World, x: number, lv: number): number {
  let s = 0;
  for (const t of slotTerrain(w, x, lv)) {
    if (t === T_AIR) continue;
    const rate = BAL.digRate[t] ?? 1;
    s += 60 / rate;
  }
  return s;
}

export function toolFor(w: World, x: number, lv: number): { ok: boolean; need?: string } {
  const ts = slotTerrain(w, x, lv);
  if (ts.includes(T_GRANITE) && (w.res.drill ?? 0) < 1) return { ok: false, need: "Гранит — нужен бур" };
  if (ts.includes(T_STONE) && (w.res.pickaxe ?? 0) < 1 && (w.res.drill ?? 0) < 1) return { ok: false, need: "Камень — нужна кирка" };
  return { ok: true };
}

export function digSpeed(c: Char) {
  let s = 1 + (skillLevel(c, "digging") - 1) * BAL.digSkillBonus;
  if (c.card.prof === "miner") s *= 2;
  if (hasTrait(c, "strongback")) s *= 1.2;
  if (c.needs.energy < 20) s *= 0.6;
  return s;
}

defAction({
  id: "dig",
  type: "slot",
  prio: 6,
  avail: ({ w, t, c }) => {
    const [x, lv] = unnode(w, Number(t.id));
    if (!w.marks[t.id]) return null;
    if (walkable(w, x, lv)) return null;
    const tool = toolFor(w, x, lv);
    const tn = slotTerrain(w, x, lv)
      .filter((q) => q !== T_AIR)
      .map((q) => TERRAIN_NAMES[q])
      .join("/");
    const p = Math.round((w.dig[t.id] ?? 0) * 100);
    const label = `⛏️ Копать (${tn}${p ? ", " + p + "%" : ""})`;
    if (!tool.ok) return { label, reason: tool.need! };
    if (c.hands.some((h) => h.item !== "dirt")) return { label, reason: "Освободите руки" };
    if (slotAccess(w, x, lv) === null) return { label, reason: "Нет доступа" };
    return label;
  },
  dur: () => 0,
  anim: "dig",
  skill: "digging",
  xp: 0,
  tick: ({ w, c, t }, dt) => {
    const [x, lv] = unnode(w, Number(t.id));
    if (!w.marks[t.id] || walkable(w, x, lv)) return true;
    const work = slotWork(w, x, lv);
    w.dig[t.id] = (w.dig[t.id] ?? 0) + (dt * digSpeed(c)) / Math.max(1, work);
    c.needs.energy = clamp(c.needs.energy - dt * hoursPerSec(w) * 4);
    c.skills.digging += dt * 0.08;
    if (c.lv !== lv) c.dir = 1;
    else c.dir = x + 0.5 > c.x ? 1 : -1;
    if (w.dig[t.id] >= 1) {
      finishDig(w, c, x, lv);
      return true;
    }
  },
});

export function finishDig(w: World, c: Char | null, x: number, lv: number) {
  const key = slotKey(w, x, lv);
  const terrain = slotTerrain(w, x, lv);
  const roomId = w.marks[key];
  delete w.marks[key];
  delete w.dig[key];
  openSlot(w, x, lv);
  const r = roomId ? w.rooms[roomId] : undefined;
  // soil to carry out
  const dirtX = x + 0.5;
  spawnItem(w, "dirt", 1, dirtX - 0.2, lv);
  spawnItem(w, "dirt", 1, dirtX + 0.2, lv);
  if (c) {
    w.stats.dug[c.id] = (w.stats.dug[c.id] ?? 0) + 2;
    w.flags["_dug_" + c.id] = (w.flags["_dug_" + c.id] ?? 0) + 2;
    addXp(c, "digging", 6);
  }
  // water pocket → flooding
  if (terrain.includes(T_WATER)) {
    w.res.water_dirty = (w.res.water_dirty ?? 0) + 6;
    const fr = r ?? roomAt(w, x - 1, lv) ?? roomAt(w, x + 1, lv);
    if (fr) fr.flood = clamp(fr.flood + 45);
    log(w, "💦 Вскрыт водоносный слой — вода хлещет в бункер!", "bad");
    fx(w, { k: "toast", text: "💦 Затопление!" });
  }
  // shaft → ladder right away
  if (r && ROOMS[r.type]?.shaft && !w.ladders[x + "," + lv]) addObj(w, "ladder", x, lv, r.id);
  // hidden find
  const find = w.finds[key];
  if (find) {
    delete w.finds[key];
    w.found[key] = find;
    const h = findHooks[find];
    if (h && c) h(w, c, x, lv);
    else if (h) h(w, Object.values(w.chars)[0], x, lv);
  }
  // room fully dug?
  if (r && r.state === "dig") {
    let all = true;
    for (let i = 0; i < r.w; i++) if (!walkable(w, r.x + i, r.lv)) all = false;
    if (all) {
      r.state = "frame";
      log(w, `${ROOMS[r.type]?.name}: выкопано! Нужен каркас (${costText(roomCost(r.type, r.w))}).`, "good");
    }
  }
}

defAction({
  id: "build_frame",
  type: "room",
  prio: 4,
  avail: ({ w, t, c }) => {
    const r = w.rooms[t.id];
    if (!r || r.state !== "frame") return null;
    const cost = roomCost(r.type, r.w);
    const label = `🏗️ Каркас: ${ROOMS[r.type]?.name} (${Math.round((r.work / Math.max(1, ROOMS[r.type]?.work ?? 30)) * 100)}%)`;
    if (!(r as any).paid && !hasRes(w, cost)) return { label, reason: missingText(w, cost) };
    if (c.hands.length) return { label, reason: "Освободите руки" };
    return label;
  },
  dur: () => 0,
  anim: "repair",
  skill: "repair",
  xp: 0,
  start: ({ w, t }) => {
    const r = w.rooms[t.id];
    if (!r) return "Нет комнаты";
    if (!(r as any).paid) {
      const cost = roomCost(r.type, r.w);
      if (!hasRes(w, cost)) return missingText(w, cost);
      payRes(w, cost);
      (r as any).paid = 1;
    }
  },
  tick: ({ w, c, t }, dt) => {
    const r = w.rooms[t.id];
    if (!r || r.state !== "frame") return true;
    r.work += dt;
    c.skills.repair += dt * 0.05;
    if (r.work >= (ROOMS[r.type]?.work ?? 30)) {
      completeRoom(w, r, c);
      return true;
    }
  },
});

export function completeRoom(w: World, r: RoomInst, c?: Char) {
  r.state = "done";
  r.work = 0;
  spawnRoomObjects(w, r);
  log(w, `🏠 Построено: ${ROOMS[r.type]?.name}${c ? " (" + firstName(c) + ")" : ""}!`, "good");
  fx(w, { k: "toast", text: `🏠 ${ROOMS[r.type]?.name} готов(а)!` });
  w.flags["built_" + r.type] = (w.flags["built_" + r.type] ?? 0) + 1;
  for (const id in w.chars) {
    const x = w.chars[id];
    if (x.status !== "dead") x.needs.sanity = clamp(x.needs.sanity + 4);
  }
}

defAction({
  id: "upgrade_room",
  type: "room",
  prio: 70,
  avail: ({ w, t }) => {
    const r = w.rooms[t.id];
    if (!r || r.state !== "done") return null;
    const up = ROOMS[r.type]?.upgrades?.[r.level - 1];
    if (!up) return null;
    const label = `⬆ Улучшить до ур.${r.level + 1}: ${up.desc} (${costText(up.cost)})`;
    if (!hasRes(w, up.cost)) return { label, reason: missingText(w, up.cost) };
    return label;
  },
  dur: () => 30,
  anim: "repair",
  skill: "repair",
  xp: 8,
  start: ({ w, t }) => {
    const r = w.rooms[t.id]!;
    const up = ROOMS[r.type]?.upgrades?.[r.level - 1];
    if (!up || !hasRes(w, up.cost)) return "Не хватает ресурсов";
    payRes(w, up.cost);
  },
  stop: () => {},
  done: ({ w, t, c }) => {
    const r = w.rooms[t.id];
    if (!r) return;
    r.level++;
    log(w, `${firstName(c)} улучшает ${ROOMS[r.type]?.name} до уровня ${r.level}.`, "good");
  },
});

// ---------------------------------------------------------------- commands

/** Some rooms require a technology or a find. Returns a reason or "". */
export function roomLocked(w: World, type: string): string {
  const need: Record<string, string> = { turretroom: "tech_turret", genroom: "tech_diesel", chemlab: "tech_chem", radioroom: "tech_radio", lift: "tech_lift" };
  const t = need[type];
  if (t && !(w.tech ?? []).includes(t)) return "Нужна технология";
  if (type === "airlock2" && !w.flags?.metro) return "Нужен выход к туннелю (найдите метро)";
  return "";
}

registerCmd("plan", (w, p, cmd) => {
  if (w.phase !== "day" && w.phase !== "night") return "Сейчас нельзя";
  const type = String(cmd.type);
  const x = Math.floor(Number(cmd.x));
  const lv = Math.floor(Number(cmd.lv));
  const width = Math.floor(Number(cmd.w)) || ROOMS[type]?.w[0] || 1;
  const lock = roomLocked(w, type);
  if (lock) return lock;
  const err = canPlaceRoom(w, type, x, lv, width);
  if (err) return err;
  const r = placeRoomPlan(w, type, x, lv, width);
  w.flags._humanPlanDay = w.day;
  const who = p.char ? w.chars[p.char] : undefined;
  log(w, `${p.name} размечает: ${ROOMS[type].name} (${width} кл.)`, "info");
  if (who) who.needs.sanity = clamp(who.needs.sanity + 0.5);
  return r ? undefined : "Не удалось";
});

import { placeRoom } from "../world/rooms";
function placeRoomPlan(w: World, type: string, x: number, lv: number, width: number) {
  return placeRoom(w, type, x, lv, width, false);
}

registerCmd("cancelRoom", (w, p, cmd) => {
  const r = w.rooms[String(cmd.id)];
  if (!r) return "Нет комнаты";
  if (r.state === "done") return demolish(w, r);
  for (const key in w.marks) if (w.marks[key] === r.id) {
    delete w.marks[key];
    delete w.dig[key];
  }
  if ((r as any).paid) {
    const cost = roomCost(r.type, r.w);
    for (const k in cost) w.res[k] = (w.res[k] ?? 0) + Math.floor(cost[k] * 0.8);
  }
  delete w.rooms[r.id];
  log(w, `${p.name} отменяет стройку: ${ROOMS[r.type]?.name}.`, "info");
});

function demolish(w: World, r: RoomInst): string | void {
  if (r.type === "airlock" && Object.values(w.rooms).filter((x) => x.type === "airlock").length <= 1) return "Нельзя снести единственный Шлюз";
  for (const id in w.chars) {
    const c = w.chars[id];
    if (c.status !== "dead" && c.lv === r.lv && c.x >= r.x && c.x < r.x + r.w) return "В комнате люди";
  }
  for (const o of objsInRoom(w, r.id)) {
    if (o.kind === "ladder") delete w.ladders[o.x + "," + o.lv];
    delete w.objs[o.id];
  }
  const cost = roomCost(r.type, r.w);
  for (const k in cost) w.res[k] = (w.res[k] ?? 0) + Math.floor(cost[k] * 0.5);
  delete w.rooms[r.id];
  log(w, `Разобрано: ${ROOMS[r.type]?.name}. Вернули половину материалов.`, "info");
}

// ---------------------------------------------------------------- cave-ins

/** Unsupported span: width of contiguous done rooms on a level without a support room. */
export function collapseRisk(w: World, r: RoomInst): number {
  if (r.state !== "done" || ROOMS[r.type]?.support || r.sturdy) return 0;
  // find contiguous span including this room
  let left = r.x,
    right = r.x + r.w;
  let supported = false;
  for (;;) {
    const n = roomAt(w, left - 1, r.lv);
    if (!n || n.state !== "done") break;
    if (ROOMS[n.type]?.support || n.sturdy) {
      supported = true;
      break;
    }
    left = n.x;
  }
  for (;;) {
    const n = roomAt(w, right, r.lv);
    if (!n || n.state !== "done") break;
    if (ROOMS[n.type]?.support || n.sturdy) {
      supported = true;
      break;
    }
    right = n.x + n.w;
  }
  const span = right - left;
  const limit = BAL.collapseSpan + (supported ? 6 : 0) + (r.lv === 0 ? 8 : 0) + (w.tech.includes("tech_supports") ? 4 : 0);
  if (span <= limit) return 0;
  return Math.min(1, (span - limit) / 8);
}

onTick("collapse", "day", (w, dt) => {
  const hours = dt * hoursPerSec(w) * timeMult(w);
  const R = rng(w);
  for (const id in w.rooms) {
    const r = w.rooms[id];
    const risk = collapseRisk(w, r) * (1 + r.dmg / 50) * (w.flags.quake_day === w.day ? 3 : 1);
    if (risk <= 0) continue;
    const warnKey = "_crack_" + r.id;
    if (w.flags[warnKey]) {
      w.flags[warnKey] -= dt;
      if (w.flags[warnKey] <= 0) {
        delete w.flags[warnKey];
        collapse(w, r);
      }
    } else if (R.chance((BAL.collapseChancePerDay / 24) * hours * risk)) {
      w.flags[warnKey] = 30; // 30 real seconds of warning
      log(w, `⚠ ${ROOMS[r.type]?.name}: трещит свод, сыплется песок! Нужны Опоры.`, "bad");
      fx(w, { k: "sound", id: "crack", x: r.x + r.w / 2, lv: r.lv });
      fx(w, { k: "shake", data: 0.4 });
    }
  }
});

export function collapse(w: World, r: RoomInst) {
  const R = rng(w);
  r.dmg = clamp(r.dmg + 45);
  log(w, `💥 ОБВАЛ в ${ROOMS[r.type]?.name}!`, "bad");
  fx(w, { k: "toast", text: `💥 Обвал: ${ROOMS[r.type]?.name}` });
  fx(w, { k: "shake", data: 1.2 });
  for (let i = 0; i < Math.ceil(r.w / 2); i++) spawnItem(w, "dirt", 1, r.x + R.range(0.3, r.w - 0.3), r.lv);
  for (const o of objsInRoom(w, r.id)) if (R.chance(0.4)) o.wear = Math.max(0, o.wear - 60);
  for (const id in w.chars) {
    const c = w.chars[id];
    if (c.status === "dead" || c.lv !== r.lv || c.x < r.x || c.x > r.x + r.w) continue;
    c.needs.health = clamp(c.needs.health - R.int(15, 45));
    if (R.chance(0.3)) c.injury = "leg";
    if (c.needs.health <= 0) knockDown(w, c, "завалило");
  }
  r.dirt = clamp(r.dirt + 40);
}

defAction({
  id: "reinforce",
  type: "room",
  prio: 30,
  avail: ({ w, t }) => {
    const r = w.rooms[t.id];
    if (!r || r.state !== "done" || (r.dmg < 20 && !w.flags["_crack_" + r.id])) return null;
    if ((w.res.wood ?? 0) < 2) return { label: "🪵 Укрепить свод (2 дерева)", reason: "Нужно 2 дерева" };
    return `🪵 Укрепить свод (повреждение ${Math.round(r.dmg)}%)`;
  },
  dur: () => 16,
  anim: "repair",
  skill: "digging",
  chore: "reinforce",
  done: ({ w, t }) => {
    const r = w.rooms[t.id];
    if (!r) return;
    w.res.wood = Math.max(0, (w.res.wood ?? 0) - 2);
    r.dmg = Math.max(0, r.dmg - 50);
    delete w.flags["_crack_" + r.id];
  },
});

// ---------------------------------------------------------------- flooding drains slowly; dry chore
onTick("flood", "day", (w, dt) => {
  const hours = dt * hoursPerSec(w) * timeMult(w);
  for (const id in w.rooms) {
    const r = w.rooms[id];
    if (r.flood <= 0) continue;
    r.flood = Math.max(0, r.flood - 4 * hours);
    // water spreads down
    const below = roomAt(w, r.x, r.lv + 1);
    if (below && r.flood > 30 && w.ladders[r.x + "," + (r.lv + 1)]) below.flood = clamp(below.flood + 5 * hours);
    for (const o of objsInRoom(w, r.id)) if (r.flood > 40) o.wear = Math.max(0, o.wear - 2 * hours);
    r.dirt = clamp(r.dirt + 1 * hours);
  }
});

defAction({
  id: "dry_room",
  type: "room",
  prio: 20,
  avail: ({ w, t }) => {
    const r = w.rooms[t.id];
    return r && r.flood > 5 ? `🌀 Откачать и просушить (${Math.round(r.flood)}%)` : null;
  },
  dur: () => 15,
  anim: "work",
  skill: "repair",
  chore: "dry_room",
  done: ({ w, t }) => {
    const r = w.rooms[t.id];
    if (!r) return;
    const got = Math.min(r.flood, 40);
    r.flood = Math.max(0, r.flood - 40);
    w.res.water_dirty = (w.res.water_dirty ?? 0) + got / 10;
  },
});

export { node, cellAt };
