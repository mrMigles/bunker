// «Начать заново» in a running game. One player asks, another agrees (in the game, or in the Telegram chat with
// the button under the bot's message) — only then the bunker is wiped. Everyone sees the question on top.
import { net, playerId } from "../net";
import { tgInfo } from "../telegram";
import { h } from "./dom";
import { icon } from "./icons";

let el: HTMLElement | null = null;
let key = "";

/** Asks the others (after the asker confirms it on their own screen). */
export function askRestart() {
  if (!confirm("Предложить начать бункер заново? Всё построенное и найденное пропадёт. Нужно согласие ещё хотя бы одного игрока" + (tgInfo ? " — в игре или в чате." : "."))) return;
  net.send({ k: "restartAsk" });
}

/** The strip on top while the question is open. */
export function updateRestartBanner() {
  const v = net.pub as any;
  const r = v?.phase !== "lobby" ? v?.restart : null;
  const me = playerId();
  const k = r ? JSON.stringify([r.by, r.name, r.by === me]) : "";
  if (k === key) return;
  key = k;
  el?.remove();
  el = null;
  if (!r) return;
  const mine = r.by === me;
  el = h(
    "div.restart-banner",
    { role: "alert" },
    icon("refresh", { size: 18, color: "#ffc477" }),
    h(
      "span.restart-text",
      null,
      mine ? h("b", null, "Вы предложили начать заново") : h("b", null, `${r.name} предлагает начать заново`),
      h("small", null, mine ? (tgInfo ? "Ждём согласия другого игрока — в игре или в чате" : "Ждём согласия другого игрока") : "Всё построенное пропадёт"),
    ),
    mine
      ? h("button.small", { onclick: () => net.send({ k: "restartNo" }) }, icon("x", { size: 14 }), "Отменить")
      : [
          h("button.small.primary", { onclick: () => net.send({ k: "restartYes" }) }, icon("check", { size: 14 }), "Согласен"),
          h("button.small", { onclick: () => net.send({ k: "restartNo" }) }, icon("x", { size: 14 }), "Против"),
        ],
  );
  document.getElementById("ui")?.append(el);
}
