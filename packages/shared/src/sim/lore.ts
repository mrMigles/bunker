import booksJson from "../data/books.json";
import papersJson from "../data/newspapers.json";
import puzzlesJson from "../data/puzzles.json";
import type { SkillId, World } from "../types";
import { defAction } from "./actions";
import { registerCmd } from "./commands";
import { councilHooks } from "./council";
import { WEATHER } from "./director";
import { clamp, firstName, fx, log, rng, homeChars } from "./util";

export interface Clipping {
  id: string;
  paper: string;
  before: number;
  kind: string;
  title: string;
  text: string;
  puzzle?: string;
}
export const CLIPPINGS = papersJson as Clipping[];
export const CLIP_BY_ID: Record<string, Clipping> = Object.fromEntries(CLIPPINGS.map((c) => [c.id, c]));
export const PUZZLES = puzzlesJson as Record<string, { title: string; words: { answer: string; clue: string; row: number; col: number; dir: "across" | "down" }[]; reward: { sanity: number; hint?: string } }>;
export const BOOKS = booksJson as Record<string, { title: string; skill: SkillId; text: string }>;

/** Turns placeholder ids ("rand1234") into real unread clipping ids. */
export function resolveUnread(w: World) {
  const pool = CLIPPINGS.filter((c) => c.before >= 0 && !w.archive.includes(c.id) && !w.unread.includes(c.id)).map((c) => c.id);
  w.unread = w.unread.map((id) => {
    if (!id.startsWith("rand")) return id;
    if (!pool.length) return "";
    const i = Number(id.slice(4)) % pool.length;
    return pool.splice(i, 1)[0];
  }).filter(Boolean);
}

defAction({
  id: "read_papers",
  type: "obj",
  kinds: ["bookshelf", "dining_table", "armchair"],
  prio: 43,
  bot: false,
  avail: ({ w }) => {
    resolveUnread(w);
    return w.unread.length ? `📰 Почитать газеты (${w.unread.length} новых)` : null;
  },
  dur: () => 3,
  anim: "read",
  done: ({ w, c }) => {
    // the client opens the newspaper screen; server marks the first unread as read
    const id = w.unread.shift();
    if (!id) return;
    markRead(w, id, c.id);
    if (c.ctrl) fx(w, { k: "news", to: c.ctrl, id });
  },
});

export function markRead(w: World, id: string, charId: string) {
  if (!w.archive.includes(id)) w.archive.push(id);
  const c = w.chars[charId];
  if (c) {
    c.needs.sanity = clamp(c.needs.sanity + 3);
    w.flags["_read_" + c.id] = (w.flags["_read_" + c.id] ?? 0) + 1;
  }
}

registerCmd("archive", (w, p, cmd) => {
  // re-read from the archive: just a client screen; nothing to change
  if (!w.archive.includes(String(cmd.id))) return "Нет в архиве";
});

registerCmd("solvePuzzle", (w, p, cmd) => {
  const pz = PUZZLES[String(cmd.id)];
  if (!pz) return "Нет такой головоломки";
  if (w.flags["_solved_" + cmd.id]) return "Уже разгадано";
  const answers = (cmd.answers ?? []) as string[];
  const ok = pz.words.every((wd, i) => String(answers[i] ?? "").toUpperCase().replace(/Е/g, "Ё").replace(/Ё/g, "Е") === wd.answer.replace(/Ё/g, "Е"));
  if (!ok) return "Где-то ошибка…";
  w.flags["_solved_" + cmd.id] = 1;
  for (const c of homeChars(w)) c.needs.sanity = clamp(c.needs.sanity + pz.reward.sanity * 0.5);
  const me = p.char ? w.chars[p.char] : undefined;
  if (me) me.needs.sanity = clamp(me.needs.sanity + pz.reward.sanity);
  let hint = "";
  if (pz.reward.hint === "cache") {
    w.flags.cache_hint = 1;
    hint = " На полях карандашом: «ключ от склада — на заправке, под кассой». (Отмечено на карте пустошей.)";
  } else if (pz.reward.hint === "ark") {
    w.flags.ark_hint = 1;
    hint = " Ответы складываются в фразу: «Ковчег в горах, слушай 74.0».";
  }
  log(w, `🧩 ${p.name} разгадывает «${pz.title}»!${hint}`, "good");
});

// ---------------------------------------------------------------- books & tapes (client shows the text)

defAction({
  id: "pick_book",
  type: "obj",
  kinds: ["bookshelf"],
  prio: 44,
  avail: ({ w, c }) => (c.ctrl && w.books.length ? "📚 Выбрать книгу…" : null),
  dur: () => 0,
  done: ({ w, c }) => {
    if (c.ctrl) fx(w, { k: "news", to: c.ctrl, id: "books" });
  },
});

registerCmd("readBook", (w, p, cmd) => {
  const c = p.char ? w.chars[p.char] : undefined;
  const b = BOOKS[String(cmd.id)];
  if (!c || !b || !w.books.includes(String(cmd.id))) return;
  c.skills[b.skill] = (c.skills[b.skill] ?? 0) + 6;
  c.needs.sanity = clamp(c.needs.sanity + 3);
});

// ---------------------------------------------------------------- the drawing wall (32×16 pixels, palette of 8)

export const CANVAS_W = 32;
export const CANVAS_H = 16;

registerCmd("paint", (w, p, cmd) => {
  const i = Math.floor(Number(cmd.i));
  const col = Math.floor(Number(cmd.c));
  if (!(i >= 0 && i < CANVAS_W * CANVAS_H) || !(col >= 0 && col < 8)) return;
  let s = w.canvas || "0".repeat(CANVAS_W * CANVAS_H);
  if (s.length !== CANVAS_W * CANVAS_H) s = s.padEnd(CANVAS_W * CANVAS_H, "0").slice(0, CANVAS_W * CANVAS_H);
  w.canvas = s.slice(0, i) + col + s.slice(i + 1);
  const c = p.char ? w.chars[p.char] : undefined;
  if (c && rng(w).chance(0.05)) c.needs.sanity = clamp(c.needs.sanity + 1);
});

