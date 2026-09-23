import { Rng, type RngState } from "../rng";
import { registerGame, type BoardGame } from "./framework";

const nextOf = (players: string[], p: string, ok: (q: string) => boolean = () => true) => {
  const n = players.length;
  let i = players.indexOf(p);
  for (let k = 0; k < n; k++) {
    i = (i + 1) % n;
    if (ok(players[i])) return players[i];
  }
  return p;
};

// ================================================================ Генерал (dice poker)

export const GENERALA_CATS: [string, string][] = [
  ["1", "Единицы"],
  ["2", "Двойки"],
  ["3", "Тройки"],
  ["4", "Четвёрки"],
  ["5", "Пятёрки"],
  ["6", "Шестёрки"],
  ["straight", "Стрит"],
  ["full", "Фулл"],
  ["four", "Каре"],
  ["generala", "Генерал"],
];

export function generalaScore(dice: number[], cat: string, first: boolean): number {
  const cnt = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dice) cnt[d]++;
  const n = Number(cat);
  if (n >= 1 && n <= 6) return cnt[n] * n;
  const sorted = [...dice].sort().join("");
  const bonus = first ? 5 : 0;
  if (cat === "straight") return ["12345", "23456", "13456"].includes(sorted) ? 20 + bonus : 0;
  if (cat === "full") return cnt.includes(3) && cnt.includes(2) ? 30 + bonus : 0;
  if (cat === "four") return cnt.some((c) => c >= 4) ? 40 + bonus : 0;
  if (cat === "generala") return cnt.includes(5) ? (first ? 80 : 50) : 0;
  return 0;
}

interface GeneralaState {
  players: string[];
  turn: string;
  dice: number[];
  rolls: number;
  sheet: Record<string, Record<string, number>>;
  rng: RngState;
  last: string;
}

type GeneralaMove = { t: "roll"; keep: boolean[] } | { t: "score"; cat: string };

