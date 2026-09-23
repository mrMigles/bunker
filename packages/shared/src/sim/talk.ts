// Разговоры: once a day every resident has something to tell — a memory, a worry, a joke —
// and sometimes a request tied to the bunker (clean the filter, fix the light, build a rest room,
// bring something from a sortie). Requests become personal quests in the «Задачи» panel.
import { ITEMS, itemName } from "../data/items";
import { OBJECTS } from "../data/objects";
import barksJson from "../data/barks.json";
import { PROFS } from "../data/characters";
import { modViews } from "../net/view";
import { Rng } from "../rng";
import type { Char, World } from "../types";
import { ROOMS, roomsOfType } from "../world/rooms";
import { CHORE_DEFS, defAction } from "./actions";
import { registerCmd } from "./commands";
import { grantXp } from "./progress";
import { onTick } from "./tick";
import { clamp, firstName, fx, isBotDriven, log, rng } from "./util";

export interface Quest {
  id: string;
  giver: string;
  /** who agreed to help (a player's character) */
  by: string;
  kind: "chore" | "room" | "bring";
  text: string;
  /** chore id / room type / item */
  target: string;
  /** "bring": how many of the item storage must have */
  need?: number;
  day: number;
  done?: boolean;
}

/** A request as it is offered in conversation, before someone agrees. */
export type Offer = Omit<Quest, "id" | "by" | "day"> & { why: string };

export interface TalkToday {
  day: number;
  text: string;
  replies: { id: string; label: string }[];
  offer?: Offer;
  answered?: string;
  answerText?: string;
}

// ---------------------------------------------------------------- what people talk about

const BY_PROF: Record<string, string[]> = {
  engineer: [
    "Знаешь, я проектировал мосты. Один до сих пор стоит — видел в перископ. Смешно: мост есть, а берегов уже нет.",
    "Эти трубы проложены кем-то очень ленивым. Когда-нибудь я переделаю всю разводку. Когда-нибудь.",
    "Мне снится, что я затягиваю гайку, а она всё крутится и крутится. Просыпаюсь — руки сжаты.",
  ],
  doctor: [
    "В последнюю смену у меня было сорок пациентов. Я помню каждого по имени. Это хуже, чем кажется.",
    "Если кто-то начнёт кашлять — сразу ко мне. Не геройствуйте, ладно?",
    "Я давала клятву. Там ничего не было про конец света. Но, видимо, она всё равно действует.",
  ],
  soldier: [
    "Нас учили: сначала вода, потом укрытие, потом всё остальное. Про настольные игры не учили, а зря.",
    "Мой взвод ушёл на юг за день до Вспышки. Я остался — сломал ногу на учениях. Везение, да?",
    "Я сплю лицом к двери. Привычка. Не обращай внимания.",
  ],
  cook: [
    "Из консервы «Вечность» можно сделать четыре блюда. Все четыре — консерва «Вечность». Но с душой.",
    "Бабушка говорила: пока на кухне пахнет едой, в доме никто не умрёт. Я держусь за это.",
    "Когда-нибудь я испеку тут хлеб. Настоящий, с корочкой. Обещаю.",
  ],
  chemist: [
    "Всё — химия. Страх — это кортизол. Любовь — окситоцин. Самогон — этанол. Последнее хотя бы можно сделать.",
    "Я работала на заводе удобрений. Иногда думаю: не мы ли всё это начали? Потом думаю — нет, не мы. Наверное.",
    "Дай мне ведро, три трубки и неделю — будет чистая вода. Или взрыв. Шучу. Наверное.",
  ],
  electrician: [
    "Слышишь, как гудит проводка? Каждая линия поёт по-своему. Эта — фальшивит.",
    "Меня било током раз двадцать. Теперь я чувствую напряжение кожей. Полезный навык в бункере.",
    "Когда свет мигает, все смотрят на меня. Как будто я лично выключаю солнце.",
  ],
  teacher: [
    "У меня был класс — тридцать два оболтуса. Надеюсь, хоть кто-то из них так же сидит сейчас в подвале и спорит.",
    "Если мы выживем, кто-то должен будет рассказать детям, как всё было. Я веду записи.",
    "Знаешь, что самое страшное? Не радиация. Когда люди перестают читать.",
  ],
  miner: [
    "Под землёй я как дома. Тридцать лет в забое. Только там хоть смена кончалась.",
    "Земля не врёт. Где сыро — там вода, где трещит — там беда. Слушай землю.",
    "Мой отец копал, дед копал. Я думал, мой сын не будет. Вот, копаю за него.",
  ],
  radioman: [
    "Вчера ночью поймал обрывок: кто-то читал стихи на частоте спасателей. Двадцать минут. Потом тишина.",
    "Эфир живой, понимаешь? Там люди. Мы не одни. Надо только слушать.",
    "Я знаю позывные сорока человек по всему миру. Сколько из них ещё отвечают — не знаю.",
  ],
  farmer: [
    "Картошка — она как человек: ей нужна темнота, немного воды и чтобы не трогали.",
    "У меня было сорок гектаров. Теперь четыре лотка. Но на этих лотках я — царь.",
    "Корова у меня была, Зорька. Надеюсь, её кто-то приютил. Глупо, да?",
  ],
  priest: [
    "Люди спрашивают, где был Бог. Я не знаю. Но я знаю, где сейчас мы — вместе. Это уже что-то.",
    "Исповедоваться можно и за картами. Грехи не выбирают место.",
    "Я молюсь за тех, кто наверху. И за тех, кто внизу. На всякий случай — за всех.",
  ],
  conman: [
    "Я продал однажды один и тот же гараж трём людям. Теперь гаражей нет. Рынок рухнул.",
    "Хочешь, научу мухлевать в дурака? Только никому. Особенно Инженеру — он считает карты.",
    "Самое ценное в бункере — не консервы. Доверие. И консервы.",
  ],
  child: [
    "А правда, что наверху раньше было небо? Синее? Покажешь потом?",
    "Я нарисовала нас всех. Ты там самый высокий. Потому что ты смелый.",
    "Мне снилась мама. Она сказала, что всё будет хорошо. Это правда?",
  ],
};

