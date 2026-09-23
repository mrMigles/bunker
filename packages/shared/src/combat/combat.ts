import enemiesJson from "../data/enemies.json";
import { BAL, type WeaponDef } from "../data/balance";
import { Rng, seedState, type RngState } from "../rng";

// ================================================================ data

export interface EnemyDef {
  name: string;
  icon: string;
  hp: number;
  armor: number;
  weapon: string;
  lov: number;
  ap: number;
  tags: string[];
  color: number;
  loot: Record<string, [number, number]>;
  ai: string;
}
export const ENEMIES = enemiesJson as unknown as Record<string, EnemyDef>;

export const WEAPONS: Record<string, WeaponDef> = {
  ...BAL.weapons,
  bite: { name: "Укус", dmg: [1, 3], ap: 1, range: 1, ammo: 0, bleed: true },
  claws: { name: "Когти", dmg: [2, 5], ap: 1, range: 1, ammo: 0 },
  ram: { name: "Таран", dmg: [6, 10], ap: 2, range: 1, ammo: 0 },
};

export const ABILITIES: Record<string, { name: string; cd: number; ap: number; target: "enemy" | "ally" | "cell" | "self" | "none"; desc: string }> = {
  suppress: { name: "Подавление", cd: 2, ap: 1, target: "enemy", desc: "Цель теряет 1 ОД и −15% точности на следующий ход." },
  surgery: { name: "Полевая хирургия", cd: 2, ap: 2, target: "ally", desc: "Лечит союзника рядом на 8 и останавливает кровь, поднимает упавшего." },
  turret: { name: "Растяжка", cd: 3, ap: 1, target: "cell", desc: "Растяжка на клетке: 6 урона первому врагу." },
  molotov: { name: "Коктейль Молотова", cd: 3, ap: 2, target: "cell", desc: "Огонь в зоне 2 позиций: 3 урона и горение." },
  kitchen_knife: { name: "Кухонный нож", cd: 1, ap: 1, target: "enemy", desc: "Удар рядом 3–5 и кровотечение." },
  inspire: { name: "Вдохновение", cd: 3, ap: 1, target: "none", desc: "Снимает панику, −30 стресса всем союзникам." },
  negotiate: { name: "Переговоры", cd: 3, ap: 2, target: "enemy", desc: "Шанс, что враг сбежит или сдастся (не фанатики)." },
  breach: { name: "Пробить стену", cd: 3, ap: 2, target: "cell", desc: "Разрушает укрытие/дверь; враг рядом теряет 1 ОД." },
  blackout: { name: "Отключить свет", cd: 3, ap: 1, target: "none", desc: "Темнота 2 хода: −20% точности всем без ПНВ; машины получают 6 урона." },
  call_support: { name: "Вызвать поддержку", cd: 4, ap: 1, target: "none", desc: "Бункер/отряд помогает: 5 урона двум врагам." },
  inspire_lesson: { name: "Урок спокойствия", cd: 2, ap: 1, target: "none", desc: "+15% точности союзникам в этом ходу, −10 стресса." },
  pitchfork: { name: "Вилы наперевес", cd: 1, ap: 1, target: "enemy", desc: "Удар на 2 клетки: 4–6 урона." },
  hide: { name: "Спрятаться", cd: 3, ap: 1, target: "self", desc: "Становится невидимым для врагов на ход." },
};

// ================================================================ types

export interface Cover {
  col: number;
  floor: number;
  kind: "half" | "full";
  hp: number;
  name?: string;
}

export interface Door {
  col: number;
  floor: number;
  closed: boolean;
  hp: number;
  barricaded?: boolean;
}

export interface Field {
  cols: number;
  floors: number;
  walk: boolean[]; // floors * cols
  ladders: string[]; // "col,floor": connects floor-1 and floor at col
  covers: Cover[];
  doors: Door[];
  exits: { col: number; floor: number }[];
  loot: { col: number; floor: number; room?: string }[];
  originX: number;
  originLv: number;
}

export interface UnitInit {
  id: string;
  side: "ally" | "enemy";
  name: string;
  col: number;
  floor: number;
  char?: string;
  etype?: string;
  hpFrac?: number;
  stats?: { sil: number; lov: number; int: number; vyn: number; har: number };
  skills?: { shooting: number; melee: number; medicine: number };
  weapon?: string;
  ammo?: number;
  armor?: number;
  ability?: string;
  color?: number;
  traits?: string[];
  items?: Record<string, number>;
  nvg?: boolean;
  tags?: string[];
  maxHp?: number;
  icon?: string;
}

export interface Unit {
  id: string;
  side: "ally" | "enemy";
  name: string;
  char?: string;
  etype?: string;
  col: number;
  floor: number;
  hp: number;
  maxHp: number;
  armor: number;
  weapon: string;
  ammo: number;
  maxAmmo: number;
  lov: number;
  sil: number;
  har: number;
  ap: number;
  maxAp: number;
  stress: number;
  skills: { shooting: number; melee: number; medicine: number };
  ability?: string;
  cd: number;
  st: { bleed?: number; burn?: number; slowed?: number; suppressed?: number; panic?: number; hunker?: number; hidden?: number; aimDebuff?: number; overwatch?: number; bonusHit?: number };
  down: boolean;
  dead: boolean;
  fled: boolean;
  captured?: boolean;
  intent?: Action[];
  intentText?: string;
  tags: string[];
  color: number;
  icon: string;
  traits: string[];
  items: Record<string, number>;
  nvg: boolean;
  carried?: Record<string, number>; // loot stolen by raiders
}

export type Action =
  | { t: "move"; col: number; floor: number }
  | { t: "shoot"; target: string; aimed?: boolean; part?: "legs" | "arms" | "head" }
  | { t: "melee"; target: string }
  | { t: "shove"; target: string }
  | { t: "reload" }
  | { t: "heal"; target: string }
  | { t: "throw"; col: number; floor: number }
  | { t: "ability"; target?: string; col?: number; floor?: number }
  | { t: "hunker" }
  | { t: "door"; col: number; floor: number }
  | { t: "overwatch" }
  | { t: "flee" }
  | { t: "steal" };

export interface CEvent {
  u: string; // actor unit id
  k: string; // move, shoot, melee, heal, ability, down, dead, flee, door, fire, stress, text, reaction
  to?: string;
  col?: number;
  floor?: number;
  hit?: boolean;
  dmg?: number;
  crit?: boolean;
  text?: string;
}

