import { Rng } from "../rng";

/**
 * Generic board game contract. All functions are pure with respect to their inputs:
 * `applyMove` receives a state it may mutate (the framework clones before calling).
 * Players are identified by seat ids (strings).
 */
export interface GameResult {
  winners: string[];
  losers: string[];
  draw?: boolean;
  text: string;
}

export interface BoardGame<S = any, M = any> {
  id: string;
  name: string;
  minPlayers: number;
  maxPlayers: number;
  /** extra options (variants) shown before a match */
  options?: Record<string, { label: string; values: [any, string][] }>;
  setup(players: string[], seed: number, opts?: Record<string, any>): S;
  legalMoves(s: S, player: string): M[];
  applyMove(s: S, player: string, move: M): void;
  /** What a given player (or a spectator: null) is allowed to see. */
  viewFor(s: S, player: string | null): any;
  isOver(s: S): boolean;
  result(s: S): GameResult;
  /** Players who are expected to act now (for turn timers and bots). */
  toAct(s: S): string[];
  /** Bot decision. skill 0..1. May return an illegal "cheat" move for cheaters (framework handles). */
  botMove(s: S, player: string, skill: number, rng: Rng, cheater?: boolean): M | null;
  /** Human-readable move description for table talk / logs. */
  describe?(s: S, player: string, move: M): string;
}

export function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

export function sameMove(a: any, b: any): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Validates and applies a move. Returns an error message or null. */
export function tryMove<S, M>(g: BoardGame<S, M>, s: S, player: string, move: M, trusted = false): { state: S; error: string | null } {
  if (g.isOver(s)) return { state: s, error: "Партия окончена" };
  if (!trusted) {
    const legal = g.legalMoves(s, player);
    if (!legal.some((m) => sameMove(m, move))) return { state: s, error: "Так ходить нельзя" };
  }
  const next = clone(s);
  g.applyMove(next, player, move);
  return { state: next, error: null };
}

export const GAMES: Record<string, BoardGame> = {};

export function registerGame(g: BoardGame) {
  GAMES[g.id] = g;
}
