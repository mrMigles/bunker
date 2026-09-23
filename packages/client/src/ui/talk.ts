// Разговор с жильцом: today's story, a few ways to answer, and sometimes a request.
import { PERKS } from "@bunker/shared";
import { net } from "../net";
import { clear, closeModal, h, isModalOpen, modal } from "./dom";

let timer = 0;

export function openTalk(charId: string) {
  const body = h("div.talk");
  let key = "";
  const render = () => {
    const v = net.pub;
    const c = v?.chars[charId];
    const t = v?.mods.talks?.[charId];
    if (!c || !t) return;
    const k = JSON.stringify([t, c.needs.sanity]);
    if (k === key) return;
    key = k;
    clear(body);
    const me = net.myChar();
    const rel = me ? (c.rel?.[me.id] ?? 0) : 0;
    body.append(
      h(
        "div.talk-head",
        null,
        h("div.talk-face", { style: { background: "#" + (c.card.color ?? 0x888888).toString(16).padStart(6, "0") } }, c.card.name[0]),
        h(
          "div",
          null,
          h("b", null, c.card.name),
          h("div.dim", null, `${t.prof ?? ""} · ур. ${c.level ?? 1}${(c.perks ?? []).length ? " · " + (c.perks as string[]).map((p) => PERKS[p]?.icon ?? "").join("") : ""}`),
          h("div.dim", null, `Отношение к вам: ${rel > 20 ? "тёплое" : rel > 0 ? "ровное" : rel > -20 ? "настороженное" : "холодное"} · рассудок ${Math.round(c.needs.sanity)}`),
        ),
      ),
      h("p.talk-text", null, `«${t.text.replace(/^«|»$/g, "")}»`),
    );
    if (t.answered) {
      body.append(h("p.talk-answer", null, t.answerText ?? "…"), h("button.primary", { onclick: () => closeModal() }, "До встречи"));
      return;
    }
    const opts = h("div.intercom-opts");
    for (const r of t.replies as { id: string; label: string }[])
      opts.append(h("button" + (r.id === "accept" ? ".primary" : ""), { onclick: () => net.send({ k: "talkReply", char: charId, r: r.id }) }, r.label));
    body.append(opts, h("p.dim.talk-hint", null, "Каждый день у каждого жильца — новая история. Выполненная просьба даёт опыт и дружбу."));
  };
  render();
  modal("Разговор", body, { cls: "talk-modal", onClose: () => clearInterval(timer) });
  clearInterval(timer);
  timer = window.setInterval(() => (isModalOpen() ? render() : clearInterval(timer)), 250);
}