const BY_MOOD: Record<string, string[]> = {
  hungry: ["Живот сводит. Я не жалуюсь, просто… когда мы в последний раз ели нормально?"],
  thirsty: ["Горло как наждак. Воды бы. Кто-нибудь качал насос сегодня?"],
  tired: ["Я еле держусь на ногах. Мне бы поспать на нормальной койке."],
  sad: ["Иногда мне кажется, что стены сдвигаются. Поговори со мной ещё немного, ладно?", "Я держусь. Правда. Просто сегодня тяжело."],
  happy: ["Знаешь, сегодня хороший день. Не знаю почему. Просто хороший.", "Я сегодня смеялся впервые за неделю. Спасибо, что вы все рядом."],
  hurt: ["Рана ноет. Ничего, заживёт. Я крепкий… наверное."],
};

const SMALL_TALK = [
  "Ты заметил, что генератор по утрам гудит тише? Или я привык.",
  "Я вчера нашёл в кладовой банку без этикетки. Боюсь открывать. Вдруг там персики.",
  "Знаешь, чего мне не хватает? Сквозняка. Нормального, с улицы.",
  "Как спалось? Мне снилось, что я опоздал на трамвай. Смешно, да?",
  "Если найдёте на вылазке шерстяные носки — я ваш должник навсегда.",
  "Посчитал: до войны я пил четыре кружки кофе в день. Сейчас — ноль. И ничего, живой.",
  "Мне кажется, наш радиоприёмник влюблён в одну станцию. Всё время на неё сползает.",
  "Давай вечером в карты? Только чур без мухлежа.",
];

const REPLIES = [
  { id: "listen", label: "Выслушать и посочувствовать" },
  { id: "cheer", label: "«Прорвёмся. Мы же вместе»" },
  { id: "joke", label: "Пошутить (ХАР)" },
];

