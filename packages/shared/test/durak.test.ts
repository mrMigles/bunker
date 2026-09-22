import { describe, expect, it } from "vitest";
import { Rng } from "../src/rng";
import { attackLimit, beats, deck36, durak, type DurakState } from "../src/boardgames/durak";
import { sameMove, tryMove } from "../src/boardgames/framework";

/** Builds a hand-crafted state for rule tests. */
function st(p: Partial<DurakState> & { hands: Record<string, string[]> }): DurakState {
  const players = p.players ?? Object.keys(p.hands);
  return {
    variant: "podkidnoy",
    players,
    deck: [],
    trump: "h",
    trumpCard: "6h",
    table: [],
    attacker: players[0],
    defender: players[1],
    passed: {},
    taking: false,
    boutStartDef: p.hands[players[1]].length,
    firstBout: false,
    out: [],
    discard: 0,
    over: false,
    loser: null,
    draw: false,
    log: [],
    ...p,
  };
}
const legal = (s: DurakState, p: string) => durak.legalMoves(s, p);
const has = (s: DurakState, p: string, m: any) => legal(s, p).some((x) => sameMove(x, m));
const play = (s: DurakState, p: string, m: any) => {
  const r = tryMove(durak, s, p, m);
  if (r.error) throw new Error(r.error + " " + JSON.stringify(m));
  return r.state;
};

describe("Durak: cards & beating", () => {
  it("deck has 36 unique cards", () => {
    const d = deck36();
    expect(d.length).toBe(36);
    expect(new Set(d).size).toBe(36);
  });
  it("higher card of the same suit beats", () => expect(beats("Ks", "Qs", "h")).toBe(true));
  it("lower card of the same suit does not beat", () => expect(beats("7s", "Qs", "h")).toBe(false));
  it("trump beats a non-trump", () => expect(beats("6h", "As", "h")).toBe(true));
  it("non-trump never beats a trump", () => expect(beats("As", "6h", "h")).toBe(false));
  it("higher trump beats a lower trump", () => expect(beats("Th", "9h", "h")).toBe(true));
  it("different non-trump suit does not beat", () => expect(beats("Ad", "6s", "h")).toBe(false));
  it("10 beats 9 (T rank ordering)", () => expect(beats("Ts", "9s", "c")).toBe(true));
});

describe("Durak: setup", () => {
  it("deals 6 cards each and leaves the rest in the deck", () => {
    const s = durak.setup(["a", "b", "c"], 1);
    for (const p of ["a", "b", "c"]) expect(s.hands[p].length).toBe(6);
    expect(s.deck.length).toBe(18);
  });
  it("trump is the suit of the bottom card", () => {
    const s = durak.setup(["a", "b"], 2);
    expect(s.trump).toBe(s.deck[s.deck.length - 1][1]);
  });
  it("with 6 players the deck is empty and trump comes from the last dealt card", () => {
    const s = durak.setup(["a", "b", "c", "d", "e", "f"], 3);
    expect(s.deck.length).toBe(0);
    expect(s.trump).toBe(s.hands.f[5][1]);
  });
  it("first attacker holds the lowest trump", () => {
    const s = durak.setup(["a", "b", "c", "d"], 4);
    let low = 99,
      who = "";
    for (const p of s.players) for (const c of s.hands[p]) if (c[1] === s.trump && "6789TJQKA".indexOf(c[0]) < low) ((low = "6789TJQKA".indexOf(c[0])), (who = p));
    if (who) expect(s.attacker).toBe(who);
  });
  it("defender is the next player after the attacker", () => {
    const s = durak.setup(["a", "b", "c"], 5);
    const i = s.players.indexOf(s.attacker);
    expect(s.defender).toBe(s.players[(i + 1) % 3]);
  });
  it("first bout allows at most 5 attack cards", () => {
    const s = durak.setup(["a", "b"], 6);
    expect(attackLimit(s)).toBe(5);
  });
});

