import { describe, expect, it } from "vitest";
import { addPlayer, applyCmd, createWorld, restartAgree, setOffline } from "../src/index";

const world = () => {
  const w = createWorld("TCHAT", 77, { skipPrologue: true });
  addPlayer(w, "tg_1", "Вера Г.");
  addPlayer(w, "tg_2", "Пётр С.");
  return w;
};

describe("Telegram chat bunkers", () => {
  it("members play as themselves: cards and residents carry their Telegram names", () => {
    const w = world();
    expect(w.players.tg_1.cards!.every((c) => c.name === "Вера Г." && c.tg)).toBe(true);
    applyCmd(w, "tg_1", { k: "pick", i: 1 });
    applyCmd(w, "tg_1", { k: "start" });
    const names = Object.values(w.chars).map((c) => c.card.name);
    expect(names).toContain("Вера Г.");
    expect(names).toContain("Пётр С.");
  });

  it("a member who leaves keeps their resident (a bot plays it); one who comes later gets their own", () => {
    const w = world();
    applyCmd(w, "tg_1", { k: "start" });
    const petr = w.players.tg_2.char!;
    setOffline(w, "tg_2");
    expect(w.chars[petr].ctrl).toBeNull();
    expect(w.players.tg_2.char).toBe(petr);
    const n = Object.keys(w.chars).length;
    addPlayer(w, "tg_3", "Лена К.");
    expect(Object.keys(w.chars).length).toBe(n + 1);
    expect(w.chars[w.players.tg_3.char!].card.name).toBe("Лена К.");
    // back again: the same resident, not a new one
    addPlayer(w, "tg_2", "Пётр С.");
    expect(w.players.tg_2.char).toBe(petr);
    expect(w.chars[petr].ctrl).toBe("tg_2");
  });

  it("«Начать заново» needs someone else's yes", () => {
    const w = world();
    applyCmd(w, "tg_1", { k: "start" });
    expect(applyCmd(w, "tg_1", { k: "restartAsk" })).toBeUndefined();
    expect(w.restart?.by).toBe("tg_1");
    expect(applyCmd(w, "tg_1", { k: "restartYes" })).toBeTruthy();
    expect(w.phase).not.toBe("lobby");
    // «против» closes the question
    applyCmd(w, "tg_2", { k: "restartNo" });
    expect(w.restart).toBeNull();
    applyCmd(w, "tg_1", { k: "restartAsk" });
    // a chat member (not in the game) agrees with the bot's button
    expect(restartAgree(w, "tg_99", "Гость")).toBeUndefined();
    expect(w.phase).toBe("lobby");
    expect(Object.keys(w.chars).length).toBe(0);
    expect(w.players.tg_1.cards?.length).toBe(3);
  });
});
