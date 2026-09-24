import * as THREE from "three";
import { ITEMS } from "@bunker/shared";
import { box, canvasTex, cyl, mat, PAL } from "./palette";
import { buildLoot } from "./loot";
import { SceneryBatch } from "./scenery";

const SKIN = [0xe0b48f, 0xc99873, 0xa8764f, 0xf0c9a5, 0x8d5e3c];
export const HAIR = [0x514535, 0x231c17, 0x8a5a2b, 0xc9a86a, 0x9a9a92, 0x7a2e1e];
export const HATS = ["Кепка в цвет куртки", "Каска инженера", "Шапочка врача", "Армейская каска", "Поварской колпак", "Очки химика", "Кепка электрика", "Берет и очки", "Шахтёрская каска с фонарём", "Наушники радиста", "Соломенная шляпа", "Скуфья", "Фетровая шляпа", "Без головного убора"];

export class CharView {
  root = new THREE.Group();
  body = new THREE.Group();
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  head: THREE.Group;
  torso: THREE.Mesh;
  carry: THREE.Group;
  x = 0;
  y = 0;
  t = Math.random() * 10;
  dir = 1;
  anim = "idle";
  dead = false;
  userPrevX = 0;
  /** network smoothing: move linearly from the last shown point to the newest server point */
  net = { fx: 0, fy: 0, tx: NaN, ty: NaN, t: 0, dur: 0.05 };
  /** smoothed ground speed (cells/s) — drives the stride so feet don't slide */
  speed = 0;
  private lastX = 0;
  private carryKey = "";
  private selRing: THREE.Mesh;

  /** A resident as their card describes them (skin and hair from the editor, or a stable pick by id). */
  static of(id: string, card: { color: number; hat: number; skin?: number; hair?: number }) {
    let hsh = 0;
    for (let i = 0; i < id.length; i++) hsh = (hsh * 31 + id.charCodeAt(i)) >>> 0;
    return new CharView(id, card.color, card.hat, card.skin ?? hsh % SKIN.length, card.hair ?? (hsh >> 3) % 3);
  }

