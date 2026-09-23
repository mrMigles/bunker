import { describe, expect, it } from "vitest";
import { GAMES, Rng, cmpVal, handValue, tryMove } from "../src/index";
import "../src/sim/tables";

function playOut(id: string, n: number, seed: number, maxMoves = 5000) {
  const g = GAMES[id];
  const players = Array.from({ length: n }, (_, i) => "c" + (i + 1));
  let s = g.setup(players, seed, {});
  const rng = Rng.from(seed + 1);
  let moves = 0;
  while (!g.isOver(s) && moves < maxMoves) {
    const acts = g.toAct(s);
    expect(acts.length).toBeGreaterThan(0);
    const p = acts[0];
    const legal = g.legalMoves(s, p);
    expect(legal.length).toBeGreaterThan(0);
    const m = g.botMove(s, p, rng.next(), rng) ?? legal[0];
    const r = tryMove(g, s, p, m);
    expect(r.error, `${id}: ${JSON.stringify(m)}`).toBeNull();
    s = r.state;
    moves++;
  }
  expect(g.isOver(s), `${id} did not finish in ${maxMoves}`).toBe(true);
  const res = g.result(s);
  expect(res.winners.length + res.losers.length).toBeGreaterThan(0);
  return { s, res, moves };
}

describe("every board game plays to the end with bots", () => {
  const cases: [string, number[]][] = [
    ["drunkard", [2, 4]],
    ["cheat", [2, 4, 6]],
    ["poker", [2, 4, 6]],
    ["generala", [1, 3]],
    ["domino", [2, 4]],
    ["backgammon", [2]],
    ["lotto", [2, 6]],
    ["magnate", [2, 5]],
    ["checkers", [2]],
    ["chess", [2]],
    ["wasteland", [1, 4]],
    ["mafia", [4, 6, 8]],
  ];
  for (const [id, counts] of cases)
    it(id, () => {
      expect(GAMES[id], id).toBeTruthy();
      for (const n of counts) for (const seed of [1, 7, 42]) playOut(id, n, seed * 101 + n, id === "chess" ? 600 : 5000);
    }, 120000);
});

