import { BAL, PROFS } from "@bunker/shared";
import { net } from "../net";
import { bar, clear, h, ui } from "./dom";
import { foodTotal } from "./hud";
import { icon } from "./icons";

const MULTS: [number, string][] = [
  [0, "0"],
  [0.5, "½"],
  [1, "1"],
  [2, "×2"],
];

export class CouncilUI {
  el = h("div.panel.council-panel", { style: { position: "fixed", left: "50%", top: "52px", transform: "translateX(-50%)", width: "min(760px, calc(100vw - 24px))", maxHeight: "calc(100dvh - 64px)", overflow: "auto", padding: "14px", zIndex: "20" } });
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
    // the countdown ticks in place: rebuilding the panel every second made buttons slip from under the cursor
    for (const t of this.el.querySelectorAll(".council-left")) t.textContent = String(left);
    const key = JSON.stringify([cn, this.minimized, v.res.water, foodTotal(v.res)]);
    if (key === this.key) return;
    this.key = key;
    const focused = document.activeElement === this.noteInput;
    const scroll = this.el.scrollTop;
    requestAnimationFrame(() => (this.el.scrollTop = scroll));
    clear(this.el);
    const me = net.priv!.pid;
    const players = Object.values(v.players).filter((p: any) => p.online) as any[];
    const readyN = players.filter((p) => cn.ready[p.id]).length;
    const solo = players.filter((p) => !p.aquarium).length === 1;
    const steps = [
      ["rations", "🍲 Пайки"],
      ["event", "📜 Событие"],
      ["plan", "📌 План и сон"],
    ];
    this.el.append(
      h(
        "div.row.council-head",
        null,
        h("h2.council-title", null, icon("moon"), `Ночь ${v.day} · Совет`),
        h("div.grow"),
        solo ? h("span.chip", null, icon("clock"), "ждём вас") : h("span.chip", null, icon("clock"), h("span.council-left", null, String(left)), "с"),
        h("button.small.icon-btn", { title: this.minimized ? "Развернуть" : "Свернуть", onclick: () => ((this.minimized = !this.minimized), (this.key = "")) }, icon(this.minimized ? "chevronDown" : "minus")),
      ),
    );
    if (this.minimized) return;
    // what this night is about, in plain words: three short steps, each with visible consequences
    const idx = Math.max(0, steps.findIndex(([id]) => id === cn.step));
    const WHAT: Record<string, [string, string]> = {
      rations: [
        "Шаг 1 из 3 — ужин: сколько еды и воды получит каждый",
        "Паёк «1» — норма: сытость и вода восстанавливаются. «½» — экономия, но рассудок падает. «0» — голодная ночь. «×2» — чтобы быстрее поправить больного. Свой паёк можно урезать сразу, чужой — только голосованием большинства.",
      ],
      event: [
        "Шаг 2 из 3 — событие ночи: решаем вместе",
        "Голосуют игроки, у каждого один голос; боты высказываются вслух, но не голосуют. «🎲 проверка» — бросок d20 + характеристика лучшего жильца против сложности. Ничья — решает Староста.",
      ],
      plan: [
        "Шаг 3 из 3 — план на завтра и сон",
        "Запишите на доску, кто идёт на вылазку и что строим — заметку увидят все утром. Кому не хватило коек, спят на полу: отдых хуже, завтра они первые на койку.",
      ],
    };
    const [what, how] = WHAT[cn.step] ?? ["", ""];
    this.el.append(
      h(
        "div.council-explain",
        null,
        h("div.council-steps", null, ...steps.map(([, label], i) => h("span" + (i < idx ? ".done" : i === idx ? ".now" : ""), null, (i < idx ? "✓ " : "") + label))),
        h("b", null, what),
        h("p", null, how),
        h("small.dim", null, solo ? "Совет ждёт вас: читайте спокойно и нажмите «Готов». Утром — новый день, решения уже в силе." : h("span", null, "Совет идёт дальше, когда все нажмут «Готов» или через ", h("span.council-left", null, String(left)), " с. Утром — новый день, решения уже в силе.")),
      ),
    );
    if (cn.step === "rations") this.renderRations(v, cn, me);
    else if (cn.step === "event") this.renderVote(v, cn.vote, me);
    else this.renderPlan(v, cn);
    this.el.append(
      h(
        "div.row.council-ready-row",
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
        "div.row.council-summary",
        { style: { margin: "10px 0", gap: "20px" } },
        h("div", null, "🥫 Еды: ", h("b", { class: food >= wantF ? "good" : "bad" }, food.toFixed(1)), ` / нужно ${wantF.toFixed(1)}`),
        h("div", null, "💧 Воды: ", h("b", { class: water >= wantW ? "good" : "bad" }, Math.floor(water)), ` / нужно ${wantW}`),
        h("div.dim", null, "По умолчанию — поровну. Предложите перераспределение — решает большинство."),
      ),
      h(
        "div.dim",
        { style: { marginBottom: "6px" } },
        food >= wantF
          ? `После ужина останется еды ещё на ~${Math.max(0, (food - wantF) / Math.max(0.1, chars.length * BAL.rationFood)).toFixed(1)} дн. при норме.`
          : "Еды на всех не хватит: пайки урежут поровну. Нужна вылазка или урожай.",
      ),
    );
    const myChar = net.priv?.char;
    for (const c of chars) {
      const cur = cn.rations[c.id] ?? 1;
      const player = c.ctrl ? v.players[c.ctrl] : null;
      this.el.append(
        h(
          "div.row.ration-row",
          { style: { padding: "3px 0", borderBottom: "1px solid #2a221c" } },
          h("div.ration-name", null, `${PROFS[c.card.prof]?.icon ?? ""} ${c.card.name}`, player ? h("span.dim", null, ` (${player.name})`) : h("span.dim", null, " (бот)")),
          h("div.ration-need", null, h("span.dim", { style: { fontSize: "11px" } }, "сытость"), bar(c.needs.food)),
          h("div.ration-need", null, h("span.dim", { style: { fontSize: "11px" } }, "вода"), bar(c.needs.water)),
          h("div.grow"),
          h(
            "div.ration-controls",
            null,
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
