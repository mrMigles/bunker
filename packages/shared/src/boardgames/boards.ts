import type { Rng } from "../rng";
import { registerGame, type BoardGame } from "./framework";

const FILES = "abcdefgh";
export const sqName = (i: number) => FILES[i % 8] + (8 - Math.floor(i / 8));
const rc = (i: number) => [Math.floor(i / 8), i % 8] as const;
const on = (r: number, c: number) => r >= 0 && r < 8 && c >= 0 && c < 8;

// ================================================================ Русские шашки
// Board: 64 squares, row 0 at the top (black's back rank). Pieces: w, W (king), b, B, "." empty.
// White moves up (towards row 0). Mandatory capture, multi-jumps, flying kings,
// captured pieces are removed after the sequence (Turkish strike forbidden).

interface CheckersState {
  players: string[]; // [white, black]
  b: string[];
  turn: 0 | 1;
  quiet: number; // plies without capture or man move
  over: boolean;
  winner: number | null;
  last: number[] | null;
}

type CheckersMove = { t: "move"; path: number[] } | { t: "resign" };

const isW = (x: string) => x === "w" || x === "W";
const isB = (x: string) => x === "b" || x === "B";
const own = (x: string, side: number) => (side === 0 ? isW(x) : isB(x));
const DIRS = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

function ckCaptures(b: string[], from: number, piece: string, side: number, taken: number[], path: number[], out: number[][]) {
  const [r, c] = rc(from);
  const king = piece === "W" || piece === "B";
  let found = false;
  for (const [dr, dc] of DIRS) {
    if (king) {
      let rr = r + dr,
        cc = c + dc;
      while (on(rr, cc) && (b[rr * 8 + cc] === "." || rr * 8 + cc === path[0])) (rr += dr), (cc += dc);
      if (!on(rr, cc)) continue;
      const mid = rr * 8 + cc;
      if (own(b[mid], side) || b[mid] === "." || taken.includes(mid)) continue;
      let lr = rr + dr,
        lc = cc + dc;
      const lands: number[] = [];
      while (on(lr, lc) && (b[lr * 8 + lc] === "." || lr * 8 + lc === path[0])) {
        lands.push(lr * 8 + lc);
        (lr += dr), (lc += dc);
      }
      // if any landing allows continuing, only those are allowed
      const cont = lands.filter((l) => {
        const tmp: number[][] = [];
        ckCaptures(b, l, piece, side, [...taken, mid], [...path, l], tmp);
        return tmp.some((p) => p.length > path.length + 1);
      });
      for (const l of cont.length ? cont : lands) {
        found = true;
        const before = out.length;
        ckCaptures(b, l, piece, side, [...taken, mid], [...path, l], out);
        if (out.length === before) out.push([...path, l]);
      }
    } else {
      const mr = r + dr,
        mc = c + dc,
        lr = r + 2 * dr,
        lc = c + 2 * dc;
      if (!on(lr, lc)) continue;
      const mid = mr * 8 + mc,
        land = lr * 8 + lc;
      if (b[mid] === "." || own(b[mid], side) || taken.includes(mid)) continue;
      if (b[land] !== "." && land !== path[0]) continue;
      found = true;
      const promote = (side === 0 && lr === 0) || (side === 1 && lr === 7);
      const before = out.length;
      ckCaptures(b, land, promote ? (side === 0 ? "W" : "B") : piece, side, [...taken, mid], [...path, land], out);
      if (out.length === before) out.push([...path, land]);
    }
  }
  return found;
}

export function checkersMoves(s: CheckersState): number[][] {
  const side = s.turn;
  const caps: number[][] = [];
  for (let i = 0; i < 64; i++) if (own(s.b[i], side)) ckCaptures(s.b, i, s.b[i], side, [], [i], caps);
  if (caps.length) return caps;
  const out: number[][] = [];
  for (let i = 0; i < 64; i++) {
    const x = s.b[i];
    if (!own(x, side)) continue;
    const [r, c] = rc(i);
    const king = x === "W" || x === "B";
    for (const [dr, dc] of DIRS) {
      if (!king && dr !== (side === 0 ? -1 : 1)) continue;
      let rr = r + dr,
        cc = c + dc;
      while (on(rr, cc) && s.b[rr * 8 + cc] === ".") {
        out.push([i, rr * 8 + cc]);
        if (!king) break;
        (rr += dr), (cc += dc);
      }
    }
  }
  return out;
}

