import { describe, expect, it } from "vitest";
import { addPlayer, applyCmd, createWorld, endGame, objsOfKind, startAction, TECH, tickWorld } from "../src/index";
import { startedWorld } from "./helpers";

describe("technologies", () => {
  it("has ~30 nodes with valid prerequisites", () => {
    const ids = Object.keys(TECH);
    expect(ids.length).toBeGreaterThanOrEqual(28);
    for (const id of ids) for (const r of TECH[id].req) expect(TECH[r], `${id} needs ${r}`).toBeTruthy();
  });

  it("research at a workbench unlocks a room type", () => {
    const w = startedWorld({ players: 1 });
    w.res.parts = 20;
    w.res.scrap = 20;
    const c = w.chars[w.players.p0.char!];
    // a workbench in the mess hall for the test
    const bench = { id: "wb", kind: "workbench", x: 26, lv: 0, room: undefined, wear: 100, broken: false, on: true, st: {} };
    w.objs.wb = bench as any;
    c.x = 26.5;
    c.lv = 0;
    expect(startAction(w, c, "research", { type: "obj", id: "wb" }, "tech_diesel")).toBeUndefined();
    for (let i = 0; i < 20 * 200 && !w.tech.includes("tech_diesel"); i++) tickWorld(w, 0.05);
    expect(w.tech).toContain("tech_diesel");
    expect(applyCmd(w, "p0", { k: "plan", type: "genroom", x: 32, lv: 0, w: 4 })).toBeUndefined();
  }, 60000);
});

describe("endings", () => {
  it("a short game played by bots reaches its end without errors", () => {
    const w = createWorld("SHORT", 2025, { short: true, skipPrologue: true, dayLength: 90, residents: 6 });
    addPlayer(w, "p0", "Наблюдатель");
    applyCmd(w, "p0", { k: "start" });
    applyCmd(w, "p0", { k: "aquarium", v: true });
    let guard = 0;
    while (w.phase !== "ending" && guard++ < 20 * 60 * 40) {
      if (w.phase === "night" && w.council) w.council.ready.p0 = true;
      // the lone watcher never plays: fights run on autopilot
      const b = w.mods.combat;
      if (b?.active) b.ready.p0 = true;
      tickWorld(w, 0.05);
      w.fx = [];
    }
    expect(w.phase).toBe("ending");
    expect(["short", "dead", "home", "faction"]).toContain(w.ending?.kind);
    const info = w.mods.endingInfo;
    expect(info.legacy.p0.points).toBeGreaterThan(0);
    console.log(`short game: ${w.ending?.kind} on day ${w.day}, survivors ${info.survivors.length}`);
  }, 300000);

  it("everyone dead → defeat; the host can start over", () => {
    const w = startedWorld({ players: 1 });
    for (const c of Object.values(w.chars)) c.status = "dead";
    endGame(w, "dead");
    expect(w.phase).toBe("ending");
    expect(applyCmd(w, "p0", { k: "newGame" })).toBeUndefined();
    expect(w.phase).toBe("lobby");
    expect(w.players.p0.cards?.length).toBe(3);
    expect(Object.keys(w.chars).length).toBe(0);
    void objsOfKind;
  });
});
