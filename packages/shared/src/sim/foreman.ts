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
import { arriveHooks, capacity, departExpedition, elogPublic as elog, exped, newExpedition, startLegPublic as startAutoLeg, wmap, type Expedition } from "./expedition";
import { killChar } from "./needs";
import { foodUnits, missingText, payRes } from "./items";
import { registerCmd } from "./commands";
import { onTick } from "./tick";
import { clamp, firstName, isBotDriven, log, rng } from "./util";

/** terrain hardness → digging effort per cell (air, soil, clay, stone, granite, water, concrete, bedrock) */
const HARD = [0, 1, 1.4, 3, 5, 2, 4, 99];

function alive(w: World) {
  return Object.values(w.chars).filter((c) => c.status !== "dead");
}

/** Materials already promised to marked rooms that have not paid for their frame yet (#21). */
export function reservedRes(w: World): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of Object.values(w.rooms)) {
    if (r.state === "done" || (r as any).paid) continue;
    const cost = roomCost(r.type, r.w);
    for (const k in cost) out[k] = (out[k] ?? 0) + cost[k];
  }
  return out;
}

/** Enough on the shelves once the marked rooms have taken what they need. */
function canAfford(w: World, cost: Record<string, number>) {
  const held = reservedRes(w);
  return Object.entries(cost).every(([k, n]) => (w.res[k] ?? 0) - (held[k] ?? 0) >= n);
}

