import { describe, expect, it } from "vitest";
import { addPlayer, applyCmd, createWorld, listPrologueActions, tickWorld, type Prologue } from "../src/index";

function world(players: number) {
  const w = createWorld("PRLG1", 321, { residents: 6 });
  for (let i = 0; i < players; i++) addPlayer(w, "p" + i, "Игрок" + i);
  for (let i = 0; i < players; i++) applyCmd(w, "p" + i, { k: "pick", i: 0 });
  applyCmd(w, "p0", { k: "start" });
  tickWorld(w, 0.05);
  return w;
}

describe("prologue «90 секунд»", () => {
  it("starts on the street with items, neighbours and a timer", () => {
    const w = world(2);
    expect(w.phase).toBe("prologue");
    const p = w.mods.prologue as Prologue;
    expect(p.items.length).toBeGreaterThan(30);
    expect(p.npcs.length).toBe(3);
    expect(p.houses.length).toBe(4);
  });

  it("players pick up, throw and drop things into the hatch", () => {
    const w = world(2);
    const p = w.mods.prologue as Prologue;
    const c = w.chars[w.players.p0.char!];
    const it = p.items.find((x) => x.lv === 1 && !["food_box", "water_jug", "toolbox", "guitar", "suitcase", "plant_pot"].includes(x.item))!;
    c.x = it.x;
    c.lv = 1;
    const a = listPrologueActions(p, c).find((x) => x.a === "pick" && x.id === it.id)!;
    expect(applyCmd(w, "p0", { k: "pdo", a: "pick", id: a.id })).toBeUndefined();
    expect(c.hands.length).toBe(1);
    c.x = p.hatchX + 0.5;
    expect(applyCmd(w, "p0", { k: "pdo", a: "drop", id: "hatch" })).toBeUndefined();
    expect(Object.values(p.delivered).reduce((a, b) => a + b, 0)).toBe(1);
    // throw to a teammate
    const c1 = w.chars[w.players.p1.char!];
    const it2 = p.items.find((x) => x.lv === 1 && x.item === "food_can")!;
    c.x = it2.x;
    applyCmd(w, "p0", { k: "pdo", a: "pick", id: it2.id });
    c.dir = c.x > 20 ? -1 : 1;
    c1.lv = 1;
    c1.x = c.x + 3.5 * c.dir;
    applyCmd(w, "p0", { k: "pthrow" });
    expect(c1.hands.some((h) => h.item === "food_can")).toBe(true);
  });

  it("bots scavenge for 90 seconds, the flash hits, supplies depend on what was saved", () => {
    const w = world(1);
    applyCmd(w, "p0", { k: "aquarium", v: true }); // the player's character runs on autopilot too
    for (let i = 0; i < 20 * 96 && w.phase === "prologue"; i++) {
      tickWorld(w, 0.05);
      w.fx = [];
    }
    expect(w.phase).toBe("day");
    const r = w.mods.prologueResult;
    expect(Object.values(r.delivered as Record<string, number>).reduce((a, b) => a + b, 0)).toBeGreaterThan(5);
    const food = (w.res.food_can ?? 0) + (w.res.water ?? 0);
    expect(food).toBeGreaterThan(6);
    expect(r.lines.length).toBeGreaterThan(0);
  }, 60000);

  it("persuading a neighbour brings a new resident", () => {
    const w = world(1);
    const p = w.mods.prologue as Prologue;
    const c = w.chars[w.players.p0.char!];
    const n = p.npcs[0];
    n.lv = 1;
    n.x = 10;
    c.x = 10;
    c.lv = 1;
    expect(applyCmd(w, "p0", { k: "pdo", a: "persuade", id: n.id })).toBeUndefined();
    const before = Object.keys(w.chars).length;
    for (let i = 0; i < 20 * 96 && w.phase === "prologue"; i++) {
      n.x = n.state === "panic" ? c.x : n.x; // keep them in reach while talking
      tickWorld(w, 0.05);
      w.fx = [];
    }
    expect(n.state).toBe("saved");
    expect(Object.keys(w.chars).length).toBe(before + 1);
  }, 60000);
});
