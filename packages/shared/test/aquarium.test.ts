import { describe, expect, it } from "vitest";
import { addPlayer, applyCmd, tickWorld } from "../src/index";
import { startedWorld } from "./helpers";

describe("bots keep the bunker alive (Aquarium, 20 minutes)", () => {
  it("1 player in aquarium + 5 bots survive 20 real minutes, garden yields", () => {
    const w = startedWorld({ players: 1, seed: 4242 });
    applyCmd(w, "p0", { k: "aquarium", v: true });
    let harvested = 0;
    let barks = 0;
    let talks = 0;
    const seconds = 20 * 60;
    for (let i = 0; i < seconds * 20; i++) {
      // players leave the council ready (the aquarium player doesn't interact)
      if (w.phase === "night" && w.council) for (const pid in w.players) w.council.ready[pid] = true;
      tickWorld(w, 0.05);
      w.fx = [];
      for (const c of Object.values(w.chars)) {
        if (c.bark && c.bark.t > 4.4) {
          barks++;
          if (c.bark.to) talks++;
        }
      }
      if (i % 200 === 0) harvested = Math.max(harvested, Object.values(w.gazette).reduce((s, g) => s + (g.lines.some((l) => l.startsWith("🧺")) ? 1 : 0), 0));
    }
    const alive = Object.values(w.chars).filter((c) => c.status !== "dead");
    console.log(`day ${w.day}, alive ${alive.length}, barks ${barks}, talks ${talks}, gazette harvest days ${harvested}`);
    console.log(alive.map((c) => `${c.card.name}: ${JSON.stringify(Object.fromEntries(Object.entries(c.needs).map(([k, v]) => [k, Math.round(v)])))}`).join("\n"));
    expect(alive.length).toBe(6);
    expect(w.day).toBeGreaterThanOrEqual(3);
    expect(harvested).toBeGreaterThanOrEqual(1);
    expect(barks).toBeGreaterThan(20);
    expect(talks).toBeGreaterThan(3);
  }, 300000);

  it("a second player joins mid-day and seamlessly takes over a bot", () => {
    const w = startedWorld({ players: 1, seed: 7 });
    for (let i = 0; i < 20 * 60; i++) tickWorld(w, 0.05);
    const bot = Object.values(w.chars).find((c) => !c.ctrl)!;
    const before = { x: bot.x, skills: { ...bot.skills }, name: bot.card.name };
    addPlayer(w, "p9", "Новичок");
    const p = w.players.p9;
    expect(p.char).toBeTruthy();
    const c = w.chars[p.char!];
    expect(c.ctrl).toBe("p9");
    // explicit choice of another free bot also works
    const other = Object.values(w.chars).find((x) => !x.ctrl)!;
    expect(applyCmd(w, "p9", { k: "take", char: other.id })).toBeUndefined();
    expect(w.chars[other.id].ctrl).toBe("p9");
    void before;
  });
});
