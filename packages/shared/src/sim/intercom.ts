// Интерком у шлюза. The wasteland comes knocking: refugees who want in, traders with a cart,
// strangers from the door events. Whoever answers decides; unanswered callers leave.
// This (with sortie recruits) is how the bunker grows: games start with at most three residents.
import { makeCard } from "../world/create";
import { ITEMS, itemName } from "../data/items";
import { PROFS } from "../data/characters";
import { modViews } from "../net/view";
import { Rng } from "../rng";
import type { Card, Char, World } from "../types";
import { addObj, roomsOfType } from "../world/rooms";
import { defAction } from "./actions";
import { registerCmd } from "./commands";
import { EVENTS, addNpc, applyEffect, condOk, makeVote, resolveVote, rollCheck } from "./events";
import { debugOps } from "./debug";
import { onTick } from "./tick";
import { clamp, firstName, fx, isBotDriven, log, rng } from "./util";
import { admitForecast, doorAllows } from "./colonyplan";

export interface IntercomCall {
  id: string;
  kind: "refugee" | "trader" | "event";
  name: string;
  text: string;
  /** game hour when the caller gives up */
  until: number;
  /** refugee: who is at the door, and whether they are who they say */
  card?: Card;
  honest?: boolean;
  asked?: string;
  /** trader: goods on the cart */
  stock?: Record<string, number>;
  /** door event from the event deck */
  ev?: string;
  /** result line shown in the dialog after a choice */
  done?: string;
}

/** Residents the bunker can hold before refugees are turned away by default. */
export const MAX_RESIDENTS = 9;

const REFUGEE_STORIES = [
  "«Я {prof}. Шёл из Заречья три дня. Воды нет с утра. Пустите — я пригожусь».",
  "«Меня зовут {name}. Наш подвал затопило. Я умею работать руками, честно».",
  "«Не стреляйте! Я одна… один. Видел ваш дым из трубы. Можно войти?»",
  "«Я {prof}, была… был им до всего этого. Могу отработать еду».",
  "«Слышал ваше радио. Сказали — тут принимают людей. Это правда?»",
];

const TRADE_POOL = ["food_can", "water", "meds", "ammo", "parts", "batteries", "seed_tomato", "seed_soy", "seed_carrot", "chem", "cloth", "lockpick", "crowbar", "pistol", "knife", "pipe", "medkit", "radpills", "cigarettes", "cards52"];

function intercomObj(w: World) {
  return Object.values(w.objs).find((o) => o.kind === "intercom");
}

/** Old saves and fresh bunkers: the intercom hangs on the wall by the blast door. */
export function ensureIntercom(w: World) {
  if (intercomObj(w)) return;
  const airlock = roomsOfType(w, "airlock")[0];
  if (airlock) addObj(w, "intercom", airlock.x, airlock.lv, airlock.id);
}

export function call(w: World): IntercomCall | undefined {
  return w.mods.intercom as IntercomCall | undefined;
}

function residents(w: World) {
  return Object.values(w.chars).filter((c) => c.status !== "dead").length;
}

function newCall(w: World, R: Rng, force?: IntercomCall["kind"]): IntercomCall | null {
  const until = Math.min(22.5, w.hour + 2.5);
  const id = "ic" + w.nextId++;
  const doorEvents = EVENTS.filter((e) => e.cat === "door" && e.options && condOk(w, e.conditions) && w.day - (w.flags["_ev_" + e.id] ?? -99) >= 4);
  const kinds: [IntercomCall["kind"], number][] = [
    ["refugee", residents(w) < MAX_RESIDENTS ? 4 : 1],
    ["trader", 3],
    ["event", doorEvents.length ? 3 : 0],
  ];
  const kind = force ?? R.weighted(kinds, (k) => k[1])![0];
  if (kind === "refugee") {
    const card = makeCard(R);
    const honest = R.chance(0.8);
    const prof = PROFS[card.prof]?.name?.toLowerCase() ?? "работник";
    return { id, kind, until, card, honest, name: card.name, text: R.pick(REFUGEE_STORIES).replace("{prof}", prof).replace("{name}", card.name.split(" ")[0]) };
  }
  if (kind === "trader") {
    const stock: Record<string, number> = {};
    for (let i = 0; i < 6; i++) {
      const k = R.pick(TRADE_POOL);
      stock[k] = (stock[k] ?? 0) + R.int(1, 3);
    }
    return { id, kind, until, stock, name: R.pick(["Караванщик Сёма", "Тётка с тележкой", "Молчаливый меняла", "Торговец «Пятака»"]), text: "«Караванщики! Честная торговля с доставкой к двери! Товар — на тележке, деньги — ваши вещи»." };
  }
  if (!doorEvents.length) return null;
  const ev = R.pick(doorEvents);
  w.flags["_ev_" + ev.id] = w.day;
  return { id, kind: "event", until, ev: ev.id, name: ev.title, text: ev.text };
}

