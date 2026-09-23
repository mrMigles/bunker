import * as THREE from "three";
import { box, cyl, mat, vhash } from "./palette";
import { SceneryBatch, addRoomKit, buildSiteProp, roomWall, sceneSign } from "./scenery";

/** Low-poly enemy figures, origin at the feet. */
export function buildEnemy(etype: string, color: number): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);
  const humanoid = (hat?: (h: THREE.Group) => void, scale = 1) => {
    const legs = [box(0.14, 0.46, 0.16, 0x333333, -0.1, 0, 0), box(0.14, 0.46, 0.16, 0x333333, 0.1, 0, 0)];
    body.add(...legs, box(0.46, 0.52, 0.28, color, 0, 0.44, 0), box(0.11, 0.44, 0.12, color, -0.3, 0.52, 0), box(0.11, 0.44, 0.12, color, 0.3, 0.52, 0));
    const head = new THREE.Group();
    head.position.y = 0.96;
    head.add(box(0.3, 0.3, 0.28, 0xc99873, 0, 0, 0));
    head.add(box(0.05, 0.05, 0.02, 0x220000, -0.07, 0.17, 0.15), box(0.05, 0.05, 0.02, 0x220000, 0.07, 0.17, 0.15));
    hat?.(head);
    body.add(head);
    body.scale.setScalar(scale);
  };
  switch (etype) {
    case "dog":
      body.add(box(0.6, 0.26, 0.24, color, 0, 0.26, 0), box(0.24, 0.24, 0.22, color, 0.36, 0.4, 0), box(0.14, 0.08, 0.14, 0x331a0a, 0.52, 0.36, 0));
      for (const [x, z] of [[-0.2, -0.08], [-0.2, 0.08], [0.2, -0.08], [0.2, 0.08]]) body.add(box(0.07, 0.26, 0.07, color, x, 0, z));
      body.add(box(0.24, 0.05, 0.05, color, -0.4, 0.44, 0));
      break;
    case "rat":
      body.add(box(0.36, 0.16, 0.18, color, 0, 0.06, 0), box(0.14, 0.12, 0.12, color, 0.24, 0.1, 0), box(0.3, 0.03, 0.03, 0xc9a0a0, -0.3, 0.12, 0));
      body.add(box(0.03, 0.03, 0.02, 0xff2020, 0.3, 0.17, 0.06, mat(0xff2020, { emissive: 0x660000 })));
      break;
    case "mole":
      body.add(box(0.6, 0.45, 0.4, color, 0, 0.1, 0), box(0.3, 0.26, 0.3, color, 0.36, 0.2, 0), box(0.12, 0.08, 0.14, 0xe0a0a0, 0.54, 0.22, 0));
      for (let i = 0; i < 3; i++) body.add(box(0.04, 0.14, 0.03, 0xdddddd, 0.36 + i * 0.05, 0.02, 0.12));
      break;
    case "drone": {
      body.position.y = 0.9;
      body.add(cyl(0.3, 0.12, 0x555a60, 0, 0, 0, 10));
      body.add(box(0.14, 0.1, 0.14, 0xff3020, 0, -0.08, 0.2, mat(0xff3020, { emissive: 0x991000 })));
      for (const [x, z] of [[-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35], [0.35, 0.35]]) body.add(cyl(0.15, 0.02, 0x222222, x, 0.1, z, 8));
      break;
    }
    case "bulldozer":
      body.add(box(1.6, 0.9, 0.9, color, 0, 0.3, 0), box(0.7, 0.55, 0.8, 0x6a5a2a, -0.2, 1.2, 0), box(0.2, 1.1, 1.0, 0x777777, 0.9, 0.15, 0));
      body.add(box(1.7, 0.3, 1.0, 0x222222, 0, 0, 0));
      body.add(box(0.12, 0.08, 0.02, 0xffdd55, 0.2, 1.4, 0.41, mat(0xffdd55, { emissive: 0x886600 })));
      break;
    case "glowing":
      humanoid(undefined, 1.05);
      body.traverse((m) => {
        if ((m as THREE.Mesh).isMesh) (m as THREE.Mesh).material = mat(0x9fe07a, { emissive: 0x3a8a20 });
      });
      break;
    case "soldier":
      humanoid((h) => h.add(cyl(0.2, 0.12, 0x3b4a2a, 0, 0.12, 0, 10, 0.22)));
      break;
    case "boss":
      humanoid((h) => h.add(box(0.34, 0.1, 0.32, 0xd4af37, 0, 0.18, 0)), 1.15);
      break;
    case "cultist":
      humanoid((h) => h.add(cyl(0.18, 0.28, 0xf2f2ee, 0, 0.1, 0, 8, 0.2)));
      break;
    case "sniper":
      humanoid((h) => h.add(box(0.34, 0.06, 0.32, 0x2a3320, 0, 0.16, 0)));
      break;
    default:
      humanoid((h) => h.add(box(0.33, 0.07, 0.31, 0x3a2a1a, 0, 0.16, 0)));
  }
  g.traverse((m) => {
    if ((m as THREE.Mesh).isMesh) m.castShadow = true;
  });
  return g;
}

