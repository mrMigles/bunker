import { describe, expect, it } from "vitest";
import { unitAlive as alive, allyBotPlan, createCombat, hitChance, lineOfFire, makeArena, moveCost, resolveRound, submitPlan, validatePlan, type CombatState, type UnitInit } from "../src/index";

const ally = (id: string, col: number, extra: Partial<UnitInit> = {}): UnitInit => ({ id, side: "ally", name: id, col, floor: 0, weapon: "pistol", stats: { sil: 3, lov: 3, int: 3, vyn: 3, har: 3 }, skills: { shooting: 2, melee: 1, medicine: 1 }, items: { medkit: 1 }, ...extra });
const enemy = (id: string, col: number, etype = "marauder", floor = 0): UnitInit => ({ id, side: "enemy", name: id, col, floor, etype });

function runToEnd(s: CombatState, maxRounds = 60) {
  while (s.phase === "plan" && s.round <= maxRounds) {
    for (const u of Object.values(s.units)) if (u.side === "ally" && alive(u)) submitPlan(s, u.id, allyBotPlan(s, u));
    resolveRound(s);
  }
  return s;
}

describe("combat", () => {
  it("move costs: 1 step = 1 AP, 3 steps = 2 AP", () => {
    expect(moveCost(1)).toBe(1);
    expect(moveCost(3)).toBe(2);
    expect(moveCost(4)).toBe(3);
  });

  it("validates plans: AP budget and reachable cells", () => {
    const s = createCombat(makeArena(1), [ally("a", 1)], [enemy("e", 12)], 1);
    expect(validatePlan(s, "a", [{ t: "move", col: 4, floor: 0 }])).toBeNull();
    expect(validatePlan(s, "a", [{ t: "move", col: 9, floor: 0 }])).toMatch(/ОД/);
    expect(validatePlan(s, "a", [{ t: "shoot", target: "e" }, { t: "shoot", target: "e" }, { t: "shoot", target: "e" }, { t: "shoot", target: "e" }])).toMatch(/ОД/);
    expect(validatePlan(s, "a", [{ t: "melee", target: "a" }])).toBeTruthy();
  });

  it("cover lowers hit chance, line of fire needs the same floor", () => {
    const f = makeArena(2);
    f.covers = [{ col: 8, floor: 0, kind: "full", hp: 5 }];
    const s = createCombat(f, [ally("a", 2)], [enemy("e", 8), enemy("e2", 6)], 2);
    const a = s.units.a;
    expect(hitChance(s, a, s.units.e)).toBeLessThan(hitChance(s, a, s.units.e2));
    expect(lineOfFire(s, a, { col: 6, floor: 1 })).toBe(false);
  });

  it("a closed door blocks line of fire", () => {
    const f = makeArena(3);
    f.doors = [{ col: 5, floor: 0, closed: true, hp: 10 }];
    const s = createCombat(f, [ally("a", 2)], [enemy("e", 8)], 3);
    expect(lineOfFire(s, s.units.a, s.units.e)).toBe(false);
  });

  it("enemies announce intents before the round", () => {
    const s = createCombat(makeArena(4), [ally("a", 1)], [enemy("e", 10, "raider")], 4);
    expect(s.units.e.intent?.length).toBeGreaterThan(0);
    expect(s.units.e.intentText).toBeTruthy();
  });

  it("3 allies beat 5 enemies with bot plans; replay with the same seed is identical", () => {
    const mk = () =>
      createCombat(
        makeArena(77),
        [ally("a", 1, { ability: "suppress", weapon: "rifle", ammo: 5 }), ally("b", 2, { ability: "surgery" }), ally("c", 1, { ability: "molotov", weapon: "shotgun", ammo: 2 })],
        [enemy("e1", 10), enemy("e2", 11, "rat"), enemy("e3", 12, "rat"), enemy("e4", 12, "dog"), enemy("e5", 13, "marauder")],
        99,
      );
    const s1 = runToEnd(mk());
    const s2 = runToEnd(mk());
    expect(s1.phase).toBe("over");
    expect(s1.result).toBe(s2.result);
    expect(s1.round).toBe(s2.round);
    expect(JSON.stringify(s1.log)).toBe(JSON.stringify(s2.log));
    expect(JSON.stringify(Object.values(s1.units).map((u) => [u.id, u.hp, u.col]))).toBe(JSON.stringify(Object.values(s2.units).map((u) => [u.id, u.hp, u.col])));
  });

  it("bots win most arena fights of 3 vs 5 weak enemies", () => {
    let wins = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const s = createCombat(
        makeArena(seed),
        [ally("a", 1, { ability: "suppress", weapon: "rifle", ammo: 5 }), ally("b", 2, { weapon: "pistol" }), ally("c", 1, { weapon: "pipe" })],
        [enemy("e1", 10, "rat"), enemy("e2", 11, "rat"), enemy("e3", 12, "marauder"), enemy("e4", 12, "dog"), enemy("e5", 13, "rat")],
        seed,
      );
      runToEnd(s);
      if (s.result === "win") wins++;
    }
    expect(wins).toBeGreaterThan(15);
  });

  it("suppression takes one AP next round", () => {
    const s = createCombat(makeArena(5), [ally("a", 2, { ability: "suppress" })], [enemy("e", 8, "sniper")], 5);
    submitPlan(s, "a", [{ t: "ability", target: "e" }]);
    resolveRound(s);
    if (alive(s.units.e)) expect(s.units.e.ap).toBe(2);
  });

  it("surgery revives a downed ally", () => {
    const s = createCombat(makeArena(6), [ally("a", 2, { ability: "surgery" }), ally("b", 3)], [enemy("e", 12, "rat")], 6);
    s.units.b.down = true;
    s.units.b.hp = 0;
    submitPlan(s, "a", [{ t: "ability", target: "b" }]);
    s.plans.b = [];
    resolveRound(s, () => []);
    expect(s.units.b.down).toBe(false);
    expect(s.units.b.hp).toBeGreaterThan(0);
  });

  it("overwatch shoots an enemy walking into range", () => {
    const s = createCombat(makeArena(8, 14, 1), [ally("a", 2, { weapon: "rifle", ammo: 5 })], [enemy("e", 13, "marauder")], 8);
    s.field.covers = [];
    submitPlan(s, "a", [{ t: "overwatch" }]);
    resolveRound(s, () => []);
    expect(s.events.some((e) => e.u === "a" && e.text === "перехват")).toBe(true);
  });

  it("molotov sets a fire zone that burns", () => {
    const s = createCombat(makeArena(9, 14, 1), [ally("a", 2, { items: { molotov: 1 } })], [enemy("e", 6, "rat"), enemy("f", 12, "rat")], 9);
    s.field.covers = [];
    const hp = s.units.e.hp;
    submitPlan(s, "a", [{ t: "throw", col: 6, floor: 0 }]);
    resolveRound(s, () => []);
    expect(s.events.some((e) => e.k === "fire")).toBe(true);
    expect(s.units.e.hp < hp || !alive(s.units.e) || s.units.e.col !== 6).toBe(true);
  });

  it("allies with too much stress panic", () => {
    const s = createCombat(makeArena(10), [ally("a", 2)], [enemy("e", 12)], 10);
    s.units.a.stress = 99;
    s.units.a.st.panic = 2;
    resolveRound(s, () => [{ t: "hunker" }]);
    expect(s.events.some((e) => e.text === "в панике!")).toBe(true);
  });
});