  constructor(
    public id: string,
    color: number,
    hat: number,
    skinIdx: number,
    hairIdx = 0,
  ) {
    const skin = SKIN[skinIdx % SKIN.length];
    const pants = new THREE.Color(color).multiplyScalar(0.45).getHex();
    this.legL = limb(0.15, 0.46, pants, 0.19);
    this.legR = limb(0.15, 0.46, pants, 0.19);
    this.legL.position.set(-0.11, 0.46, 0);
    this.legR.position.set(0.11, 0.46, 0);
    this.torso = box(0.46, 0.52, 0.28, color, 0, 0.44, 0);
    this.armL = limb(0.12, 0.44, color, 0.14);
    this.armR = limb(0.12, 0.44, color, 0.14);
    this.armL.position.set(-0.3, 0.92, 0);
    this.armR.position.set(0.3, 0.92, 0);
    const outfit = new SceneryBatch();
    const darkCloth = new THREE.Color(color).multiplyScalar(0.67).getHex();
    outfit.box(0.48, 0.075, 0.3, 0x403a2a, 0, 0.45, 0);
    outfit.box(0.10, 0.075, 0.025, 0xb4a77e, 0.025, 0.45, 0.164);
    outfit.box(0.14, 0.13, 0.035, darkCloth, -0.12, 0.74, 0.16);
    outfit.box(0.14, 0.027, 0.044, 0xc2af82, -0.12, 0.84, 0.16);
    outfit.box(0.025, 0.43, 0.03, darkCloth, 0.045, 0.51, 0.162);
    outfit.box(0.36, 0.36, 0.16, 0x58614a, 0, 0.58, -0.22);
    outfit.box(0.39, 0.065, 0.19, 0x727959, 0, 0.86, -0.22);
    for (const x of [-0.18, 0.18]) outfit.box(0.035, 0.43, 0.035, 0xaca079, x, 0.53, 0.16);
    outfit.finish(this.body);
    for (const leg of [this.legL, this.legR]) {
      const boot = new SceneryBatch();
      boot.box(0.19, 0.13, 0.28, 0x333a32, 0, -0.46, 0.035);
      boot.box(0.20, 0.035, 0.29, 0x222a25, 0, -0.46, 0.035);
      boot.box(0.115, 0.09, 0.035, 0x7b7660, 0, -0.2, 0.105);
      boot.finish(leg);
    }
    // hands
    this.armL.add(box(0.11, 0.1, 0.11, skin, 0, -0.52, 0));
    this.armR.add(box(0.11, 0.1, 0.11, skin, 0, -0.52, 0));
    this.head = new THREE.Group();
    this.head.position.set(0, 1.12, 0);
    this.head.add(box(0.32, 0.32, 0.3, skin, 0, -0.16, 0));
    // eyes face the camera side (+z) and the facing direction
    const eyeM = mat(0x1a1410);
    const e1 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.02), eyeM);
    const e2 = e1.clone();
    e1.position.set(-0.07, 0.03, 0.155);
    e2.position.set(0.07, 0.03, 0.155);
    this.head.add(e1, e2);
    const face = new SceneryBatch();
    face.box(0.07, 0.055, 0.035, skin, 0.01, -0.028, 0.167);
    face.box(0.08, 0.019, 0.022, 0x8e654e, 0.005, -0.092, 0.155);
    face.box(0.035, 0.09, 0.13, skin, -0.173, -0.055, -0.01);
    face.box(0.035, 0.09, 0.13, skin, 0.173, -0.055, -0.01);
    face.box(0.33, 0.1, 0.09, HAIR[hairIdx % HAIR.length], 0, 0.06, -0.126);
    if (hat === 13) face.box(0.33, 0.06, 0.3, HAIR[hairIdx % HAIR.length], 0, 0.14, -0.01); // bare head: hair on top
    face.finish(this.head);
    addHat(this.head, hat, color);
    this.body.add(this.legL, this.legR, this.torso, this.armL, this.armR, this.head);
    this.root.add(this.body);
    this.carry = new THREE.Group();
    this.carry.position.set(0, 0.62, 0.39);
    this.carry.visible = false;
    this.body.add(this.carry);
    const shadowTex = canvasTex("survivor-contact-shadow", 64, 64, (g, w, h) => {
      const gradient = g.createRadialGradient(w / 2, h / 2, 1, w / 2, h / 2, w / 2);
      gradient.addColorStop(0, "#10151099"); gradient.addColorStop(1, "#10151000");
      g.fillStyle = gradient; g.fillRect(0, 0, w, h);
    });
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.54), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.017;
    this.root.add(shadow);
    this.selRing = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.42, 20), new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.8 }));
    this.selRing.rotation.x = -Math.PI / 2;
    this.selRing.position.y = 0.03;
    this.selRing.visible = false;
    this.root.add(this.selRing);
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
  }

  setMine(v: boolean) {
    this.selRing.visible = v;
  }

  setCarry(hands: { item: string; n: number }[]) {
    const key = hands.map((h) => h.item).join(",");
    if (key === this.carryKey) return;
    this.carryKey = key;
    if (!hands.length) {
      this.carry.visible = false;
      return;
    }
    this.carry.clear();
    const prop = buildLoot(hands[0].item);
    for (const child of [...prop.children]) {
      const m = child as THREE.Mesh;
      if (m.geometry?.type === "CircleGeometry" || m.geometry?.type === "RingGeometry") {
        prop.remove(m); m.geometry.dispose();
        if (m.geometry.type === "CircleGeometry") (m.material as THREE.Material).dispose();
      }
    }
    this.carry.add(prop);
    this.carry.visible = true;
    const large = ITEMS[hands[0].item]?.large;
    this.carry.scale.setScalar(large ? 0.95 : 0.85);
  }

  /**
   * Follow a networked position: glide at constant speed from where we are to the newest
   * server point over the interval between packets (predicted own positions snap directly).
   */
  glide(tx: number, ty: number, now: number, own = false) {
    if (own) {
      this.x = tx;
      this.y = ty;
      return;
    }
    const n = this.net;
    if (tx !== n.tx || ty !== n.ty) {
      n.dur = Math.max(0.03, Math.min(0.2, n.t ? now - n.t : 0.05));
      n.t = now;
      n.fx = this.x;
      n.fy = this.y;
      n.tx = tx;
      n.ty = ty;
    }
    if (Math.abs(tx - this.x) > 3 || Math.abs(ty - this.y) > 3) {
      this.x = tx;
      this.y = ty;
      return;
    }
    const k = Math.min(1, (now - n.t) / n.dur);
    this.x = n.fx + (n.tx - n.fx) * k;
    this.y = n.fy + (n.ty - n.fy) * k;
  }

  /** one-shot gesture layered over the base pose: a swing, a shot, a flinch */
  private gesture: { k: string; t: number; dur: number } | null = null;
  private weaponKey = "";
  private weaponProp: THREE.Group | null = null;
  /** walk-cycle phase (radians); accumulated so a changing pace never jumps the legs */
  private phase = 0;
  /** walking vs standing with hysteresis: network jitter must not flicker the legs */
  private moving = false;
  private blendPrev: number[] = [];

  /** Play a short attack or reaction on top of whatever the body is doing. */
  act(k: "swing" | "stab" | "shoot" | "throw" | "hurt" | "heal", dur?: number) {
    const d = dur ?? ({ swing: 0.55, stab: 0.4, shoot: 0.5, throw: 0.6, hurt: 0.35, heal: 0.8 } as Record<string, number>)[k];
    this.gesture = { k, t: 0, dur: d };
  }

  /** Weapon held in the right hand (melee sticks along the forearm, guns point forward). */
  setWeapon(item: string | null | undefined) {
    const key = item ?? "";
    if (key === this.weaponKey) return;
    this.weaponKey = key;
    if (this.weaponProp) {
      this.armR.remove(this.weaponProp);
      this.weaponProp = null;
    }
    if (!key || key === "fists") return;
    const g = new THREE.Group();
    const steel = 0x8c9196,
      dark = 0x2c2e31,
      wood = 0x6b4424;
    switch (key) {
      case "knife":
      case "kitchen_knife":
        g.add(box(0.035, 0.1, 0.05, dark, 0, 0, 0), box(0.02, 0.2, 0.05, 0xc9ccd0, 0, -0.15, 0));
        break;
      case "pipe":
        g.add(cyl(0.035, 0.62, steel, 0, -0.26, 0, 6));
        break;
      case "crowbar":
        g.add(box(0.04, 0.6, 0.04, 0x9a2f25, 0, -0.26, 0), box(0.12, 0.04, 0.04, 0x9a2f25, 0.05, -0.56, 0));
        break;
      case "bat":
      case "axe":
        g.add(box(0.05, 0.55, 0.05, wood, 0, -0.24, 0));
        if (key === "axe") g.add(box(0.16, 0.12, 0.03, steel, 0.07, -0.48, 0));
        else g.add(box(0.08, 0.2, 0.08, wood, 0, -0.46, 0));
        break;
      case "pistol":
        g.add(box(0.05, 0.12, 0.05, dark, 0, 0, 0.02), box(0.05, 0.06, 0.2, dark, 0, -0.07, 0.1));
        break;
      case "shotgun":
      case "rifle": {
        const long = key === "rifle" ? 0.78 : 0.55;
        g.add(box(0.07, 0.09, long, dark, 0, -0.06, long / 2 - 0.12), box(0.07, 0.12, 0.22, wood, 0, -0.04, -0.2));
        break;
      }
      case "molotov":
        g.add(cyl(0.05, 0.18, 0x5d7a3a, 0, -0.1, 0, 6), box(0.03, 0.08, 0.03, 0xe0c080, 0, -0.22, 0));
        break;
      default:
        return;
    }
    g.position.set(0, -0.52, 0.02);
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    this.weaponProp = g;
    this.armR.add(g);
  }

  private get joints(): THREE.Object3D[] {
    return [this.body, this.legL, this.legR, this.armL, this.armR, this.head];
  }

  update(dt: number, anim: string, dir: number, speedMul = 1) {
    const x = this.root.position.x;
    if (dt > 0) this.speed += (Math.abs(x - this.lastX) / dt - this.speed) * Math.min(1, dt * 8);
    this.lastX = x;
    this.t += dt * speedMul;
    this.dir += (dir - this.dir) * Math.min(1, dt * 10);
    // walk/idle decided by real ground speed with hysteresis (network steps and seat snaps don't flicker legs)
    if (anim === "walk" || anim === "run" || anim === "idle") {
      if (this.moving ? this.speed < 0.18 : this.speed > 0.45) this.moving = !this.moving;
      if (!this.moving) anim = "idle";
      else if (anim === "idle") anim = "walk";
    } else this.moving = false;
    const t = this.t;
    const b = this.body;
    // remember the pose we are coming from, then build the target pose from zero
    const prev = this.blendPrev;
    let i = 0;
    for (const j of this.joints) {
      prev[i++] = j.rotation.x;
      prev[i++] = j.rotation.y;
      prev[i++] = j.rotation.z;
    }
    prev[i] = b.position.x;
    prev[i + 1] = b.position.y;
    prev[i + 2] = b.position.z;
    b.rotation.set(0, this.dir * 0.9, 0);
    b.position.set(0, 0, 0);
    this.legL.rotation.set(0, 0, 0);
    this.legR.rotation.set(0, 0, 0);
    this.armL.rotation.set(0, 0, 0);
    this.armR.rotation.set(0, 0, 0);
    this.head.rotation.set(0, 0, 0);
    this.torso.scale.y = 1;
    const carrying = this.carry.visible;
    let blendRate = 14; // how fast poses flow into each other
    switch (anim) {
      case "walk":
      case "run": {
        // one full step cycle (left + right) covers ~1.5 cells walking, ~2 cells running
        const stride = anim === "run" ? 2.0 : 1.5;
        const v = Math.max(0.6, Math.min(this.speed, 5));
        this.phase += dt * ((Math.PI * 2 * v) / stride);
        const p = this.phase;
        const a = anim === "run" ? 0.8 : 0.5;
        this.legL.rotation.x = Math.sin(p) * a;
        this.legR.rotation.x = -Math.sin(p) * a;
        this.armL.rotation.x = -Math.sin(p) * a * 0.7;
        this.armR.rotation.x = Math.sin(p) * a * 0.7;
        b.position.y = Math.abs(Math.cos(p)) * (anim === "run" ? 0.05 : 0.025);
        if (anim === "run") b.rotation.x = 0.12;
        blendRate = 30;
        break;
      }
      case "climb":
        b.rotation.y = Math.PI; // back to camera
        this.armL.rotation.x = -2.6 + Math.sin(t * 6) * 0.35;
        this.armR.rotation.x = -2.6 - Math.sin(t * 6) * 0.35;
        this.legL.rotation.x = Math.max(0, Math.sin(t * 6)) * 0.7;
        this.legR.rotation.x = Math.max(0, -Math.sin(t * 6)) * 0.7;
        blendRate = 20;
        break;
      case "work":
      case "dig":
      case "repair": {
        const s = anim === "dig" ? 6 : 4.5;
        this.armL.rotation.x = -1.2 + Math.sin(t * s) * 0.5;
        this.armR.rotation.x = -1.2 - Math.sin(t * s) * 0.5;
        b.rotation.x = 0.15 + Math.sin(t * s) * 0.05;
        blendRate = 20;
        break;
      }
      case "pedal":
        b.position.y = 0.25;
        this.legL.rotation.x = -1.2 + Math.sin(t * 7) * 0.5;
        this.legR.rotation.x = -1.2 - Math.sin(t * 7) * 0.5;
        this.armL.rotation.x = -1.1;
        this.armR.rotation.x = -1.1;
        b.rotation.x = 0.3;
        blendRate = 24;
        break;
      case "sit":
      case "read":
      case "radio":
      case "play":
      case "eat":
        b.position.y = -0.12;
        this.legL.rotation.x = -1.45;
        this.legR.rotation.x = -1.45;
        b.rotation.y = 0.2 * Math.sign(this.dir || 1);
        this.torso.scale.y = 1 + Math.sin(t * 1.6) * 0.01;
        if (anim === "read") {
          this.armL.rotation.x = -1.1;
          this.armR.rotation.x = -1.1;
          this.head.rotation.x = 0.35;
        } else if (anim === "eat") {
          this.armR.rotation.x = -1.2 - Math.max(0, Math.sin(t * 3)) * 0.8;
        } else if (anim === "radio") {
          this.armR.rotation.x = -1.3;
          this.armR.rotation.z = Math.sin(t * 1.5) * 0.15;
          this.head.rotation.z = Math.sin(t * 1.1) * 0.1;
        } else if (anim === "play") {
          this.armL.rotation.x = -1.0 + Math.sin(t * 2) * 0.15;
          this.armR.rotation.x = -1.0 - Math.sin(t * 1.7) * 0.15;
        }
        break;
      case "guitar":
        b.position.y = -0.12;
        this.legL.rotation.x = -1.45;
        this.legR.rotation.x = -1.45;
        this.armL.rotation.x = -1.2;
        this.armL.rotation.z = 0.6;
        this.armR.rotation.x = -0.9 + Math.sin(t * 9) * 0.2;
        this.head.rotation.z = Math.sin(t * 2) * 0.12;
        blendRate = 24;
        break;
      case "sleep":
      case "down":
      case "dead":
        b.rotation.set(0, 0, (Math.PI / 2) * (this.dir > 0 ? 1 : -1));
        b.position.set(0.5 * (this.dir > 0 ? 1 : -1), anim === "sleep" ? 0.42 : 0.16, 0);
        if (anim === "sleep") b.position.y += Math.sin(t * 1.5) * 0.01;
        blendRate = 6;
        break;
      case "dance":
        b.position.y = Math.abs(Math.sin(t * 5)) * 0.1;
        b.rotation.y = Math.sin(t * 2.5) * 0.8;
        this.armL.rotation.z = -1.5 - Math.sin(t * 5) * 0.5;
        this.armR.rotation.z = 1.5 + Math.sin(t * 5) * 0.5;
        this.legL.rotation.x = Math.sin(t * 5) * 0.4;
        this.legR.rotation.x = -Math.sin(t * 5) * 0.4;
        blendRate = 24;
        break;
      case "talk":
        this.armR.rotation.x = -0.5 + Math.sin(t * 3) * 0.3;
        this.armR.rotation.z = 0.2;
        this.head.rotation.z = Math.sin(t * 2.2) * 0.08;
        this.head.rotation.x = Math.sin(t * 3.1) * 0.05;
        break;
      case "yawn":
        this.armL.rotation.z = -2.6;
        this.armR.rotation.z = 2.6;
        this.head.rotation.x = -0.3;
        break;
      case "scratch":
        this.armR.rotation.x = -2.8;
        this.armR.rotation.z = 0.4 + Math.sin(t * 10) * 0.12;
        this.head.rotation.z = 0.15;
        break;
      case "pet":
        b.rotation.x = 0.5;
        this.armR.rotation.x = -1 + Math.sin(t * 4) * 0.3;
        break;
      case "breakdown":
        b.position.x = Math.sin(t * 18) * 0.03;
        this.armL.rotation.z = -2.2 + Math.sin(t * 7) * 0.4;
        this.armR.rotation.z = 2.2 - Math.sin(t * 7) * 0.4;
        blendRate = 30;
        break;
      case "cook":
        this.armR.rotation.x = -1.2;
        this.armR.rotation.z = Math.sin(t * 4) * 0.35;
        this.armL.rotation.x = -0.8;
        break;
      case "aim":
        // combat stance: weapon raised toward the facing side
        this.armR.rotation.x = -1.45;
        this.armL.rotation.x = -1.3;
        this.armL.rotation.z = -0.25;
        this.legL.rotation.x = 0.25;
        this.legR.rotation.x = -0.2;
        this.torso.scale.y = 1 + Math.sin(t * 2.4) * 0.012;
        break;
      default: {
        // idle breathing, an occasional glance around
        this.torso.scale.y = 1 + Math.sin(t * 2) * 0.015;
        this.head.rotation.y = Math.sin(t * 0.4) * 0.3;
      }
    }
    if (carrying && anim !== "sleep" && anim !== "down" && anim !== "dead") {
      this.armL.rotation.x = -1.3;
      this.armR.rotation.x = -1.3;
    }
    // one-shot gestures (attack, flinch) override the arms and lean the body
    const g = this.gesture;
    if (g && anim !== "dead" && anim !== "down") {
      g.t += dt;
      const k = Math.min(1, g.t / g.dur);
      // wind-up (0..0.35), strike (0.35..0.55), recover
      const wind = k < 0.35 ? k / 0.35 : 1;
      const strike = k < 0.35 ? 0 : k < 0.55 ? (k - 0.35) / 0.2 : 1;
      const rec = k < 0.55 ? 0 : (k - 0.55) / 0.45;
      const ease = (u: number) => u * u * (3 - 2 * u);
      const d = Math.sign(this.dir || 1);
      switch (g.k) {
        case "swing": {
          // raise the weapon overhead, bring it down across, step into the blow
          this.armR.rotation.x = -2.9 * ease(wind) * (1 - strike) - 0.9 * strike * (1 - ease(rec));
          this.armL.rotation.x = this.armR.rotation.x * 0.6;
          b.rotation.x = -0.15 * wind * (1 - strike) + 0.3 * strike * (1 - rec);
          b.rotation.y += d * (0.35 * strike * (1 - rec) - 0.25 * wind * (1 - strike));
          b.position.x += d * 0.22 * strike * (1 - ease(rec));
          this.legL.rotation.x = -0.35 * strike * (1 - rec);
          this.legR.rotation.x = 0.3 * strike * (1 - rec);
          break;
        }
        case "stab":
          this.armR.rotation.x = -0.6 - 0.9 * ease(strike) * (1 - rec) + 0.4 * wind * (1 - strike);
          b.position.x += d * 0.3 * ease(strike) * (1 - ease(rec));
          b.rotation.x = 0.2 * strike * (1 - rec);
          this.legL.rotation.x = -0.45 * strike * (1 - rec);
          break;
        case "shoot":
          // raise, fire (recoil kick), hold
          this.armR.rotation.x = -1.5 * ease(Math.min(1, k * 4)) + (k > 0.3 && k < 0.45 ? 0.35 : 0);
          this.armL.rotation.x = -1.35 * ease(Math.min(1, k * 4));
          b.position.x -= d * (k > 0.3 && k < 0.5 ? 0.06 : 0);
          this.head.rotation.x = 0.08;
          break;
        case "throw":
          this.armR.rotation.x = -2.8 * ease(wind) * (1 - strike) - 0.6 * strike * (1 - rec);
          b.rotation.y += d * 0.4 * strike * (1 - rec);
          break;
        case "hurt": {
          const s = Math.sin(k * Math.PI);
          b.rotation.x = -0.3 * s;
          b.position.x -= d * 0.12 * s;
          this.head.rotation.x = -0.35 * s;
          this.armL.rotation.z = -0.6 * s;
          this.armR.rotation.z = 0.6 * s;
          break;
        }
        case "heal":
          b.rotation.x = 0.45 * Math.sin(k * Math.PI);
          this.armL.rotation.x = -1.1;
          this.armR.rotation.x = -1.1 + Math.sin(g.t * 14) * 0.2;
          break;
      }
      if (k >= 1) this.gesture = null;
      blendRate = 40;
    }
    // blend from the previous pose into the target one: no pops between sitting, standing and walking
    const f = 1 - Math.exp(-dt * blendRate);
    i = 0;
    for (const j of this.joints) {
      const px = prev[i++],
        py = prev[i++],
        pz = prev[i++];
      j.rotation.x = px + (j.rotation.x - px) * f;
      // the body's facing already follows the smoothed `dir`
      j.rotation.y = py + (j.rotation.y - py) * (j === b ? Math.max(f, 0.35) : f);
      j.rotation.z = pz + (j.rotation.z - pz) * f;
    }
    b.position.x = prev[i] + (b.position.x - prev[i]) * f;
    b.position.y = prev[i + 1] + (b.position.y - prev[i + 1]) * f;
    b.position.z = prev[i + 2] + (b.position.z - prev[i + 2]) * f;
    const dead = anim === "dead";
    if (dead !== this.dead) {
      this.dead = dead;
      this.body.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        if (dead) {
          m.userData.mat = m.material;
          m.material = mat(0x6a6a6a);
        } else if (m.userData.mat) m.material = m.userData.mat;
      });
    }
  }
}

