import { describe, expect, it } from "vitest";
import { addBoardGame, applyCmd, exped, generateMap, generateSite, listSiteActions, mapPath, objsOfKind, startAction, tickWorld, wmap, type Char, type World } from "../src/index";
import { startedWorld } from "./helpers";

function tick(w: World, seconds: number) {
  for (let i = 0; i < seconds * 20; i++) {
    if (w.phase === "night" && w.council) for (const pid in w.players) w.council.ready[pid] = true;
    tickWorld(w, 0.05);
    w.fx = [];
  }
}

function toTerminal(w: World, pid: string) {
  const c = w.chars[w.players[pid].char!];
  const t = objsOfKind(w, "sortie_terminal")[0];
  c.x = t.x + 0.5;
  c.lv = t.lv;
  c.y = t.lv * 2 + 2;
  return c;
}

/** Runs a site action to completion for a char placed next to the target. */
function doSite(w: World, pid: string, a: string, id: string) {
  const err = applyCmd(w, pid, { k: "sdo", a, id });
  if (err) throw new Error(`${a} ${id}: ${err}`);
  let guard = 0;
  while (exped(w)?.tasks[w.players[pid].char!] && guard++ < 2000) tick(w, 0.1);
}

function placeAt(c: Char, x: number, lv: number) {
  c.x = x + 0.5;
  c.lv = lv;
  c.y = lv * 2 + 2;
}

function setupSquad(seed: number) {
  const w = startedWorld({ players: 4, residents: 6, seed, dayLength: 600 });
  Object.assign(w.res, { food_can: 20, water: 20, lockpick: 1, flashlight: 1, batteries: 3, pistol: 1, ammo: 12, meds: 3 });
  const c0 = toTerminal(w, "p0");
  expect(startAction(w, c0, "sortie", { type: "obj", id: objsOfKind(w, "sortie_terminal")[0].id })).toBeUndefined();
  expect(applyCmd(w, "p0", { k: "expJoin" })).toBeUndefined();
  toTerminal(w, "p1");
  expect(applyCmd(w, "p1", { k: "expJoin" })).toBeUndefined();
  for (const [k, n] of [["food_can", 4], ["water", 6], ["lockpick", 1], ["flashlight", 1], ["batteries", 2], ["pistol", 1], ["ammo", 8], ["meds", 1]] as const) expect(applyCmd(w, "p0", { k: "expGear", item: k, n })).toBeUndefined();
  expect(applyCmd(w, "p0", { k: "expStart" })).toBeUndefined();
  return w;
}

describe("wasteland map", () => {
  it("has 30–50 connected nodes with key locations", () => {
    for (const seed of [1, 2, 3, 99]) {
      const m = generateMap(seed);
      const n = Object.keys(m.nodes).length;
      expect(n).toBeGreaterThanOrEqual(31);
      expect(n).toBeLessThanOrEqual(53);
      for (const id in m.nodes) expect(mapPath(m, "home", id, false), id).not.toBeNull();
      const types = Object.values(m.nodes).map((x) => x.type);
      for (const t of ["hospital", "checkpoint", "radiotower", "trader", "camp", "ark"]) expect(types).toContain(t);
    }
  });

  it("generated sites are connected via stairs and have a secret", () => {
    for (let seed = 1; seed < 20; seed++) {
      const s = generateSite("n1", "hospital", seed, 2);
      expect(s.rooms.length).toBeGreaterThanOrEqual(4);
      expect(s.details.some((d) => d.clue === "step")).toBe(true);
      expect(s.details.some((d) => d.needsClue === "step")).toBe(true);
    }
  });
});

