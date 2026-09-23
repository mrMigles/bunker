// «Бригадир»: the residents' own initiative. Players normally plan rooms and send sorties;
// when nobody does (bots only, or players busy elsewhere), the colony plans the most urgent
// room itself and sends small scavenging runs when food runs low.
// Toggle: settings.botInitiative. Everything it does is logged and can be cancelled by players.
import { LOC, mapPath } from "../expedition/map";
import { rollLoot } from "../expedition/site";
import type { Char, World } from "../types";
import { BAL } from "../data/balance";
import { ROOMS, addObj, canPlaceRoom, objsInRoom, objsOfKind, placeRoom, roomCost } from "../world/rooms";
import { roomLocked } from "./build";
import { arriveHooks, capacity, departExpedition, exped, newExpedition, startLegPublic as startAutoLeg, wmap, type Expedition } from "./expedition";
import { foodUnits } from "./items";
import { onTick } from "./tick";
import { clamp, firstName, isBotDriven, log, rng } from "./util";

/** terrain hardness → digging effort per cell (air, soil, clay, stone, granite, water, concrete, bedrock) */
const HARD = [0, 1, 1.4, 3, 5, 2, 4, 99];

function alive(w: World) {
  return Object.values(w.chars).filter((c) => c.status !== "dead");
}

function canAfford(w: World, cost: Record<string, number>) {
  return Object.entries(cost).every(([k, n]) => (w.res[k] ?? 0) >= n);
}

/** Days of food left at one ration per resident per day. */
export function foodDays(w: World) {
  return foodUnits(w) / Math.max(1, alive(w).length);
}

/** Players who could be planning: online, with a character, not in the aquarium. */
function activePlanners(w: World) {
  return Object.values(w.players).filter((p) => p.online && !p.aquarium && p.char);
}

// ---------------------------------------------------------------- what to build

export function neededRoom(w: World): { type: string; why: string } | null {
  const n = alive(w).length;
  const building = Object.values(w.rooms).some((r) => r.state !== "done");
  if (building) return null;
  const trays = objsOfKind(w, "hydro_tray").length + objsOfKind(w, "mushroom_bed").length;
  const beds = objsOfKind(w, "bed").length;
  if (trays < Math.ceil(n * 1.8)) return { type: "hydro", why: "еды не хватает — нужны ещё грядки" };
  if (beds < n) return { type: "living", why: "не всем хватает коек" };
  if (trays < n * 2.5) return { type: "mushroom", why: "запас еды на зиму" };
  return null;
}

/** Cheapest valid spot (least digging, shallow) for a room; tries the widest affordable width first. */
export function findSpot(w: World, type: string): { x: number; lv: number; width: number } | null {
  const def = ROOMS[type];
  if (!def || roomLocked(w, type)) return null;
  for (let width = def.w[1]; width >= def.w[0]; width--) {
    if (!canAfford(w, roomCost(type, width))) continue;
    let best: { x: number; lv: number; width: number; score: number } | null = null;
    for (let lv = 0; lv < w.H / 2; lv++)
      for (let x = 1; x + width < w.W - 1; x++) {
        if (canPlaceRoom(w, type, x, lv, width)) continue;
        let dig = 0;
        for (let i = 0; i < width; i++) for (let r = 0; r < 2; r++) dig += HARD[w.grid[(lv * 2 + r) * w.W + x + i]] ?? 3;
        const score = dig + lv * 4;
        if (!best || score < best.score) best = { x, lv, width, score };
      }
    if (best) return best;
  }
  return null;
}

function powerShort(w: World) {
  return (w.flags._demAvg ?? 0) >= maxGeneration(w) * 0.9 && objsOfKind(w, "bike_gen").length < Math.ceil(alive(w).length / 2.5);
}

function autoPlan(w: World) {
  const need = neededRoom(w);
  if (!need) return;
  let type = need.type;
  // power first: no new grow-lamps while the generators can't keep up — mushrooms need no light
  if (powerShort(w) && type === "hydro") type = "mushroom";
  let spot = findSpot(w, type);
  // can't afford hydro → cheap mushroom beds are still food
  if (!spot && type === "hydro") {
    type = "mushroom";
    spot = findSpot(w, type);
  }
  if (!spot) return;
  placeRoom(w, type, spot.x, spot.lv, spot.width, false);
  w.flags._autoPlanDay = w.day;
  log(w, `🏗 Жильцы сами размечают: ${ROOMS[type].name} (${spot.width} кл.) — ${need.why}. Отменить можно в режиме стройки (B).`, "info");
}