function limb(w: number, h: number, color: number, d: number) {
  const g = new THREE.Group();
  const m = box(w, h, d, color, 0, -h, 0);
  g.add(m);
  return g;
}

function addHat(head: THREE.Group, hat: number, color: number) {
  const top = 0.16;
  switch (hat) {
    case 1: // engineer hard hat
      head.add(cyl(0.2, 0.12, 0xe8b923, 0, top, 0, 10, 0.22));
      head.add(box(0.46, 0.03, 0.4, 0xe8b923, 0, top, 0));
      break;
    case 2: // doctor cap
      head.add(box(0.33, 0.1, 0.31, 0xf2f2ee, 0, top, 0));
      head.add(box(0.06, 0.06, 0.01, PAL.red, 0, top + 0.02, 0.16));
      break;
    case 3: // soldier helmet
      head.add(cyl(0.22, 0.13, 0x4b5a3a, 0, top - 0.02, 0, 10, 0.24));
      break;
    case 4: // cook toque
      head.add(cyl(0.16, 0.26, 0xfafafa, 0, top, 0, 10, 0.14));
      break;
    case 5: // chemist goggles
      head.add(box(0.34, 0.07, 0.05, 0x3a6a5a, 0, 0.02, 0.15));
      break;
    case 6: // electrician cap
      head.add(box(0.33, 0.08, 0.31, 0xd9772b, 0, top, 0));
      head.add(box(0.33, 0.02, 0.16, 0xd9772b, 0, top, 0.2));
      break;
    case 7: // teacher glasses + beret
      head.add(box(0.3, 0.05, 0.02, 0x222222, 0, 0.19 - 0.16 + 0.02, 0.16));
      head.add(cyl(0.19, 0.06, 0x7a2e3a, 0.03, top, 0, 10));
      break;
    case 8: // miner helmet with lamp
      head.add(cyl(0.21, 0.12, 0xb8a032, 0, top - 0.01, 0, 10, 0.23));
      head.add(box(0.08, 0.07, 0.04, 0xfff3b0, 0, top + 0.03, 0.2, mat(0xfff3b0, { emissive: 0xaa9955 })));
      break;
    case 9: // headphones
      head.add(box(0.4, 0.04, 0.06, 0x333333, 0, top + 0.02, 0));
      head.add(box(0.06, 0.12, 0.12, 0x333333, -0.19, 0.0, 0));
      head.add(box(0.06, 0.12, 0.12, 0x333333, 0.19, 0.0, 0));
      break;
    case 10: // straw hat
      head.add(cyl(0.34, 0.03, 0xd9c27a, 0, top, 0, 12));
      head.add(cyl(0.17, 0.12, 0xd9c27a, 0, top + 0.02, 0, 10));
      break;
    case 11: // priest skufia
      head.add(cyl(0.17, 0.1, 0x151515, 0, top, 0, 10));
      break;
    case 12: // fedora
      head.add(cyl(0.28, 0.02, 0x3a2f28, 0, top, 0, 12));
      head.add(cyl(0.17, 0.14, 0x3a2f28, 0, top + 0.01, 0, 10, 0.18));
      break;
    case 13: // bareheaded
      break;
    default:
      head.add(box(0.33, 0.06, 0.31, color, 0, top, 0));
  }
}
