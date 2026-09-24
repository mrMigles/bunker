import { describe, expect, it } from "vitest";
import { addPlayer, applyCmd, charUnit, createWorld, validateCustomCard } from "../src/index";
import { startedWorld } from "./helpers";

describe("iteration 4: gear, passing things, the character editor", () => {
  it("a resident wears their own weapon from the storage and fights with it", () => {
    const w = startedWorld({ players: 1, seed: 101 });
    const me = w.chars[w.players.p0.char!];
    w.res.rifle = 1;
    expect(applyCmd(w, "p0", { k: "equip", char: me.id, slot: "weapon", item: "rifle" })).toBeUndefined();
    expect(me.equip?.weapon).toBe("rifle");
    expect(w.res.rifle).toBe(0);
    expect(charUnit(w, me, 0, 0, {}).weapon).toBe("rifle");
    // taking it off returns it to the storage
    expect(applyCmd(w, "p0", { k: "equip", char: me.id, slot: "weapon", item: "" })).toBeUndefined();
    expect(w.res.rifle).toBe(1);
    expect(applyCmd(w, "p0", { k: "equip", char: me.id, slot: "armor", item: "rifle" })).toBeTruthy();
  });

  it("companions can be dressed and handed things when standing close", () => {
    const w = startedWorld({ players: 1, seed: 102 });
    const me = w.chars[w.players.p0.char!];
    const bot = Object.values(w.chars).find((c) => !c.ctrl)!;
    Object.assign(bot, { x: me.x + 1, lv: me.lv, y: me.y });
    me.hands = [{ item: "food_can", n: 2 }];
    expect(applyCmd(w, "p0", { k: "handGive", from: me.id, to: bot.id, i: 0 })).toBeUndefined();
    expect(bot.hands[0]?.item).toBe("food_can");
    bot.x = me.x + 12;
    expect(applyCmd(w, "p0", { k: "handGive", from: bot.id, to: me.id, i: 0 })).toMatch(/ближе/);
    w.res.pipe = 2;
    expect(applyCmd(w, "p0", { k: "equip", char: bot.id, slot: "weapon", item: "pipe" })).toBeUndefined();
  });

  it("a custom character: validated, picked, and plays with its own looks", () => {
    expect(typeof validateCustomCard({ name: "X", prof: "doctor" }, "")).toBe("string");
    const tooStrong = validateCustomCard({ name: "Анна Сталь", prof: "soldier", plus: "tough", minus: "coward", stats: { sil: 5, lov: 5, int: 5, vyn: 5, har: 5 } }, "");
    expect(typeof tooStrong).toBe("string");
    const w = createWorld("CUSTOM", 7, { skipPrologue: true, residents: 1 });
    addPlayer(w, "p0", "Я");
    const card = { name: "Анна Сталь", prof: "soldier", plus: "tough", minus: "coward", stats: { sil: 4, lov: 3, int: 2, vyn: 3, har: 2 }, color: 0x3d6b8c, hat: 13, skin: 4, hair: 3, gender: 1, age: 33 };
    expect(applyCmd(w, "p0", { k: "customCard", card })).toBeUndefined();
    expect(w.players.p0.pick).toBe(3);
    applyCmd(w, "p0", { k: "start" });
    const me = w.chars[w.players.p0.char!];
    expect(me.card.name).toBe("Анна Сталь");
    expect(me.card.skin).toBe(4);
    expect(me.card.hat).toBe(13);
    expect(me.card.goal).toBeTruthy();
  });
});
