import * as THREE from "three";
import type { View } from "../net";
import { PAL, TERRAIN_COLORS, canvasTex, mat, vhash } from "./palette";
import { addBunkerArchitecture } from "./scenery";

export const DEPTH = 1.6; // how deep the cut-away goes (z from -DEPTH to 0)

export const ROOM_TINT: Record<string, number> = {
  airlock: 0x6f6a5c,
  airlock2: 0x6f6a5c,
  living: 0x7d6a55,
  storage: 0x6d6150,
  tech: 0x5e6461,
  hydro: 0x587055,
  mess: 0x85705a,
  kitchen: 0x7f6a57,
  med: 0x7e8a86,
  workshop: 0x6a6258,
  chemlab: 0x667066,
  mushroom: 0x4d4436,
  rabbits: 0x6f6448,
  waterworks: 0x5a6a72,
  genroom: 0x5b5a55,
  batteries: 0x5a5f58,
  radioroom: 0x5f6a60,
  armory: 0x5d5a4f,
  range: 0x6b6555,
  rec: 0x8a6a58,
  chapel: 0x7a6a5a,
  brig: 0x4d4b48,
  lift: 0x5a5a58,
  support: 0x5a5046,
  corridor: 0x625c52,
  shaft: 0x5a544b,
  defense: 0x5a5a4a,
  turretroom: 0x5a5550,
};

function wallTexture() {
  return canvasTex("wallpanel-detailed", 128, 256, (g, w, h) => {
    g.fillStyle = "#d1c6ac";
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 400; i++) {
      const v = 150 + Math.floor(vhash(i) * 60);
      g.fillStyle = `rgba(${v},${v - 5},${v - 15},0.25)`;
      g.fillRect(vhash(i, 1) * w, vhash(i, 2) * h, 2, 2);
    }
    g.fillStyle = "rgba(38,52,43,0.18)";
    g.fillRect(0, h * 0.65, w, h * 0.35);
    g.strokeStyle = "rgba(60,50,40,0.18)";
    g.lineWidth = 1;
    g.strokeRect(1, 1, w - 2, h - 2);
    // stains
    g.fillStyle = "rgba(90,70,40,0.15)";
    g.fillRect(0, h - 18, w, 18);
    // rivets
    g.fillStyle = "rgba(40,35,30,0.5)";
    for (const [x, y] of [[5, 5], [w - 6, 5], [5, h / 2 - 6], [w - 6, h / 2 - 6], [5, h / 2 + 5], [w - 6, h / 2 + 5], [5, h - 6], [w - 6, h - 6]]) g.fillRect(x, y, 2, 2);
    const shade = g.createLinearGradient(0, 0, 0, h);
    shade.addColorStop(0, "#17191077"); shade.addColorStop(0.25, "#17191000");
    shade.addColorStop(0.77, "#17191000"); shade.addColorStop(1, "#17191088");
    g.fillStyle = shade; g.fillRect(0, 0, w, h);
  });
}

function earthTexture() {
  return canvasTex("earthwall", 64, 128, (g, w, h) => {
    g.fillStyle = "#6b5440";
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 500; i++) {
      const v = vhash(i, 7);
      g.fillStyle = v < 0.5 ? "rgba(40,28,18,0.35)" : "rgba(140,110,80,0.25)";
      g.fillRect(vhash(i, 3) * w, vhash(i, 4) * h, 1 + v * 3, 1 + v * 2);
    }
    // timber props
    g.fillStyle = "#4a3320";
    g.fillRect(4, 0, 6, h);
    g.fillRect(w - 10, 0, 6, h);
    g.fillRect(0, 2, w, 5);
  });
}

export class TerrainLayer {
  group = new THREE.Group();
  cells: THREE.InstancedMesh;
  walls: THREE.InstancedMesh;
  earthWalls: THREE.InstancedMesh;
  floors: THREE.InstancedMesh;
  marks: THREE.InstancedMesh;
  finds: THREE.InstancedMesh;
  stones: THREE.InstancedMesh;
  architecture = new THREE.Group();
  private gridKey = "";
  private roomKey = "";
  private W = 48;
  private H = 32;
  private tmp = new THREE.Object3D();
  private col = new THREE.Color();

