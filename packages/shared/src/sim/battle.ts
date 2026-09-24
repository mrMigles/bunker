import { ENEMIES, actNow, allyBotPlan, createCombat, enemyPhase, unitAlive, unitSummary, type Action, type CombatState, type Field, type UnitInit } from "../combat/combat";
import { threatLevel } from "./progress";
import { bunkerField, makeArena } from "../combat/fields";
import { PROFS } from "../data/characters";
import { modViews } from "../net/view";
import { Rng } from "../rng";
import type { Char, World } from "../types";
import { feetY } from "../world/grid";
import { stopTask } from "./actions";
import { registerCmd } from "./commands";
import { spawnItem } from "./items";
import { beginDay } from "./lobby";
import { killChar, knockDown } from "./needs";
import { onTick } from "./tick";
import { combatBonuses, grantXp } from "./progress";
import { clamp, fx, log, rng, skillLevel } from "./util";

export interface BattleMod {
  active: boolean;
  where: "arena" | "bunker" | "expedition";
  state: CombatState;
  planLeft: number;
  animLeft: number;
  ready: Record<string, boolean>;
  eventsRound: number;
  tag?: string; // raid kind / node id
  onEnd?: string; // hook name
  initItems?: Record<string, Record<string, number>>;
}

export const battleEndHooks: Record<string, (w: World, b: BattleMod) => void> = {};
export const battleRoundHooks: ((w: World, b: BattleMod) => void)[] = [];

export function battle(w: World): BattleMod | undefined {
  return w.mods.combat?.active ? (w.mods.combat as BattleMod) : undefined;
}

const WEAPON_PREF = ["rifle", "shotgun", "pistol", "knife", "pipe"];

/** Builds a combat unit from a resident; takes the best weapon from storage (shared arsenal). */
export function charUnit(w: World, c: Char, col: number, floor: number, taken: Record<string, number>): UnitInit {
  let weapon = c.equip?.weapon ?? "fists";
  // their own weapon first; otherwise the best one still left in the storage
  for (const wp of c.equip?.weapon ? [] : WEAPON_PREF) {
    if ((w.res[wp] ?? 0) - (taken[wp] ?? 0) >= 1) {
      weapon = wp;
      taken[wp] = (taken[wp] ?? 0) + 1;
      break;
    }
  }
  const armor = c.equip?.armor ? 2 : (w.res.armor ?? 0) - (taken.armor ?? 0) >= 1 ? ((taken.armor = (taken.armor ?? 0) + 1), 2) : 0;
  const items: Record<string, number> = {};
  if ((w.res.medkit ?? 0) - (taken.medkit ?? 0) >= 1) ((items.medkit = 1), (taken.medkit = (taken.medkit ?? 0) + 1));
  else if ((w.res.meds ?? 0) - (taken.meds ?? 0) >= 1) ((items.meds = 1), (taken.meds = (taken.meds ?? 0) + 1));
  if ((w.res.molotov ?? 0) - (taken.molotov ?? 0) >= 1) ((items.molotov = 1), (taken.molotov = (taken.molotov ?? 0) + 1));
  return {
    id: "u_" + c.id,
    side: "ally",
    name: c.card.name.split(" ")[0],
    char: c.id,
    col,
    floor,
    // wounds count, but nobody walks into a fight one hit from dropping
    hpFrac: Math.max(0.6, c.needs.health / 100),
    stats: c.card.stats,
    skills: { shooting: skillLevel(c, "shooting"), melee: skillLevel(c, "melee"), medicine: skillLevel(c, "medicine") },
    weapon,
    armor,
    ability: PROFS[c.card.prof]?.ability,
    color: c.card.color,
    traits: [c.card.plus, c.card.minus, ...(c.perks ?? [])],
    ...combatBonuses(c),
    items,
    nvg: (w.res.nvg ?? 0) >= 1 || c.equip?.tool === "nvg",
  };
}

export function startBattle(w: World, field: Field, allies: UnitInit[], enemies: UnitInit[], where: BattleMod["where"], opts: { coordination?: number; tag?: string; onEnd?: string } = {}) {
  const seed = (rng(w).next() * 2 ** 31) | 0;
  // the wasteland grows harder as the survivors grow stronger (and as days pass)
  const tl = where === "arena" ? 1 : threatLevel(w);
  if (tl > 1)
    for (const e of enemies) {
      const base = ENEMIES[e.etype ?? ""]?.hp ?? 10;
      e.hpBonus = (e.hpBonus ?? 0) + Math.round(base * 0.1 * (tl - 1));
      e.aimBonus = (e.aimBonus ?? 0) + 2 * (tl - 1);
    }
  const state = createCombat(field, allies, enemies, seed, { coordination: opts.coordination, where });
  const b: BattleMod = { active: true, where, state, planLeft: w.settings.combatTurnTime, animLeft: 0, ready: {}, eventsRound: 0, tag: opts.tag, onEnd: opts.onEnd, initItems: {} };
  for (const a of allies) b.initItems![a.id] = { ...(a.items ?? {}) };
  w.mods.combat = b;
  for (const a of allies) {
    const c = a.char ? w.chars[a.char] : undefined;
    if (c) {
      stopTask(w, c);
      c.mind.plan = "combat";
    }
  }
  fx(w, { k: "toast", text: "⚔ Бой!" });
  fx(w, { k: "sound", id: "alarm" });
  log(w, `⚔ Начался бой (${where === "bunker" ? "в бункере" : where === "expedition" ? "в вылазке" : "арена"}).`, "bad");
  return b;
}

