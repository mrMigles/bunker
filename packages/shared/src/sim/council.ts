import { BAL } from "../data/balance";
import type { Char, Council, Vote, World } from "../types";
import { feetY } from "../world/grid";
import { objsOfKind, roomsOfType } from "../world/rooms";
import { stopTask } from "./actions";
import { resetMind } from "./bots";
import { registerCmd } from "./commands";
import { stepHydro } from "./hydro";
import { foodUnits, takeFood } from "./items";
import { decayNeeds } from "./needs";
import { stepMachines, stepPower } from "./systems";
import { onTick } from "./tick";
import { endNight, nightHooks } from "./time";
import { clamp, firstName, fx, hasTrait, homeChars, log, rng } from "./util";

const STEP_TIME = { rations: 25, event: 35, plan: 25 };

/** Pluggable: the events engine sets this to produce the night vote. */
export const councilHooks: {
  pickEvent: ((w: World) => Vote | null) | null;
  resolveVote: ((w: World, v: Vote) => void) | null;
  morning: ((w: World) => void)[];
} = { pickEvent: null, resolveVote: null, morning: [] };

export function voteWeight(w: World, pid: string) {
  const p = w.players[pid];
  if (!p || !p.online) return 0;
  return p.ghost ? 0.5 : 1;
}

export function tally(w: World, v: Vote): number[] {
  const t = v.options.map(() => 0);
  for (const pid in v.votes) {
    const i = v.votes[pid];
    if (i >= 0 && i < t.length && !v.options[i].disabled) t[i] += voteWeight(w, pid);
  }
  return t;
}

/** Winning option; ties broken by the elder, then by the first option. */
export function voteWinner(w: World, v: Vote): number {
  const t = tally(w, v);
  const max = Math.max(...t);
  const top = t.map((x, i) => (x === max ? i : -1)).filter((i) => i >= 0);
  if (top.length === 1) return top[0];
  if (w.elder && v.votes[w.elder] !== undefined && top.includes(v.votes[w.elder])) return v.votes[w.elder];
  // nobody voted: choose a random enabled option deterministically
  const enabled = top.filter((i) => !v.options[i].disabled);
  return enabled.length ? enabled[rng(w).int(0, enabled.length - 1)] : 0;
}

nightHooks.start.push((w) => {
  const mess = roomsOfType(w, "mess")[0] ?? Object.values(w.rooms)[0];
  const table = objsOfKind(w, "dining_table")[0];
  const home = homeChars(w);
  let i = 0;
  for (const c of home) {
    stopTask(w, c);
    if (c.status === "ok" || c.status === "breakdown") {
      c.status = c.status === "breakdown" ? "ok" : c.status;
      const baseX = table ? table.x - 1 : mess.x + 1;
      c.x = Math.min(mess.x + mess.w - 0.5, baseX + 0.5 + (i % 5) * 0.75);
      c.lv = mess.lv;
      c.y = feetY(c.lv);
      c.climbing = false;
      c.anim = "sit";
      c.dir = i % 2 ? -1 : 1;
      i++;
    }
    resetMind(c);
    // drop carried items where they stand
    if (c.hands.length) c.hands = c.hands.filter((h) => h.item !== "dirt" && h.item !== "trash");
  }
  const rations: Record<string, number> = {};
  for (const c of home) if (c.status !== "dead") rations[c.id] = 1;
  const council: Council = {
    step: "rations",
    stepEnds: w.phaseT + STEP_TIME.rations,
    ready: {},
    rations,
    proposals: [],
    notes: [],
    vote: null,
    sleepers: assignBeds(w),
  };
  w.council = council;
  log(w, `🌙 Ночь ${w.day}. Совет за столом.`, "system");
});

function assignBeds(w: World): Record<string, string> {
  const beds = objsOfKind(w, "bed").filter((b) => !b.broken);
  const people = homeChars(w).filter((c) => c.status !== "dead" && c.status !== "down");
  // priority: whoever slept on the floor last night, then the most tired
  people.sort((a, b) => Number(!!b.flagsFloor) - Number(!!a.flagsFloor) || a.needs.energy - b.needs.energy);
  const out: Record<string, string> = {};
  people.forEach((c, i) => {
    if (beds[i]) out[c.id] = beds[i].id;
  });
  return out;
}