const generala: BoardGame<GeneralaState, GeneralaMove> = {
  id: "generala",
  name: "Генерал (кости)",
  minPlayers: 1,
  maxPlayers: 6,
  setup(players, seed) {
    const rng = Rng.from(seed);
    const s: GeneralaState = { players: [...players], turn: players[0], dice: [0, 0, 0, 0, 0], rolls: 0, sheet: {}, rng: rng.s, last: "" };
    for (const p of players) s.sheet[p] = {};
    return s;
  },
  toAct(s) {
    return this.isOver(s) ? [] : [s.turn];
  },
  isLegal(s, p, m) {
    if (m.t === "roll") return s.rolls < 3 && Array.isArray(m.keep) && m.keep.length === 5 && (s.rolls > 0 || m.keep.every((k) => !k)) && !m.keep.every((k) => k === true);
    return s.rolls > 0 && GENERALA_CATS.some(([c]) => c === m.cat) && s.sheet[p][m.cat] === undefined;
  },
  legalMoves(s, p) {
    if (p !== s.turn || this.isOver(s)) return [];
    const out: GeneralaMove[] = [];
    if (s.rolls < 3) out.push({ t: "roll", keep: [false, false, false, false, false] });
    if (s.rolls > 0) for (const [c] of GENERALA_CATS) if (s.sheet[p][c] === undefined) out.push({ t: "score", cat: c });
    return out;
  },
  applyMove(s, p, m) {
    if (m.t === "roll") {
      const rng = new Rng(s.rng);
      s.dice = s.dice.map((d, i) => (m.keep[i] && s.rolls > 0 ? d : rng.int(1, 6)));
      s.rolls++;
      s.last = `бросает: ${s.dice.join(" ")}`;
      return;
    }
    const pts = generalaScore(s.dice, m.cat, s.rolls === 1);
    s.sheet[p][m.cat] = pts;
    s.last = `${GENERALA_CATS.find(([c]) => c === m.cat)![1]}: ${pts}`;
    s.rolls = 0;
    s.dice = [0, 0, 0, 0, 0];
    s.turn = nextOf(s.players, p);
  },
  viewFor(s) {
    const totals: Record<string, number> = {};
    for (const p of s.players) totals[p] = Object.values(s.sheet[p]).reduce((a, b) => a + b, 0);
    return { players: s.players, turn: s.turn, dice: s.dice, rolls: s.rolls, sheet: s.sheet, totals, cats: GENERALA_CATS };
  },
  isOver(s) {
    return s.players.every((p) => Object.keys(s.sheet[p]).length === GENERALA_CATS.length);
  },
  result(s) {
    const tot = (p: string) => Object.values(s.sheet[p]).reduce((a, b) => a + b, 0);
    const max = Math.max(...s.players.map(tot));
    const winners = s.players.filter((p) => tot(p) === max);
    return { winners, losers: s.players.filter((p) => !winners.includes(p)), draw: winners.length > 1 && winners.length === s.players.length, text: `Очки: ${s.players.map(tot).join(" / ")}` };
  },
  botMove(s, p, skill, rng) {
    const free = GENERALA_CATS.map(([c]) => c).filter((c) => s.sheet[p][c] === undefined);
    if (s.rolls === 0) return { t: "roll", keep: [false, false, false, false, false] };
    const value = (c: string) => {
      const sc = generalaScore(s.dice, c, s.rolls === 1);
      const n = Number(c);
      return n ? sc - n * 3 + (sc >= n * 3 ? 6 : 0) : sc;
    };
    const best = [...free].sort((a, b) => value(b) - value(a))[0];
    const bestV = value(best);
    if (s.rolls < 3 && bestV < 25 + skill * 10) {
      // keep the most common face (or a run for straights)
      const cnt = [0, 0, 0, 0, 0, 0, 0];
      for (const d of s.dice) cnt[d]++;
      let face = 6;
      for (let f = 6; f >= 1; f--) if (cnt[f] > cnt[face]) face = f;
      const runWanted = free.includes("straight") && new Set(s.dice).size >= 4 && rng.chance(0.3 + skill * 0.4);
      const seen = new Set<number>();
      const keep = s.dice.map((d) => {
        if (runWanted) {
          if (seen.has(d)) return false;
          seen.add(d);
          return d >= 2 && d <= 5;
        }
        return d === face && cnt[face] >= 2;
      });
      if (!keep.every((k) => k)) return { t: "roll", keep };
    }
    if (bestV <= 0 && skill > 0.4) {
      // sacrifice the least valuable box
      const order = ["1", "generala", "2", "four", "3", "straight", "full", "4", "5", "6"];
      const z = order.find((c) => free.includes(c) && generalaScore(s.dice, c, false) === 0);
      if (z) return { t: "score", cat: z };
    }
    return { t: "score", cat: best };
  },
  describe(s) {
    return s.last;
  },
  label(m) {
    if (m.t === "roll") return "🎲 Бросить";
    return "✎ " + (GENERALA_CATS.find(([c]) => c === m.cat)?.[1] ?? m.cat);
  },
};
registerGame(generala);

// ================================================================ Домино

type Tile = [number, number];

interface DominoState {
  players: string[];
  hands: Record<string, Tile[]>;
  bazaar: Tile[];
  line: Tile[];
  turn: string;
  passes: number;
  over: boolean;
  winner: string | null;
  last: string;
}

type DominoMove = { t: "play"; tile: Tile; end: "L" | "R" } | { t: "draw" } | { t: "pass" };

const sameTile = (a: Tile, b: Tile) => (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);
const pips = (h: Tile[]) => h.reduce((a, t) => a + t[0] + t[1], 0);

function dominoMoves(s: DominoState, p: string): DominoMove[] {
  const out: DominoMove[] = [];
  const hand = s.hands[p];
  if (!s.line.length) {
    for (const t of hand) out.push({ t: "play", tile: t, end: "R" });
    return out;
  }
  const L = s.line[0][0],
    R = s.line[s.line.length - 1][1];
  for (const t of hand) {
    if (t[0] === L || t[1] === L) out.push({ t: "play", tile: t, end: "L" });
    if ((t[0] === R || t[1] === R) && !(L === R && (t[0] === L || t[1] === L) && t[0] === t[1])) out.push({ t: "play", tile: t, end: "R" });
  }
  if (!out.length) out.push(s.bazaar.length ? { t: "draw" } : { t: "pass" });
  return out;
}

