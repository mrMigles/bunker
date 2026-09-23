import { describe, expect, it } from "vitest";
import { applyCmd, charUnit, combatBonuses, grantXp, makeUnit, xpForLevel } from "../src/index";
import { run, startedWorld } from "./helpers";

describe("progression", () => {
  it("experience levels a player up; the player picks one of three perks and it applies in combat", () => {
    const w = startedWorld({ players: 1 });
    const c = w.chars[w.players.p0.char!];
    expect(c.level ?? 1).toBe(1);
    grantXp(c, xpForLevel(2) + 1);
    run(w, 1);
    expect(c.level).toBe(2);
    expect(c.perkOffer?.length).toBe(3);
    // the player chooses «Проворный» if offered, otherwise the first one
    const pick = c.perkOffer!.includes("quick") ? "quick" : c.perkOffer![0];
    expect(applyCmd(w, "p0", { k: "perkPick", perk: pick })).toBeUndefined();
    expect(c.perks).toContain(pick);
    expect(c.perkOffer).toBeUndefined();
    // levels add combat HP
    const unit = makeUnit(charUnit(w, c, 1, 0, {}));
    const base = 20 + c.card.stats.vyn * 4;
    expect(unit.maxHp).toBeGreaterThanOrEqual(base + 1);
    if (pick === "quick") expect(unit.maxAp).toBe(4);
  });

  it("several levels at once queue their perk choices", () => {
    const w = startedWorld({ players: 1 });
    const c = w.chars[w.players.p0.char!];
    grantXp(c, xpForLevel(4) + 1);
    run(w, 1);
    expect(c.level).toBe(4);
    applyCmd(w, "p0", { k: "perkPick", perk: c.perkOffer![0] });
    expect(c.perkOffer?.length).toBe(3);
    applyCmd(w, "p0", { k: "perkPick", perk: c.perkOffer![0] });
    applyCmd(w, "p0", { k: "perkPick", perk: c.perkOffer![0] });
    expect(c.perks?.length).toBe(3);
    expect(new Set(c.perks).size).toBe(3);
  });

  it("bots choose their own perks; work earns experience over a day", () => {
    const w = startedWorld({ players: 1 });
    w.players.p0.online = false;
    const bot = Object.values(w.chars).find((c) => !c.ctrl)!;
    grantXp(bot, xpForLevel(2) + 1);
    run(w, 1);
    expect(bot.perks?.length).toBe(1);
    const before = Object.values(w.chars).reduce((a, c) => a + (c.xp ?? 0), 0);
    run(w, 200);
    const after = Object.values(w.chars).reduce((a, c) => a + (c.xp ?? 0), 0);
    expect(after).toBeGreaterThan(before);
  });

  it("perk bonuses", () => {
    const w = startedWorld({ players: 1 });
    const c = w.chars[w.players.p0.char!];
    c.perks = ["marksman", "sturdy"];
    c.level = 3;
    const b = combatBonuses(c);
    expect(b.aimBonus).toBeGreaterThanOrEqual(10);
    expect(b.hpBonus).toBe(2 + 8);
  });
});
