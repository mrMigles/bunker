import { portrait } from "../render/portrait";
import { art, portraitTile } from "./art";
import { postfx, type FxQuality } from "../render/postfx";
import { NEED_IC, SKILL_IC, STAT_IC, cic, icon } from "./icons";
import {
  BOOKS,
  CANVAS_H,
  CANVAS_W,
  CHORE_DEFS,
  CLIP_BY_ID,
  FURNITURE,
  GOALS,
  ITEMS,
  NEED_NAMES,
  PROFS,
  PUZZLES,
  RECIPES,
  SKILL_NAMES,
  STAT_NAMES,
  TRAITS_MINUS,
  TRAITS_PLUS,
  costText,
  itemName,
  matchRecipe,
  skillLevel,
  PERKS,
  BOX_NAMES,
  OBJECTS,
  type Clipping,
} from "@bunker/shared";
import { audio } from "../audio/audio";
import { net } from "../net";
import { bar, clear, closeModal, h, modal, toast } from "./dom";
import { injuryName } from "./hud";

// ---------------------------------------------------------------- newspaper

export function openClipping(id: string) {
  const c = CLIP_BY_ID[id];
  if (!c) return;
  const box = modal("", paperEl(c), { cls: "paper-modal" });
  box.style.background = "transparent";
  box.style.border = "none";
  box.style.boxShadow = "none";
}

function paperEl(c: Clipping): HTMLElement {
  const date = c.before > 0 ? `за ${c.before} ${plural(c.before, "день", "дня", "дней")} до Вспышки` : c.before === 0 ? "в день Вспышки" : "найдено в бункере";
  const el = h(
    "div.newspaper",
    null,
    h("div.np-head", null, h("div.np-paper", null, c.paper), h("div.np-date", null, date)),
    h("div.np-title" + (c.kind === "ad" ? ".np-ad" : ""), null, c.title),
    c.kind === "cartoon" ? cartoon(c.id) : null,
    h("div.np-text", null, c.text),
  );
  if (c.puzzle) el.appendChild(crossword(c.puzzle));
  el.appendChild(h("div.np-foot", null, h("button.small", { onclick: () => openArchive() }, "📚 Архив"), h("button.small", { onclick: closeModal }, "Закрыть")));
  return el;
}

function plural(n: number, a: string, b: string, c: string) {
  const m10 = n % 10,
    m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? b : c;
}

