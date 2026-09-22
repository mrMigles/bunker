import * as THREE from "three";

// Palette (§11): rust orange, swamp green, concrete grey, emergency red, warm incandescent light.
export const PAL = {
  rust: 0xc8553d,
  rustDark: 0x8a3b2a,
  swamp: 0x5a7d4a,
  swampDark: 0x3b5232,
  concrete: 0x8c8a80,
  concreteDark: 0x55534d,
  red: 0xd62828,
  warm: 0xffc58a,
  lamp: 0xffd9a0,
  night: 0x14100e,
  paper: 0xe8dcc0,
  ink: 0x2a2320,
  metal: 0x6b6f7a,
  metalDark: 0x3c3f46,
  wood: 0x8b5a2b,
  woodDark: 0x5e3b1c,
  cloth: 0x7b6d5a,
  plant: 0x6fae4e,
  plantDry: 0xb5a642,
  water: 0x3f7f9a,
};

export const TERRAIN_COLORS = [0x000000, 0x5b4331, 0x86583a, 0x6d6a66, 0x47474f, 0x2f5f73, 0x8c8a80, 0x231f1c];

const matCache = new Map<string, THREE.Material>();

export function mat(color: number, opts: { emissive?: number; transparent?: boolean; opacity?: number; flat?: boolean } = {}): THREE.MeshLambertMaterial {
  const key = `${color}|${opts.emissive ?? 0}|${opts.opacity ?? 1}|${opts.flat ?? true}`;
  let m = matCache.get(key) as THREE.MeshLambertMaterial | undefined;
  if (!m) {
    m = new THREE.MeshLambertMaterial({
      color,
      emissive: opts.emissive ?? 0,
      transparent: opts.transparent ?? (opts.opacity !== undefined && opts.opacity < 1),
      opacity: opts.opacity ?? 1,
      flatShading: opts.flat ?? true,
    });
    matCache.set(key, m);
  }
  return m;
}

const geoCache = new Map<string, THREE.BufferGeometry>();

export function boxGeo(w: number, h: number, d: number) {
  const key = `b${w}|${h}|${d}`;
  let g = geoCache.get(key);
  if (!g) {
    g = new THREE.BoxGeometry(w, h, d);
    geoCache.set(key, g);
  }
  return g;
}

export function cylGeo(rt: number, rb: number, h: number, seg = 8) {
  const key = `c${rt}|${rb}|${h}|${seg}`;
  let g = geoCache.get(key);
  if (!g) {
    g = new THREE.CylinderGeometry(rt, rb, h, seg);
    geoCache.set(key, g);
  }
  return g;
}

export function sphGeo(r: number, seg = 6) {
  const key = `s${r}|${seg}`;
  let g = geoCache.get(key);
  if (!g) {
    g = new THREE.IcosahedronGeometry(r, 0);
    geoCache.set(key, g);
  }
  return g;
}

/** Box mesh positioned by its bottom-center. */
export function box(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0, m?: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(boxGeo(w, h, d), m ?? mat(color));
  mesh.position.set(x, y + h / 2, z);
  return mesh;
}

export function cyl(r: number, h: number, color: number, x = 0, y = 0, z = 0, seg = 8, rb?: number): THREE.Mesh {
  const mesh = new THREE.Mesh(cylGeo(r, rb ?? r, h, seg), mat(color));
  mesh.position.set(x, y + h / 2, z);
  return mesh;
}

const texCache = new Map<string, THREE.Texture>();

export function canvasTex(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void): THREE.Texture {
  let t = texCache.get(key);
  if (t) return t;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  draw(g, w, h);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  texCache.set(key, t);
  return t;
}

/** Emoji/glyph sprite texture (for floor items, icons). */
export function glyphTex(glyph: string, bg?: string): THREE.Texture {
  return canvasTex("g" + glyph + (bg ?? ""), 64, 64, (g, w, h) => {
    if (bg) {
      g.fillStyle = bg;
      g.beginPath();
      g.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2);
      g.fill();
    }
    g.font = "44px 'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(glyph, w / 2, h / 2 + 3);
  });
}

export function hexToCss(c: number) {
  return "#" + c.toString(16).padStart(6, "0");
}

/** Simple seeded hash for visual variety (not game logic). */
export function vhash(a: number, b = 0) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}
