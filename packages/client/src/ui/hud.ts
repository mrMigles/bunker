import { avatar, ownerOf } from "./avatar";
import { portrait } from "../render/portrait";
import { ITEMS, NEED_HINTS, NEED_NAMES, PERKS, PROFS, itemName, threatLevel, xpForLevel, type Fx } from "@bunker/shared";
import { net } from "../net";
import type { WorldRenderer } from "../render/world";
import { add, bar, clear, closeModal, esc, floatText, h, isModalOpen, modal, needColor, toast, ui } from "./dom";
import { art, portraitTile } from "./art";
import { NEED_IC, cic, icon } from "./icons";

const FOOD_KEYS = Object.keys(ITEMS).filter((k) => ITEMS[k].cat === "food");

export function foodTotal(res: Record<string, number>) {
  let t = 0;
  for (const k of FOOD_KEYS) t += (res[k] ?? 0) * (ITEMS[k].nut ?? 0);
  for (const k in res) if (k.startsWith("dish_")) t += (res[k] ?? 0) * 1.3;
  return t;
}

export function fmtHour(hr: number) {
  const hh = Math.floor(hr) % 24;
  const mm = Math.floor((hr - Math.floor(hr)) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export class Hud {
  root = h("div.layer");
  top = h("div.hud-top");
  me = h("div.panel.hud-me");
  feed = h("div.hud-feed");
  labels = h("div.layer");
  help = h("div.help");
  lastLogLen = 0;
  labelEls = new Map<string, HTMLElement>();
  hidden = false;
  private mobileStatsExpanded = false;

  constructor(private r: WorldRenderer) {
    this.root.append(this.labels, this.top, this.me, this.feed, this.help);
    // On a phone the survivor card is a compact glanceable strip. Tap it to reveal the bars;
    // the dedicated character button still opens the complete character screen.
    this.me.addEventListener("click", (e) => {
      if (document.documentElement.classList.contains("mobile") && !(e.target as HTMLElement).closest("button")) this.toggleMobileStats();
    });
    ui().appendChild(this.root);
    this.help.innerHTML = "<b>МЫШЬ</b> идти / выбрать предмет <span>·</span> <b>WASD</b> движение <span>·</span> <b>Esc</b> отмена";
    net.onFx.add((f) => this.onFx(f));
    net.onError.add((t) => toast("⚠ " + t));
  }

  setHidden(v: boolean) {
    this.hidden = v;
    for (const el of [this.top, this.me, this.feed, this.help]) el.classList.toggle("hidden", v);
  }

  private toggleMobileStats() {
    this.mobileStatsExpanded = !this.mobileStatsExpanded;
    this.me.classList.toggle("mobile-expanded", this.mobileStatsExpanded);
    this.meKey = "";
    if (net.pub) this.renderMe(net.pub);
  }

  /** The mobile HUD keeps the journal behind an icon instead of covering the scene. */
  openJournal() {
    const log = (net.pub?.log ?? []) as any[];
    modal(
      "Журнал событий",
      h(
        "div.mobile-journal",
        null,
        ...(log.length
          ? log.slice(-40).reverse().map((e) => h("div.mobile-journal-entry." + (e.kind ?? "system"), null, e.who ? h("b", null, `${e.who}: `) : null, e.text))
          : [h("div.dim", null, "В журнале пока тихо.")]),
      ),
      { icon: "journal", cls: "journal-modal" },
    );
  }

  onFx(f: Fx) {
    if (f.k === "toast" && f.text) toast(f.text);
    else if (f.k === "float" && f.text && f.x !== undefined && f.lv !== undefined) {
      const [sx, sy] = this.r.toScreen(f.x, -(f.lv * 2 + 2) + 1.6);
      floatText(sx, sy, f.text, f.color);
    } else if (f.k === "shake") this.r.shake = Math.max(this.r.shake, Number(f.data ?? 1));
    else if (f.k === "flash") this.r.flash = 1;
  }

  private helpKey = "";

  /** The key hints under the screen follow what you are doing. */
  private updateHelp(v: any) {
    const b = document.body.classList;
    const mode = v.phase === "prologue" ? "prologue" : b.contains("mode-site") ? "site" : b.contains("mode-combat") ? "combat" : b.contains("mode-build") ? "build" : "bunker";
    if (mode === this.helpKey) return;
    this.helpKey = mode;
    const k = (key: string, what: string) => `<b>${key}</b> ${what}`;
    const sep = " <span>·</span> ";
    const HELP: Record<string, string[]> = {
      prologue: [k("Мышь / A D", "идти"), k("E", "взять"), k("↑↓", "выбор"), k("Пробел", "к люку"), k("Q", "бросить соседу")],
      bunker: [k("Мышь / WASD", "идти"), k("E", "действие"), k("↑↓", "выбор"), k("Shift", "бег"), k("I", "персонаж"), k("Tab", "убежище"), k("B", "стройка")],
      site: [k("A D / W S", "идти"), k("E", "действие · держать — быстро"), k("↑↓", "выбор"), k("L", "фонарь"), k("G", "камень"), k("I", "рюкзак")],
      build: [k("Клик", "разметить"), k("[ ]", "ширина"), k("Esc / B", "выйти")],
      combat: [k("Клик", "идти / атаковать"), k("Enter", "конец хода"), k("Esc", "отмена")],
    };
    this.help.innerHTML = HELP[mode].join(sep);
  }

  update() {
    const v = net.pub;
    if (!v) return;
    this.updateHelp(v);
    document.body.dataset.phase = v.phase;
    document.body.dataset.activity = v.mods.combat?.active ? "combat" : net.myChar()?.status === "away" ? "expedition" : "bunker";
    this.renderTop(v);
    this.renderMe(v);
    this.renderFeed(v);
  }

  private topKey = "";
  renderTop(v: any) {
    const res = v.res;
    const food = foodTotal(res);
    const water = res.water ?? 0;
    const p = v.power;
    const bal = p.gen - p.use;
    const key = [v.day, Math.floor(v.hour * 60), Math.round(food), Math.round(water), res.parts, res.scrap, res.meds, Math.round(p.battery * 10), Math.round(bal * 10), v.notice, v.speed, v.air.co2, v.phase, res.water_dirty, res.wood, res.chem, res.cloth, res.ammo, res.fuel, v.mods.combat?.active, net.myChar()?.status, threatLevel(v)].join("|");
    if (key === this.topKey) return;
    this.topKey = key;
    clear(this.top);
    const people = Object.values(v.chars).filter((c: any) => c.status !== "dead").length;
    const mode = v.mods.combat?.active ? "БОЙ" : v.phase === "prologue" ? "СБОР" : net.myChar()?.status === "away" ? "ВЫЛАЗКА" : `ДЕНЬ ${v.day}`;
    const resource = (tile: number, value: string | number, label: string, title: string) => h("div.resource-meter", { title }, art(tile), h("b", null, value), h("small", null, label));
    add(this.top,
      h("div.hud-clock", null, h("strong", null, mode), h("small", { title: "Угроза растёт с уровнями жильцов и днями: враги крепче и метче, в зданиях их больше" }, v.phase === "prologue" ? "До закрытия убежища" : v.phase === "night" ? "Ночной совет" : [icon("rad"), ` Угроза ${threatLevel(v)} · выжить вместе`])),
      h("div.hud-time", null, h("strong",{ title: v.speed > 1 ? "Время ускорено: все игроки отдыхают" : "" },icon(v.phase === "night" || v.hour >= 20 ? "moon" : "sun"),` ${fmtHour(v.hour)}`, v.speed > 1 ? h("span.hud-fast", null, ` ⏩×${v.speed}`) : null), h("small",{ title: "Код бункера — поделиться: Меню → «Поделиться ссылкой»" },`Бункер № ${net.code}`)),
      resource(0,Math.floor(food),"Еда",`Пайков. Нужно ${people} в день`),
      resource(1,Math.floor(water),(res.water_dirty??0)>=1?`Вода · гр. ${Math.floor(res.water_dirty)}`:"Вода",`Чистой: ${Math.floor(water)}, нужно ${people*2} в день.
Грязной: ${Math.floor(res.water_dirty??0)} — её качает насос, водоочистка делает из неё чистую (нужен ток). Грязная годится для полива грядок и тушения огня, пить её нельзя.`),
      resource(7,p.battery.toFixed(1),bal>=0.005?`Энергия ▲${bal.toFixed(1)}`:bal<=-0.005?`Энергия ▼${(-bal).toFixed(1)}`:"Энергия",`Аккумулятор ${p.battery.toFixed(1)} из ${p.cap} кВт·ч.\nВыработка ${p.gen.toFixed(2)} кВт, расход ${p.use.toFixed(2)} кВт (${bal>=0?"заряжается":"садится"}).\nТок берут фильтры, свет, лампы грядок и каждая комната с техникой — чем больше бункер, тем больше нужно. Один велосипед тянет только небольшой бункер: соберите второй в мастерской или поставьте генератор.`),
      resource(2,Math.floor(res.scrap??0),"Металл","Металлолом для строительства"),
      resource(3,Math.floor(res.wood??0),"Дерево","Древесина — для комнат, мебели и велосипедов. Где взять: «Штабель досок» и скамьи на вылазках — больше всего в амбаре на ферме, в гаражах, школе, подсобках, тоннелях метро; немного — в ящиках и шкафах."),
      resource(5,Math.floor(res.meds??0),"Лекарства","Медикаменты"),
      resource(6,Math.floor(res.parts??0),"Детали","Запчасти для ремонта"),
    );
    if(v.air.co2>40) this.top.append(h("span.air-alert",null,`CO₂ ${v.air.co2}%`));
  }

  private meKey = "";
  renderMe(v: any) {
    this.me.classList.toggle("mobile-expanded", this.mobileStatsExpanded);
    const c = net.myChar();
    if (!c) {
      const key = "ghost" + (net.priv?.pid ?? "");
      if (key === this.meKey) return;
      this.meKey = key;
      clear(this.me);
      const p = v.players[net.priv?.pid ?? ""];
      add(this.me,h("div.name", null, p?.ghost ? "👻 Голос в рации" : "Нет персонажа"), h("div.dim", null, p?.ghost ? "Вы погибли. Смотрите, советуйте в чат, голосуйте с половинным весом. Как только появится свободный жилец — возьмите его." : ""));
      return;
    }
    const key = JSON.stringify([c.needs, c.hands, c.task?.action, c.status, c.thought, net.priv?.goal, c.injury, c.sick, c.downT, c.xp, c.level, c.perks, c.perkOffer]);
    if (key === this.meKey) return;
    this.meKey = key;
    clear(this.me);
    const pd = PROFS[c.card.prof];
    const secondaryNeeds: ("food" | "water" | "energy" | "sanity")[] = ["food", "water", "energy", "sanity"];
    secondaryNeeds.sort((a, b) => c.needs[a] - c.needs[b]);
    const peekNeed = secondaryNeeds[0];
    this.me.append(portrait(c.id, c.card, "survivor-portrait", () => art(portraitTile(c.card.prof, c.card.gender))));
    add(this.me,
      h(
        "div.row.hud-me-head",
        null,
        h("span.name", null, `${pd?.icon ?? ""} ${c.card.name}`),
        h("span.dim", null, pd?.name),
        h(
          "button.small.hud-me-toggle",
          { "aria-label": this.mobileStatsExpanded ? "Свернуть показатели" : "Показать показатели", "aria-expanded": String(this.mobileStatsExpanded), onclick: () => this.toggleMobileStats() },
          icon(this.mobileStatsExpanded ? "chevronDown" : "chevronRight"),
        ),
      ),
      h(
        "div.hud-me-peek",
        null,
        h("span", { title: NEED_NAMES.health }, cic(NEED_IC, "health"), h("b", null, c.needs.health)),
        h("span", { title: NEED_NAMES[peekNeed] }, cic(NEED_IC, peekNeed), h("b", null, c.needs[peekNeed])),
        h("small", null, "показатели"),
      ),
      levelLine(c),
      c.perkOffer?.length ? h("button.small.primary.perk-btn", { onclick: () => openPerkChoice() }, "⭐ Новый уровень — выберите умение") : null,
      c.status !== "ok" ? h("div.bad", null, c.status === "down" ? `Без сознания! ${c.downT} с` : c.status === "breakdown" ? "Нервный срыв!" : c.status === "dead" ? "Погиб" : "") : null,
      ...(["health", "food", "water", "energy", "sanity"] as const).map((k) =>
        h("div.need", { title: NEED_HINTS[k] }, h("span", null, cic(NEED_IC, k), NEED_NAMES[k]), bar(c.needs[k]), h("span", { style: { color: needColor(c.needs[k]) } }, c.needs[k])),
      ),
      c.needs.rad > 0 ? h("div.need", null, h("span", null, cic(NEED_IC, "rad"), "Радиация"), bar(c.needs.rad, "#b0e040"), h("span.warn", null, c.needs.rad)) : null,
      c.injury ? h("div.bad", null, "Травма: " + injuryName(c.injury)) : null,
      c.sick > 10 ? h("div.bad", null, "Болезнь: " + c.sick + "%") : null,
      h("div.dim", { style: { marginTop: "4px" } }, "В руках: ", c.hands.length ? c.hands.map((x: any) => `${ITEMS[x.item]?.icon ?? ""}${itemName(x.item)}${x.n > 1 ? "×" + x.n : ""}`).join(", ") : "пусто"),
      net.priv?.goal ? h("div.dim", { style: { marginTop: "4px", fontSize: "11px" } }, "🔒 Цель: ", goalShort(net.priv.goal)) : null,
    );
  }

  renderFeed(v: any) {
    const log = v.log as any[];
    const key = log.length + (log[log.length - 1]?.text ?? "");
    if (key === (this.feed as any)._k) return;
    (this.feed as any)._k = key;
    clear(this.feed);
    this.feed.append(h("div.feed-heading",null,icon("journal"),"Журнал событий"));
    for (const e of log.slice(-4)) this.feed.append(h("div.msg." + e.kind, { html: (e.who ? `<b>${esc(e.who)}:</b> ` : "") + esc(e.text) }));
  }

  /** Name tags, speech bubbles, progress bars. Called every frame. */
  updateLabels(myChar: string | null, hoverChar: string | null) {
    const v = net.pub;
    if (!v) return;
    const b = document.body.classList;
    const inBunker = !b.contains("mode-site") && !b.contains("mode-map") && !b.contains("mode-prologue") && !b.contains("mode-table");
    this.labels.style.display = inBunker ? "" : "none";
    if (!inBunker) return;
    const seen = new Set<string>();
    for (const [id, cv] of this.r.chars) {
      const c = v.chars[id];
      if (!c) continue;
      seen.add(id);
      let el = this.labelEls.get(id);
      if (!el) {
        el = h("div.label");
        this.labels.appendChild(el);
        this.labelEls.set(id, el);
      }
      const [sx, sy] = this.r.toScreen(cv.x, -cv.y + 1.55, 0);
      // a speech bubble stays readable: not under the phone's icon column, not off the left edge (#16)
      const half = c.bark?.text ? (el.offsetWidth || 120) / 2 : 0;
      const right = innerWidth - (document.documentElement.classList.contains("mobile") ? 58 : 8) - half;
      el.style.left = (half ? Math.max(half + 6, Math.min(right, sx)) : sx) + "px";
      el.style.top = sy + "px";
      const player = c.ctrl ? v.players[c.ctrl] : null;
      // a player who is away still owns their resident: it keeps their name and face, marked as played by a bot
      const owner = player ?? ownerOf(v, id);
      const away = !!owner && !player;
      const showName = !this.hidden && (id === hoverChar || !!owner || id === myChar);
      const k = JSON.stringify([c.bark?.text, c.task?.p, showName, c.emote, c.status, owner?.name, away, c.anim === "sleep"]);
      if ((el as any)._k === k) continue;
      (el as any)._k = k;
      clear(el);
      if (c.emote) el.append(h("div.emote", null, EMOTES[c.emote] ?? "❔"));
      if (c.bark?.text) el.append(h("div.bubble", null, c.bark.text));
      if (c.anim === "sleep" && !c.bark) el.append(h("div", { style: { fontSize: "14px" } }, "💤"));
      if (c.task && c.task.p >= 0 && c.task.p < 1) el.append(h("div.pbar", null, h("i", { style: { width: Math.round(c.task.p * 100) + "%" } })));
      if (showName && owner) {
        // a Telegram resident carries the player's own name: no «player · resident» pair
        const text = c.card.tg || owner.name === c.card.name ? owner.name : owner.name + " · " + c.card.name.split(" ")[0];
        el.append(h("div.nm.player" + (away ? ".away" : ""), null, avatar(owner.id, owner.name, owner.color, 15, away), h("span", null, text + (c.status === "down" ? " ✚" : "")), away ? h("small.nm-bot", null, "бот") : null));
      } else if (showName) el.append(h("div.nm", null, c.card.name.split(" ")[0] + (c.status === "down" ? " ✚" : "")));
    }
    for (const [id, el] of this.labelEls) {
      if (!seen.has(id)) {
        el.remove();
        this.labelEls.delete(id);
      }
    }
  }
}

export const EMOTES: Record<string, string> = { help: "🆘", here: "👇", no: "✋", lol: "😂" };

export function injuryName(i: string) {
  return ({ leg: "перелом ноги", arm: "рана руки", bleed: "кровотечение", burn: "ожог", infection: "инфекция" } as any)[i] ?? i;
}

import { GOALS } from "@bunker/shared";
function goalShort(g: string) {
  return GOALS[g]?.desc ?? g;
}


/** Level, experience to the next level and learned perks. */
function levelLine(c: any) {
  const lv = c.level ?? 1;
  const xp = c.xp ?? 0;
  const from = xpForLevel(lv),
    to = xpForLevel(lv + 1);
  const pct = Math.max(0, Math.min(100, ((xp - from) / Math.max(1, to - from)) * 100));
  return h(
    "div.level-line",
    { title: `Опыт ${Math.floor(xp)} / ${to}. Опыт дают работа, обыск на вылазках, бои и возвращение домой.` },
    h("b", null, `Ур. ${lv}`),
    bar(pct, "#eac98a"),
    h("span.perk-icons", null, ...(c.perks ?? []).map((p: string) => h("span", { title: `${PERKS[p]?.name}: ${PERKS[p]?.desc}` }, PERKS[p]?.icon ?? "★"))),
  );
}

let perkShownFor = "";
/** Three perk cards to choose from after a level-up. */
export function openPerkChoice() {
  const c = net.myChar();
  if (!c?.perkOffer?.length) return;
  perkShownFor = `${c.id}:${c.level}:${c.perkOffer.join()}`;
  const body = h(
    "div.perk-choice",
    null,
    h("p.dim", null, `${c.card.name.split(" ")[0]} достиг(ла) уровня ${c.level}. Выберите одно умение — оно останется навсегда.`),
    h(
      "div.perk-cards",
      null,
      ...c.perkOffer.map((id: string) =>
        h(
          "button.perk-card",
          {
            onclick: () => {
              net.send({ k: "perkPick", perk: id });
              closeModal();
            },
          },
          h("span.perk-icon", null, PERKS[id]?.icon ?? "★"),
          h("b", null, PERKS[id]?.name ?? id),
          h("span", null, PERKS[id]?.desc ?? ""),
        ),
      ),
    ),
  );
  modal("⭐ Новое умение", body, { cls: "perk-modal" });
}

/** Offer the choice once per level-up, when nothing else is on screen. */
export function maybeOpenPerkChoice() {
  const c = net.myChar();
  if (!c?.perkOffer?.length || isModalOpen() || document.body.classList.contains("mode-combat")) return;
  const k = `${c.id}:${c.level}:${c.perkOffer.join()}`;
  if (k !== perkShownFor) openPerkChoice();
}
