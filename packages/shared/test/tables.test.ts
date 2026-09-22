import { describe, expect, it } from "vitest";
import { applyCmd, objsOfKind, privateView, publicView, startAction, tickWorld, type World } from "../src/index";
import { startedWorld } from "./helpers";

function seatAt(w: World, pid: string, table: string) {
  const c = w.chars[w.players[pid].char!];
  const o = w.objs[table];
  c.x = o.x + 0.5;
  c.lv = o.lv;
  c.y = o.lv * 2 + 2;
  const err = startAction(w, c, "sit_table", { type: "obj", id: table });
  expect(err).toBeUndefined();
}

describe("game table", () => {
  it("3 players + 1 bot play Durak to the end; a spectator sees no hidden cards", () => {
    const w = startedWorld({ players: 4, residents: 6, seed: 31 });
    const table = objsOfKind(w, "game_table")[0].id;
    for (const pid of ["p0", "p1", "p2"]) seatAt(w, pid, table);
    expect(applyCmd(w, "p0", { k: "tableInvite" })).toBeUndefined();
    expect(applyCmd(w, "p0", { k: "tableStart", game: "durak", opts: { variant: "podkidnoy" } })).toBeUndefined();
    const t = w.mods.tables[table];
    expect(t.status).toBe("playing");
    expect(t.state.players.length).toBe(4);

    // spectator p3: nothing private, public hands are counts only
    const spec = privateView(w, "p3") as any;
    expect(spec.mods.tables).toBeUndefined();
    const pub = publicView(w) as any;
    const hands = pub.mods.tables[table].view.hands;
    expect(Object.values(hands).every((x) => typeof x === "number")).toBe(true);
    // a seated player sees exactly their own hand
    const pv = privateView(w, "p1") as any;
    const me = w.players.p1.char!;
    expect(Array.isArray(pv.mods.tables.view.hands[me])).toBe(true);
    expect(Object.entries(pv.mods.tables.view.hands).filter(([, h]) => Array.isArray(h)).length).toBe(1);

    // humans play via tableMove using their legal moves; the bot plays by itself
    let guard = 0;
    while (w.mods.tables[table].status === "playing" && guard++ < 20000) {
      for (const pid of ["p0", "p1", "p2"]) {
        const v = privateView(w, pid) as any;
        const legal = v.mods.tables?.legal ?? [];
        if (!legal.length) continue;
        const pick = legal.find((m: any) => m.t === "beat") ?? legal.find((m: any) => m.t === "attack" && !w.mods.tables[table].state.table.length) ?? legal.find((m: any) => m.t === "pass") ?? legal.find((m: any) => m.t === "take") ?? legal[0];
        if (pick.t === "catch") continue;
        const err = applyCmd(w, pid, { k: "tableMove", move: pick });
        expect(err).toBeUndefined();
      }
      tickWorld(w, 0.1);
      w.fx = [];
    }
    expect(["over", "idle"]).toContain(w.mods.tables[table].status);
    expect(w.mods.tables[table].result).toBeTruthy();
  }, 60000);

  it("rejects illegal moves from humans", () => {
    const w = startedWorld({ players: 2, seed: 5 });
    const table = objsOfKind(w, "game_table")[0].id;
    seatAt(w, "p0", table);
    seatAt(w, "p1", table);
    applyCmd(w, "p0", { k: "tableStart", game: "durak" });
    expect(applyCmd(w, "p0", { k: "tableMove", move: { t: "attack", card: "ZZ" } })).toBeTruthy();
  });

  it("bots sit down and play among themselves", () => {
    const w = startedWorld({ players: 1, seed: 77 });
    const table = objsOfKind(w, "game_table")[0].id;
    const bots = Object.values(w.chars).filter((c) => !c.ctrl).slice(0, 3);
    for (const b of bots) {
      b.x = w.objs[table].x + 0.5;
      b.lv = w.objs[table].lv;
      b.mind.until = w.phaseT + 400;
      expect(startAction(w, b, "sit_table", { type: "obj", id: table })).toBeUndefined();
    }
    let started = false,
      finished = false;
    for (let i = 0; i < 20 * 400 && !finished; i++) {
      tickWorld(w, 0.05);
      w.fx = [];
      const t = w.mods.tables?.[table];
      if (t?.status === "playing") started = true;
      if (started && t?.result) finished = true;
    }
    expect(started).toBe(true);
    expect(finished).toBe(true);
  }, 60000);
});