function myUnit(w: World, pid: string): string | null {
  const b = battle(w);
  const ch = w.players[pid]?.char;
  if (!b || !ch) return null;
  const u = b.state.units["u_" + ch];
  return u && unitAlive(u) ? u.id : null;
}

/** Seconds of animation for a batch of combat events. */
function animFor(b: BattleMod) {
  const ev = b.state.events;
  return Math.min(12, 0.3 + ev.filter((e) => e.k !== "move").length * 0.55 + ev.filter((e) => e.k === "move").length * 0.12);
}

/** One action of my fighter, executed right away (XCOM-style). */
registerCmd("cact", (w, p, cmd) => {
  const b = battle(w);
  if (!b || b.state.phase !== "plan") return "Сейчас ход противника";
  if (b.animLeft > 0.25) return "Подождите, пока закончится действие";
  const uid = myUnit(w, p.id);
  if (!uid) return "Вы не в бою";
  const err = actNow(b.state, uid, cmd.action as Action);
  if (err) return err;
  b.eventsRound++;
  b.animLeft = animFor(b);
  syncBunkerPositions(w, b);
});

/** Legacy: a queued plan is simply executed action by action now. */
registerCmd("cplan", (w, p, cmd) => {
  const b = battle(w);
  if (!b || b.state.phase !== "plan") return "Сейчас ход противника";
  const uid = myUnit(w, p.id);
  if (!uid) return "Вы не в бою";
  const acts = (Array.isArray(cmd.actions) ? cmd.actions : []).slice(0, 8) as Action[];
  for (const a of acts) {
    const err = actNow(b.state, uid, a);
    if (err) return err;
  }
  if (acts.length) {
    b.eventsRound++;
    b.animLeft = animFor(b);
  }
  b.ready[p.id] = !!cmd.ready;
});

registerCmd("cready", (w, p, cmd) => {
  const b = battle(w);
  if (!b) return;
  b.ready[p.id] = cmd.v !== false;
});

registerCmd("cskip", (w) => {
  const b = battle(w);
  if (b) b.animLeft = Math.min(b.animLeft, 0.2);
});

function humanPlayersInBattle(w: World): string[] {
  const b = battle(w);
  if (!b) return [];
  return Object.values(w.players)
    .filter((p) => p.online && p.char && b.state.units["u_" + p.char] && unitAlive(b.state.units["u_" + p.char]))
    .map((p) => p.id);
}

onTick("battle", "*", (w, dt) => {
  const b = battle(w);
  if (!b) return;
  if (b.animLeft > 0) {
    b.animLeft -= dt;
    if (b.animLeft <= 0 && b.state.phase === "over") finishBattle(w, b);
    return;
  }
  if (b.state.phase === "over") {
    finishBattle(w, b);
    return;
  }
  // a siege that goes nowhere: the attackers give up and leave
  if (b.state.round > 40) {
    for (const u of Object.values(b.state.units)) if (u.side === "enemy" && unitAlive(u)) u.fled = true;
    b.state.result = "win";
    b.state.phase = "over";
    b.state.log.push("Нападавшие отступили.");
    return;
  }
  b.planLeft -= dt;
  const humans = humanPlayersInBattle(w);
  const allReady = humans.length > 0 && humans.every((pid) => b.ready[pid]);
  if (b.planLeft <= 0 || allReady || humans.length === 0) {
    // the squad's turn is over: bots act (and idle players' fighters, so nobody just stands there), then enemies
    const humanUnits = new Set(humans.filter((pid) => b.ready[pid] || (b.state.units["u_" + w.players[pid].char] as any)?.acted).map((pid) => "u_" + w.players[pid].char));
    const bots = Object.values(b.state.units)
      .filter((u) => u.side === "ally" && unitAlive(u) && !humanUnits.has(u.id))
      .map((u) => u.id);
    enemyPhase(b.state, bots, (u) => allyBotPlan(b.state, u));
    b.eventsRound++;
    for (const h of battleRoundHooks) h(w, b);
    syncBunkerPositions(w, b);
    b.animLeft = animFor(b);
    b.planLeft = w.settings.combatTurnTime;
    b.ready = {};
  }
});