describe("rules", () => {
  it("poker hand ranking", () => {
    const flush = handValue(["2h", "7h", "9h", "Jh", "Kh", "3s", "4d"]);
    const straight = handValue(["5s", "6d", "7h", "8c", "9s", "2d", "Kd"]);
    const wheel = handValue(["As", "2d", "3h", "4c", "5s", "Kd", "Kh"]);
    const full = handValue(["Ks", "Kd", "Kh", "2c", "2s", "7d", "9h"]);
    expect(cmpVal(flush, straight)).toBeGreaterThan(0);
    expect(cmpVal(full, flush)).toBeGreaterThan(0);
    expect(wheel[0]).toBe(4);
    expect(cmpVal(straight, wheel)).toBeGreaterThan(0);
  });

  it("poker chips are conserved and hidden cards stay hidden", () => {
    const { s } = playOut("poker", 4, 99);
    expect(Object.values(s.chips as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(400);
    const g = GAMES.poker;
    const fresh = g.setup(["a", "b", "c"], 5, {});
    const v = g.viewFor(fresh, "a");
    expect(Array.isArray(v.hands.a)).toBe(true);
    expect(typeof v.hands.b).toBe("number");
    expect(typeof g.viewFor(fresh, null).hands.a).toBe("number");
  });

  it("chess: fool's mate, castling, en passant", () => {
    const g = GAMES.chess;
    let s = g.setup(["w", "b"], 1);
    const sq = (n: string) => (8 - Number(n[1])) * 8 + "abcdefgh".indexOf(n[0]);
    const mv = (p: string, a: string, b: string) => {
      const r = tryMove(g, s, p, { t: "move", from: sq(a), to: sq(b) });
      expect(r.error, `${a}-${b}`).toBeNull();
      s = r.state;
    };
    mv("w", "f2", "f3");
    mv("b", "e7", "e5");
    mv("w", "g2", "g4");
    mv("b", "d8", "h4");
    expect(g.isOver(s)).toBe(true);
    expect(g.result(s).winners).toEqual(["b"]);

    s = g.setup(["w", "b"], 1);
    mv("w", "e2", "e4");
    mv("b", "a7", "a6");
    mv("w", "e4", "e5");
    mv("b", "d7", "d5");
    mv("w", "e5", "d6"); // en passant
    expect(s.b[sq("d5")]).toBe(".");
    mv("b", "a6", "a5");
    mv("w", "g1", "f3");
    mv("b", "a5", "a4");
    mv("w", "f1", "e2");
    mv("b", "a4", "a3");
    mv("w", "e1", "g1"); // O-O
    expect(s.b[sq("f1")]).toBe("R");
    expect(s.b[sq("g1")]).toBe("K");
    // illegal: moving a pinned/nonexistent piece
    expect(tryMove(g, s, "b", { t: "move", from: sq("e8"), to: sq("e6") }).error).toBeTruthy();
  });

  it("checkers: capture is mandatory and multi-jumps are one move", () => {
    const g = GAMES.checkers;
    const s = g.setup(["w", "b"], 1);
    s.b = Array(64).fill(".");
    const sq = (n: string) => (8 - Number(n[1])) * 8 + "abcdefgh".indexOf(n[0]);
    s.b[sq("c3")] = "w";
    s.b[sq("g3")] = "w";
    s.b[sq("d4")] = "b";
    s.b[sq("d6")] = "b";
    s.b[sq("h8")] = "b";
    const legal = g.legalMoves(s, "w").filter((m: any) => m.t === "move");
    // only the capture c3:e5:c7 is allowed (quiet g3-h4 is not)
    expect(legal.length).toBe(1);
    expect(legal[0].path).toEqual([sq("c3"), sq("e5"), sq("c7")]);
    const r = tryMove(g, s, "w", legal[0]);
    expect(r.state.b.filter((x: string) => x === "b").length).toBe(1);
  });

  it("cheat: a lie caught makes the liar take the pile", () => {
    const g = GAMES.cheat;
    const s = g.setup(["a", "b"], 3);
    s.hands.a = ["6s", "7s", "8d"];
    s.hands.b = ["9s", "Ts"];
    let r = tryMove(g, s, "a", { t: "play", cards: ["6s", "7s"], rank: "6" });
    expect(r.error).toBeNull();
    // b sees only counts of a's hand
    expect(g.viewFor(r.state, "b").hand).toEqual(["9s", "Ts"]);
    r = tryMove(g, r.state, "b", { t: "doubt" });
    expect(r.state.hands.a.length).toBe(3);
    expect(r.state.reveal.lie).toBe(true);
  });

  it("mafia keeps roles secret", () => {
    const g = GAMES.mafia;
    const s = g.setup(["a", "b", "c", "d", "e", "f"], 11);
    const mafia = Object.keys(s.roles).filter((p) => s.roles[p] === "mafia");
    expect(mafia.length).toBe(2);
    const civ = Object.keys(s.roles).find((p) => s.roles[p] === "civ")!;
    const v = g.viewFor(s, civ);
    expect(Object.keys(v.known)).toEqual([civ]);
    const mv = g.viewFor(s, mafia[0]);
    expect(Object.keys(mv.known).sort()).toEqual([...mafia].sort());
    expect(Object.keys(g.viewFor(s, null).known)).toEqual([]);
  });

  it("nardy: only one checker leaves the head per turn (except first 6-6/4-4/3-3)", () => {
    const g = GAMES.backgammon;
    const s = g.setup(["w", "b"], 2);
    s.firstTurn.w = false;
    s.rolled = [5, 2];
    s.dice = [5, 2];
    const legal = g.legalMoves(s, "w");
    expect(legal.every((m: any) => m.from === 0)).toBe(true);
    const r = tryMove(g, s, "w", legal[0]);
    expect(g.legalMoves(r.state, "w").every((m: any) => m.from !== 0)).toBe(true);
  });

  it("generala scoring", async () => {
    const { generalaScore } = await import("../src/boardgames/dicegames");
    expect(generalaScore([2, 3, 4, 5, 6], "straight", false)).toBe(20);
    expect(generalaScore([3, 3, 3, 5, 5], "full", true)).toBe(35);
    expect(generalaScore([6, 6, 6, 6, 6], "generala", false)).toBe(50);
    expect(generalaScore([6, 6, 1, 6, 2], "6", false)).toBe(18);
  });
});

describe("poker evaluator on partial hands", () => {
  it("two suited cards are not a flush; a pocket pair is a pair", () => {
    expect(handValue(["Jh", "8h"])[0]).toBe(0);
    expect(handValue(["8s", "8h"])[0]).toBe(1);
    expect(handValue(["8s", "8h", "8d", "Kd", "Kh"])[0]).toBe(6);
  });
});