function ckApply(s: CheckersState, path: number[]) {
  let piece = s.b[path[0]];
  const side = s.turn;
  let captured = false;
  s.b[path[0]] = ".";
  for (let k = 1; k < path.length; k++) {
    const [r0, c0] = rc(path[k - 1]),
      [r1, c1] = rc(path[k]);
    const dr = Math.sign(r1 - r0),
      dc = Math.sign(c1 - c0);
    for (let r = r0 + dr, c = c0 + dc; r !== r1; r += dr, c += dc)
      if (s.b[r * 8 + c] !== ".") {
        s.b[r * 8 + c] = ".";
        captured = true;
      }
    if ((side === 0 && r1 === 0) || (side === 1 && r1 === 7)) piece = side === 0 ? "W" : "B";
  }
  const wasMan = piece === "w" || piece === "b";
  s.b[path[path.length - 1]] = piece;
  s.quiet = captured || wasMan ? 0 : s.quiet + 1;
  s.last = path;
}

const checkers: BoardGame<CheckersState, CheckersMove> = {
  id: "checkers",
  name: "Шашки",
  minPlayers: 2,
  maxPlayers: 2,
  setup(players) {
    const b = Array(64).fill(".");
    for (let i = 0; i < 64; i++) {
      const [r, c] = rc(i);
      if ((r + c) % 2 === 1) {
        if (r < 3) b[i] = "b";
        else if (r > 4) b[i] = "w";
      }
    }
    return { players: players.slice(0, 2), b, turn: 0, quiet: 0, over: false, winner: null, last: null };
  },
  toAct(s) {
    return s.over ? [] : [s.players[s.turn]];
  },
  legalMoves(s, p) {
    if (s.over || s.players[s.turn] !== p) return [];
    return [...checkersMoves(s).map((path) => ({ t: "move" as const, path })), { t: "resign" }];
  },
  applyMove(s, p, m) {
    if (m.t === "resign") {
      s.over = true;
      s.winner = 1 - s.turn;
      return;
    }
    ckApply(s, m.path);
    s.turn = (1 - s.turn) as 0 | 1;
    if (!checkersMoves(s).length) {
      s.over = true;
      s.winner = 1 - s.turn;
    } else if (s.quiet >= 50) {
      s.over = true;
      s.winner = null;
    }
  },
  viewFor(s) {
    return { players: s.players, board: s.b, turn: s.players[s.turn], last: s.last, kind: "checkers" };
  },
  isOver(s) {
    return s.over;
  },
  result(s) {
    if (s.winner === null) return { winners: [...s.players], losers: [], draw: true, text: "Ничья" };
    return { winners: [s.players[s.winner]], losers: [s.players[1 - s.winner]], text: s.winner === 0 ? "Белые победили" : "Чёрные победили" };
  },
  botMove(s, p, skill, rng) {
    const moves = checkersMoves(s);
    if (!moves.length) return { t: "resign" };
    const side = s.turn;
    const evalB = (st: CheckersState) => {
      let v = 0;
      for (let i = 0; i < 64; i++) {
        const x = st.b[i];
        if (x === ".") continue;
        const val = x === "W" || x === "B" ? 3 : 1 + (isW(x) ? (7 - rc(i)[0]) * 0.05 : rc(i)[0] * 0.05);
        v += own(x, side) ? val : -val;
      }
      return v;
    };
    const scored = moves.map((path) => {
      const c: CheckersState = { ...s, b: [...s.b] };
      ckApply(c, path);
      c.turn = (1 - side) as 0 | 1;
      // opponent's best reply (1 ply)
      let worst = Infinity;
      for (const r of checkersMoves(c).slice(0, 40)) {
        const d: CheckersState = { ...c, b: [...c.b] };
        ckApply(d, r);
        worst = Math.min(worst, evalB(d));
      }
      if (worst === Infinity) worst = 100;
      return { path, v: (skill > 0.35 ? worst : evalB(c)) + rng.range(0, 1.2 - skill) };
    });
    scored.sort((a, b) => b.v - a.v);
    return { t: "move", path: scored[0].path };
  },
  describe(s, p, m) {
    return m.t === "resign" ? "сдаётся" : m.path.map(sqName).join(m.path.length > 2 || Math.abs(m.path[1] - m.path[0]) > 9 ? ":" : "-");
  },
  label(m) {
    return m.t === "resign" ? "🏳 Сдаться" : m.path.map(sqName).join("→");
  },
};
registerGame(checkers);

