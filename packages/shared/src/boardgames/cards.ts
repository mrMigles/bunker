// Card helpers for 52/36-card games. Card = rank char + suit char (T = 10).

export const RANKS52 = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
export const SUITS4 = ["s", "c", "d", "h"];
const SYM: Record<string, string> = { s: "♠", c: "♣", d: "♦", h: "♥" };
const NAME: Record<string, string> = { T: "10", J: "В", Q: "Д", K: "К", A: "Т" };

export function deck52(): string[] {
  const d: string[] = [];
  for (const s of SUITS4) for (const r of RANKS52) d.push(r + s);
  return d;
}

export function rank52(c: string) {
  return RANKS52.indexOf(c[0]);
}

export function cardLabel(c: string) {
  return (NAME[c[0]] ?? c[0]) + (SYM[c[1]] ?? "");
}

export function rankLabel(r: string) {
  return NAME[r] ?? r;
}

/** Poker hand value for the best 5 of up to 7 cards. Higher is better; comparable as arrays. */
export function handValue(cards: string[]): number[] {
  const combos = cards.length <= 5 ? [cards] : choose(cards, 5);
  let best: number[] = [];
  for (const c of combos) {
    const v = eval5(c);
    if (cmpVal(v, best) > 0) best = v;
  }
  return best;
}

export function cmpVal(a: number[], b: number[]) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? -1,
      y = b[i] ?? -1;
    if (x !== y) return x - y;
  }
  return 0;
}

function choose<T>(arr: T[], k: number): T[][] {
  const out: T[][] = [];
  const rec = (start: number, cur: T[]) => {
    if (cur.length === k) {
      out.push([...cur]);
      return;
    }
    for (let i = start; i < arr.length; i++) {
      cur.push(arr[i]);
      rec(i + 1, cur);
      cur.pop();
    }
  };
  rec(0, []);
  return out;
}

function eval5(c: string[]): number[] {
  const rs = c.map(rank52).sort((a, b) => b - a);
  const flush = c.length >= 5 && c.every((x) => x[1] === c[0][1]);
  const uniq = [...new Set(rs)];
  let straightHigh = -1;
  if (uniq.length === 5 && c.length >= 5) {
    if (rs[0] - rs[4] === 4) straightHigh = rs[0];
    else if (rs[0] === 12 && rs[1] === 3) straightHigh = 3; // wheel A-2-3-4-5
  }
  const counts: Record<number, number> = {};
  for (const r of rs) counts[r] = (counts[r] ?? 0) + 1;
  const groups = Object.entries(counts)
    .map(([r, n]) => [n, Number(r)])
    .sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  if (straightHigh >= 0 && flush) return [8, straightHigh];
  if (groups[0][0] === 4) return [7, groups[0][1], groups[1]?.[1] ?? -1];
  if (groups[0][0] === 3 && groups[1]?.[0] === 2) return [6, groups[0][1], groups[1][1]];
  if (flush) return [5, ...rs];
  if (straightHigh >= 0) return [4, straightHigh];
  if (groups[0][0] === 3) return [3, groups[0][1], ...groups.slice(1).map((g) => g[1])];
  if (groups[0][0] === 2 && groups[1]?.[0] === 2) return [2, groups[0][1], groups[1][1], groups[2]?.[1] ?? -1];
  if (groups[0][0] === 2) return [1, groups[0][1], ...groups.slice(1).map((g) => g[1])];
  return [0, ...rs];
}

export const HAND_NAMES = ["Старшая карта", "Пара", "Две пары", "Сет", "Стрит", "Флеш", "Фулл-хаус", "Каре", "Стрит-флеш"];