const domino: BoardGame<DominoState, DominoMove> = {
  id: "domino",
  name: "Домино",
  minPlayers: 2,
  maxPlayers: 4,
  setup(players, seed) {
    const rng = Rng.from(seed);
    const set: Tile[] = [];
    for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) set.push([a, b]);
    rng.shuffle(set);
    const hands: Record<string, Tile[]> = {};
    for (const p of players) hands[p] = set.splice(0, 7);
    // first: highest double, else highest tile
    let first = players[0],
      best = -1;
    for (const p of players)
      for (const t of hands[p]) {
        const v = t[0] === t[1] ? 100 + t[0] : t[0] + t[1];
        if (v > best) {
          best = v;
          first = p;
        }
      }
    return { players: [...players], hands, bazaar: set, line: [], turn: first, passes: 0, over: false, winner: null, last: "" };
  },
  toAct(s) {
    return s.over ? [] : [s.turn];
  },
  legalMoves(s, p) {
    return p === s.turn && !s.over ? dominoMoves(s, p) : [];
  },
  applyMove(s, p, m) {
    if (m.t === "draw") {
      s.hands[p].push(s.bazaar.pop()!);
      s.last = "идёт на базар";
      return; // same player continues
    }
    if (m.t === "pass") {
      s.passes++;
      s.last = "пропускает";
      if (s.passes >= s.players.length) {
        // "рыба": fewest pips wins
        s.over = true;
        s.winner = [...s.players].sort((a, b) => pips(s.hands[a]) - pips(s.hands[b]))[0];
        s.last = "Рыба!";
      } else s.turn = nextOf(s.players, p);
      return;
    }
    s.passes = 0;
    s.hands[p] = s.hands[p].filter((t) => !sameTile(t, m.tile));
    const [a, b] = m.tile;
    if (!s.line.length) s.line.push([a, b]);
    else if (m.end === "L") {
      const L = s.line[0][0];
      s.line.unshift(b === L ? [a, b] : [b, a]);
    } else {
      const R = s.line[s.line.length - 1][1];
      s.line.push(a === R ? [a, b] : [b, a]);
    }
    s.last = `кладёт [${a}|${b}]`;
    if (!s.hands[p].length) {
      s.over = true;
      s.winner = p;
      s.last = "Готово! Руки пусты";
    } else s.turn = nextOf(s.players, p);
  },
  viewFor(s, viewer) {
    const hands: Record<string, Tile[] | number> = {};
    for (const p of s.players) hands[p] = p === viewer || s.over ? s.hands[p] : s.hands[p].length;
    return { players: s.players, hands, line: s.line, bazaar: s.bazaar.length, turn: s.turn, winner: s.winner };
  },
  isOver(s) {
    return s.over;
  },
  result(s) {
    const w = s.winner!;
    const score = s.players.filter((p) => p !== w).reduce((a, p) => a + pips(s.hands[p]), 0);
    return { winners: [w], losers: s.players.filter((p) => p !== w), text: `Очки в руках соперников: ${score}` };
  },
  botMove(s, p, skill, rng) {
    const legal = dominoMoves(s, p);
    const plays = legal.filter((m): m is Extract<DominoMove, { t: "play" }> => m.t === "play");
    if (!plays.length) return legal[0];
    if (rng.chance(1 - skill)) return rng.pick(plays);
    // dump heavy tiles and doubles first
    return plays.sort((a, b) => b.tile[0] + b.tile[1] + (b.tile[0] === b.tile[1] ? 6 : 0) - (a.tile[0] + a.tile[1] + (a.tile[0] === a.tile[1] ? 6 : 0)))[0];
  },
  describe(s) {
    return s.last;
  },
  label(m) {
    if (m.t === "draw") return "🛒 На базар";
    if (m.t === "pass") return "✋ Пропуск";
    return `[${m.tile[0]}|${m.tile[1]}] ${m.end === "L" ? "← слева" : "справа →"}`;
  },
};
registerGame(domino);

// ================================================================ Длинные нарды

interface NardyState {
  players: string[]; // [white, black]
  cnt: Record<string, number[]>; // checkers per relative position 0..23
  off: Record<string, number>;
  turn: string;
  dice: number[]; // remaining dice this turn
  rolled: number[];
  headUsed: number;
  firstTurn: Record<string, boolean>;
  rng: RngState;
  last: string;
}

type NardyMove = { t: "move"; from: number; die: number } | { t: "pass" };