// ================================================================ Шахматы
// Board: 64 chars, row 0 = rank 8. Uppercase white. "." empty.

interface ChessState {
  players: string[];
  b: string[];
  turn: 0 | 1;
  castle: string; // subset of "KQkq"
  ep: number; // en passant target square or -1
  half: number;
  over: boolean;
  winner: number | null;
  reason: string;
  last: [number, number] | null;
  history: string[];
}

type ChessMove = { t: "move"; from: number; to: number; promo?: string } | { t: "resign" };

const isWhite = (x: string) => x !== "." && x === x.toUpperCase();
const side = (x: string) => (x === "." ? -1 : isWhite(x) ? 0 : 1);
const KN = [
  [-2, -1],
  [-2, 1],
  [-1, -2],
  [-1, 2],
  [1, -2],
  [1, 2],
  [2, -1],
  [2, 1],
];
const KG = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
];

function attacked(b: string[], sq: number, by: number): boolean {
  const [r, c] = rc(sq);
  const P = by === 0 ? "P" : "p";
  const pr = by === 0 ? r + 1 : r - 1;
  for (const dc of [-1, 1]) if (on(pr, c + dc) && b[pr * 8 + c + dc] === P) return true;
  for (const [dr, dc] of KN) if (on(r + dr, c + dc) && b[(r + dr) * 8 + c + dc] === (by === 0 ? "N" : "n")) return true;
  for (const [dr, dc] of KG) if (on(r + dr, c + dc) && b[(r + dr) * 8 + c + dc] === (by === 0 ? "K" : "k")) return true;
  for (const [dr, dc] of KG) {
    const diag = dr !== 0 && dc !== 0;
    let rr = r + dr,
      cc = c + dc;
    while (on(rr, cc)) {
      const x = b[rr * 8 + cc];
      if (x !== ".") {
        if (side(x) === by) {
          const l = x.toLowerCase();
          if (l === "q" || (diag && l === "b") || (!diag && l === "r")) return true;
        }
        break;
      }
      (rr += dr), (cc += dc);
    }
  }
  return false;
}

function pseudo(s: ChessState): { from: number; to: number; promo?: string }[] {
  const out: { from: number; to: number; promo?: string }[] = [];
  const me = s.turn;
  const b = s.b;
  for (let i = 0; i < 64; i++) {
    const x = b[i];
    if (side(x) !== me) continue;
    const [r, c] = rc(i);
    const l = x.toLowerCase();
    const add = (to: number) => {
      const tr = rc(to)[0];
      if (l === "p" && (tr === 0 || tr === 7)) for (const pr of ["q", "r", "b", "n"]) out.push({ from: i, to, promo: pr });
      else out.push({ from: i, to });
    };
    if (l === "p") {
      const dir = me === 0 ? -1 : 1;
      const r1 = r + dir;
      if (on(r1, c) && b[r1 * 8 + c] === ".") {
        add(r1 * 8 + c);
        const start = me === 0 ? 6 : 1;
        if (r === start && b[(r + 2 * dir) * 8 + c] === ".") out.push({ from: i, to: (r + 2 * dir) * 8 + c });
      }
      for (const dc of [-1, 1]) {
        if (!on(r1, c + dc)) continue;
        const t = r1 * 8 + c + dc;
        if (side(b[t]) === 1 - me || t === s.ep) add(t);
      }
    } else if (l === "n" || l === "k") {
      for (const [dr, dc] of l === "n" ? KN : KG) {
        if (!on(r + dr, c + dc)) continue;
        const t = (r + dr) * 8 + c + dc;
        if (side(b[t]) !== me) out.push({ from: i, to: t });
      }
      if (l === "k") {
        const home = me === 0 ? 60 : 4;
        if (i === home && !attacked(b, i, 1 - me)) {
          const K = me === 0 ? "K" : "k",
            Q = me === 0 ? "Q" : "q";
          if (s.castle.includes(K) && b[i + 1] === "." && b[i + 2] === "." && !attacked(b, i + 1, 1 - me) && !attacked(b, i + 2, 1 - me)) out.push({ from: i, to: i + 2 });
          if (s.castle.includes(Q) && b[i - 1] === "." && b[i - 2] === "." && b[i - 3] === "." && !attacked(b, i - 1, 1 - me) && !attacked(b, i - 2, 1 - me)) out.push({ from: i, to: i - 2 });
        }
      }
    } else {
      const dirs = l === "b" ? KG.filter(([a, d]) => a && d) : l === "r" ? KG.filter(([a, d]) => !a || !d) : KG;
      for (const [dr, dc] of dirs) {
        let rr = r + dr,
          cc = c + dc;
        while (on(rr, cc)) {
          const t = rr * 8 + cc;
          if (side(b[t]) === me) break;
          out.push({ from: i, to: t });
          if (b[t] !== ".") break;
          (rr += dr), (cc += dc);
        }
      }
    }
  }
  return out;
}

