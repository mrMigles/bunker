import { describe, expect, it } from "vitest";
import {
  ENEMIES,
  LOC,
  addPlayer,
  applyCmd,
  createWorld,
  enterSite,
  exped,
  generateMap,
  grantXp,
  objsOfKind,
  rollLoot,
  roomsOfType,
  settleKeepsakes,
  startAction,
  startBattle,
  talkToday,
  threatLevel,
  tickWorld,
  wmap,
  xpForLevel,
  type Char,
  type World,
} from "../src/index";
import { run, startedWorld } from "./helpers";

function tick(w: World, seconds: number) {
  for (let i = 0; i < seconds * 20; i++) {
    if (w.phase === "night" && w.council) for (const pid in w.players) w.council.ready[pid] = true;
    tickWorld(w, 0.05);
    w.fx = [];
  }
}

/** Me + the pre-filled residents inside the nearest shop. */
function inShop(seed = 5) {
  const w = startedWorld({ players: 1, seed, dayLength: 900 });
  const me = w.chars[w.players.p0.char!];
  const t = objsOfKind(w, "sortie_terminal")[0];
  Object.assign(me, { x: t.x + 0.5, lv: t.lv, y: t.lv * 2 + 2 });
  expect(startAction(w, me, "sortie", { type: "obj", id: t.id })).toBeUndefined();
  expect(applyCmd(w, "p0", { k: "expStart" })).toBeUndefined();
  const e = exped(w)!;
  const shop = Object.values(wmap(w).nodes).find((n) => n.type === "shop")!;
  e.node = shop.id;
  enterSite(w, e, shop);
  const s = e.site!;
  for (const t of s.threats) t.state = "asleep";
  s.threats = []; // a quiet building for the mechanics below
  return { w, e, s, me };
}

function placeAt(c: Char, x: number, lv: number) {
  c.x = x + 0.5;
  c.lv = lv;
  c.y = lv * 2 + 2;
}