export interface CombatState {
  round: number;
  phase: "plan" | "over";
  rng: RngState;
  field: Field;
  units: Record<string, Unit>;
  plans: Record<string, Action[]>;
  ready: Record<string, boolean>;
  events: CEvent[];
  result: "win" | "lose" | "fled" | null;
  log: string[];
  dark: number; // rounds of darkness left
  fires: { col: number; floor: number; turns: number }[];
  trips: { col: number; floor: number }[];
  coordination: number; // bonus AP on the first round (radio)
  hitBonus: number; // this round (teacher)
  where: string;
}

// ================================================================ field helpers

export const fidx = (f: Field, col: number, floor: number) => floor * f.cols + col;
export const walkableF = (f: Field, col: number, floor: number) => col >= 0 && col < f.cols && floor >= 0 && floor < f.floors && f.walk[fidx(f, col, floor)];
export const doorAt = (f: Field, col: number, floor: number) => f.doors.find((d) => d.col === col && d.floor === floor);
export const coverAt = (f: Field, col: number, floor: number) => f.covers.find((c) => c.col === col && c.floor === floor && c.hp > 0);

function blocked(s: CombatState, col: number, floor: number, forUnit?: Unit) {
  const d = doorAt(s.field, col, floor);
  if (d && d.closed && !forUnit?.tags.includes("burrow")) return true;
  return false;
}

/** BFS path (list of positions excluding start). Occupied cells by enemies block passage (allies can pass allies). */
export function pathTo(s: CombatState, u: Unit, col: number, floor: number): { col: number; floor: number }[] | null {
  const f = s.field;
  if (!walkableF(f, col, floor)) return null;
  const key = (c: number, fl: number) => fl * f.cols + c;
  const prev = new Map<number, number>();
  const start = key(u.col, u.floor);
  prev.set(start, -1);
  const q = [start];
  const flying = u.tags.includes("flying");
  while (q.length) {
    const cur = q.shift()!;
    const c = cur % f.cols,
      fl = Math.floor(cur / f.cols);
    if (c === col && fl === floor) break;
    const nb: [number, number][] = [
      [c - 1, fl],
      [c + 1, fl],
    ];
    if (flying || f.ladders.includes(`${c},${fl + 1}`)) nb.push([c, fl + 1]);
    if (flying || f.ladders.includes(`${c},${fl}`)) nb.push([c, fl - 1]);
    for (const [nc, nf] of nb) {
      if (!walkableF(f, nc, nf) && !(u.tags.includes("burrow") && nc >= 0 && nc < f.cols && nf === fl)) continue;
      if (blocked(s, nc, nf, u)) continue;
      if (nf !== fl && blocked(s, c, fl, u)) continue; // a closed hatch can't be climbed through
      const occ = Object.values(s.units).some((o) => o.side !== u.side && !o.dead && !o.fled && !o.down && o.col === nc && o.floor === nf);
      if (occ && !(nc === col && nf === floor)) continue;
      const k = key(nc, nf);
      if (!prev.has(k)) {
        prev.set(k, cur);
        q.push(k);
      }
    }
  }
  const goal = key(col, floor);
  if (!prev.has(goal)) return null;
  const out: { col: number; floor: number }[] = [];
  let k = goal;
  while (k !== start) {
    out.push({ col: k % f.cols, floor: Math.floor(k / f.cols) });
    k = prev.get(k)!;
  }
  return out.reverse();
}

export function moveCost(steps: number) {
  return steps <= 1 ? steps : Math.ceil((steps * 2) / 3);
}

/** Clear horizontal line of fire on the same floor (closed doors between block it). */
export function lineOfFire(s: CombatState, a: Unit, b: { col: number; floor: number }): boolean {
  if (a.floor !== b.floor) return false;
  const lo = Math.min(a.col, b.col),
    hi = Math.max(a.col, b.col);
  for (let c = lo + 1; c < hi; c++) {
    if (!walkableF(s.field, c, a.floor)) return false;
    const d = doorAt(s.field, c, a.floor);
    if (d?.closed) return false;
  }
  return true;
}

export function weaponOf(u: Unit): WeaponDef {
  return WEAPONS[u.weapon] ?? WEAPONS.fists;
}

export function unitAlive(u: Unit) {
  return !u.dead && !u.fled && !u.down && !u.captured;
}
const alive = unitAlive;

export function hitChance(s: CombatState, a: Unit, t: Unit, aimed = false, part?: string): number {
  const w = weaponOf(a);
  let ch = 62 + a.skills.shooting * 4 + (a.lov - 2) * 3;
  if (w.range <= 1) ch = 78 + a.skills.melee * 3 + (a.sil - 2) * 3;
  if (aimed) ch += 20;
  if (part === "head") ch -= 15;
  const dist = Math.abs(a.col - t.col);
  if (w.range > 1 && dist > 2) ch -= (dist - 2) * (w.falloff ? 8 : 3);
  const cov = coverAt(s.field, t.col, t.floor);
  if (cov && w.range > 1) ch -= cov.kind === "full" ? 50 : 25;
  if (t.st.hunker) ch -= 15;
  if (s.dark > 0 && !a.nvg) ch -= 20;
  if (a.st.suppressed) ch -= 15;
  if (a.st.aimDebuff) ch -= 20;
  if (a.st.panic) ch -= 20;
  if (a.side === "ally") ch += s.hitBonus;
  if (t.st.hidden) return 0;
  return Math.max(5, Math.min(95, ch));
}

// ================================================================ creation