function chApply(s: ChessState, m: { from: number; to: number; promo?: string }) {
  const b = s.b;
  const x = b[m.from];
  const l = x.toLowerCase();
  const me = s.turn;
  const capture = b[m.to] !== "." || (l === "p" && m.to === s.ep);
  if (l === "p" && m.to === s.ep) b[m.to + (me === 0 ? 8 : -8)] = ".";
  b[m.to] = m.promo ? (me === 0 ? m.promo.toUpperCase() : m.promo) : x;
  b[m.from] = ".";
  if (l === "k" && Math.abs(m.to - m.from) === 2) {
    if (m.to > m.from) {
      b[m.from + 1] = b[m.from + 3];
      b[m.from + 3] = ".";
    } else {
      b[m.from - 1] = b[m.from - 4];
      b[m.from - 4] = ".";
    }
  }
  s.ep = l === "p" && Math.abs(m.to - m.from) === 16 ? (m.to + m.from) / 2 : -1;
  const strip = (ch: string) => (s.castle = s.castle.replace(ch, ""));
  if (x === "K") strip("K"), strip("Q");
  if (x === "k") strip("k"), strip("q");
  for (const [sq, ch] of [
    [63, "K"],
    [56, "Q"],
    [7, "k"],
    [0, "q"],
  ] as const)
    if (m.from === sq || m.to === sq) strip(ch);
  s.half = capture || l === "p" ? 0 : s.half + 1;
  s.last = [m.from, m.to];
  s.turn = (1 - me) as 0 | 1;
}

export function chessLegal(s: ChessState): { from: number; to: number; promo?: string }[] {
  const me = s.turn;
  return pseudo(s).filter((m) => {
    const c: ChessState = { ...s, b: [...s.b] };
    chApply(c, m);
    const k = c.b.indexOf(me === 0 ? "K" : "k");
    return k >= 0 && !attacked(c.b, k, 1 - me);
  });
}

function chCheckEnd(s: ChessState) {
  const legal = chessLegal(s);
  const k = s.b.indexOf(s.turn === 0 ? "K" : "k");
  const check = attacked(s.b, k, 1 - s.turn);
  if (!legal.length) {
    s.over = true;
    s.winner = check ? 1 - s.turn : null;
    s.reason = check ? "Мат" : "Пат";
  } else if (s.half >= 100) {
    s.over = true;
    s.winner = null;
    s.reason = "50 ходов";
  } else {
    const rest = s.b.filter((x) => x !== "." && x.toLowerCase() !== "k");
    if (!rest.length || (rest.length === 1 && "nNbB".includes(rest[0]))) {
      s.over = true;
      s.winner = null;
      s.reason = "Недостаточно материала";
    }
    const key = s.b.join("") + s.turn + s.castle + s.ep;
    s.history.push(key);
    if (s.history.filter((h) => h === key).length >= 3) {
      s.over = true;
      s.winner = null;
      s.reason = "Троекратное повторение";
    }
  }
}

const VAL: Record<string, number> = { p: 1, n: 3, b: 3.2, r: 5, q: 9, k: 0 };

function chEval(b: string[], me: number) {
  let v = 0;
  for (let i = 0; i < 64; i++) {
    const x = b[i];
    if (x === ".") continue;
    const [r, c] = rc(i);
    const l = x.toLowerCase();
    let val = VAL[l];
    const centre = 3.5 - Math.max(Math.abs(r - 3.5), Math.abs(c - 3.5));
    if (l === "n" || l === "b") val += centre * 0.05;
    if (l === "p") val += (isWhite(x) ? 6 - r : r - 1) * 0.04 + (c >= 2 && c <= 5 ? 0.03 : 0);
    v += side(x) === me ? val : -val;
  }
  return v;
}

