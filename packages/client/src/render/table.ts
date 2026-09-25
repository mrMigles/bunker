import * as THREE from "three";
import { RANK_NAME, SUIT_SYM } from "@bunker/shared";
import { canvasTex, mat, box, cyl } from "./palette";
import { BOARD_PX, drawBoard, type BoardCtx } from "./boards2d";

const CW = 0.62,
  CH = 0.88;

function faceTex(card: string): THREE.Texture {
  return canvasTex("card_" + card, 128, 180, (g, w, h) => {
    g.fillStyle = "#f3ead3";
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "#8a7a5a";
    g.lineWidth = 4;
    g.strokeRect(4, 4, w - 8, h - 8);
    const red = card[1] === "h" || card[1] === "d";
    g.fillStyle = red ? "#b8322a" : "#1f1a18";
    const r = RANK_NAME[card[0]] ?? card[0];
    const s = SUIT_SYM[card[1]] ?? "?";
    g.font = "bold 34px 'PT Serif', Georgia, serif";
    g.textAlign = "left";
    g.fillText(r, 12, 40);
    g.font = "30px serif";
    g.fillText(s, 14, 72);
    g.save();
    g.translate(w, h);
    g.rotate(Math.PI);
    g.font = "bold 34px 'PT Serif', Georgia, serif";
    g.fillText(r, 12, 40);
    g.font = "30px serif";
    g.fillText(s, 14, 72);
    g.restore();
    g.font = "76px serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(s, w / 2, h / 2 + 4);
    // worn look
    for (let i = 0; i < 60; i++) {
      g.fillStyle = `rgba(120,90,40,${Math.random() * 0.08})`;
      g.fillRect(Math.random() * w, Math.random() * h, 3, 3);
    }
  });
}

function backTex(): THREE.Texture {
  return canvasTex("card_back", 128, 180, (g, w, h) => {
    g.fillStyle = "#8a3b2a";
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "#e8c97a";
    g.lineWidth = 3;
    g.strokeRect(8, 8, w - 16, h - 16);
    g.strokeStyle = "rgba(232,201,122,0.35)";
    for (let i = -h; i < w + h; i += 12) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + h, h);
      g.moveTo(i + h, 0);
      g.lineTo(i, h);
      g.stroke();
    }
    g.fillStyle = "#8a3b2a";
    g.beginPath();
    g.arc(w / 2, h / 2, 26, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#e8c97a";
    g.font = "bold 16px monospace";
    g.textAlign = "center";
    g.fillText("ГЛУБЖЕ", w / 2, h / 2 + 5);
  });
}

interface CardMesh {
  mesh: THREE.Mesh;
  target: THREE.Vector3;
  rot: THREE.Euler;
  face: string | null;
  lift: number;
}

export interface SeatInfo {
  char: string | null;
  color: number;
  name: string;
}

export class TableScene {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  cards = new Map<string, CardMesh>();
  heads: THREE.Group[] = [];
  seatsN = 4;
  mySeat = 0;
  raycaster = new THREE.Raycaster();
  hover: string | null = null;
  selectable = new Set<string>();
  selected: string | null = null;
  targetable = new Set<string>();
  /** multi-selection (Cheat: several cards at once) */
  multi = new Set<string>();
  board: THREE.Mesh;
  private boardCanvas = document.createElement("canvas");
  private boardTex: THREE.CanvasTexture;
  private boardKey = "";
  private shade: THREE.Object3D;
  private bulb: THREE.Object3D;
  private backMat: THREE.MeshLambertMaterial;
  private t = 0;
  private smoke: THREE.Points;
  /** Player-controlled table scale. Portrait starts wider so the hand and board fit. */
  zoom = 1;
  private zoomTouched = false;