declare module "../types" {
  interface Char {
    flagsFloor?: boolean;
  }
}

function allReady(w: World) {
  const online = Object.values(w.players).filter((p) => p.online);
  return online.length > 0 && online.every((p) => w.council?.ready[p.id]);
}

onTick("council", "night", (w) => {
  const cn = w.council;
  if (!cn) return;
  // proposals resolve as soon as a majority agrees
  for (const pr of cn.proposals) {
    if (pr.done) continue;
    let yes = 0,
      total = 0;
    for (const pid in w.players) {
      const wt = voteWeight(w, pid);
      total += wt;
      if (pr.votes[pid]) yes += wt;
    }
    if (total > 0 && yes > total / 2) {
      pr.done = true;
      cn.rations[pr.char] = pr.mult;
      const c = w.chars[pr.char];
      log(w, `Совет решил: ${c ? firstName(c) : "?"} получает ${multName(pr.mult)}.`, "event");
    }
  }
  // a lone player reads at their own pace: the council waits for «Готов» (up to four extra minutes)
  const online = Object.values(w.players).filter((p) => p.online && !p.aquarium);
  const solo = online.length === 1;
  if ((w.phaseT < cn.stepEnds + (solo ? 240 : 0)) && !allReady(w)) return;
  cn.ready = {};
  if (cn.step === "rations") {
    const v = councilHooks.pickEvent?.(w) ?? null;
    if (v) {
      cn.vote = v;
      cn.step = "event";
      cn.stepEnds = w.phaseT + STEP_TIME.event;
      v.ends = cn.stepEnds;
    } else {
      cn.step = "plan";
      cn.stepEnds = w.phaseT + STEP_TIME.plan;
    }
  } else if (cn.step === "event") {
    if (cn.vote) {
      cn.vote.result = voteWinner(w, cn.vote);
      councilHooks.resolveVote?.(w, cn.vote);
    }
    cn.step = "plan";
    cn.stepEnds = w.phaseT + STEP_TIME.plan;
  } else if (cn.step === "plan") {
    cn.step = "done";
    finishNight(w);
  }
});

export function multName(m: number) {
  return m === 0 ? "пустую миску" : m === 0.5 ? "половину пайка" : m === 2 ? "двойной паёк" : "обычный паёк";
}

export function finishNight(w: World) {
  const cn = w.council!;
  // --- rations
  const home = homeChars(w).filter((c) => c.status !== "dead");
  let wantFood = 0,
    wantWater = 0;
  for (const c of home) {
    const m = cn.rations[c.id] ?? 1;
    wantFood += m * BAL.rationFood;
    wantWater += m * BAL.rationWater;
  }
  const haveFood = foodUnits(w);
  const haveWater = w.res.water ?? 0;
  const fShare = wantFood > 0 ? Math.min(1, haveFood / wantFood) : 1;
  const wShare = wantWater > 0 ? Math.min(1, haveWater / wantWater) : 1;
  let short = false;
  for (const c of home) {
    const m = cn.rations[c.id] ?? 1;
    if (m <= 0) {
      c.needs.sanity = clamp(c.needs.sanity - 6);
      continue;
    }
    const [nut, san] = takeFood(w, m * BAL.rationFood * fShare);
    c.needs.food = clamp(c.needs.food + nut * BAL.foodPerUnit);
    c.needs.sanity = clamp(c.needs.sanity + san * 0.5 + (m > 1 ? 3 : 0));
    const water = Math.min(w.res.water ?? 0, m * BAL.rationWater * wShare);
    w.res.water = (w.res.water ?? 0) - water;
    c.needs.water = clamp(c.needs.water + water * BAL.waterPerUnit);
    w.stats.ate[c.id] = (w.stats.ate[c.id] ?? 0) + nut;
    if (fShare < 0.99 || wShare < 0.99) short = true;
  }
  if (short) log(w, `Пайков не хватило всем: еды ${Math.round(fShare * 100)}%, воды ${Math.round(wShare * 100)}%.`, "bad");
  // shared dinner bonus
  if (home.length >= 3 && fShare > 0.9) for (const c of home) c.needs.sanity = clamp(c.needs.sanity + 2);

  // --- 8 hours of night in bulk
  for (let h = 0; h < 8; h++) {
    stepPower(w, 1);
    stepMachines(w, 1, 0);
  }
  stepHydro(w, 8);
  for (const c of home) {
    if (c.status === "down") continue;
    const bed = cn.sleepers[c.id];
    let restore = bed ? BAL.sleepRestoreBed : BAL.sleepRestoreFloor;
    const bedObj = bed ? w.objs[bed] : undefined;
    const room = bedObj?.room ? w.rooms[bedObj.room] : undefined;
    if (room && room.level >= 2) restore *= 1.15;
    if (room) restore *= 0.8 + room.comfort / 250;
    // snorers in the same room
    for (const o of home) {
      if (o.id === c.id || !hasTrait(o, "snorer")) continue;
      const ob = cn.sleepers[o.id] ? w.objs[cn.sleepers[o.id]] : undefined;
      const sameRoom = (ob?.room ?? "floor") === (bedObj?.room ?? "floor");
      if (sameRoom && !hasTrait(c, "lightsleeper")) {
        restore += BAL.snoreEnergy;
        c.needs.sanity = clamp(c.needs.sanity + BAL.snoreSanity);
        (w.flags as any)["_snore_" + c.id] = o.id;
      }
    }
    if (hasTrait(c, "nightowl")) restore += 5;
    decayNeeds(w, c, 8, { asleep: true, sleepRate: Math.max(0, restore) / 8 });
    c.flagsFloor = !bed;
    if (!bed) c.needs.sanity = clamp(c.needs.sanity - 3);
    c.slept = false;
    c.meal = 0;
  }
  // everyone wakes up in bed / on the floor
  for (const c of home) {
    const bed = cn.sleepers[c.id] ? w.objs[cn.sleepers[c.id]] : undefined;
    if (bed) {
      c.x = bed.x + 0.5;
      c.lv = bed.lv;
    }
    c.y = feetY(c.lv);
    c.anim = "idle";
    resetMind(c);
  }
  w.council = null;
  endNight(w);
  for (const h of councilHooks.morning) h(w);
}

