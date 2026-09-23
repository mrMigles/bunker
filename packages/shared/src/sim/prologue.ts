import { ITEMS, UNPACK, itemName } from "../data/items";
import { Rng } from "../rng";
import type { Char, World } from "../types";
import { feetY } from "../world/grid";
import { roomsOfType } from "../world/rooms";
import { followPath, goTo, resetMind } from "./bots";
import { inputHooks, registerCmd } from "./commands";
import { addNpc } from "./events";
import { isKeepsake, settleKeepsakes } from "./cozy";
import { canHold, give, spawnItem } from "./items";
import { beginDay } from "./lobby";
import { stepMove } from "./move";
import { onTick } from "./tick";
import { clamp, firstName, fx, isBotDriven, log } from "./util";

export interface PItem {
  id: string;
  item: string;
  x: number;
  lv: number;
  by?: string; // reserved by a bot
}

export interface PNeighbor {
  id: string;
  name: string;
  x: number;
  lv: number;
  dir: number;
  state: "panic" | "follow" | "saved";
  persuade: number;
}

export interface Prologue {
  t: number;
  dur: number;
  W: number;
  H: number;
  grid: number[];
  ladders: Record<string, number>;
  houses: { x: number; w: number; name: string }[];
  hatchX: number;
  items: PItem[];
  npcs: PNeighbor[];
  delivered: Record<string, number>;
  by: Record<string, string[]>; // char id → delivered item names
  tasks: Record<string, { npc: string; t: number }>;
  done: boolean;
  flashT: number;
}

/** Survival essentials: the valuable stuff that makes the first week. */
const ESSENTIAL = new Set(["food_box", "water_jug", "toolbox", "first_aid", "meds", "pickaxe", "seed_tomato", "seed_carrot"]);

const LOOT: [string, number][] = [
  ["food_box", 5],
  ["water_jug", 5],
  ["toolbox", 2],
  ["first_aid", 3],
  ["food_can", 8],
  ["water", 5],
  ["guitar", 1],
  ["album", 1],
  ["iron", 1],
  ["teddy", 1],
  ["gnome", 1],
  ["radio_portable", 1],
  ["harmonica", 1],
  ["plant_pot", 1],
  ["suitcase", 1],
  ["newspaper", 3],
  ["flashlight", 1],
  ["batteries", 2],
  ["seed_tomato", 1],
  ["seed_carrot", 1],
  ["meds", 3],
  ["cards52", 1],
  ["ball", 1],
  ["pickaxe", 1],
  ["knife", 1],
  ["cigarettes", 1],
];

const NEIGHBOR_NAMES = ["Сосед Ефим", "Тётя Клава", "Дед Митрофан", "Студент Гоша", "Почтальонша Люба"];

export const PROLOGUE_SECONDS = 60;

export function createPrologue(seed: number): Prologue {
  const R = Rng.from(seed ^ 0x90);
  const W = 58,
    H = 4;
  const grid = new Array(W * H).fill(7);
  const open = (x: number, lv: number) => {
    grid[lv * 2 * W + x] = 0;
    grid[(lv * 2 + 1) * W + x] = 0;
  };
  for (let x = 1; x < W - 1; x++) open(x, 1); // the street and ground floors
  // six buildings, the hatch in the middle of the street: near houses are quick, far ones hold more
  const houses = [
    { x: 2, w: 7, name: "Дом с гастрономом" },
    { x: 11, w: 6, name: "Коммуналка" },
    { x: 19, w: 6, name: "Аптека" },
    { x: 33, w: 6, name: "Дом учёного" },
    { x: 41, w: 7, name: "Мастерские" },
    { x: 50, w: 6, name: "Школа" },
  ];
  const hatchX = 28;
  const ladders: Record<string, number> = {};
  for (const h of houses) {
    for (let x = h.x; x < h.x + h.w; x++) open(x, 0);
    ladders[`${h.x + 1},1`] = 1;
  }
  const items: PItem[] = [];
  let i = 0;
  for (const [item, n] of LOOT) {
    for (let k = 0; k < n; k++) {
      // essentials sit deeper: far houses and upper floors (risk for reward); junk litters the street
      const essential = ESSENTIAL.has(item);
      const h = essential ? R.weighted(houses, (x) => 1 + Math.abs(x.x + x.w / 2 - hatchX) / 8)! : R.pick(houses);
      const inside = essential || R.chance(0.7);
      const lv = inside ? (essential ? (R.chance(0.65) ? 0 : 1) : R.int(0, 1)) : 1;
      const x = inside ? h.x + 0.5 + R.range(0, h.w - 1) : R.range(1.5, W - 2);
      items.push({ id: "pi" + i++, item, x: Math.round(x * 10) / 10, lv });
    }
  }
  const npcs: PNeighbor[] = R.shuffle([...NEIGHBOR_NAMES])
    .slice(0, 3)
    .map((name, k) => {
      const h = houses[(k + 1) % houses.length];
      return { id: "nb" + k, name, x: h.x + 1.5 + k, lv: 1, dir: 1, state: "panic" as const, persuade: 0 };
    });
  return { t: 0, dur: PROLOGUE_SECONDS, W, H, grid, ladders, houses, hatchX, items, npcs, delivered: {}, by: {}, tasks: {}, done: false, flashT: 0 };
}

