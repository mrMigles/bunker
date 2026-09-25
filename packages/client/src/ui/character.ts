// «Персонаж»: your survivor and your companions. Tabs:
//  Снаряжение — weapon, armour and tool slots (from the common storage), what is in hands, passing things over;
//  Прокачка   — level, experience, perks (choose a new one), skills with progress, stats and traits;
//  Досье      — the card: profession, age, phobia, baggage, relations.
import { GEAR, ITEMS, PERKS, PROFS, SKILL_NAMES, STAT_NAMES, TRAITS_MINUS, TRAITS_PLUS, itemName, xpForLevel, type GearSlot } from "@bunker/shared";
import { net } from "../net";
import { bar, clear, h, isModalOpen, modal } from "./dom";
import { openPerkChoice } from "./hud";
import { openCharacter } from "./screens";

type Tab = "gear" | "skills" | "card";
let timer = 0;

export function openCharacterScreen(tab: Tab = "gear") {
  const body = h("div.charscreen");
  let key = "";
  let cur: Tab = tab;
  const render = () => {
    const v = net.pub;
    const me = net.myChar();
    if (!v || !me) return;
    const mates = Object.values(v.chars as Record<string, any>).filter((c) => c.id !== me.id && !c.ctrl && c.status !== "dead");
    // an open dropdown must survive: never rebuild under it, and only rebuild when something shown changed
    // (the whole character — needs, position — changes every tick and used to close the lists)
    if (document.activeElement?.tagName === "SELECT" && body.contains(document.activeElement)) return;
    const gearRes = Object.keys(v.res).map((r) => [r, Math.floor(v.res[r])]);
    const k = JSON.stringify([
      cur,
      me.equip,
      me.hands,
      me.xp,
      me.level,
      me.perks,
      me.perkOffer,
      me.skills,
      me.status,
      me.lv,
      Math.round(me.x / 2),
      mates.map((c) => [c.id, c.hands, c.equip, Math.round(c.x / 3), c.lv, c.status]),
      gearRes,
      cur === "card" ? me.needs : 0,
    ]);
    if (k === key) return;
    key = k;
    clear(body);
    body.append(
      h(
        "div.row.charscreen-tabs",
        null,
        ...([
          ["gear", "🎒 Снаряжение"],
          ["skills", "⭐ Прокачка"],
          ["card", "📇 Досье"],
        ] as [Tab, string][]).map(([id, label]) => h("button.small" + (cur === id ? ".primary" : ""), { onclick: () => ((cur = id), (key = ""), render()) }, label)),
      ),
    );
    if (cur === "gear") body.append(gearTab(v, me, mates));
    else if (cur === "skills") body.append(skillsTab(me));
    else body.append(cardTab(me));
  };
  render();
  modal("Персонаж", body, { cls: "charscreen-modal", wide: true, onClose: () => clearInterval(timer) });
  clearInterval(timer);
  timer = window.setInterval(() => (isModalOpen() && document.querySelector(".charscreen-modal") ? render() : clearInterval(timer)), 300);
}

function gearTab(v: any, me: any, mates: any[]) {
  const res = v.res as Record<string, number>;
  const card = (c: any, mine: boolean) => {
    const near = c.lv === me.lv && Math.abs(c.x - me.x) <= 4;
    const away = c.status === "away";
    const slots = (Object.keys(GEAR) as GearSlot[]).map((slot) => {
      const now = c.equip?.[slot] ?? "";
      const opts = GEAR[slot].items.filter((it) => (res[it] ?? 0) >= 1 || it === now);
      return h(
        "label.gear-slot",
        null,
        h("span", null, GEAR[slot].name),
        h(
          "select",
          { disabled: away, onchange: (e: Event) => net.send({ k: "equip", char: c.id, slot, item: (e.target as HTMLSelectElement).value }) },
          h("option", { value: "", selected: !now }, "— пусто —"),
          ...opts.map((it) => h("option", { value: it, selected: it === now }, `${ITEMS[it]?.icon ?? ""} ${itemName(it)}${it === now ? "" : ` (склад: ${Math.floor(res[it] ?? 0)})`}`)),
        ),
      );
    });
    const hands = (c.hands as { item: string; n: number }[]).map((it, i) =>
      h(
        "div.gear-hand",
        null,
        h("span", null, `${ITEMS[it.item]?.icon ?? "□"} ${itemName(it.item)}${it.n > 1 ? " ×" + it.n : ""}`),
        mine
          ? mates.length
            ? h(
                "select.small",
                { onchange: (e: Event) => (e.target as HTMLSelectElement).value && net.send({ k: "handGive", from: me.id, to: (e.target as HTMLSelectElement).value, i }) },
                h("option", { value: "" }, "Передать…"),
                ...mates.filter((m) => m.status !== "away").map((m) => h("option", { value: m.id }, m.card.name.split(" ")[0])),
              )
            : null
          : h("button.small", { disabled: !near, title: near ? "" : "Подойдите ближе", onclick: () => net.send({ k: "handGive", from: c.id, to: me.id, i }) }, "← Забрать"),
      ),
    );
    return h(
      "div.gear-card" + (mine ? ".mine" : ""),
      null,
      h("div.gear-head", null, h("b", null, c.card.name), h("span.dim", null, ` ${PROFS[c.card.prof]?.icon ?? ""} ${PROFS[c.card.prof]?.name ?? ""} · ур. ${c.level ?? 1}`), away ? h("span.tag", null, "на вылазке") : null),
      ...slots,
      h("div.gear-sub", null, `В руках (${c.hands.length}/3)`),
      hands.length ? h("div", null, ...hands) : h("div.dim", null, "Пусто"),
      !mine && !near && !away ? h("div.dim", { style: { fontSize: "11px" } }, "Чтобы передавать вещи, подойдите ближе (до 4 шагов).") : null,
    );
  };
  return h(
    "div",
    null,
    h("p.dim", null, "Своё снаряжение берут со склада убежища: в бою и на вылазке оно всегда при владельце. Жильцы-боты — ваши спутники: их тоже можно одеть и передать им вещи из рук."),
    h("div.gear-grid", null, card(me, true), ...mates.map((m) => card(m, false))),
  );
}