describe("Durak: attacking & throwing in", () => {
  it("only the main attacker opens the bout", () => {
    const s = st({ hands: { a: ["7s"], b: ["8s"], c: ["9s"] } });
    expect(has(s, "a", { t: "attack", card: "7s" })).toBe(true);
    expect(legal(s, "c").length).toBe(0);
  });
  it("throw-in must match a rank on the table", () => {
    let s = st({ hands: { a: ["7s", "7d", "9c"], b: ["8s", "Ks", "Ah"], c: ["7c", "Tc"] } });
    s = play(s, "a", { t: "attack", card: "7s" });
    expect(has(s, "a", { t: "attack", card: "7d" })).toBe(true);
    expect(has(s, "a", { t: "attack", card: "9c" })).toBe(false);
    expect(has(s, "c", { t: "attack", card: "7c" })).toBe(true);
    expect(has(s, "c", { t: "attack", card: "Tc" })).toBe(false);
  });
  it("defender's beating card rank also opens throw-ins", () => {
    let s = st({ hands: { a: ["7s", "8d"], b: ["8s", "Ks"] } });
    s = play(s, "a", { t: "attack", card: "7s" });
    s = play(s, "b", { t: "beat", card: "8s", i: 0 });
    expect(has(s, "a", { t: "attack", card: "8d" })).toBe(true);
  });
  it("cannot throw in more cards than the defender holds", () => {
    let s = st({ hands: { a: ["7s", "7d", "7c"], b: ["As", "Ad"] } });
    s = play(s, "a", { t: "attack", card: "7s" });
    s = play(s, "a", { t: "attack", card: "7d" });
    expect(has(s, "a", { t: "attack", card: "7c" })).toBe(false);
  });
  it("cannot exceed 6 attack cards in a bout", () => {
    const s = st({ hands: { a: ["7c", "8d"], b: ["Ac", "Ah", "Kc", "Kh", "Qh", "Jh", "Th"] }, trump: "h", boutStartDef: 9 });
    s.table = ["6s", "6d", "6c", "7s", "7d", "8s"].map((a, i) => ({ a, d: ["As", "Ad", "Qc", "Ks", "Kd", "9s"][i], by: "a" }));
    expect(attackLimit(s)).toBe(6);
    expect(has(s, "a", { t: "attack", card: "7c" })).toBe(false);
    s.table.pop();
    expect(has(s, "a", { t: "attack", card: "7c" })).toBe(true);
  });
  it("the defender cannot throw in", () => {
    let s = st({ hands: { a: ["7s"], b: ["7d", "8s"] } });
    s = play(s, "a", { t: "attack", card: "7s" });
    expect(legal(s, "b").some((m) => m.t === "attack")).toBe(false);
  });
});

describe("Durak: defending", () => {
  it("defender can take", () => {
    let s = st({ hands: { a: ["7s", "9d"], b: ["6c"] } });
    s = play(s, "a", { t: "attack", card: "7s" });
    expect(has(s, "b", { t: "take" })).toBe(true);
  });
  it("beating offers only valid cards", () => {
    let s = st({ hands: { a: ["Qs"], b: ["Ks", "7s", "Ad", "6h"] }, trump: "h" });
    s = play(s, "a", { t: "attack", card: "Qs" });
    const beatsCards = legal(s, "b").filter((m) => m.t === "beat").map((m: any) => m.card).sort();
    expect(beatsCards).toEqual(["6h", "Ks"]);
  });
  it("all beaten + attackers pass → discard and defender attacks next", () => {
    let s = st({ hands: { a: ["7s", "9d"], b: ["8s", "Ad"], c: ["6c", "Tc"] }, players: ["a", "b", "c"] });
    s = play(s, "a", { t: "attack", card: "7s" });
    s = play(s, "b", { t: "beat", card: "8s", i: 0 });
    // nobody can throw in → the bout closes by itself
    expect(s.table.length).toBe(0);
    expect(s.discard).toBe(2);
    expect(s.attacker).toBe("b");
    expect(s.defender).toBe("c");
  });
  it("after taking, the defender skips attacking", () => {
    let s = st({ hands: { a: ["7s", "9d"], b: ["6c", "Ad"], c: ["6d", "Tc"] }, players: ["a", "b", "c"] });
    s = play(s, "a", { t: "attack", card: "7s" });
    s = play(s, "b", { t: "take" });
    expect(s.hands.b).toContain("7s");
    expect(s.attacker).toBe("c");
    expect(s.defender).toBe("a");
  });
  it("attackers may throw in after the defender decides to take", () => {
    let s = st({ hands: { a: ["7s", "7d", "7c", "9c"], b: ["6c", "Ad", "8c"] } });
    s = play(s, "a", { t: "attack", card: "7s" });
    s = play(s, "b", { t: "take" });
    expect(has(s, "a", { t: "attack", card: "7d" })).toBe(true);
    s = play(s, "a", { t: "attack", card: "7d" });
    expect(s.table.length).toBe(2);
    s = play(s, "a", { t: "pass" });
    expect(s.hands.b).toEqual(expect.arrayContaining(["7s", "7d"]));
  });
  it("refill order: attacker draws first, defender last", () => {
    let s = st({ hands: { a: ["7s"], b: ["8s"] }, deck: ["Ac", "Kc", "Qc"], trumpCard: "Qc" });
    s = play(s, "a", { t: "attack", card: "7s" });
    s = play(s, "b", { t: "beat", card: "8s", i: 0 });
    expect(s.hands.a).toEqual(["Ac", "Kc", "Qc"].slice(0, s.hands.a.length));
    expect(s.hands.a.length + s.hands.b.length).toBe(3);
  });
  it("bout ends automatically when attackers have nothing to throw", () => {
    let s = st({ hands: { a: ["7s", "Ad"], b: ["8s", "Kc"] }, deck: ["6d", "6c", "9c", "9d"] });
    s = play(s, "a", { t: "attack", card: "7s" });
    s = play(s, "b", { t: "beat", card: "8s", i: 0 });
    expect(s.table.length).toBe(0);
  });
});