export function prologueWorld(p: Prologue): any {
  return { W: p.W, H: p.H, grid: p.grid, ladders: p.ladders, phaseT: p.t };
}

/** Called by startGame when the prologue is on. */
export function beginPrologue(w: World) {
  const p = createPrologue(w.seed);
  w.mods.prologue = p;
  // the starting bunker is almost empty: supplies come from the street
  w.res = { food_can: 8, water: 14, meds: 1, pipe: 2, knife: 1, parts: 4, scrap: 8, wood: 6, cloth: 2, seed_lettuce: 2, seed_potato: 2, spores: 1, shovel: 1 };
  const chars = Object.values(w.chars);
  chars.forEach((c, k) => {
    c.x = p.hatchX + 0.5 + (k - chars.length / 2) * 1.2;
    c.lv = 1;
    c.y = feetY(1);
    c.hands = [];
    c.task = null;
    resetMind(c);
  });
  log(w, `🚨 СИРЕНА. У вас ${p.dur} секунд: соберите всё, что сможете, и прыгните в люк! Лучшее — в дальних домах и на верхних этажах.`, "bad");
  fx(w, { k: "sound", id: "siren" });
}

onTick("prologue-init", "prologue", (w) => {
  if (!w.mods.prologue) beginPrologue(w);
});

// movement during the prologue
inputHooks.push((w, c, inp) => {
  if (w.phase !== "prologue") return false;
  const p = w.mods.prologue as Prologue | undefined;
  if (!p || p.done) {
    c.seq = inp.seq;
    return true;
  }
  const mx = Math.sign(Number(inp.mx) || 0),
    my = Math.sign(Number(inp.my) || 0);
  const dt = Math.max(0, Math.min(0.1, Number(inp.dt) || 0));
  if (mx || my) delete p.tasks[c.id];
  c.run = !!inp.run;
  stepMove(prologueWorld(p), c, mx, my, dt);
  c.seq = inp.seq;
  return true;
});

export interface PAction {
  a: "pick" | "drop" | "persuade";
  id: string;
  label: string;
  reason?: string;
}

export function listPrologueActions(p: Prologue, c: Char): PAction[] {
  const out: PAction[] = [];
  if (c.climbing || p.done) return out;
  if (c.lv === 1 && Math.abs(c.x - (p.hatchX + 0.5)) <= 1.3 && c.hands.length) out.push({ a: "drop", id: "hatch", label: `⬇ Бросить в люк: ${c.hands.map((h) => itemName(h.item)).join(", ")}` });
  for (const it of p.items) {
    if (it.lv !== c.lv || Math.abs(it.x - c.x) > 1) continue;
    const label = `✋ ${ITEMS[it.item]?.icon ?? ""} ${itemName(it.item)}${ITEMS[it.item]?.large ? " (тяжёлое)" : ""}`;
    out.push(canHold(c, it.item) ? { a: "pick", id: it.id, label } : { a: "pick", id: it.id, label, reason: "Руки заняты" });
  }
  for (const n of p.npcs) {
    if (n.state !== "panic" || n.lv !== c.lv || Math.abs(n.x - c.x) > 1.3) continue;
    out.push({ a: "persuade", id: n.id, label: `🗣 Уговорить: ${n.name} (держите E)` });
  }
  return out;
}