/** absolute board point of a player's relative position */
export const nardyAbs = (s: NardyState, p: string, pos: number) => (p === s.players[0] ? pos : (pos + 12) % 24);

function nardyOpp(s: NardyState, p: string) {
  return s.players[0] === p ? s.players[1] : s.players[0];
}

function nardyBlocked(s: NardyState, p: string, pos: number) {
  const o = nardyOpp(s, p);
  const abs = nardyAbs(s, p, pos);
  const opos = (abs - nardyAbs(s, o, 0) + 24) % 24;
  return s.cnt[o][opos] > 0;
}

function allHome(s: NardyState, p: string) {
  return s.cnt[p].slice(0, 18).every((n) => n === 0);
}

function nardySingle(s: NardyState, p: string): { from: number; die: number }[] {
  const out: { from: number; die: number }[] = [];
  const dice = [...new Set(s.dice)];
  const headMax = s.firstTurn[p] && s.rolled[0] === s.rolled[1] && [3, 4, 6].includes(s.rolled[0]) ? 2 : 1;
  for (const d of dice)
    for (let pos = 0; pos < 24; pos++) {
      if (!s.cnt[p][pos]) continue;
      if (pos === 0 && s.headUsed >= headMax) continue;
      const to = pos + d;
      if (to < 24) {
        if (!nardyBlocked(s, p, to)) out.push({ from: pos, die: d });
      } else if (allHome(s, p)) {
        const farthest = s.cnt[p].findIndex((n) => n > 0);
        if (to === 24 || pos === farthest) out.push({ from: pos, die: d });
      }
    }
  return out;
}

function nardyApply(s: NardyState, p: string, from: number, die: number) {
  s.cnt[p][from]--;
  if (from === 0) s.headUsed++;
  const to = from + die;
  if (to >= 24) s.off[p]++;
  else s.cnt[p][to]++;
  s.dice.splice(s.dice.indexOf(die), 1);
}

function nardyLite(s: NardyState): NardyState {
  return { ...s, cnt: { [s.players[0]]: [...s.cnt[s.players[0]]], [s.players[1]]: [...s.cnt[s.players[1]]] }, off: { ...s.off }, dice: [...s.dice] };
}

/** Max number of dice that can still be used (rule: use as many dice as possible, the larger die if only one). */
function nardyDepth(s: NardyState, p: string): number {
  if (!s.dice.length || s.off[p] === 15) return 0;
  let best = 0;
  for (const m of nardySingle(s, p)) {
    const c = nardyLite(s);
    nardyApply(c, p, m.from, m.die);
    best = Math.max(best, 1 + nardyDepth(c, p));
    if (best === s.dice.length) break;
  }
  return best;
}

let nardyCache: { key: string; moves: NardyMove[] } | null = null;

function nardyLegal(s: NardyState, p: string): NardyMove[] {
  const key = JSON.stringify([p, s.cnt, s.dice, s.headUsed, s.firstTurn, s.rolled]);
  if (nardyCache?.key === key) return nardyCache.moves;
  const singles = nardySingle(s, p);
  let res: NardyMove[];
  if (!singles.length) res = [{ t: "pass" }];
  else {
    const depth = nardyDepth(s, p);
    let ok = singles.filter((m) => {
      const c = nardyLite(s);
      nardyApply(c, p, m.from, m.die);
      return 1 + nardyDepth(c, p) === depth;
    });
    if (depth === 1 && s.dice.length === 2 && s.dice[0] !== s.dice[1]) {
      const big = Math.max(...ok.map((m) => m.die));
      ok = ok.filter((m) => m.die === big);
    }
    res = ok.map((m) => ({ t: "move", ...m }));
  }
  nardyCache = { key, moves: res };
  return res;
}

function nardyRoll(s: NardyState) {
  const rng = new Rng(s.rng);
  const a = rng.int(1, 6),
    b = rng.int(1, 6);
  s.rolled = [a, b];
  s.dice = a === b ? [a, a, a, a] : [a, b];
  s.headUsed = 0;
}

