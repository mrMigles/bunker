import { describe, expect, it } from "vitest";
import { applyEffect, battle, battleEndHooks, bunkerField, debugOps, objsOfKind, tickWorld, type World } from "../src/index";
import { startedWorld } from "./helpers";

function runUntilBattleEnds(w: World, maxSeconds = 1500) {
  let started = false;
  for (let i = 0; i < maxSeconds * 20; i++) {
    if (w.phase === "night" && w.council) for (const pid in w.players) w.council.ready[pid] = true;
    // players are AFK: their plans are made by the ally bot, ready immediately
    const b = battle(w);
    if (b) {
      started = true;
      for (const pid in w.players) b.ready[pid] = true;
    } else if (started) return true;
    tickWorld(w, 0.05);
    w.fx = [];
  }
  return false;
}

describe("raids", () => {
  it("the street is the top floor and the hatch is a door", () => {
    const w = startedWorld();
    const f = bunkerField(w, "airlock");
    expect(f.originLv).toBe(-1);
    expect(f.exits[0].floor).toBe(0);
    expect(f.doors[0].closed).toBe(true);
    expect(f.ladders).toContain(`${f.doors[0].col},1`);
  });

  it("a raid through the airlock is warned about, starts and ends", () => {
    const w = startedWorld({ players: 1, seed: 11 });
    w.res.pistol = 3;
    w.res.ammo = 40;
    applyEffect(w, { startRaid: "raiders" });
    expect(w.director.raidWarn).toBe(w.day + 1);
    debugOps.raid(w, "raiders", "p0");
    expect(runUntilBattleEnds(w)).toBe(true);
    expect(w.mods.lastBattle?.where).toBe("bunker");
    expect(["win", "lose", "fled"]).toContain(w.mods.lastBattle?.result);
  }, 120000);

  it("a raid through the metro tunnel spawns the attackers underground", () => {
    const w = startedWorld({ players: 1, seed: 12 });
    w.flags.metro = 1;
    w.flags.metro_x = 17;
    w.flags.metro_lv = 1;
    debugOps.raid(w, "metro", "p0");
    for (let i = 0; i < 40 && !battle(w); i++) tickWorld(w, 0.05);
    const b = battle(w)!;
    expect(b).toBeTruthy();
    const enemy = Object.values(b.state.units).find((u) => u.side === "enemy")!;
    expect(enemy.floor + b.state.field.originLv).toBe(1);
    expect(runUntilBattleEnds(w)).toBe(true);
  }, 120000);

  it("resources carried off by fleeing raiders are written off", () => {
    const w = startedWorld({ players: 1, seed: 13 });
    debugOps.raid(w, "raiders", "p0");
    for (let i = 0; i < 40 && !battle(w); i++) tickWorld(w, 0.05);
    const b = battle(w)!;
    const before = Object.values(w.res).reduce((a, n) => a + Math.floor(n), 0);
    const e = Object.values(b.state.units).find((u) => u.side === "enemy")!;
    e.carried = { __steal: 2 };
    e.fled = true;
    battleEndHooks.raid(w, b);
    const after = Object.values(w.res).reduce((a, n) => a + Math.floor(n), 0);
    expect(before - after).toBe(6);
  });

  it("a barricaded door takes longer to break", () => {
    const w = startedWorld();
    const blast = objsOfKind(w, "door_blast")[0];
    blast.st.barricade = 1;
    const f = bunkerField(w, "airlock");
    expect(f.doors[0].barricaded).toBe(true);
    expect(f.doors[0].hp).toBeGreaterThan(20);
  });
});