export function makeUnit(init: UnitInit): Unit {
  if (init.side === "enemy") {
    const d = ENEMIES[init.etype ?? "marauder"];
    const w = WEAPONS[d.weapon];
    return {
      id: init.id,
      side: "enemy",
      name: d.name,
      etype: init.etype,
      col: init.col,
      floor: init.floor,
      hp: d.hp,
      maxHp: d.hp,
      armor: d.armor,
      weapon: d.weapon,
      ammo: w?.ammo || 0,
      maxAmmo: w?.ammo || 0,
      lov: d.lov,
      sil: 3,
      har: 1,
      ap: d.ap,
      maxAp: d.ap,
      stress: 0,
      skills: { shooting: d.tags.includes("disciplined") ? 3 : 1, melee: d.tags.includes("beast") ? 2 : 1, medicine: 0 },
      cd: 0,
      st: {},
      down: false,
      dead: false,
      fled: false,
      tags: d.tags,
      color: d.color,
      icon: d.icon,
      traits: [],
      items: {},
      nvg: d.tags.includes("machine") || d.tags.includes("beast"),
    };
  }
  const st = init.stats ?? { sil: 2, lov: 2, int: 2, vyn: 2, har: 2 };
  const maxHp = init.maxHp ?? 12 + st.vyn * 4;
  const w = WEAPONS[init.weapon ?? "fists"] ?? WEAPONS.fists;
  return {
    id: init.id,
    side: "ally",
    name: init.name,
    char: init.char,
    col: init.col,
    floor: init.floor,
    hp: Math.max(1, Math.round(maxHp * (init.hpFrac ?? 1))),
    maxHp,
    armor: init.armor ?? 0,
    weapon: init.weapon ?? "fists",
    ammo: init.ammo ?? w.ammo,
    maxAmmo: w.ammo,
    lov: st.lov,
    sil: st.sil,
    har: st.har,
    ap: 3,
    maxAp: 3,
    stress: 0,
    skills: init.skills ?? { shooting: 1, melee: 1, medicine: 1 },
    ability: init.ability,
    cd: 0,
    st: {},
    down: false,
    dead: false,
    fled: false,
    tags: init.tags ?? ["human"],
    color: init.color ?? 0x888888,
    icon: init.icon ?? "",
    traits: init.traits ?? [],
    items: { ...(init.items ?? {}) },
    nvg: !!init.nvg,
  };
}

export function createCombat(field: Field, allies: UnitInit[], enemies: UnitInit[], seed: number, opts: { coordination?: number; where?: string } = {}): CombatState {
  const s: CombatState = {
    round: 1,
    phase: "plan",
    rng: seedState(seed),
    field,
    units: {},
    plans: {},
    ready: {},
    events: [],
    result: null,
    log: [],
    dark: 0,
    fires: [],
    trips: [],
    coordination: opts.coordination ?? 0,
    hitBonus: 0,
    where: opts.where ?? "arena",
  };
  for (const a of [...allies, ...enemies]) s.units[a.id] = makeUnit(a);
  for (const u of Object.values(s.units)) if (u.side === "ally") u.ap = u.maxAp + s.coordination;
  planEnemies(s);
  return s;
}

// ================================================================ planning & validation

export function abilityInfo(u: Unit) {
  return u.ability ? ABILITIES[u.ability] : undefined;
}

interface Sim {
  col: number;
  floor: number;
  ap: number;
  ammo: number;
  cd: number;
  items: Record<string, number>;
}

/** Validates a plan for a unit. Returns error text or null. Also returns the resulting simulated position. */
export function validatePlan(s: CombatState, uid: string, actions: Action[]): string | null {
  const u = s.units[uid];
  if (!u || !alive(u)) return "Боец не может действовать";
  if (actions.length > 8) return "Слишком много действий";
  const sim: Sim = { col: u.col, floor: u.floor, ap: u.ap, ammo: u.ammo, cd: u.cd, items: { ...u.items } };
  for (const a of actions) {
    const e = stepSim(s, u, sim, a);
    if (e) return e;
  }
  return null;
}

function stepSim(s: CombatState, u: Unit, sim: Sim, a: Action): string | null {
  const fake = { ...u, col: sim.col, floor: sim.floor } as Unit;
  const w = weaponOf(u);
  const target = "target" in a && a.target ? s.units[a.target] : undefined;
  let cost = 0;
  switch (a.t) {
    case "move": {
      if (u.tags.includes("static")) return "Не может двигаться";
      const p = pathTo(s, fake, a.col, a.floor);
      if (!p) return "Туда не пройти";
      cost = moveCost(p.length);
      sim.col = a.col;
      sim.floor = a.floor;
      break;
    }
    case "shoot": {
      if (!target || target.side === u.side) return "Нет цели";
      if (w.range <= 1) return "Это оружие ближнего боя";
      if (w.ammo > 0 && sim.ammo <= 0) return "Нет патронов — перезарядка";
      cost = w.ap + (a.aimed ? 1 : 0);
      if (w.ammo > 0) sim.ammo--;
      break;
    }
    case "melee":
    case "shove":
      if (!target || target.side === u.side) return "Нет цели";
      cost = a.t === "melee" && w.range <= 1 ? w.ap : 1;
      break;
    case "reload":
      if (w.ammo <= 0) return "Нечего перезаряжать";
      cost = 1;
      sim.ammo = w.ammo;
      break;
    case "heal":
      if ((sim.items.medkit ?? 0) <= 0 && (sim.items.meds ?? 0) <= 0) return "Нет аптечки";
      if (!target || target.side !== u.side) return "Нет цели";
      cost = 2;
      if (sim.items.medkit) sim.items.medkit--;
      else sim.items.meds--;
      break;
    case "throw":
      if ((sim.items.molotov ?? 0) <= 0) return "Нечего бросать";
      cost = 2;
      sim.items.molotov--;
      if (Math.abs(a.col - sim.col) > 5 || Math.abs(a.floor - sim.floor) > 1) return "Слишком далеко";
      break;
    case "ability": {
      const ab = abilityInfo(u);
      if (!ab) return "Нет навыка";
      if (sim.cd > 0) return "Навык перезаряжается";
      cost = ab.ap;
      sim.cd = ab.cd;
      break;
    }
    case "hunker":
    case "overwatch":
      cost = a.t === "hunker" ? 1 : 0;
      break;
    case "door":
      if (Math.abs(a.col - sim.col) > 1 || a.floor !== sim.floor || !doorAt(s.field, a.col, a.floor)) return "Двери рядом нет";
      cost = 1;
      break;
    case "flee":
      if (!s.field.exits.some((e) => e.col === sim.col && e.floor === sim.floor)) return "Бежать можно только от выхода";
      cost = 1;
      break;
    case "steal":
      cost = 1;
      break;
  }
  if (cost > sim.ap) return "Не хватает ОД";
  sim.ap -= cost;
  return null;
}

export function submitPlan(s: CombatState, uid: string, actions: Action[]): string | null {
  if (s.phase !== "plan") return "Сейчас не фаза плана";
  const err = validatePlan(s, uid, actions);
  if (err) return err;
  s.plans[uid] = actions;
  return null;
}

// ================================================================ AI

