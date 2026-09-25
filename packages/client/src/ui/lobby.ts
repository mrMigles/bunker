import { avatar } from "./avatar";
import { portrait } from "../render/portrait";
import { GOALS, PROFS, STAT_NAMES, TRAITS_MINUS, TRAITS_PLUS, type Card } from "@bunker/shared";
import { net } from "../net";
import { clear, h, toast, ui } from "./dom";
import { openCharEditor } from "./charedit";
import { tgInfo } from "../telegram";
import { art, portraitTile } from "./art";
import { STAT_IC, cic, icon } from "./icons";

export class LobbyUI {
  root = h("div.lobby");
  constructor() {
    ui().appendChild(this.root);
  }

  destroy() {
    this.root.remove();
  }

  render() {
    const v = net.pub!;
    const me = net.priv!;
    const r = this.root;
    // keep the scroll position (on a phone the lobby is taller than the screen)
    const scroll = r.scrollTop;
    requestAnimationFrame(() => (r.scrollTop = scroll));
    clear(r);
    const players = Object.values(v.players) as any[];
    const mine = v.players[me.pid];
    const isHost = !!mine?.host;
    const s = v.settings;
    r.appendChild(
      h(
        "div.lobby-head",
        null,
        h("div.logo", null, "ГЛУБЖЕ"),
        h(
          "div.lobby-code",
          null,
          tgInfo
            ? tgInfo.personal
              ? h(
                  "span.tg-personal",
                  { title: "В Telegram у каждого чата свой бункер" },
                  icon("telegram"),
                  " Ваш личный бункер. ",
                  h("small", null, "Чтобы играть с группой, откройте игру кнопкой «Играть» в группе."),
                )
              : h("span", { title: "В Telegram у каждого чата свой бункер" }, icon("telegram"), " ", tgInfo.chatTitle ? `Бункер чата «${tgInfo.chatTitle}»` : "Бункер вашей группы в Telegram")
            : [
                h("span", null, "Код бункера:"),
                h(
                  "b",
                  {
                    title: "Скопировать",
                    onclick: () => {
                      navigator.clipboard?.writeText(v.code);
                      toast("Код скопирован");
                    },
                  },
                  v.code,
                ),
              ],
        ),
      ),
    );
    r.appendChild(
      h(
        "div.lobby-players",
        null,
        players.map((p) =>
          h(
            "div.pchip" + (p.ready ? ".ready" : ""),
            { style: { borderColor: p.ready ? undefined : "#" + p.color.toString(16).padStart(6, "0") } },
            avatar(p.id, p.name, p.color, 18),
            p.name,
            p.host ? icon("crown", { title: "Хост" }) : null,
            p.id === me.pid ? h("span.dim", null, "(вы)") : null,
            p.ready ? h("span.good", null, icon("check"), "готов") : h("span.dim", null, p.pick ? "выбрал" : "выбирает…"),
          ),
        ),
        h("div.pchip", { title: "Новые жильцы постучат в интерком или найдутся на вылазках" }, icon("bot"), `+ ${Math.max(0, Math.min(3, s.residents - players.length))} бот(ов)-жильцов`),
      ),
    );
    r.appendChild(h("div.lobby-hint", null, "Выберите карточку выжившего. Скрытую цель видите только вы."));
    const cards = me.cards as Card[] | undefined;
    r.appendChild(h("div.cards", null, (cards ?? []).map((c, i) => cardEl(c, me.pick === i, () => net.send({ k: "pick", i })))));
    r.appendChild(
      h(
        "div.lobby-actions",
        null,
        h("button", { onclick: () => net.send({ k: "reroll" }) }, icon("dice"), "Другие карточки"),
        h("button", { onclick: () => openCharEditor() }, icon("userPlus"), "Создать своего"),
        me.pick !== undefined && cards?.[me.pick] ? h("button", { onclick: () => openCharEditor(cards[me.pick as number]) }, icon("wrench"), "Изменить выбранного") : null,
        h("div.grow"),
        h(
          "button" + (mine?.ready ? ".good" : ""),
          { onclick: () => net.send({ k: "ready", v: !mine?.ready }), disabled: me.pick === undefined },
          mine?.ready ? [icon("check"), "Готов"] : "Готов",
        ),
        isHost ? h("button.primary", { onclick: () => net.send({ k: "start" }) }, icon("play"), "Начать") : h("span.dim", null, "Ждём хоста…"),
        import.meta.env.DEV && isHost ? h("button", { title: "debug: бой 3×5 на тестовой арене", onclick: () => net.send({ k: "debugArena" }) }, icon("swords"), "Тестовая арена") : null,
      ),
    );
    // settings
    const set = (k: string, val: any) => net.send({ k: "settings", s: { [k]: val } });
    const sel = (k: string, val: any, opts: [any, string][]) =>
      h(
        "select",
        { disabled: !isHost, onchange: (e: Event) => set(k, (e.target as HTMLSelectElement).value) },
        opts.map(([ov, label]) => h("option", { value: ov, selected: String(ov) === String(val) }, label)),
      );
    const chk = (k: string, val: boolean, label: string) =>
      h("label", null, h("input", { type: "checkbox", checked: val, disabled: !isHost, onchange: (e: Event) => set(k, (e.target as HTMLInputElement).checked) }), label);
    r.appendChild(
      h(
        "div.panel.lobby-settings",
        null,
        h("div.sect-h", null, icon("gear"), "Настройки партии", isHost ? null : h("span.dim", { style: { fontWeight: 600 } }, " (меняет хост)")),
        h(
          "div.row",
          null,
          h("label", null, "Рассказчик:", sel("storyteller", s.storyteller, [["haven", "Тихая гавань"], ["classic", "Классика"], ["scorched", "Выжженная земля"]])),
          h("label", null, "Жильцов:", sel("residents", s.residents, [[1, "1"], [2, "2"], [3, "3"], [4, "4"], [5, "5"], [6, "6"]])),
          h("label", null, "Длина дня:", sel("dayLength", s.dayLength, [[180, "3 мин"], [360, "6 мин"], [600, "10 мин"]])),
          h("label", null, "Ход в бою:", sel("combatTurnTime", s.combatTurnTime, [[10, "10 с"], [20, "20 с"], [40, "40 с"]])),
          chk("short", s.short, "Короткая партия (10 дней)"),
          chk("traitor", s.traitor, "Засланец"),
          chk("skipPrologue", s.skipPrologue, "Без пролога"),
        ),
      ),
    );
  }
}

