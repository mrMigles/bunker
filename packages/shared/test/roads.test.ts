import { describe, expect, it } from "vitest";
import { BAL, applyCmd, debugOps, feetY, generateMap, generateSite, hoursPerSec, objsOfKind, roadAmbush, siteWorld, startAction, stepMove, tickWorld, wmap, type Char, type World } from "../src/index";
import { startedWorld } from "./helpers";

function tick(w: World, seconds: number, stop?: () => boolean) {
  for (let t = 0; t < seconds; t += 0.05) {
    if (w.phase === "night" && w.council) for (const p in w.players) w.council.ready[p] = true;
    tickWorld(w, 0.05);
    w.fx = [];
    if (stop?.()) return;
  }
}

describe("road ambushes by territory", () => {
  const m = generateMap(5);
  it("never on the doorstep: legs between home and its neighbours are safe", () => {
    for (const n of m.nodes.home.links) expect(roadAmbush(m, "home", n).chance).toBe(0);
  });
  it("bandit roads of the промзона: 20%+ until their bunker falls, then nothing", () => {
    const prom = Object.values(m.nodes).filter((n) => n.district === "Промзона");
    expect(prom.length).toBeGreaterThan(1);
    const [a] = prom;
    const b = a.links.find((l) => m.nodes[l].district === "Промзона")!;
    expect(roadAmbush(m, a.id, b).chance).toBeGreaterThanOrEqual(0.2);
    expect(roadAmbush(m, a.id, b, { ratkingBeaten: 1 }).chance).toBe(0);
  });
  it("elsewhere around 5%", () => {
    const c = Object.values(m.nodes).find((n) => n.district === "Центр")!;
    const r = roadAmbush(m, c.id, c.links[0]);
    expect(r.chance).toBeGreaterThan(0.02);
    expect(r.chance).toBeLessThan(0.15);
  });
  it("a rolled ambush turns into a street fight mid-leg, and the road goes on after it", () => {
    const w = startedWorld({ players: 1, residents: 6, seed: 31 });
    Object.assign(w.res, { food_can: 20, water: 20, pistol: 1, ammo: 12 });
    const me = w.chars[w.players.p0.char!];
    const t = objsOfKind(w, "sortie_terminal")[0];
    Object.assign(me, { x: t.x + 0.5, lv: t.lv, y: feetY(t.lv) });
    expect(startAction(w, me, "sortie", { type: "obj", id: t.id })).toBeUndefined();
    expect(applyCmd(w, "p0", { k: "expStart" })).toBeUndefined();
    const e = w.mods.expedition;
    const far = Object.values(wmap(w).nodes).find((n) => n.known && n.id !== "home" && !wmap(w).nodes.home.links.includes(n.id))!;
    expect(applyCmd(w, "p0", { k: "expGo", node: far.id })).toBeUndefined();
    e.ambush = { at: e.travelTotal * 0.5, foes: ["rat"], who: "Тестовые крысы" };
    tick(w, 120, () => !!w.mods.combat?.active);
    expect(w.mods.combat?.active).toBe(true);
    expect(e.stage).toBe("travel");
    expect(e.ambush).toBeUndefined();
  }, 60000);
});

describe("residents' own runs", () => {
  it("are over in a few game hours, not the whole day", () => {
    const w = startedWorld({ players: 1, residents: 6, seed: 77, dayLength: 900 });
    const me = w.chars[w.players.p0.char!];
    const t = objsOfKind(w, "sortie_terminal")[0];
    Object.assign(me, { x: t.x + 0.5, lv: t.lv, y: feetY(t.lv) });
    expect(startAction(w, me, "sortie", { type: "obj", id: t.id })).toBeUndefined();
    const node = Object.values(wmap(w).nodes).find((n) => n.known && n.danger === 1 && n.type !== "trader" && n.type !== "camp" && n.id !== "home" && !wmap(w).nodes.home.links.includes(n.id))!;
    expect(applyCmd(w, "p0", { k: "expSendBots", node: node.id })).toBeUndefined();
    const h0 = w.hour;
    tick(w, 900, () => !w.mods.expedition);
    expect(w.mods.expedition).toBeUndefined();
    expect(w.day).toBe(1);
    // fights on the road may add a little, the walk itself is quick
    expect(w.hour - h0).toBeLessThan(2);
  }, 60000);
});

describe("the working day", () => {
  it("lasts 15 real minutes by default and ends at 23:00 with a warning at 22:00", () => {
    const w = startedWorld({ players: 1, dayLength: BAL.defaultDayLength });
    expect(BAL.defaultDayLength).toBe(900);
    expect(BAL.dayEndHour).toBe(23);
    expect(hoursPerSec(w) * 900).toBeCloseTo(17);
    w.hour = 21.99;
    let warned = false;
    for (let i = 0; i < 40 && !warned; i++) {
      tickWorld(w, 0.05);
      warned = (w.fx ?? []).some((f: any) => f.k === "toast" && /отбой/.test(f.text));
      w.fx = [];
    }
    expect(warned).toBe(true);
    expect(w.phase).toBe("day");
  });
});

describe("ladders", () => {
  const s = generateSite("n1", "hospital", 7, 1);
  const sw = siteWorld(s);
  const who = () => ({ x: 2.5, lv: 1, y: feetY(1), climbing: false, run: false, hands: [], card: { plus: "" }, needs: { energy: 80 }, drunk: 0, anim: "idle", dir: 1 }) as unknown as Char;
  it("pushing sideways mid-climb finishes the climb instead of hanging on the rungs", () => {
    const c = who();
    stepMove(sw, c, 0, -1, 0.05);
    expect(c.climbing).toBe(true);
    for (let i = 0; i < 6; i++) stepMove(sw, c, 0, -1, 0.05);
    for (let i = 0; i < 200 && c.climbing; i++) stepMove(sw, c, 1, 0, 0.05);
    expect(c.climbing).toBe(false);
  });
});

describe("companions in a building", () => {
  it("follow the leader up and down the stair hall instead of treading at the ladder", () => {
    for (const seed of [3, 8, 21, 40]) {
      const w = startedWorld({ players: 1, residents: 6, seed });
      w.flags._dbgOk = 1;
      debugOps.sortie(w, undefined, "p0");
      debugOps.quiet(w);
      const e = w.mods.expedition;
      const s = e.site;
      const leader = w.chars[w.players.p0.char!];
      const floors = [...new Set(s.rooms.map((r: any) => r.lv))] as number[];
      if (floors.length < 2) continue;
      for (const lv of [...floors].reverse().concat(floors)) {
        const room = s.rooms.find((r: any) => r.lv === lv && !r.stairs)!;
        Object.assign(leader, { x: room.x + 1.5, lv, y: feetY(lv), climbing: false });
        // a loaded server ticks in bigger steps: 0.1 s made the old approach hop over the ladder spot
        for (let t = 0; t < 25; t += 0.1) {
          tickWorld(w, 0.1);
          w.fx = [];
          Object.assign(leader, { x: room.x + 1.5, lv, y: feetY(lv), climbing: false });
        }
        for (const id of e.squad) {
          const c = w.chars[id];
          if (c === leader) continue;
          expect(c.lv, `seed ${seed}: ${c.card.name} on floor ${c.lv}, leader on ${lv}`).toBe(lv);
          expect(c.climbing).toBe(false);
        }
      }
    }
  }, 60000);
});