defAction({
  id: "draw",
  type: "obj",
  kinds: ["drawing_wall"],
  prio: 40,
  bot: true,
  avail: () => "🎨 Рисовать на стене",
  dur: () => 0,
  anim: "work",
  tick: ({ w, c }, dt) => {
    c.needs.sanity = clamp(c.needs.sanity + dt * 0.05);
    // bots doodle a pixel now and then
    if (!c.ctrl && rng(w).chance(dt * 0.5)) {
      const R = rng(w);
      let s = w.canvas || "0".repeat(CANVAS_W * CANVAS_H);
      const i = R.int(0, CANVAS_W * CANVAS_H - 1);
      s = s.slice(0, i) + R.int(1, 7) + s.slice(i + 1);
      w.canvas = s;
    }
    if (!c.ctrl && w.phaseT > (c.mind.until ?? 0)) return true;
  },
});

// ---------------------------------------------------------------- «Вестник Бункера»

const JOKES = [
  "— Доктор, у меня бессонница. — Крутите педали, батенька, до утра. Заодно свет будет.",
  "Оптимист учит язык Остмарка. Пессимист — азбуку Морзе. Реалист — как чинить фильтр.",
  "Встречаются два таракана-мутанта: «Как жизнь?» — «Лучше всех. Буквально».",
  "Почему в бункере не играют в прятки? Потому что все прятки уже заняты.",
  "Шахтёр копал, копал и выкопал… другого шахтёра. Оказалось — зеркало.",
  "— Что на ужин? — Вечность. — Опять?! — Она же вечная.",
  "Объявление: меняю три банки тушёнки на честный ответ, кто храпит.",
];

export function makeGazette(w: World) {
  const prevDay = w.day - 1;
  const lines: string[] = [];
  const name = (id: string) => (w.chars[id] ? w.chars[id].card.name : "?");
  const top = (m: Record<string, number>) => Object.entries(m).sort((a, b) => b[1] - a[1])[0];
  const dug = top(w.stats.dug);
  if (dug && dug[1] > 0) lines.push(`⛏ ${name(dug[0])} выкопал(а) ${dug[1] * 2} метров породы!`);
  const harvest = Object.entries(w.stats.harvest).filter(([, n]) => n > 0);
  if (harvest.length) lines.push(`🧺 Урожай: ${harvest.map(([k, n]) => `${k === "mushroom" ? "грибы" : k} ×${n}`).join(", ")}.`);
  const cooked = top(w.stats.cooked);
  if (cooked && cooked[1] > 0) lines.push(`🍲 Шеф дня: ${name(cooked[0])} (${cooked[1]} блюд).`);
  for (const id of w.stats.deaths) lines.push(`🕯 Помним: ${name(id)}.`);
  for (const e of w.stats.events.slice(-2)) lines.push(`📜 Совет решал: «${e}».`);
  // goals of the day, milestones: whatever the day's systems asked to print
  for (const l of ((w.mods as any)._newsLines ?? []) as string[]) lines.push(l);
  delete (w.mods as any)._newsLines;
  if ((w.res.strawberry ?? 0) < (w.flags._strawYesterday ?? 0)) lines.push("🍓 Кто опять съел клубнику?!");
  w.flags._strawYesterday = w.res.strawberry ?? 0;
  const chores = top(w.stats.chores);
  const best = chores && chores[1] > 0 ? `${name(chores[0])} — ${chores[1]} дел` : undefined;
  const R = rng(w);
  const headlines = [
    `ДЕНЬ ${w.day}: БУНКЕР ДЕРЖИТСЯ`,
    lines.length > 3 ? "БУРНЫЙ ДЕНЬ ПОД ЗЕМЛЁЙ" : "ТИХИЙ ДЕНЬ ПОД ЗЕМЛЁЙ",
    w.stats.deaths.length ? "СКОРБНЫЙ ВЫПУСК" : harvest.length ? "УРОЖАЙНЫЙ ВЫПУСК" : `ВЕСТНИК №${w.gazette.length + 1}`,
  ];
  w.gazette.push({
    day: prevDay,
    headline: w.stats.deaths.length ? headlines[2] : R.pick(headlines),
    lines: lines.length ? lines : ["Происшествий не было. И это — новость."],
    joke: R.pick(JOKES),
    weather: `${WEATHER[w.weather.today]?.icon ?? ""} ${WEATHER[w.weather.today]?.name ?? ""}, дальше: ${w.weather.forecast.map((k) => WEATHER[k]?.name ?? k).join(", ")}`,
    best,
    reader: [],
  });
  if (w.gazette.length > 60) w.gazette.shift();
  // reset daily stats
  w.stats.dug = {};
  w.stats.harvest = {};
  w.stats.cooked = {};
  w.stats.chores = {};
  w.stats.deaths = [];
  w.stats.events = [];
  w.flags.harvests = (w.flags.harvests ?? 0) + harvest.length;
}

councilHooks.morning.push(makeGazette);

registerCmd("gazetteLine", (w, p, cmd) => {
  const g = w.gazette[w.gazette.length - 1];
  if (!g) return "Выпуска ещё нет";
  const text = String(cmd.text ?? "").trim().slice(0, 100);
  if (!text) return;
  g.reader ??= [];
  if (g.reader.some((r) => r.by === p.name)) return "Одна строчка в день";
  g.reader.push({ by: p.name, text });
});

export { firstName };