const backgammon: BoardGame<NardyState, NardyMove> = {
  id: "backgammon",
  name: "Длинные нарды",
  minPlayers: 2,
  maxPlayers: 2,
  setup(players, seed) {
    const rng = Rng.from(seed);
    const s: NardyState = {
      players: players.slice(0, 2),
      cnt: {},
      off: {},
      turn: players[0],
      dice: [],
      rolled: [],
      headUsed: 0,
      firstTurn: {},
      rng: rng.s,
      last: "",
    };
    for (const p of s.players) {
      s.cnt[p] = Array(24).fill(0);
      s.cnt[p][0] = 15;
      s.off[p] = 0;
      s.firstTurn[p] = true;
    }
    nardyRoll(s);
    return s;
  },
  toAct(s) {
    return this.isOver(s) ? [] : [s.turn];
  },
  legalMoves(s, p) {
    return p === s.turn && !this.isOver(s) ? nardyLegal(s, p) : [];
  },
  applyMove(s, p, m) {
    if (m.t === "move") {
      nardyApply(s, p, m.from, m.die);
      s.last = `${m.from + 1} → ${m.from + m.die >= 24 ? "выброс" : m.from + m.die + 1}`;
    } else s.last = "нет хода";
    if (s.off[p] === 15) return;
    if (m.t === "pass" || !s.dice.length || nardySingle(s, p).length === 0) {
      s.firstTurn[p] = false;
      s.turn = nardyOpp(s, p);
      nardyRoll(s);
    }
  },
  viewFor(s) {
    // absolute board: +n white, -n black
    const board = Array(24).fill(0);
    for (let pos = 0; pos < 24; pos++) {
      board[nardyAbs(s, s.players[0], pos)] += s.cnt[s.players[0]][pos];
      board[nardyAbs(s, s.players[1], pos)] -= s.cnt[s.players[1]][pos];
    }
    return { players: s.players, board, off: s.off, turn: s.turn, dice: s.dice, rolled: s.rolled };
  },
  isOver(s) {
    return s.players.some((p) => s.off[p] === 15);
  },
  result(s) {
    const w = s.players.find((p) => s.off[p] === 15)!;
    const l = nardyOpp(s, w);
    return { winners: [w], losers: [l], text: s.off[l] === 0 ? "Марс!" : "Ойн" };
  },
  botMove(s, p, skill, rng) {
    const legal = nardyLegal(s, p);
    if (legal[0].t === "pass") return legal[0];
    if (rng.chance(0.6 - skill * 0.5)) return rng.pick(legal);
    // prefer bearing off, then advancing the rearmost checkers, making points
    const score = (m: NardyMove) => {
      if (m.t !== "move") return 0;
      const to = m.from + m.die;
      if (to >= 24) return 100;
      let v = (24 - m.from) * 0.5 + (m.from === 0 ? 4 : 0);
      if (s.cnt[p][to] > 0) v += 3;
      if (s.cnt[p][m.from] === 2) v -= 2;
      return v;
    };
    return legal.sort((a, b) => score(b) - score(a))[0];
  },
  describe(s) {
    return s.last;
  },
  label(m) {
    if (m.t === "pass") return "✋ Хода нет";
    const to = m.from + m.die;
    return `${m.from + 1} → ${to >= 24 ? "⤴" : to + 1} (${m.die})`;
  },
};
registerGame(backgammon);

// ================================================================ Лото «Бочонки»

export const KEG_NAMES: Record<number, string> = {
  1: "кол",
  7: "кочерга",
  8: "крендель",
  11: "барабанные палочки",
  13: "чёртова дюжина",
  22: "гуси-лебеди",
  25: "опять двадцать пять",
  33: "кудри",
  44: "стульчики",
  48: "половинку просим",
  55: "перчатки",
  66: "валенки",
  69: "туда-сюда",
  77: "топорики",
  80: "бабушка",
  88: "бабушкины очки",
  89: "дедушкин сосед",
  90: "дедушка",
};

interface LottoState {
  players: string[];
  cards: Record<string, number[][]>; // 3 rows × 5 numbers
  marks: Record<string, number[]>;
  bag: number[];
  drawn: number[];
  turn: string;
  goal: "row" | "card";
  winners: string[];
}

function lottoCard(rng: Rng): number[][] {
  // 3 rows × 9 columns, 5 numbers per row, column c holds c*10..c*10+9 (1..90)
  const rows: number[][] = [];
  const used = new Set<number>();
  for (let r = 0; r < 3; r++) {
    const cols = rng.shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8]).slice(0, 5).sort((a, b) => a - b);
    const row: number[] = [];
    for (const c of cols) {
      let n: number;
      do n = c === 0 ? rng.int(1, 9) : c === 8 ? rng.int(80, 90) : rng.int(c * 10, c * 10 + 9);
      while (used.has(n));
      used.add(n);
      row.push(n);
    }
    rows.push(row);
  }
  return rows;
}