export interface FieldLike {
  cols: number;
  floors: number;
  walk: boolean[];
  ladders: string[];
  covers: { col: number; floor: number; kind: string; hp: number }[];
  doors: { col: number; floor: number; closed: boolean }[];
  exits: { col: number; floor: number }[];
}

/** Stand-alone side-view stage for arena fights and expedition locations. Floor 0 is the top one. */
export class SiteRenderer {
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-10, 10, 6, -6, 0.1, 100);
  group = new THREE.Group();
  dyn = new THREE.Group();
  camX = 7;
  camY = -2;
  viewH = 10;
  private key = "";
  mode: "auto" | "street" | "ruin" = "auto";
  /** street layout (prologue): where the hatch is and what the houses are called */
  street: { hatch: number; names: string[] } | null = null;
  private panorama: THREE.Mesh;
  theme = { wall: 0x6a5f52, floor: 0x3a3028, solid: 0x2a221c, sky: 0x1a1412 };

  constructor() {
    this.scene.background = new THREE.Color(this.theme.sky);
    this.scene.add(new THREE.AmbientLight(0xc3b49a, 1.35), new THREE.HemisphereLight(0xa9c1bd, 0x58412e, 0.85));
    const d = new THREE.DirectionalLight(0xffcd86, 1.4);
    d.position.set(-8, 12, 20);
    this.scene.add(d, this.group, this.dyn);
    const sky = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}assets/wasteland-panorama.png`);
    sky.colorSpace = THREE.SRGBColorSpace;
    this.panorama = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: sky, toneMapped: false, depthWrite: false }));
    this.panorama.position.z = -22;
    this.panorama.renderOrder = -10;
    this.scene.add(this.panorama);
  }

  /** World position of a cell's floor (feet). */
  pos(col: number, floor: number): [number, number] {
    return [col + 0.5, -(floor * 2 + 2) + 0.16];
  }

  build(f: FieldLike, extra?: { lit?: boolean[]; decor?: { col: number; floor: number; kind: string }[] }) {
    const street = this.mode === "street" || (this.mode === "auto" && f.cols === 40 && f.floors === 2);
    const key = JSON.stringify([this.mode, this.street, f.cols, f.floors, f.walk, f.ladders, f.covers.map((c) => [c.col, c.floor, c.kind, c.hp > 0]), f.doors, extra?.lit]);
    if (key === this.key) return;
    const resetCamera = !this.key || this.fieldCols !== f.cols || this.fieldFloors !== f.floors;
    this.key = key;
    disposeTree(this.group);
    this.group.clear();
    const batch = new SceneryBatch();
    const b = batch.box.bind(batch);
    const groundY = -f.floors * 2;
    // Thick cross-section and a broken asphalt lip anchor the playable space.
    b(f.cols + 12, 3.6, 2.5, 0x332c27, f.cols / 2, groundY - 3.6, -0.8);
    b(f.cols + 10, 0.19, 2.7, 0x6a6050, f.cols / 2, groundY - 0.14, -0.9);
    for (let i = 0; i < f.cols * 3; i++) {
      const x = vhash(i, 20) * (f.cols + 8) - 4;
      const size = 0.08 + vhash(i, 21) * 0.33;
      b(size * 1.4, size, 0.09, [0x62513e, 0x4e4438, 0x71604b][i % 3], x, groundY - 0.3 - vhash(i, 22) * 2.7, 0.5, vhash(i, 23));
    }
    const topRuns: { start: number; end: number }[] = [];
    for (let c = 0; c < f.cols;) {
      if (!f.walk[c]) { c++; continue; }
      const start = c;
      while (c < f.cols && f.walk[c]) c++;
      topRuns.push({ start, end: c });
    }
    // Rooms are contiguous architectural volumes, no longer a wallpaper tile per cell.
    for (let fl = 0; fl < f.floors; fl++) {
      for (let c = 0; c < f.cols;) {
        if (!f.walk[fl * f.cols + c]) {
          if (!street) {
            const [, y] = this.pos(c, fl);
            b(1, 2, 1.7, 0x393c34, c + 0.5, y - 0.16, -1.1);
            b(0.83, 0.07, 0.07, 0x666251, c + 0.5, y + 0.75, -0.2);
          }
          c++;
          continue;
        }
        const start = c;
        while (c < f.cols && f.walk[fl * f.cols + c]) c++;
        const end = c;
        const [, y] = this.pos(start, fl);
        b(end - start, 0.17, 1.8, 0x625a49, (start + end) / 2, y - 0.17, -0.8);
        b(end - start, 0.055, 0.09, 0xb5a482, (start + end) / 2, y - 0.02, 0.12);
        const segments = street && fl === 1 ? topRuns.filter((r) => r.end > start && r.start < end) : [{ start, end }];
        for (const seg of segments) {
          for (let roomStart = seg.start; roomStart < seg.end; roomStart += 6) {
            const roomEnd = Math.min(seg.end, roomStart + 6);
            const width = roomEnd - roomStart;
            const lit = extra?.lit ? extra.lit[fl * f.cols + roomStart] : true;
            const variant = Math.floor(roomStart / 5) + fl;
            roomWall(this.group, (roomStart + roomEnd) / 2, y, width, variant, lit);
            addRoomKit(batch, this.group, (roomStart + roomEnd) / 2, y, width, variant, lit);
          }
        }
      }
    }
    for (let i = 0; i < topRuns.length; i++) {
      const r = topRuns[i], width = r.end - r.start;
      b(width + 0.22, 0.18, 1.8, 0x77715e, (r.start + r.end) / 2, 0.02, -0.85);
      b(width + 0.1, 0.12, 1.5, 0x343e37, (r.start + r.end) / 2, 0.2, -0.95);
      for (let n = 0; n < Math.floor(width); n++) {
        const height = 0.15 + vhash(n, i + 40) * 0.48;
        b(0.74, height, 0.4, 0x696253, r.start + n + 0.5, 0.28, -1.15);
      }
      if (width > 2.5) {
        const titles = street ? this.street?.names ?? ["ГАСТРОНОМ · 24", "ДОМ № 17", "ЛАБОРАТОРИЯ", "МАСТЕРСКАЯ"] : ["УНИВЕРСАМ", "СЛУЖЕБНЫЙ ВХОД", "СКЛАД № 04"];
        this.group.add(sceneSign(titles[i % titles.length], Math.min(width - 0.4, 5.2), (r.start + r.end) / 2, -0.16, i % 2 ? "#3b5552" : "#844736", 0.42));
      }
    }
    for (const l of f.ladders) {
      const [c, fl] = l.split(",").map(Number);
      const [x, y] = this.pos(c, fl);
      b(0.52, 2.12, 0.03, 0x242e2b, x, y, -0.55);
      for (const xx of [x - 0.24, x + 0.24]) b(0.07, 2.2, 0.08, 0xb0aa87, xx, y, -0.27);
      for (let i = 0; i < 8; i++) b(0.48, 0.055, 0.09, 0xc2b593, x, y + 0.12 + i * 0.28, -0.25);
      b(0.64, 0.05, 0.16, 0xd8c6a0, x, y + 1.96, -0.27);
    }
    for (const cv of f.covers) {
      if (cv.hp <= 0) continue;
      const [x, y] = this.pos(cv.col, cv.floor);
      const prop = buildSiteProp(cv.kind === "full" ? "locker" : "crate");
      prop.position.set(x, y, -0.12);
      this.group.add(prop);
    }
    for (const d of f.doors) {
      const [x, y] = this.pos(d.col, d.floor);
      b(0.1, 1.85, 0.7, 0xaaa187, x - 0.4, y, -0.8);
      b(0.1, 1.85, 0.7, 0xaaa187, x + 0.4, y, -0.8);
      b(0.9, 0.13, 0.7, 0xaaa187, x, y + 1.78, -0.8);
      if (d.closed) {
        b(0.69, 1.76, 0.13, 0x58665b, x, y, -0.7);
        b(0.14, 0.055, 0.1, 0xd0bf84, x + 0.19, y + 0.86, -0.58);
      } else b(0.1, 1.76, 0.7, 0x58665b, x - 0.31, y, -0.6);
    }
    for (const e of f.exits) {
      const [x, y] = this.pos(e.col, e.floor);
      b(0.9, 0.05, 0.8, 0x90bea0, x, y + 0.002, -0.45);
      this.group.add(sceneSign("← ВЫХОД", 1.2, x, y + 1.63, "#355a45", 0.27));
    }
    // Street silhouettes add depth, while all pieces stay behind characters.
    const streetY = groundY + 0.16;
    for (let x = 1; x < f.cols; x += 9) {
      const outside = street && !topRuns.some((r) => x >= r.start && x < r.end);
      if (!outside && street) continue;
      b(0.1, 3.7, 0.13, 0x343c36, x, streetY, -2.3, 0.035);
      b(1.1, 0.1, 0.15, 0x41463a, x + 0.3, streetY + 3.15, -2.3, 0.06);
      b(0.37, 0.15, 0.2, 0x4a5040, x + 0.75, streetY + 3.05, -2.3);
      for (let j = 0; j < 3; j++) b(0.05, 0.4 + j * 0.1, 0.05, 0x687345, x + 0.35 + j * 0.12, streetY, -1.9, (j - 1) * 0.3);
    }
    if (street) {
      const hatch = (this.street?.hatch ?? 20) + 0.5;
      for (const x of [hatch - 10.9, hatch + 10.2]) {
        if (x < 1 || x > f.cols - 1) continue;
        const car = buildSiteProp("car"); car.position.set(x, streetY, -1.35); this.group.add(car);
      }
      this.group.add(sceneSign("УБЕЖИЩЕ  ↓", 2.15, hatch, -2.25, "#4c6450", 0.48));
      b(2.15, 0.08, 0.16, 0xbeac7b, hatch, -2.5, -0.72);
    }
    for (let i = 0; i < f.cols * 2; i++) {
      const x = vhash(i, 66) * f.cols;
      b(0.12 + vhash(i, 63) * 0.27, 0.06 + vhash(i, 61) * 0.09, 0.18, i % 2 ? 0x9c8766 : 0x685c49, x, groundY + 0.02, 0.32, vhash(i, 67));
    }
    batch.finish(this.group);
    if (resetCamera) {
      this.camX = f.cols / 2;
      this.camY = -f.floors - 0.6;
    }
    this.fieldCols = f.cols;
    this.fieldFloors = f.floors;
  }

  fieldCols = 14;
  fieldFloors = 2;
  follow = true;

  render(renderer: THREE.WebGLRenderer) {
    const aspect = window.innerWidth / window.innerHeight;
    if (this.follow) this.viewH = Math.max(this.fieldFloors * 2 + 4.5, (this.fieldCols + 2) / aspect);
    const hh = this.viewH / 2;
    const skyW = Math.max(this.viewH * aspect * 1.5, this.viewH * 2.5);
    this.panorama.scale.set(skyW, skyW / (1672 / 941), 1);
    this.panorama.position.x = this.camX * 0.82 + this.fieldCols * 0.09 - 2.64;
    this.panorama.position.y = this.camY * 0.85 + this.viewH * 0.12 - 1.91;
    this.camera.left = -hh * aspect;
    this.camera.right = hh * aspect;
    this.camera.top = hh;
    this.camera.bottom = -hh;
    this.camera.updateProjectionMatrix();
    // A shallow cabinet angle exposes prop tops and sides while retaining side-view navigation.
    this.camera.position.set(this.camX + 3.6, this.camY + 2.6, 30);
    this.camera.lookAt(this.camX, this.camY, 0);
    this.panorama.quaternion.copy(this.camera.quaternion);
    renderer.render(this.scene, this.camera);
  }

  toScreen(x: number, y: number): [number, number] {
    const p = new THREE.Vector3(x, y, 0).project(this.camera);
    return [((p.x + 1) / 2) * window.innerWidth, ((1 - p.y) / 2) * window.innerHeight];
  }

  toWorld(sx: number, sy: number): [number, number] {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((sx / window.innerWidth) * 2 - 1, -(sy / window.innerHeight) * 2 + 1), this.camera);
    const p = new THREE.Vector3();
    ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), p);
    return [p.x, p.y];
  }
}

/**
 * Frees GPU memory of a rebuilt scenery tree: geometries, materials and their textures.
 * Rebuilds happen whenever a door opens, so leaking here crashed long sessions.
 * Shared cached resources are safe to dispose — three.js re-uploads them on next use.
 */
function disposeTree(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
    m.geometry?.dispose?.();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) {
      for (const v of Object.values(mat as any)) if ((v as THREE.Texture)?.isTexture) (v as THREE.Texture).dispose();
      mat.dispose();
    }
  });
}