function skillsTab(me: any) {
  const lv = me.level ?? 1;
  const xp = me.xp ?? 0;
  const from = xpForLevel(lv),
    to = xpForLevel(lv + 1);
  const skillRow = (k: string) => {
    const xpS = me.skills[k] ?? 0;
    const l = Math.min(10, 1 + Math.floor(Math.sqrt(xpS / 12)));
    const a = 12 * (l - 1) ** 2,
      b = 12 * l ** 2;
    return h("div.skill-row", null, h("span", null, SKILL_NAMES[k as keyof typeof SKILL_NAMES]), h("b", null, String(l)), bar(l >= 10 ? 100 : ((xpS - a) / (b - a)) * 100, "#9fc2d6"));
  };
  return h(
    "div.skills-tab",
    null,
    h("div.skill-level", null, h("b", null, `Уровень ${lv}`), bar(((xp - from) / Math.max(1, to - from)) * 100, "#eac98a"), h("span.dim", null, `опыт ${Math.floor(xp)} / ${to}`)),
    me.perkOffer?.length ? h("button.primary", { onclick: () => openPerkChoice() }, "⭐ Выбрать новое умение") : null,
    h("h4", null, "Умения"),
    (me.perks ?? []).length
      ? h("div", null, ...(me.perks as string[]).map((p) => h("div.perk-line", null, `${PERKS[p]?.icon ?? "★"} `, h("b", null, PERKS[p]?.name ?? p), h("span.dim", null, " — " + (PERKS[p]?.desc ?? "")))))
      : h("div.dim", null, "Пока нет. Каждый уровень — выбор одного из трёх умений."),
    h("h4", null, "Навыки (растут от дела)"),
    ...Object.keys(SKILL_NAMES).map(skillRow),
    h("h4", null, "Характеристики и черты"),
    h("div", null, ...Object.keys(STAT_NAMES).map((k) => h("span.tag", null, `${STAT_NAMES[k as keyof typeof STAT_NAMES]} ${me.card.stats[k]}`))),
    h("div", null, "➕ ", h("b", null, TRAITS_PLUS[me.card.plus]?.name), h("span.dim", null, " — " + (TRAITS_PLUS[me.card.plus]?.desc ?? ""))),
    h("div", null, "➖ ", h("b", null, TRAITS_MINUS[me.card.minus]?.name), h("span.dim", null, " — " + (TRAITS_MINUS[me.card.minus]?.desc ?? ""))),
    h("p.dim", null, "Опыт дают работа в бункере (и мини-игры), обыски и бои на вылазках, возвращение домой, выполненные просьбы жильцов."),
  );
}

function cardTab(me: any) {
  return h(
    "div",
    null,
    h("p", null, `${PROFS[me.card.prof]?.icon ?? ""} ${me.card.name}, ${PROFS[me.card.prof]?.name ?? ""}, ${me.card.age} лет`),
    h("p.dim", null, `😨 Фобия: ${me.card.phobia} · 🧳 Багаж: ${me.card.baggage} · 🎂 день ${me.card.birthday}`),
    h("button", { onclick: () => openCharacter(me.id) }, "Потребности, отношения и личная цель →"),
  );
}
