import { Rng, type RngState } from "../rng";
import { HAND_NAMES, RANKS52, cardLabel, cmpVal, deck52, handValue, rank52, rankLabel } from "./cards";
import { deck36, RANKS, rankOf } from "./durak";
import { registerGame, type BoardGame, type GameResult } from "./framework";

const next = (players: string[], p: string, ok: (q: string) => boolean) => {
  const n = players.length;
  let i = players.indexOf(p);
  for (let k = 0; k < n; k++) {
    i = (i + 1) % n;
    if (ok(players[i])) return players[i];
  }
  return p;
};

// ================================================================ Пьяница (War)

interface DrunkState {
  players: string[];
  hands: Record<string, string[]>;
  flipped: Record<string, string>;
  contenders: string[];
  pile: string[];
  rounds: number;
  rng: RngState;
  last: string;
}

const MAX_DRUNK_ROUNDS = 250;

const drunkard: BoardGame<DrunkState, { t: "flip" }> = {
  id: "drunkard",
  name: "Пьяница",
  minPlayers: 2,
  maxPlayers: 4,
  setup(players, seed) {
    const rng = Rng.from(seed);
    const deck = rng.shuffle(deck52());
    const hands: Record<string, string[]> = {};
    players.forEach((p) => (hands[p] = []));
    deck.forEach((c, i) => hands[players[i % players.length]].push(c));
    return { players: [...players], hands, flipped: {}, contenders: [...players], pile: [], rounds: 0, rng: rng.s, last: "" };
  },
  toAct(s) {
    if (this.isOver(s)) return [];
    return s.contenders.filter((p) => !s.flipped[p] && s.hands[p].length);
  },
  legalMoves(s, p) {
    return this.toAct(s).includes(p) ? [{ t: "flip" }] : [];
  },
  applyMove(s, p) {
    const c = s.hands[p].shift()!;
    s.flipped[p] = c;
    s.pile.push(c);
    if (this.toAct(s).length) return;
    const vals = Object.entries(s.flipped);
    const best = Math.max(...vals.map(([, c]) => rank52(c)));
    const top = vals.filter(([, c]) => rank52(c) === best).map(([q]) => q);
    s.flipped = {};
    const rng = new Rng(s.rng);
    if (top.length === 1 || top.every((q) => s.hands[q].length === 0)) {
      const win = top.find((q) => s.hands[q].length) ?? top[0];
      s.hands[win].push(...rng.shuffle(s.pile));
      s.last = `${win} забирает ${s.pile.length}`;
      s.pile = [];
      s.contenders = s.players.filter((q) => s.hands[q].length);
      s.rounds++;
    } else {
      // war: tied players put one card face down, then flip again
      s.contenders = top.filter((q) => s.hands[q].length);
      for (const q of s.contenders) if (s.hands[q].length > 1) s.pile.push(s.hands[q].shift()!);
      s.last = "Спор!";
    }
  },
  viewFor(s) {
    const hands: Record<string, number> = {};
    for (const p of s.players) hands[p] = s.hands[p].length;
    return { players: s.players, counts: hands, flipped: s.flipped, pile: s.pile.length, war: s.contenders.length < s.players.filter((p) => s.hands[p].length).length, rounds: s.rounds, maxRounds: MAX_DRUNK_ROUNDS };
  },
  isOver(s) {
    return s.players.filter((p) => s.hands[p].length).length <= 1 || s.rounds >= MAX_DRUNK_ROUNDS;
  },
  result(s) {
    const sorted = [...s.players].sort((a, b) => s.hands[b].length - s.hands[a].length);
    const top = s.hands[sorted[0]].length;
    const winners = sorted.filter((p) => s.hands[p].length === top);
    return { winners, losers: sorted.filter((p) => !winners.includes(p)), draw: winners.length === s.players.length, text: `Больше всех карт: ${top}` };
  },
  botMove() {
    return { t: "flip" };
  },
  describe(s, p) {
    const c = s.flipped[p] ?? s.pile[s.pile.length - 1];
    return c ? `открывает ${cardLabel(c)}` : "";
  },
  label() {
    return "🂠 Открыть карту";
  },
};
registerGame(drunkard);

// ================================================================ Верю — не верю (Cheat)

interface CheatState {
  players: string[];
  hands: Record<string, string[]>;
  pile: string[];
  last: { by: string; cards: string[]; n: number } | null;
  rank: string | null;
  turn: string;
  pending: string | null; // played their last cards, waiting to see if anyone doubts
  out: string[];
  discard: string[];
  reveal: { cards: string[]; lie: boolean; taker: string } | null;
}

