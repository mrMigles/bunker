// Deterministic seeded RNG (sfc32). State is a plain number[4] so it serializes with the world.
// Never use Math.random() in game logic.

export type RngState = [number, number, number, number];

export function seedState(seed: number | string): RngState {
  let h = 1779033703 ^ 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  const next = () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
  const st: RngState = [next(), next(), next(), next()];
  const r = new Rng(st);
  for (let i = 0; i < 12; i++) r.next();
  return st;
}

export class Rng {
  constructor(public s: RngState) {}

  static from(seed: number | string): Rng {
    return new Rng(seedState(seed));
  }

  /** float in [0,1) */
  next(): number {
    const s = this.s;
    let a = s[0] >>> 0,
      b = s[1] >>> 0,
      c = s[2] >>> 0,
      d = s[3] >>> 0;
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) >>> 0;
    s[0] = a;
    s[1] = b;
    s[2] = c;
    s[3] = d;
    return t / 4294967296;
  }

  /** integer in [min, max] inclusive */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  weighted<T>(items: readonly T[], weight: (t: T) => number): T | undefined {
    let total = 0;
    for (const it of items) total += Math.max(0, weight(it));
    if (total <= 0) return undefined;
    let r = this.next() * total;
    for (const it of items) {
      r -= Math.max(0, weight(it));
      if (r < 0) return it;
    }
    return items[items.length - 1];
  }

  /** d20 roll */
  d20(): number {
    return this.int(1, 20);
  }

  /** Derive an independent child seed (for sub-generators) without disturbing determinism. */
  fork(): Rng {
    return new Rng([
      (this.next() * 4294967296) >>> 0,
      (this.next() * 4294967296) >>> 0,
      (this.next() * 4294967296) >>> 0,
      (this.next() * 4294967296) >>> 0,
    ]);
  }
}

/** Stateless hash noise for procedural generation: deterministic value in [0,1) for integer coords. */
export function hash2(seed: number, x: number, y: number): number {
  let h = (seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