function moodKey(c: Char): string | null {
  if (c.injury || c.needs.health < 40) return "hurt";
  if (c.needs.food < 30) return "hungry";
  if (c.needs.water < 30) return "thirsty";
  if (c.needs.energy < 25) return "tired";
  if (c.needs.sanity < 40) return "sad";
  if (c.needs.sanity > 80) return "happy";
  return null;
}

const WISH_ITEMS: Record<string, string[]> = {
  teacher: ["book"],
  radioman: ["batteries"],
  doctor: ["meds"],
  cook: ["seed_tomato", "meat"],
  farmer: ["seed_strawberry", "seed_carrot"],
  engineer: ["parts"],
  electrician: ["batteries"],
  soldier: ["ammo"],
  priest: ["cloth"],
  conman: ["cigarettes"],
  chemist: ["chem"],
  miner: ["cigarettes"],
  child: ["teddy"],
};

/** A request tied to the bunker's current state, if there is one worth asking for. */
function pickRequest(w: World, c: Char, R: Rng): Offer | undefined {
  const options: Offer[] = [];
  // chores that bother people: dirty filters, sparking wiring, leaks, broken machines, dirt
  const bothering = ["clean_air_filter", "flush_water_filter", "fix_wiring", "fix_leak", "repair", "clean_room", "oil_generator"];
  for (const ch of Object.values(w.chores)) {
    if (!bothering.includes(ch.kind)) continue;
    const def = CHORE_DEFS[ch.kind];
    const where = ch.obj && w.objs[ch.obj] ? ` (${OBJECTS[w.objs[ch.obj].kind]?.name ?? ""})` : "";
    const why =
      ch.kind === "clean_air_filter"
        ? "Дышать тяжело, голова гудит. Фильтр воздуха совсем забился."
        : ch.kind === "flush_water_filter"
          ? "Вода отдаёт ржавчиной. Водоочистку давно не промывали."
          : ch.kind === "fix_wiring"
            ? "Проводка искрит — я боюсь, что мы сгорим ночью."
            : ch.kind === "fix_leak"
              ? "Капает и капает. Всю ночь: кап… кап… Я схожу с ума."
              : ch.kind === "clean_room"
                ? "Грязь кругом. Так и до болезни недолго."
                : ch.kind === "oil_generator"
                  ? "Генератор скрипит, как старая телега."
                  : `Опять сломалось${where}. Без этого нам туго.`;
    options.push({ giver: c.id, kind: "chore", target: ch.id, text: `${def?.name ?? "Дело"}${where}`, why });
  }
  // rooms people miss
  const missing = [
    { type: "rec", why: "Нам нужно место, где можно просто посидеть. Не работать. Комнату отдыха бы…" },
    { type: "med", why: "Если кто-то серьёзно поранится — где мы будем его лечить? На столе в столовой?" },
    { type: "workshop", why: "Мне бы мастерскую. Я столько всего могла бы собрать." },
    { type: "chapel", why: "Уголок тишины. Помолиться, подумать. Многим бы помогло." },
  ].filter((m) => !roomsOfType(w, m.type).some((r) => r.state === "done") && ROOMS[m.type]);
  if (missing.length) {
    const m = R.pick(missing);
    options.push({ giver: c.id, kind: "room", target: m.type, text: `Построить: ${ROOMS[m.type].name}`, why: m.why });
  }
  // something from the outside
  const wish = WISH_ITEMS[c.card.prof];
  if (wish) {
    const item = R.pick(wish);
    if (ITEMS[item]) options.push({ giver: c.id, kind: "bring", target: item, need: Math.floor(w.res[item] ?? 0) + 2, text: `Принести с вылазки: ${itemName(item)} ×2`, why: `Если будете наверху — поищите ${itemName(item).toLowerCase()}. Мне очень нужно.` });
  }
  if (!options.length) return undefined;
  return R.pick(options);
}