describe("iteration 3: searching on sorties", () => {
  it("holding E searches 2.5× faster but loud; a careful search is quiet", () => {
    const { w, e, s, me } = inShop();
    const conts = s.conts.filter((c) => !c.locked && !c.coop && c.kind !== "body");
    const [a, b] = conts;
    // careful
    placeAt(me, a.x, a.lv);
    s.noise = 0;
    expect(applyCmd(w, "p0", { k: "sdo", a: "search", id: a.id })).toBeUndefined();
    let t1 = 0;
    while (e.tasks[me.id] && t1 < 60) {
      tick(w, 0.1);
      t1 += 0.1;
    }
    const quietNoise = s.noise;
    // rushed
    placeAt(me, b.x, b.lv);
    s.noise = 0;
    expect(applyCmd(w, "p0", { k: "sdo", a: "search", id: b.id })).toBeUndefined();
    applyCmd(w, "p0", { k: "srush", on: true });
    let t2 = 0;
    let loud = 0;
    while (e.tasks[me.id] && t2 < 60) {
      tick(w, 0.1);
      t2 += 0.1;
      loud = Math.max(loud, s.noise);
    }
    const perSizeCareful = t1 / a.size,
      perSizeRush = t2 / b.size;
    expect(perSizeRush).toBeLessThan(perSizeCareful * 0.6);
    expect(loud).toBeGreaterThan(quietNoise + 3);
    expect(a.searched).toBe(1);
    expect(b.searched).toBe(1);
  });

  it("«search the room» sends every companion to a container at once", () => {
    const { w, e, s, me } = inShop(9);
    const room = s.rooms.find((r) => !r.stairs && s.conts.filter((c) => c.lv === r.lv && c.x >= r.x && c.x < r.x + r.w && !c.locked).length >= 2)!;
    expect(room).toBeTruthy();
    placeAt(me, room.x, room.lv);
    for (const id of e.squad) if (id !== me.id) placeAt(w.chars[id], room.x, room.lv);
    const acts = (applyCmd(w, "p0", { k: "sdo", a: "searchRoom", id: room.id }), Object.keys(e.tasks));
    const bots = e.squad.filter((id) => id !== me.id);
    expect(acts.filter((id) => bots.includes(id)).length).toBeGreaterThanOrEqual(1);
    expect(s.noise).toBeGreaterThanOrEqual(6);
    tick(w, 30);
    const left = s.conts.filter((c) => c.lv === room.lv && c.x >= room.x && c.x < room.x + room.w && !c.locked && c.searched < 1);
    expect(left.length).toBeLessThanOrEqual(1);
  });

  it("companions keep their own spots instead of standing in one pile", () => {
    const { w, e, s, me } = inShop(12);
    const hall = s.rooms.find((r) => r.lv === s.exitLv && r.w >= 5) ?? s.rooms.find((r) => r.lv === s.exitLv)!;
    placeAt(me, hall.x + Math.floor(hall.w / 2), hall.lv);
    for (const id of e.squad) if (id !== me.id) placeAt(w.chars[id], hall.x + Math.floor(hall.w / 2), hall.lv);
    tick(w, 4);
    const xs = e.squad.map((id) => w.chars[id].x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThan(0.3);
  });

  it("defeated enemies leave bodies to search, with what they carried", () => {
    const { w, e, s, me } = inShop(21);
    placeAt(me, s.exitX + 1, s.exitLv);
    s.threats.push({ id: "tX", etype: "raider", x: s.exitX + 3, lv: s.exitLv, dir: -1, state: "alert", detect: 100, room: s.rooms[0].id });
    tick(w, 1);
    expect(w.mods.combat?.active).toBe(true);
    // the fight resolves with the enemies down
    for (const u of Object.values(w.mods.combat.state.units) as any[]) if (u.side === "enemy") Object.assign(u, { hp: 0, dead: true });
    tick(w, 60);
    const body = s.conts.find((c) => c.kind === "body");
    expect(body).toBeTruthy();
    expect(body!.name).toMatch(/Тело/);
    placeAt(me, body!.x, body!.lv);
    const before = JSON.stringify(e.loot);
    expect(applyCmd(w, "p0", { k: "sdo", a: "search", id: body!.id })).toBeUndefined();
    tick(w, 6);
    expect(body!.searched).toBe(1);
    expect(JSON.stringify(e.loot)).not.toBe(before);
  });
});

describe("iteration 3: weapons, board games, the start", () => {
  it("weapons and board games turn up in ordinary buildings", () => {
    let weapons = 0,
      games = 0,
      rolls = 0;
    const R = { i: 7 } as any;
    void R;
    for (const room of LOC.types.shop.rooms.concat(LOC.types.school.rooms, LOC.types.farm.rooms) as string[]) {
      for (const ck of (LOC.rooms[room]?.conts ?? []) as string[]) {
        const table = LOC.containers[ck]?.table;
        if (!table) continue;
        for (let s = 0; s < 30; s++) {
          const loot = rollLoot(table, { weighted: (a: any[], f: any) => pickW(a, f, s + rolls), int: (a: number) => a } as any, 1);
          rolls++;
          for (const k in loot) {
            if (["pipe", "knife", "pistol", "shotgun", "rifle", "molotov"].includes(k)) weapons++;
            if (k.startsWith("bg_")) games++;
          }
        }
      }
    }
    expect(weapons / rolls).toBeGreaterThan(0.03);
    expect(games / rolls).toBeGreaterThan(0.02);
  });

  it("a new bunker has at most three residents besides the players", () => {
    const w = createWorld("SMALL", 3, { skipPrologue: true, residents: 6 });
    addPlayer(w, "p0", "Я");
    applyCmd(w, "p0", { k: "start" });
    expect(Object.keys(w.chars).length).toBe(4);
    expect(w.res.knife).toBeGreaterThanOrEqual(1);
    expect(w.res.pipe).toBeGreaterThanOrEqual(1);
  });
});

/** deterministic weighted pick for loot tables */
function pickW(arr: any[], f: (x: any) => number, s: number) {
  const tot = arr.reduce((a, x) => a + f(x), 0);
  let r = ((s * 7919) % 1000) / 1000 * tot;
  for (const x of arr) if ((r -= f(x)) <= 0) return x;
  return arr[arr.length - 1];
}

describe("iteration 3: the intercom", () => {
  it("a refugee knocks on the second morning; answering «впустить» adds a resident", () => {
    const w = startedWorld({ players: 1, seed: 44, dayLength: 240 });
    const n0 = Object.keys(w.chars).length;
    let guard = 0;
    while (!w.mods.intercom && guard++ < 20000) tick(w, 0.5);
    const call = w.mods.intercom;
    expect(call?.kind).toBe("refugee");
    expect(w.day).toBe(2);
    const me = w.chars[w.players.p0.char!];
    const ic = objsOfKind(w, "intercom")[0];
    expect(ic).toBeTruthy();
    placeAt(me, ic.x, ic.lv);
    call.honest = true;
    expect(applyCmd(w, "p0", { k: "icAnswer", opt: "ask" })).toBeUndefined();
    expect(call.asked).toBeTruthy();
    expect(applyCmd(w, "p0", { k: "icAnswer", opt: "in" })).toBeUndefined();
    expect(Object.keys(w.chars).length).toBe(n0 + 1);
  });

  it("a trader at the door swaps goods from storage", () => {
    const w = startedWorld({ players: 1, seed: 45 });
    const me = w.chars[w.players.p0.char!];
    tick(w, 1);
    const ic = objsOfKind(w, "intercom")[0];
    placeAt(me, ic.x, ic.lv);
    w.mods.intercom = { id: "icT", kind: "trader", name: "Сёма", text: "", until: w.hour + 2, stock: { meds: 3 } };
    w.res.scrap = 40;
    const meds = w.res.meds ?? 0;
    expect(applyCmd(w, "p0", { k: "icTrade", give: { scrap: 30 }, take: { meds: 2 } })).toBeUndefined();
    expect(w.res.meds).toBe(meds + 2);
  });
});

describe("iteration 3: conversations and requests", () => {
  it("every resident has a story today; an accepted request completes by the bunker's state and pays XP", () => {
    const w = startedWorld({ players: 1, seed: 61 });
    const me = w.chars[w.players.p0.char!];
    const other = Object.values(w.chars).find((c) => c.id !== me.id)!;
    const t = talkToday(w, other);
    expect(t.text.length).toBeGreaterThan(10);
    // force a request: build a rest room
    t.offer = { giver: other.id, kind: "room", target: "rec", text: "Построить: Комната отдыха", why: "…" };
    t.replies = [{ id: "accept", label: "" }];
    placeAt(me, other.x - 0.5, other.lv);
    expect(applyCmd(w, "p0", { k: "talkReply", char: other.id, r: "accept" })).toBeUndefined();
    expect((w.mods.quests ?? []).length).toBe(1);
    const xp0 = me.xp ?? 0;
    // the room appears (as if built)
    const r = Object.values(w.rooms)[0];
    const old = r.type;
    r.type = "rec";
    tick(w, 2);
    expect((me.xp ?? 0) - xp0).toBeGreaterThanOrEqual(25);
    r.type = old;
    expect(roomsOfType(w, "rec").length).toBe(0);
  });
});

describe("iteration 3: minigames", () => {
  it("hand pumping (pulses) finishes the pump; with the window open it barely moves by itself", () => {
    const w = startedWorld({ players: 1, seed: 71 });
    const me = w.chars[w.players.p0.char!];
    const pump = objsOfKind(w, "hand_pump")[0];
    placeAt(me, pump.x, pump.lv);
    expect(startAction(w, me, "pump", { type: "obj", id: pump.id })).toBeUndefined();
    applyCmd(w, "p0", { k: "mgOpen", on: true });
    tick(w, 3);
    expect(me.task?.t ?? 0).toBeLessThan(1.5);
    const dirty = w.res.water_dirty ?? 0;
    for (let i = 0; i < 6 && me.task; i++) {
      applyCmd(w, "p0", { k: "mg", q: 1 });
      tick(w, 0.2);
    }
    tick(w, 0.2);
    expect(me.task).toBeNull();
    expect(w.res.water_dirty).toBeGreaterThan(dirty);
  });
});

describe("iteration 3: difficulty and the map", () => {
  it("the threat level grows with the survivors' levels, and enemies get tougher", () => {
    const w = startedWorld({ players: 1, seed: 81 });
    expect(threatLevel(w)).toBe(1);
    const me = w.chars[w.players.p0.char!];
    grantXp(me, xpForLevel(6) + 1);
    run(w, 1);
    expect(threatLevel(w)).toBeGreaterThanOrEqual(4);
    const b = startBattle(w, { cols: 10, floors: 1, walk: new Array(10).fill(true), ladders: [], covers: [], doors: [], exits: [], loot: [], originX: 0, originLv: 0 } as any, [], [{ id: "e1", side: "enemy", name: "", col: 5, floor: 0, etype: "raider" }], "expedition");
    const u = b.state.units.e1;
    expect(u.maxHp).toBeGreaterThan(ENEMIES.raider.hp);
  });

  it("every game has the same geography (fixed slots, roads); all places reachable from home", () => {
    const a = generateMap(1),
      b = generateMap(999);
    for (const id in a.nodes) {
      expect(b.nodes[id]).toBeTruthy();
      expect([a.nodes[id].x, a.nodes[id].y]).toEqual([b.nodes[id].x, b.nodes[id].y]);
    }
    const seen = new Set(["home"]);
    const q = ["home"];
    while (q.length) for (const l of a.nodes[q.shift()!].links) if (!seen.has(l)) {
          seen.add(l);
          q.push(l);
        }
    expect(seen.size).toBe(Object.keys(a.nodes).length);
    // the neighbourhood is known on day one, the rest is fog
    const known = Object.values(a.nodes).filter((n) => n.known).length;
    expect(known).toBeGreaterThan(5);
    expect(known).toBeLessThan(Object.keys(a.nodes).length - 8);
  });
});

describe("iteration 3b: mornings and music", () => {
  it("residents gather for the morning coffee at the table, each in their own seat", () => {
    const w = startedWorld({ players: 1, seed: 91 });
    w.players.p0.online = false;
    let most = 0;
    let spread = 0;
    for (let i = 0; i < 20 * 120 && w.hour < 9; i++) {
      tickWorld(w, 0.05);
      w.fx = [];
      const at = Object.values(w.chars).filter((c) => c.task?.action === "morning_coffee");
      most = Math.max(most, at.length);
      if (at.length > 1) {
        const xs = at.map((c) => c.x).sort((a, b) => a - b);
        spread = Math.max(spread, Math.min(...xs.slice(1).map((x, k) => x - xs[k])));
      }
    }
    expect(most).toBeGreaterThanOrEqual(2);
    expect(spread).toBeGreaterThan(0.5);
  });

  it("a guitar gets its own stand and anyone can play it", () => {
    const w = startedWorld({ players: 1, seed: 92 });
    settleKeepsakes(w, ["guitar"]);
    const stand = objsOfKind(w, "guitar_stand")[0];
    expect(stand).toBeTruthy();
    const me = w.chars[w.players.p0.char!];
    placeAt(me, stand.x, stand.lv);
    expect(startAction(w, me, "play_guitar_stand", { type: "obj", id: stand.id })).toBeUndefined();
    expect(me.task?.action).toBe("play_guitar_stand");
  });
});