/** In bunker fights the residents' real positions follow their combat units. */
function syncBunkerPositions(w: World, b: BattleMod) {
  if (b.where !== "bunker") return;
  for (const u of Object.values(b.state.units)) {
    const c = u.char ? w.chars[u.char] : undefined;
    if (!c) continue;
    c.x = b.state.field.originX + u.col + 0.5;
    c.lv = b.state.field.originLv + u.floor;
    c.y = feetY(c.lv);
    c.climbing = false;
  }
}

function finishBattle(w: World, b: BattleMod) {
  const s = b.state;
  const R = new Rng(w.rng);
  b.active = false;
  const loot: Record<string, number> = {};
  /** what each fallen enemy carried (bodies to search on expeditions) */
  const drops: Record<string, Record<string, number>> = {};
  for (const u of Object.values(s.units)) {
    if (u.side === "ally") {
      const c = u.char ? w.chars[u.char] : undefined;
      if (!c) continue;
      c.mind.plan = "idle";
      c.needs.health = clamp((Math.max(0, u.hp) / u.maxHp) * 100);
      c.needs.sanity = clamp(c.needs.sanity - u.stress / 4 - 3);
      if (u.items.__rad) c.needs.rad = clamp(c.needs.rad + u.items.__rad);
      c.skills.shooting += 4;
      c.skills.melee += 2;
      // experience: surviving, winning and every foe put down
      const foes = Object.values(s.units).filter((x) => x.side === "enemy" && (x.dead || x.captured || x.fled)).length;
      if (!u.dead) grantXp(c, (s.result === "win" ? 15 : 6) + foes * 4);
      if (u.dead) killChar(w, c, "погиб(ла) в бою");
      else if (u.down) {
        if (b.where === "bunker" || b.where === "arena") knockDown(w, c, "ранение в бою");
        else c.needs.health = Math.max(c.needs.health, 5);
      }
      // consumed items & ammo come out of the shared storage (bunker fights)
      if (b.where === "bunker") {
        const init = b.initItems?.[u.id] ?? {};
        for (const it in init) if (!it.startsWith("__")) w.res[it] = Math.max(0, (w.res[it] ?? 0) - (init[it] - (u.items[it] ?? 0)));
        const shots = s.log.length; // rough ammo use
        void shots;
        if (u.maxAmmo > 0) w.res.ammo = Math.max(0, (w.res.ammo ?? 0) - Math.max(0, u.maxAmmo - u.ammo));
      }
    } else if (u.dead || u.captured) {
      const d = ENEMIES[u.etype ?? ""];
      const mine: Record<string, number> = (drops[u.id] = {});
      if (d) for (const k in d.loot) {
        const n = R.int(d.loot[k][0], d.loot[k][1]);
        if (n > 0) {
          loot[k] = (loot[k] ?? 0) + n;
          mine[k] = n;
        }
      }
      if (u.captured && b.where === "bunker") w.flags.prisoner = 1;
    }
  }
  b.state.log.push(s.result === "win" ? "Победа!" : s.result === "fled" ? "Отступили." : "Поражение…");
  log(w, s.result === "win" ? "⚔ Бой выигран!" : s.result === "fled" ? "⚔ Отступили с поля боя." : "⚔ Бой проигран…", s.result === "win" ? "good" : "bad");
  fx(w, { k: "toast", text: s.result === "win" ? "⚔ Победа!" : "⚔ Бой окончен" });
  (b as any).loot = loot;
  (b as any).drops = drops;
  if (b.where === "bunker" || b.where === "arena") {
    // loot drops where the fight was
    const home = Object.values(w.chars).find((c) => c.status === "ok");
    let i = 0;
    for (const k in loot) spawnItem(w, k, loot[k], (home?.x ?? 20) + (i++ % 3) * 0.4, home?.lv ?? 0);
  }
  w.director.tension = clamp(w.director.tension + 25);
  w.director.quiet = Math.max(w.director.quiet, 1);
  if (b.onEnd && battleEndHooks[b.onEnd]) battleEndHooks[b.onEnd](w, b);
  delete w.mods.combat;
  w.mods.lastBattle = { result: s.result, where: b.where, loot, log: s.log.slice(-12), day: w.day };
}

// ---------------------------------------------------------------- debug arena