/** Today's conversation with `c` (generated once per day, the same for everyone). */
export function talkToday(w: World, c: Char): TalkToday {
  const talks = (w.mods.talks ??= {}) as Record<string, TalkToday>;
  const have = talks[c.id];
  if (have && have.day === w.day) return have;
  const R = Rng.from((w.seed ^ (w.day * 7919)) + c.id.length * 131 + c.id.charCodeAt(c.id.length - 1) * 17);
  const quests = (w.mods.quests ?? []) as Quest[];
  const hasQuest = quests.some((q) => q.giver === c.id && !q.done);
  // most days it is just talk: small talk, a joke, a memory; a request only now and then
  const offer = !hasQuest && R.chance(0.28) ? pickRequest(w, c, R) : undefined;
  const B = barksJson as Record<string, string[]>;
  const roll = R.next();
  let kind: "story" | "joke" | "small" = "story";
  const mood = moodKey(c);
  let text: string;
  if (offer) text = offer.why;
  else if (mood && R.chance(0.5)) text = R.pick(BY_MOOD[mood]);
  else if (roll < 0.3) {
    kind = "joke";
    text = "Слушай анекдот. " + R.pick(B.joke).replace(/^Анекдот: /, "");
  } else if (roll < 0.62) {
    kind = "small";
    text = R.pick(SMALL_TALK);
  } else text = R.pick(BY_PROF[c.card.prof] ?? BY_PROF.teacher);
  const replies = offer
    ? [{ id: "accept", label: `«Сделаю»: ${offer.text}` }, { id: "later", label: "«Извини, сейчас не могу»" }]
    : kind === "joke"
      ? [{ id: "laugh", label: "Посмеяться" }, { id: "joke", label: "Рассказать свой (ХАР)" }, { id: "groan", label: "«Бородатый…»" }]
      : kind === "small"
        ? [{ id: "cheer", label: "Поболтать о пустяках" }, { id: "joke", label: "Пошутить (ХАР)" }, { id: "listen", label: "Кивнуть и послушать" }]
        : REPLIES;
  const t: TalkToday = { day: w.day, text, replies, offer };
  talks[c.id] = t;
  return t;
}

defAction({
  id: "talk",
  type: "char",
  prio: 20,
  avail: ({ w, c, t }) => {
    const o = w.chars[t.id];
    if (!o || o.status !== "ok" || o === c || c.ctrl === undefined || !c.ctrl) return null;
    const today = talkToday(w, o);
    return today.answered ? `💬 Поболтать с ${firstName(o)}` : `💬 Поговорить с ${firstName(o)} ✦`;
  },
  dur: () => 0,
  done: ({ w, c, t }) => {
    const o = w.chars[t.id];
    if (!o) return;
    o.dir = c.x < o.x ? -1 : 1;
    c.dir = o.x < c.x ? -1 : 1;
    if (c.ctrl && !isBotDriven(w, c.id)) fx(w, { k: "news", to: c.ctrl, id: "talk_res", data: { char: o.id } });
  },
});

