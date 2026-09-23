import * as THREE from "three";
import { canvasTex, vhash } from "./palette";

const cube = new THREE.BoxGeometry(1, 1, 1);
const plane = new THREE.PlaneGeometry(1, 1);
const plaster = new THREE.MeshLambertMaterial({ color: 0xffffff });
const cards = new Map<string, THREE.MeshBasicMaterial>();

/** Static visual detail uses one instanced draw, independent of walk/collision cells. */
export class SceneryBatch {
  private parts: { x: number; y: number; z: number; w: number; h: number; d: number; color: number; tilt: number }[] = [];
  private transforms: { matrix: THREE.Matrix4; color: number }[] = [];
  transform(matrix: THREE.Matrix4, color: number) { this.transforms.push({ matrix, color }); }
  box(w: number, h: number, d: number, color: number, x: number, y: number, z: number, tilt = 0) {
    this.parts.push({ w, h, d, color, x, y: y + h / 2, z, tilt });
  }
  finish(parent: THREE.Group) {
    if (!this.parts.length && !this.transforms.length) return;
    const mesh = new THREE.InstancedMesh(cube, plaster, this.parts.length + this.transforms.length);
    const o = new THREE.Object3D();
    const color = new THREE.Color();
    this.parts.forEach((p, i) => {
      o.position.set(p.x, p.y, p.z);
      o.scale.set(p.w, p.h, p.d);
      o.rotation.set(0, 0, p.tilt);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
      mesh.setColorAt(i, color.setHex(p.color));
    });
    this.transforms.forEach((p, i) => {
      mesh.setMatrixAt(this.parts.length + i, p.matrix);
      mesh.setColorAt(this.parts.length + i, color.setHex(p.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor!.needsUpdate = true;
    mesh.computeBoundingSphere();
    parent.add(mesh);
  }
}

/** Coalesce static box details, retaining named/animated mechanisms and emissive parts. */
export function batchStaticBoxes(root: THREE.Group) {
  root.updateMatrixWorld(true);
  const batch = new SceneryBatch();
  const removed: THREE.Mesh[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || mesh.geometry.type !== "BoxGeometry" || Array.isArray(mesh.material)) return;
    const material = mesh.material as THREE.MeshLambertMaterial;
    if (!material.isMeshLambertMaterial || material.transparent || material.emissive.getHex() !== 0) return;
    for (let p: THREE.Object3D | null = mesh; p && p !== root; p = p.parent) if (p.name) return;
    const { width, height, depth } = (mesh.geometry as THREE.BoxGeometry).parameters;
    const matrix = mesh.matrixWorld.clone().multiply(new THREE.Matrix4().makeScale(width, height, depth));
    batch.transform(matrix, material.color.getHex()); removed.push(mesh);
  });
  for (const mesh of removed) mesh.removeFromParent();
  batch.finish(root);
}

function card(key: string, texture: THREE.Texture, w: number, h: number, x: number, y: number, z: number, transparent = false) {
  let material = cards.get(key);
  if (!material) {
    material = new THREE.MeshBasicMaterial({ map: texture, transparent, depthWrite: !transparent, toneMapped: false });
    cards.set(key, material);
  }
  const mesh = new THREE.Mesh(plane, material);
  mesh.position.set(x, y, z);
  mesh.scale.set(w, h, 1);
  return mesh;
}

export function sceneSign(text: string, width: number, x: number, y: number, color = "#82452d", height = 0.45) {
  const key = `scene-sign-${text}-${color}`;
  const texture = canvasTex(key, 768, 128, (g, w, h) => {
    g.fillStyle = color; g.fillRect(0, 0, w, h);
    g.strokeStyle = "#b1a38a"; g.lineWidth = 3; g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = "#eed9ab"; g.font = "bold 65px 'Arial Narrow',Arial,sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(text, w / 2, h / 2 + 4, w - 45);
    for (let i = 0; i < 90; i++) {
      g.fillStyle = i % 3 ? "#36292033" : "#d5b78933";
      g.fillRect(vhash(i, 7) * w, vhash(i, 9) * h, 1 + vhash(i, 2) * 15, 2);
    }
  });
  texture.magFilter = THREE.LinearFilter;
  return card(key, texture, width, height, x, y, -0.72);
}

export function addHorizon(parent: THREE.Group, cols: number) {
  const key = "ruins-painted-horizon-v2";
  const texture = canvasTex(key, 2048, 1024, (g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#373b4a"); sky.addColorStop(0.38, "#ad6851");
    sky.addColorStop(0.65, "#efaa61"); sky.addColorStop(1, "#594237");
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    const glow = g.createRadialGradient(w * 0.43, h * 0.48, 10, w * 0.43, h * 0.48, 320);
    glow.addColorStop(0, "#ffe2a399"); glow.addColorStop(1, "#ffc07400");
    g.fillStyle = glow; g.fillRect(0, 0, w, h);
    g.fillStyle = "#ffdf91"; g.beginPath(); g.arc(w * 0.43, h * 0.48, 37, 0, Math.PI * 2); g.fill();
    // Three independently composed depths: roof silhouettes, shattered windows, antennas.
    for (let layer = 0; layer < 3; layer++) {
      const base = h * (0.69 + layer * 0.09);
      const colors = ["#997258", "#755748", "#473b36"];
      for (let i = 0; i < 54; i++) {
        const x = i * 44 - 25 + vhash(i, layer + 2) * 15;
        const bw = 24 + vhash(i, layer + 4) * 54;
        const bh = 20 + vhash(i, layer + 5) * (155 + layer * 30);
        g.fillStyle = colors[layer];
        g.beginPath(); g.moveTo(x, base); g.lineTo(x, base - bh);
        g.lineTo(x + bw * 0.26, base - bh); g.lineTo(x + bw * 0.3, base - bh + 16);
        g.lineTo(x + bw * 0.7, base - bh + 8); g.lineTo(x + bw, base - bh + 28);
        g.lineTo(x + bw, base + 160); g.lineTo(x, base + 160); g.fill();
        if (i % 4 === 0) g.fillRect(x + bw / 2, base - bh - 22, 3, 28);
        g.fillStyle = layer === 2 ? "#292a2877" : "#453d3444";
        for (let yy = base - bh + 28; yy < base; yy += 20)
          for (let xx = x + 8; xx < x + bw - 6; xx += 13)
            if (vhash(Math.floor(xx), Math.floor(yy)) > 0.3) g.fillRect(xx, yy, 5, 10);
      }
    }
    g.fillStyle = "#282a29"; g.fillRect(0, h * 0.94, w, h);
  });
  texture.magFilter = THREE.LinearFilter;
  parent.add(card(key, texture, Math.max(70, cols + 20), 21, cols / 2, 3.0, -18));
}

export function roomWall(parent: THREE.Group, x: number, y: number, width: number, variant: number, lit: boolean) {
  const key = `authored-wall-${variant % 4}-${lit}`;
  const texture = canvasTex(key, 1024, 512, (g, w, h) => {
    const palettes = [["#846f51", "#45524a"], ["#7e715f", "#6c4d3a"], ["#7c8575", "#3a514e"], ["#8e745b", "#5e6155"]];
    const colors = palettes[variant % 4];
    g.fillStyle = colors[0]; g.fillRect(0, 0, w, h);
    g.fillStyle = colors[1]; g.fillRect(0, h * 0.65, w, h * 0.35);
    g.fillStyle = "#2b292677"; g.fillRect(0, h * 0.64, w, 5);
    for (let i = 0; i < 400; i++) {
      g.fillStyle = i % 3 === 0 ? "#dacfb01c" : "#342e2720";
      const xx = vhash(i, 1) * w, yy = vhash(i, 2) * h;
      g.fillRect(xx, yy, 3 + vhash(i, 3) * 20, 1 + vhash(i, 4) * 8);
    }
    // Peeling plaster, hairline cracks and mortar visible at real play scale.
    for (let i = 0; i < 6; i++) {
      const xx = vhash(i, 6) * w, yy = vhash(i, 8) * h;
      g.fillStyle = "#53433566"; g.beginPath(); g.moveTo(xx, yy);
      g.lineTo(xx + 42, yy + 12); g.lineTo(xx + 64, yy + 44); g.lineTo(xx + 17, yy + 31); g.fill();
      g.strokeStyle = "#352c2566"; g.lineWidth = 2; g.beginPath();
      g.moveTo(xx, yy); g.lineTo(xx + 12, yy - 30); g.lineTo(xx + 3, yy - 53); g.stroke();
    }
    const shade = g.createLinearGradient(0, 0, 0, h);
    shade.addColorStop(0, "#17171199"); shade.addColorStop(0.23, "#17171100");
    shade.addColorStop(0.75, "#17171100"); shade.addColorStop(1, "#171711bb");
    g.fillStyle = shade; g.fillRect(0, 0, w, h);
    if (!lit) { g.fillStyle = "#070c12aa"; g.fillRect(0, 0, w, h); }
  });
  texture.magFilter = THREE.LinearFilter;
  parent.add(card(key, texture, width, 1.89, x, y + 0.98, -1.8));
}

export function addRoomKit(batch: SceneryBatch, parent: THREE.Group, x: number, y: number, width: number, variant: number, lit = true) {
  const b = batch.box.bind(batch);
  const left = x - width / 2, right = x + width / 2;
  b(width, 0.11, 0.18, 0x3c3a33, x, y + 1.82, -1.35);
  b(width, 0.07, 0.12, 0x2e3934, x, y + 0.06, -1.2);
  for (const edge of [left + 0.07, right - 0.07]) {
    b(0.14, 1.95, 0.36, 0x5d5c50, edge, y, -0.7);
    b(0.22, 0.12, 0.42, 0x777362, edge, y + 1.76, -0.7);
  }
  if (width < 2.2) return;
  const wx = left + Math.min(1.0, width / 3);
  // Recessed, framed window with surviving panes.
  b(1.1, 0.89, 0.08, 0x283333, wx, y + 0.72, -1.53);
  b(0.96, 0.73, 0.05, 0x667a71, wx, y + 0.8, -1.47);
  b(0.06, 0.86, 0.08, 0xb4a88a, wx, y + 0.75, -1.4);
  b(1.11, 0.07, 0.14, 0xaaa087, wx, y + 1.16, -1.37);
  b(1.18, 0.09, 0.26, 0x7d7965, wx, y + 0.69, -1.25);
  b(0.38, 0.1, 0.08, 0x303d38, wx + 0.26, y + 1.4, -1.35, -0.35);
  const lampX = right - Math.min(1.2, width / 3);
  b(0.03, 0.19, 0.04, 0x262d2b, lampX, y + 1.61, -0.95);
  b(0.31, 0.06, 0.23, 0x393c30, lampX, y + 1.57, -0.95);
  b(0.2, 0.07, 0.12, lit ? 0xffd477 : 0x5e6051, lampX, y + 1.5, -0.93);
  if (lit) {
    const key = "room-light-pool";
    const tex = canvasTex(key, 128, 256, (g, w, h) => {
      const light = g.createRadialGradient(w / 2, 0, 1, w / 2, h * 0.15, h * 0.8);
      light.addColorStop(0, "#ffce793f"); light.addColorStop(1, "#ffd28300");
      g.fillStyle = light; g.fillRect(0, 0, w, h);
    });
    parent.add(card(key, tex, 1.6, 1.5, lampX, y + 0.77, -1.3, true));
  }
  // Back wall dressing varies by room, away from the walking plane.
  if (variant % 3 === 0) {
    b(0.9, 0.74, 0.35, 0x454f45, right - 0.68, y, -1.2);
    b(0.91, 0.07, 0.43, 0xa49774, right - 0.68, y + 0.74, -1.12);
    for (let i = 0; i < 3; i++) b(0.03, 0.08, 0.05, 0xb0ac8c, right - 0.95 + i * 0.28, y + 0.52, -0.98);
  } else if (variant % 3 === 1) {
    b(1.23, 0.09, 0.46, 0x88623d, right - 0.95, y + 0.68, -1.15);
    for (const xx of [right - 1.45, right - 0.45]) b(0.08, 0.68, 0.08, 0x4e4233, xx, y, -1.05);
    b(0.35, 0.3, 0.21, 0x384540, right - 0.85, y + 0.77, -1.1);
    b(0.18, 0.16, 0.02, 0x83a18c, right - 0.85, y + 0.84, -0.98);
  } else {
    for (let i = 0; i < 3; i++) {
      b(1.12, 0.06, 0.32, 0x403c31, right - 0.85, y + 0.18 + i * 0.41, -1.2);
      for (let j = 0; j < 4; j++) b(0.14, 0.14 + vhash(i, j) * 0.13, 0.14, [0x90734d, 0x637654, 0xa1543c, 0xaaa287][j], right - 1.24 + j * 0.25, y + 0.24 + i * 0.41, -1.17);
    }
    for (const xx of [right - 1.44, right - 0.27]) b(0.05, 1.37, 0.3, 0x3b4139, xx, y, -1.2);
  }
}

/** Authored container shapes. Reused meshes/materials; returned group may be freely positioned. */
export function buildSiteProp(kind: string, depleted = false): THREE.Group {
  const root = new THREE.Group();
  const batch = new SceneryBatch();
  const b = batch.box.bind(batch);
  const wood = depleted ? 0x4d4840 : 0x8e6b3d;
  if (kind === "car") {
    b(1.65, 0.37, 0.72, 0x854f34, 0, 0.2, 0);
    b(0.87, 0.43, 0.61, 0x785139, -0.15, 0.53, 0);
    for (const xx of [-0.35, 0.05]) b(0.33, 0.27, 0.04, 0x273d3b, xx, 0.64, 0.33);
    for (const xx of [-0.51, 0.53]) b(0.32, 0.32, 0.78, 0x232827, xx, 0.03, 0);
    b(1.58, 0.08, 0.08, 0x403e32, 0, 0.26, 0.41);
    b(0.13, 0.12, 0.05, 0xafa476, 0.7, 0.43, 0.38);
  } else if (["shelf", "cabinet", "radio_rack"].includes(kind)) {
    for (const xx of [-0.39, 0.39]) b(0.055, 1.45, 0.4, 0x454940, xx, 0, 0);
    b(0.77, 1.36, 0.05, 0x464139, 0, 0.05, -0.18);
    for (let i = 0; i < 4; i++) {
      b(0.8, 0.055, 0.46, wood, 0, i * 0.43, 0);
      if (!depleted) for (let j = 0; j < 3; j++) b(0.16, 0.18 + vhash(i, j) * 0.13, 0.23, [0xb79761, 0x667e50, 0xa85842][j], -0.25 + j * 0.25, i * 0.43 + 0.06, 0.04);
    }
  } else if (["locker", "fridge", "safe"].includes(kind)) {
    b(0.75, 1.35, 0.45, 0x414b44, 0, 0, 0);
    b(0.66, 1.23, 0.05, depleted ? 0x52564a : 0x7b8369, 0, 0.06, 0.25);
    for (let i = 0; i < 4; i++) b(0.34, 0.025, 0.025, 0x333d34, 0, 1.02 + i * 0.065, 0.28);
    b(0.055, 0.17, 0.06, 0xb8b090, 0.22, 0.62, 0.3);
  } else {
    b(0.8, 0.57, 0.5, wood, 0, 0, 0);
    for (const yy of [0.08, 0.43]) b(0.85, 0.055, 0.57, 0x493e2e, 0, yy, 0);
    for (const xx of [-0.29, 0.29]) b(0.065, 0.58, 0.05, 0xb29360, xx, 0, 0.28);
    b(0.2, 0.17, 0.02, 0xc6b789, 0.01, 0.19, 0.29);
  }
  batch.finish(root);
  return root;
}

/** Structural detail sits behind the walk plane and never changes room collision. */
export function addBunkerArchitecture(parent: THREE.Group, rooms: Record<string, any>) {
  const batch = new SceneryBatch();
  const b = batch.box.bind(batch);
  for (const r of Object.values(rooms)) {
    if (r.state !== "done") continue;
    const y = -(r.lv * 2 + 2) + 0.16;
    const cx = r.x + r.w / 2;
    const shaft = r.type === "shaft" || r.type === "support";
    const green = ["hydro", "mushroom", "waterworks"].includes(r.type);
    const metal = green ? 0x535b44 : 0x626154;
    b(r.w, 0.12, 0.22, 0x353c35, cx, y + 1.69, -1.14);
    b(r.w, 0.045, 0.2, metal, cx, y + 1.83, -1.0);
    b(r.w, 0.075, 0.14, 0xaaa181, cx, y - 0.04, 0.02);
    b(r.w, 0.14, 0.28, 0x3b4039, cx, y - 0.16, 0.04);
    for (const x of [r.x + 0.1, r.x + r.w - 0.1]) {
      b(0.15, 1.84, 0.28, metal, x, y, -0.1);
      b(0.25, 0.12, 0.4, 0x979078, x, y + 1.65, -0.12);
      b(0.26, 0.15, 0.38, 0x494d40, x, y, -0.12);
    }
    if (shaft) continue;
    // Copper/steel utilities and the brackets that fix them to the shell.
    b(r.w - 0.22, 0.065, 0.09, green ? 0x647d64 : 0x94774f, cx, y + 1.57, -1.12);
    for (let xx = r.x + 0.65; xx < r.x + r.w; xx += 1.8) {
      b(0.06, 0.18, 0.17, 0x2d3832, xx, y + 1.51, -1.12);
      b(0.11, 0.04, 0.025, 0xb8ac83, xx, y + 1.51, -1.02);
    }
    const px = r.x + 0.29;
    b(0.065, 1.56, 0.08, 0x5e7268, px, y + 0.12, -1.23);
    b(0.19, 0.12, 0.13, 0x526050, px, y + 0.28, -1.19);
    b(0.025, 0.26, 0.025, 0xc06b42, px, y + 0.22, -1.1);
    b(0.24, 0.025, 0.025, 0xc06b42, px, y + 0.34, -1.09);
    const count = Math.max(1, Math.floor(r.w / 3));
    for (let i = 0; i < count; i++) {
      const x = r.x + ((i + 0.5) * r.w) / count;
      b(0.34, 0.07, 0.27, 0x444a39, x, y + 1.41, -0.83);
      b(0.26, 0.06, 0.18, r.lit ? (green ? 0xd8e5a0 : 0xffd898) : 0x777666, x, y + 1.36, -0.8);
      if (r.lit) {
        const key = green ? "bunker-green-light" : "bunker-warm-light";
        const texture = canvasTex(key, 256, 256, (g, w, h) => {
          const glow = g.createRadialGradient(w / 2, h * 0.14, 2, w / 2, h * 0.36, h * 0.7);
          glow.addColorStop(0, green ? "#bfe27052" : "#ffd28070");
          glow.addColorStop(0.55, green ? "#bfe27018" : "#ffc66c25"); glow.addColorStop(1, "#ffc66c00");
          g.fillStyle = glow; g.fillRect(0, 0, w, h);
        });
        parent.add(card(key, texture, Math.min(r.w, 2.5), 1.64, x, y + 0.7, -1.44, true));
      }
    }
    if (r.w >= 4 && ["living", "mess", "workshop", "storage"].includes(r.type)) {
      const texts: Record<string, string> = { living: "ДОМ ТАМ, ГДЕ СВОИ", mess: "ВМЕСТЕ ВЫЖИВЕМ", workshop: "БЕРЕГИ ИНСТРУМЕНТ", storage: "ЗАПАС — ЭТО ЖИЗНЬ" };
      const poster = sceneSign(texts[r.type], 1.3, r.x + r.w - 1.1, y + 1.03, "#756048", 0.49);
      poster.position.z = -1.36; poster.rotation.z = -0.035;
      parent.add(poster);
    }
    if (["kitchen", "med", "waterworks", "chemlab"].includes(r.type)) {
      for (let i = 0; i < r.w * 3; i++) {
        b(0.29, 0.38, 0.03, i % 3 ? 0x81968b : 0x73877b, r.x + i / 3 + 0.16, y + 0.18, -1.48);
      }
    }
  }
  batch.finish(parent);
}