function deliver(w: World, p: Prologue, c: Char) {
  for (const h of c.hands) {
    p.delivered[h.item] = (p.delivered[h.item] ?? 0) + h.n;
    (p.by[c.id] ??= []).push(itemName(h.item));
  }
  if (c.hands.length) fx(w, { k: "float", x: c.x, lv: 0, text: "⬇ в люк!", color: "#8fcf6a" });
  c.hands = [];
}

registerCmd("pdo", (w, pl, cmd) => {
  const p = w.mods.prologue as Prologue | undefined;
  const c = pl.char ? w.chars[pl.char] : undefined;
  if (!p || !c || w.phase !== "prologue") return;
  const a = listPrologueActions(p, c).find((x) => x.a === cmd.a && x.id === String(cmd.id));
  if (!a || a.reason) return a?.reason ?? "Недоступно";
  if (a.a === "pick") pickItem(p, c, a.id);
  else if (a.a === "drop") deliver(w, p, c);
  else p.tasks[c.id] = { npc: a.id, t: 0 };
});

registerCmd("pstop", (w, pl) => {
  const p = w.mods.prologue as Prologue | undefined;
  if (p && pl.char) delete p.tasks[pl.char];
});

/** Throw what's in hands a few cells forward — a teammate can catch it. */
registerCmd("pthrow", (w, pl) => {
  const p = w.mods.prologue as Prologue | undefined;
  const c = pl.char ? w.chars[pl.char] : undefined;
  if (!p || !c || !c.hands.length) return;
  const h = c.hands.shift()!;
  const tx = Math.max(1.5, Math.min(p.W - 2, c.x + c.dir * 3.5));
  // a teammate within 1 cell of the landing spot catches it
  const catcher = Object.values(w.chars).find((o) => o.id !== c.id && o.lv === c.lv && Math.abs(o.x - tx) < 1.2 && canHold(o, h.item));
  if (catcher) {
    give(catcher, h.item, h.n);
    fx(w, { k: "float", x: catcher.x, lv: 0, text: `🙌 ${firstName(catcher)} ловит!`, color: "#ffe08a" });
  } else if (c.lv === 1 && Math.abs(tx - (p.hatchX + 0.5)) < 1) {
    p.delivered[h.item] = (p.delivered[h.item] ?? 0) + h.n;
    (p.by[c.id] ??= []).push(itemName(h.item));
    fx(w, { k: "float", x: tx, lv: 0, text: "🎯 прямо в люк!", color: "#8fcf6a" });
  } else p.items.push({ id: "pi" + w.nextId++, item: h.item, x: tx, lv: c.lv });
});

function pickItem(p: Prologue, c: Char, id: string) {
  const i = p.items.findIndex((x) => x.id === id);
  if (i < 0) return;
  const it = p.items[i];
  if (!give(c, it.item, 1)) return;
  p.items.splice(i, 1);
}