registerCmd("talkReply", (w, p, cmd) => {
  const me = p.char ? w.chars[p.char] : undefined;
  const o = w.chars[String(cmd.char)];
  if (!me || !o || o.status === "dead") return "Не с кем говорить";
  if (me.lv !== o.lv || Math.abs(me.x - o.x) > 2.2) return "Подойдите ближе";
  const t = talkToday(w, o);
  if (t.answered) return "Вы уже поговорили сегодня";
  const R = rng(w);
  t.answered = String(cmd.r);
  me.rel[o.id] = clamp((me.rel[o.id] ?? 0) + 3, -100, 100);
  o.rel[me.id] = clamp((o.rel[me.id] ?? 0) + 5, -100, 100);
  switch (cmd.r) {
    case "accept": {
      if (!t.offer) return;
      const { why: _why, ...rest } = t.offer;
      const q: Quest = { ...rest, id: "q" + w.nextId++, by: me.id, day: w.day };
      (w.mods.quests ??= []).push(q);
      t.answerText = `${firstName(o)} улыбается: «Спасибо. Я знала, что на тебя можно положиться»`;
      log(w, `💬 ${firstName(me)} обещает ${firstName(o)}: ${q.text}.`, "event");
      break;
    }
    case "later":
      o.needs.sanity = clamp(o.needs.sanity - 2);
      t.answerText = `«Понимаю… Ладно»`;
      break;
    case "laugh":
      o.needs.sanity = clamp(o.needs.sanity + 7);
      me.needs.sanity = clamp(me.needs.sanity + 5);
      t.answerText = `Вы оба смеётесь. ${firstName(o)}: «Вот! А ты говорил — не смешно»`;
      break;
    case "groan":
      o.needs.sanity = clamp(o.needs.sanity + 2);
      t.answerText = `${firstName(o)} фыркает: «Зато проверенный временем»`;
      break;
    case "joke": {
      const ok = R.d20() + me.card.stats.har >= 11;
      o.needs.sanity = clamp(o.needs.sanity + (ok ? 10 : -3));
      t.answerText = ok ? `${firstName(o)} смеётся — впервые за день.` : `${firstName(o)} криво улыбается: «Не смешно, но спасибо, что пытаешься»`;
      break;
    }
    case "cheer":
      o.needs.sanity = clamp(o.needs.sanity + 6);
      me.needs.sanity = clamp(me.needs.sanity + 2);
      t.answerText = `«Вместе… да. Вместе»`;
      break;
    default:
      o.needs.sanity = clamp(o.needs.sanity + 8);
      t.answerText = `${firstName(o)} вздыхает: «Спасибо, что выслушал. Правда»`;
  }
  grantXp(me, 2);
  o.bark = { text: t.answerText.replace(/^.*?«|».*$/g, "") || "…", t: 4 };
});

/** Are the requests done? The bunker's state decides. */
function questDone(w: World, q: Quest) {
  switch (q.kind) {
    case "chore":
      return !w.chores[q.target];
    case "room":
      return roomsOfType(w, q.target).some((r) => r.state === "done");
    case "bring":
      return (w.res[q.target] ?? 0) >= (q.need ?? 1);
  }
}

onTick("quests", "day", (w, dt) => {
  w.flags._questT = (w.flags._questT ?? 0) + dt;
  if (w.flags._questT < 1) return;
  w.flags._questT = 0;
  const qs = (w.mods.quests ?? []) as Quest[];
  for (const q of qs) {
    if (q.done) continue;
    const giver = w.chars[q.giver];
    if (!giver || giver.status === "dead") {
      q.done = true;
      continue;
    }
    if (!questDone(w, q)) continue;
    q.done = true;
    const hero = w.chars[q.by];
    giver.needs.sanity = clamp(giver.needs.sanity + 15);
    giver.rel[q.by] = clamp((giver.rel[q.by] ?? 0) + 15, -100, 100);
    if (hero) grantXp(hero, 25);
    giver.bark = { text: "Спасибо! Ты сдержал(а) слово.", t: 5 };
    log(w, `✅ ${firstName(giver)} благодарит ${hero ? firstName(hero) : "всех"}: «${q.text}» — сделано. +25 опыта.`, "good");
    if (hero?.ctrl) fx(w, { k: "toast", to: hero.ctrl, text: `✅ Просьба ${firstName(giver)} выполнена: +25 опыта` });
  }
  // finished requests fade; old ones are forgotten after three days
  w.mods.quests = qs.filter((q) => !q.done || w.day - q.day < 1).filter((q) => w.day - q.day <= 3 || !q.done);
});

modViews.quests = { pub: (w, qs: Quest[] | undefined) => (qs ?? []).filter((q) => !q.done).map((q) => ({ id: q.id, giver: q.giver, by: q.by, text: q.text, kind: q.kind, target: q.target })) };
modViews.talks = {
  pub: (w, t: Record<string, TalkToday> | undefined) => {
    const out: Record<string, any> = {};
    for (const id in t ?? {}) if (t![id].day === w.day) out[id] = { text: t![id].text, replies: t![id].replies, answered: t![id].answered, answerText: t![id].answerText, prof: PROFS[w.chars[id]?.card.prof ?? ""]?.name };
    return out;
  },
};