export function ring(w: World, c: IntercomCall) {
  w.mods.intercom = c;
  const o = intercomObj(w);
  if (o) o.st.ring = 1;
  log(w, `📞 Звонит интерком у шлюза: ${c.kind === "trader" ? "торговец" : c.kind === "refugee" ? "кто-то просит впустить" : c.name}.`, "event");
  fx(w, { k: "toast", text: "📞 Звонит интерком у шлюза — подойдите и ответьте" });
  fx(w, { k: "sound", id: "ring" });
}

function hangUp(w: World, text?: string) {
  const o = intercomObj(w);
  if (o) o.st.ring = 0;
  if (text) log(w, text, "event");
  delete w.mods.intercom;
}

onTick("intercom", "day", (w) => {
  ensureIntercom(w);
  const c = call(w);
  if (c) {
    if (c.done) {
      // the dialog shows the outcome for a moment, then the line goes quiet
      if (w.hour >= c.until) hangUp(w);
      return;
    }
    if (w.hour < c.until) return;
    // nobody answered: a bunker run by its residents answers by itself
    const anyone = Object.values(w.players).some((p) => p.online && !p.ghost);
    if (!anyone) botAnswer(w, c);
    else hangUp(w, c.kind === "refugee" ? `📞 Никто не подошёл к интеркому. ${c.name.split(" ")[0]} ушёл(ла) дальше.` : "📞 Интерком замолчал — никто не ответил.");
    return;
  }
  if (w.mods.combat?.active || w.hour < 8 || w.hour > 19) return;
  // the first visitor comes on the second morning, then roughly every other day
  const next = w.flags._icNext ?? 2 + 10 / 24;
  if (w.day + w.hour / 24 < next) return;
  const R = rng(w);
  const force = !w.flags._icFirst ? "refugee" : undefined;
  const nc = newCall(w, R, force);
  w.flags._icFirst = 1;
  w.flags._icNext = w.day + w.hour / 24 + R.range(1.2, 2.6);
  if (nc) ring(w, nc);
});

/** Residents answer on their own: they let people in while there is room and food. */
function botAnswer(w: World, c: IntercomCall) {
  if (c.kind === "refugee") {
    if (residents(w) < MAX_RESIDENTS - 2 && doorAllows(w)) return answer(w, null, "in");
    return hangUp(w, `📞 Жильцы не решились открыть: ${c.name.split(" ")[0]} ушёл(ла).`);
  }
  if (c.kind === "event") {
    const e = EVENTS.find((x) => x.id === c.ev);
    const safe = e?.options?.findIndex((o) => (o.mood ?? []).includes("cautious")) ?? -1;
    return answer(w, null, String(Math.max(0, safe)));
  }
  hangUp(w, "📞 Торговец постучал и уехал.");
}

function nearIntercom(w: World, ch: Char) {
  const o = intercomObj(w);
  return !!o && ch.lv === o.lv && Math.abs(ch.x - (o.x + 0.5)) <= 1.6;
}

/** One answer to the caller. `pid` null = the residents decided. */
function answer(w: World, pid: string | null, opt: string): string | void {
  const c = call(w);
  if (!c || c.done) return "Никто не звонит";
  const who = pid ? w.chars[w.players[pid]?.char ?? ""] : undefined;
  const R = rng(w);
  if (c.kind === "refugee") {
    switch (opt) {
      case "ask": {
        if (c.asked) return "Уже расспросили";
        const [ok, roll] = rollCheck(w, { stat: "har", skill: "stealth", dc: 11 });
        c.asked = ok ? (c.honest ? "Голос ровный, отвечает сразу и по делу. Похоже, не врёт." : "Путается в словах… и за спиной у него кто-то шепчется. Подозрительно.") : "Трудно понять по голосу. Решайте сами.";
        c.asked = `${roll} ${c.asked}`;
        return;
      }
      case "in": {
        if (!c.honest) {
          c.done = "Дверь приоткрылась — и в шлюз полезли налётчики! Это была разведка.";
          log(w, "📞 " + c.done, "bad");
          startTrap(w);
          c.until = w.hour + 0.3;
          return;
        }
        const npc = addNpc(w, "random", c.card);
        for (const o of Object.values(w.chars)) if (o.id !== npc.id && o.status !== "dead") o.needs.sanity = clamp(o.needs.sanity + 3);
        c.done = `${firstName(npc)} входит в шлюз, отряхивает пепел и кивает: «Спасибо. Не пожалеете».`;
        if (who) who.xp = (who.xp ?? 0) + 5;
        c.until = w.hour + 0.3;
        return;
      }
      case "food": {
        if ((w.res.food_can ?? 0) < 1) return "Нет консервов";
        w.res.food_can -= 1;
        w.flags.karma = (w.flags.karma ?? 0) + 1;
        c.done = "Банка консервов уходит в щель. «Спасибо… Храни вас Бог».";
        c.until = w.hour + 0.3;
        return;
      }
      default:
        c.done = "«Понятно…» Шаги удаляются по лестнице.";
        for (const o of Object.values(w.chars)) if (o.status !== "dead" && o.card.plus === "optimist") o.needs.sanity = clamp(o.needs.sanity - 3);
        c.until = w.hour + 0.3;
        return;
    }
  }
  if (c.kind === "trader") {
    if (opt === "bye") {
      c.done = "«Ваша потеря!» Тележка скрипит прочь.";
      c.until = w.hour + 0.2;
    }
    return;
  }
  // a door event: the answering player picks the option (as a one-person vote)
  const e = EVENTS.find((x) => x.id === c.ev);
  if (!e?.options) return hangUp(w);
  const i = Math.max(0, Math.min(e.options.length - 1, Number(opt) || 0));
  const v = makeVote(w, e, w.phaseT, 1);
  if (v.options[i]?.disabled) return v.options[i].desc ?? "Недоступно";
  if (pid) v.votes[pid] = i;
  v.result = i;
  resolveVote(w, v);
  c.done = `«${e.options[i].label}». ${v.resultText ?? ""}`;
  c.until = w.hour + 0.4;
  void R;
}