export function startArena(w: World, pids: string[]) {
  if (w.phase === "lobby") {
    w.settings.skipPrologue = true;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
  }
  const field = makeArena((rng(w).next() * 1e9) | 0);
  const allies: UnitInit[] = [];
  const taken: Record<string, number> = { rifle: -1, pistol: -1, shotgun: -1 }; // arena loaner guns
  const chars = pids.map((pid) => w.players[pid]?.char).filter(Boolean).map((id) => w.chars[id!]) as Char[];
  for (const c of Object.values(w.chars)) if (chars.length < 3 && !chars.includes(c) && c.status === "ok") chars.push(c);
  chars.slice(0, 3).forEach((c, i) => allies.push(charUnit(w, c, 1 + i, i === 2 ? 1 : 0, taken)));
  const R = rng(w);
  const types = ["marauder", "raider", "dog", "rat", "rat", "sniper", "cultist", "soldier", "drone", "glowing", "mole", "boss"];
  const enemies: UnitInit[] = [];
  for (let i = 0; i < 5; i++) enemies.push({ id: "e" + i, side: "enemy", name: "", col: field.cols - 1 - Math.floor(i / 2) * 2 - (i % 2), floor: i % 2, etype: i === 0 ? R.pick(types) : R.pick(types.slice(0, 5)) });
  return startBattle(w, field, allies, enemies, "arena");
}

registerCmd("debugArena", (w, p) => {
  if (w.phase === "lobby") {
    // start the game first without prologue
    w.settings.skipPrologue = true;
    applyStart(w);
  }
  if (battle(w)) return "Бой уже идёт";
  const online = Object.values(w.players).filter((x) => x.online).map((x) => x.id);
  startArena(w, online.includes(p.id) ? online : [p.id]);
});

import { startGame } from "./lobby";
function applyStart(w: World) {
  startGame(w);
  if (w.phase !== "day") beginDay(w);
}

// ---------------------------------------------------------------- bunker battles (raids, nests)

export function bunkerBattle(w: World, enemyTypes: string[], entry: "airlock" | "metro" | "top", tag: string, onEnd?: string) {
  const field = bunkerField(w, entry);
  const allies: UnitInit[] = [];
  const taken: Record<string, number> = {};
  for (const c of Object.values(w.chars)) {
    if (c.status !== "ok" && c.status !== "breakdown") continue;
    if (c.card.prof === "child") continue; // children hide in the back rooms
    if (c.status === "breakdown") c.status = "ok";
    const floor = c.lv - field.originLv;
    if (floor < 0 || floor >= field.floors) continue;
    let col = Math.floor(c.x);
    if (field.doors.some((d) => d.col === col && d.floor === floor)) col += 1; // don't stand in the hatch
    allies.push(charUnit(w, c, col, floor, taken));
  }
  // turrets fight on our side (static units, ammo from the turret)
  for (const o of Object.values(w.objs)) {
    if (o.kind !== "turret" || o.broken || w.power.off.includes("defense")) continue;
    allies.push({ id: "tur_" + o.id, side: "ally", name: "Турель", col: o.x, floor: o.lv - field.originLv, weapon: "rifle", ammo: Math.min(5, o.st.ammo ?? 0), stats: { sil: 1, lov: 3, int: 1, vyn: 1, har: 1 }, skills: { shooting: 3, melee: 0, medicine: 0 }, tags: ["machine", "static"], maxHp: 20, icon: "🔫", color: 0x555a60 });
  }
  const exit = field.exits[0];
  const enemies: UnitInit[] = enemyTypes.map((t, i) => ({ id: "e" + i, side: "enemy", name: "", col: Math.max(1, exit.col + (i % 3) - 1 + (entry === "metro" ? 0 : 1)), floor: exit.floor, etype: t }));
  const b = startBattle(w, field, allies, enemies, "bunker", { tag, onEnd });
  // tripwires set up at the entrance
  for (let i = 0; i < Math.min(3, w.flags.raid_traps ?? 0); i++) b.state.trips.push({ col: field.doors[0].col + (i % 2 ? -1 : 1) * (1 + Math.floor(i / 2)), floor: field.doors[0].floor });
  w.flags.raid_traps = 0;
  return b;
}

// ---------------------------------------------------------------- views

modViews.combat = {
  pub: (w, b: BattleMod) => {
    if (!b?.active) return undefined;
    const s = b.state;
    return {
      active: true,
      where: b.where,
      round: s.round,
      phase: b.animLeft > 0 ? "anim" : s.phase,
      planLeft: Math.ceil(b.planLeft),
      animLeft: Math.round(b.animLeft * 10) / 10,
      ready: b.ready,
      field: s.field,
      units: Object.fromEntries(Object.values(s.units).map((u) => [u.id, unitSummary(u)])),
      plans: s.plans,
      events: s.events,
      eventsRound: b.eventsRound,
      result: s.result,
      log: s.log.slice(-10),
      dark: s.dark,
      fires: s.fires,
      trips: s.trips,
    };
  },
};

export { feetY };
