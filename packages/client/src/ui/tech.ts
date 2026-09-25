import { CRAFTS, MILESTONES, TECH, costText, craftOpen, techAvailable } from "@bunker/shared";
import { SERVER, net } from "../net";
import { add, clear, closeModal, h, modal, ui } from "./dom";

export function openResearch(a: { a: string; t: { type: string; id: string } }) {
  const v = net.pub!;
  if (v.research) {
    net.send({ k: "do", a: a.a, tt: a.t.type, t: a.t.id });
    return;
  }
  const tiers: Record<number, string[]> = {};
  for (const id in TECH) (tiers[TECH[id].tier] ??= []).push(id);
  const body = h("div.col", { style: { minWidth: "720px" } }, h("div.dim", null, "Исследование идёт, пока кто-то сидит за верстаком. Боты продолжают начатое. Ресурсы списываются при старте."));
  for (const tier of Object.keys(tiers).map(Number).sort()) {
    body.append(
      h("div", { style: { color: "var(--warm)", marginTop: "6px" } }, `Ступень ${tier}`),
      h(
        "div",
        { style: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "6px" } },
        tiers[tier].map((id) => {
          const t = TECH[id];
          const done = (v.tech as string[]).includes(id);
          const err = techAvailable(v as any, id);
          const afford = Object.keys(t.cost).every((k) => (v.res[k] ?? 0) >= t.cost[k]);
          return h(
            "button",
            {
              style: { textAlign: "left", opacity: done ? 0.55 : err ? 0.6 : 1, borderColor: done ? "var(--swamp)" : "" },
              disabled: done || !!err || !afford,
              title: t.desc,
              onclick: () => (net.send({ k: "do", a: a.a, tt: a.t.type, t: a.t.id, x: id }), closeModal()),
            },
            h("b", null, (done ? "✔ " : "") + t.name),
            h("div.dim", { style: { fontSize: "11px" } }, t.desc),
            h("div", { style: { fontSize: "11px" } }, done ? "" : err && err !== "Уже изучено" ? h("span.warn", null, err) : `${costText(t.cost)} · ${t.points} очков`),
          );
        }),
      ),
    );
  }
  modal("🔬 Исследования", body, { wide: true });
}

export function openCraftItem(a: { a: string; t: { type: string; id: string } }) {
  const v = net.pub!;
  modal(
    "🛠 Изготовление",
    h(
      "div.col",
      { style: { minWidth: "460px" } },
      Object.keys(CRAFTS)
        .filter((k) => craftOpen(v as any, k))
        .map((k) => {
          const cr = CRAFTS[k];
          const ok = Object.keys(cr.cost).every((r) => (v.res[r] ?? 0) >= cr.cost[r]);
          return h("button", { style: { textAlign: "left" }, disabled: !ok, onclick: () => (net.send({ k: "do", a: a.a, tt: a.t.type, t: a.t.id, x: k }), closeModal()) }, `🛠 ${cr.name}`, h("span.dim", null, " — " + costText(cr.cost)));
        }),
    ),
  );
}

/** The final screen: epilogue, survivors, hidden goals and legacy, chronicle export. */
export class EndingUI {
  el = h("div.ending.hidden");
  private shown = false;
  update() {
    const v = net.pub;
    const info = v?.mods?.endingInfo;
    const on = v?.phase === "ending" && !!info;
    this.el.classList.toggle("hidden", !on);
    if (!on) {
      this.shown = false;
      return;
    }
    if (this.shown) return;
    this.shown = true;
    if (!this.el.parentElement) ui().appendChild(this.el);
    const me = net.priv?.pid ?? "";
    const leg = info.legacy?.[me];
    if (leg) saveLegacy(leg.name, leg.points);
    clear(this.el);
    add(
      this.el,
      h(
        "div.panel.ending-box",
        null,
        h("div.ending-title", { style: { color: info.good ? "var(--warm)" : "#ff7a6a" } }, info.title),
        h("div.ending-text", null, info.text),
        h("div", null, `День ${info.day}. Выжили: `, h("b", null, info.survivors.join(", ") || "никто")),
        info.fallen.length ? h("div.dim", null, `🕯 Помним: ${info.fallen.join(", ")}`) : null,
        info.milestones?.length
          ? h("div", { style: { marginTop: "8px" } }, h("b", null, `🏅 Вехи (${info.milestones.length}/${MILESTONES.length}): `), info.milestones.map((m: any) => MILESTONES.find((x) => x.id === m.id)?.name ?? m.id).join(" · "))
          : null,
        h(
          "div.col",
          { style: { marginTop: "10px", gap: "3px" } },
          Object.values(info.legacy as Record<string, any>).map((l: any) => h("div", null, `${l.name}: +${l.points} наследия`, l.goal ? h("span", { class: l.done ? "good" : "dim" }, ` · тайная цель «${l.goal}» ${l.done ? "выполнена" : "не выполнена"}`) : null)),
        ),
        h("div.dim", { style: { marginTop: "6px" } }, `Ваше наследие всего: ${totalLegacy()} — открывает косметику бункера в следующих партиях.`),
        h(
          "div.row",
          { style: { marginTop: "12px" } },
          h("button", { onclick: () => exportChronicle() }, "🗞 Скачать летопись (PNG)"),
          h("div.grow"),
          v.players[me]?.host ? h("button.primary", { onclick: () => net.send({ k: "newGame" }) }, "▶ Новая партия") : h("span.dim", null, "Новую партию начинает хост"),
        ),
      ),
    );
  }
}

function saveLegacy(name: string, pts: number) {
  try {
    const key = "bunker.legacy.saved." + net.code;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "1");
    localStorage.setItem("bunker.legacy", String(totalLegacy() + pts));
  } catch {}
  fetch(`${SERVER}/api/legacy/${encodeURIComponent(name)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ points: pts }) }).catch(() => {});
}

export function totalLegacy() {
  try {
    return Number(localStorage.getItem("bunker.legacy") ?? 0) || 0;
  } catch {
    return 0;
  }
}

/** Renders the chronicle (all «Вестник» issues) into a PNG the player can keep. */
function exportChronicle() {
  const v = net.pub!;
  const issues = (v.mods.endingInfo?.chronicle ?? v.gazette) as any[];
  const W = 900;
  const lineH = 20;
  const rows = issues.reduce((s, g) => s + 3 + g.lines.length, 6);
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = Math.min(16000, rows * lineH + 80);
  const g = cv.getContext("2d")!;
  g.fillStyle = "#e3d6b8";
  g.fillRect(0, 0, W, cv.height);
  g.fillStyle = "#2a2320";
  g.font = "bold 34px 'PT Serif', Georgia, serif";
  g.fillText(`Летопись бункера ${net.code}`, 30, 50);
  g.font = "16px 'PT Serif', Georgia, serif";
  let y = 90;
  const info = v.mods.endingInfo;
  if (info) {
    g.fillText(`Финал: «${info.title}», день ${info.day}. Выжили: ${info.survivors.join(", ")}`, 30, y);
    y += lineH * 2;
  }
  for (const is of issues) {
    g.font = "bold 18px 'PT Serif', Georgia, serif";
    g.fillText(`День ${is.day}: ${is.headline}`, 30, y);
    y += lineH;
    g.font = "15px 'PT Serif', Georgia, serif";
    for (const l of is.lines) {
      g.fillText("  " + l, 30, y);
      y += lineH;
    }
    y += lineH / 2;
    if (y > cv.height - 20) break;
  }
  const a = document.createElement("a");
  a.href = cv.toDataURL("image/png");
  a.download = `letopis-${net.code}.png`;
  a.click();
}
