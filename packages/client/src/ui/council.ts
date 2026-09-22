import { BAL, PROFS } from "@bunker/shared";
import { net } from "../net";
import { bar, clear, h, ui } from "./dom";
import { foodTotal } from "./hud";

const MULTS: [number, string][] = [
  [0, "0"],
  [0.5, "½"],
  [1, "1"],
  [2, "×2"],
];

export class CouncilUI {
  el = h("div.panel", { style: { position: "fixed", left: "50%", top: "52px", transform: "translateX(-50%)", width: "min(760px, calc(100vw - 24px))", maxHeight: "calc(100vh - 260px)", overflow: "auto", padding: "14px", zIndex: "20" } });
  noteInput = h("input", { placeholder: "Заметка на доску: кто идёт в вылазку, что строим…", maxLength: 120, style: { flex: "1" } }) as HTMLInputElement;
  private key = "";
  private minimized = false;

  constructor() {
    this.el.classList.add("hidden");
    ui().appendChild(this.el);
    this.noteInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && this.noteInput.value.trim()) {
        net.send({ k: "note", text: this.noteInput.value.trim() });
        this.noteInput.value = "";
      }
    });
  }

  update() {
    const v = net.pub;
    const cn = v?.council;
    if (!v || v.phase !== "night" || !cn) {
      this.el.classList.add("hidden");
      this.key = "";
      return;
    }
    this.el.classList.remove("hidden");
    const left = Math.max(0, Math.ceil(cn.stepEnds - v.phaseT));
    const key = JSON.stringify([cn, left, this.minimized, v.res.water, foodTotal(v.res)]);
    if (key === this.key) return;
    this.key = key;
    const focused = document.activeElement === this.noteInput;
    clear(this.el);
    const me = net.priv!.pid;
    const players = Object.values(v.players).filter((p: any) => p.online) as any[];
    const readyN = players.filter((p) => cn.ready[p.id]).length;
    const steps = [
      ["rations", "🍲 Пайки"],
      ["event", "📜 Событие"],
      ["plan", "📌 План и сон"],
    ];
    this.el.append(
      h(
        "div.row",
        null,
        h("h2", { style: { margin: 0, fontFamily: "var(--title)", fontSize: "18px", color: "var(--warm)" } }, `Ночь ${v.day} · Совет`),
        h("div.grow"),
        ...steps.map(([id, label]) => h("span.tag", { style: { borderColor: cn.step === id ? "var(--rust)" : "", color: cn.step === id ? "var(--warm)" : "" } }, label)),
        h("span", { style: { minWidth: "44px", textAlign: "right" } }, `⏱ ${left}с`),
        h("button.small", { onclick: () => ((this.minimized = !this.minimized), (this.key = "")) }, this.minimized ? "▼" : "▲"),
      ),
    );
    if (this.minimized) return;
    if (cn.step === "rations") this.renderRations(v, cn, me);
    else if (cn.step === "event") this.renderVote(v, cn.vote, me);
    else this.renderPlan(v, cn);
    this.el.append(
      h(
        "div.row",
        { style: { marginTop: "12px" } },
        h("div.dim", null, `Готовы: ${readyN}/${players.length}. Когда все готовы — совет идёт дальше.`),
        h("div.grow"),
        h("button" + (cn.ready[me] ? ".good" : ".primary"), { onclick: () => net.send({ k: "ready", v: !cn.ready[me] }) }, cn.ready[me] ? "✔ Готов" : "Готов →"),
      ),
    );
    if (focused) setTimeout(() => this.noteInput.focus(), 0);
  }

  renderRations(v: any, cn: any, me: string) {
    const chars = Object.values(v.chars).filter((c: any) => c.status !== "dead" && c.status !== "away") as any[];
    let wantF = 0,
      wantW = 0;
    for (const c of chars) {
      const m = cn.rations[c.id] ?? 1;
      wantF += m * BAL.rationFood;
      wantW += m * BAL.rationWater;
    }
    const food = foodTotal(v.res);
    const water = v.res.water ?? 0;
    this.el.append(
      h(
        "div.row",
        { style: { margin: "10px 0", gap: "20px" } },
        h("div", null, "🥫 Еды: ", h("b", { class: food >= wantF ? "good" : "bad" }, food.toFixed(1)), ` / нужно ${wantF.toFixed(1)}`),
        h("div", null, "💧 Воды: ", h("b", { class: water >= wantW ? "good" : "bad" }, Math.floor(water)), ` / нужно ${wantW}`),
        h("div.dim", null, "По умолчанию — поровну. Предложите перераспределение — решает большинство."),
      ),
    );
    const myChar = net.priv?.char;
    for (const c of chars) {
      const cur = cn.rations[c.id] ?? 1;
      const player = c.ctrl ? v.players[c.ctrl] : null;
      this.el.append(
        h(
          "div.row",
          { style: { padding: "3px 0", borderBottom: "1px solid #2a221c" } },
          h("div", { style: { width: "210px" } }, `${PROFS[c.card.prof]?.icon ?? ""} ${c.card.name}`, player ? h("span.dim", null, ` (${player.name})`) : h("span.dim", null, " (бот)")),
          h("div", { style: { width: "90px" } }, h("span.dim", { style: { fontSize: "11px" } }, "сытость"), bar(c.needs.food)),
          h("div", { style: { width: "90px" } }, h("span.dim", { style: { fontSize: "11px" } }, "вода"), bar(c.needs.water)),
          h("div.grow"),
          ...MULTS.map(([m, label]) =>
            h(
              "button.small" + (cur === m ? ".primary" : ""),
              {
                title: c.id === myChar && m < cur ? "Урезать свой паёк (без голосования)" : "Предложить совету",
                onclick: () => cur !== m && net.send({ k: "ration", char: c.id, mult: m }),
              },
              label,
            ),
          ),
        ),
      );
    }
    const open = cn.proposals.filter((p: any) => !p.done);
    if (open.length) {
      this.el.append(h("div", { style: { marginTop: "10px", color: "var(--warm)" } }, "Предложения:"));
      for (const p of open) {
        const c = v.chars[p.char];
        const yes = Object.values(p.votes).filter(Boolean).length;
        const by = v.players[p.by]?.name ?? "?";
        this.el.append(
          h(
            "div.row",
            null,
            h("span", null, `${by}: ${c?.card.name.split(" ")[0]} → ${MULTS.find((x) => x[0] === p.mult)?.[1]} паёк`),
            h("span.dim", null, `за: ${yes}`),
            h("div.grow"),
            h("button.small" + (p.votes[me] ? ".good" : ""), { onclick: () => net.send({ k: "propVote", id: p.id, v: true }) }, "За"),
            h("button.small" + (p.votes[me] === false ? ".primary" : ""), { onclick: () => net.send({ k: "propVote", id: p.id, v: false }) }, "Против"),
          ),
        );
      }
    }
  }

  renderVote(v: any, vote: any, me: string) {
    if (!vote) return;
    const tallies = vote.options.map(() => 0);
    for (const pid in vote.votes) tallies[vote.votes[pid]] += v.players[pid]?.ghost ? 0.5 : 1;
    this.el.append(
      h("div", { style: { margin: "10px 0 4px", fontSize: "16px", color: "var(--warm)" } }, vote.title),
      h("div", { style: { fontFamily: "var(--serif)", fontSize: "15px", lineHeight: "1.5", marginBottom: "10px", whiteSpace: "pre-line" } }, vote.text),
      ...vote.options.map((o: any, i: number) =>
        h(
          "button" + (vote.votes[me] === i ? ".primary" : ""),
          { style: { display: "block", width: "100%", textAlign: "left", margin: "4px 0" }, disabled: !!o.disabled, onclick: () => net.send({ k: "vote", i }) },
          `${i + 1}. ${o.label}`,
          o.desc ? h("span.dim", null, ` — ${o.desc}`) : null,
          h("span", { style: { float: "right" } }, "🗳 " + tallies[i]),
        ),
      ),
      h("div.dim", null, "Ничья — решает Староста ", v.elder ? `(${v.players[v.elder]?.name ?? "?"})` : "", ". Боты высказываются, но не голосуют."),
    );
  }

  renderPlan(v: any, cn: any) {
    const sleepers = Object.entries(cn.sleepers as Record<string, string>);
    const chars = Object.values(v.chars).filter((c: any) => c.status !== "dead" && c.status !== "away") as any[];
    const floor = chars.filter((c) => !cn.sleepers[c.id]);
    this.el.append(
      h("div", { style: { margin: "10px 0 4px", color: "var(--warm)" } }, "📌 Доска планов на завтра"),
      h("div.col", { style: { gap: "3px" } }, cn.notes.length ? cn.notes.map((n: any) => h("div", null, h("b", null, n.by + ": "), n.text)) : h("div.dim", null, "Пусто. Запишите, кто идёт в вылазку и что строим.")),
      h("div.row", { style: { marginTop: "6px" } }, this.noteInput),
      h("div", { style: { margin: "12px 0 4px", color: "var(--warm)" } }, "💤 Кто где спит"),
      h("div.dim", null, sleepers.map(([cid]) => v.chars[cid]?.card.name.split(" ")[0]).join(", ") + (sleepers.length ? " — на койках. " : "") + (floor.length ? floor.map((c) => c.card.name.split(" ")[0]).join(", ") + " — на полу (сон хуже, завтра у них приоритет)." : "Коек хватает всем.")),
    );
  }
}
