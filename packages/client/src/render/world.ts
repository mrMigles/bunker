import * as THREE from "three";
import type { View } from "../net";
import { CharView } from "./chars";
import { buildObject, vkey } from "./objects";
import { PAL, box, mat, vhash } from "./palette";
import { DEPTH, TerrainLayer } from "./terrain";
import { SceneryBatch, batchStaticBoxes, buildSiteProp, sceneSign } from "./scenery";
import { buildLoot } from "./loot";
import { postfx } from "./postfx";

export const CHAR_Z = -0.45;

interface ObjEntry {
  key: string;
  g: THREE.Group;
}

export class WorldRenderer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.OrthographicCamera;
  terrain = new TerrainLayer();
  objs = new Map<string, ObjEntry>();
  chars = new Map<string, CharView>();
  items = new Map<string, THREE.Group>();
  lamps: THREE.PointLight[] = [];
  bulbs = new THREE.Group();
  fires = new THREE.Group();
  floods = new THREE.Group();
  dirtLayer = new THREE.Group();
  surface = new THREE.Group();
  parallax: THREE.Group[] = [];
  ash: THREE.Points;
  pet: THREE.Group | null = null;
  petKind = "";
  // camera state
  camX = 24;
  camY = -3;
  viewH = 9; // world units visible vertically
  follow = true;
  shake = 0;
  flash = 0;
  /** seconds of flickering lamps left (a power hiccup) */
  flicker = 0;
  private critters: { g: THREE.Group; x: number; lv: number; dir: number; speed: number; until: number }[] = [];
  private dust: { p: THREE.Points; until: number }[] = [];

  /** A few rats dart along a room's floor. */
  rats(x: number, lv: number, w: number, n: number, dir: number) {
    for (let i = 0; i < n; i++) {
      const g = new THREE.Group();
      g.add(box(0.26, 0.1, 0.12, 0x4a3f38, 0, 0, 0), box(0.1, 0.08, 0.09, 0x5a4d44, 0.15 * dir, 0.02, 0), box(0.18, 0.02, 0.02, 0x8a6f64, -0.2 * dir, 0.03, 0));
      const sx = dir > 0 ? x - 0.5 - i * 0.6 : x + w + 0.5 + i * 0.6;
      g.position.set(sx, -(lv * 2 + 2) + 0.2, 0.9);
      this.scene.add(g);
      this.critters.push({ g, x: sx, lv, dir, speed: 3.2 + Math.random() * 1.5, until: this.time + (w + 2) / 3 + 1.5 });
    }
  }

  /** Dust shaken loose from the ceilings, falling in the rooms around the camera. */
  dustFall() {
    const n = 260;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = this.camX + (Math.random() - 0.5) * 26;
      const lv = Math.round(-this.camY / 2 + (Math.random() - 0.5) * 4);
      arr[i * 3 + 1] = -(lv * 2) - 0.05 - Math.random() * 0.4;
      arr[i * 3 + 2] = 0.2 + Math.random() * 1.4;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    const p = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xb8ab94, size: 2.5, sizeAttenuation: false, transparent: true, opacity: 0.85, depthWrite: false }));
    this.scene.add(p);
    this.dust.push({ p, until: this.time + 3.5 });
  }

  private tickCritters(dt: number) {
    for (const c of this.critters) {
      c.x += c.dir * c.speed * dt;
      c.g.position.x = c.x;
      c.g.position.y = -(c.lv * 2 + 2) + 0.2 + Math.abs(Math.sin(this.time * 30 + c.x)) * 0.03;
      c.g.rotation.y = c.dir > 0 ? 0 : Math.PI;
    }
    for (const c of this.critters.filter((c) => this.time > c.until)) this.scene.remove(c.g);
    this.critters = this.critters.filter((c) => this.time <= c.until);
    for (const d of this.dust) {
      const pos = d.p.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) - dt * (0.6 + (i % 5) * 0.2));
      pos.needsUpdate = true;
      (d.p.material as THREE.PointsMaterial).opacity = Math.max(0, Math.min(0.85, d.until - this.time));
    }
    for (const d of this.dust.filter((d) => this.time > d.until)) {
      this.scene.remove(d.p);
      d.p.geometry.dispose();
    }
    this.dust = this.dust.filter((d) => this.time <= d.until);
  }
  ambient: THREE.AmbientLight;
  hemi: THREE.HemisphereLight;
  sky: THREE.Mesh;
  time = 0;
  lampFlicker = 0;
  shadows = true;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color(0x0e0b0a);
    this.camera = new THREE.OrthographicCamera(-10, 10, 7, -7, 0.1, 100);
    this.camera.position.set(24, -3, 30);
    this.ambient = new THREE.AmbientLight(0xc0ad91, 1.1);
    this.hemi = new THREE.HemisphereLight(0xc4c3a4, 0x483c2d, 0.85);
    this.scene.add(this.ambient, this.hemi);
    const dir = new THREE.DirectionalLight(0xffd39a, 0.65);
    dir.position.set(10, 20, 30);
    this.scene.add(dir);
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(PAL.lamp, 0, 9, 1.4);
      l.castShadow = false;
      l.shadow.mapSize.set(256, 256);
      l.shadow.bias = -0.01;
      this.lamps.push(l);
      this.scene.add(l);
    }
    this.scene.add(this.terrain.group, this.bulbs, this.fires, this.floods, this.dirtLayer, this.surface);
    const panorama = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}assets/wasteland-panorama.png`);
    panorama.colorSpace = THREE.SRGBColorSpace;
    this.sky = new THREE.Mesh(new THREE.PlaneGeometry(35, 19.7), new THREE.MeshBasicMaterial({ map: panorama, toneMapped: false }));
    this.sky.position.set(24, -1.6, -30);
    this.scene.add(this.sky);
    this.buildSurface();
    // ash particles
    const n = 500;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = Math.random() * 80 - 16;
      pos[i * 3 + 1] = Math.random() * 16;
      pos[i * 3 + 2] = -Math.random() * 8;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.ash = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xbbb0a0, size: 0.08, transparent: true, opacity: 0.7 }));
    this.scene.add(this.ash);
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  private portraitScale = 1;

  resize() {
    const w = window.innerWidth,
      h = window.innerHeight;
    // Preserve the player's zoom when rotating, but show several rooms on a phone,
    // not a portrait crop of the landscape camera.
    const scale = document.documentElement.classList.contains("mobile") ? Math.max(1, 1.1 * h / w) : 1;
    this.viewH *= scale / this.portraitScale;
    this.portraitScale = scale;
    this.renderer.setSize(w, h, false);
    this.updateCamera();
  }

  updateCamera() {
    const aspect = window.innerWidth / window.innerHeight;
    const hh = this.viewH / 2;
    this.camera.left = -hh * aspect;
    this.camera.right = hh * aspect;
    this.camera.top = hh;
    this.camera.bottom = -hh;
    this.camera.updateProjectionMatrix();
  }

  buildSurface() {
    const s = this.surface;
    const batch = new SceneryBatch();
    const b = batch.box.bind(batch);
    b(120, 0.24, DEPTH + 6, 0x544536, 24, -0.05, -3);
    for (let i = 0; i < 90; i++) {
      const x = -30 + i * 1.2 + vhash(i) * 1.0;
      b(0.22 + vhash(i, 2) * 0.55, 0.12 + vhash(i, 3) * 0.22, 0.4, [0x75634f, 0x494336, 0x80634b][i % 3], x, 0.14, -0.5 - vhash(i, 5) * 3, (vhash(i, 8) - 0.5) * 0.7);
    }
    // The skyline is an authored silhouette strip, batched instead of hundreds of meshes.
    for (let i = 0; i < 30; i++) {
      const x = -30 + i * 3.2;
      const ht = 0.25 + vhash(i, 53) * 0.8;
      b(0.8 + vhash(i, 54) * 1.8, ht, 0.8, i % 3 ? 0xa67c58 : 0x927559, x, 0, -9);
      if (i % 3 === 0) b(0.22, ht + 0.25, 0.5, 0x9a7755, x + 0.2, 0, -9);
    }
    for (const x of [8, 17, 28, 38]) {
      b(0.10, 1.3, 0.12, 0x393c2f, x, 0.2, -2.8, -0.07);
      b(0.09, 0.64, 0.1, 0x393c2f, x - 0.2, 0.61, -2.8, 0.7);
      b(0.07, 0.45, 0.08, 0x393c2f, x + 0.18, 0.83, -2.8, -0.7);
    }
    for (const x of [12.5, 31.5]) {
      const car = buildSiteProp("car", true); car.position.set(x, 0.2, -2.2); car.rotation.z = -0.03; s.add(car);
    }
    const sign = sceneSign("ЛУЧШЕЕ ЗАВТРА", 2.0, 16, 0.95, "#4d4539", 0.58);
    sign.position.z = -2.9; sign.rotation.z = 0.08; s.add(sign);
    b(0.07, 0.8, 0.08, 0x393b30, 15.4, 0.16, -3);
    b(0.07, 0.8, 0.08, 0x393b30, 16.6, 0.16, -3);
    batch.finish(s);
    // hatch lid above airlock
    const hatch = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 0.15, 12), mat(0x6e6a60));
    hatch.position.set(21.5, 0.2, -0.8);
    s.add(hatch);
    s.add(box(0.12, 0.8, 0.12, PAL.red, 21.1, 0.2, -0.6));
  }

  /** Sync meshes with the current view. */
  sync(v: View, myChar: string | null) {
    this.terrain.update(v);
    // objects
    const seen = new Set<string>();
    for (const id in v.objs) {
      const o = v.objs[id];
      if (o.st?.hidden) continue;
      seen.add(id);
      const key = o.kind + "|" + vkey(o) + "|" + o.x + "|" + o.lv;
      let e = this.objs.get(id);
      if (!e || e.key !== key) {
        if (e) {
          this.scene.remove(e.g);
          e.g.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose(); });
        }
        const g = buildObject(o);
        batchStaticBoxes(g);
        g.position.set(o.x + 0.5, -(o.lv * 2 + 2) + 0.16, 0);
        this.scene.add(g);
        e = { key, g };
        this.objs.set(id, e);
      }
      e.g.userData.on = o.on;
      e.g.userData.kind = o.kind;
    }
    for (const [id, e] of this.objs) {
      if (!seen.has(id)) {
        this.scene.remove(e.g);
        e.g.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose(); });
        this.objs.delete(id);
      }
    }
    // characters
    const cseen = new Set<string>();
    for (const id in v.chars) {
      const c = v.chars[id];
      if (c.status === "away") continue;
      cseen.add(id);
      let cv = this.chars.get(id);
      if (!cv) {
        cv = CharView.of(id, c.card);
        cv.x = c.x;
        cv.y = c.y;
        if (c.card.age < 14) cv.root.scale.setScalar(0.7);
        this.scene.add(cv.root);
        this.chars.set(id, cv);
      }
      cv.setMine(id === myChar);
      cv.setCarry(c.hands ?? []);
    }
    for (const [id, cv] of this.chars) {
      if (!cseen.has(id)) {
        this.scene.remove(cv.root);
        this.chars.delete(id);
      }
    }
    // floor items
    const iseen = new Set<string>();
    for (const id in v.items) {
      const it = v.items[id];
      iseen.add(id);
      let sp = this.items.get(id);
      if (!sp) {
        sp = buildLoot(it.item);
        sp.scale.setScalar(0.86);
        this.scene.add(sp);
        this.items.set(id, sp);
      }
      sp.position.set(it.x, -(it.lv * 2 + 2) + 0.17, -0.15);
    }
    for (const [id, sp] of this.items) {
      if (!iseen.has(id)) {
        this.scene.remove(sp);
        this.items.delete(id);
      }
    }
    this.syncRoomFx(v);
    this.syncPet(v);
  }

  private roomFxKey = "";
  syncRoomFx(v: View) {
    const key = Object.values(v.rooms)
      .map((r: any) => `${r.id}${r.lit ? 1 : 0}${Math.floor(r.fire / 20)}${Math.floor(r.flood / 10)}${Math.floor(r.dirt / 20)}${r.state}`)
      .join();
    if (key === this.roomFxKey) return;
    this.roomFxKey = key;
    this.bulbs.clear();
    this.fires.clear();
    this.floods.clear();
    this.dirtLayer.clear();
    for (const id in v.rooms) {
      const r = v.rooms[id];
      if (r.state !== "done") continue;
      const top = -(r.lv * 2) - 0.05;
      const floor = -(r.lv * 2 + 2) + 0.16;
      if (r.type !== "support" && r.type !== "shaft") {
        const nb = Math.max(1, Math.floor(r.w / 3));
        for (let i = 0; i < nb; i++) {
          const bx = r.x + ((i + 0.5) * r.w) / nb;
          this.bulbs.add(box(0.03, 0.25, 0.03, 0x222222, bx, top - 0.25, -0.8));
          const bulb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.09, 0), r.lit ? mat(0xfff0c0, { emissive: 0xffb050 }) : mat(0x555555));
          bulb.position.set(bx, top - 0.32, -0.8);
          this.bulbs.add(bulb);
        }
      }
      if (r.fire > 0) {
        for (let i = 0; i < Math.ceil(r.fire / 15); i++) {
          const f = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.6, 5), mat(0xff7a1a, { emissive: 0xff4400, opacity: 0.85 }));
          f.position.set(r.x + 0.3 + vhash(i, r.x) * (r.w - 0.6), floor + 0.3, -0.3);
          f.userData.fire = true;
          this.fires.add(f);
        }
      }
      if (r.flood > 0) {
        const h = (r.flood / 100) * 1.8;
        const fl = box(r.w, h, DEPTH, PAL.water, r.x + r.w / 2, floor, -DEPTH / 2, mat(PAL.water, { opacity: 0.45 }));
        this.floods.add(fl);
      }
      if (r.dirt > 20) {
        const n = Math.floor(r.dirt / 12);
        for (let i = 0; i < n; i++) {
          const d = new THREE.Mesh(new THREE.CircleGeometry(0.12 + vhash(i, r.lv) * 0.15, 6), new THREE.MeshBasicMaterial({ color: 0x3a2a1a, transparent: true, opacity: 0.55 }));
          d.rotation.x = -Math.PI / 2;
          d.position.set(r.x + vhash(i, r.x + 3) * r.w, floor + 0.01, -0.2 - vhash(i, 9) * 1.2);
          this.dirtLayer.add(d);
        }
      }
    }
  }

  syncPet(v: View) {
    const p = v.pet;
    if (!p) {
      if (this.pet) this.scene.remove(this.pet);
      this.pet = null;
      return;
    }
    if (!this.pet || this.petKind !== p.kind) {
      if (this.pet) this.scene.remove(this.pet);
      const g = new THREE.Group();
      if (p.kind === "dog") {
        g.add(box(0.5, 0.22, 0.2, 0x8a6a4a, 0, 0.18, 0));
        g.add(box(0.2, 0.2, 0.18, 0x8a6a4a, 0.3, 0.3, 0));
        g.add(box(0.06, 0.1, 0.05, 0x5a3a2a, 0.3, 0.5, 0.06));
        for (const dx of [-0.18, 0.18]) g.add(box(0.06, 0.18, 0.06, 0x6a4a2a, dx, 0, 0.05));
        g.add(box(0.2, 0.04, 0.04, 0x8a6a4a, -0.32, 0.35, 0));
      } else if (p.kind === "cat") {
        g.add(box(0.36, 0.16, 0.14, 0x555555, 0, 0.12, 0));
        g.add(box(0.15, 0.15, 0.14, 0x555555, 0.22, 0.22, 0));
        g.add(box(0.04, 0.3, 0.04, 0x555555, -0.2, 0.2, 0));
      } else {
        g.add(box(0.36, 0.1, 0.22, 0x5a3a1a, 0, 0.02, 0));
        g.add(box(0.1, 0.08, 0.18, 0x3a2a1a, 0.2, 0.03, 0));
      }
      this.pet = g;
      this.petKind = p.kind;
      this.scene.add(g);
    }
    this.pet.userData.tx = p.x;
    this.pet.userData.ty = -(p.lv * 2 + 2) + 0.16;
  }

  /** Per-frame update: interpolate positions, animate, lights, camera. */
  frame(dt: number, v: View | null, myChar: string | null, pred: { x: number; y: number } | null) {
    this.time += dt;
    if (v) {
      for (const [id, cv] of this.chars) {
        const c = v.chars[id];
        if (!c) continue;
        let tx = c.x,
          ty = c.y;
        if (id === myChar && pred) {
          tx = pred.x;
          ty = pred.y;
          cv.x = tx;
          cv.y = ty;
        } else {
          // constant-speed glide between server points instead of an exponential chase (no stop-and-go)
          const n = cv.net;
          if (tx !== n.tx || ty !== n.ty) {
            const now = this.time;
            n.dur = Math.max(0.03, Math.min(0.2, n.t ? now - n.t : 0.05));
            n.t = now;
            n.fx = cv.x;
            n.fy = cv.y;
            n.tx = tx;
            n.ty = ty;
          }
          if (Math.abs(tx - cv.x) > 3 || Math.abs(ty - cv.y) > 3) {
            cv.x = tx;
            cv.y = ty;
          } else {
            const k = Math.min(1, (this.time - n.t) / n.dur);
            cv.x = n.fx + (n.tx - n.fx) * k;
            cv.y = n.fy + (n.ty - n.fy) * k;
          }
        }
        cv.root.position.set(cv.x, -cv.y + 0.16, CHAR_Z + (c.climbing ? -0.2 : 0));
        let anim = c.anim;
        if (c.status === "dead") anim = "dead";
        else if (c.status === "down") anim = "down";
        else if (c.status === "breakdown") anim = "breakdown";
        if (id === myChar && pred) {
          // local animation from predicted motion
          const moving = Math.abs(pred.x - cv.userPrevX) > 0.001;
          if (moving && !c.task && c.status === "ok") anim = c.run ? "run" : "walk";
          else if (!c.task && (anim === "walk" || anim === "run")) anim = "idle";
          if (c.climbing) anim = "climb";
          cv.userPrevX = pred.x;
        }
        cv.update(dt, anim, c.dir ?? 1, 1);
      }
      // pet
      if (this.pet) {
        const tx = this.pet.userData.tx ?? 0,
          ty = this.pet.userData.ty ?? 0;
        const px = this.pet.position.x;
        this.pet.position.x += (tx - px) * Math.min(1, dt * 6);
        this.pet.position.y = ty + (Math.abs(tx - px) > 0.02 ? Math.abs(Math.sin(this.time * 12)) * 0.04 : 0);
        this.pet.position.z = -0.2;
        this.pet.rotation.y = tx - px > 0.01 ? 0 : tx - px < -0.01 ? Math.PI : this.pet.rotation.y;
      }
    }
    // spinning fans, sparks, fire flicker
    for (const e of this.objs.values()) {
      if (e.g.userData.on) {
        const f = e.g.getObjectByName("fan");
        if (f) f.rotation.z += dt * 8;
      }
      const blink = e.g.getObjectByName("blink");
      if (blink) blink.visible = Math.sin(this.time * 9) > -0.2;
    }
    for (const f of this.fires.children) {
      f.scale.y = 0.8 + Math.sin(this.time * 20 + f.position.x * 7) * 0.25;
      f.scale.x = 0.9 + Math.sin(this.time * 13 + f.position.x) * 0.15;
    }
    // ash
    const pos = this.ash.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      let y = pos.getY(i) - dt * (0.3 + (i % 5) * 0.08);
      let x = pos.getX(i) + Math.sin(this.time + i) * dt * 0.2;
      if (y < 0.2) {
        y = 16;
        x = this.camX - 30 + ((i * 7.3) % 60);
      }
      pos.setXYZ(i, x, y, pos.getZ(i));
    }
    pos.needsUpdate = true;
    // camera follow
    if (this.follow && v && myChar && v.chars[myChar]) {
      const cv = this.chars.get(myChar);
      if (cv) {
        const tx = cv.x,
          ty = -cv.y + 1;
        this.camX += (tx - this.camX) * Math.min(1, dt * 4);
        this.camY += (ty - this.camY) * Math.min(1, dt * 4);
      }
    }
    this.camX = Math.max(-6, Math.min(54, this.camX));
    this.camY = Math.max(-34, Math.min(8, this.camY));
    let sx = 0,
      sy = 0;
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 1.5);
      sx = (Math.random() - 0.5) * this.shake * 0.6;
      sy = (Math.random() - 0.5) * this.shake * 0.6;
    }
    this.camera.position.set(this.camX + sx + 3.6, this.camY + sy + 2.6, 30);
    this.camera.lookAt(this.camX + sx, this.camY + sy, 0);
    for (let i = 0; i < this.parallax.length; i++) this.parallax[i].position.x = (this.camX - 24) * (i === 0 ? 0.35 : 0.6);
    this.sky.position.x = this.camX * 0.84 + 3.84 - 3.6;
    this.sky.position.y = -4.2;
    this.sky.quaternion.copy(this.camera.quaternion);
    this.updateLamps(v);
    this.tickCritters(dt);
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 0.8);
      this.ambient.intensity = 1.1 + this.flash * 8;
    }
    postfx(this.renderer).render(this.scene, this.camera);
  }

  updateLamps(v: View | null) {
    if (!v) return;
    const rooms = Object.values(v.rooms).filter((r: any) => r.state === "done" && r.lit && r.type !== "support" && r.type !== "shaft") as any[];
    rooms.sort((a, b) => Math.hypot(a.x + a.w / 2 - this.camX, -(a.lv * 2 + 1) - this.camY) - Math.hypot(b.x + b.w / 2 - this.camX, -(b.lv * 2 + 1) - this.camY));
    const lowPower = v.power && v.power.battery < 0.3 && v.power.gen < v.power.demand;
    for (let i = 0; i < this.lamps.length; i++) {
      const l = this.lamps[i];
      const r = rooms[i];
      if (!r) {
        l.intensity = 0;
        continue;
      }
      l.position.set(r.x + r.w / 2, -(r.lv * 2) - 0.5, 1.5);
      l.castShadow = false; // Contact shadows and light pools avoid six cubemap passes per bulb.
      let inten = 2.8 + Math.min(1, r.w * 0.15);
      if (lowPower) inten *= 0.5 + (Math.sin(this.time * 23 + i * 3) > 0.6 ? 0 : 0.5);
      if (this.flicker > 0) inten *= Math.sin(this.time * 31 + i * 5) > 0.2 ? 0.15 : 1;
      if (v.phase === "night") inten *= 0.55;
      l.intensity = inten;
      l.distance = Math.max(6, r.w * 1.6);
    }
    this.flicker = Math.max(0, this.flicker - 1 / 60);
    const dark = v.phase === "night" ? 0.6 : 1;
    (this.sky.material as THREE.MeshBasicMaterial).color.setRGB(dark === 1 ? 1 : 0.22, dark === 1 ? 1 : 0.29, dark === 1 ? 1 : 0.4);
    this.ambient.intensity = (this.flash > 0 ? this.ambient.intensity : 1.05 * dark);
  }

  /** World → screen pixel coordinates. */
  toScreen(x: number, y: number, z = 0): [number, number] {
    const p = new THREE.Vector3(x, y, z).project(this.camera);
    return [((p.x + 1) / 2) * window.innerWidth, ((1 - p.y) / 2) * window.innerHeight];
  }

  /** Screen → world (on z=0 plane). */
  toWorld(sx: number, sy: number): [number, number] {
    const nx = (sx / window.innerWidth) * 2 - 1;
    const ny = -(sy / window.innerHeight) * 2 + 1;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const p = new THREE.Vector3();
    ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), p);
    return [p.x, p.y];
  }
}