type CheatMove = { t: "play"; cards: string[]; rank?: string } | { t: "doubt" };

function dropQuads(s: CheatState, p: string) {
  const by: Record<string, string[]> = {};
  for (const c of s.hands[p]) (by[c[0]] ??= []).push(c);
  for (const r in by)
    if (by[r].length === 4) {
      s.hands[p] = s.hands[p].filter((c) => c[0] !== r);
      s.discard.push(r);
    }
}

function cheatActive(s: CheatState) {
  return s.players.filter((p) => !s.out.includes(p));
}

const cheat: BoardGame<CheatState, CheatMove> = {
  id: "cheat",
  name: "Верю — не верю",
  minPlayers: 2,
  maxPlayers: 6,
  setup(players, seed) {
    const rng = Rng.from(seed);
    const deck = rng.shuffle(deck36());
    const hands: Record<string, string[]> = {};
    players.forEach((p) => (hands[p] = []));
    deck.forEach((c, i) => hands[players[i % players.length]].push(c));
    const s: CheatState = { players: [...players], hands, pile: [], last: null, rank: null, turn: players[0], pending: null, out: [], discard: [], reveal: null };
    for (const p of players) dropQuads(s, p);
    return s;
  },
  toAct(s) {
    return this.isOver(s) ? [] : [s.turn];
  },
  isLegal(s, p, m) {
    if (p !== s.turn) return false;
    if (m.t === "doubt") return !!s.last && s.last.by !== p;
    if (m.t !== "play" || !Array.isArray(m.cards)) return false;
    if (m.cards.length < 1 || m.cards.length > 4 || new Set(m.cards).size !== m.cards.length) return false;
    if (!m.cards.every((c) => s.hands[p].includes(c))) return false;
    if (s.rank) return m.rank === undefined || m.rank === s.rank;
    return typeof m.rank === "string" && RANKS.includes(m.rank) && !s.discard.includes(m.rank);
  },
  legalMoves(s, p) {
    if (p !== s.turn || this.isOver(s)) return [];
    const out: CheatMove[] = [];
    if (s.last && s.last.by !== p) out.push({ t: "doubt" });
    const by: Record<string, string[]> = {};
    for (const c of s.hands[p]) (by[c[0]] ??= []).push(c);
    if (s.rank) {
      if (by[s.rank]) out.push({ t: "play", cards: by[s.rank] });
      for (const c of s.hands[p]) if (c[0] !== s.rank) out.push({ t: "play", cards: [c] });
    } else for (const r in by) out.push({ t: "play", cards: by[r], rank: r });
    return out;
  },
  applyMove(s, p, m) {
    s.reveal = null;
    if (m.t === "doubt") {
      const last = s.last!;
      const lie = last.cards.some((c) => c[0] !== s.rank);
      const taker = lie ? last.by : p;
      s.reveal = { cards: last.cards, lie, taker };
      s.hands[taker].push(...s.pile);
      s.pile = [];
      dropQuads(s, taker);
      if (s.pending && s.pending !== taker) s.out.push(s.pending);
      s.pending = null;
      s.last = null;
      s.rank = null;
      // quads may empty a hand: that player is out too
      for (const q of s.players) if (!s.out.includes(q) && !s.hands[q].length) s.out.push(q);
      if (this.isOver(s)) return;
      // the one who did not take starts the next round
      const starter = lie ? p : last.by;
      s.turn = s.out.includes(starter) ? next(s.players, starter, (q) => !s.out.includes(q)) : starter;
      if (s.hands[s.turn].length === 0) s.turn = next(s.players, s.turn, (q) => !s.out.includes(q) && s.hands[q].length > 0);
      return;
    }
    // play: a previous player who emptied their hand is now safe
    if (s.pending) {
      s.out.push(s.pending);
      s.pending = null;
    }
    if (!s.rank) s.rank = m.rank!;
    s.hands[p] = s.hands[p].filter((c) => !m.cards.includes(c));
    s.pile.push(...m.cards);
    s.last = { by: p, cards: [...m.cards], n: m.cards.length };
    if (!s.hands[p].length) s.pending = p;
    const nx = next(s.players, p, (q) => !s.out.includes(q) && q !== s.pending);
    s.turn = nx;
    // everyone else is out — the last one holding cards can only doubt
    if (nx === p) s.turn = p;
  },
  viewFor(s, viewer) {
    const counts: Record<string, number> = {};
    for (const p of s.players) counts[p] = s.hands[p].length;
    return {
      players: s.players,
      counts,
      hand: viewer && s.hands[viewer] ? [...s.hands[viewer]].sort((a, b) => rankOf(a) - rankOf(b)) : null,
      pile: s.pile.length,
      rank: s.rank,
      last: s.last ? { by: s.last.by, n: s.last.n } : null,
      turn: s.turn,
      out: s.out,
      discard: s.discard,
      reveal: s.reveal,
      pickRanks: s.rank ? null : RANKS.filter((r) => !s.discard.includes(r)),
    };
  },
  isOver(s) {
    return cheatActive(s).filter((p) => p !== s.pending).length <= 1 && !(s.pending && s.last);
  },
  result(s) {
    const left = cheatActive(s).filter((p) => s.hands[p].length > 0);
    const winners = s.out.length ? [s.out[0]] : s.players.filter((p) => !left.includes(p)).slice(0, 1);
    return { winners, losers: left, text: left.length ? `С картами остался ${left.join(", ")}` : "" };
  },
  botMove(s, p, skill, rng) {
    const hand = s.hands[p];
    if (s.last && s.last.by !== p && s.rank) {
      const mine = hand.filter((c) => c[0] === s.rank).length;
      const gone = s.discard.includes(s.rank) ? 4 : 0;
      const sureLie = s.last.n > 4 - mine - gone;
      const risk = s.pile.length > 8 ? 0.1 : 0.25;
      if (sureLie && rng.chance(0.4 + skill * 0.6)) return { t: "doubt" };
      if (s.pending === s.last.by) return { t: "doubt" };
      const honest = hand.filter((c) => c[0] === s.rank);
      if (!honest.length && rng.chance(risk + (1 - skill) * 0.2)) return { t: "doubt" };
      if (honest.length) return { t: "play", cards: honest };
      // bluff with 1 (sometimes 2) of the least useful cards
      const sorted = [...hand].sort((a, b) => hand.filter((x) => x[0] === a[0]).length - hand.filter((x) => x[0] === b[0]).length);
      return { t: "play", cards: sorted.slice(0, rng.chance(0.25) && sorted.length > 1 ? 2 : 1) };
    }
    const by: Record<string, string[]> = {};
    for (const c of hand) (by[c[0]] ??= []).push(c);
    const ranks = Object.keys(by).filter((r) => !s.discard.includes(r));
    if (!ranks.length) return null;
    const r = ranks.sort((a, b) => by[b].length - by[a].length)[0];
    const cards = [...by[r]];
    // sometimes slip in a stranger
    if (rng.chance(0.35) && cards.length < 4) {
      const extra = hand.find((c) => c[0] !== r);
      if (extra) cards.push(extra);
    }
    return { t: "play", cards, rank: r };
  },
  describe(s, p, m) {
    if (m.t === "doubt") return s.reveal ? `Не верю! ${s.reveal.lie ? "— и правда враньё" : "— а там всё честно"}` : "Не верю!";
    return `кладёт ${m.cards.length} × «${rankLabel(s.rank ?? m.rank ?? "?")}»`;
  },
  label(m, view) {
    if (m.t === "doubt") return "🙅 Не верю!";
    const r = m.rank ?? view?.rank;
    return `${m.cards.map(cardLabel).join(" ")} как «${rankLabel(r)}»`;
  },
};
registerGame(cheat);

