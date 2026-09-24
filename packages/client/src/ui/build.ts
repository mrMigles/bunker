import * as THREE from "three";
import { ROOMS, canPlaceRoom, costText, neededRoom, roomAt, roomCost, roomLocked, stairFor } from "@bunker/shared";
import { net } from "../net";
import type { WorldRenderer } from "../render/world";
import { add, clear, h, ui, toast } from "./dom";

const ORDER = ["corridor", "shaft", "support", "living", "storage", "hydro", "mushroom", "kitchen", "mess", "rabbits", "waterworks", "genroom", "batteries", "workshop", "chemlab", "med", "radioroom", "rec", "chapel", "armory", "range", "defense", "turretroom", "lift", "airlock2", "brig", "tech", "airlock"];

export class BuildMode {
  active = false;
  type = "corridor";
  width = 1;
  panel = h("div.panel", { style: { position: "fixed", left: "10px", top: "44px", bottom: "200px", width: "300px", overflow: "auto", padding: "8px", fontSize: "12px" } });
  ghost: THREE.Mesh;
  info = h("div.prompt.hidden");
  hover: { x: number; lv: number } | null = null;
  labels = h("div.layer");
  /** green frames on every spot where the selected room fits right now */
  private spots = new THREE.Group();
  private spotsKey = "";
  private savedCam: { x: number; y: number; h: number } | null = null;