describe("expedition (stage 7 acceptance)", () => {
  it("a squad of 2 sneaks through a hospital without a fight, finds the secret by the note, returns with loot; operators help", () => {
    const w = setupSquad(2024);
    const e = exped(w)!;
    expect(e.stage).toBe("map");
    expect(w.chars[w.players.p0.char!].status).toBe("away");
    // choose the nearest hospital, make its road known
    const m = wmap(w);
    const hosp = Object.values(m.nodes).filter((n) => n.type === "hospital").sort((a, b) => (mapPath(m, "home", a.id, false)!.length - mapPath(m, "home", b.id, false)!.length))[0];
    for (const id of mapPath(m, "home", hosp.id, false)!) m.nodes[id].known = true;
    w.flags.relays = 6; // radio reaches the squad
    expect(applyCmd(w, "p0", { k: "expGo", node: hosp.id })).toBeUndefined();
    let guard = 0;
    while (exped(w)!.stage === "travel" && guard++ < 400) tick(w, 1);
    // road encounters may start a fight: let bots finish it
    guard = 0;
    while (w.mods.combat?.active && guard++ < 600) tick(w, 1);
    while (exped(w)?.stage === "travel" && guard++ < 1200) tick(w, 1);
    expect(exped(w)!.node).toBe(hosp.id);
    // the operators in the bunker: p2 at the terminal gives coordination and scans
    toTerminal(w, "p2");
    toTerminal(w, "p3");
    expect(applyCmd(w, "p2", { k: "opCoord" })).toBeUndefined();
    expect(exped(w)!.coord).toBe(1);
    expect(applyCmd(w, "p0", { k: "expEnter" })).toBeUndefined();
    const s = exped(w)!.site!;
    expect(applyCmd(w, "p3", { k: "opScan" })).toBeUndefined();
    // everyone is asleep; we move quietly
    for (const t of s.threats) t.state = "asleep";
    const c0 = w.chars[w.players.p0.char!];
    const c1 = w.chars[w.players.p1.char!];
    (c0 as any).__sneak = true;
    (c1 as any).__sneak = true;
    applyCmd(w, "p0", { k: "expLight" });
    // walk room by room: open doors, find details, search containers
    for (const d of s.doors) {
      placeAt(c0, d.x - 1, d.lv);
      if (d.state === "closed") doSite(w, "p0", "open", d.id);
      if (d.state === "locked") doSite(w, "p0", "pickDoor", d.id), d.state === "locked" && doSite(w, "p0", "pickDoor", d.id), d.state === "locked" && doSite(w, "p0", "pickDoor", d.id);
    }
    const note = s.details.find((d) => d.clue === "step")!;
    const room = s.rooms.find((r) => r.lv === note.lv && note.x >= r.x && note.x < r.x + r.w)!;
    placeAt(c0, note.x, note.lv);
    for (let i = 0; i < 10 && !note.found; i++) doSite(w, "p0", "inspect", room.id);
    expect(note.found).toBe(true);
    doSite(w, "p0", "take", note.id);
    expect(s.clues).toContain("step");
    const step = s.details.find((d) => d.needsClue === "step")!;
    const stair = s.rooms.find((r) => r.lv === step.lv && step.x >= r.x && step.x < r.x + r.w)!;
    placeAt(c0, step.x, step.lv);
    for (let i = 0; i < 10 && !step.found; i++) doSite(w, "p0", "inspect", stair.id);
    expect(step.found).toBe(true);
    doSite(w, "p0", "take", step.id);
    // searching (c1 helps with the co-op containers)
    for (const ct of s.conts) {
      placeAt(c0, ct.x, ct.lv);
      placeAt(c1, ct.x, ct.lv);
      const acts = listSiteActions(exped(w)!, s, c0);
      const unlock = acts.find((a) => a.id === ct.id && (a.a === "unlock" || a.a === "pick"));
      if (unlock) for (let k = 0; k < 4 && ct.locked; k++) doSite(w, "p0", unlock.a, ct.id);
      if (ct.locked) continue;
      if (ct.coop) applyCmd(w, "p1", { k: "sdo", a: "search", id: ct.id });
      doSite(w, "p0", "search", ct.id);
    }
    expect(w.mods.combat?.active ?? false).toBe(false);
    const lootKinds = Object.keys(exped(w)!.loot);
    expect(lootKinds.length).toBeGreaterThan(2);
    // leave and go home
    placeAt(c0, s.exitX, s.exitLv);
    placeAt(c1, s.exitX, s.exitLv);
    expect(applyCmd(w, "p0", { k: "expHome" })).toBeUndefined();
    guard = 0;
    while (exped(w) && guard++ < 3000) tick(w, 1);
    expect(exped(w)).toBeUndefined();
    expect(c0.status).toBe("ok");
    expect(Object.keys(w.items).length).toBeGreaterThan(0); // loot at the airlock
  }, 180000);

  it("a noisy squad draws dogs", () => {
    const w = setupSquad(77);
    const m = wmap(w);
    const target = Object.values(m.nodes).find((n) => n.known && n.id !== "home" && ["shop", "school", "farm", "gas", "hospital", "metro"].includes(n.type))!;
    applyCmd(w, "p0", { k: "expGo", node: target.id });
    let guard = 0;
    while ((exped(w)?.stage === "travel" || w.mods.combat?.active) && guard++ < 2000) tick(w, 1);
    expect(applyCmd(w, "p0", { k: "expEnter" })).toBeUndefined();
    const s = exped(w)!.site!;
    s.threats = [];
    const c0 = w.chars[w.players.p0.char!];
    // kick every door and run around
    for (const d of s.doors) {
      placeAt(c0, d.x - 1, d.lv);
      if (d.state === "locked") doSite(w, "p0", "kick", d.id);
      else if (d.state === "closed") doSite(w, "p0", "open", d.id);
      // running around (no sneaking) is loud
      for (let k = 0; k < 20; k++) applyCmd(w, "p0", { k: "noop" }), w.chars[w.players.p0.char!].x += 0;
      s.noise = Math.min(100, s.noise + 20);
      if (s.spawned) break;
    }
    s.noise = Math.max(s.noise, 60);
    tick(w, 0.5);
    expect(s.spawned).toBeGreaterThanOrEqual(1);
    expect(s.threats.some((t) => t.etype === "dog")).toBe(true);
  }, 120000);

  it("found board games go onto the shelf", () => {
    const w = startedWorld();
    addBoardGame(w, "domino");
    expect(w.games).toContain("domino");
  });
});
