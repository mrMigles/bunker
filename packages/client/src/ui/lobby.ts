import { GOALS, PROFS, STAT_NAMES, TRAITS_MINUS, TRAITS_PLUS, type Card } from "@bunker/shared";
import { net } from "../net";
import { clear, h, toast, ui } from "./dom";

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
    clear(r);
    const players = Object.values(v.players) as any[];
    const mine = v.players[me.pid];
    const isHost = !!mine?.host;
    const s = v.settings;
    r.appendChild(
      h(
        "div.row",
        null,
        h("div.title", { style: { fontSize: "26px", color: "var(--rust)" } }, "ГЛУБЖЕ"),
        h("div.grow"),
        h("div.dim", null, "Код бункера:"),
        h(
          "div.code",
          {
            title: "Скопировать",
            onclick: () => {
              navigator.clipboard?.writeText(v.code);
              toast("Код скопирован");
            },
          },
          v.code,
        ),
      ),
    );
    r.appendChild(
      h(
        "div.players",
        null,
        players.map((p) =>
          h(
            "div.pchip",
            { style: { borderColor: "#" + p.color.toString(16).padStart(6, "0") } },
            p.host ? "👑 " : "",
            p.name,
            p.id === me.pid ? " (вы)" : "",
            " ",
            p.ready ? h("span.good", null, "✔ готов") : p.pick ? h("span.dim", null, "выбрал") : h("span.dim", null, "выбирает…"),
          ),
        ),
        h("div.pchip.dim", null, `+ ${Math.max(0, s.residents - players.length)} бот(ов)-жильцов`),
      ),
    );
    r.appendChild(h("div.dim", null, "Выберите карточку выжившего. Скрытую цель видите только вы."));
    const cards = me.cards as Card[] | undefined;
    r.appendChild(
      h(
        "div.cards",
        null,
        (cards ?? []).map((c, i) => cardEl(c, me.pick === i, () => net.send({ k: "pick", i }))),
      ),
    );
    r.appendChild(
      h(
        "div.row",
        null,
        h("button", { onclick: () => net.send({ k: "reroll" }) }, "🎲 Другие карточки"),
        h("div.grow"),
        h(
          "button" + (mine?.ready ? ".good" : ""),
          { onclick: () => net.send({ k: "ready", v: !mine?.ready }), disabled: me.pick === undefined },
          mine?.ready ? "✔ Готов" : "Готов",
        ),
        isHost ? h("button.primary", { onclick: () => net.send({ k: "start" }) }, "▶ Начать") : h("span.dim", null, "Ждём хоста…"),
        import.meta.env.DEV && isHost ? h("button", { title: "debug: бой 3×5 на тестовой арене", onclick: () => net.send({ k: "debugArena" }) }, "⚔ Тестовая арена") : null,
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
      h("label.row", null, h("input", { type: "checkbox", checked: val, disabled: !isHost, onchange: (e: Event) => set(k, (e.target as HTMLInputElement).checked) }), label);
    r.appendChild(
      h(
        "div.panel",
        { style: { padding: "12px" } },
        h("div", { style: { marginBottom: "8px" } }, "Настройки партии", isHost ? "" : h("span.dim", null, " (меняет хост)")),
        h(
          "div.row",
          { style: { flexWrap: "wrap", gap: "16px" } },
          h("label.row", null, "Рассказчик:", sel("storyteller", s.storyteller, [["haven", "Тихая гавань"], ["classic", "Классика"], ["scorched", "Выжженная земля"]])),
          h("label.row", null, "Жильцов:", sel("residents", s.residents, [[1, "1"], [2, "2"], [3, "3"], [4, "4"], [5, "5"], [6, "6"]])),
          h("label.row", null, "Длина дня:", sel("dayLength", s.dayLength, [[180, "3 мин"], [360, "6 мин"], [600, "10 мин"]])),
          h("label.row", null, "Ход в бою:", sel("combatTurnTime", s.combatTurnTime, [[10, "10 с"], [20, "20 с"], [40, "40 с"]])),
          chk("short", s.short, "Короткая партия (10 дней)"),
          chk("traitor", s.traitor, "Засланец"),
          chk("skipPrologue", s.skipPrologue, "Без пролога"),
        ),
      ),
    );
  }
}

export function cardEl(c: Card, selected: boolean, onclick?: () => void) {
  const pd = PROFS[c.prof];
  return h(
    "div.card" + (selected ? ".sel" : ""),
    { onclick },
    h("div.stamp", null, pd?.icon ?? ""),
    h("h3", null, c.name),
    h("div.prof", null, pd?.name ?? c.prof, h("span", { style: { fontWeight: "normal", color: "#555" } }, `, ${c.age} лет`)),
    h("div.line", { style: { fontSize: "12px", color: "#555" } }, pd?.desc),
    h(
      "div.stats",
      null,
      (Object.keys(STAT_NAMES) as (keyof typeof STAT_NAMES)[]).map((k) => h("div", null, h("b", null, c.stats[k]), STAT_NAMES[k])),
    ),
    h("div.line", null, "➕ ", h("b", null, TRAITS_PLUS[c.plus]?.name), h("span", { style: { color: "#555" } }, " — " + (TRAITS_PLUS[c.plus]?.desc ?? ""))),
    h("div.line", null, "➖ ", h("b", null, TRAITS_MINUS[c.minus]?.name), h("span", { style: { color: "#555" } }, " — " + (TRAITS_MINUS[c.minus]?.desc ?? ""))),
    h("div.line", null, "😨 Фобия: ", c.phobia),
    h("div.line", null, "🧳 Багаж: ", c.baggage),
    c.goal ? h("div.goal", null, "🔒 ", h("b", null, GOALS[c.goal]?.name), ": ", GOALS[c.goal]?.desc) : null,
  );
}