/** A survivor card: portrait, profession, the five stats as tiles, traits, phobia, baggage and the secret goal. */
export function cardEl(c: Card, selected: boolean, onclick?: () => void) {
  const pd = PROFS[c.prof];
  return h(
    "div.card" + (selected ? ".sel" : ""),
    { onclick },
    c.custom ? h("span.chip.card-custom", null, "свой") : null,
    h(
      "div.card-top",
      null,
      portrait("card:" + c.name, c, "", () => art(portraitTile(c.prof, c.gender))),
      h(
        "div",
        null,
        h("h3", null, c.name, h("span", { style: { fontSize: "20px" } }, pd?.icon ?? "")),
        h("div.prof", null, pd?.name ?? c.prof, h("small", null, `, ${c.age} лет`)),
        h("div.desc", null, pd?.desc),
      ),
    ),
    h(
      "div.stat-row",
      null,
      (Object.keys(STAT_NAMES) as (keyof typeof STAT_NAMES)[]).map((k) => h("div.stat-tile", null, cic(STAT_IC, k), h("b", null, c.stats[k]), h("small", null, STAT_NAMES[k]))),
    ),
    h("div.trait", null, icon("plus", { color: "#a88cf0" }), h("span", null, h("b", null, TRAITS_PLUS[c.plus]?.name), " — " + (TRAITS_PLUS[c.plus]?.desc ?? ""))),
    h("div.trait", null, icon("minus", { color: "#a88cf0" }), h("span", null, h("b", null, TRAITS_MINUS[c.minus]?.name), " — " + (TRAITS_MINUS[c.minus]?.desc ?? ""))),
    h("div.trait", null, icon("alert", { color: "#f2b53c" }), h("span", null, "Фобия: ", c.phobia)),
    h("div.trait", null, icon("backpack", { color: "#5fa0f0" }), h("span", null, "Багаж: ", c.baggage)),
    c.goal ? h("div.goal", null, icon("lock"), h("span", null, h("b", null, GOALS[c.goal]?.name), ": ", GOALS[c.goal]?.desc)) : null,
  );
}