onTick("prologue", "prologue", (w, dt) => {
  const p = w.mods.prologue as Prologue | undefined;
  if (!p) return;
  const pw = prologueWorld(p);
  if (p.done) {
    p.flashT += dt;
    if (p.flashT > 4) finishPrologue(w, p);
    return;
  }
  p.t += dt;
  // sirens & rumble escalate
  if (Math.floor(p.t) % 15 === 0 && Math.floor(p.t - dt) % 15 !== 0) fx(w, { k: "sound", id: "siren" });
  for (const left of [15, 5]) {
    if (p.dur - p.t <= left && p.dur - (p.t - dt) > left) {
      fx(w, { k: "toast", text: left === 15 ? "⏱ 15 секунд! Бегите к люку!" : "⏱ 5 СЕКУНД!" });
      log(w, left === 15 ? "⏱ Осталось 15 секунд — все к люку! Кто не успеет, получит ожоги и радиацию." : "⏱ 5 секунд!", "bad");
    }
  }
  if (p.t > p.dur - 30 && Math.floor(p.t * 2) % 4 === 0 && Math.floor((p.t - dt) * 2) % 4 !== 0) fx(w, { k: "shake", data: 0.2 + (p.t - (p.dur - 30)) / 30 });
  // persuading neighbours
  for (const cid in p.tasks) {
    const t = p.tasks[cid];
    const c = w.chars[cid];
    const n = p.npcs.find((x) => x.id === t.npc);
    if (!c || !n || n.state !== "panic" || n.lv !== c.lv || Math.abs(n.x - c.x) > 1.6) {
      delete p.tasks[cid];
      continue;
    }
    t.t += dt * (1 + c.card.stats.har * 0.15);
    c.anim = "work";
    if (t.t >= 3) {
      n.state = "follow";
      delete p.tasks[cid];
      fx(w, { k: "float", x: n.x, lv: 0, text: "«Ладно, бегу!»", color: "#ffe08a" });
    }
  }
  // neighbours
  for (const n of p.npcs) {
    if (n.state === "saved") continue;
    const speed = n.state === "follow" ? 3.2 : 1.8;
    if (n.state === "follow") {
      if (n.lv === 0) {
        const h = p.houses.find((h) => n.x >= h.x && n.x < h.x + h.w);
        const lx = (h ? h.x + 1 : n.x) + 0.5;
        if (Math.abs(n.x - lx) > 0.1) n.x += Math.sign(lx - n.x) * Math.min(Math.abs(lx - n.x), speed * dt);
        else n.lv = 1;
      } else {
        const tx = p.hatchX + 0.5;
        n.x += Math.sign(tx - n.x) * Math.min(Math.abs(tx - n.x), speed * dt);
        if (Math.abs(n.x - tx) < 0.2) {
          n.state = "saved";
          log(w, `${n.name} прыгает в люк!`, "good");
        }
      }
    } else {
      n.x += n.dir * speed * dt;
      const h = p.houses.find((h) => Math.abs(n.x - (h.x + h.w / 2)) < h.w / 2 + 2);
      const lo = h && n.lv === 0 ? h.x + 0.5 : 1.5;
      const hi = h && n.lv === 0 ? h.x + h.w - 0.5 : p.W - 2;
      if (n.x < lo || n.x > hi || new Rng([Math.floor(p.t * 10), 1, 2, 3]).chance(0.01)) n.dir *= -1;
      n.x = Math.max(lo, Math.min(hi, n.x));
    }
  }
  // bots scavenge: nearest free item → hatch
  for (const c of Object.values(w.chars)) {
    if (!isBotDriven(w, c.id) || c.status !== "ok") continue;
    const m = c.mind;
    // bots carry two things at a time and head home early
    if (c.hands.length && (c.hands.some((h) => ITEMS[h.item]?.large) || c.hands.length >= 2 || p.t > p.dur - 14 || !p.items.some((x) => !x.by))) {
      if (c.lv === 1 && Math.abs(c.x - (p.hatchX + 0.5)) < 1) {
        deliver(w, p, c);
        m.path = undefined;
        m.dest = undefined;
        continue;
      }
      if (!m.dest || m.plan !== "hatch") {
        if (goTo(pw, c, p.hatchX + 0.5, 1)) m.plan = "hatch";
      }
      followPath(pw, c, dt);
      continue;
    }
    let target = p.items.find((x) => x.by === c.id);
    if (!target) {
      // bots only scavenge the street and ground floors near the hatch — upper floors and far houses are the players' call
      const free = p.items.filter((x) => !x.by && canHold(c, x.item) && x.lv === 1 && Math.abs(x.x - p.hatchX) < 13).sort((a, b) => Math.abs(a.x - c.x) + Math.abs(a.lv - c.lv) * 6 - (Math.abs(b.x - c.x) + Math.abs(b.lv - c.lv) * 6));
      // prefer useful stuff
      target = free.find((x) => ["food_box", "water_jug", "first_aid", "toolbox", "food_can", "water", "meds"].includes(x.item) && Math.abs(x.x - c.x) < 14) ?? free[0];
      if (!target) continue;
      target.by = c.id;
      m.dest = undefined;
      m.plan = "item";
    }
    if (target.lv === c.lv && Math.abs(target.x - c.x) <= 0.9) {
      // rummaging takes a moment
      m.idleT = (m.idleT > 0 ? m.idleT : 1.4) - dt;
      c.anim = "work";
      if (m.idleT > 0) continue;
      m.idleT = 0;
      pickItem(p, c, target.id);
      m.dest = undefined;
      continue;
    }
    if (!m.dest) goTo(pw, c, target.x, target.lv);
    if (followPath(pw, c, dt) === "stuck") {
      target.by = undefined;
      m.dest = undefined;
      m.path = undefined;
    }
  }
  if (p.t >= p.dur) {
    p.done = true;
    fx(w, { k: "flash" });
    fx(w, { k: "sound", id: "boom" });
    fx(w, { k: "shake", data: 2.5 });
    log(w, "☢ ВСПЫШКА.", "bad");
  }
});