/** A marked room stuck for 2+ days without the materials for its frame (tracked by the foreman tick). */
function stalled(w: World, id: string) {
  const since = w.flags["_stall_" + id];
  return since !== undefined && w.day - since >= 2;
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
  // a room waiting days for its frame materials does not freeze all other planning (#21)
  const building = Object.values(w.rooms).some((r) => r.state !== "done" && !stalled(w, r.id));
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
  const r = placeRoom(w, type, spot.x, spot.lv, spot.width, false);
  // the frame's materials are set aside right away: digging takes days and nothing else may spend them
  payRes(w, roomCost(type, spot.width));
  (r as any).paid = 1;
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

export function maxGeneration(w: World) {
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
/** Squad strength for an unattended run: bodies, weapons, health. Compared against the place's danger. */
export function squadPower(w: World, e: Expedition, squad: Char[]): number {
  let p = 0;
  for (const c of squad) p += (c.card.stats.sil + c.card.stats.lov) * 0.45 + (c.needs.health / 100) * 1.5 + ((c as any).level ?? 1) * 0.5;
  const guns = (e.supplies.rifle ?? 0) + (e.supplies.shotgun ?? 0) + (e.supplies.pistol ?? 0);
  const melee = (e.supplies.pipe ?? 0) + (e.supplies.knife ?? 0) + (e.supplies.crowbar ?? 0);
  p += Math.min(squad.length, guns) * 2.5 * ((e.supplies.ammo ?? 0) > 0 ? 1 : 0.3) + Math.min(squad.length, melee) * 1;
  if ((e.supplies.meds ?? 0) + (e.supplies.medkit ?? 0) > 0) p += 1;
  return p;
}

const THREAT_SPREAD = 7;
function sortieThreatBase(danger: number, looted: number) {
  return danger * 4.5 + looted * 2;
}

/** Odds of an unattended run (threat is uniform over a 7-point spread): shown to players before sending. */
export function sortieOdds(power: number, danger: number, looted = 0): { clean: number; rough: number; rout: number } {
  const lo = sortieThreatBase(danger, looted);
  // P(threat < power - 2) and P(threat < power + 3)
  const cdf = (v: number) => Math.max(0, Math.min(1, (v - lo) / THREAT_SPREAD));
  const clean = cdf(power - 2);
  const notRout = cdf(power + 3);
  return { clean: Math.round(clean * 100), rough: Math.round((notRout - clean) * 100), rout: Math.round((1 - notRout) * 100) };
}

/**
 * Residents on their own search the place abstractly. Without a player they can't pick their fights,
 * sneak past sleepers or choose what to open, so the outcome is a roll of squad strength vs danger:
 * clean, rough or a rout.
 */
arriveHooks.push((w, e: Expedition, n) => {
  if (!e.auto || e.route.length) return false;
  const squad = e.squad.map((id) => w.chars[id]).filter((c) => c && c.status !== "dead") as Char[];
  if (squad.some((c) => !isBotDriven(w, c.id))) return false; // a player took over: normal rules
  const t = LOC.types[n.type];
  const R = rng(w);
  if (t) {
    const power = squadPower(w, e, squad);
    const threat = sortieThreatBase(n.danger, n.looted ?? 0) + R.range(0, THREAT_SPREAD);
    const margin = power - threat;
    const outcome: "clean" | "rough" | "rout" = margin > 2 ? "clean" : margin > -3 ? "rough" : "rout";
    const fresh = 1 - (n.looted ?? 0);
    const share = outcome === "clean" ? 1 : outcome === "rough" ? 0.6 : 0.2;
    const rolls = Math.max(1, Math.round((2 + squad.length * 2) * fresh * share));
    const loot = rollLoot(t.loot, R, rolls);
    const cap = capacity(w, e.squad);
    let weight = 0;
    for (const k in loot) {
      const add = Math.max(0, Math.min(loot[k], Math.floor((cap - weight) / 0.8)));
      if (add <= 0) continue;
      e.loot[k] = (e.loot[k] ?? 0) + add;
      weight += add * 0.8;
    }
    n.looted = clamp((n.looted ?? 0) + 0.35 * share + 0.1, 0, 1);
    n.visited = true;
    const hurt: string[] = [];
    for (const c of squad) {
      const p = outcome === "clean" ? 0.1 * n.danger : outcome === "rough" ? 0.5 : 0.9;
      if (!R.chance(p)) continue;
      const dmg = R.int(12, 22) * (outcome === "rout" ? 2 : 1) * (0.6 + n.danger * 0.25);
      if (outcome === "rout" && R.chance(0.08 * n.danger)) {
        killChar(w, c, `погиб(ла) на вылазке без поддержки (${n.name})`);
        continue;
      }
      c.needs.health = clamp(c.needs.health - dmg, 6, 100);
      if (outcome !== "clean" && R.chance(0.35)) c.injury ??= R.pick(["bleed", "leg", "arm"]);
      hurt.push(firstName(c));
    }
    if (outcome === "rout") for (const k in e.supplies) e.supplies[k] = Math.floor(e.supplies[k] / 2);
    const names = squad.map(firstName).join(", ");
    const text =
      outcome === "clean"
        ? `✅ ${names}: «${n.name}» обыскали спокойно.`
        : outcome === "rough"
          ? `⚠ ${names}: в «${n.name}» пришлось отбиваться — взяли что успели.${hurt.length ? " Ранены: " + hurt.join(", ") + "." : ""}`
          : `❌ ${names}: в «${n.name}» отряд нарвался на засаду и бежал почти ни с чем.${hurt.length ? " Ранены: " + hurt.join(", ") + "." : ""}`;
    elog(e, text);
    log(w, text, outcome === "clean" ? "good" : "bad");
    (w.mods._autoReports ??= []).push({ day: w.day, node: n.name, outcome, power: Math.round(power), threat: Math.round(threat) });
  }
  const back = mapPath(wmap(w), n.id, "home", false);
  if (back && back.length > 1) {
    e.route = back.slice(1);
    startAutoLeg(w, e);
  }
  return true;
});

/** «Отправить без меня»: the squad of residents goes alone to a place the player picked. */
registerCmd("expSendBots", (w, p, cmd) => {
  const e = exped(w);
  if (!e || e.stage !== "prep") return "Сначала соберите вылазку у терминала";
  // players stay home: only residents go
  e.squad = e.squad.filter((id) => isBotDriven(w, id) && !w.players[w.chars[id]?.ctrl ?? ""]?.online);
  if (!e.squad.length) return "В отряде нет жильцов — добавьте кого-нибудь";
  const m = wmap(w);
  const node = m.nodes[String(cmd.node)];
  if (!node || !node.known || !LOC.types[node.type] || node.type === "ark") return "Выберите известное место для обыска";
  const path = mapPath(m, "home", node.id, false);
  if (!path || path.length < 2) return "Туда нет дороги";
  const err = departExpedition(w, e);
  if (err) return err;
  e.auto = node.id;
  e.route = path.slice(1);
  startAutoLeg(w, e);
  w.flags.tut_sortie = 1;
  log(w, `🎒 ${p.name} отправляет ${e.squad.map((id) => firstName(w.chars[id])).join(" и ")} в «${node.name}» без себя. Без игрока риск выше.`, "event");
});

// ---------------------------------------------------------------- the tick

/** Unpaid marked rooms that cannot afford their frame: remember since when, say once a day what is missing. */
function watchStalls(w: World) {
  for (const r of Object.values(w.rooms)) {
    const key = "_stall_" + r.id;
    if (r.state === "done" || (r as any).paid) {
      delete w.flags[key];
      continue;
    }
    const miss = missingText(w, roomCost(r.type, r.w));
    if (!miss) {
      delete w.flags[key];
      continue;
    }
    w.flags[key] ??= w.day;
    if (r.state === "frame" && (w.flags["_stallSaid_" + r.id] ?? -1) < w.day) {
      w.flags["_stallSaid_" + r.id] = w.day;
      log(w, `🏗 Каркас «${ROOMS[r.type]?.name ?? r.type}» ждёт материалов. ${miss}.`, "info");
    }
  }
}

onTick("foreman", "day", (w, dt) => {
  if (!w.settings.botInitiative || w.phase !== "day") return;
  w.flags._foremanT = (w.flags._foremanT ?? 0) + dt;
  if (w.flags._foremanT < 15) return;
  w.flags._foremanT = 0;
  // running average of daytime demand (≈ the last few hours)
  w.flags._demAvg = (w.flags._demAvg ?? w.power.demand) * 0.9 + w.power.demand * 0.1;
  const planners = activePlanners(w);
  watchStalls(w);
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
