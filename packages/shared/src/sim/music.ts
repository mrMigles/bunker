import { sanityGainMult } from "./needs";
import type { World } from "../types";
import { defAction } from "./actions";
import { registerCmd } from "./commands";
import { company } from "./leisure";
import { timeMult } from "./time";
import { clamp, fx, hoursPerSec, isBotDriven } from "./util";

// Playing an instrument: the client sends notes (quantised to a scale client-side, so nothing sounds wrong);
// the server relays them to everyone and rewards jamming.

function instrumentTick(w: World, c: any, dt: number, base: number) {
  const h = dt * hoursPerSec(w) * timeMult(w);
  // how many people are playing right now (jam)
  let players = 0;
  for (const id in w.chars) {
    const o = w.chars[id];
    if (o.task && ["play_guitar", "play_guitar_stand", "play_piano", "play_harmonica"].includes(o.task.action) && o.lv === c.lv && Math.abs(o.x - c.x) < 6) players++;
  }
  const jam = players > 1 ? 1 + (players - 1) * 0.6 : 1;
  c.needs.sanity = clamp(c.needs.sanity + base * jam * sanityGainMult(c.needs.sanity) * h);
  // listeners around enjoy it too
  for (const id in w.chars) {
    const o = w.chars[id];
    if (o.id !== c.id && o.status === "ok" && o.lv === c.lv && Math.abs(o.x - c.x) < 5) o.needs.sanity = clamp(o.needs.sanity + 2 * jam * h);
  }
  // bots strum automatically
  if (isBotDriven(w, c.id)) {
    w.flags._strum = (w.flags._strum ?? 0) + dt;
    if (w.flags._strum > 0.45) {
      w.flags._strum = 0;
      const n = [0, 2, 4, 7, 9, 12, 9, 7][Math.floor(w.phaseT * 2.2) % 8];
      fx(w, { k: "music", x: c.x, lv: c.lv, data: { n, inst: c.task?.action === "play_piano" ? "piano" : "guitar", who: c.id } });
    }
    if (w.phaseT > (c.mind.until ?? 0)) return true;
  }
  void company;
  return false;
}

defAction({
  id: "play_guitar",
  type: "self",
  prio: 20,
  avail: ({ c }) => (c.hands.some((h) => h.item === "guitar") ? "🎸 Играть на гитаре" : null),
  dur: () => 0,
  anim: "guitar",
  tick: ({ w, c }, dt) => instrumentTick(w, c, dt, 10),
});

defAction({
  id: "play_harmonica",
  type: "self",
  prio: 21,
  avail: ({ w, c }) => ((w.res.harmonica ?? 0) >= 1 && !c.hands.length ? "🎵 Играть на губной гармошке" : null),
  dur: () => 0,
  anim: "sit",
  tick: ({ w, c }, dt) => instrumentTick(w, c, dt, 8),
});

defAction({
  id: "play_guitar_stand",
  type: "obj",
  kinds: ["guitar_stand"],
  prio: 38,
  bot: true,
  avail: ({ w, c, o }) => {
    for (const id in w.chars) {
      const x = w.chars[id];
      if (x.id !== c.id && x.task?.obj === o!.id) return { label: "🎸 Гитара", reason: "Кто-то уже играет" };
    }
    return "🎸 Взять гитару и сыграть";
  },
  dur: () => 0,
  anim: "guitar",
  start: ({ c, o }) => {
    c.x = o!.x + 0.5;
  },
  tick: ({ w, c }, dt) => instrumentTick(w, c, dt, 10),
});

defAction({
  id: "play_piano",
  type: "obj",
  kinds: ["piano"],
  prio: 40,
  bot: true,
  avail: ({ w, c, o }) => {
    for (const id in w.chars) {
      const x = w.chars[id];
      if (x.id !== c.id && x.task?.obj === o!.id) return { label: "🎹 Пианино", reason: "Занято" };
    }
    return "🎹 Играть на пианино";
  },
  dur: () => 0,
  anim: "play",
  start: ({ c, o }) => {
    c.x = o!.x + 0.5;
  },
  tick: ({ w, c }, dt) => instrumentTick(w, c, dt, 11),
});

registerCmd("note", (w, p, cmd) => {
  const c = p.char ? w.chars[p.char] : undefined;
  if (!c?.task || !["play_guitar", "play_guitar_stand", "play_piano", "play_harmonica"].includes(c.task.action)) return;
  const n = Math.max(-12, Math.min(24, Math.floor(Number(cmd.n) || 0)));
  const inst = c.task.action === "play_piano" ? "piano" : c.task.action === "play_harmonica" ? "harmonica" : "guitar";
  fx(w, { k: "music", x: c.x, lv: c.lv, data: { n, inst, who: c.id, v: Math.max(0.2, Math.min(1, Number(cmd.v) || 0.8)) } });
});