function nearest(s: CombatState, u: Unit, side: "ally" | "enemy", pred: (o: Unit) => boolean = () => true): Unit | undefined {
  let best: Unit | undefined,
    bd = 1e9;
  for (const o of Object.values(s.units)) {
    if (o.side !== side || !alive(o) || o.st.hidden || !pred(o)) continue;
    const d = Math.abs(o.col - u.col) + Math.abs(o.floor - u.floor) * 4;
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return best;
}

/** Moves along a path spending at most `ap`, returns the move action or null. */
function approach(s: CombatState, u: Unit, t: { col: number; floor: number }, ap: number, stopDist = 1): Action | null {
  // find a path to a cell adjacent to target
  const f = s.field;
  let best: { col: number; floor: number; n: number } | null = null;
  for (const dc of [-stopDist, stopDist, -1, 1, 0]) {
    const c = t.col + dc;
    if (!walkableF(f, c, t.floor)) continue;
    const p = pathTo(s, u, c, t.floor);
    if (p && (!best || p.length < best.n)) best = { col: c, floor: t.floor, n: p.length };
  }
  if (!best) {
    // try generic path to the target cell
    const p = pathTo(s, u, t.col, t.floor);
    if (!p) return null;
    best = { col: t.col, floor: t.floor, n: p.length };
  }
  const p = pathTo(s, u, best.col, best.floor)!;
  let steps = p.length;
  while (steps > 0 && moveCost(steps) > ap) steps--;
  if (steps <= 0) return null;
  const dst = p[steps - 1];
  return { t: "move", col: dst.col, floor: dst.floor };
}

/** Enemy intent for the coming round (announced during planning). */
export function enemyPlan(s: CombatState, u: Unit): { actions: Action[]; text: string } {
  const R = new Rng(s.rng);
  const w = weaponOf(u);
  let ap = u.ap;
  const acts: Action[] = [];
  const allies = Object.values(s.units).filter((o) => o.side === "ally" && alive(o) && !o.st.hidden);
  if (!allies.length) return { actions: [], text: "ждёт" };
  // non-fanatic humans flee when badly hurt
  if (u.hp <= u.maxHp * 0.25 && u.tags.includes("human") && !u.tags.includes("fanatic") && !u.tags.includes("disciplined") && R.chance(0.5)) {
    const exit = s.field.exits[0];
    if (exit) {
      const mv = approach(s, u, exit, ap, 0);
      return { actions: mv ? [mv, { t: "flee" }] : [{ t: "hunker" }], text: "пытается сбежать" };
    }
  }
  // raiders with loot run for the exit
  if (u.carried && Object.keys(u.carried).length) {
    const exit = s.field.exits[0];
    const mv = exit ? approach(s, u, exit, ap, 0) : null;
    return { actions: mv ? [mv, { t: "flee" }] : [{ t: "hunker" }], text: "уносит добычу!" };
  }
  // pick a target: weakest in reach, else nearest
  const target0: Unit | undefined = allies.filter((a) => a.floor === u.floor && lineOfFire(s, u, a) && Math.abs(a.col - u.col) <= w.range).sort((a, b) => a.hp - b.hp)[0] ?? nearest(s, u, "ally");
  if (!target0) return { actions: [], text: "ждёт" };
  const target: Unit = target0;
  // leader buffs
  if (u.tags.includes("leader") && R.chance(0.35)) return { actions: [{ t: "ability", target: u.id }], text: "подбадривает своих (+1 ОД)" };
  // looters in bunker raids go for storage
  if (s.where === "bunker" && u.tags.includes("human") && s.field.loot.length && R.chance(0.35)) {
    const spot = s.field.loot[0];
    if (u.col === spot.col && u.floor === spot.floor) return { actions: [{ t: "steal" }, { t: "hunker" }], text: "грабит кладовую!" };
    const mv = approach(s, u, spot, ap, 0);
    if (mv) return { actions: [mv], text: "идёт к кладовой" };
  }
  // bomber throws fire
  if (u.weapon === "molotov") {
    if (Math.abs(target.col - u.col) <= 5 && Math.abs(target.floor - u.floor) <= 1 && ap >= 2) return { actions: [{ t: "throw", col: target.col, floor: target.floor }], text: `бросит огонь в ${target.name}` };
  }
  const inRange = () => target.floor === u.floor && lineOfFire(s, u, target) && Math.abs(target.col - u.col) <= w.range;
  if (!inRange()) {
    const stop = w.range > 1 ? Math.min(w.range - 1, 4) : 1;
    const mv = approach(s, u, target, u.tags.includes("breaker") ? ap : ap - (w.range > 1 ? w.ap : 0), stop);
    if (mv) {
      acts.push(mv);
      const p = pathTo(s, u, (mv as any).col, (mv as any).floor);
      ap -= moveCost(p?.length ?? 0);
    } else if (!u.tags.includes("flying")) {
      // blocked: go for the nearest closed door on this floor and open or bash it
      const d = s.field.doors
        .filter((d) => d.closed && Math.abs(d.floor - u.floor) <= 1)
        .sort((a, b) => Math.abs(a.col - u.col) + Math.abs(a.floor - u.floor) * 3 - (Math.abs(b.col - u.col) + Math.abs(b.floor - u.floor) * 3))[0];
      if (d) {
        const adjacent = (d.floor === u.floor && Math.abs(d.col - u.col) <= 1) || (d.col === u.col && Math.abs(d.floor - u.floor) === 1);
        if (adjacent) {
          const n = Math.min(3, ap);
          return { actions: Array.from({ length: n }, () => ({ t: "door", col: d.col, floor: d.floor }) as Action), text: d.barricaded || u.tags.includes("breaker") ? "ломает дверь!" : "вскрывает дверь" };
        }
        const spot = d.floor === u.floor ? { col: d.col + (u.col < d.col ? -1 : 1), floor: d.floor } : { col: d.col, floor: u.floor };
        const p = pathTo(s, u, spot.col, spot.floor);
        if (p?.length) {
          let steps = p.length;
          while (steps > 0 && moveCost(steps) > ap) steps--;
          if (steps > 0) {
            const mvAp = moveCost(steps);
            const acts2: Action[] = [{ t: "move", col: p[steps - 1].col, floor: p[steps - 1].floor }];
            if (steps === p.length) for (let k = 0; k < ap - mvAp; k++) acts2.push({ t: "door", col: d.col, floor: d.floor });
            return { actions: acts2, text: "идёт к двери" };
          }
        }
      }
    }
  }
  const moved = acts.length ? { ...u, col: (acts[0] as any).col, floor: (acts[0] as any).floor } : u;
  const canHit = target.floor === moved.floor && lineOfFire(s, moved as Unit, target) && Math.abs(target.col - moved.col) <= w.range;
  if (canHit) {
    if (w.ammo > 0 && u.ammo <= 0 && ap >= 1) {
      acts.push({ t: "reload" });
      ap -= 1;
    }
    let attacks = 0;
    while (ap >= w.ap && acts.length < 4 && attacks++ < (w.range > 1 ? 3 : 2)) {
      acts.push(w.range > 1 ? { t: "shoot", target: target.id, aimed: u.etype === "sniper" && ap >= w.ap + 1 } : { t: "melee", target: target.id });
      ap -= w.ap + (u.etype === "sniper" ? 1 : 0);
      if (w.range > 1 && u.ammo - acts.filter((a) => a.t === "shoot").length <= 0) break;
    }
    return { actions: acts, text: `${w.range > 1 ? "стреляет в" : "атакует"} ${target.name}` };
  }
  if (ap >= 1 && !acts.length) acts.push({ t: "hunker" });
  return { actions: acts, text: acts.length && acts[0].t === "move" ? `идёт к ${target.name}` : "укрывается" };
}

export function planEnemies(s: CombatState) {
  for (const u of Object.values(s.units)) {
    if (u.side !== "enemy" || !alive(u)) continue;
    const p = enemyPlan(s, u);
    u.intent = p.actions;
    u.intentText = p.text;
  }
}

/** Simple plan for bot-controlled allies (NPCs, auto-defense, AFK players). */
export function allyBotPlan(s: CombatState, u: Unit): Action[] {
  const w = weaponOf(u);
  const acts: Action[] = [];
  let ap = u.ap;
  // heal a downed neighbour
  const downAlly = Object.values(s.units).find((o) => o.side === "ally" && o.down && !o.dead && o.floor === u.floor && Math.abs(o.col - u.col) <= 1);
  if (downAlly && ((u.items.medkit ?? 0) > 0 || (u.items.meds ?? 0) > 0) && ap >= 2) return [{ t: "heal", target: downAlly.id }];
  const enemy = Object.values(s.units)
    .filter((o) => o.side === "enemy" && alive(o))
    .sort((a, b) => Math.abs(a.col - u.col) + Math.abs(a.floor - u.floor) * 4 - (Math.abs(b.col - u.col) + Math.abs(b.floor - u.floor) * 4))[0];
  if (!enemy) return [];
  if (u.ability && u.cd <= 0) {
    const ab = ABILITIES[u.ability];
    if (ab.target === "none" && ap >= ab.ap) {
      acts.push({ t: "ability" });
      ap -= ab.ap;
    } else if (ab.target === "enemy" && ap >= ab.ap && enemy.floor === u.floor && Math.abs(enemy.col - u.col) <= (u.ability === "pitchfork" ? 2 : u.ability === "kitchen_knife" ? 1 : 8)) {
      acts.push({ t: "ability", target: enemy.id });
      ap -= ab.ap;
    }
  }
  const reach = () => enemy.floor === u.floor && lineOfFire(s, u, enemy) && Math.abs(enemy.col - u.col) <= w.range;
  if (!reach() && !u.tags.includes("static")) {
    const mv = approach(s, u, enemy, Math.max(1, ap - w.ap), w.range > 1 ? Math.min(3, w.range) : 1);
    if (mv) {
      const p = pathTo(s, u, (mv as any).col, (mv as any).floor);
      ap -= moveCost(p?.length ?? 1);
      acts.push(mv);
    }
  }
  const pos = acts.find((a) => a.t === "move") as any;
  const me = pos ? ({ ...u, col: pos.col, floor: pos.floor } as Unit) : u;
  if (enemy.floor === me.floor && lineOfFire(s, me, enemy) && Math.abs(enemy.col - me.col) <= w.range) {
    let ammo = u.ammo;
    while (ap >= w.ap) {
      if (w.ammo > 0 && ammo <= 0) {
        if (ap >= 1) {
          acts.push({ t: "reload" });
          ap--;
          ammo = w.ammo;
          continue;
        }
        break;
      }
      acts.push(w.range > 1 ? { t: "shoot", target: enemy.id } : { t: "melee", target: enemy.id });
      ap -= w.ap;
      if (w.ammo > 0) ammo--;
    }
  } else if (ap >= 1) acts.push({ t: "hunker" });
  return validatePlan(s, u.id, acts) ? [{ t: "hunker" }] : acts;
}

// ================================================================ resolution

function ev(s: CombatState, e: CEvent) {
  s.events.push(e);
}

function addStress(s: CombatState, u: Unit, n: number) {
  if (u.side !== "ally" || u.tags.includes("fanatic")) return;
  u.stress = Math.min(120, Math.max(0, u.stress + n));
  if (u.stress >= 100 && !u.st.panic) {
    u.st.panic = 2;
    ev(s, { u: u.id, k: "text", text: `${u.name} паникует!` });
    s.log.push(`${u.name} паникует!`);
  }
}

export function damage(s: CombatState, t: Unit, amount: number, from?: Unit, opts: { bleed?: boolean; burn?: boolean; pierce?: boolean } = {}) {
  const R = new Rng(s.rng);
  const dmg = Math.max(1, amount - (opts.pierce ? 0 : t.armor));
  t.hp -= dmg;
  if (opts.bleed) t.st.bleed = 2;
  if (opts.burn) t.st.burn = 2;
  addStress(s, t, 6);
  for (const o of Object.values(s.units)) if (o.side === t.side && o.id !== t.id && alive(o)) addStress(s, o, 2);
  if (t.hp <= 0) {
    if (t.down) {
      t.dead = true;
      ev(s, { u: t.id, k: "dead" });
      s.log.push(`${t.name} погибает.`);
    } else if (t.side === "ally") {
      t.down = true;
      t.hp = 0;
      ev(s, { u: t.id, k: "down" });
      s.log.push(`${t.name} падает без сознания!`);
      for (const o of Object.values(s.units)) if (o.side === "ally" && alive(o)) addStress(s, o, 12);
    } else {
      // humans may surrender when dropped; beasts and machines die
      if (t.tags.includes("human") && !t.tags.includes("fanatic") && R.chance(0.4)) {
        t.down = true;
        t.captured = true;
        ev(s, { u: t.id, k: "down", text: "сдаётся" });
        s.log.push(`${t.name} сдаётся!`);
      } else {
        t.dead = true;
        ev(s, { u: t.id, k: "dead" });
        s.log.push(`${t.name} повержен.`);
      }
    }
  }
  void from;
  return dmg;
}

function attack(s: CombatState, a: Unit, t: Unit, aimed = false, part?: string, reaction = false) {
  const R = new Rng(s.rng);
  const w = weaponOf(a);
  const ch = hitChance(s, a, t, aimed, part);
  const roll = R.int(1, 100);
  const hit = roll <= ch;
  if (w.ammo > 0) a.ammo = Math.max(0, a.ammo - 1);
  if (!hit) {
    ev(s, { u: a.id, k: w.range > 1 ? "shoot" : "melee", to: t.id, hit: false, text: reaction ? "перехват" : undefined });
    addStress(s, a, 3);
    return;
  }
  let dmg = R.int(w.dmg[0], w.dmg[1]);
  if (w.falloff && Math.abs(a.col - t.col) > 1) dmg = Math.round(dmg * 0.6);
  if (w.range <= 1) dmg += Math.max(0, a.sil - 2);
  const crit = R.chance(0.08 + (w.range > 1 ? a.skills.shooting : a.skills.melee) * 0.02);
  if (crit) dmg = Math.round(dmg * 1.5);
  if (part === "head") dmg = Math.round(dmg * 1.5);
  const done = damage(s, t, dmg, a, { bleed: w.bleed });
  if (part === "legs") t.st.slowed = 1;
  if (part === "arms") t.st.aimDebuff = 1;
  ev(s, { u: a.id, k: w.range > 1 ? "shoot" : "melee", to: t.id, hit: true, dmg: done, crit, text: reaction ? "перехват" : undefined });
  // cover degrades
  const cov = coverAt(s.field, t.col, t.floor);
  if (cov && w.range > 1) cov.hp -= 1;
}

function reactions(s: CombatState, mover: Unit) {
  for (const o of Object.values(s.units)) {
    if (o.side === mover.side || !alive(o) || !o.st.overwatch) continue;
    const w = weaponOf(o);
    if (o.ap < w.ap) continue;
    if (mover.floor === o.floor && Math.abs(mover.col - o.col) <= w.range && lineOfFire(s, o, mover)) {
      o.st.overwatch = 0;
      o.ap -= w.ap;
      attack(s, o, mover, false, undefined, true);
    }
  }
}

function execAction(s: CombatState, u: Unit, a: Action): boolean {
  if (!alive(u)) return false;
  const R = new Rng(s.rng);
  const w = weaponOf(u);
  const tgt = "target" in a && a.target ? s.units[a.target] : undefined;
  switch (a.t) {
    case "move": {
      const p = pathTo(s, u, a.col, a.floor);
      if (!p) return false;
      const cost = moveCost(p.length);
      if (cost > u.ap) return false;
      u.ap -= cost;
      for (const step of p) {
        u.col = step.col;
        u.floor = step.floor;
        ev(s, { u: u.id, k: "move", col: u.col, floor: u.floor });
        // tripwires
        const ti = s.trips.findIndex((t) => t.col === u.col && t.floor === u.floor);
        if (ti >= 0 && u.side === "enemy") {
          s.trips.splice(ti, 1);
          ev(s, { u: u.id, k: "fire", col: u.col, floor: u.floor, text: "растяжка!" });
          damage(s, u, 6, undefined, { pierce: true });
          if (!alive(u)) return false;
        }
        reactions(s, u);
        if (!alive(u)) return false;
      }
      return true;
    }
    case "shoot":
    case "melee": {
      const t = tgt;
      if (!t || !alive(t) || t.st.hidden) {
        // target gone → overwatch with the remaining AP
        u.st.overwatch = 1;
        ev(s, { u: u.id, k: "text", text: "цель потеряна — в ожидании" });
        return false;
      }
      const cost = a.t === "shoot" ? w.ap + (a.aimed ? 1 : 0) : w.range <= 1 ? w.ap : 1;
      if (cost > u.ap) return false;
      const inReach = a.t === "shoot" ? t.floor === u.floor && Math.abs(t.col - u.col) <= w.range && lineOfFire(s, u, t) : t.floor === u.floor && Math.abs(t.col - u.col) <= 1;
      if (!inReach) {
        u.st.overwatch = 1;
        ev(s, { u: u.id, k: "text", text: "не достать — в ожидании" });
        return false;
      }
      if (w.ammo > 0 && a.t === "shoot" && u.ammo <= 0) return false;
      u.ap -= cost;
      if (a.t === "melee" && w.range > 1) {
        // bash with the weapon
        const hit = R.chance(hitChance(s, { ...u, weapon: "fists" } as Unit, t) / 100);
        ev(s, { u: u.id, k: "melee", to: t.id, hit, dmg: hit ? 2 : 0 });
        if (hit) damage(s, t, 2 + Math.max(0, u.sil - 2), u);
        return true;
      }
      attack(s, u, t, a.t === "shoot" && a.aimed, a.t === "shoot" ? a.part : undefined);
      return true;
    }
    case "shove": {
      if (!tgt || !alive(tgt) || tgt.floor !== u.floor || Math.abs(tgt.col - u.col) > 1 || u.ap < 1) return false;
      u.ap -= 1;
      const dir = Math.sign(tgt.col - u.col) || 1;
      if (walkableF(s.field, tgt.col + dir, tgt.floor) && !blocked(s, tgt.col + dir, tgt.floor)) tgt.col += dir;
      ev(s, { u: u.id, k: "melee", to: tgt.id, hit: true, dmg: 0, text: "толчок" });
      return true;
    }
    case "reload":
      if (u.ap < 1) return false;
      u.ap -= 1;
      u.ammo = w.ammo;
      ev(s, { u: u.id, k: "text", text: "перезаряжается" });
      return true;
    case "heal": {
      if (!tgt || tgt.dead || tgt.floor !== u.floor || Math.abs(tgt.col - u.col) > 1 || u.ap < 2) return false;
      if ((u.items.medkit ?? 0) > 0) u.items.medkit--;
      else if ((u.items.meds ?? 0) > 0) u.items.meds--;
      else return false;
      u.ap -= 2;
      const amt = 5 + u.skills.medicine * 2;
      tgt.hp = Math.min(tgt.maxHp, Math.max(tgt.hp, 0) + amt);
      if (tgt.down) {
        tgt.down = false;
        tgt.hp = Math.max(tgt.hp, 3);
      }
      tgt.st.bleed = 0;
      ev(s, { u: u.id, k: "heal", to: tgt.id, dmg: amt });
      return true;
    }
    case "throw":
      if (u.ap < 2 || (u.items.molotov ?? 0) <= 0) return false;
      u.ap -= 2;
      u.items.molotov--;
      ignite(s, u, a.col, a.floor);
      return true;
    case "ability":
      return useAbility(s, u, a);
    case "hunker":
      if (u.ap < 1) return false;
      u.ap -= 1;
      u.st.hunker = 1;
      ev(s, { u: u.id, k: "text", text: "укрывается" });
      return true;
    case "overwatch":
      u.st.overwatch = 1;
      ev(s, { u: u.id, k: "text", text: "в ожидании" });
      return true;
    case "door": {
      const d = doorAt(s.field, a.col, a.floor);
      if (!d || u.ap < 1) return false;
      u.ap -= 1;
      if (u.side === "enemy" && d.closed) {
        d.hp -= u.tags.includes("breaker") ? 6 : u.tags.includes("beast") ? 2 : 3;
        if (d.hp <= 0) {
          d.closed = false;
          d.barricaded = false;
          ev(s, { u: u.id, k: "door", col: d.col, floor: d.floor, text: "выбита!" });
        } else ev(s, { u: u.id, k: "door", col: d.col, floor: d.floor, text: "ломится в дверь" });
        return true;
      }
      if (u.side === "enemy" && !d.closed) return false;
      d.closed = !d.closed;
      ev(s, { u: u.id, k: "door", col: d.col, floor: d.floor, text: d.closed ? "закрывает дверь" : "открывает дверь" });
      return true;
    }
    case "flee":
      if (!s.field.exits.some((e) => e.col === u.col && e.floor === u.floor)) return false;
      if (u.side === "ally" && !R.chance(0.55 + u.lov * 0.08)) {
        ev(s, { u: u.id, k: "text", text: "не успевает сбежать" });
        u.ap = 0;
        return false;
      }
      u.fled = true;
      ev(s, { u: u.id, k: "flee" });
      s.log.push(`${u.name} уходит с поля боя.`);
      return true;
    case "steal": {
      const spot = s.field.loot.find((l) => l.col === u.col && l.floor === u.floor);
      if (!spot || u.ap < 1) return false;
      u.ap -= 1;
      u.carried ??= {};
      u.carried.__steal = (u.carried.__steal ?? 0) + 1;
      ev(s, { u: u.id, k: "text", text: "грабит!" });
      return true;
    }
  }
  return false;
}

function ignite(s: CombatState, u: Unit, col: number, floor: number) {
  ev(s, { u: u.id, k: "fire", col, floor });
  for (const c of [col, col + 1]) {
    s.fires.push({ col: c, floor, turns: 2 });
    for (const o of Object.values(s.units)) if (alive(o) && o.col === c && o.floor === floor) damage(s, o, 3, u, { burn: true, pierce: true });
  }
}

function useAbility(s: CombatState, u: Unit, a: Extract<Action, { t: "ability" }>): boolean {
  const R = new Rng(s.rng);
  const tgt = a.target ? s.units[a.target] : undefined;
  if (u.side === "enemy") {
    // leader: allies get +1 AP next round
    if (u.ap < 1) return false;
    u.ap -= 1;
    for (const o of Object.values(s.units)) if (o.side === "enemy" && alive(o)) o.st.bonusHit = 1;
    ev(s, { u: u.id, k: "ability", text: "«Вперёд, парни!»" });
    return true;
  }
  const ab = abilityInfo(u);
  if (!ab || u.cd > 0 || u.ap < ab.ap) return false;
  u.ap -= ab.ap;
  u.cd = ab.cd + 1;
  ev(s, { u: u.id, k: "ability", to: tgt?.id, text: ab.name });
  s.log.push(`${u.name}: ${ab.name}`);
  switch (u.ability) {
    case "suppress":
      if (tgt && alive(tgt)) tgt.st.suppressed = 1;
      break;
    case "surgery":
      if (tgt && !tgt.dead && tgt.floor === u.floor && Math.abs(tgt.col - u.col) <= 1) {
        tgt.hp = Math.min(tgt.maxHp, Math.max(0, tgt.hp) + 8);
        tgt.down = false;
        tgt.st.bleed = 0;
      }
      break;
    case "turret":
      s.trips.push({ col: a.col ?? u.col + 1, floor: a.floor ?? u.floor });
      break;
    case "molotov":
      ignite(s, u, a.col ?? tgt?.col ?? u.col + 2, a.floor ?? tgt?.floor ?? u.floor);
      break;
    case "kitchen_knife":
      if (tgt && alive(tgt) && tgt.floor === u.floor && Math.abs(tgt.col - u.col) <= 1) damage(s, tgt, R.int(3, 5), u, { bleed: true });
      break;
    case "inspire":
      for (const o of Object.values(s.units)) if (o.side === "ally" && !o.dead) ((o.stress = Math.max(0, o.stress - 30)), (o.st.panic = 0));
      break;
    case "negotiate":
      if (tgt && alive(tgt) && !tgt.tags.includes("fanatic") && !tgt.tags.includes("machine") && !tgt.tags.includes("beast")) {
        if (R.chance(0.25 + u.har * 0.08 - (tgt.hp / tgt.maxHp) * 0.15)) {
          if (R.chance(0.5)) {
            tgt.fled = true;
            ev(s, { u: tgt.id, k: "flee", text: "сбегает после переговоров" });
          } else {
            tgt.captured = true;
            tgt.down = true;
            ev(s, { u: tgt.id, k: "down", text: "сдаётся" });
          }
        } else ev(s, { u: u.id, k: "text", text: "переговоры не удались" });
      }
      break;
    case "breach": {
      const c = a.col ?? u.col + 1,
        f = a.floor ?? u.floor;
      const cov = coverAt(s.field, c, f);
      if (cov) cov.hp = 0;
      const d = doorAt(s.field, c, f);
      if (d) d.closed = false;
      for (const o of Object.values(s.units)) if (o.side === "enemy" && alive(o) && o.floor === u.floor && Math.abs(o.col - u.col) <= 1) o.st.slowed = 1;
      break;
    }
    case "blackout":
      s.dark = 2;
      for (const o of Object.values(s.units)) if (o.side === "enemy" && alive(o) && o.tags.includes("machine")) damage(s, o, 6, u, { pierce: true });
      break;
    case "call_support": {
      const targets = Object.values(s.units).filter((o) => o.side === "enemy" && alive(o)).slice(0, 2);
      for (const t of targets) damage(s, t, 5, u, { pierce: true });
      break;
    }
    case "inspire_lesson":
      s.hitBonus = 15;
      for (const o of Object.values(s.units)) if (o.side === "ally" && !o.dead) o.stress = Math.max(0, o.stress - 10);
      break;
    case "pitchfork":
      if (tgt && alive(tgt) && tgt.floor === u.floor && Math.abs(tgt.col - u.col) <= 2) damage(s, tgt, R.int(4, 6), u);
      break;
    case "hide":
      u.st.hidden = 1;
      break;
  }
  return true;
}

/** Everybody submitted (or the timer ran out): resolve the round. `autoPlan` fills plans for units without one. */
export function resolveRound(s: CombatState, autoPlan: (u: Unit) => Action[] = (u) => allyBotPlan(s, u)) {
  if (s.phase !== "plan") return;
  s.events = [];
  const R = new Rng(s.rng);
  // fill missing ally plans
  for (const u of Object.values(s.units)) if (u.side === "ally" && alive(u) && !s.plans[u.id]) s.plans[u.id] = autoPlan(u);
  // panic: random action instead of the plan
  for (const u of Object.values(s.units)) {
    if (u.side !== "ally" || !u.st.panic || !alive(u)) continue;
    if (u.traits.includes("coward") && R.chance(0.35) && s.field.exits.length) {
      const exit = s.field.exits[0];
      const mv = approach(s, u, exit, u.ap, 0);
      s.plans[u.id] = mv ? [mv, { t: "flee" }] : [{ t: "hunker" }];
    } else s.plans[u.id] = R.chance(0.5) ? [{ t: "hunker" }] : [];
    ev(s, { u: u.id, k: "text", text: "в панике!" });
  }
  // plans are simultaneous: a planned overwatch is armed from the very start of the round
  for (const u of Object.values(s.units)) if (u.side === "ally" && alive(u) && s.plans[u.id]?.[0]?.t === "overwatch") u.st.overwatch = 1;
  // initiative
  const order = Object.values(s.units)
    .filter((u) => alive(u))
    .map((u) => ({ u, init: u.lov + R.int(1, 6) + (u.tags.includes("pack") ? 2 : 0) }))
    .sort((a, b) => b.init - a.init || (a.u.id < b.u.id ? -1 : 1));
  for (const { u } of order) {
    if (!alive(u)) continue;
    const plan = u.side === "ally" ? (s.plans[u.id] ?? []) : (u.intent ?? []);
    for (const a of plan) {
      if (!alive(u)) break;
      const ok = execAction(s, u, a);
      if (!ok && (a.t === "shoot" || a.t === "melee")) {
        // retarget enemies automatically; allies go on overwatch
        if (u.side === "enemy") {
          const t = nearest(s, u, "ally");
          const w = weaponOf(u);
          if (t && t.floor === u.floor && Math.abs(t.col - u.col) <= w.range && lineOfFire(s, u, t) && u.ap >= w.ap) attack(s, u, t);
        }
      }
      if (checkEnd(s)) break;
    }
    if (checkEnd(s)) break;
  }
  endOfRound(s);
}

function checkEnd(s: CombatState): boolean {
  const allies = Object.values(s.units).filter((u) => u.side === "ally");
  const enemies = Object.values(s.units).filter((u) => u.side === "enemy");
  if (!enemies.some(alive)) {
    s.result = "win";
    return true;
  }
  if (!allies.some(alive)) {
    s.result = allies.some((u) => u.fled) && !allies.some((u) => u.down && !u.dead) ? "fled" : "lose";
    return true;
  }
  return false;
}

function endOfRound(s: CombatState) {
  // damage over time, fires, auras
  for (const u of Object.values(s.units)) {
    if (u.dead || u.fled) continue;
    if (u.st.bleed && !u.down) {
      damage(s, u, 1, undefined, { pierce: true });
      u.st.bleed--;
    }
    if (u.st.burn && !u.down) {
      damage(s, u, 2, undefined, { pierce: true });
      u.st.burn--;
    }
    if (s.fires.some((f) => f.col === u.col && f.floor === u.floor) && alive(u)) damage(s, u, 2, undefined, { burn: true, pierce: true });
    if (u.side === "enemy" && u.tags.includes("aura") && alive(u)) {
      for (const o of Object.values(s.units)) if (o.side === "ally" && alive(o) && o.floor === u.floor && Math.abs(o.col - u.col) <= 1) (o.items.__rad = (o.items.__rad ?? 0) + 6);
    }
  }
  s.fires = s.fires.map((f) => ({ ...f, turns: f.turns - 1 })).filter((f) => f.turns > 0);
  if (s.dark > 0) s.dark--;
  s.hitBonus = 0;
  checkEnd(s);
  if (s.result) {
    s.phase = "over";
    return;
  }
  s.round++;
  s.plans = {};
  s.ready = {};
  for (const u of Object.values(s.units)) {
    if (!alive(u)) continue;
    u.ap = u.maxAp - (u.st.slowed ? 1 : 0) - (u.st.suppressed ? 1 : 0) + (u.st.bonusHit && u.side === "enemy" ? 1 : 0);
    u.st.slowed = 0;
    u.st.suppressed = 0;
    u.st.aimDebuff = 0;
    u.st.hunker = 0;
    u.st.overwatch = 0;
    u.st.bonusHit = 0;
    if (u.st.hidden) u.st.hidden = 0;
    if (u.st.panic) u.st.panic--;
    if (u.cd > 0) u.cd--;
    if (u.side === "ally" && !u.st.panic) u.stress = Math.max(0, u.stress - 8);
    if (u.side === "ally" && u.st.panic === 0 && u.stress >= 100) u.stress = 70;
  }
  planEnemies(s);
}

/** Combat balance summary for the UI. */
export function unitSummary(u: Unit): Unit {
  return { ...u, stress: Math.round(u.stress) };
}