function lottoDone(s: LottoState, p: string) {
  const got = (row: number[]) => row.every((n) => s.drawn.includes(n));
  return s.goal === "row" ? s.cards[p].some(got) : s.cards[p].every(got);
}

const lotto: BoardGame<LottoState, { t: "draw" }> = {
  id: "lotto",
  name: "Лото «Бочонки»",
  minPlayers: 2,
  maxPlayers: 6,
  options: { goal: { label: "До", values: [["row", "первой полной строки"], ["card", "полной карточки"]] } },
  setup(players, seed, opts = {}) {
    const rng = Rng.from(seed);
    const bag = rng.shuffle(Array.from({ length: 90 }, (_, i) => i + 1));
    const cards: Record<string, number[][]> = {};
    for (const p of players) cards[p] = lottoCard(rng);
    return { players: [...players], cards, marks: {}, bag, drawn: [], turn: players[0], goal: opts.goal === "card" ? "card" : "row", winners: [] };
  },
  toAct(s) {
    return this.isOver(s) ? [] : [s.turn];
  },
  legalMoves(s, p) {
    return p === s.turn && !this.isOver(s) ? [{ t: "draw" }] : [];
  },
  applyMove(s, p) {
    const n = s.bag.pop()!;
    s.drawn.push(n);
    s.winners = s.players.filter((q) => lottoDone(s, q));
    s.turn = nextOf(s.players, p);
  },
  viewFor(s) {
    return { players: s.players, cards: s.cards, drawn: s.drawn, last: s.drawn[s.drawn.length - 1] ?? null, lastName: KEG_NAMES[s.drawn[s.drawn.length - 1]] ?? null, turn: s.turn, goal: s.goal };
  },
  isOver(s) {
    return s.winners.length > 0 || !s.bag.length;
  },
  result(s) {
    return { winners: s.winners, losers: s.players.filter((p) => !s.winners.includes(p)), draw: !s.winners.length, text: `Бочонков: ${s.drawn.length}` };
  },
  botMove() {
    return { t: "draw" };
  },
  describe(s) {
    const n = s.drawn[s.drawn.length - 1];
    return n ? `тянет бочонок: ${n}${KEG_NAMES[n] ? ` — «${KEG_NAMES[n]}»!` : ""}` : "";
  },
  label() {
    return "🛢 Тянуть бочонок";
  },
};
registerGame(lotto);

// ================================================================ «Бункер-Магнат»

export const MAGNATE_BOARD: { name: string; kind: "start" | "prop" | "tax" | "aid" | "jail" | "chance"; price?: number; rent?: number; group?: number }[] = [
  { name: "Старт", kind: "start" },
  { name: "Кладовка", kind: "prop", price: 20, rent: 4, group: 0 },
  { name: "Колодец", kind: "prop", price: 22, rent: 5, group: 0 },
  { name: "Радиация", kind: "tax" },
  { name: "Мастерская", kind: "prop", price: 30, rent: 7, group: 1 },
  { name: "Кузня", kind: "prop", price: 32, rent: 8, group: 1 },
  { name: "Карцер", kind: "jail" },
  { name: "Теплица", kind: "prop", price: 40, rent: 10, group: 2 },
  { name: "Гуманитарка", kind: "aid" },
  { name: "Грибная ферма", kind: "prop", price: 42, rent: 11, group: 2 },
  { name: "Радиорубка", kind: "prop", price: 50, rent: 13, group: 3 },
  { name: "Слухи", kind: "chance" },
  { name: "Лазарет", kind: "prop", price: 52, rent: 14, group: 3 },
  { name: "Радиация", kind: "tax" },
  { name: "Арсенал", kind: "prop", price: 60, rent: 16, group: 4 },
  { name: "Оружейка", kind: "prop", price: 64, rent: 18, group: 4 },
  { name: "Гуманитарка", kind: "aid" },
  { name: "Шлюз", kind: "prop", price: 70, rent: 20, group: 5 },
  { name: "Слухи", kind: "chance" },
  { name: "Ковчег", kind: "prop", price: 80, rent: 25, group: 5 },
];