// ================================================================ Texas Hold'em

interface PokerState {
  players: string[];
  chips: Record<string, number>;
  hands: Record<string, string[]>;
  board: string[];
  deck: string[];
  stage: number; // 0 pre-flop, 1 flop, 2 turn, 3 river
  bet: Record<string, number>;
  contrib: Record<string, number>;
  folded: string[];
  acted: Record<string, boolean>;
  cur: number;
  turn: string | null;
  dealer: number;
  hand: number;
  maxHands: number;
  blind: number;
  rng: RngState;
  shown: Record<string, string[]> | null;
  lastWin: string;
}

type PokerMove = { t: "fold" } | { t: "check" } | { t: "call" } | { t: "raise"; to: number };

function pkLive(s: PokerState) {
  return s.players.filter((p) => !s.folded.includes(p));
}
function pkCanAct(s: PokerState, p: string) {
  return !s.folded.includes(p) && s.chips[p] > 0;
}

function pkPutIn(s: PokerState, p: string, amt: number) {
  const a = Math.min(amt, s.chips[p]);
  s.chips[p] -= a;
  s.bet[p] += a;
  s.contrib[p] += a;
}

function pkDeal(s: PokerState) {
  const rng = new Rng(s.rng);
  s.deck = rng.shuffle(deck52());
  s.board = [];
  s.stage = 0;
  s.folded = s.players.filter((p) => s.chips[p] <= 0);
  s.shown = null;
  for (const p of s.players) {
    s.hands[p] = s.folded.includes(p) ? [] : [s.deck.pop()!, s.deck.pop()!];
    s.bet[p] = 0;
    s.contrib[p] = 0;
    s.acted[p] = false;
  }
  const seats = s.players.filter((p) => s.chips[p] > 0);
  do s.dealer = (s.dealer + 1) % s.players.length;
  while (s.chips[s.players[s.dealer]] <= 0);
  const d = s.players[s.dealer];
  const heads = seats.length === 2;
  const sb = heads ? d : next(s.players, d, (q) => s.chips[q] > 0);
  const bb = next(s.players, sb, (q) => s.chips[q] > 0);
  pkPutIn(s, sb, s.blind);
  pkPutIn(s, bb, s.blind * 2);
  s.cur = s.blind * 2;
  s.turn = next(s.players, bb, (q) => pkCanAct(s, q));
  s.hand++;
  pkMaybeAdvance(s);
}

