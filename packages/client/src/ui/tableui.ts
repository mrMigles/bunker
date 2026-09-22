import { GAMES, cardName } from "@bunker/shared";
import { audio } from "../audio/audio";
import { net } from "../net";
import { TableScene } from "../render/table";
import type { WorldRenderer } from "../render/world";
import { add, clear, h, ui } from "./dom";

/** Game-table mode: replaces the side view with a 3D view over the table. */
export class TableUI {
  scene = new TableScene();
  el = h("div.table-ui.hidden");
  panel = h("div.panel.table-panel");
  talk = h("div.table-talk");
  status = h("div.table-status");
  active = false;
  tableId: string | null = null;
  spectating: string | null = null;
  private key = "";
  private lastCards = 0;
  private opts: Record<string, any> = { variant: "podkidnoy" };
  private stake: { item: string; n: number } | null = null;
  private game = "durak";

  constructor(private r: WorldRenderer) {
    this.el.append(this.status, this.talk, this.panel);
    ui().appendChild(this.el);
    const canvas = r.renderer.domElement;
    canvas.addEventListener("mousemove", (e) => {
      if (!this.active) return;
      this.scene.hover = this.scene.pick(e.clientX, e.clientY);
    });
    canvas.addEventListener("mousedown", (e) => {
      if (!this.active || e.button !== 0) return;
      const k = this.scene.pick(e.clientX, e.clientY);
      if (k) this.clickCard(k);
    });
  }

  /** Which table (if any) my character sits at or I'm watching. */
  currentTable(): string | null {
    const me = net.myChar();
    if (me?.task?.action === "sit_table" && me.seat) return me.seat;
    return this.spectating;
  }

  update() {
    const v = net.pub;
    const tid = this.currentTable();
    const t = tid ? v?.mods?.tables?.[tid] : null;
    const was = this.active;
    this.active = !!tid && v?.phase === "day";
    this.tableId = tid;
    this.el.classList.toggle("hidden", !this.active);
    if (!this.active) {
      if (was) this.scene.selected = null;
      return;
    }
    const priv = net.priv?.mods?.tables;
    const meChar = net.priv?.char ?? null;
    const seats: (string | null)[] = t?.seats ?? [null, null, null, null];
    const mySeat = meChar ? seats.indexOf(meChar) : -1;
    this.scene.setSeats(
      seats.map((c) => ({ char: c, color: c && v!.chars[c] ? v!.chars[c].card.color : 0x555555, name: c && v!.chars[c] ? v!.chars[c].card.name : "" })),
      mySeat >= 0 ? mySeat : 0,
    );
    const view = priv && priv.obj === tid ? priv.view : t?.view;
    if (view && t?.game === "durak") {
      this.scene.layoutDurak(view, seats, mySeat >= 0 ? meChar : null);
      const cards = view.table.length;
      if (cards !== this.lastCards) audio.sfx("card", 0.7);
      this.lastCards = cards;
    } else this.scene.layoutDurak({ players: [], hands: {}, deck: 0, table: [], discard: 0 }, seats, null);
    // selectable cards
    const legal: any[] = priv && priv.obj === tid ? priv.legal ?? [] : [];
    this.scene.selectable = new Set(legal.filter((m) => m.card).map((m) => "h" + m.card));
    this.scene.targetable = new Set();
    if (this.scene.selected) {
      for (const m of legal) if (m.t === "beat" && m.card === this.scene.selected) this.scene.targetable.add("t" + view.table[m.i].a);
    }
    this.renderPanel(t, view, legal, seats, meChar);
  }

  clickCard(key: string) {
    const priv = net.priv?.mods?.tables;
    const legal: any[] = priv?.legal ?? [];
    const v = net.pub!;
    const t = v.mods.tables?.[this.tableId!];
    const view = priv?.view ?? t?.view;
    if (key.startsWith("h")) {
      const card = key.slice(1);
      const moves = legal.filter((m) => m.card === card);
      if (!moves.length) return;
      if (moves.length === 1 && moves[0].t !== "beat") return this.send(moves[0]);
      const beatsM = moves.filter((m) => m.t === "beat");
      if (beatsM.length === 1 && !moves.some((m) => m.t === "transfer")) return this.send(beatsM[0]);
      this.scene.selected = this.scene.selected === card ? null : card;
      this.key = "";
    } else if (key.startsWith("t") && this.scene.selected && view) {
      const a = key.slice(1);
      const i = view.table.findIndex((x: any) => x.a === a);
      const m = legal.find((x) => x.t === "beat" && x.card === this.scene.selected && x.i === i);
      if (m) this.send(m);
    }
  }

  send(move: any) {
    net.send({ k: "tableMove", move });
    this.scene.selected = null;
    audio.sfx("card");
  }

