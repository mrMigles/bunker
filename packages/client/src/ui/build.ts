import * as THREE from "three";
import { ROOMS, canPlaceRoom, costText, neededRoom, roomAt, roomCost, roomLocked } from "@bunker/shared";
import { net } from "../net";
import type { WorldRenderer } from "../render/world";
import { clear, h, ui, toast } from "./dom";

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

  constructor(private r: WorldRenderer) {
    this.ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1.7), new THREE.MeshBasicMaterial({ color: 0x66ff66, transparent: true, opacity: 0.3, depthWrite: false }));
    this.ghost.visible = false;
    r.scene.add(this.ghost);
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
    if (v) this.renderPanel();
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
    this.info.append(h("b", null, `${ROOMS[this.type].name} ×${this.width}`), h("div.dim", null, costText(roomCost(this.type, this.width))), err ? h("div.bad", null, err) : h("div.good", null, "ЛКМ — разметить"));
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
