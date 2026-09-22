import * as THREE from "three";
import { ITEMS } from "@bunker/shared";
import { box, cyl, glyphTex, mat, PAL } from "./palette";

const SKIN = [0xe0b48f, 0xc99873, 0xa8764f, 0xf0c9a5, 0x8d5e3c];

export class CharView {
  root = new THREE.Group();
  body = new THREE.Group();
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  head: THREE.Group;
  torso: THREE.Mesh;
  carry: THREE.Sprite;
  x = 0;
  y = 0;
  t = Math.random() * 10;
  dir = 1;
  anim = "idle";
  dead = false;
  userPrevX = 0;
  private carryKey = "";
  private selRing: THREE.Mesh;

  constructor(
    public id: string,
    color: number,
    hat: number,
    skinIdx: number,
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
    addHat(this.head, hat, color);
    this.body.add(this.legL, this.legR, this.torso, this.armL, this.armR, this.head);
    this.root.add(this.body);
    this.carry = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
    this.carry.scale.set(0.45, 0.45, 1);
    this.carry.position.set(0, 0.75, 0.3);
    this.carry.visible = false;
    this.root.add(this.carry);
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
    const icon = ITEMS[hands[0].item]?.icon ?? "📦";
    (this.carry.material as THREE.SpriteMaterial).map = glyphTex(icon);
    (this.carry.material as THREE.SpriteMaterial).needsUpdate = true;
    this.carry.visible = true;
    const large = ITEMS[hands[0].item]?.large;
    this.carry.scale.setScalar(large ? 0.6 : 0.4);
  }

