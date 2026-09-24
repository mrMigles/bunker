import { describe, expect, it } from "vitest";
import { EVENTS, EVENT_BY_ID, applyCmd, condOk, makeVote, pickEvent, resolveVote, applyEffect, tickWorld, voteWinner, rollCheck } from "../src/index";
import { runDays, startedWorld } from "./helpers";

describe("events engine", () => {
  it("has at least 40 events with valid structure", () => {
    expect(EVENTS.length).toBeGreaterThanOrEqual(40);
    const ids = new Set<string>();
    for (const e of EVENTS) {
      expect(ids.has(e.id), `duplicate ${e.id}`).toBe(false);
      ids.add(e.id);
      expect(e.title).toBeTruthy();
      expect(e.options?.length || e.auto?.length).toBeGreaterThan(0);
    }
    for (const cat of ["door", "internal", "radio", "world", "moral", "absurd", "ark"]) expect(EVENTS.some((e) => e.cat === cat)).toBe(true);
    // every timer target exists
    for (const e of EVENTS)
      for (const o of e.options ?? []) for (const ef of [...(o.effects ?? []), ...(o.fail ?? [])]) if (ef.timer) expect(EVENT_BY_ID[ef.timer.event], ef.timer.event).toBeTruthy();
  });

  it("five nights in a row give different events", () => {
    const w = startedWorld({ seed: 777 });
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      runDays(w, 1);
      const last = w.history.filter((h) => h.day === w.day - 1).pop();
      seen.push(last?.id ?? "");
    }
    const distinct = new Set(seen.filter(Boolean));
    expect(distinct.size).toBeGreaterThanOrEqual(4);
  }, 60000);

  it("conditions gate events", () => {
    const w = startedWorld();
    w.day = 1;
    expect(condOk(w, { minDay: 3 })).toBe(false);
    w.day = 5;
    expect(condOk(w, { minDay: 3 })).toBe(true);
    expect(condOk(w, { notFlag: "child_taken" })).toBe(true);
    w.flags.child_taken = 1;
    expect(condOk(w, { notFlag: "child_taken" })).toBe(false);
    expect(condOk(w, { hasRoom: "hydro" })).toBe(true);
    expect(condOk(w, { hasRoom: "chapel" })).toBe(false);
    w.pet = { kind: "dog", name: "x", x: 20, lv: 0, mood: 50, fed: 50, anim: "idle" };
    expect(condOk(w, { noPet: true })).toBe(false);
  });

  it("chains via timers: numbers station → ark_2 two days later", () => {
    const w = startedWorld();
    w.day = 5;
    const e = EVENT_BY_ID.radio_numbers;
    const v = makeVote(w, e, 0, 30);
    v.result = 0;
    resolveVote(w, v);
    expect(w.flags.numbers_heard).toBe(1);
    expect(w.timers.some((t) => t.data === "ark_2" && t.at === 7)).toBe(true);
    w.day = 6;
    expect(pickEvent(w, "night")?.id).not.toBe("ark_2");
    w.day = 7;
    expect(pickEvent(w, "night")?.id).toBe("ark_2");
  });

  it("voting: majority wins, elder breaks ties, costs are paid", () => {
    const w = startedWorld({ players: 3 });
    const v = makeVote(w, EVENT_BY_ID.door_trader, 0, 30);
    v.votes = { p0: 0, p1: 3, p2: 3 };
    expect(voteWinner(w, v)).toBe(3);
    v.votes = { p0: 0, p1: 3 };
    w.elder = "p0";
    expect(voteWinner(w, v)).toBe(0);
    const scrap = w.res.scrap;
    const cans = w.res.food_can;
    v.result = 0;
    resolveVote(w, v);
    expect(w.res.scrap).toBe(scrap - 10);
    expect(w.res.food_can).toBe(cans + 4);
  });

  it("admitting a stranger adds an NPC resident and ghosts take it", () => {
    const w = startedWorld({ players: 1, residents: 1 });
    const n = Object.keys(w.chars).length;
    const me = w.chars[w.players.p0.char!];
    me.status = "dead";
    w.players.p0.char = null;
    w.players.p0.ghost = true;
    applyEffect(w, { addNpc: "child" });
    expect(Object.keys(w.chars).length).toBe(n + 1);
    const npc = Object.values(w.chars).find((c) => c.npc)!;
    expect(npc.card.prof).toBe("child");
    expect(w.players.p0.char).toBe(npc.id);
    expect(w.players.p0.ghost).toBe(false);
  });

  it("d20 checks are deterministic for a seed", () => {
    const a = startedWorld({ seed: 5 });
    const b = startedWorld({ seed: 5 });
    expect(rollCheck(a, { stat: "har", dc: 12 })).toEqual(rollCheck(b, { stat: "har", dc: 12 }));
  });

  it("day events fire during the day", () => {
    const w = startedWorld({ seed: 99, dayLength: 120 });
    w.day = 6;
    for (let i = 0; i < 20 * 600 && !w.stats.events.length && !w.vote; i++) {
      // a lone player: the council waits for «Готов»
      if (w.phase === "night" && w.council) for (const pid in w.players) w.council.ready[pid] = true;
      tickWorld(w, 0.05);
      w.fx = [];
      if (Object.keys(w.flags).some((k) => /^_(leak|wiring|bulb)_/.test(k)) || Object.keys(w.flags).some((k) => k.startsWith("_ev_day"))) break;
    }
    const fired = Object.keys(w.flags).some((k) => k.startsWith("_ev_")) || !!w.vote;
    expect(fired).toBe(true);
    void applyCmd;
  }, 60000);
});
