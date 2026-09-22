import * as THREE from "three";
import { PAL, box, canvasTex, cyl, mat, vhash } from "./palette";

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
  theme = { wall: 0x6a5f52, floor: 0x3a3028, solid: 0x2a221c, sky: 0x1a1412 };

  constructor() {
    this.scene.background = new THREE.Color(this.theme.sky);
    this.scene.add(new THREE.AmbientLight(0x9a8a7a, 1.2), new THREE.HemisphereLight(0xc0b0a0, 0x302418, 0.6));
    const d = new THREE.DirectionalLight(0xffe0c0, 0.5);
    d.position.set(5, 10, 20);
    this.scene.add(d, this.group, this.dyn);
  }

  /** World position of a cell's floor (feet). */
  pos(col: number, floor: number): [number, number] {
    return [col + 0.5, -(floor * 2 + 2) + 0.16];
  }

  build(f: FieldLike, extra?: { lit?: boolean[]; decor?: { col: number; floor: number; kind: string }[] }) {
    const key = JSON.stringify([f.cols, f.floors, f.walk, f.ladders, f.covers.map((c) => [c.col, c.floor, c.kind, c.hp > 0]), f.doors, extra?.lit]);
    if (key === this.key) return;
    this.key = key;
    this.group.clear();
    const wallTex = canvasTex("sitewall", 64, 128, (g, w, h) => {
      g.fillStyle = "#8a7a66";
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 300; i++) {
        g.fillStyle = `rgba(40,30,20,${vhash(i, 3) * 0.3})`;
        g.fillRect(vhash(i) * w, vhash(i, 1) * h, 3, 2);
      }
      g.fillStyle = "rgba(60,40,30,0.4)";
      g.fillRect(0, h * 0.62, w, 3);
      g.fillStyle = "rgba(0,0,0,0.25)";
      g.fillRect(8, 20, 20, 26);
    });
    for (let fl = 0; fl < f.floors; fl++) {
      for (let c = 0; c < f.cols; c++) {
        const [x, y] = this.pos(c, fl);
        const open = f.walk[fl * f.cols + c];
        if (open) {
          const lit = extra?.lit ? extra.lit[fl * f.cols + c] : true;
          const wall = new THREE.Mesh(new THREE.PlaneGeometry(1, 2), new THREE.MeshLambertMaterial({ map: wallTex, color: lit ? 0xffffff : 0x303030 }));
          wall.position.set(x, y + 1 - 0.16 + 0.08, -1.55);
          this.group.add(wall, box(1, 0.16, 1.6, this.theme.floor, x, y - 0.16, -0.8));
        } else this.group.add(box(1, 2, 1.6, this.theme.solid, x, y - 0.16, -0.8));
      }
    }
    for (const l of f.ladders) {
      const [c, fl] = l.split(",").map(Number);
      const [x, y] = this.pos(c, fl);
      this.group.add(box(0.07, 2.2, 0.06, PAL.wood, x - 0.22, y, -0.35), box(0.07, 2.2, 0.06, PAL.wood, x + 0.22, y, -0.35));
      for (let i = 0; i < 7; i++) this.group.add(box(0.44, 0.05, 0.05, PAL.woodDark, x, y + 0.15 + i * 0.3, -0.35));
    }
    for (const cv of f.covers) {
      if (cv.hp <= 0) continue;
      const [x, y] = this.pos(cv.col, cv.floor);
      if (cv.kind === "full") this.group.add(box(0.8, 1.35, 0.5, 0x6a5a44, x, y, -0.1));
      else this.group.add(box(0.8, 0.6, 0.5, 0x7a6a4a, x, y, -0.1));
    }
    for (const d of f.doors) {
      const [x, y] = this.pos(d.col, d.floor);
      const door = box(0.12, 1.8, 0.9, d.closed ? 0x8a8575 : 0x55524a, x - (d.closed ? 0 : 0.35), y, -0.7);
      if (!d.closed) door.rotation.y = 1.2;
      this.group.add(door);
    }
    for (const e of f.exits) {
      const [x, y] = this.pos(e.col, e.floor);
      this.group.add(box(0.8, 0.05, 0.8, 0x55aa55, x, y + 0.001, -0.5, mat(0x55aa55, { emissive: 0x1a4a1a, opacity: 0.6 })));
    }
    for (const dc of extra?.decor ?? []) {
      const [x, y] = this.pos(dc.col, dc.floor);
      this.group.add(box(0.6, 0.7, 0.4, 0x5a4a3a, x, y, -1.1));
    }
    this.camX = f.cols / 2;
    this.camY = -f.floors - 0.6;
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
    this.camera.left = -hh * aspect;
    this.camera.right = hh * aspect;
    this.camera.top = hh;
    this.camera.bottom = -hh;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(this.camX, this.camY, 30);
    this.camera.lookAt(this.camX, this.camY, 0);
    renderer.render(this.scene, this.camera);
  }

  toScreen(x: number, y: number): [number, number] {
    const p = new THREE.Vector3(x, y, 0).project(this.camera);
    return [((p.x + 1) / 2) * window.innerWidth, ((1 - p.y) / 2) * window.innerHeight];
  }

  toWorld(sx: number, sy: number): [number, number] {
    const p = new THREE.Vector3((sx / window.innerWidth) * 2 - 1, -(sy / window.innerHeight) * 2 + 1, 0).unproject(this.camera);
    return [p.x, p.y];
  }
}
