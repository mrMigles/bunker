import { Rng } from "../rng";
import { registerGame, type BoardGame, type GameResult } from "./framework";

// Card = rank char + suit char. Ranks 6..A (T = 10), suits s c d h.
export const RANKS = ["6", "7", "8", "9", "T", "J", "Q", "K", "A"];
export const SUITS = ["s", "c", "d", "h"];
export const SUIT_SYM: Record<string, string> = { s: "♠", c: "♣", d: "♦", h: "♥" };
export const RANK_NAME: Record<string, string> = { "6": "6", "7": "7", "8": "8", "9": "9", T: "10", J: "В", Q: "Д", K: "К", A: "Т" };

export const rankOf = (c: string) => RANKS.indexOf(c[0]);
export const suitOf = (c: string) => c[1];
export const cardName = (c: string) => RANK_NAME[c[0]] + SUIT_SYM[c[1]];

export function deck36(): string[] {
  const d: string[] = [];
  for (const s of SUITS) for (const r of RANKS) d.push(r + s);
  return d;
}

/** Does card `d` beat attacking card `a` with trump suit `t`? */
export function beats(d: string, a: string, t: string): boolean {
  if (suitOf(d) === suitOf(a)) return rankOf(d) > rankOf(a);
  return suitOf(d) === t && suitOf(a) !== t;
}

export interface TableCard {
  a: string;
  d?: string;
  cheat?: boolean;
  by: string; // who played the attack card
}

export interface DurakState {
  variant: "podkidnoy" | "perevodnoy";
  players: string[];
  hands: Record<string, string[]>;
  deck: string[]; // deck[0] is drawn first; the last card is the face-up trump
  trump: string;
  trumpCard: string;
  table: TableCard[];
  attacker: string;
  defender: string;
  passed: Record<string, boolean>;
  taking: boolean;
  boutStartDef: number;
  firstBout: boolean;
  out: string[];
  discard: number;
  over: boolean;
  loser: string | null;
  draw: boolean;
  log: string[];
}

export type DurakMove =
  | { t: "attack"; card: string }
  | { t: "beat"; card: string; i: number; cheat?: boolean }
  | { t: "transfer"; card: string }
  | { t: "take" }
  | { t: "pass" }
  | { t: "catch"; i: number };

export function active(s: DurakState): string[] {
  return s.players.filter((p) => !s.out.includes(p));
}

function nextActive(s: DurakState, p: string, skip: string[] = []): string {
  const n = s.players.length;
  let i = s.players.indexOf(p);
  for (let k = 0; k < n; k++) {
    i = (i + 1) % n;
    const q = s.players[i];
    if (!s.out.includes(q) && !skip.includes(q)) return q;
  }
  return p;
}

export function attackLimit(s: DurakState) {
  return Math.min(s.firstBout ? 5 : 6, s.boutStartDef);
}

function tableRanks(s: DurakState): Set<string> {
  const r = new Set<string>();
  for (const t of s.table) {
    r.add(t.a[0]);
    if (t.d) r.add(t.d[0]);
  }
  return r;
}

function unbeaten(s: DurakState) {
  return s.table.filter((t) => !t.d).length;
}

function attackers(s: DurakState) {
  return active(s).filter((p) => p !== s.defender);
}

