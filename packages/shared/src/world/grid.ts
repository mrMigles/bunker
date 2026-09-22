import type { World } from "../types";

// Grid: W columns × H rows, row 0 is directly below the surface, y grows downward.
// A "level" lv occupies rows 2lv and 2lv+1. A character standing on level lv has feet at y = 2lv+2.
// Level -1 is the surface (feet at y = 0).

export const GRID_W = 48;
export const GRID_H = 32;
export const LEVELS = GRID_H / 2;

export const T_AIR = 0;
export const T_SOIL = 1;
export const T_CLAY = 2;
export const T_STONE = 3;
export const T_GRANITE = 4;
export const T_WATER = 5;
export const T_CONCRETE = 6;
export const T_BEDROCK = 7;

export const TERRAIN_NAMES = ["Пусто", "Земля", "Глина", "Камень", "Гранит", "Водоносный слой", "Старый бетон", "Коренная порода"];

export function idx(w: { W: number }, x: number, y: number) {
  return y * w.W + x;
}

export function cellAt(w: World, x: number, y: number): number {
  if (x < 0 || x >= w.W || y < 0) return T_BEDROCK;
  if (y >= w.H) return T_BEDROCK;
  return w.grid[y * w.W + x];
}

export function isOpen(w: World, x: number, y: number) {
  if (y < 0) return x >= 0 && x < w.W; // surface is open air
  return cellAt(w, x, y) === T_AIR;
}

/** Column x at level lv is walkable space (both rows open). Surface is always walkable within bounds. */
export function walkable(w: World, x: number, lv: number) {
  if (x < 0 || x >= w.W) return false;
  if (lv < 0) return lv === -1;
  return isOpen(w, x, lv * 2) && isOpen(w, x, lv * 2 + 1);
}

export function feetY(lv: number) {
  return lv * 2 + 2;
}

export function levelOfY(y: number) {
  return Math.round(y / 2) - 1;
}

export function hasLadder(w: World, x: number, lv: number) {
  return !!w.ladders[x + "," + lv];
}

/** Can climb between lv-1 and lv at column x */
export function canClimb(w: World, x: number, lv: number) {
  return hasLadder(w, x, lv) && walkable(w, x, lv) && walkable(w, x, lv - 1);
}

// --- Navigation: nodes are (x, lv) packed as (lv+1)*W + x
export function node(w: World, x: number, lv: number) {
  return (lv + 1) * w.W + x;
}
export function unnode(w: World, n: number): [number, number] {
  return [n % w.W, Math.floor(n / w.W) - 1];
}

/** BFS path from (x0,lv0) to (x1,lv1). Returns list of nodes (excluding start) or null. */
export function findPath(w: World, x0: number, lv0: number, x1: number, lv1: number, maxNodes = 4000): number[] | null {
  x0 = Math.max(0, Math.min(w.W - 1, Math.floor(x0)));
  x1 = Math.max(0, Math.min(w.W - 1, Math.floor(x1)));
  const start = node(w, x0, lv0);
  const goal = node(w, x1, lv1);
  if (start === goal) return [];
  if (!walkable(w, x1, lv1)) return null;
  const prev = new Map<number, number>();
  prev.set(start, -1);
  const q: number[] = [start];
  let head = 0;
  while (head < q.length && head < maxNodes) {
    const cur = q[head++];
    if (cur === goal) break;
    const [cx, cl] = unnode(w, cur);
    const nb: number[] = [];
    if (walkable(w, cx - 1, cl)) nb.push(node(w, cx - 1, cl));
    if (walkable(w, cx + 1, cl)) nb.push(node(w, cx + 1, cl));
    if (canClimb(w, cx, cl + 1)) nb.push(node(w, cx, cl + 1));
    if (cl >= 0 && canClimb(w, cx, cl)) nb.push(node(w, cx, cl - 1));
    for (const n of nb) {
      if (!prev.has(n)) {
        prev.set(n, cur);
        q.push(n);
      }
    }
  }
  if (!prev.has(goal)) return null;
  const path: number[] = [];
  let c = goal;
  while (c !== start) {
    path.push(c);
    c = prev.get(c)!;
  }
  path.reverse();
  // compress: keep only turning points (level changes and their neighbours)
  const out: number[] = [];
  for (let i = 0; i < path.length; i++) {
    const [, l] = unnode(w, path[i]);
    const next = path[i + 1];
    const prevN = i > 0 ? path[i - 1] : start;
    const [, pl] = unnode(w, prevN);
    if (next === undefined) out.push(path[i]);
    else {
      const [, nl] = unnode(w, next);
      if (nl !== l || pl !== l) out.push(path[i]);
    }
  }
  return out;
}

export function reachable(w: World, x0: number, lv0: number, x1: number, lv1: number) {
  return findPath(w, x0, lv0, x1, lv1) !== null;
}

/** Where a character must stand to dig slot (x, lv). Horizontal neighbours first, then from above. */
export function slotAccess(w: World, x: number, lv: number): { x: number; lv: number } | null {
  if (walkable(w, x - 1, lv)) return { x: x - 1, lv };
  if (walkable(w, x + 1, lv)) return { x: x + 1, lv };
  if (walkable(w, x, lv - 1)) return { x, lv: lv - 1 };
  if (walkable(w, x, lv + 1)) return { x, lv: lv + 1 };
  return null;
}

export function slotKey(w: World, x: number, lv: number) {
  return String(node(w, x, lv));
}

/** Seconds of digging work for a slot, given per-minute cell rates by terrain. */
export function slotTerrain(w: World, x: number, lv: number): [number, number] {
  return [cellAt(w, x, lv * 2), cellAt(w, x, lv * 2 + 1)];
}

export function openSlot(w: World, x: number, lv: number) {
  w.grid[idx(w, x, lv * 2)] = T_AIR;
  w.grid[idx(w, x, lv * 2 + 1)] = T_AIR;
}