function chSearch(s: ChessState, depth: number, alpha: number, beta: number, me: number): number {
  const moves = chessLegal(s);
  if (!moves.length) {
    const k = s.b.indexOf(s.turn === 0 ? "K" : "k");
    if (attacked(s.b, k, 1 - s.turn)) return s.turn === me ? -1000 - depth : 1000 + depth;
    return 0;
  }
  if (depth === 0) return chEval(s.b, me);
  // captures first
  moves.sort((a, b) => (s.b[b.to] !== "." ? VAL[s.b[b.to].toLowerCase()] : 0) - (s.b[a.to] !== "." ? VAL[s.b[a.to].toLowerCase()] : 0));
  const maxing = s.turn === me;
  let best = maxing ? -Infinity : Infinity;
  for (const m of moves) {
    const c: ChessState = { ...s, b: [...s.b], history: s.history };
    chApply(c, m);
    const v = chSearch(c, depth - 1, alpha, beta, me);
    if (maxing) {
      best = Math.max(best, v);
      alpha = Math.max(alpha, v);
    } else {
      best = Math.min(best, v);
      beta = Math.min(beta, v);
    }
    if (beta <= alpha) break;
  }
  return best;
}

const PIECE_RU: Record<string, string> = { p: "", n: "К", b: "С", r: "Л", q: "Ф", k: "Кр" };

const chess: BoardGame<ChessState, ChessMove> = {
  id: "chess",
  name: "Шахматы",
  minPlayers: 2,
  maxPlayers: 2,
  setup(players) {
    const b = ("rnbqkbnr" + "pppppppp" + "........".repeat(4) + "PPPPPPPP" + "RNBQKBNR").split("");
    return { players: players.slice(0, 2), b, turn: 0, castle: "KQkq", ep: -1, half: 0, over: false, winner: null, reason: "", last: null, history: [] };
  },
  toAct(s) {
    return s.over ? [] : [s.players[s.turn]];
  },
  legalMoves(s, p) {
    if (s.over || s.players[s.turn] !== p) return [];
    return [...chessLegal(s).map((m) => ({ t: "move" as const, ...m })), { t: "resign" }];
  },
  applyMove(s, p, m) {
    if (m.t === "resign") {
      s.over = true;
      s.winner = 1 - s.turn;
      s.reason = "Сдача";
      return;
    }
    chApply(s, { from: m.from, to: m.to, promo: m.promo });
    chCheckEnd(s);
  },
  viewFor(s) {
    const k = s.b.indexOf(s.turn === 0 ? "K" : "k");
    return { players: s.players, board: s.b, turn: s.players[s.turn], last: s.last, check: !s.over && attacked(s.b, k, 1 - s.turn), reason: s.reason, kind: "chess" };
  },
  isOver(s) {
    return s.over;
  },
  result(s) {
    if (s.winner === null) return { winners: [...s.players], losers: [], draw: true, text: `Ничья: ${s.reason}` };
    return { winners: [s.players[s.winner]], losers: [s.players[1 - s.winner]], text: `${s.reason}. ${s.winner === 0 ? "Белые" : "Чёрные"} победили` };
  },
  botMove(s, p, skill, rng: Rng) {
    const moves = chessLegal(s);
    if (!moves.length) return { t: "resign" };
    const me = s.turn;
    const depth = skill > 0.7 ? 2 : 1;
    const scored = moves.map((m) => {
      const c: ChessState = { ...s, b: [...s.b], history: s.history };
      chApply(c, m);
      return { m, v: chSearch(c, depth, -Infinity, Infinity, me) + rng.range(0, (1.1 - skill) * 1.5) };
    });
    scored.sort((a, b) => b.v - a.v);
    return { t: "move", ...scored[0].m };
  },
  describe(s, p, m) {
    if (m.t === "resign") return "сдаётся";
    const x = s.b[m.to].toLowerCase();
    return `${PIECE_RU[x] ?? ""}${sqName(m.from)}-${sqName(m.to)}${s.over ? (s.winner !== null ? "#" : " =") : ""}`;
  },
  label(m, view) {
    if (m.t === "resign") return "🏳 Сдаться";
    const x = (view?.board?.[m.from] ?? "p").toLowerCase();
    return `${PIECE_RU[x] ?? ""}${sqName(m.from)}-${sqName(m.to)}${m.promo ? "=" + PIECE_RU[m.promo] : ""}`;
  },
};
registerGame(chess);
