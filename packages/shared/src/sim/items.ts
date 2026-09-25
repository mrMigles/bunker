import { BAL } from "../data/balance";
import { ITEMS, UNPACK, itemName } from "../data/items";
import type { Char, FloorItem, World } from "../types";
import { objsOfKind, newId } from "../world/rooms";
import { fx } from "./util";

export function isLarge(item: string) {
  return !!ITEMS[item]?.large;
}

export function canHold(c: Char, item: string): boolean {
  if (c.hands.some((h) => isLarge(h.item))) return false;
  if (isLarge(item)) return c.hands.length === 0;
  if (c.hands.some((h) => h.item === item)) return true;
  return c.hands.length < 3;
}

/** Why the hands cannot take this item, in words a player understands (null when they can). */
export function holdReason(c: Char, item: string): string | null {
  if (canHold(c, item)) return null;
  const big = c.hands.find((h) => isLarge(h.item));
  if (big) return `в руках тяжёлое (${itemName(big.item)}) — сначала отнесите`;
  if (isLarge(item)) return "тяжёлое: нужны пустые руки";
  return "руки заняты: 3 из 3";
}

export function give(c: Char, item: string, n = 1): boolean {
  if (!canHold(c, item)) return false;
  const h = c.hands.find((x) => x.item === item);
  if (h && !isLarge(item)) h.n += n;
  else c.hands.push({ item, n });
  return true;
}

export function spawnItem(w: World, item: string, n: number, x: number, lv: number): FloorItem {
  // merge with a nearby identical small pile
  if (!isLarge(item)) {
    for (const id in w.items) {
      const it = w.items[id];
      if (it.item === item && it.lv === lv && Math.abs(it.x - x) < 0.6) {
        it.n += n;
        return it;
      }
    }
  }
  const it: FloorItem = { id: newId(w, "i"), item, n, x, lv };
  w.items[it.id] = it;
  return it;
}

export function dropHands(w: World, c: Char) {
  let dx = 0;
  for (const h of c.hands) {
    if (isLarge(h.item)) for (let i = 0; i < h.n; i++) spawnItem(w, h.item, 1, c.x + c.dir * 0.3 + dx, c.lv);
    else spawnItem(w, h.item, h.n, c.x + c.dir * 0.3 + dx, c.lv);
    dx += 0.15;
  }
  c.hands = [];
}

export function storageCap(w: World) {
  return BAL.baseStorage + objsOfKind(w, "shelf").length * BAL.storagePerShelf;
}

const UNCOUNTED = new Set(["water", "water_dirty"]);

export function storedCount(w: World) {
  let n = 0;
  for (const k in w.res) if (!UNCOUNTED.has(k)) n += w.res[k] ?? 0;
  return n;
}

export function isStorable(item: string) {
  const d = ITEMS[item];
  if (UNPACK[item]) return true;
  if (!d) return item.startsWith("dish_");
  return d.store !== false;
}

/** Moves storable items from hands into shared storage. Returns what was stored. */
export function storeHands(w: World, c: Char): string[] {
  const out: string[] = [];
  const keep: typeof c.hands = [];
  for (const h of c.hands) {
    if (!isStorable(h.item)) {
      keep.push(h);
      continue;
    }
    const room = storageCap(w) - storedCount(w);
    if (room <= 0 && !UNCOUNTED.has(h.item)) {
      keep.push(h);
      fx(w, { k: "float", x: c.x, lv: c.lv, text: "Склад полон!", color: "#ff8a6a" });
      continue;
    }
    const unpack = UNPACK[h.item];
    if (unpack) {
      for (const k in unpack) addRes(w, k, unpack[k] * h.n);
      out.push(`${itemName(h.item)} → ${Object.keys(unpack).map((k) => itemName(k)).join(", ")}`);
    } else {
      addRes(w, h.item, h.n);
      out.push(`+${h.n} ${itemName(h.item)}`);
    }
  }
  c.hands = keep;
  return out;
}

export function addRes(w: World, k: string, n: number) {
  w.res[k] = Math.max(0, (w.res[k] ?? 0) + n);
}

export function hasRes(w: World, cost: Record<string, number>) {
  for (const k in cost) if ((w.res[k] ?? 0) + 1e-6 < cost[k]) return false;
  return true;
}

export function payRes(w: World, cost: Record<string, number>) {
  for (const k in cost) w.res[k] = Math.max(0, (w.res[k] ?? 0) - cost[k]);
}

export function costText(cost: Record<string, number>) {
  return Object.keys(cost)
    .map((k) => `${ITEMS[k]?.icon ?? ""}${cost[k]} ${itemName(k)}`)
    .join(", ");
}

export function missingText(w: World, cost: Record<string, number>) {
  const miss: string[] = [];
  for (const k in cost) {
    const have = w.res[k] ?? 0;
    if (have < cost[k]) miss.push(`${itemName(k)} ${Math.floor(have)}/${cost[k]}`);
  }
  return miss.length ? "Не хватает: " + miss.join(", ") : "";
}

/** Nutrition value of a resource key. */
export function nutOf(k: string): number {
  if (k.startsWith("dish_")) return DISH_NUT[k] ?? 1.2;
  return ITEMS[k]?.cat === "food" ? (ITEMS[k].nut ?? 0) : 0;
}

export const DISH_NUT: Record<string, number> = {};
export const DISH_SANITY: Record<string, number> = {};

export function foodUnits(w: World) {
  let t = 0;
  for (const k in w.res) t += (w.res[k] ?? 0) * nutOf(k);
  return t;
}

/** Takes food from storage worth ~`units` nutrition, preferring dishes, then perishable raw food. Returns [nutrition, sanity, names]. */
export function takeFood(w: World, units: number, preferTasty = true): [number, number, string[]] {
  let got = 0;
  let san = 0;
  const names: string[] = [];
  const keys = Object.keys(w.res).filter((k) => nutOf(k) > 0.04 && (w.res[k] ?? 0) >= 1);
  keys.sort((a, b) => {
    const da = a.startsWith("dish_") ? 0 : 1,
      db = b.startsWith("dish_") ? 0 : 1;
    if (preferTasty && da !== db) return da - db;
    const sa = ITEMS[a]?.spoil ?? 999,
      sb = ITEMS[b]?.spoil ?? 999;
    return sa - sb;
  });
  for (const k of keys) {
    while (got < units - 0.05 && (w.res[k] ?? 0) >= 1) {
      w.res[k] -= 1;
      got += nutOf(k);
      san += k.startsWith("dish_") ? (DISH_SANITY[k] ?? 3) : (ITEMS[k]?.sanity ?? 0);
      if (!names.includes(itemName(k))) names.push(itemName(k));
    }
    if (got >= units - 0.05) break;
  }
  return [got, san, names];
}