// ---------------------------------------------------------------- power

export const BIKE_COST = { scrap: 3, parts: 3, wood: 4 };

/** A free floor cell inside a finished room (tech room first). */
function freeCell(w: World): { x: number; lv: number; room: string } | null {
  const rooms = Object.values(w.rooms)
    .filter((r) => r.state === "done" && !["shaft", "corridor", "airlock", "lift", "support"].includes(r.type))
    .sort((a, b) => (a.type === "tech" ? -1 : b.type === "tech" ? 1 : 0));
  for (const r of rooms) {
    const used = new Set(objsInRoom(w, r.id).map((o) => o.x));
    for (let x = r.x; x < r.x + r.w; x++) if (!used.has(x) && !w.ladders[x + "," + r.lv]) return { x, lv: r.lv, room: r.id };
  }
  return null;
}

function maxGeneration(w: World) {
  let g = 0;
  for (const o of Object.values(w.objs)) {
    if (o.broken) continue;
    if (o.kind === "bike_gen") g += BAL.bikeKw;
    else if (o.kind === "diesel_gen" && (w.res.fuel ?? 0) > 0) g += BAL.dieselKw;
    else if (o.kind === "thermal_gen") g += BAL.thermalKw;
    else if (o.kind === "solar_panel") g += BAL.solarKw * 0.6;
  }
  return g;
}

/** A second (third…) bike when daytime demand keeps outrunning what the generators can give. */
function autoPower(w: World) {
  const demand = w.flags._demAvg ?? 0;
  if (!powerShort(w)) return;
  if (!canAfford(w, BIKE_COST)) return;
  const cell = freeCell(w);
  if (!cell) return;
  for (const k in BIKE_COST) w.res[k] -= BIKE_COST[k as keyof typeof BIKE_COST];
  addObj(w, "bike_gen", cell.x, cell.lv, cell.room);
  w.flags._autoPowerDay = w.day;
  log(w, `🚲 Жильцы собрали ещё один генератор-велосипед: энергии не хватало (${demand.toFixed(1)} кВт при максимуме ${maxGeneration(w).toFixed(1) } кВт).`, "info");
}

// ---------------------------------------------------------------- scavenging runs

function fitForRun(c: Char) {
  return c.status === "ok" && c.needs.health > 70 && c.needs.energy > 45 && c.needs.food > 35 && c.needs.water > 35 && !c.seat;
}

/** Nearest known location worth searching (prefers food), falling back to unexplored neighbours of known ground. */
/** What the colony is short of right now: "food" or "materials". */
function shortage(w: World): "food" | "materials" | null {
  if (foodDays(w) < 3) return "food";
  if ((w.res.scrap ?? 0) < 8 || (w.res.parts ?? 0) < 4) return "materials";
  return null;
}

function pickTarget(w: World, want: "food" | "materials"): string | null {
  const m = wmap(w);
  const home = m.nodes.home;
  let best: { id: string; score: number } | null = null;
  for (const n of Object.values(m.nodes)) {
    if (n.id === "home" || n.hidden || !LOC.types[n.type] || n.type === "ark") continue;
    const path = mapPath(m, "home", n.id, true) ?? (n.known ? null : mapPath(m, "home", n.id, false));
    if (!path || path.length > 3) continue;
    const t = LOC.types[n.type];
    const d = Math.hypot(n.x - home.x, n.y - home.y);
    let score = d / 10 + n.danger * 3 + (n.looted ?? 0) * 12;
    if (want === "food" && t.loot === "food") score -= 4;
    if (want === "food" && t.loot === "seeds") score -= 2;
    if (want === "materials" && ["base", "tools", "fuel", "misc"].includes(t.loot)) score -= 4;
    if (!best || score < best.score) best = { id: n.id, score };
  }
  return best?.id ?? null;
}