interface MagnateState {
  players: string[];
  pos: Record<string, number>;
  money: Record<string, number>;
  owner: Record<number, string>;
  level: Record<number, number>;
  jail: Record<string, number>;
  bankrupt: string[];
  turn: string;
  phase: "roll" | "buy" | "build";
  dice: number[];
  round: number;
  maxRounds: number;
  rng: RngState;
  last: string;
}

type MagnateMove = { t: "roll" } | { t: "buy" } | { t: "skip" } | { t: "build"; cell: number } | { t: "end" };

function mgRent(s: MagnateState, cell: number) {
  const c = MAGNATE_BOARD[cell];
  const own = s.owner[cell];
  const full = MAGNATE_BOARD.every((x, i) => x.group !== c.group || s.owner[i] === own);
  return (c.rent ?? 0) * (full ? 2 : 1) * (1 + (s.level[cell] ?? 0) * 1.5);
}

function mgBuildable(s: MagnateState, p: string) {
  const out: number[] = [];
  MAGNATE_BOARD.forEach((c, i) => {
    if (c.kind !== "prop" || s.owner[i] !== p || (s.level[i] ?? 0) >= 3) return;
    const full = MAGNATE_BOARD.every((x, j) => x.group !== c.group || s.owner[j] === p);
    if (full && s.money[p] >= Math.ceil(c.price! / 2)) out.push(i);
  });
  return out;
}

function mgPay(s: MagnateState, p: string, amt: number, to?: string) {
  const paid = Math.min(amt, s.money[p]);
  s.money[p] -= amt;
  if (to) s.money[to] += paid;
  if (s.money[p] < 0) {
    s.bankrupt.push(p);
    for (const k in s.owner)
      if (s.owner[k] === p) {
        delete s.owner[k];
        delete s.level[k];
      }
    s.money[p] = 0;
  }
}

function mgNextTurn(s: MagnateState, p: string) {
  const nx = nextOf(s.players, p, (q) => !s.bankrupt.includes(q));
  if (s.players.indexOf(nx) <= s.players.indexOf(p)) s.round++;
  s.turn = nx;
  s.phase = "roll";
}