  constructor() {
    this.scene.background = new THREE.Color(0x0d0a08);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    this.camera.position.set(0, 7.2, 6.2);
    this.camera.lookAt(0, 0, 0.6);
    const lamp = new THREE.SpotLight(0xffd9a0, 80, 20, 0.7, 0.5, 1.5);
    lamp.position.set(0, 7, 0);
    lamp.target.position.set(0, 0, 0);
    this.scene.add(lamp, lamp.target, new THREE.AmbientLight(0x6a5040, 0.7));
    // table
    const felt = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 0.2, 40), mat(0x2f5a3a));
    felt.position.y = -0.1;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.14, 8, 48), mat(0x5e3b1c));
    rim.rotation.x = Math.PI / 2;
    this.scene.add(felt, rim);
    // lamp shade & bulb
    this.shade = cyl(0.5, 0.3, 0x333333, 0, 4.2, 0, 16, 0.9);
    this.scene.add(this.shade);
    const bulb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.15), mat(0xfff0c0, { emissive: 0xffc070 }));
    bulb.position.set(0, 4.15, 0);
    this.scene.add(bulb);
    this.bulb = bulb;
    // floor
    const floor = box(20, 0.1, 20, 0x2a2018, 0, -2.2, 0);
    this.scene.add(floor);
    this.backMat = new THREE.MeshLambertMaterial({ map: backTex() });
    // smoke haze
    const n = 200;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 6;
      pos[i * 3 + 1] = 1 + Math.random() * 3;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 6;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.smoke = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xbfae98, size: 0.25, transparent: true, opacity: 0.12, depthWrite: false }));
    this.scene.add(this.smoke);
    // flat board surface (chess, lotto, magnate…) drawn on a canvas
    this.boardCanvas.width = this.boardCanvas.height = BOARD_PX;
    this.boardTex = new THREE.CanvasTexture(this.boardCanvas);
    this.boardTex.colorSpace = THREE.SRGBColorSpace;
    this.boardTex.anisotropy = 4;
    this.board = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 4.4), new THREE.MeshLambertMaterial({ map: this.boardTex, transparent: true }));
    this.board.rotation.x = -Math.PI / 2;
    this.board.position.set(0, 0.01, 0.2);
    this.board.visible = false;
    this.scene.add(this.board);
  }

  zoomBy(factor: number) {
    this.zoomTouched = true;
    this.zoom = Math.max(0.55, Math.min(1.65, this.zoom * factor));
  }

  resetZoom() {
    this.zoomTouched = false;
    this.zoom = innerHeight > innerWidth ? 0.68 : 1;
  }

  /** Redraw the board texture when the view changes. `game` null hides it. */
  /** board games get a top-down camera; card games keep the seated view */
  topDown = false;

  setBoard(game: string | null, view: any, ctx: BoardCtx, topDown = false) {
    this.board.visible = !!game && !!view;
    this.topDown = this.board.visible && topDown;
    if (!game || !view) return;
    const key = JSON.stringify([game, view, ctx]);
    if (key === this.boardKey) return;
    this.boardKey = key;
    drawBoard(this.boardCanvas.getContext("2d")!, game, view, ctx);
    this.boardTex.needsUpdate = true;
  }

  /** Board texture pixel under the cursor. */
  pickBoard(sx: number, sy: number): { x: number; y: number } | null {
    if (!this.board.visible) return null;
    const ndc = new THREE.Vector2((sx / window.innerWidth) * 2 - 1, -(sy / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.board, false)[0];
    if (!hit?.uv) return null;
    return { x: hit.uv.x * BOARD_PX, y: (1 - hit.uv.y) * BOARD_PX };
  }

  /** Seat angle: my seat is at the bottom (towards the camera). */
  seatAngle(i: number) {
    return Math.PI / 2 + ((i - this.mySeat) / this.seatsN) * Math.PI * 2;
  }

  seatPos(i: number, r = 2.6) {
    const a = this.seatAngle(i);
    return new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
  }

  setSeats(seats: SeatInfo[], mySeat: number) {
    this.seatsN = seats.length;
    this.mySeat = Math.max(0, mySeat);
    for (const hd of this.heads) this.scene.remove(hd);
    this.heads = [];
    seats.forEach((s, i) => {
      if (!s.char || i === this.mySeat) return;
      const g = new THREE.Group();
      g.add(box(0.8, 0.9, 0.5, s.color, 0, 0, 0));
      g.add(box(0.5, 0.5, 0.5, 0xe0b48f, 0, 0.95, 0));
      const p = this.seatPos(i, 3.9);
      g.position.set(p.x, -0.4, p.z);
      g.lookAt(0, 0, 0);
      this.heads.push(g);
      this.scene.add(g);
    });
  }

  private getCard(key: string, face: string | null): CardMesh {
    let c = this.cards.get(key);
    if (!c) {
      const geo = new THREE.BoxGeometry(CW, 0.012, CH);
      const mesh = new THREE.Mesh(geo, this.backMat);
      mesh.position.set(2.5, 0.5, -1.5); // appear from the deck side
      c = { mesh, target: new THREE.Vector3(), rot: new THREE.Euler(), face: null, lift: 0 };
      mesh.userData.key = key;
      this.scene.add(mesh);
      this.cards.set(key, c);
    }
    if (c.face !== face) {
      c.face = face;
      const top = face ? new THREE.MeshLambertMaterial({ map: faceTex(face) }) : this.backMat;
      // box material order: +x -x +y -y +z -z → top (+y) shows the face
      c.mesh.material = [this.backMat, this.backMat, top, this.backMat, this.backMat, this.backMat];
    }
    return c;
  }

  /** Lay out a Durak view. `me` = my seat id (char) or null for spectators. */
  layoutDurak(view: any, seatChars: (string | null)[], me: string | null) {
    const used = new Set<string>();
    const place = (key: string, face: string | null, pos: THREE.Vector3, rotY = 0, flat = true, tilt = 0, rx?: number) => {
      const c = this.getCard(key, face);
      c.target.copy(pos);
      c.rot.set(rx ?? (flat ? 0 : -1.0), rotY, tilt);
      used.add(key);
      return c;
    };
    // deck + trump
    for (let i = 0; i < Math.min(view.deck, 12); i++) place("deck" + i, null, new THREE.Vector3(2.2, 0.02 + i * 0.012, -0.9), 0.3);
    if (view.trumpCard) place("trump", view.trumpCard, new THREE.Vector3(2.0, 0.005, -0.5), Math.PI / 2 + 0.3);
    // discard pile
    for (let i = 0; i < Math.min(Math.ceil(view.discard / 2), 10); i++) place("disc" + i, null, new THREE.Vector3(-2.3, 0.02 + i * 0.012, -0.9), 0.6 + i * 0.3);
    // table pairs
    for (let i = 0; i < Math.min(view.pileBacks ?? 0, 10); i++) place("pile" + i, null, new THREE.Vector3((i % 3) * 0.05 - 0.05, 0.02 + i * 0.012, 0.1), i * 0.4);
    const n = view.table.length;
    view.table.forEach((t: any, i: number) => {
      const x = (i - (n - 1) / 2) * 0.85;
      place("t" + t.a, t.a, new THREE.Vector3(x, 0.02, 0.05));
      if (t.d) place("t" + t.d, t.d, new THREE.Vector3(x + 0.18, 0.04, 0.3), -0.15);
    });
    // hands
    const players: string[] = view.players;
    players.forEach((p) => {
      const seat = seatChars.indexOf(p);
      if (seat < 0) return;
      const h = view.hands[p];
      if (p === me && Array.isArray(h)) {
        // my fan: close to the camera, tilted towards it
        const m = h.length;
        h.forEach((card: string, k: number) => {
          const x = (k - (m - 1) / 2) * Math.min(0.55, 5 / Math.max(1, m));
          const c = place("h" + card, card, new THREE.Vector3(x, 1.2 + k * 0.004, 3.0 - Math.abs(k - (m - 1) / 2) * 0.03), 0, false, -(k - (m - 1) / 2) * 0.04, 0.55);
          c.lift = this.selected === card || this.multi.has(card) ? 0.35 : this.hover === "h" + card ? 0.18 : 0;
        });
      } else {
        const cnt = typeof h === "number" ? h : h.length;
        const a = this.seatAngle(seat);
        const base = this.seatPos(seat, 2.35);
        for (let k = 0; k < cnt; k++) {
          const off = (k - (cnt - 1) / 2) * 0.16;
          const pos = new THREE.Vector3(base.x + Math.cos(a + Math.PI / 2) * off, 0.3 + k * 0.004, base.z + Math.sin(a + Math.PI / 2) * off);
          place(`o${p}_${k}`, null, pos, -a + Math.PI / 2, false);
        }
      }
    });
    for (const [k, c] of this.cards) {
      if (!used.has(k)) {
        this.scene.remove(c.mesh);
        this.cards.delete(k);
      }
    }
  }

  frame(dt: number, renderer: THREE.WebGLRenderer) {
    this.t += dt;
    const w = window.innerWidth,
      h = window.innerHeight;
    this.camera.aspect = w / h;
    if (!this.zoomTouched) this.zoom = h > w ? 0.68 : 1;
    this.camera.zoom = this.zoom;
    this.camera.updateProjectionMatrix();
    const k = Math.min(1, dt * 4);
    const want = this.topDown ? new THREE.Vector3(0, 8.6, 2.6) : new THREE.Vector3(0, 7.2, 6.2);
    this.camera.position.lerp(want, k);
    this.camera.lookAt(0, 0, this.topDown ? 0.55 : 0.6);
    this.shade.visible = this.bulb.visible = !this.topDown;
    for (const c of this.cards.values()) {
      const k = Math.min(1, dt * 9);
      const tgt = c.target.clone();
      tgt.y += c.lift;
      if (c.lift) tgt.z -= c.lift * 0.6;
      c.mesh.position.lerp(tgt, k);
      c.mesh.rotation.x += (c.rot.x - c.mesh.rotation.x) * k;
      c.mesh.rotation.y += (c.rot.y - c.mesh.rotation.y) * k;
      c.mesh.rotation.z += (c.rot.z - c.mesh.rotation.z) * k;
      const key = c.mesh.userData.key as string;
      const glow = this.selectable.has(key) || this.targetable.has(key);
      const mats = c.mesh.material as THREE.MeshLambertMaterial[];
      if (Array.isArray(mats)) {
        const m = mats[2];
        m.emissive?.setHex(this.selected && key === "h" + this.selected ? 0x664400 : glow ? 0x2a2a10 : 0);
      }
    }
    for (const hd of this.heads) hd.position.y = -0.4 + Math.sin(this.t * 1.5 + hd.position.x) * 0.02;
    this.smoke.rotation.y += dt * 0.02;
    renderer.render(this.scene, this.camera);
  }

  pick(sx: number, sy: number): string | null {
    const ndc = new THREE.Vector2((sx / window.innerWidth) * 2 - 1, -(sy / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const meshes = [...this.cards.values()].map((c) => c.mesh);
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    return hit ? (hit.object.userData.key as string) : null;
  }
}