function pkRoundDone(s: PokerState) {
  const can = s.players.filter((p) => pkCanAct(s, p));
  if (pkLive(s).length <= 1) return true;
  if (can.length === 0) return true;
  if (can.length === 1 && s.bet[can[0]] >= s.cur) return true;
  return can.every((p) => s.acted[p] && s.bet[p] === s.cur);
}

function pkMaybeAdvance(s: PokerState) {
  while (pkRoundDone(s)) {
    if (pkLive(s).length <= 1 || s.stage === 3) return pkShowdown(s);
    s.stage++;
    const n = s.stage === 1 ? 3 : 1;
    for (let i = 0; i < n; i++) s.board.push(s.deck.pop()!);
    for (const p of s.players) {
      s.bet[p] = 0;
      s.acted[p] = false;
    }
    s.cur = 0;
    s.turn = next(s.players, s.players[s.dealer], (q) => pkCanAct(s, q));
  }
}

function pkShowdown(s: PokerState) {
  // side pots by contribution levels
  const live = pkLive(s);
  const levels = [...new Set(s.players.map((p) => s.contrib[p]).filter((x) => x > 0))].sort((a, b) => a - b);
  let prev = 0;
  const won: Record<string, number> = {};
  const vals: Record<string, number[]> = {};
  if (live.length > 1) for (const p of live) vals[p] = handValue([...s.hands[p], ...s.board]);
  else vals[live[0]] = [0];
  for (const lv of levels) {
    const payers = s.players.filter((p) => s.contrib[p] >= lv);
    const pot = payers.length * (lv - prev);
    const elig = live.filter((p) => s.contrib[p] >= lv);
    prev = lv;
    if (!elig.length) continue;
    let best: string[] = [];
    for (const p of elig) {
      if (!best.length || cmpVal(vals[p], vals[best[0]]) > 0) best = [p];
      else if (cmpVal(vals[p], vals[best[0]]) === 0) best.push(p);
    }
    const each = Math.floor(pot / best.length);
    best.forEach((p, i) => (won[p] = (won[p] ?? 0) + each + (i === 0 ? pot - each * best.length : 0)));
  }
  for (const p in won) s.chips[p] += won[p];
  const top = Object.entries(won).sort((a, b) => b[1] - a[1])[0];
  s.shown = live.length > 1 ? Object.fromEntries(live.map((p) => [p, s.hands[p]])) : null;
  s.lastWin = top ? `${top[0]}|${top[1]}|${live.length > 1 ? HAND_NAMES[vals[top[0]][0]] : ""}` : "";
  s.turn = null;
  if (!pokerOver(s)) pkDeal(s);
}

function pokerOver(s: PokerState) {
  return s.players.filter((p) => s.chips[p] > 0).length <= 1 || (s.hand >= s.maxHands && s.turn === null);
}