export function finishPrologue(w: World, p: Prologue) {
  const airlock = roomsOfType(w, "airlock")[0];
  const x0 = airlock ? airlock.x + 1 : 20;
  const lines: string[] = [];
  const late: string[] = [];
  // who was not at the hatch gets hurt
  for (const c of Object.values(w.chars)) {
    const atHatch = c.lv === 1 && Math.abs(c.x - (p.hatchX + 0.5)) < 2.5;
    if (!atHatch) {
      c.needs.rad = clamp(c.needs.rad + 40);
      c.needs.health = clamp(c.needs.health - 20);
      c.injury = "burn";
      late.push(firstName(c));
    }
    // whatever is still in hands comes along
    deliver(w, p, c);
    c.x = x0 + 0.5;
    c.lv = airlock?.lv ?? 0;
    c.y = feetY(c.lv);
    c.climbing = false;
    resetMind(c);
  }
  // supplies; keepsakes go straight onto shelves and tables
  const keepsakes: string[] = [];
  for (const k in p.delivered) if (isKeepsake(k)) for (let i = 0; i < p.delivered[k]; i++) keepsakes.push(k);
  const unplaced = settleKeepsakes(w, keepsakes);
  for (const k in p.delivered) {
    const n = isKeepsake(k) ? unplaced.filter((x) => x === k).length : p.delivered[k];
    if (!n) continue;
    const d = ITEMS[k];
    if (UNPACK[k]) for (const r in UNPACK[k]) w.res[r] = (w.res[r] ?? 0) + UNPACK[k][r] * n;
    else if (k === "newspaper") for (let i = 0; i < n; i++) w.unread.push("rand" + (w.nextId++ * 7919));
    else if (k === "cards52") w.games.includes("cards52") || w.games.push("cards52");
    else if (d && d.store !== false) w.res[k] = (w.res[k] ?? 0) + n;
    else for (let i = 0; i < n; i++) spawnItem(w, k, 1, x0 + 1 + i * 0.3, airlock?.lv ?? 0);
  }
  for (const n of p.npcs) {
    if (n.state === "saved") {
      const c = addNpc(w, "random");
      c.card.name = n.name.replace(/^(Сосед|Тётя|Дед|Студент|Почтальонша) /, "") + " " + c.card.name.split(" ")[1];
    } else lines.push(`${n.name} остался наверху…`);
  }
  // funny summary
  const has = (k: string) => (p.delivered[k] ?? 0) > 0;
  if (has("iron") && !has("water_jug") && !has("water")) lines.push("Кто-то взял утюг, а не воду?!");
  if (has("gnome")) lines.push("Садовый гном спасён. Приоритеты.");
  if (has("guitar")) lines.push("Зато есть гитара!");
  if (!Object.keys(p.delivered).length) lines.push("В люк не упало ничего. Совсем ничего.");
  for (const cid in p.by) if (w.chars[cid]) lines.push(`${firstName(w.chars[cid])} принёс(ла): ${p.by[cid].join(", ")}.`);
  if (late.length) lines.push(`Не успели к люку: ${late.join(", ")} — ожоги и радиация.`);
  for (const l of lines) log(w, l, "event");
  w.mods.prologueResult = { delivered: p.delivered, lines };
  delete w.mods.prologue;
  beginDay(w);
}

// public view: the whole prologue is shared information
export { prologueWorld as prologueGeometry };