  renderPanel(t: any, view: any, legal: any[], seats: (string | null)[], me: string | null) {
    const v = net.pub!;
    const seated = me && seats.includes(me);
    const key = JSON.stringify([t?.status, t?.talk, t?.turnT, legal, seats, t?.result, this.opts, this.stake, this.game, this.scene.selected, view?.taking, view?.attacker, view?.defender, t?.paused]);
    if (key === this.key) return;
    this.key = key;
    const name = (id: string) => (v.chars[id] ? v.chars[id].card.name.split(" ")[0] : id);
    // status line
    clear(this.status);
    if (t?.status === "playing" && view) {
      const trump = view.trump ? { s: "♠", c: "♣", d: "♦", h: "♥" }[view.trump as string] : "";
      add(
        this.status,
        h("span", null, `Козырь: ${trump} `),
        h("span.dim", null, `· колода ${view.deck} · `),
        h("span", null, `ходит ${name(view.attacker)} → отбивается ${name(view.defender)}${view.taking ? " (берёт!)" : ""}`),
        h("span.dim", null, ` · ⏱ ${t.turnT}с`),
        t.stake ? h("span.warn", null, ` · на кону ${Object.values(t.pot)[0]} × ${t.stake.item === "food_can" ? "🥫" : t.stake.item === "ammo" ? "🔸" : "🚬"}`) : null,
        t.paused ? h("span.bad", null, " · ПАУЗА") : null,
      );
      if (view.out?.length) add(this.status, h("div.dim", null, "Вышли: " + view.out.map(name).join(", ")));
    } else if (t?.status === "over" && t.result) add(this.status, h("b", { style: { color: "var(--warm)" } }, t.result.draw ? "Ничья!" : t.result.losers.length ? `В дураках: ${t.result.losers.map(name).join(", ")}` : "Партия окончена"));
    else add(this.status, h("span.dim", null, seated ? "Стол свободен. Выберите игру и начните." : "Вы смотрите партию. Чужих карт не видно."));
    // talk
    clear(this.talk);
    for (const m of t?.talk ?? []) this.talk.appendChild(h("div", null, h("b", null, m.who + ": "), m.text));
    // controls
    clear(this.panel);
    const btn = (label: string, move: any, cls = "") => h("button" + cls, { onclick: () => this.send(move) }, label);
    if (t?.status === "playing" && seated) {
      const take = legal.find((m) => m.t === "take");
      const pass = legal.find((m) => m.t === "pass");
      add(
        this.panel,
        this.scene.selected ? h("span.warn", null, `Выбрана ${cardName(this.scene.selected)} — щёлкните карту на столе, которую бьёте`) : legal.some((m) => m.card) ? h("span.dim", null, "Подсвеченные карты можно сыграть — щёлкните по ним") : h("span.dim", null, "Ждём других…"),
        take ? btn("🫳 Беру", take, ".primary") : null,
        pass ? btn(view?.table?.every((x: any) => x.d) ? "✋ Бито" : "✋ Пас", pass) : null,
        ...legal.filter((m) => m.t === "catch").slice(0, 3).map((m) => btn(`🕵 Жульничество! (${view.table[m.i] ? cardName(view.table[m.i].d ?? "") : ""})`, m, ".small")),
      );
    }
    if (t?.status !== "playing" && seated) {
      const games: string[] = t?.games ?? ["durak"];
      if (!games.includes(this.game)) this.game = games[0];
      const g = GAMES[this.game];
      add(
        this.panel,
        h(
          "select",
          { onchange: (e: Event) => ((this.game = (e.target as HTMLSelectElement).value), (this.key = "")) },
          games.map((id) => h("option", { value: id, selected: id === this.game }, GAMES[id]?.name ?? id)),
        ),
        ...Object.entries(g?.options ?? {}).map(([k, o]) =>
          h(
            "select",
            { onchange: (e: Event) => ((this.opts[k] = (e.target as HTMLSelectElement).value), (this.key = "")) },
            o.values.map(([val, lab]) => h("option", { value: val, selected: this.opts[k] === val }, lab)),
          ),
        ),
        h(
          "select",
          { onchange: (e: Event) => ((this.stake = (e.target as HTMLSelectElement).value ? { item: (e.target as HTMLSelectElement).value, n: 1 } : null), (this.key = "")) },
          h("option", { value: "" }, "На интерес"),
          h("option", { value: "food_can", selected: this.stake?.item === "food_can" }, "На консервы (из тайника)"),
          h("option", { value: "cigarettes", selected: this.stake?.item === "cigarettes" }, "На сигареты"),
          h("option", { value: "ammo", selected: this.stake?.item === "ammo" }, "На патроны"),
        ),
        h("button.primary", { onclick: () => net.send({ k: "tableStart", game: this.game, opts: this.opts, stake: this.stake }) }, "▶ Сдавать"),
        seats.includes(null) ? h("button", { onclick: () => net.send({ k: "tableInvite" }) }, "🤖 Позвать жильца") : null,
      );
    }
    add(this.panel, h("button.small", { onclick: () => this.leave() }, "Встать (Esc)"));
  }

  leave() {
    if (this.spectating) this.spectating = null;
    else net.send({ k: "stop" });
    this.active = false;
    this.el.classList.add("hidden");
  }

  /** Spectate the nearest running table (G). */
  toggleSpectate() {
    if (this.spectating) {
      this.spectating = null;
      return;
    }
    const v = net.pub;
    const me = net.myChar();
    if (!v || !me) return;
    for (const id in v.mods?.tables ?? {}) {
      const o = v.objs[id];
      if (o && o.lv === me.lv && Math.abs(o.x + 0.5 - me.x) < 3) {
        this.spectating = id;
        return;
      }
    }
  }

  frame(dt: number) {
    if (!this.active) return false;
    this.scene.frame(dt, this.r.renderer);
    return true;
  }
}