  /** Animate pose. */
  update(dt: number, anim: string, dir: number, speedMul = 1) {
    this.t += dt * speedMul;
    this.dir += (dir - this.dir) * Math.min(1, dt * 10);
    const t = this.t;
    const b = this.body;
    // reset
    b.rotation.set(0, this.dir * 0.9, 0);
    b.position.set(0, 0, 0);
    this.legL.rotation.set(0, 0, 0);
    this.legR.rotation.set(0, 0, 0);
    this.armL.rotation.set(0, 0, 0);
    this.armR.rotation.set(0, 0, 0);
    this.head.rotation.set(0, 0, 0);
    const carrying = this.carry.visible;
    switch (anim) {
      case "walk":
      case "run": {
        const f = anim === "run" ? 14 : 9;
        const a = anim === "run" ? 0.9 : 0.6;
        this.legL.rotation.x = Math.sin(t * f) * a;
        this.legR.rotation.x = -Math.sin(t * f) * a;
        this.armL.rotation.x = -Math.sin(t * f) * a * 0.8;
        this.armR.rotation.x = Math.sin(t * f) * a * 0.8;
        b.position.y = Math.abs(Math.sin(t * f)) * 0.05;
        break;
      }
      case "climb":
        b.rotation.y = Math.PI; // back to camera
        this.armL.rotation.x = -2.6 + Math.sin(t * 8) * 0.4;
        this.armR.rotation.x = -2.6 - Math.sin(t * 8) * 0.4;
        this.legL.rotation.x = Math.max(0, Math.sin(t * 8)) * 0.8;
        this.legR.rotation.x = Math.max(0, -Math.sin(t * 8)) * 0.8;
        break;
      case "work":
      case "dig":
      case "repair": {
        const s = anim === "dig" ? 10 : 7;
        this.armL.rotation.x = -1.2 + Math.sin(t * s) * 0.6;
        this.armR.rotation.x = -1.2 - Math.sin(t * s) * 0.6;
        b.rotation.x = 0.15 + Math.sin(t * s) * 0.05;
        break;
      }
      case "pedal":
        b.position.y = 0.25;
        this.legL.rotation.x = -1.2 + Math.sin(t * 10) * 0.5;
        this.legR.rotation.x = -1.2 - Math.sin(t * 10) * 0.5;
        this.armL.rotation.x = -1.1;
        this.armR.rotation.x = -1.1;
        b.rotation.x = 0.3;
        break;
      case "sit":
      case "read":
      case "radio":
      case "play":
      case "eat":
        b.position.y = -0.12;
        this.legL.rotation.x = -1.45;
        this.legR.rotation.x = -1.45;
        b.rotation.y = 0.2 * this.dir;
        if (anim === "read") {
          this.armL.rotation.x = -1.1;
          this.armR.rotation.x = -1.1;
          this.head.rotation.x = 0.35;
        } else if (anim === "eat") {
          this.armR.rotation.x = -1.2 - Math.max(0, Math.sin(t * 4)) * 0.8;
        } else if (anim === "radio") {
          this.armR.rotation.x = -1.3;
          this.armR.rotation.z = Math.sin(t * 2) * 0.2;
          this.head.rotation.z = Math.sin(t * 1.5) * 0.12;
        } else if (anim === "play") {
          this.armL.rotation.x = -1.0 + Math.sin(t * 3) * 0.2;
          this.armR.rotation.x = -1.0 - Math.sin(t * 2.3) * 0.2;
        }
        break;
      case "guitar":
        b.position.y = -0.12;
        this.legL.rotation.x = -1.45;
        this.legR.rotation.x = -1.45;
        this.armL.rotation.x = -1.2;
        this.armL.rotation.z = 0.6;
        this.armR.rotation.x = -0.9 + Math.sin(t * 12) * 0.25;
        this.head.rotation.z = Math.sin(t * 2) * 0.15;
        break;
      case "sleep":
      case "down":
      case "dead":
        b.rotation.set(0, 0, Math.PI / 2 * (this.dir > 0 ? 1 : -1));
        b.position.set(0.5 * (this.dir > 0 ? 1 : -1), anim === "sleep" ? 0.42 : 0.16, 0);
        if (anim === "sleep") b.position.y += Math.sin(t * 1.5) * 0.01;
        break;
      case "dance":
        b.position.y = Math.abs(Math.sin(t * 6)) * 0.12;
        b.rotation.y = Math.sin(t * 3) * 0.8;
        this.armL.rotation.z = -1.5 - Math.sin(t * 6) * 0.5;
        this.armR.rotation.z = 1.5 + Math.sin(t * 6) * 0.5;
        this.legL.rotation.x = Math.sin(t * 6) * 0.4;
        this.legR.rotation.x = -Math.sin(t * 6) * 0.4;
        break;
      case "yawn":
        this.armL.rotation.z = -2.6;
        this.armR.rotation.z = 2.6;
        this.head.rotation.x = -0.3;
        break;
      case "scratch":
        this.armR.rotation.x = -2.8;
        this.armR.rotation.z = 0.4 + Math.sin(t * 14) * 0.15;
        this.head.rotation.z = 0.15;
        break;
      case "pet":
        b.rotation.x = 0.5;
        this.armR.rotation.x = -1 + Math.sin(t * 5) * 0.3;
        break;
      case "breakdown":
        b.position.x = Math.sin(t * 25) * 0.04;
        this.armL.rotation.z = -2.2 + Math.sin(t * 9) * 0.4;
        this.armR.rotation.z = 2.2 - Math.sin(t * 9) * 0.4;
        break;
      case "cook":
        this.armR.rotation.x = -1.2;
        this.armR.rotation.z = Math.sin(t * 6) * 0.4;
        this.armL.rotation.x = -0.8;
        break;
      default: {
        // idle breathing
        this.torso.scale.y = 1 + Math.sin(t * 2) * 0.015;
        this.head.rotation.y = Math.sin(t * 0.4) * 0.3;
      }
    }
    if (carrying && anim !== "sleep" && anim !== "down" && anim !== "dead") {
      this.armL.rotation.x = -1.3;
      this.armR.rotation.x = -1.3;
    }
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
    default:
      head.add(box(0.33, 0.06, 0.31, color, 0, top, 0));
  }
}
