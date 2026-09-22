import { EVENTS } from "@bunker/shared";
import { net } from "../net";
import { closeModal, h, modal } from "./dom";

/** Dev-only debug panel (~). The server ignores debug commands in production. */
export function openDebug(fps: () => number) {
  const d = (op: string, arg?: any) => () => net.send({ k: "debug", op, arg });
  const evSel = h("select", null, EVENTS.map((e) => h("option", { value: e.id }, `${e.phase === "day" ? "☀" : "🌙"} ${e.id} — ${e.title}`))) as HTMLSelectElement;
  modal(
    "🛠 Debug",
    h(
      "div.col",
      { style: { minWidth: "440px" } },
      h("div.dim", null, `FPS ${Math.round(fps())} · пинг ${Math.round(net.latency)} мс · комната ${net.code}`),
      h(
        "div.row",
        { style: { flexWrap: "wrap" } },
        h("button.small", { onclick: d("rich") }, "💰 Ресурсы"),
        h("button.small", { onclick: d("heal") }, "❤ Вылечить всех"),
        h("button.small", { onclick: d("hour", 12) }, "⏰ 12:00"),
        h("button.small", { onclick: d("hour", 21.8) }, "⏰ 21:48"),
        h("button.small", { onclick: d("night") }, "🌙 Ночь"),
        h("button.small", { onclick: d("speed", 10) }, "⏩ ×10"),
        h("button.small", { onclick: d("speed", 1) }, "▶ ×1"),
        h("button.small", { onclick: d("alltech") }, "🔬 Все технологии"),
        h("button.small", { onclick: d("notice", 80) }, "👁 Заметность 80"),
        h("button.small", { onclick: () => (net.send({ k: "debugArena" }), closeModal()) }, "⚔ Арена"),
        h("button.small", { onclick: () => (net.send({ k: "debug", op: "raid", arg: "raiders" }), closeModal()) }, "🏴 Налёт"),
        h("button.small", { onclick: () => (net.send({ k: "debug", op: "raid", arg: "metro" }), closeModal()) }, "🚇 Налёт из метро"),
        h("button.small", { onclick: () => (net.send({ k: "debug", op: "games" }), closeModal()) }, "🎲 Все настолки"),
      ),
      h("div.row", null, evSel, h("button.small", { onclick: () => net.send({ k: "debug", op: "event", arg: evSel.value }) }, "Вызвать событие")),
      h("label.row", null, h("input", { type: "checkbox", onchange: (e: Event) => ((window as any).__showGrid = (e.target as HTMLInputElement).checked) }), "Показать сетку/коллайдеры"),
    ),
  );
}
