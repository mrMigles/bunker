// Интерком у шлюза: a dialog with whoever stands outside (refugee, trader, a door event).
import { ITEMS, itemName } from "@bunker/shared";
import { net } from "../net";
import { clear, closeModal, h, isModalOpen, modal, toast } from "./dom";

let timer = 0;

export function openIntercom() {
  const give: Record<string, number> = {};
  const take: Record<string, number> = {};
  const body = h("div.intercom");
  let key = "";
  const send = (cmd: any) => {
    net.send(cmd);
    key = "";
  };
  const render = () => {
    const c = net.pub?.mods.intercom;
    if (!c) {
      closeModal();
      return;
    }
    const k = JSON.stringify([c, give, take, net.pub?.res]);
    if (k === key) return;
    key = k;
    clear(body);
    body.append(
      h(
        "div.intercom-head",
        null,
        h("div.intercom-grille", null, "📞"),
        h(
          "div",
          null,
          h("b", null, c.kind === "refugee" ? `${c.name}${c.prof ? ` · ${c.prof}` : ""}` : c.name),
          h("div.dim", null, c.kind === "refugee" ? "Просит впустить" : c.kind === "trader" ? "Торговец у двери" : "У гермодвери"),
        ),
        !c.done ? h("span.intercom-left", null, `уйдёт через ~${c.leftHours} ч`) : null,
      ),
      h("p.intercom-text", null, c.text),
    );
    if (c.asked) body.append(h("p.intercom-asked", null, "🗣 " + c.asked));
    if (c.done) {
      body.append(h("p.intercom-done", null, c.done), h("button.primary", { onclick: () => closeModal() }, "Повесить трубку"));
      return;
    }
    const opts = h("div.intercom-opts");
    if (c.kind === "refugee") {
      opts.append(
        h("button.primary", { onclick: () => send({ k: "icAnswer", opt: "in" }) }, "🚪 Впустить", h("small", null, "новый жилец")),
        h("button", { disabled: !!c.asked, onclick: () => send({ k: "icAnswer", opt: "ask" }) }, "🗣 Расспросить", h("small", null, "проверка ХАР — врёт ли?")),
        h("button", { onclick: () => send({ k: "icAnswer", opt: "food" }) }, "🥫 Дать консерву и отказать", h("small", null, "−1 еда, карма")),
        h("button", { onclick: () => send({ k: "icAnswer", opt: "no" }) }, "✋ Не открывать"),
      );
    } else if (c.kind === "event") {
      (c.options ?? []).forEach((o: any, i: number) =>
        opts.append(h("button" + (i === 0 ? ".primary" : ""), { disabled: !!o.disabled, title: o.desc ?? "", onclick: () => send({ k: "icAnswer", opt: String(i) }) }, o.label, o.desc ? h("small", null, o.desc) : null)),
      );
    } else {
      opts.append(tradePanel(c, give, take, send), h("button", { onclick: () => send({ k: "icAnswer", opt: "bye" }) }, "Попрощаться"));
    }
    body.append(opts);
  };
  render();
  modal("Интерком", body, { cls: "intercom-modal", onClose: () => clearInterval(timer) });
  clearInterval(timer);
  timer = window.setInterval(() => (isModalOpen() ? render() : clearInterval(timer)), 250);
}

function tradePanel(c: any, give: Record<string, number>, take: Record<string, number>, send: (cmd: any) => void) {
  const res = net.pub!.res as Record<string, number>;
  const val = (o: Record<string, number>) => Object.entries(o).reduce((s, [k, n]) => s + (ITEMS[k]?.value ?? 1) * n, 0);
  const gv = val(give),
    tv = val(take) * (c.priceMult ?? 1.3);
  const row = (k: string, max: number, o: Record<string, number>) =>
    h(
      "div.trade-row",
      null,
      h("span", null, `${ITEMS[k]?.icon ?? "◇"} ${itemName(k)}`),
      h("small.dim", null, `(${max}) ·${ITEMS[k]?.value ?? 1}`),
      h("button.small", { onclick: () => (o[k] = Math.max(0, (o[k] ?? 0) - 1)) }, "−"),
      h("b", null, String(o[k] ?? 0)),
      h("button.small", { onclick: () => (o[k] = Math.min(max, (o[k] ?? 0) + 1)) }, "+"),
    );
  const mine = Object.keys(res).filter((k) => res[k] >= 1 && ITEMS[k] && ITEMS[k].store !== false && (ITEMS[k].value ?? 0) > 0).sort((a, b) => (ITEMS[b].value ?? 0) - (ITEMS[a].value ?? 0)).slice(0, 14);
  return h(
    "div.intercom-trade",
    null,
    h("div.trade-cols", null,
      h("div", null, h("h4", null, "На тележке"), ...Object.entries(c.stock ?? {}).filter(([, n]) => (n as number) > 0).map(([k, n]) => row(k, n as number, take))),
      h("div", null, h("h4", null, "Со склада"), ...mine.map((k) => row(k, Math.floor(res[k]), give))),
    ),
    h("div.trade-sum", { class: gv >= tv && tv > 0 ? "good" : "dim" }, `Вы даёте на ${gv} · просит ${Math.ceil(tv)} (цены ×${(c.priceMult ?? 1.3).toFixed(2)})`),
    h(
      "button.primary",
      {
        disabled: tv <= 0 || gv < tv,
        onclick: () => {
          send({ k: "icTrade", give: { ...give }, take: { ...take } });
          for (const k in give) delete give[k];
          for (const k in take) delete take[k];
          toast("🤝 Сделка");
        },
      },
      "Обменять",
    ),
  );
}