describe("Durak: transfer (переводной)", () => {
  it("defender can transfer with a card of the same rank", () => {
    let s = st({ variant: "perevodnoy", players: ["a", "b", "c"], hands: { a: ["7s", "9d"], b: ["7d", "Ad"], c: ["6c", "Tc", "Jc"] } });
    s = play(s, "a", { t: "attack", card: "7s" });
    expect(has(s, "b", { t: "transfer", card: "7d" })).toBe(true);
    s = play(s, "b", { t: "transfer", card: "7d" });
    expect(s.defender).toBe("c");
    expect(s.attacker).toBe("b");
    expect(s.table.length).toBe(2);
  });
  it("no transfer in podkidnoy", () => {
    let s = st({ players: ["a", "b", "c"], hands: { a: ["7s"], b: ["7d"], c: ["6c", "Tc"] } });
    s = play(s, "a", { t: "attack", card: "7s" });
    expect(legal(s, "b").some((m) => m.t === "transfer")).toBe(false);
  });
  it("cannot transfer once a card is beaten", () => {
    let s = st({ variant: "perevodnoy", players: ["a", "b", "c"], hands: { a: ["7s", "7c"], b: ["8s", "7d", "Ah"], c: ["6c", "Tc", "Jc"] } });
    s = play(s, "a", { t: "attack", card: "7s" });
    s = play(s, "b", { t: "beat", card: "8s", i: 0 });
    s = play(s, "a", { t: "attack", card: "7c" });
    expect(legal(s, "b").some((m) => m.t === "transfer")).toBe(false);
  });
  it("cannot transfer if the next defender has too few cards", () => {
    let s = st({ variant: "perevodnoy", players: ["a", "b", "c"], hands: { a: ["7s"], b: ["7d", "Ad"], c: ["6c"] } });
    s = play(s, "a", { t: "attack", card: "7s" });
    expect(legal(s, "b").some((m) => m.t === "transfer")).toBe(false);
  });
});

describe("Durak: endgame", () => {
  it("player with no cards and empty deck is out; last holder is the durak", () => {
    let s = st({ hands: { a: ["7s"], b: ["8s", "9c"] } });
    s = play(s, "a", { t: "attack", card: "7s" });
    s = play(s, "b", { t: "beat", card: "8s", i: 0 });
    expect(s.over).toBe(true);
    expect(s.loser).toBe("b");
    expect(durak.result(s).losers).toEqual(["b"]);
  });
  it("both empty at the same time → draw", () => {
    let s = st({ hands: { a: ["7s"], b: ["8s"] } });
    s = play(s, "a", { t: "attack", card: "7s" });
    s = play(s, "b", { t: "beat", card: "8s", i: 0 });
    expect(s.over).toBe(true);
    expect(s.draw).toBe(true);
    expect(durak.result(s).draw).toBe(true);
  });
  it("no moves after the game is over", () => {
    let s = st({ hands: { a: ["7s"], b: ["8s"] } });
    s = play(s, "a", { t: "attack", card: "7s" });
    s = play(s, "b", { t: "beat", card: "8s", i: 0 });
    expect(legal(s, "a").length + legal(s, "b").length).toBe(0);
  });
  it("finished players are skipped for the next bout", () => {
    let s = st({ players: ["a", "b", "c"], hands: { a: ["7s"], b: ["8s", "Kd"], c: ["6c", "Tc"] } });
    s = play(s, "a", { t: "attack", card: "7s" });
    s = play(s, "b", { t: "beat", card: "8s", i: 0 });
    // a is out; c can throw? nothing matches → auto end
    expect(s.out).toContain("a");
    expect(s.attacker).toBe("b");
    expect(s.defender).toBe("c");
  });
});