function startTrap(w: World) {
  // reuse the raid machinery: a small ambush right at the door
  applyEffect(w, { startRaid: "raiders_trap" });
}

defAction({
  id: "intercom",
  type: "obj",
  kinds: ["intercom"],
  prio: 1,
  avail: ({ w }) => {
    const c = call(w);
    if (!c || c.done) return null;
    return `📞 Ответить по интеркому${c.kind === "trader" ? " (торговец)" : c.kind === "refugee" ? " (просят впустить)" : ""}`;
  },
  dur: () => 0,
  done: ({ w, c }) => {
    if (c.ctrl && !isBotDriven(w, c.id)) fx(w, { k: "news", to: c.ctrl, id: "intercom" });
    else if (call(w)) botAnswer(w, call(w)!);
  },
});

registerCmd("icAnswer", (w, p, cmd) => {
  const ch = p.char ? w.chars[p.char] : undefined;
  if (!ch) return "Нет персонажа";
  if (!nearIntercom(w, ch)) return "Подойдите к интеркому у шлюза";
  return answer(w, p.id, String(cmd.opt ?? ""));
});

registerCmd("icTrade", (w, p, cmd) => {
  const c = call(w);
  const ch = p.char ? w.chars[p.char] : undefined;
  if (!c || c.kind !== "trader" || !c.stock || c.done) return "Торговца нет";
  if (!ch || !nearIntercom(w, ch)) return "Подойдите к интеркому у шлюза";
  const give = (cmd.give ?? {}) as Record<string, number>;
  const take = (cmd.take ?? {}) as Record<string, number>;
  let gv = 0,
    tv = 0;
  for (const k in give) {
    const q = Math.max(0, Math.floor(give[k]));
    if ((w.res[k] ?? 0) < q) return `На складе нет столько: ${itemName(k)}`;
    gv += (ITEMS[k]?.value ?? 1) * q;
  }
  for (const k in take) {
    const q = Math.max(0, Math.floor(take[k]));
    if ((c.stock[k] ?? 0) < q) return `У торговца нет столько: ${itemName(k)}`;
    tv += (ITEMS[k]?.value ?? 1) * q;
  }
  const mult = 1.3 - (w.factions.caravan ?? 0) / 250;
  if (tv <= 0) return "Выберите товар";
  if (gv < tv * mult - 0.01) return "Торговец недоволен ценой";
  for (const k in give) w.res[k] = Math.max(0, (w.res[k] ?? 0) - Math.floor(give[k]));
  for (const k in take) {
    c.stock[k] -= Math.floor(take[k]);
    w.res[k] = (w.res[k] ?? 0) + Math.floor(take[k]);
  }
  w.factions.caravan = clamp((w.factions.caravan ?? 0) + 2, -100, 100);
  log(w, `🤝 Сделка через интерком: ${Object.entries(take).filter(([, n]) => n > 0).map(([k, n]) => `${itemName(k)}×${n}`).join(", ")}.`, "good");
});

/** dev: someone rings right now (arg: refugee | trader | event) */
debugOps.intercom = (w, kind) => {
  delete w.mods.intercom;
  const c = newCall(w, rng(w), (kind as IntercomCall["kind"]) || "refugee");
  if (c) ring(w, c);
};

modViews.intercom = {
  pub: (w, c: IntercomCall | undefined) => {
    if (!c) return undefined;
    const e = c.kind === "event" ? EVENTS.find((x) => x.id === c.ev) : undefined;
    const v = e ? makeVote(w, e, w.phaseT, 1) : undefined;
    return {
      id: c.id,
      kind: c.kind,
      name: c.name,
      text: c.text,
      asked: c.asked,
      done: c.done,
      stock: c.stock,
      priceMult: 1.3 - (w.factions.caravan ?? 0) / 250,
      prof: c.card ? PROFS[c.card.prof]?.name : undefined,
      forecast: c.kind === "refugee" ? admitForecast(w) : undefined,
      options: v?.options,
      leftHours: Math.max(0, Math.round((c.until - w.hour) * 10) / 10),
    };
  },
};
