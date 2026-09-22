// Structural JSON delta protocol used to sync the (plain-object) world view to clients.
//
// A patch is an object mirroring the shape of the target:
//   - a key present with a value → set/merge
//   - DEL marker → delete key
//   - arrays: replaced wholesale, except primitive arrays of equal length with few changes,
//     which are sent as { "~a": [[index, value], ...] } (used for the terrain grid).
// Snapshots are deep clones of the last sent view, so diffing is purely value-based.

export const DEL = "~d";
const ARR = "~a";

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

function isObj(v: unknown): v is Record<string, any> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function clone<T>(v: T): T {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) {
    const out = new Array(v.length);
    for (let i = 0; i < v.length; i++) out[i] = clone(v[i]);
    return out as any;
  }
  const out: any = {};
  for (const k in v as any) {
    const x = (v as any)[k];
    if (x !== undefined) out[k] = clone(x);
  }
  return out;
}

function eqPrim(a: unknown, b: unknown) {
  return a === b || (Number.isNaN(a) && Number.isNaN(b));
}

function arraysEqual(a: any[], b: any[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i],
      y = b[i];
    if (x !== null && typeof x === "object") {
      if (y === null || typeof y !== "object") return false;
      if (Array.isArray(x)) {
        if (!Array.isArray(y) || !arraysEqual(x, y)) return false;
      } else if (Array.isArray(y) || diff(x, y) !== undefined) return false;
    } else if (!eqPrim(x, y)) return false;
  }
  return true;
}

/** Returns a patch turning `prev` into `next`, or undefined when equal. Both must be objects. */
export function diff(prev: Record<string, any>, next: Record<string, any>): Record<string, any> | undefined {
  let out: Record<string, any> | undefined;
  for (const k in next) {
    const n = next[k];
    if (n === undefined) continue;
    const p = prev[k];
    let d: any = undefined;
    let changed = false;
    if (isObj(n)) {
      if (isObj(p)) {
        d = diff(p, n);
        changed = d !== undefined;
      } else {
        d = clone(n);
        changed = true;
      }
    } else if (Array.isArray(n)) {
      if (Array.isArray(p)) {
        if (!arraysEqual(p, n)) {
          changed = true;
          d = arrayPatch(p, n);
        }
      } else {
        changed = true;
        d = clone(n);
      }
    } else if (!eqPrim(p, n) || !(k in prev)) {
      changed = true;
      d = n;
    }
    if (changed) (out ??= {})[k] = d;
  }
  for (const k in prev) {
    if (prev[k] !== undefined && (next[k] === undefined || !(k in next))) (out ??= {})[k] = DEL;
  }
  return out;
}

function arrayPatch(p: any[], n: any[]): any {
  if (p.length === n.length && n.length >= 32) {
    const ch: [number, any][] = [];
    for (let i = 0; i < n.length; i++) {
      const x = n[i];
      if (typeof x === "object" && x !== null) return clone(n);
      if (!eqPrim(p[i], x)) {
        ch.push([i, x]);
        if (ch.length > n.length / 3) return clone(n);
      }
    }
    return { [ARR]: ch };
  }
  return clone(n);
}

/** Applies a patch in place, returns the target. */
export function applyPatch(target: Record<string, any>, patch: Record<string, any>): Record<string, any> {
  for (const k in patch) {
    const v = patch[k];
    if (v === DEL) {
      delete target[k];
    } else if (isObj(v)) {
      if (ARR in v && Array.isArray(target[k])) {
        const arr = target[k] as any[];
        for (const [i, x] of v[ARR] as [number, any][]) arr[i] = x;
      } else if (isObj(target[k])) {
        applyPatch(target[k], v);
      } else {
        target[k] = applyPatch({}, v);
      }
    } else {
      target[k] = Array.isArray(v) ? clone(v) : v;
    }
  }
  return target;
}