function autoSortie(w: World, want: "food" | "materials") {
  const squad = alive(w)
    .filter((c) => isBotDriven(w, c.id) && fitForRun(c))
    .sort((a, b) => b.card.stats.sil + b.card.stats.vyn - (a.card.stats.sil + a.card.stats.vyn))
    .slice(0, 2);
  // never strip the bunker bare
  if (squad.length < 2 || alive(w).filter((c) => c.status === "ok").length - squad.length < 2) return;
  const target = pickTarget(w, want);
  if (!target) return;
  const m = wmap(w);
  const path = mapPath(m, "home", target, false);
  if (!path || path.length < 2) return;
  const e = newExpedition(w);
  e.squad = squad.map((c) => c.id);
  e.auto = target;
  // a light pack: the run is short
  for (const [k, n] of [["water", 2], ["food_can", 1], ["meds", 1], ["flashlight", 1]] as const) {
    const have = Math.floor(w.res[k] ?? 0);
    if (have >= n + (k === "water" ? 4 : 0)) e.gear[k] = n;
  }
  w.mods.expedition = e;
  if (departExpedition(w, e)) {
    delete w.mods.expedition;
    return;
  }
  e.route = path.slice(1);
  startAutoLeg(w, e);
  w.flags._autoSortieDay = w.day;
  log(w, `🎒 ${squad.map(firstName).join(" и ")} сами уходят за ${want === "food" ? "едой" : "хламом и деталями"}: ${m.nodes[target].known ? m.nodes[target].name : "в неизведанное"}.`, "event");
}

/** Bot squads search the place abstractly instead of walking the building room by room. */
arriveHooks.push((w, e: Expedition, n) => {
  if (!e.auto || e.route.length) return false;
  const squad = e.squad.map((id) => w.chars[id]).filter((c) => c && c.status !== "dead") as Char[];
  if (squad.some((c) => !isBotDriven(w, c.id))) return false; // a player took over: normal rules
  const t = LOC.types[n.type];
  const R = rng(w);
  if (t) {
    const fresh = 1 - (n.looted ?? 0);
    const rolls = Math.max(1, Math.round((2 + squad.length * 2) * fresh));
    const loot = rollLoot(t.loot, R, rolls);
    const cap = capacity(w, e.squad);
    let weight = 0;
    for (const k in loot) {
      const add = Math.max(0, Math.min(loot[k], Math.floor((cap - weight) / 0.8)));
      if (add <= 0) continue;
      e.loot[k] = (e.loot[k] ?? 0) + add;
      weight += add * 0.8;
    }
    n.looted = clamp((n.looted ?? 0) + 0.35, 0, 1);
    // danger: scrapes and bites, rarely worse
    for (const c of squad)
      if (R.chance(0.12 * n.danger)) {
        const dmg = R.int(15, 35) * n.danger * 0.6;
        c.needs.health = clamp(c.needs.health - dmg, 5, 100);
        log(w, `🩹 ${firstName(c)} ранен(а) на вылазке (${n.name}).`, "bad");
      }
  }
  const back = mapPath(wmap(w), n.id, "home", false);
  if (back && back.length > 1) {
    e.route = back.slice(1);
    startAutoLeg(w, e);
  }
  return true;
});

// ---------------------------------------------------------------- the tick

onTick("foreman", "day", (w, dt) => {
  if (!w.settings.botInitiative || w.phase !== "day") return;
  w.flags._foremanT = (w.flags._foremanT ?? 0) + dt;
  if (w.flags._foremanT < 15) return;
  w.flags._foremanT = 0;
  // running average of daytime demand (≈ the last few hours)
  w.flags._demAvg = (w.flags._demAvg ?? w.power.demand) * 0.9 + w.power.demand * 0.1;
  const planners = activePlanners(w);
  if ((w.flags._autoPowerDay ?? -9) < w.day) autoPower(w);
  // with players around, the colony only steps in after two days without any planning
  const humanQuiet = !planners.length || (w.day >= 3 && (w.flags._humanPlanDay ?? 0) < w.day - 2);
  // rooms: only when players have left planning alone for a while
  if (humanQuiet && w.hour > 7 && w.hour < 17 && (w.flags._autoPlanDay ?? -9) < w.day) autoPlan(w);
  // sorties: in the morning, when food is short and nobody is outside
  const noSortie = !exped(w) && !w.mods.expedition;
  // with a player at the keyboard the colony doesn't send people away on its own:
  // the need shows up in «Задачи» and the players decide
  const want = shortage(w);
  if (want && !planners.length && noSortie && w.hour > 7 && w.hour < 11 && (w.flags._autoSortieDay ?? -9) < w.day - 1) autoSortie(w, want);
});
