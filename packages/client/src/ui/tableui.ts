import { GAMES, cardName, generalaScore, nardyAbs, rankLabel } from "@bunker/shared";
import { audio } from "../audio/audio";
import { net } from "../net";
import { hitDie, hitPoint, hitSquare, type BoardCtx } from "../render/boards2d";
import { TableScene } from "../render/table";
import type { WorldRenderer } from "../render/world";
import { add, clear, h, ui } from "./dom";

/** Games drawn with 3D cards (the rest use the flat board texture). */
const CARD_GAMES = new Set(["durak", "poker", "cheat", "drunkard"]);
/** Games moved by clicking the board rather than buttons. */
const CLICK_GAMES = new Set(["chess", "checkers"]);

const hex = (n: number) => "#" + n.toString(16).padStart(6, "0");

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
  /** board selection (square / point) */
  private sel: number | null = null;
  private keep = [false, false, false, false, false];
  private claim = "";
  private lastView: any = null;
  private lastGame: string | null = null;

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
      if (k) return this.clickCard(k);
      const p = this.scene.pickBoard(e.clientX, e.clientY);
      if (p) this.clickBoard(p.x, p.y);
    });
  }

  /** Which table (if any) my character sits at or I'm watching. */
  currentTable(): string | null {
    const me = net.myChar();
    if (me?.task?.action === "sit_table" && me.seat) return me.seat;
    return this.spectating;
  }

  private legal(): any[] {
    const priv = net.priv?.mods?.tables;
    return priv && priv.obj === this.tableId ? priv.legal ?? [] : [];
  }

  private ctx(): BoardCtx {
    const v = net.pub!;
    const names: Record<string, string> = {};
    const colors: Record<string, string> = {};
    for (const id in v.chars) {
      names[id] = v.chars[id].card.name.split(" ")[0];
      colors[id] = hex(v.chars[id].card.color);
    }
    const legal = this.legal();
    return { me: net.priv?.char ?? null, names, colors, sel: this.sel, hints: this.hints(legal), keep: this.keep };
  }

  /** Squares/points that the selected piece can go to. */
  private hints(legal: any[]): number[] {
    if (this.sel === null) return [];
    const g = this.lastGame;
    if (g === "chess") return legal.filter((m) => m.from === this.sel).map((m) => m.to);
    if (g === "checkers") return legal.filter((m) => m.path?.[0] === this.sel).map((m) => m.path[m.path.length - 1]);
    if (g === "backgammon" && this.lastView) {
      const me = net.priv?.char;
      if (!me) return [];
      return legal.filter((m) => m.t === "move" && nardyAbs(this.lastView, me, m.from) === this.sel && m.from + m.die < 24).map((m) => nardyAbs(this.lastView, me, m.from + m.die));
    }
    return [];
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
      if (was) {
        this.scene.selected = null;
        this.scene.multi.clear();
      }
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
    const game: string | null = t?.game && view && t.status !== "idle" ? t.game : null;
    if (game !== this.lastGame) {
      this.sel = null;
      this.keep = [false, false, false, false, false];
      this.scene.multi.clear();
    }
    this.lastGame = game;
    this.lastView = view;
    const me = mySeat >= 0 ? meChar : null;
    if (game === "durak") this.scene.layoutDurak(view, seats, me);
    else if (game && CARD_GAMES.has(game)) this.scene.layoutDurak(this.cardView(game, view, me), seats, me);
    else this.scene.layoutDurak({ players: [], hands: {}, deck: 0, table: [], discard: 0 }, seats, null);
    const cards = game ? this.scene.cards.size : 0;
    if (cards !== this.lastCards && game && CARD_GAMES.has(game)) audio.sfx("card", 0.7);
    this.lastCards = cards;
    // generala: no dice held before the first roll
    if (game === "generala" && !view.rolls) this.keep = [false, false, false, false, false];
    this.scene.setBoard(game && game !== "durak" ? game : null, view, this.ctx(), !!game && !CARD_GAMES.has(game));
    // selectable cards
    const legal = this.legal();
    if (game === "cheat") this.scene.selectable = new Set((view?.hand ?? []).map((c: string) => "h" + c));
    else this.scene.selectable = new Set(legal.filter((m) => m.card).map((m) => "h" + m.card));
    this.scene.targetable = new Set();
    if (this.scene.selected && game === "durak") {
      for (const m of legal) if (m.t === "beat" && m.card === this.scene.selected) this.scene.targetable.add("t" + view.table[m.i].a);
    }
    this.renderPanel(t, view, legal, seats, meChar);
  }

  /** Map card-game views onto the Durak layout: hands around the table, shared cards in the middle. */
  private cardView(game: string, view: any, me: string | null) {
    const hands: Record<string, any> = {};
    if (game === "poker") {
      for (const p of view.players) hands[p] = view.folded.includes(p) ? 0 : view.hands[p];
      return { players: view.players, hands, deck: 0, table: view.board.map((c: string) => ({ a: c })), discard: 0 };
    }
    if (game === "cheat") {
      for (const p of view.players) hands[p] = p === me && view.hand ? view.hand : view.counts[p];
      return { players: view.players, hands, deck: 0, table: (view.reveal?.cards ?? []).map((c: string) => ({ a: c })), discard: 0, pileBacks: view.pile };
    }
    // drunkard: personal decks as small stacks, flipped cards face up in the middle
    for (const p of view.players) hands[p] = Math.min(view.counts[p], 6);
    return { players: view.players, hands, deck: 0, table: Object.values(view.flipped).map((c) => ({ a: c })), discard: 0, pileBacks: Math.max(0, view.pile - Object.keys(view.flipped).length) };
  }

  clickCard(key: string) {
    const legal = this.legal();
    const v = net.pub!;
    const t = v.mods.tables?.[this.tableId!];
    const priv = net.priv?.mods?.tables;
    const view = priv?.view ?? t?.view;
    if (t?.game === "cheat" && key.startsWith("h")) {
      const c = key.slice(1);
      if (this.scene.multi.has(c)) this.scene.multi.delete(c);
      else if (this.scene.multi.size < 4) this.scene.multi.add(c);
      audio.sfx("click", 0.5);
      this.key = "";
      return;
    }
    if (t?.game !== "durak") return;
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

  clickBoard(px: number, py: number) {
    const game = this.lastGame;
    const view = this.lastView;
    if (!game || !view) return;
    const legal = this.legal();
    const ctx = this.ctx();
    if (game === "chess" || game === "checkers") {
      const sq = hitSquare(view, ctx, px, py);
      if (sq === null) return;
      const from = (m: any) => (game === "chess" ? m.from : m.path?.[0]);
      const to = (m: any) => (game === "chess" ? m.to : m.path?.[m.path.length - 1]);
      if (this.sel !== null) {
        const ms = legal.filter((m) => m.t === "move" && from(m) === this.sel && to(m) === sq);
        if (ms.length) return this.send(ms.find((m) => !m.promo || m.promo === "q") ?? ms[0]);
      }
      this.sel = legal.some((m) => m.t === "move" && from(m) === sq) ? (this.sel === sq ? null : sq) : null;
      this.key = "";
      audio.sfx("click", 0.4);
    } else if (game === "backgammon") {
      const pt = hitPoint(px, py);
      const me = net.priv?.char;
      if (pt === null || !me) return;
      if (this.sel !== null) {
        const m = legal.find((x) => x.t === "move" && nardyAbs(view, me, x.from) === this.sel && nardyAbs(view, me, x.from + x.die) === pt && x.from + x.die < 24);
        if (m) return this.send(m);
      }
      this.sel = legal.some((x) => x.t === "move" && nardyAbs(view, me, x.from) === pt) ? pt : null;
      this.key = "";
    } else if (game === "generala") {
      const i = hitDie(px, py);
      if (i === null || !view.rolls || view.rolls >= 3 || view.turn !== net.priv?.char) return;
      this.keep[i] = !this.keep[i];
      audio.sfx("click", 0.5);
      this.key = "";
      this.scene.setBoard(game, view, this.ctx(), true);
    }
  }

  send(move: any) {
    net.send({ k: "tableMove", move });
    this.scene.selected = null;
    this.scene.multi.clear();
    this.sel = null;
    if (move.t === "roll") this.keep = [false, false, false, false, false];
    audio.sfx(this.lastGame && CARD_GAMES.has(this.lastGame) ? "card" : "click");
  }

  private statusLine(t: any, view: any, name: (id: string) => string): (HTMLElement | string | null)[] {
    const game: string = t.game;
    const acting: string[] = t.toAct ?? [];
    const whose = acting.length ? `ходит ${acting.slice(0, 3).map(name).join(", ")}${acting.length > 3 ? "…" : ""}` : "";
    if (game === "durak") {
      const trump = view.trump ? { s: "♠", c: "♣", d: "♦", h: "♥" }[view.trump as string] : "";
      return [h("span", null, `Козырь: ${trump} `), h("span.dim", null, `· колода ${view.deck} · `), h("span", null, `ходит ${name(view.attacker)} → отбивается ${name(view.defender)}${view.taking ? " (берёт!)" : ""}`)];
    }
    if (game === "poker") return [h("span", null, `Банк ${view.pot} · ставка ${view.cur} · `), h("span", null, view.players.map((p: string) => `${name(p)} ${view.chips[p]}${view.folded.includes(p) ? "✗" : ""}`).join(" · ")), h("span.dim", null, ` · ${whose}`)];
    if (game === "cheat") return [h("span", null, view.rank ? `Ранг: «${rankLabel(view.rank)}» · ` : "Новый круг · "), h("span", null, view.players.map((p: string) => `${name(p)} ${view.out.includes(p) ? "✔" : view.counts[p]}`).join(" · ")), h("span.dim", null, ` · ${whose}`)];
    if (game === "mafia") return [h("span", null, `${view.phase === "night" ? "🌙 Ночь" : "☀ День"} ${view.day} · `), h("span.dim", null, view.phase === "night" ? `ждём ${view.waiting}` : `голосов ${Object.keys(view.votes).length}/${view.alive.length}`)];
    if (game === "chess" && view.check) return [h("span.bad", null, "Шах! "), h("span", null, whose)];
    return [h("span", null, whose)];
  }

  renderPanel(t: any, view: any, legal: any[], seats: (string | null)[], me: string | null) {
    const v = net.pub!;
    const seated = me && seats.includes(me);
    const key = JSON.stringify([t?.status, t?.talk, t?.log?.length, t?.turnT, legal, seats, t?.result, this.opts, this.stake, this.game, this.scene.selected, [...this.scene.multi], this.keep, this.claim, this.sel, view?.taking, view?.attacker, view?.defender, t?.paused, t?.toAct]);
    if (key === this.key) return;
    this.key = key;
    const name = (id: string) => (v.chars[id] ? v.chars[id].card.name.split(" ")[0] : id);
    // status line
    clear(this.status);
    if (t?.status === "playing" && view) {
      add(
        this.status,
        h("b", null, GAMES[t.game]?.name + ": "),
        ...this.statusLine(t, view, name),
        h("span.dim", null, ` · ⏱ ${t.turnT}с`),
        t.stake ? h("span.warn", null, ` · на кону ${Object.values(t.pot)[0]} × ${t.stake.item === "food_can" ? "🥫" : t.stake.item === "ammo" ? "🔸" : "🚬"}`) : null,
        t.paused ? h("span.bad", null, " · ПАУЗА") : null,
      );
      if (t.game === "durak" && view.out?.length) add(this.status, h("div.dim", null, "Вышли: " + view.out.map(name).join(", ")));
    } else if (t?.status === "over" && t.result)
      add(
        this.status,
        h("b", { style: { color: "var(--warm)" } }, t.result.draw ? "Ничья!" : t.game === "durak" && t.result.losers.length ? `В дураках: ${t.result.losers.map(name).join(", ")}` : t.result.winners.length ? `Победа: ${t.result.winners.map(name).join(", ")}` : "Все проиграли"),
        t.result.text ? h("div.dim", null, t.result.text.replace(/\bc[0-9a-z]+\b/g, (id: string) => name(id))) : null,
      );
    else add(this.status, h("span.dim", null, seated ? "Стол свободен. Выберите игру и начните." : "Вы смотрите партию. Чужих карт не видно."));
    // who is at the table, whose turn it is
    clear(this.talk);
    const toAct: string[] = t?.toAct ?? [];
    this.talk.appendChild(
      h(
        "div.table-seats",
        null,
        ...seats.map((id, i) => {
          if (!id) return h("div.table-seat.empty", null, `Место ${i + 1} свободно`);
          const c = v.chars[id];
          const who = c?.ctrl ? v.players[c.ctrl]?.name ?? "игрок" : "бот";
          return h(
            "div.table-seat" + (toAct.includes(id) ? ".turn" : "") + (id === me ? ".me" : ""),
            { style: { borderColor: "#" + (c?.card.color ?? 0x555555).toString(16).padStart(6, "0") } },
            h("b", null, c ? c.card.name.split(" ")[0] : id),
            h("small", null, id === me ? "вы" : who),
            toAct.includes(id) ? h("span.table-turn", null, "ходит") : null,
          );
        }),
      ),
    );
    // the game journal: every move with its author
    const log = (t?.log ?? []) as { who: string; text: string; n: number }[];
    const jr = h("div.table-journal", null, h("div.table-journal-head", null, "Журнал партии"), ...(log.length ? log.slice(-12).map((l) => h("div", null, h("span.dim", null, `${l.n}. `), h("b", null, l.who + ": "), l.text)) : [h("div.dim", null, "Ходов пока нет")]));
    this.talk.appendChild(jr);
    for (const m of t?.talk ?? []) this.talk.appendChild(h("div.table-chat", null, h("b", null, m.who + ": "), m.text));
    setTimeout(() => (jr.scrollTop = jr.scrollHeight), 0);
    // controls
    clear(this.panel);
    const btn = (label: string, move: any, cls = "") => h("button" + cls, { onclick: () => this.send(move) }, label);
    if (t?.status === "playing" && seated) {
      if (t.game === "durak") {
        const take = legal.find((m) => m.t === "take");
        const pass = legal.find((m) => m.t === "pass");
        add(
          this.panel,
          this.scene.selected ? h("span.warn", null, `Выбрана ${cardName(this.scene.selected)} — щёлкните карту на столе, которую бьёте`) : legal.some((m) => m.card) ? h("span.dim", null, "Подсвеченные карты можно сыграть — щёлкните по ним") : h("span.dim", null, "Ждём других…"),
          take ? btn("🫳 Беру", take, ".primary") : null,
          pass ? btn(view?.table?.every((x: any) => x.d) ? "✋ Бито" : "✋ Пас", pass) : null,
          ...legal.filter((m) => m.t === "catch").slice(0, 3).map((m) => btn(`🕵 Жульничество! (${view.table[m.i] ? cardName(view.table[m.i].d ?? "") : ""})`, m, ".small")),
        );
      } else this.gameControls(t.game, view, legal, btn, name);
    }
    if (t?.status !== "playing" && seated) {
      const games: string[] = t?.games ?? ["durak"];
      if (!games.includes(this.game)) this.game = games[0];
      const g = GAMES[this.game];
      const n = seats.filter(Boolean).length;
      add(
        this.panel,
        h(
          "select",
          { onchange: (e: Event) => ((this.game = (e.target as HTMLSelectElement).value), (this.key = "")) },
          games.map((id) => h("option", { value: id, selected: id === this.game }, `${GAMES[id]?.name ?? id} (${GAMES[id].minPlayers}–${GAMES[id].maxPlayers})`)),
        ),
        ...Object.entries(g?.options ?? {}).map(([k, o]) =>
          h(
            "select",
            { onchange: (e: Event) => ((this.opts[k] = isNaN(Number((e.target as HTMLSelectElement).value)) ? (e.target as HTMLSelectElement).value : Number((e.target as HTMLSelectElement).value)), (this.key = "")) },
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
        h("button.primary", { disabled: g && (n < g.minPlayers || n > g.maxPlayers), title: g ? `Игроков: ${g.minPlayers}–${g.maxPlayers}` : "", onclick: () => net.send({ k: "tableStart", game: this.game, opts: this.opts, stake: this.stake }) }, "▶ Начать"),
        seats.includes(null) ? h("button", { onclick: () => net.send({ k: "tableInvite" }) }, "🤖 Позвать жильца") : null,
      );
    }
    add(this.panel, h("button.small", { onclick: () => this.leave() }, "Встать (Esc)"));
  }

  private gameControls(game: string, view: any, legal: any[], btn: (l: string, m: any, c?: string) => HTMLElement, name: (id: string) => string) {
    const g = GAMES[game];
    const lview = { ...view, names: Object.fromEntries(view.players.map((p: string) => [p, name(p)])) };
    const label = (m: any) => g.label?.(m, lview) ?? JSON.stringify(m);
    if (!legal.length) return add(this.panel, h("span.dim", null, "Ждём других…"));
    if (CLICK_GAMES.has(game)) {
      add(this.panel, h("span.dim", null, this.sel === null ? "Щёлкните свою фигуру, затем клетку" : "Куда ходим? Зелёные точки — доступные клетки"), ...legal.filter((m) => m.t === "resign").map((m) => btn(label(m), m, ".small")));
      if (game === "chess") {
        // promotions to a non-queen piece
        const promos = legal.filter((m) => m.promo && m.promo !== "q" && m.from === this.sel);
        add(this.panel, ...promos.map((m) => btn(label(m), m, ".small")));
      }
      return;
    }
    if (game === "generala") {
      const roll = legal.find((m) => m.t === "roll");
      if (roll) add(this.panel, btn(view.rolls ? `🎲 Перебросить (${this.keep.filter(Boolean).length} оставлено)` : "🎲 Бросить", { t: "roll", keep: view.rolls ? this.keep : [false, false, false, false, false] }, ".primary"));
      for (const m of legal.filter((x) => x.t === "score")) add(this.panel, btn(`${label(m)}: ${generalaScore(view.dice, m.cat, view.rolls === 1)}`, m, ".small"));
      return;
    }
    if (game === "cheat") {
      const doubt = legal.find((m) => m.t === "doubt");
      const sel = [...this.scene.multi];
      const needRank = !view.rank;
      if (needRank && !view.pickRanks?.includes(this.claim)) this.claim = view.pickRanks?.[0] ?? "6";
      add(
        this.panel,
        h("span.dim", null, sel.length ? `Выбрано: ${sel.map(cardName).join(" ")}` : "Выберите 1–4 карты щелчком"),
        needRank
          ? h(
              "select",
              { onchange: (e: Event) => ((this.claim = (e.target as HTMLSelectElement).value), (this.key = "")) },
              (view.pickRanks ?? []).map((r: string) => h("option", { value: r, selected: r === this.claim }, `как «${rankLabel(r)}»`)),
            )
          : null,
        h("button.primary", { disabled: !sel.length, onclick: () => this.send(needRank ? { t: "play", cards: sel, rank: this.claim } : { t: "play", cards: sel }) }, `🂠 Положить${needRank ? "" : ` как «${rankLabel(view.rank)}»`}`),
        doubt ? btn("🙅 Не верю!", doubt) : null,
      );
      return;
    }
    if (game === "backgammon") add(this.panel, h("span.dim", null, "Щёлкните лунку с шашкой, затем цель — или кнопку:"));
    const shown = legal.filter((m) => m.t !== "accuse" || view.phase === "day").slice(0, 24);
    add(this.panel, ...shown.map((m, i) => btn(label(m), m, i === 0 ? ".primary" : ".small")));
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
