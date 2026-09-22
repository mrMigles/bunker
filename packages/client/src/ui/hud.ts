import { ITEMS, NEED_NAMES, PROFS, itemName, type Fx } from "@bunker/shared";
import { net } from "../net";
import type { WorldRenderer } from "../render/world";
import { add, bar, clear, esc, floatText, h, needColor, toast, ui } from "./dom";

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

  constructor(private r: WorldRenderer) {
    this.root.append(this.labels, this.top, this.me, this.feed, this.help);
    ui().appendChild(this.root);
    this.help.innerHTML = "A/D ходьба · W/S лестница · Shift бег · E действие · Q бросить<br>Tab инвентарь · B стройка · C чат · H аквариум · F камера · F1–F4 эмоции";
    net.onFx.add((f) => this.onFx(f));
    net.onError.add((t) => toast("⚠ " + t));
  }

  setHidden(v: boolean) {
    this.hidden = v;
    for (const el of [this.top, this.me, this.feed, this.help]) el.classList.toggle("hidden", v);
  }

  onFx(f: Fx) {
    if (f.k === "toast" && f.text) toast(f.text);
    else if (f.k === "float" && f.text && f.x !== undefined && f.lv !== undefined) {
      const [sx, sy] = this.r.toScreen(f.x, -(f.lv * 2 + 2) + 1.6);
      floatText(sx, sy, f.text, f.color);
    } else if (f.k === "shake") this.r.shake = Math.max(this.r.shake, Number(f.data ?? 1));
    else if (f.k === "flash") this.r.flash = 1;
  }

  update() {
    const v = net.pub;
    if (!v) return;
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
    const key = [v.day, Math.floor(v.hour * 4), Math.round(food), Math.round(water), res.parts, res.scrap, res.meds, Math.round(p.battery * 10), Math.round(bal * 10), v.notice, v.speed, v.air.co2, v.phase, res.water_dirty, res.wood, res.chem, res.cloth, res.ammo, res.fuel].join("|");
    if (key === this.topKey) return;
    this.topKey = key;
    clear(this.top);
    const people = Object.values(v.chars).filter((c: any) => c.status !== "dead").length;
    add(this.top,
      h("span.clock", null, `День ${v.day} · ${fmtHour(v.hour)}`),
      v.speed > 1 ? h("span.warn", { title: "Все отдыхают — время ускорено" }, "⏳×" + v.speed) : null,
      h("span.res", { title: `Еда (пайков). Нужно ${people}/день` }, "🥫", h("b", null, food.toFixed(1))),
      h("span.res", { title: `Чистая вода. Нужно ${people * 2}/день. Грязной: ${Math.round(res.water_dirty ?? 0)}` }, "💧", h("b", null, Math.floor(water)), res.water_dirty ? h("span.dim", null, `(+${Math.floor(res.water_dirty)})`) : null),
      h(
        "span.res",
        { title: `Аккумулятор ${p.battery.toFixed(1)}/${p.cap} кВт·ч. Выработка ${p.gen.toFixed(2)} кВт, потребление ${p.use.toFixed(2)} из ${p.demand.toFixed(2)} кВт` },
        "⚡",
        h("b", null, `${p.battery.toFixed(1)}/${p.cap}`),
        h("span", { class: bal >= 0 ? "good" : "bad" }, (bal >= 0 ? "+" : "") + bal.toFixed(2)),
      ),
      v.air.co2 > 5 ? h("span.res" + (v.air.co2 > 40 ? ".bad" : ".warn"), { title: "Углекислый газ" }, "🌫 CO₂ ", v.air.co2 + "%") : null,
      h("span.res", { title: "Запчасти" }, "⚙️", h("b", null, Math.floor(res.parts ?? 0))),
      h("span.res", { title: "Металлолом" }, "🔩", h("b", null, Math.floor(res.scrap ?? 0))),
      h("span.res", { title: "Дерево" }, "🪵", h("b", null, Math.floor(res.wood ?? 0))),
      h("span.res", { title: "Ткань" }, "🧵", h("b", null, Math.floor(res.cloth ?? 0))),
      h("span.res", { title: "Химикаты" }, "🧪", h("b", null, Math.floor(res.chem ?? 0))),
      h("span.res", { title: "Медикаменты" }, "💊", h("b", null, Math.floor(res.meds ?? 0))),
      h("span.res", { title: "Патроны" }, "🔸", h("b", null, Math.floor(res.ammo ?? 0))),
      h("span.grow"),
      h("span.res" + (v.notice > 45 ? ".bad" : v.notice > 25 ? ".warn" : ""), { title: "Заметность бункера: чем выше, тем вероятнее налёт" }, "👁 ", v.notice),
      h("span.dim", null, `пинг ${Math.round(net.latency)}мс · ${net.code}`),
    );
  }

  private meKey = "";
  renderMe(v: any) {
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
    const key = JSON.stringify([c.needs, c.hands, c.task?.action, c.status, c.thought, net.priv?.goal, c.injury, c.sick, c.downT]);
    if (key === this.meKey) return;
    this.meKey = key;
    clear(this.me);
    const pd = PROFS[c.card.prof];
    add(this.me,
      h("div.row", null, h("span.name", null, `${pd?.icon ?? ""} ${c.card.name}`), h("span.dim", null, pd?.name)),
      c.status !== "ok" ? h("div.bad", null, c.status === "down" ? `Без сознания! ${c.downT} с` : c.status === "breakdown" ? "Нервный срыв!" : c.status === "dead" ? "Погиб" : "") : null,
      ...(["food", "water", "energy", "sanity", "health"] as const).map((k) =>
        h("div.need", null, h("span", null, NEED_NAMES[k]), bar(c.needs[k]), h("span", { style: { color: needColor(c.needs[k]) } }, c.needs[k])),
      ),
      c.needs.rad > 0 ? h("div.need", null, h("span", null, "Радиация"), bar(c.needs.rad, "#b0e040"), h("span.warn", null, c.needs.rad)) : null,
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
    for (const e of log.slice(-8)) this.feed.append(h("div.msg." + e.kind, { html: (e.who ? `<b>${esc(e.who)}:</b> ` : "") + esc(e.text) }));
  }

  /** Name tags, speech bubbles, progress bars. Called every frame. */
  updateLabels(myChar: string | null, hoverChar: string | null) {
    const v = net.pub;
    if (!v) return;
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
      el.style.left = sx + "px";
      el.style.top = sy + "px";
      const player = c.ctrl ? v.players[c.ctrl] : null;
      const showName = !this.hidden && (id === hoverChar || !!player || id === myChar);
      const k = JSON.stringify([c.bark?.text, c.task?.p, showName, c.emote, c.status, player?.name, c.anim === "sleep"]);
      if ((el as any)._k === k) continue;
      (el as any)._k = k;
      clear(el);
      if (c.emote) el.append(h("div.emote", null, EMOTES[c.emote] ?? "❔"));
      if (c.bark?.text) el.append(h("div.bubble", null, c.bark.text));
      if (c.anim === "sleep" && !c.bark) el.append(h("div", { style: { fontSize: "14px" } }, "💤"));
      if (c.task && c.task.p >= 0 && c.task.p < 1) el.append(h("div.pbar", null, h("i", { style: { width: Math.round(c.task.p * 100) + "%" } })));
      if (showName) el.append(h("div.nm" + (player ? ".player" : ""), null, (player ? player.name + " · " : "") + c.card.name.split(" ")[0] + (c.status === "down" ? " ✚" : "")));
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