describe("Durak: hidden information & cheating", () => {
  it("a player sees only their own hand; spectators see none", () => {
    const s = durak.setup(["a", "b", "c"], 11);
    const va = durak.viewFor(s, "a");
    expect(Array.isArray(va.hands.a)).toBe(true);
    expect(typeof va.hands.b).toBe("number");
    const spec = durak.viewFor(s, null);
    expect(Object.values(spec.hands).every((x) => typeof x === "number")).toBe(true);
    expect(JSON.stringify(spec)).not.toContain(s.hands.a[0] + '"');
  });
  it("catching a cheat makes the defender take the table", () => {
    let s = st({ hands: { a: ["Qs", "7d", "9d"], b: ["7s", "Ad", "Kc"] } });
    s = play(s, "a", { t: "attack", card: "Qs" });
    const r = tryMove(durak, s, "b", { t: "beat", card: "7s", i: 0, cheat: true }, true);
    s = r.state;
    expect(s.table[0].cheat).toBe(true);
    s = play(s, "a", { t: "catch", i: 0 });
    expect(s.taking).toBe(true);
    expect(s.hands.b).toContain("7s");
  });
  it("an illegal human move is rejected", () => {
    let s = st({ hands: { a: ["Qs"], b: ["7s", "Ad"] } });
    s = play(s, "a", { t: "attack", card: "Qs" });
    expect(tryMove(durak, s, "b", { t: "beat", card: "7s", i: 0 }).error).toBeTruthy();
  });
});

describe("Durak: bots", () => {
  it("bots never make illegal moves in 1000 simulated games (2–6 players, both variants)", () => {
    const rng = new Rng([1, 2, 3, 4]);
    let games = 0,
      moves = 0,
      draws = 0;
    for (let g = 0; g < 1000; g++) {
      const n = 2 + (g % 5);
      const players = Array.from({ length: n }, (_, i) => "p" + i);
      let s = durak.setup(players, g * 7919 + 1, { variant: g % 2 ? "perevodnoy" : "podkidnoy" });
      let guard = 0;
      while (!s.over && guard++ < 2000) {
        const who = durak.toAct(s);
        expect(who.length, JSON.stringify(durak.viewFor(s, null))).toBeGreaterThan(0);
        let acted = false;
        for (const p of who) {
          const m = durak.botMove(s, p, (g % 10) / 10, rng, false);
          if (!m) continue;
          const r = tryMove(durak, s, p, m);
          expect(r.error, `${p} ${JSON.stringify(m)}`).toBeNull();
          s = r.state;
          moves++;
          acted = true;
          break;
        }
        if (!acted) {
          // a defender that is taking waits for passes; everyone else passes
          const p = who[0];
          const r = tryMove(durak, s, p, { t: "pass" });
          if (r.error) {
            const t = tryMove(durak, s, p, { t: "take" });
            expect(t.error).toBeNull();
            s = t.state;
          } else s = r.state;
        }
      }
      expect(s.over).toBe(true);
      // card conservation
      const total = Object.values(s.hands).reduce((a, h) => a + h.length, 0) + s.deck.length + s.discard + s.table.reduce((a, t) => a + (t.d ? 2 : 1), 0);
      expect(total).toBe(36);
      games++;
      if (s.draw) draws++;
    }
    expect(games).toBe(1000);
    expect(moves).toBeGreaterThan(10000);
    expect(draws).toBeLessThan(500);
  }, 120000);
});