// ---------------------------------------------------------------- commands

registerCmd("ready", (w, p, c) => {
  if (w.phase === "lobby") {
    p.ready = !!c.v;
    return;
  }
  if (w.council) w.council.ready[p.id] = c.v !== false;
});

registerCmd("vote", (w, p, cmd) => {
  const v = cmd.day ? w.vote : w.council?.vote;
  if (!v || v.result !== undefined) return "Голосование закрыто";
  const i = Number(cmd.i);
  if (!(i >= 0 && i < v.options.length) || v.options[i].disabled) return "Нельзя";
  v.votes[p.id] = i;
});

registerCmd("ration", (w, p, cmd) => {
  const cn = w.council;
  if (!cn || cn.step !== "rations") return "Сейчас не время";
  const mult = Number(cmd.mult);
  if (![0, 0.5, 1, 2].includes(mult)) return "bad";
  const char = String(cmd.char);
  if (!w.chars[char]) return "bad";
  const me = p.char ? w.chars[p.char] : undefined;
  // cutting your own ration needs no vote
  if (me && me.id === char && mult < (cn.rations[char] ?? 1)) {
    cn.rations[char] = mult;
    log(w, `${p.name} сам урезает свой паёк: ${multName(mult)}.`, "event");
    return;
  }
  if (cn.proposals.filter((x) => !x.done).length >= 6) return "Слишком много предложений";
  cn.proposals.push({ id: "pr" + w.nextId++, by: p.id, char, mult, votes: { [p.id]: true } });
  const c = w.chars[char];
  log(w, `${p.name} предлагает: ${firstName(c)} — ${multName(mult)}.`, "event");
});

registerCmd("propVote", (w, p, cmd) => {
  const pr = w.council?.proposals.find((x) => x.id === cmd.id);
  if (!pr || pr.done) return;
  pr.votes[p.id] = !!cmd.v;
});

registerCmd("note", (w, p, cmd) => {
  const cn = w.council;
  if (!cn) return;
  const text = String(cmd.text ?? "").trim().slice(0, 120);
  if (!text) return;
  cn.notes.push({ by: p.name, text });
  if (cn.notes.length > 20) cn.notes.shift();
});

registerCmd("skipNight", (w, p) => {
  if (w.phase !== "night" || !w.council) return;
  w.council.ready[p.id] = true;
});

export { fx };
export type { Char };