export const durak: BoardGame<DurakState, DurakMove> = {
  id: "durak",
  name: "Дурак",
  minPlayers: 2,
  maxPlayers: 6,
  options: { variant: { label: "Вариант", values: [["podkidnoy", "Подкидной"], ["perevodnoy", "Переводной"]] } },

  setup(players, seed, opts = {}) {
    const rng = Rng.from(seed);
    const deck = rng.shuffle(deck36());
    const hands: Record<string, string[]> = {};
    for (const p of players) hands[p] = [];
    for (let k = 0; k < 6; k++) for (const p of players) if (deck.length) hands[p].push(deck.shift()!);
    // trump: bottom card of the deck; if the deck is empty (6 players) — the last dealt card
    const trumpCard = deck.length ? deck[deck.length - 1] : hands[players[players.length - 1]][5];
    const trump = suitOf(trumpCard);
    // first attacker: lowest trump
    let first = players[0];
    let low = 99;
    for (const p of players)
      for (const c of hands[p])
        if (suitOf(c) === trump && rankOf(c) < low) {
          low = rankOf(c);
          first = p;
        }
    const s: DurakState = {
      variant: opts.variant === "perevodnoy" ? "perevodnoy" : "podkidnoy",
      players: [...players],
      hands,
      deck,
      trump,
      trumpCard,
      table: [],
      attacker: first,
      defender: "",
      passed: {},
      taking: false,
      boutStartDef: 6,
      firstBout: true,
      out: [],
      discard: 0,
      over: false,
      loser: null,
      draw: false,
      log: [],
    };
    s.defender = nextActive(s, first);
    s.boutStartDef = s.hands[s.defender].length;
    return s;
  },

  legalMoves(s, p) {
    const out: DurakMove[] = [];
    if (s.over || s.out.includes(p) || !s.hands[p]) return out;
    const hand = s.hands[p];
    if (p === s.defender) {
      if (!s.table.length) return out;
      if (!s.taking) {
        s.table.forEach((t, i) => {
          if (t.d) return;
          for (const c of hand) if (beats(c, t.a, s.trump)) out.push({ t: "beat", card: c, i });
        });
        // transfer
        if (s.variant === "perevodnoy" && s.table.every((t) => !t.d) && s.table.length) {
          const r = s.table[0].a[0];
          if (s.table.every((t) => t.a[0] === r)) {
            const next = nextActive(s, p);
            if (next !== s.attacker || active(s).length > 2) {
              if (next !== p && s.hands[next].length >= s.table.length + 1) for (const c of hand) if (c[0] === r) out.push({ t: "transfer", card: c });
            }
          }
        }
        if (unbeaten(s) > 0) out.push({ t: "take" });
      }
    } else {
      // attackers
      if (!s.table.length) {
        if (p === s.attacker) for (const c of hand) out.push({ t: "attack", card: c });
        return out;
      }
      const limit = attackLimit(s);
      const def = s.hands[s.defender].length;
      const canAdd = s.table.length < limit && (s.taking || unbeaten(s) < def);
      if (canAdd) {
        const ranks = tableRanks(s);
        for (const c of hand) if (ranks.has(c[0])) out.push({ t: "attack", card: c });
      }
      if (!s.passed[p]) out.push({ t: "pass" });
    }
    // anyone at the table may call out cheating on a beaten pair
    s.table.forEach((t, i) => {
      if (t.d && p !== s.defender) out.push({ t: "catch", i });
    });
    return out;
  },

  applyMove(s, p, m) {
    const hand = s.hands[p];
    const take = (c: string) => {
      const i = hand.indexOf(c);
      if (i >= 0) hand.splice(i, 1);
    };
    switch (m.t) {
      case "attack":
        take(m.card);
        s.table.push({ a: m.card, by: p });
        for (const k in s.passed) s.passed[k] = false;
        s.log.push(`${p}: ход ${cardName(m.card)}`);
        break;
      case "beat":
        take(m.card);
        s.table[m.i].d = m.card;
        if (m.cheat) s.table[m.i].cheat = true;
        s.log.push(`${p}: бьёт ${cardName(m.card)}`);
        break;
      case "transfer": {
        take(m.card);
        s.table.push({ a: m.card, by: p });
        const next = nextActive(s, p);
        s.attacker = p;
        s.defender = next;
        s.boutStartDef = s.hands[next].length;
        s.passed = {};
        s.log.push(`${p}: переводит ${cardName(m.card)}`);
        break;
      }
      case "take":
        s.taking = true;
        s.passed = {};
        s.log.push(`${p}: беру`);
        break;
      case "pass":
        s.passed[p] = true;
        break;
      case "catch": {
        const t = s.table[m.i];
        if (t?.cheat && t.d) {
          s.hands[s.defender].push(t.d);
          t.d = undefined;
          t.cheat = false;
          s.taking = true;
          s.passed = {};
          s.log.push(`${p}: ловит на жульничестве! ${s.defender} забирает стол`);
        } else s.log.push(`${p}: «Жульничество!» — но всё честно.`);
        return;
      }
    }
    // bout resolution
    const atk = attackers(s);
    const allPassed = atk.every((a) => s.passed[a] || s.hands[a].length === 0 || !canThrow(s, a));
    const allBeaten = s.table.length > 0 && unbeaten(s) === 0;
    const defNoCards = s.hands[s.defender].length === 0 && allBeaten;
    if (s.table.length && ((s.taking && allPassed) || (allBeaten && (allPassed || defNoCards)))) endBout(s);
  },

  viewFor(s, p) {
    const hands: Record<string, any> = {};
    for (const q of s.players) hands[q] = q === p ? s.hands[q] : s.hands[q].length;
    return {
      variant: s.variant,
      players: s.players,
      hands,
      deck: s.deck.length,
      trump: s.trump,
      trumpCard: s.deck.length ? s.trumpCard : null,
      table: s.table.map((t) => ({ a: t.a, d: t.d, by: t.by })),
      attacker: s.attacker,
      defender: s.defender,
      passed: s.passed,
      taking: s.taking,
      out: s.out,
      discard: s.discard,
      over: s.over,
      loser: s.loser,
      draw: s.draw,
      log: s.log.slice(-6),
      limit: attackLimit(s),
    };
  },

  isOver: (s) => s.over,

  result(s): GameResult {
    if (s.draw) return { winners: [...s.players], losers: [], draw: true, text: "Ничья!" };
    const loser = s.loser;
    return { winners: s.players.filter((p) => p !== loser), losers: loser ? [loser] : [], text: loser ? `Дурак — ${loser}` : "" };
  },

  toAct(s) {
    if (s.over) return [];
    if (!s.table.length) return [s.attacker];
    const out: string[] = [];
    if (!s.taking && unbeaten(s) > 0) out.push(s.defender);
    for (const a of attackers(s)) if (!s.passed[a] && s.hands[a].length && canThrow(s, a)) out.push(a);
    return out;
  },

  botMove(s, p, skill, rng, cheater) {
    const legal = durak.legalMoves(s, p);
    if (!legal.length) return null;
    const val = (c: string) => rankOf(c) + (suitOf(c) === s.trump ? 10 : 0);
    const late = s.deck.length === 0;
    // catching a cheater
    const cheatIdx = s.table.findIndex((t) => t.cheat);
    if (cheatIdx >= 0 && p !== s.defender && rng.chance(0.25 + skill * 0.5)) return { t: "catch", i: cheatIdx };
    if (p === s.defender) {
      if (s.taking) return null;
      // transfer if useful
      const tr = legal.filter((m) => m.t === "transfer") as { t: "transfer"; card: string }[];
      if (tr.length && rng.chance(0.3 + skill * 0.5)) {
        tr.sort((a, b) => val(a.card) - val(b.card));
        if (suitOf(tr[0].card) !== s.trump || late) return tr[0];
      }
      // beat the first unbeaten card with the cheapest card
      const i = s.table.findIndex((t) => !t.d);
      const opts = (legal.filter((m) => m.t === "beat" && m.i === i) as { t: "beat"; card: string; i: number }[]).sort((a, b) => val(a.card) - val(b.card));
      if (!opts.length) {
        if (cheater && rng.chance(0.3)) {
          const a = s.table[i].a;
          const fake = s.hands[p].find((c) => suitOf(c) === suitOf(a) && rankOf(c) < rankOf(a));
          if (fake) return { t: "beat", card: fake, i, cheat: true };
        }
        return { t: "take" };
      }
      const best = opts[0];
      // a careful player keeps high trumps early in the game when the table is small
      if (skill > 0.5 && !late && suitOf(best.card) === s.trump && rankOf(best.card) >= 6 && s.table.length <= 2 && rng.chance(skill * 0.6)) return { t: "take" };
      return best;
    }
    // attacker
    const attacks = (legal.filter((m) => m.t === "attack") as { t: "attack"; card: string }[]).sort((a, b) => val(a.card) - val(b.card));
    if (!s.table.length) {
      // prefer a rank we hold several of
      const counts: Record<string, number> = {};
      for (const c of s.hands[p]) counts[c[0]] = (counts[c[0]] ?? 0) + 1;
      if (skill > 0.4) {
        const pair = attacks.find((m) => counts[m.card[0]] > 1 && suitOf(m.card) !== s.trump);
        if (pair && rankOf(pair.card) < 6) return pair;
      }
      return attacks[0] ?? null;
    }
    if (attacks.length) {
      const c = attacks[0];
      const cheap = suitOf(c.card) !== s.trump && (rankOf(c.card) <= 4 || late || s.taking);
      if (cheap || (skill < 0.3 && rng.chance(0.5))) return c;
    }
    return legal.some((m) => m.t === "pass") ? { t: "pass" } : null;
  },

  describe(s, p, m) {
    switch (m.t) {
      case "attack":
        return `${cardName(m.card)}`;
      case "beat":
        return `бьёт ${cardName(m.card)}`;
      case "transfer":
        return `переводит ${cardName(m.card)}!`;
      case "take":
        return "беру!";
      case "pass":
        return "бито / пас";
      case "catch":
        return "Жульничество!";
    }
  },
};