  constructor(private r: WorldRenderer) {
    this.ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1.7), new THREE.MeshBasicMaterial({ color: 0x66ff66, transparent: true, opacity: 0.3, depthWrite: false }));
    this.ghost.visible = false;
    r.scene.add(this.ghost);
    r.scene.add(this.spots);
    this.panel.classList.add("hidden");
    ui().append(this.panel, this.info, this.labels);
    const canvas = r.renderer.domElement;
    canvas.addEventListener("mousedown", (e) => {
      if (!this.active) return;
      if (e.button === 0) this.place();
      else if (e.button === 2 && e.shiftKey) this.cancelAt();
    });
    canvas.addEventListener(
      "wheel",
      (e) => {
        if (!this.active || !e.shiftKey) return;
        e.stopImmediatePropagation();
        e.preventDefault();
        this.setWidth(this.width + (e.deltaY > 0 ? -1 : 1));
      },
      { capture: true },
    );
  }

  toggle(v = !this.active) {
    this.active = v;
    this.panel.classList.toggle("hidden", !v);
    this.ghost.visible = false;
    this.info.classList.add("hidden");
    this.spots.visible = v;
    this.spotsKey = "";
    if (v) {
      this.renderPanel();
      this.frameBunker();
    } else if (this.savedCam) {
      // back to following the character
      this.r.viewH = this.savedCam.h;
      this.r.follow = true;
      this.r.updateCamera();
      this.savedCam = null;
    }
  }

  /** Zoom out so the whole base and the rock around it (where new rooms go) is on screen. */
  frameBunker() {
    const v = net.pub;
    if (!v) return;
    const rooms = Object.values(v.rooms as Record<string, any>);
    if (!rooms.length) return;
    const x0 = Math.min(...rooms.map((r) => r.x)) - 6,
      x1 = Math.max(...rooms.map((r) => r.x + r.w)) + 6;
    const lv1 = Math.max(...rooms.map((r) => r.lv)) + 2;
    this.savedCam = { x: this.r.camX, y: this.r.camY, h: this.r.viewH };
    this.r.follow = false;
    const aspect = window.innerWidth / window.innerHeight;
    // leave room for the palette on the left
    this.r.viewH = Math.max((x1 - x0) / aspect / 0.75, (lv1 + 1) * 2 + 3);
    this.r.camX = (x0 + x1) / 2 - (this.r.viewH * aspect) * 0.1;
    this.r.camY = -(lv1 + 1);
    this.r.updateCamera();
  }

  /** Recompute the green «fits here» frames for the selected room type and width. */
  private updateSpots(v: any) {
    const key = JSON.stringify([this.type, this.width, Object.values(v.rooms).map((r: any) => [r.x, r.lv, r.w, r.state])]);
    if (key === this.spotsKey) return;
    this.spotsKey = key;
    for (const m of this.spots.children as THREE.Mesh[]) m.geometry.dispose();
    this.spots.clear();
    if (lockedRoom(v, this.type)) return;
    const maxLv = Math.max(...Object.values(v.rooms).map((r: any) => r.lv)) + 1;
    const mat = new THREE.MeshBasicMaterial({ color: 0x66ff66, transparent: true, opacity: 0.16, depthWrite: false });
    for (let lv = 0; lv <= maxLv; lv++) {
      const ok: number[] = [];
      for (let x = 1; x + this.width < v.W - 1; x++) if (!canPlaceRoom(v, this.type, x, lv, this.width)) ok.push(x);
      // merge overlapping anchors into runs to keep it readable
      for (let i = 0; i < ok.length; ) {
        let j = i;
        while (j + 1 < ok.length && ok[j + 1] === ok[j] + 1) j++;
        const from = ok[i],
          to = ok[j] + this.width;
        const m = new THREE.Mesh(new THREE.BoxGeometry(to - from - 0.1, 1.9, 0.2), mat);
        m.position.set((from + to) / 2, -(lv * 2 + 1), 0.4);
        this.spots.add(m);
        i = j + 1;
      }
    }
  }

  setWidth(n: number) {
    const def = ROOMS[this.type];
    this.width = Math.max(def.w[0], Math.min(def.w[1], n));
  }

  select(type: string) {
    this.type = type;
    this.width = ROOMS[type].w[0];
    this.renderPanel();
  }

  renderPanel() {
    const v = net.pub;
    clear(this.panel);
    this.panel.append(
      h("div", { style: { color: "var(--warm)", marginBottom: "6px" } }, "🏗 Стройка (B — выход)"),
      h("div.dim", { style: { marginBottom: "6px" } }, "ЛКМ — разметить · Shift+колесо / [ ] — ширина · Shift+ПКМ — отменить/снести. Размеченное надо выкопать (E у породы), вынести грунт к люку и построить каркас."),
    );
    // what the colony needs right now goes first, with the reason
    let need: { type: string; why: string } | null = null;
    try {
      need = v ? neededRoom(v as any) : null;
    } catch {
      need = null;
    }
    if (need && ROOMS[need.type]) {
      const d = ROOMS[need.type];
      this.panel.appendChild(
        h(
          "div.build-need",
          { onclick: () => this.select(need!.type) },
          h("b", null, `★ Сейчас нужно: ${d.name}`),
          h("div.dim", null, need.why[0].toUpperCase() + need.why.slice(1) + " · " + costText(d.cost)),
        ),
      );
    }
    for (const id of ORDER) {
      const d = ROOMS[id];
      if (!d) continue;
      const locked = v && lockedRoom(v, id);
      this.panel.appendChild(
        h(
          "div",
          {
            style: { padding: "5px", margin: "2px 0", cursor: locked ? "default" : "pointer", border: "1px solid " + (id === this.type ? "var(--rust)" : "transparent"), background: id === this.type ? "#2a221c" : "", opacity: locked ? 0.45 : 1 },
            onclick: () => !locked && this.select(id),
          },
          h("b", null, d.name),
          h("span.dim", null, ` ${d.w[0] === d.w[1] ? d.w[0] : d.w[0] + "–" + d.w[1]} кл.`),
          h("div.dim", null, (d.perCell ? "за клетку: " : "") + costText(d.cost)),
          id === this.type ? h("div", null, d.desc) : null,
          locked ? h("div.warn", null, "🔒 " + locked) : null,
        ),
      );
    }
  }

  frame(mouseWx: number, mouseWy: number) {
    const v = net.pub;
    if (!this.active || !v) {
      this.ghost.visible = false;
      this.info.classList.add("hidden");
      this.updateLabels();
      return;
    }
    this.updateSpots(v);
    const lv = Math.floor(-mouseWy / 2);
    const x = Math.floor(mouseWx - this.width / 2 + 0.5);
    this.hover = { x, lv };
    const err = lv < 0 ? "Выше земли не строим" : lockedRoom(v, this.type) || canPlaceRoom(v as any, this.type, x, lv, this.width);
    this.ghost.visible = true;
    this.ghost.scale.set(this.width, 1, 1);
    this.ghost.position.set(x + this.width / 2, -(lv * 2 + 1), -0.8);
    (this.ghost.material as THREE.MeshBasicMaterial).color.setHex(err ? 0xff4444 : 0x66ff66);
    const [sx, sy] = this.r.toScreen(x + this.width / 2, -(lv * 2));
    this.info.style.left = sx + "px";
    this.info.style.top = sy + "px";
    this.info.classList.remove("hidden");
    clear(this.info);
    add(this.info, h("b", null, `${ROOMS[this.type].name} ×${this.width}`), h("div.dim", null, costText(roomCost(this.type, this.width))), err ? h("div.bad", null, err) : h("div.good", null, "ЛКМ — разметить"), !err && !roomAt(v as any, x - 1, lv) && !roomAt(v as any, x + this.width, lv) && stairFor(v as any, x, lv, this.width) ? h("div.dim", null, "🪜 Лестница к соседнему этажу появится сама") : null);
    this.updateLabels();
  }

  place() {
    if (!this.hover) return;
    net.send({ k: "plan", type: this.type, x: this.hover.x, lv: this.hover.lv, w: this.width });
  }

  cancelAt() {
    const v = net.pub;
    if (!v || !this.hover) return;
    const r = roomAt(v as any, this.hover.x + Math.floor(this.width / 2), this.hover.lv);
    if (!r) return;
    if (r.state === "done" && !confirm(`Снести «${ROOMS[r.type].name}»? Вернётся половина материалов.`)) return;
    net.send({ k: "cancelRoom", id: r.id });
    toast(r.state === "done" ? "Сносим…" : "Разметка отменена");
  }

  private labelKey = "";
  updateLabels() {
    const v = net.pub;
    if (!v) return;
    // bunker plan labels belong to the bunker view only (not to a building on a sortie, a fight or the map)
    const b = document.body.classList;
    const inBunker = !b.contains("mode-site") && !b.contains("mode-map") && !b.contains("mode-combat") && !b.contains("mode-prologue") && !b.contains("mode-table");
    this.labels.style.display = inBunker ? "" : "none";
    if (!inBunker) return;
    const rooms = Object.values(v.rooms) as any[];
    const key = JSON.stringify(rooms.filter((r) => r.state !== "done").map((r) => [r.id, r.state, r.work])) + this.r.camX.toFixed(1) + this.r.camY.toFixed(1) + this.r.viewH;
    if (key === this.labelKey) return;
    this.labelKey = key;
    clear(this.labels);
    for (const r of rooms) {
      if (r.state === "done" && !this.active) continue;
      const [sx, sy] = this.r.toScreen(r.x + r.w / 2, -(r.lv * 2) - 0.1);
      const d = ROOMS[r.type];
      let status = "";
      if (r.state === "dig") {
        let left = 0;
        for (const k in v.marks) if (v.marks[k] === r.id) left++;
        status = `⛏ копать: ${left} кл.`;
      } else if (r.state === "frame") status = `🏗 каркас ${Math.round((r.work / (d?.work ?? 30)) * 100)}% · ${costText(roomCost(r.type, r.w))}`;
      else if (this.active) status = `ур.${r.level}`;
      this.labels.appendChild(h("div.label", { style: { left: sx + "px", top: sy + 18 + "px", fontSize: "11px" } }, h("div.nm", null, `${d?.name ?? r.type} ${status}`)));
    }
  }
}

function lockedRoom(v: any, type: string): string {
  return roomLocked(v, type);
}