/** Procedural cartoon drawn on canvas from the clipping id. */
function cartoon(seed: string): HTMLElement {
  const cv = document.createElement("canvas");
  cv.width = 320;
  cv.height = 150;
  const g = cv.getContext("2d")!;
  let s = [...seed].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) >>> 0;
  const r = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  g.fillStyle = "#e3d6b8";
  g.fillRect(0, 0, 320, 150);
  g.strokeStyle = "#2a2320";
  g.lineWidth = 2.5;
  g.lineCap = "round";
  for (let k = 0; k < 2; k++) {
    const x = 90 + k * 140 + r() * 20;
    const fat = 25 + r() * 20;
    g.beginPath();
    g.ellipse(x, 95, fat, 35, 0, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.arc(x, 45, 16, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.moveTo(x - 6, 42);
    g.lineTo(x - 2, 44);
    g.moveTo(x + 6, 42);
    g.lineTo(x + 2, 44);
    g.moveTo(x - 7, 53);
    g.quadraticCurveTo(x, 50 + r() * 8, x + 7, 53);
    g.stroke();
    g.beginPath();
    g.moveTo(x - fat, 90);
    g.lineTo(x - fat - 25, 70 + r() * 30);
    g.moveTo(x + fat, 90);
    g.lineTo(x + fat + 25, 70 + r() * 30);
    g.stroke();
  }
  g.font = "bold 14px 'PT Serif'";
  g.fillStyle = "#2a2320";
  g.fillText("«...»", 150, 20);
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(80,60,30,${r() * 0.08})`;
    g.fillRect(r() * 320, r() * 150, 2, 2);
  }
  return h("div.np-cartoon", null, cv);
}

function crossword(id: string): HTMLElement {
  const pz = PUZZLES[id];
  const wrap = h("div.cw");
  if (!pz) return wrap;
  const solved = !!net.pub?.flags?.["_solved_" + id];
  let rows = 0,
    cols = 0;
  for (const wd of pz.words) {
    rows = Math.max(rows, wd.row + (wd.dir === "down" ? wd.answer.length : 1));
    cols = Math.max(cols, wd.col + (wd.dir === "across" ? wd.answer.length : 1));
  }
  const cells: Record<string, HTMLInputElement> = {};
  const numbers: Record<string, number> = {};
  pz.words.forEach((wd, i) => {
    numbers[`${wd.row},${wd.col}`] ??= i + 1;
    for (let k = 0; k < wd.answer.length; k++) {
      const r = wd.row + (wd.dir === "down" ? k : 0);
      const c = wd.col + (wd.dir === "across" ? k : 0);
      const key = `${r},${c}`;
      if (!cells[key]) {
        const inp = h("input", { maxLength: 1, value: solved ? wd.answer[k] : "", disabled: solved }) as HTMLInputElement;
        inp.addEventListener("input", () => {
          inp.value = inp.value.toUpperCase();
          const all = Object.values(cells);
          const idx = all.indexOf(inp);
          if (inp.value && all[idx + 1]) all[idx + 1].focus();
        });
        cells[key] = inp;
      }
    }
  });
  const grid = h("div.cw-grid", { style: { gridTemplateColumns: `repeat(${cols}, 28px)` } });
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const key = `${r},${c}`;
      grid.appendChild(cells[key] ? h("div.cw-cell", null, numbers[key] ? h("span.cw-n", null, String(numbers[key])) : null, cells[key]) : h("div.cw-empty"));
    }
  wrap.append(
    h("div.np-title", { style: { fontSize: "18px" } }, pz.title),
    h("div.row", { style: { alignItems: "flex-start", gap: "16px" } }, grid, h("ol.cw-clues", null, pz.words.map((wd) => h("li", null, `${wd.clue} (${wd.answer.length}, ${wd.dir === "across" ? "→" : "↓"})`)))),
    solved
      ? h("div.cw-done", null, "✔ Разгадано!")
      : h(
          "button.small",
          {
            onclick: () => {
              const answers = pz.words.map((wd) => {
                let s = "";
                for (let k = 0; k < wd.answer.length; k++) s += cells[`${wd.row + (wd.dir === "down" ? k : 0)},${wd.col + (wd.dir === "across" ? k : 0)}`].value || " ";
                return s;
              });
              net.send({ k: "solvePuzzle", id, answers });
            },
          },
          "Проверить",
        ),
  );
  return wrap;
}

export function openArchive() {
  const v = net.pub!;
  const list = (v.archive as string[]).map((id) => CLIP_BY_ID[id]).filter(Boolean).sort((a, b) => b.before - a.before);
  const total = Object.values(CLIP_BY_ID).filter((c) => c.before >= 0).length;
  modal(
    `📚 Архив газет (${list.filter((c) => c.before >= 0).length}/${total})`,
    h(
      "div.col",
      { style: { minWidth: "480px" } },
      list.length ? list.map((c) => h("button", { style: { textAlign: "left" }, onclick: () => openClipping(c.id) }, `${c.before >= 0 ? "📰" : "📝"} ${c.title}`, h("span.dim", null, ` — ${c.paper}${c.puzzle ? " · 🧩" : ""}`))) : h("div.dim", null, "Пока пусто. Газеты находят в прологе, при копании и в вылазках."),
    ),
  );
}

// ---------------------------------------------------------------- notice board

export function openBoard(tab: "store" | "chores" | "gazette" | "recipes" = "store") {
  const v = net.pub!;
  const body = h("div.board", { style: { minWidth: "min(620px, 100%)" } });
  const tabBtn = (id: typeof tab, ic: string, label: string) => h("button" + (tab === id ? ".primary" : ""), { onclick: () => openBoard(id) }, icon(ic), label);
  const tabs = h(
    "div.tabs",
    null,
    tabBtn("store", "box", "Склад"),
    tabBtn("chores", "board", "Доска дел"),
    tabBtn("gazette", "news", "«Вестник Бункера»"),
    tabBtn("recipes", "book", "Рецепты"),
    h("button", { onclick: () => openArchive() }, icon("journal"), "Архив газет"),
  );
  body.appendChild(tabs);
  if (tab === "store") {
    // everything the bunker owns, by kind: weapons and games used to be invisible
    const groups: [string, string[], string, string][] = [
      ["Еда и вода", ["food", "water", "dish"], "fork", "#e8a45a"],
      ["Оружие и защита", ["weapon"], "swords", "#ef6a4c"],
      ["Медицина", ["med"], "meds", "#e45a4a"],
      ["Инструменты", ["tool"], "wrench", "#e0a458"],
      ["Материалы", ["mat"], "parts", "#c9b48a"],
      ["Семена", ["seed"], "sparkles", "#7fd18b"],
      ["Досуг", ["fun", "misc", "lore"], "music", "#a88cf0"],
    ];
    const res = v.res as Record<string, number>;
    const catOf = (k: string) => (k.startsWith("dish_") ? "dish" : ITEMS[k]?.cat ?? "misc");
    const grid = h("div.store-grid");
    for (const [name, cats, ic, col] of groups) {
      const rows = Object.keys(res).filter((k) => res[k] >= 1 && cats.includes(catOf(k))).sort((a, b) => res[b] - res[a]);
      if (!rows.length && cats[0] === "weapon") rows.push("__none");
      if (!rows.length) continue;
      grid.appendChild(
        h(
          "section.store-group.sect",
          null,
          h("div.sect-h", null, icon(ic, { color: col }), name),
          ...rows.map((k) =>
            k === "__none"
              ? h("div.dim", null, "Пусто. Оружие находят на вылазках: в шкафчиках, у тел, в ящиках с инструментами.")
              : h("div.store-row", null, h("span", null, ITEMS[k]?.icon ?? "◇"), h("span.grow", null, itemName(k)), h("b", null, String(Math.floor(res[k])))),
          ),
        ),
      );
    }
    const games = (v.games as string[]) ?? [];
    grid.appendChild(h("section.store-group.sect", null, h("div.sect-h", null, icon("dice", { color: "#f2b53c" }), "Настольные игры"), ...(games.length ? games.map((g) => h("div.store-row", null, h("span", null, "🎲"), h("span.grow", null, BOX_NAMES[g] ?? g))) : [h("div.dim", null, "Пока только колода. Настолки лежат в полках с играми, книжных шкафах и тайниках.")])));
    body.appendChild(grid);
  } else if (tab === "chores") {
    const chores = Object.values(v.chores as Record<string, any>).sort((a, b) => b.urgency - a.urgency);
    body.appendChild(h("div.dim", { style: { marginBottom: "6px" } }, "Боты берут карточки сами. «Приколоть» — взять себе (боты не тронут). «Важно» — боты возьмут раньше."));
    const me = net.priv!.pid;
    for (const ch of chores) {
      const def = CHORE_DEFS[ch.kind];
      const by = ch.by ? v.chars[ch.by]?.card.name.split(" ")[0] : null;
      body.appendChild(
        h(
          "div.row",
          { style: { padding: "4px", borderBottom: "1px solid #2a221c", background: ch.urgency > 0.75 ? "rgba(214,40,40,0.12)" : "" } },
          h("span", { style: { width: "24px" } }, def?.icon ?? "•"),
          h("span.grow", null, def?.name ?? ch.kind, h("span.dim", null, " " + (targetName(v, ch) ?? ""))),
          by ? h("span.tag", null, "🤖 " + by) : null,
          ch.pinnedBy ? h("span.tag", null, "📌 " + (v.players[ch.pinnedBy]?.name ?? "")) : null,
          bar(ch.urgency * 100, ch.urgency > 0.75 ? "#e0503a" : "#e8c14a"),
          h("button.small" + (ch.pinnedBy === me ? ".primary" : ""), { onclick: () => (net.send({ k: "pinChore", id: ch.id }), setTimeout(() => openBoard("chores"), 200)) }, "📌"),
          h("button.small" + (ch.prio ? ".primary" : ""), { onclick: () => (net.send({ k: "pinChore", id: ch.id, prio: 1 }), setTimeout(() => openBoard("chores"), 200)) }, "❗"),
        ),
      );
    }
    if (!chores.length) body.appendChild(h("div.dim", null, "Дел нет. Бункер в порядке — можно отдохнуть."));
  } else if (tab === "gazette") {
    const g = v.gazette[v.gazette.length - 1];
    if (!g) body.appendChild(h("div.dim", null, "Первый выпуск выйдет утром."));
    else {
      const input = h("input", { placeholder: "Ваша строчка в выпуск (одна в день)…", maxLength: 100, style: { flex: "1" } }) as HTMLInputElement;
      body.append(
        h(
          "div.newspaper",
          null,
          h("div.np-head", null, h("div.np-paper", null, `«Вестник Бункера» №${v.gazetteCount}`), h("div.np-date", null, `за день ${g.day}`)),
          h("div.np-title", null, g.headline),
          h("div.np-text", null, g.lines.map((l: string) => h("div", null, l))),
          g.best ? h("div.np-text", null, h("b", null, "Лучший жилец дня: "), g.best) : null,
          h("div.np-text", null, h("b", null, "Погода по радио: "), g.weather),
          h("div.np-text", { style: { fontStyle: "italic" } }, h("b", null, "Анекдот дня: "), g.joke),
          (g.reader ?? []).length ? h("div.np-text", null, h("b", null, "Пишут жильцы: "), (g.reader ?? []).map((r: any) => h("div", null, `${r.by}: ${r.text}`))) : null,
        ),
        h("div.row", { style: { marginTop: "8px" } }, input, h("button.small", { onclick: () => input.value.trim() && (net.send({ k: "gazetteLine", text: input.value.trim() }), toast("Строчка отправлена в «Вестник»"), setTimeout(() => openBoard("gazette"), 300)) }, "Дописать")),
      );
    }
  } else {
    body.appendChild(h("div.dim", { style: { marginBottom: "6px" } }, "Рецепты открываются экспериментами у плиты."));
    for (const id of v.recipes as string[]) {
      const r = RECIPES[id];
      if (!r) continue;
      body.appendChild(h("div", { style: { padding: "3px 0" } }, `${r.icon} `, h("b", null, r.name), h("span.dim", null, ` — ${Object.keys(r.in).map((k) => `${itemName(k)}×${r.in[k]}`).join(" + ")} → ${r.out} порц. ${r.desc}`)));
    }
    body.appendChild(h("div.dim", { style: { marginTop: "6px" } }, `Неизвестно: ${Object.keys(RECIPES).length - (v.recipes as string[]).length} рецептов.`));
  }
  modal("Убежище", body, { wide: true });
}

function targetName(v: any, ch: any): string | null {
  if (ch.room) return v.rooms[ch.room] ? `(${roomName(v.rooms[ch.room].type)})` : null;
  if (ch.char) return v.chars[ch.char] ? `(${v.chars[ch.char].card.name.split(" ")[0]})` : null;
  if (ch.item) return v.items[ch.item] ? `(${itemName(v.items[ch.item].item)})` : null;
  // digging: which room and which floor, and how much is left of it
  if (ch.cell !== undefined) {
    const rid = v.marks?.[ch.cell];
    const r = rid ? v.rooms[rid] : undefined;
    if (!r) return null;
    const left = Object.values(v.marks ?? {}).filter((m) => m === rid).length;
    return `(${roomName(r.type)}, этаж −${r.lv + 1}, осталось ${left} из ${r.w})`;
  }
  if (ch.obj) return v.objs[ch.obj] ? `(${OBJECTS[v.objs[ch.obj].kind]?.name ?? ""})` : null;
  return null;
}

import { ROOMS } from "@bunker/shared";
function roomName(t: string) {
  return ROOMS[t]?.name ?? t;
}

// ---------------------------------------------------------------- books

export function openBooks() {
  const v = net.pub!;
  modal(
    "📚 Книжный шкаф",
    h(
      "div.col",
      { style: { minWidth: "440px" } },
      (v.books as string[]).map((id) =>
        BOOKS[id]
          ? h(
              "button",
              {
                style: { textAlign: "left" },
                onclick: () => {
                  net.send({ k: "readBook", id });
                  modal(BOOKS[id].title, h("div.newspaper", null, h("div.np-text", { style: { fontSize: "16px" } }, BOOKS[id].text), h("div.dim", null, `+опыт: ${SKILL_NAMES[BOOKS[id].skill]}`)));
                },
              },
              "📕 " + BOOKS[id].title,
            )
          : null,
      ),
    ),
  );
}

// ---------------------------------------------------------------- cooking

export function openCook(a: { a: string; t: { type: string; id: string } }) {
  const v = net.pub!;
  const foods = Object.keys(v.res).filter((k) => ITEMS[k]?.cat === "food" && v.res[k] >= 1);
  const pot: Record<string, number> = {};
  const potEl = h("div.dim");
  const result = h("div");
  const renderPot = () => {
    clear(potEl);
    const keys = Object.keys(pot).filter((k) => pot[k] > 0);
    potEl.append(keys.length ? "В кастрюле: " + keys.map((k) => `${ITEMS[k].icon}${itemName(k)}×${pot[k]}`).join(", ") : "Кастрюля пуста.");
    clear(result);
    const m = matchRecipe(pot);
    if (m && (v.recipes as string[]).includes(m.id)) result.append(h("span.good", null, `Выйдет: ${RECIPES[m.id].icon} ${RECIPES[m.id].name} ×${RECIPES[m.id].out * m.batches}`));
    else if (keys.length) result.append(h("span.warn", null, "Что получится — неизвестно. Эксперимент!"));
  };
  const known = (v.recipes as string[]).filter((id) => RECIPES[id] && id !== "cold_can");
  modal(
    "🍲 Плита",
    h(
      "div.col",
      { style: { minWidth: "520px" } },
      h("div.dim", null, "Сложите продукты в кастрюлю или выберите рецепт. Совпадёт с рецептом — блюдо, нет — «что-то странное» (тоже еда). Готовится ~18 с; блюдо ляжет на склад, а в журнале появится запись, что вышло. Блюда сытнее консервов и поднимают настроение."),
      (() => {
        const dishes = Object.keys(v.res).filter((k) => k.startsWith("dish_") && v.res[k] >= 1);
        return h("div", null, "Готово на складе: ", dishes.length ? dishes.map((k) => `${ITEMS[k]?.icon ?? "🍲"} ${itemName(k)} ×${Math.floor(v.res[k])}`).join(", ") : h("span.dim", null, "пока ничего"));
      })(),
      h(
        "div.row",
        { style: { flexWrap: "wrap" } },
        foods.map((k) =>
          h(
            "button.small",
            {
              onclick: () => {
                if ((pot[k] ?? 0) < Math.min(6, Math.floor(v.res[k]))) pot[k] = (pot[k] ?? 0) + 1;
                renderPot();
              },
            },
            `${ITEMS[k].icon} ${itemName(k)} (${Math.floor(v.res[k])})`,
          ),
        ),
      ),
      potEl,
      result,
      known.length ? h("div", null, "Известные рецепты: ", known.map((id) => { const r = RECIPES[id]; const ok = Object.keys(r.in).every((k) => (v.res[k] ?? 0) >= r.in[k]); return h("button.small" + (ok ? "" : ".dis"), { title: ok ? "Положить в кастрюлю" : "Не хватает продуктов", onclick: () => (Object.keys(pot).forEach((k) => delete pot[k]), Object.assign(pot, r.in), renderPot()) }, `${r.icon} ${r.name}`, h("small.dim", null, ` (${Object.keys(r.in).map((k) => `${itemName(k)}×${r.in[k]}`).join(", ")})`)); })) : null,
      h(
        "div.row",
        null,
        h("button", { onclick: () => (Object.keys(pot).forEach((k) => delete pot[k]), renderPot()) }, "Опустошить"),
        h("div.grow"),
        h(
          "button.primary",
          {
            onclick: () => {
              if (!Object.keys(pot).length) return;
              net.send({ k: "do", a: a.a, tt: a.t.type, t: a.t.id, x: { ...pot } });
              closeModal();
            },
          },
          "Готовить!",
        ),
      ),
    ),
  );
  renderPot();
}

// ---------------------------------------------------------------- crafting

export function openCraft(a: { a: string; t: { type: string; id: string } }) {
  const v = net.pub!;
  modal(
    "🔨 Верстак",
    h(
      "div.col",
      { style: { minWidth: "520px" } },
      h("div.dim", null, "Сделанную вещь нужно отнести и поставить (действие «Поставить здесь»). Уют повышает Комфорт комнаты."),
      Object.keys(FURNITURE).map((k) => {
        const f = FURNITURE[k];
        const ok = Object.keys(f.cost).every((r) => (v.res[r] ?? 0) >= f.cost[r]);
        return h(
          "button" + (ok ? "" : ".dis"),
          { style: { textAlign: "left", opacity: ok ? 1 : 0.5 }, disabled: !ok, onclick: () => (net.send({ k: "do", a: a.a, tt: a.t.type, t: a.t.id, x: k }), closeModal()) },
          `${f.icon} ${f.name}`,
          h("span.dim", null, ` — ${costText(f.cost)}${f.comfort ? `, уют +${f.comfort}` : ""}`),
        );
      }),
    ),
  );
}

// ---------------------------------------------------------------- drawing wall

const PALETTE = ["#e8e0cc", "#2a2320", "#c8553d", "#5a7d4a", "#3d6b8c", "#e8c14a", "#8e5572", "#8a6a4a"];

export function openCanvas() {
  const cv = document.createElement("canvas");
  const S = 16;
  cv.width = CANVAS_W * S;
  cv.height = CANVAS_H * S;
  cv.style.cursor = "crosshair";
  cv.style.border = "4px solid #5a4a3a";
  const g = cv.getContext("2d")!;
  let color = 2;
  let local = (net.pub!.canvas || "").padEnd(CANVAS_W * CANVAS_H, "0");
  const draw = () => {
    const s = (net.pub!.canvas || "").padEnd(CANVAS_W * CANVAS_H, "0");
    // merge remote updates
    local = s;
    for (let i = 0; i < CANVAS_W * CANVAS_H; i++) {
      g.fillStyle = PALETTE[Number(local[i]) || 0];
      g.fillRect((i % CANVAS_W) * S, Math.floor(i / CANVAS_W) * S, S, S);
    }
  };
  let down = false;
  const paint = (e: MouseEvent) => {
    const r = cv.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * CANVAS_W);
    const y = Math.floor(((e.clientY - r.top) / r.height) * CANVAS_H);
    const i = y * CANVAS_W + x;
    if (i < 0 || i >= CANVAS_W * CANVAS_H || local[i] === String(color)) return;
    local = local.slice(0, i) + color + local.slice(i + 1);
    g.fillStyle = PALETTE[color];
    g.fillRect(x * S, y * S, S, S);
    net.send({ k: "paint", i, c: color });
  };
  cv.addEventListener("mousedown", (e) => ((down = true), paint(e)));
  cv.addEventListener("mousemove", (e) => down && paint(e));
  window.addEventListener("mouseup", () => (down = false));
  const pal = h(
    "div.row",
    null,
    PALETTE.map((c, i) => {
      const b = h("button.small", { style: { background: c, width: "28px", height: "24px" }, onclick: () => ((color = i), [...pal.children].forEach((x, k) => ((x as HTMLElement).style.outline = k === i ? "2px solid #fff" : ""))) });
      if (i === color) b.style.outline = "2px solid #fff";
      return b;
    }),
  );
  const iv = setInterval(draw, 1000);
  modal("🎨 Стена для рисунков", h("div.col", null, h("div.dim", null, "Рисуют все жильцы. Рисунок сохраняется вместе с бункером."), cv, pal), { onClose: () => (clearInterval(iv), net.send({ k: "stop" })) });
  draw();
}

// ---------------------------------------------------------------- periscope

export function openPeriscope(data: { weather: string; day: number }) {
  const cv = document.createElement("canvas");
  cv.width = 640;
  cv.height = 300;
  const g = cv.getContext("2d")!;
  const w = data.weather;
  let t = 0;
  let s = data.day * 9301 + 49297;
  const rnd = () => ((s = (s * 233280 + 49297) % 233280) / 233280);
  const buildings = Array.from({ length: 16 }, (_, i) => ({ x: i * 44 + rnd() * 20, w: 30 + rnd() * 30, h: 60 + rnd() * 140, broken: rnd() }));
  const bird = data.day >= 8 && rnd() < 0.35;
  const figure = rnd() < 0.3;
  const ash = Array.from({ length: 120 }, () => ({ x: rnd() * 640, y: rnd() * 300, v: 10 + rnd() * 30 }));
  const frame = () => {
    t += 1 / 30;
    const sky = g.createLinearGradient(0, 0, 0, 300);
    const top = w === "clear" ? "#6a7f95" : w === "storm" ? "#4a3a2a" : w === "radrain" ? "#3f4a2a" : w === "cold" ? "#8a95a0" : "#5a4a44";
    sky.addColorStop(0, top);
    sky.addColorStop(1, w === "clear" ? "#d9a86a" : "#8a6a5a");
    g.fillStyle = sky;
    g.fillRect(0, 0, 640, 300);
    if (w === "clear") {
      g.fillStyle = "rgba(255,230,160,0.8)";
      g.beginPath();
      g.arc(500, 80, 26, 0, Math.PI * 2);
      g.fill();
    }
    for (const b of buildings) {
      g.fillStyle = "#2a2422";
      g.fillRect(b.x, 300 - b.h, b.w, b.h);
      g.fillStyle = "#14100e";
      for (let y = 300 - b.h + 10; y < 290; y += 18) for (let x = b.x + 5; x < b.x + b.w - 6; x += 10) if ((x * y) % 7 < 3) g.fillRect(x, y, 5, 8);
      if (b.broken > 0.5) {
        g.fillStyle = sky;
        g.beginPath();
        g.moveTo(b.x, 300 - b.h);
        g.lineTo(b.x + b.w * 0.6, 300 - b.h + 30);
        g.lineTo(b.x + b.w, 300 - b.h);
        g.fill();
      }
    }
    if (figure) {
      const fx = (t * 12) % 700 - 30;
      g.fillStyle = "#0e0b0a";
      g.fillRect(fx, 262, 6, 16);
      g.beginPath();
      g.arc(fx + 3, 258, 4, 0, Math.PI * 2);
      g.fill();
    }
    if (bird) {
      const bx = (t * 40) % 800 - 80;
      const by = 90 + Math.sin(t * 2) * 12;
      g.strokeStyle = "#1a1412";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(bx - 8, by - Math.abs(Math.sin(t * 8)) * 5);
      g.lineTo(bx, by);
      g.lineTo(bx + 8, by - Math.abs(Math.sin(t * 8)) * 5);
      g.stroke();
    }
    g.fillStyle = w === "radrain" ? "rgba(160,200,80,0.6)" : w === "cold" ? "rgba(240,240,255,0.8)" : "rgba(200,190,180,0.6)";
    for (const a of ash) {
      a.y += a.v / 30;
      a.x += Math.sin(t + a.v) * 0.5 + (w === "storm" ? 4 : 0);
      if (a.y > 300) a.y = 0;
      if (a.x > 640) a.x = 0;
      g.fillRect(a.x, a.y, w === "radrain" ? 1 : 2, w === "radrain" ? 6 : 2);
    }
    // round lens
    const vg = g.createRadialGradient(320, 150, 100, 320, 150, 340);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.95)");
    g.fillStyle = vg;
    g.fillRect(0, 0, 640, 300);
    g.strokeStyle = "rgba(255,255,255,0.15)";
    g.beginPath();
    g.moveTo(320, 120);
    g.lineTo(320, 180);
    g.moveTo(290, 150);
    g.lineTo(350, 150);
    g.stroke();
  };
  const iv = setInterval(frame, 33);
  modal("🔭 Перископ", h("div.col", null, cv, h("div.dim", null, bird ? "Над руинами пролетела птица. Жизнь возвращается?" : figure ? "По улице кто-то идёт. Не к нам ли?" : "Пепел, руины, тишина.")), { onClose: () => clearInterval(iv) });
  if (bird) audio.sfx("find", 0.5);
}

// ---------------------------------------------------------------- character inspector

export function openCharacter(id: string) {
  const v = net.pub!;
  const c = v.chars[id];
  if (!c) return;
  const pd = PROFS[c.card.prof];
  const player = c.ctrl ? v.players[c.ctrl] : null;
  const isMe = id === net.priv?.char;
  const rels = Object.entries(c.rel as Record<string, number>)
    .filter(([oid]) => v.chars[oid] && v.chars[oid].status !== "dead")
    .sort((a, b) => b[1] - a[1]);
  const free = !c.ctrl && c.status !== "dead" && c.status !== "away";
  const relWord = (r: number) => (r > 40 ? "друзья" : r > 10 ? "приятели" : r < -20 ? "не ладят" : "нейтрально");
  const relIcon = (r: number) => (r > 10 ? icon("heart", { color: "#6fd07a" }) : r < -20 ? icon("alert", { color: "#ef6b5a" }) : icon("user", { color: "#b2a693" }));
  modal(
    c.card.name,
    h(
      "div.dossier",
      null,
      h(
        "div.dossier-left",
        null,
        h(
          "div.dossier-head",
          null,
          portrait(c.id, c.card, "dossier-portrait", () => art(portraitTile(c.card.prof, c.card.gender))),
          h(
            "div",
            null,
            h("div.dossier-name", null, h("span", null, pd?.icon ?? ""), c.card.name),
            h("div.dossier-sub", null, `${pd?.name ?? ""}, ${c.card.age} лет`, h("span.dim", null, player ? ` · игрок ${player.name}` : " · бот-жилец")),
            h("div.dossier-thought", null, icon("chat"), c.thought ?? "Бездельничаю"),
          ),
        ),
        h(
          "div.dossier-needs",
          null,
          ...(["food", "water", "energy", "sanity", "health"] as const).map((k) =>
            h("div.need", null, h("span", null, cic(NEED_IC, k), NEED_NAMES[k]), bar(c.needs[k], c.needs[k] < 30 ? "#e0503a" : undefined), h("span", null, c.needs[k])),
          ),
          c.needs.rad ? h("div.need", null, h("span", null, cic(NEED_IC, "rad"), "Радиация"), bar(c.needs.rad, "#b0e040"), h("span", null, c.needs.rad)) : null,
        ),
        c.injury ? h("div.bad", null, icon("alert"), " Травма: " + injuryName(c.injury)) : null,
        c.sick > 10 ? h("div.bad", null, icon("alert"), ` Болеет: ${c.sick}%`) : null,
        h(
          "div.dossier-traits",
          null,
          h("div.trait", null, icon("plus", { color: "#a88cf0" }), h("span", null, h("b", null, TRAITS_PLUS[c.card.plus]?.name), " — " + (TRAITS_PLUS[c.card.plus]?.desc ?? ""))),
          h("div.trait", null, icon("minus", { color: "#a88cf0" }), h("span", null, h("b", null, TRAITS_MINUS[c.card.minus]?.name), " — " + (TRAITS_MINUS[c.card.minus]?.desc ?? ""))),
          ...(c.perks ?? []).map((p: string) => h("div.trait", null, icon("star", { color: "#f2c14e" }), h("span", null, h("b", null, PERKS[p]?.name ?? p), " — " + (PERKS[p]?.desc ?? "")))),
        ),
        h(
          "div.dossier-facts",
          null,
          h("span", null, icon("star", { color: "#f2c14e" }), `Уровень ${c.level ?? 1} · опыт ${Math.floor(c.xp ?? 0)}`),
          h("span", null, icon("alert", { color: "#f2b53c" }), c.card.phobia),
          h("span", null, icon("backpack", { color: "#5fa0f0" }), c.card.baggage),
          h("span", null, icon("sparkles", { color: "#e58fb5" }), `день рождения — ${c.card.birthday}`),
        ),
        isMe && net.priv?.goal ? h("div.goal", null, icon("lock"), h("span", null, h("b", null, GOALS[net.priv.goal]?.name), ": ", GOALS[net.priv.goal]?.desc)) : null,
        free ? h("button.primary.big", { onclick: () => (net.send({ k: "take", char: id }), closeModal()) }, icon("gamepad"), "Играть за этого жильца") : null,
      ),
      h(
        "div.dossier-right",
        null,
        h(
          "div.sect",
          null,
          h("div.sect-h", null, icon("muscle", { color: "#ef6a4c" }), "Характеристики"),
          h("div.stat-row", null, (Object.keys(STAT_NAMES) as (keyof typeof STAT_NAMES)[]).map((k) => h("div.stat-tile", null, cic(STAT_IC, k), h("b", null, c.card.stats[k]), h("small", null, STAT_NAMES[k])))),
        ),
        h(
          "div.sect",
          null,
          h("div.sect-h", null, icon("wrench", { color: "#e0a458" }), "Навыки"),
          h("div.skill-chips", null, (Object.keys(SKILL_NAMES) as (keyof typeof SKILL_NAMES)[]).map((k) => h("span.chip", null, cic(SKILL_IC, k), `${SKILL_NAMES[k]} ${skillLevel(c as any, k)}`))),
        ),
        h(
          "div.sect",
          null,
          h("div.sect-h", null, icon("users", { color: "#a88cf0" }), "Отношения"),
          rels.length
            ? h(
                "div.rel-list",
                null,
                rels.map(([oid, r]) => {
                  const o = v.chars[oid];
                  return h("div.rel-row", null, portrait(o.id, o.card, "rel-portrait", () => art(portraitTile(o.card.prof, o.card.gender))), h("span.rel-name", null, o.card.name), relIcon(r), h("span.dim", null, relWord(r)));
                }),
              )
            : h("div.dim", null, "Пока ни с кем не знаком."),
        ),
      ),
    ),
    { cls: "dossier-modal", wide: true, icon: "user" },
  );
}

// ---------------------------------------------------------------- settings

export function openSettings(r: { shadows: boolean }) {
  const slider = (cat: "master" | "sfx" | "music" | "radio" | "ambient", label: string) => {
    const inp = h("input", { type: "range", min: 0, max: 1, step: 0.05, value: String(audio.volumes[cat]) }) as HTMLInputElement;
    inp.addEventListener("input", () => audio.setVolume(cat, Number(inp.value)));
    return h("label.row", null, h("span", { style: { width: "120px" } }, label), inp);
  };
  const speech = h("input", { type: "checkbox", checked: audio.speech }) as HTMLInputElement;
  speech.addEventListener("change", () => {
    audio.speech = speech.checked;
    localStorage.setItem("bunker.speech", speech.checked ? "1" : "0");
  });
  const shadows = h("input", { type: "checkbox", checked: r.shadows }) as HTMLInputElement;
  shadows.addEventListener("change", () => {
    r.shadows = shadows.checked;
    localStorage.setItem("bunker.shadows", shadows.checked ? "1" : "0");
  });
  const pf = postfx((r as any).renderer);
  const quality = h(
    "select",
    { onchange: (e: Event) => pf.setQuality((e.target as HTMLSelectElement).value as FxQuality) },
    ([["full", "Кино: свечение, зерно, аберрация"], ["light", "Лёгкая: цвет и виньетка"], ["off", "Выкл. (слабые устройства)"]] as const).map(([v, t]) => h("option", { value: v, selected: pf.quality === v }, t)),
  );
  const inTg = !!(window as any).Telegram?.WebApp?.initData;
  // opened with the game button: Telegram's own ✕ closes the game, there is no other bunker to go to
  const tgGame = !inTg && document.body.classList.contains("tg");
  modal(
    "Меню",
    h(
      "div.settings",
      null,
      h(
        "div.sect",
        null,
        h("div.sect-h", null, icon("volume"), "Звук"),
        slider("master", "Общая"),
        slider("sfx", "Эффекты"),
        slider("music", "Музыка"),
        slider("radio", "Радио"),
        slider("ambient", "Фон"),
        h("label.row", null, speech, "Озвучивать радио голосом"),
      ),
      h(
        "div.sect",
        null,
        h("div.sect-h", null, icon("sparkles"), "Картинка"),
        h("label.row", null, h("span", { style: { width: "120px" } }, "Эффекты"), quality),
        h("label.row", null, shadows, "Тени от ламп"),
        h("button.small", { onclick: () => ((window as any).__tips?.reset(), closeModal()) }, icon("refresh"), "Показать подсказки заново"),
      ),
      h(
        "div.settings-foot",
        null,
        h("button", { onclick: () => closeModal() }, icon("play"), "Продолжить"),
        tgGame
          ? h("span.dim", null, "Закрыть игру — крестиком Telegram. Бункер чата сохранится.")
          : h(
          "button.primary",
          {
            onclick: () => {
              closeModal();
              net.leaveToMenu();
            },
            title: "Ваш жилец останется в бункере — его подхватит бот. Вернуться можно из меню.",
          },
          icon("logout"),
          inTg ? "Закрыть игру" : "Выйти в меню",
        ),
      ),
    ),
  );
}