const magnate: BoardGame<MagnateState, MagnateMove> = {
  id: "magnate",
  name: "«Бункер-Магнат»",
  minPlayers: 2,
  maxPlayers: 6,
  options: { rounds: { label: "Кругов", values: [[10, "10 кругов"], [20, "20 кругов"]] } },
  setup(players, seed, opts = {}) {
    const rng = Rng.from(seed);
    return {
      players: [...players],
      pos: Object.fromEntries(players.map((p) => [p, 0])),
      money: Object.fromEntries(players.map((p) => [p, 150])),
      owner: {},
      level: {},
      jail: {},
      bankrupt: [],
      turn: players[0],
      phase: "roll",
      dice: [],
      round: 1,
      maxRounds: Number(opts.rounds) || 10,
      rng: rng.s,
      last: "",
    };
  },
  toAct(s) {
    return this.isOver(s) ? [] : [s.turn];
  },
  legalMoves(s, p) {
    if (p !== s.turn || this.isOver(s)) return [];
    if (s.phase === "roll") return [{ t: "roll" }];
    if (s.phase === "buy") {
      const c = MAGNATE_BOARD[s.pos[p]];
      return s.money[p] >= c.price! ? [{ t: "buy" }, { t: "skip" }] : [{ t: "skip" }];
    }
    return [...mgBuildable(s, p).map((cell) => ({ t: "build" as const, cell })), { t: "end" }];
  },
  applyMove(s, p, m) {
    const rng = new Rng(s.rng);
    if (m.t === "roll") {
      if (s.jail[p]) {
        s.jail[p]--;
        s.last = "сидит в карцере";
        s.phase = "build";
        return;
      }
      s.dice = [rng.int(1, 6), rng.int(1, 6)];
      const from = s.pos[p];
      const to = (from + s.dice[0] + s.dice[1]) % MAGNATE_BOARD.length;
      s.pos[p] = to;
      if (to < from) s.money[p] += 20;
      const c = MAGNATE_BOARD[to];
      s.last = `${s.dice.join("+")} → ${c.name}`;
      s.phase = "build";
      if (c.kind === "prop") {
        const own = s.owner[to];
        if (!own) s.phase = "buy";
        else if (own !== p) {
          const r = Math.round(mgRent(s, to));
          mgPay(s, p, r, own);
          s.last += `, платит ${r}`;
        }
      } else if (c.kind === "tax") {
        mgPay(s, p, 15);
        s.last += ", −15";
      } else if (c.kind === "aid") {
        const g = rng.int(5, 25);
        s.money[p] += g;
        s.last += `, +${g}`;
      } else if (c.kind === "jail") {
        s.jail[p] = 1;
      } else if (c.kind === "chance") {
        const roll = rng.int(0, 3);
        if (roll === 0) {
          s.money[p] += 30;
          s.last += ": нашёл тайник (+30)";
        } else if (roll === 1) {
          mgPay(s, p, 20);
          s.last += ": налётчики (−20)";
        } else if (roll === 2) {
          for (const q of s.players) if (q !== p && !s.bankrupt.includes(q)) mgPay(s, q, 5, p);
          s.last += ": день рождения (+5 с каждого)";
        } else {
          s.pos[p] = 0;
          s.money[p] += 20;
          s.last += ": на старт (+20)";
        }
      }
      if (s.bankrupt.includes(p)) mgNextTurn(s, p);
      return;
    }
    if (m.t === "buy") {
      const i = s.pos[p];
      s.money[p] -= MAGNATE_BOARD[i].price!;
      s.owner[i] = p;
      s.last = `покупает «${MAGNATE_BOARD[i].name}»`;
      s.phase = "build";
      return;
    }
    if (m.t === "skip") {
      s.phase = "build";
      return;
    }
    if (m.t === "build") {
      s.money[p] -= Math.ceil(MAGNATE_BOARD[m.cell].price! / 2);
      s.level[m.cell] = (s.level[m.cell] ?? 0) + 1;
      s.last = `укрепляет «${MAGNATE_BOARD[m.cell].name}»`;
      return;
    }
    mgNextTurn(s, p);
  },
  viewFor(s) {
    return { players: s.players, pos: s.pos, money: s.money, owner: s.owner, level: s.level, jail: s.jail, bankrupt: s.bankrupt, turn: s.turn, phase: s.phase, dice: s.dice, round: s.round, maxRounds: s.maxRounds, board: MAGNATE_BOARD };
  },
  isOver(s) {
    return s.players.length - s.bankrupt.length <= 1 || s.round > s.maxRounds;
  },
  result(s) {
    const worth = (p: string) => (s.bankrupt.includes(p) ? -1 : s.money[p] + Object.entries(s.owner).reduce((a, [i, o]) => a + (o === p ? MAGNATE_BOARD[+i].price! * (1 + (s.level[+i] ?? 0) * 0.5) : 0), 0));
    const max = Math.max(...s.players.map(worth));
    const winners = s.players.filter((p) => worth(p) === max);
    return { winners, losers: s.players.filter((p) => !winners.includes(p)), text: `Капитал: ${s.players.map((p) => Math.max(0, Math.round(worth(p)))).join(" / ")}` };
  },
  botMove(s, p, skill, rng) {
    const legal = this.legalMoves(s, p);
    if (s.phase === "buy") return legal.some((m) => m.t === "buy") && (s.money[p] - MAGNATE_BOARD[s.pos[p]].price! > 25 * skill || rng.chance(0.3)) ? { t: "buy" } : { t: "skip" };
    if (s.phase === "build") {
      const b = legal.find((m) => m.t === "build");
      if (b && s.money[p] > 60) return b;
      return { t: "end" };
    }
    return legal[0];
  },
  describe(s, p, m) {
    return m.t === "end" || m.t === "skip" ? "" : s.last;
  },
  label(m, view) {
    if (m.t === "roll") return "🎲 Бросить кости";
    if (m.t === "buy") return `💰 Купить (${view?.board?.[view.pos[view.turn]]?.price ?? ""})`;
    if (m.t === "skip") return "Не покупать";
    if (m.t === "build") return `🔨 Укрепить «${MAGNATE_BOARD[m.cell].name}»`;
    return "✔ Конец хода";
  },
};
registerGame(magnate);