const poker: BoardGame<PokerState, PokerMove> = {
  id: "poker",
  name: "Покер (техасский)",
  minPlayers: 2,
  maxPlayers: 6,
  options: { hands: { label: "Раздач", values: [[8, "8 раздач"], [15, "15 раздач"], [99, "до последней фишки"]] } },
  setup(players, seed, opts = {}) {
    const rng = Rng.from(seed);
    const s: PokerState = {
      players: [...players],
      chips: Object.fromEntries(players.map((p) => [p, 100])),
      hands: {},
      board: [],
      deck: [],
      stage: 0,
      bet: {},
      contrib: {},
      folded: [],
      acted: {},
      cur: 0,
      turn: null,
      dealer: players.length - 1,
      hand: 0,
      maxHands: Number(opts.hands) || 8,
      blind: 2,
      rng: rng.s,
      shown: null,
      lastWin: "",
    };
    pkDeal(s);
    return s;
  },
  toAct(s) {
    return s.turn && !this.isOver(s) ? [s.turn] : [];
  },
  legalMoves(s, p) {
    if (s.turn !== p) return [];
    const toCall = s.cur - s.bet[p];
    const out: PokerMove[] = [];
    out.push(toCall > 0 ? { t: "call" } : { t: "check" });
    const stack = s.chips[p] + s.bet[p];
    const minTo = Math.max(s.cur + s.blind * 2, s.cur * 2);
    const pot = s.players.reduce((a, q) => a + s.contrib[q], 0);
    const cands = new Set([minTo, s.cur + Math.max(pot, s.blind * 2), stack]);
    if (stack > s.cur) for (const to of cands) if (to <= stack && to > s.cur) out.push({ t: "raise", to });
    if (toCall > 0) out.push({ t: "fold" });
    return out;
  },
  applyMove(s, p, m) {
    if (m.t === "fold") s.folded.push(p);
    else if (m.t === "call") pkPutIn(s, p, s.cur - s.bet[p]);
    else if (m.t === "raise") {
      pkPutIn(s, p, m.to - s.bet[p]);
      s.cur = Math.max(s.cur, s.bet[p]);
      for (const q of s.players) if (q !== p) s.acted[q] = false;
    }
    s.acted[p] = true;
    s.turn = next(s.players, p, (q) => pkCanAct(s, q));
    pkMaybeAdvance(s);
  },
  viewFor(s, viewer) {
    const hands: Record<string, string[] | number> = {};
    for (const p of s.players) hands[p] = p === viewer || s.shown?.[p] ? s.hands[p] : s.hands[p].length;
    return {
      players: s.players,
      chips: s.chips,
      bet: s.bet,
      pot: s.players.reduce((a, q) => a + s.contrib[q], 0),
      board: s.board,
      hands,
      folded: s.folded,
      turn: s.turn,
      cur: s.cur,
      dealer: s.players[s.dealer],
      hand: s.hand,
      maxHands: s.maxHands,
      lastWin: s.lastWin,
      shown: s.shown,
      best: viewer && s.hands[viewer]?.length ? HAND_NAMES[handValue([...s.hands[viewer], ...s.board])[0]] : null,
    };
  },
  isOver(s) {
    return pokerOver(s) && s.turn === null;
  },
  result(s) {
    const max = Math.max(...s.players.map((p) => s.chips[p]));
    const winners = s.players.filter((p) => s.chips[p] === max);
    return { winners, losers: s.players.filter((p) => !winners.includes(p)), text: `Фишки: ${s.players.map((p) => s.chips[p]).join(" / ")}` };
  },
  botMove(s, p, skill, rng) {
    const legal = this.legalMoves(s, p);
    const cards = [...s.hands[p], ...s.board];
    let str: number;
    if (s.stage === 0) {
      const [a, b] = s.hands[p].map(rank52);
      str = (a + b) / 24 + (a === b ? 0.35 : 0) + (s.hands[p][0][1] === s.hands[p][1][1] ? 0.08 : 0);
    } else {
      const v = handValue(cards);
      str = v[0] / 4 + (v[1] ?? 0) / 40;
    }
    str += rng.range(-0.25, 0.25) * (1.2 - skill);
    const toCall = s.cur - s.bet[p];
    const raises = legal.filter((m): m is { t: "raise"; to: number } => m.t === "raise");
    if (str > 0.85 && raises.length) return rng.chance(0.2) ? raises[raises.length - 1] : raises[0];
    if (toCall === 0) return str > 0.6 && raises.length && rng.chance(0.4) ? raises[0] : { t: "check" };
    const potOdds = toCall / (toCall + s.players.reduce((a, q) => a + s.contrib[q], 0));
    if (str > potOdds + 0.25 || toCall <= s.blind) return { t: "call" };
    return rng.chance(0.08) && raises.length ? raises[0] : { t: "fold" };
  },
  describe(s, p, m) {
    if (m.t === "raise") return `поднимает до ${m.to}`;
    return { fold: "пас", check: "чек", call: "уравнивает" }[m.t];
  },
  label(m, view) {
    if (m.t === "fold") return "🏳 Пас";
    if (m.t === "check") return "✔ Чек";
    if (m.t === "call") return `📞 Колл ${view ? view.cur - (view.bet?.[view.turn] ?? 0) : ""}`;
    const stack = view ? view.chips[view.turn] + view.bet[view.turn] : 0;
    return m.to === stack ? `💥 Ва-банк (${m.to})` : `⬆ Рейз до ${m.to}`;
  },
};
registerGame(poker);

export { RANKS52 };
export type { GameResult };