function canThrow(s: DurakState, a: string): boolean {
  if (!s.table.length) return a === s.attacker;
  if (s.table.length >= attackLimit(s)) return false;
  if (!s.taking && unbeaten(s) >= s.hands[s.defender].length) return false;
  const ranks = tableRanks(s);
  return s.hands[a].some((c) => ranks.has(c[0]));
}

function endBout(s: DurakState) {
  const cards = s.table.flatMap((t) => (t.d ? [t.a, t.d] : [t.a]));
  const took = s.taking;
  if (took) {
    s.hands[s.defender].push(...cards);
  } else s.discard += cards.length;
  s.table = [];
  s.taking = false;
  s.passed = {};
  s.firstBout = false;
  // refill: attacker first, then clockwise, defender last
  const order: string[] = [];
  let p = s.attacker;
  for (let k = 0; k < s.players.length; k++) {
    if (p !== s.defender && !s.out.includes(p)) order.push(p);
    p = s.players[(s.players.indexOf(p) + 1) % s.players.length];
  }
  if (!s.out.includes(s.defender)) order.push(s.defender);
  for (const q of order) while (s.hands[q].length < 6 && s.deck.length) s.hands[q].push(s.deck.shift()!);
  // players out
  if (!s.deck.length) for (const q of s.players) if (!s.out.includes(q) && s.hands[q].length === 0) s.out.push(q);
  const act = active(s);
  if (act.length <= 1) {
    s.over = true;
    s.loser = act[0] ?? null;
    s.draw = act.length === 0;
    s.log.push(s.draw ? "Ничья!" : `Дурак — ${s.loser}!`);
    return;
  }
  const prevDef = s.defender;
  let nextAtk: string;
  if (took) nextAtk = s.out.includes(prevDef) ? nextActive(s, prevDef) : nextActive(s, prevDef);
  else nextAtk = s.out.includes(prevDef) ? nextActive(s, prevDef) : prevDef;
  s.attacker = nextAtk;
  s.defender = nextActive(s, nextAtk);
  s.boutStartDef = s.hands[s.defender].length;
}

registerGame(durak as BoardGame);
