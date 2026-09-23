import { describe, expect, it } from "vitest";
import { applyCmd, canPlaceRoom, finishDig, objsOfKind, roomAt, unnode, walkable, findPath } from "../src/index";
import { run, startedWorld } from "./helpers";

describe("digging & building", () => {
  it("validates room placement", () => {
    const w = startedWorld();
    expect(canPlaceRoom(w, "hydro", 29, 1, 4)).toBeNull(); // right next to the starting hydroponics (25..28)
    expect(canPlaceRoom(w, "hydro", 40, 1, 4)).toMatch(/примыкать/);
    // directly below the living quarters (12..19, lv1): allowed, a ladder will be added
    expect(canPlaceRoom(w, "hydro", 13, 2, 4)).toBeNull();
    expect(canPlaceRoom(w, "hydro", 25, 1, 4)).toMatch(/занято/);
    expect(canPlaceRoom(w, "shaft", 21, 2, 1)).toBeNull(); // below the tech room
  });

  it("a room stacked under another gets its own ladder and is reachable", () => {
    const w = startedWorld({ players: 1 });
    for (const k of ["scrap", "parts", "wood", "chem", "cloth"]) w.res[k] = 60;
    w.res.pickaxe = 2;
    w.res.food_can = 60;
    w.res.water = 60;
    expect(applyCmd(w, "p0", { k: "plan", type: "hydro", x: 13, lv: 2, w: 4 })).toBeUndefined();
    const r = Object.values(w.rooms).find((x) => x.type === "hydro" && x.lv === 2)!;
    expect(r.stair).toBeTruthy();
    let done = false;
    for (let i = 0; i < 40 && !done; i++) {
      for (const pid in w.players) if (w.council) w.council.ready[pid] = true;
      run(w, 30);
      done = r.state === "done";
    }
    expect(done).toBe(true);
    expect(Object.keys(w.ladders).some((k) => k.endsWith(",2"))).toBe(true);
    // walk from the living room down into the new room
    expect(findPath(w, 16.5, 1, 14.5, 2)).toBeTruthy();
  }, 60000);

  it("bots dig a shaft down and build hydroponics on the new level", () => {
    const w = startedWorld({ players: 1 });
    // the player character idles; bots do the work
    for (const k of ["scrap", "parts", "wood", "chem", "cloth"]) w.res[k] = 60;
    w.res.pickaxe = 2;
    w.res.food_can = 60;
    w.res.water = 60;
    expect(applyCmd(w, "p0", { k: "plan", type: "shaft", x: 21, lv: 2, w: 1 })).toBeUndefined();
    expect(applyCmd(w, "p0", { k: "plan", type: "hydro", x: 22, lv: 2, w: 4 })).toBeUndefined();
    // keep the player's own character out of the way
    let done = false;
    for (let i = 0; i < 40 && !done; i++) {
      for (const pid in w.players) if (w.council) w.council.ready[pid] = true;
      run(w, 30);
      const hydro = Object.values(w.rooms).find((r) => r.type === "hydro" && r.lv === 2);
      done = hydro?.state === "done";
    }
    const hydro = Object.values(w.rooms).find((r) => r.type === "hydro" && r.lv === 2)!;
    console.log(`built by day ${w.day} ${w.hour.toFixed(1)}h`);
    expect(hydro.state).toBe("done");
    expect(walkable(w, 21, 2)).toBe(true);
    expect(w.ladders["21,2"]).toBeTruthy();
    // reachable from the airlock
    expect(findPath(w, 21, 0, 23, 2)).not.toBeNull();
    expect(objsOfKind(w, "hydro_tray").filter((o) => o.lv === 2).length).toBe(3);
    // soil was carried out
    expect(Object.values(w.items).filter((i) => i.item === "dirt").length).toBeLessThan(6);
  }, 120000);

  it("underground stream find gives water", () => {
    const w = startedWorld();
    w.res.pickaxe = 1;
    applyCmd(w, "p0", { k: "plan", type: "corridor", x: 29, lv: 1, w: 2 });
    const key = Object.keys(w.marks).find((k) => unnode(w, Number(k))[0] === 30)!;
    w.finds[key] = "stream";
    // dig both slots
    for (const k of Object.keys(w.marks)) {
      const [x, lv] = unnode(w, Number(k));
      finishDig(w, w.chars[w.players.p0.char!], x, lv);
    }
    expect(objsOfKind(w, "stream").length).toBe(1);
    expect(w.found[key]).toBe("stream");
    const before = w.res.water_dirty ?? 0;
    run(w, 30);
    expect(w.res.water_dirty ?? 0).toBeGreaterThan(before);
    expect(["frame", "done"]).toContain(roomAt(w, 30, 1)?.state);
  });
});