  constructor() {
    const n = 48 * 32;
    this.cells = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, DEPTH), new THREE.MeshLambertMaterial({ flatShading: true }), n);
    this.stones = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ flatShading: true }), n * 2);
    this.stones.count = 0;
    this.group.add(this.stones, this.architecture);
    this.cells.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const slotN = 48 * 16;
    const wallMat = new THREE.MeshLambertMaterial({ map: wallTexture() });
    this.walls = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 2), wallMat, slotN);
    this.earthWalls = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 2), new THREE.MeshLambertMaterial({ map: earthTexture() }), slotN);
    this.floors = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.16, DEPTH), new THREE.MeshLambertMaterial({ flatShading: true }), slotN);
    this.marks = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.96, 1.96),
      new THREE.MeshBasicMaterial({ color: 0xffcc33, transparent: true, opacity: 0.28, depthWrite: false }),
      slotN,
    );
    this.finds = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.18), mat(0xffe08a, { emissive: 0x664400 }), 64);
    for (const m of [this.cells, this.walls, this.earthWalls, this.floors, this.marks, this.finds]) {
      m.count = 0;
      m.frustumCulled = false;
      this.group.add(m);
    }
    this.cells.receiveShadow = true;
    this.floors.receiveShadow = true;
    this.walls.receiveShadow = true;
  }

  update(v: View) {
    this.W = v.W;
    this.H = v.H;
    const gk = v.grid.join("");
    if (gk !== this.gridKey) {
      this.gridKey = gk;
      this.rebuildCells(v);
    }
    const rk = gk + JSON.stringify(v.marks) + JSON.stringify(v.dig) + Object.values(v.rooms).map((r: any) => r.id + r.state + r.type + r.lit + r.x + r.w).join() + JSON.stringify(v.found);
    if (rk !== this.roomKey) {
      this.roomKey = rk;
      this.rebuildRooms(v);
    }
  }

  private rebuildCells(v: View) {
    const { W, H } = v;
    let n = 0, ns = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const t = v.grid[y * W + x];
        if (t === 0) continue;
        this.tmp.rotation.set(0, 0, 0);
        this.tmp.scale.set(1, 1, 1);
        this.tmp.position.set(x + 0.5, -(y + 0.5), -DEPTH / 2);
        this.tmp.updateMatrix();
        this.cells.setMatrixAt(n, this.tmp.matrix);
        const base = TERRAIN_COLORS[t] ?? 0x333333;
        this.col.setHex(base);
        const k = 0.94 + vhash(x, y) * 0.12 - y * 0.003;
        this.col.multiplyScalar(k);
        this.cells.setColorAt(n, this.col);
        if (t !== 7) for (let j = 0; j < 2; j++) {
          const seed = x + y * W;
          const scale = 0.1 + vhash(seed, 41 + j) * 0.2;
          this.tmp.position.set(x + 0.12 + vhash(seed, 14 + j) * 0.76, -y - 0.12 - vhash(seed, 27 + j) * 0.76, 0.025);
          this.tmp.scale.set(scale * 1.3, scale, scale * 0.32);
          this.tmp.rotation.set(vhash(seed, 21), vhash(seed, 22), vhash(seed, 23));
          this.tmp.updateMatrix(); this.stones.setMatrixAt(ns, this.tmp.matrix);
          this.col.setHex(t === 3 || t === 4 ? 0x77776c : [0x705744, 0x4e4136, 0x88664c][(seed + j) % 3]);
          this.stones.setColorAt(ns++, this.col);
        }
        n++;
      }
    }
    this.cells.count = n;
    this.cells.instanceMatrix.needsUpdate = true;
    if (this.cells.instanceColor) this.cells.instanceColor.needsUpdate = true;
    this.stones.count = ns;
    this.stones.instanceMatrix.needsUpdate = true;
    if (this.stones.instanceColor) this.stones.instanceColor.needsUpdate = true;
    this.stones.computeBoundingSphere();
    this.tmp.scale.set(1, 1, 1); this.tmp.rotation.set(0, 0, 0);
  }

  private rebuildRooms(v: View) {
    this.architecture.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose(); });
    this.architecture.clear();
    addBunkerArchitecture(this.architecture, v.rooms);
    const { W, H } = v;
    let nw = 0,
      ne = 0,
      nf = 0,
      nm = 0;
    const roomAt = (x: number, lv: number) => {
      for (const id in v.rooms) {
        const r = v.rooms[id];
        if (r.lv === lv && x >= r.x && x < r.x + r.w) return r;
      }
      return undefined;
    };
    for (let lv = 0; lv < H / 2; lv++) {
      for (let x = 0; x < W; x++) {
        const open = v.grid[lv * 2 * W + x] === 0 && v.grid[(lv * 2 + 1) * W + x] === 0;
        const key = String((lv + 1) * W + x);
        if (open) {
          const r = roomAt(x, lv);
          const finished = r && r.state === "done";
          this.tmp.position.set(x + 0.5, -(lv * 2 + 1), -DEPTH + 0.01);
          this.tmp.scale.set(1, 1, 1);
          this.tmp.updateMatrix();
          if (finished) {
            this.walls.setMatrixAt(nw, this.tmp.matrix);
            this.col.setHex(ROOM_TINT[r.type] ?? 0x777777);
            if (!r.lit) this.col.multiplyScalar(0.45);
            this.walls.setColorAt(nw, this.col);
            nw++;
          } else {
            this.earthWalls.setMatrixAt(ne, this.tmp.matrix);
            this.col.setHex(0xffffff);
            if (r && !r.lit) this.col.multiplyScalar(0.6);
            this.earthWalls.setColorAt(ne, this.col);
            ne++;
          }
          // floor slab
          this.tmp.position.set(x + 0.5, -(lv * 2 + 2) + 0.08, -DEPTH / 2);
          this.tmp.updateMatrix();
          this.floors.setMatrixAt(nf, this.tmp.matrix);
          this.col.setHex(finished ? PAL.concreteDark : 0x4a3a2c);
          this.floors.setColorAt(nf, this.col);
          nf++;
        } else if (v.marks[key]) {
          const prog = v.dig[key] ?? 0;
          this.tmp.position.set(x + 0.5, -(lv * 2 + 1), 0.02);
          this.tmp.scale.set(1, 1, 1);
          this.tmp.updateMatrix();
          this.marks.setMatrixAt(nm, this.tmp.matrix);
          this.col.setHSL(0.13 - prog * 0.1, 0.9, 0.5 + prog * 0.2);
          this.marks.setColorAt(nm, this.col);
          nm++;
        }
      }
    }
    this.walls.count = nw;
    this.earthWalls.count = ne;
    this.floors.count = nf;
    this.marks.count = nm;
    for (const m of [this.walls, this.earthWalls, this.floors, this.marks]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    // revealed finds glow
    let nfd = 0;
    for (const k in v.found) {
      const n = Number(k);
      const x = n % W;
      const lv = Math.floor(n / W) - 1;
      if (nfd >= 64) break;
      this.tmp.position.set(x + 0.5, -(lv * 2 + 0.6), -0.3);
      this.tmp.updateMatrix();
      this.finds.setMatrixAt(nfd++, this.tmp.matrix);
    }
    this.finds.count = nfd;
    this.finds.instanceMatrix.needsUpdate = true;
  }
}
