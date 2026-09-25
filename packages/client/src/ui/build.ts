import * as THREE from "three";
import { ROOMS, canPlaceRoom, costText, neededRoom, roomAt, roomCost, roomLocked, stairFor } from "@bunker/shared";
import { net } from "../net";
import type { WorldRenderer } from "../render/world";
import { add, clear, closeModal, h, modal, ui, toast } from "./dom";
import { mobile } from "../touch";
import { icon, type IconName } from "./icons";

/** A picture for every room in the strip and the list. */
const ROOM_IC: Record<string, [IconName, string]> = {
  corridor: ["exit", "#c9b79a"], shaft: ["download", "#c9b79a"], support: ["shield", "#b8a58a"], living: ["moon", "#9fb7e0"],
  storage: ["box", "#d9a867"], hydro: ["feather", "#8fcf6a"], mushroom: ["feather", "#c8a0e0"], kitchen: ["pot", "#e8a45a"],
  mess: ["fork", "#e8a45a"], rabbits: ["heart", "#e89a9a"], waterworks: ["water", "#5fb0f0"], genroom: ["energy", "#f2cf55"],
  batteries: ["energy", "#9fdc6a"], workshop: ["wrench", "#d9b37a"], chemlab: ["alert", "#9fdc6a"], med: ["meds", "#ee6b5f"],
  radioroom: ["radio", "#9fc4ff"], rec: ["gamepad", "#e0b3ff"], chapel: ["star", "#f2d47a"], armory: ["swords", "#e07a5f"],
  range: ["crosshair", "#e07a5f"], defense: ["shield", "#e0a05f"], turretroom: ["target", "#e0705f"], lift: ["download", "#c9d0d6"],
  airlock2: ["hatch", "#c9d0d6"], brig: ["lock", "#b0b0b0"], tech: ["gear", "#c9d0d6"], airlock: ["hatch", "#c9d0d6"],
};
const roomIcon = (type: string, size = 22) => {
  const [n, c] = ROOM_IC[type] ?? ["box", "#d9a867"];
  return icon(n, { size, color: c });
};

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
  /** the next click cancels / demolishes instead of marking (the touch stand-in for Shift+right click) */
  erase = false;
  private savedCam: { x: number; y: number; h: number } | null = null;
  /** phones: the bottom strip (rooms in a row, width, «Разметить»), and where the plan stands now */
  strip = h("div.build-strip.hidden");
  private stripInfo = h("div.build-info");
  private stripCards = h("div.build-cards");
  private widthEl = h("b.build-w");
  private eraseBtn!: HTMLElement;
  private placeBtn!: HTMLElement;
  /** the plan's cell on a phone (the finger moves it; there is no mouse hovering) */
  private pos: { x: number; lv: number } | null = null;
  /** the plan fits where it stands */
  ok = false;
  private drag: { id: number; sx: number; sy: number; x0: number; lv0: number; moved: boolean } | null = null;
  private fingers = new Set<number>();

  constructor(private r: WorldRenderer) {
    this.ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1.7), new THREE.MeshBasicMaterial({ color: 0x66ff66, transparent: true, opacity: 0.3, depthWrite: false }));
    this.ghost.visible = false;
    // a bright outline: on a phone the plan is small on the zoomed-out base
    this.ghost.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 2, 1.7)), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 })));
    r.scene.add(this.ghost);
    r.scene.add(this.spots);
    this.panel.classList.add("hidden");
    ui().append(this.panel, this.info, this.labels);
    const canvas = r.renderer.domElement;
    if (mobile) this.makeStrip(canvas);
    canvas.addEventListener("mousedown", (e) => {
      // phones place with the strip's «Разметить», never with the tap a touch turns into
      if (!this.active || mobile) return;
      if (e.button === 0 && this.erase) {
        // phones: «Снести», then a touch on the marked room
        this.erase = false;
        this.cancelAt();
      } else if (e.button === 0) this.place();
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
    this.erase = false;
    this.drag = null;
    this.panel.classList.toggle("hidden", !v || mobile);
    this.strip.classList.toggle("hidden", !v);
    this.ghost.visible = false;
    this.info.classList.add("hidden");
    this.spots.visible = v;
    this.spotsKey = "";
    if (v) {
      this.renderPanel();
      this.frameBunker();
      if (mobile) {
        this.renderStrip();
        this.pos = this.nearestFit(this.r.camX, -this.r.camY / 2);
      }
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
    if (mobile) {
      // the strip takes the bottom and the top bar the top: fit the base in between
      const H = window.innerHeight;
      const top = 44,
        bottom = window.innerWidth > H ? 104 : 150;
      const free = Math.max(0.3, (H - top - bottom) / H);
      this.r.viewH = Math.min(48, Math.max((x1 - x0) / aspect, ((lv1 + 1) * 2 + 2) / free));
      this.r.camX = (x0 + x1) / 2;
      this.r.camY = -(lv1 + 1) - ((bottom - top) / 2 / H) * this.r.viewH;
      this.r.updateCamera();
      return;
    }
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
    if (mobile && this.pos) this.pos = this.snap(this.pos.x, this.pos.lv) ?? this.pos;
    this.widthEl.textContent = String(this.width);
  }

  select(type: string) {
    this.type = type;
    this.width = ROOMS[type].w[0];
    this.renderPanel();
    if (mobile) {
      this.erase = false;
      this.eraseBtn?.classList.remove("on");
      this.renderStrip();
      // the plan jumps to the free spot nearest to where it stood (or to the middle of the screen)
      const from = this.pos ?? { x: this.r.camX, lv: -this.r.camY / 2 };
      this.pos = this.nearestFit(from.x + this.width / 2, from.lv + 0.5) ?? this.pos;
    }
  }

  // ---------------------------------------------------------------- phones
  /** Does the selected room fit here? (the same check the server makes) */
  private fits(x: number, lv: number) {
    const v = net.pub as any;
    return !!v && lv >= 0 && !lockedRoom(v, this.type) && !canPlaceRoom(v, this.type, x, lv, this.width);
  }

  /** The free spot nearest to a point anywhere in the bunker (a new pick, a new width). */
  nearestFit(wx: number, wlv: number): { x: number; lv: number } | null {
    const v = net.pub as any;
    if (!v) return null;
    const maxLv = Math.max(...Object.values(v.rooms).map((r: any) => r.lv)) + 1;
    let best: { x: number; lv: number } | null = null,
      bd = Infinity;
    for (let lv = 0; lv <= maxLv; lv++)
      for (let x = 1; x + this.width < v.W - 1; x++) {
        const d = Math.abs(x + this.width / 2 - wx) + Math.abs(lv + 0.5 - wlv) * 6;
        if (d < bd && this.fits(x, lv)) {
          bd = d;
          best = { x, lv };
        }
      }
    return best;
  }

  /** Where the plan lands for a finger over (x, lv): right there, or the nearest fitting cell a step or three away on that floor. */
  snap(x: number, lv: number): { x: number; lv: number } | null {
    if (this.fits(x, lv)) return { x, lv };
    for (let d = 1; d <= 3; d++) for (const s of [-1, 1]) if (this.fits(x + s * d, lv)) return { x: x + s * d, lv };
    return null;
  }

  /** The nearest spot that fits on this floor, if any (e2e). */
  bestSpot(x: number, lv: number) {
    for (let d = 0; d <= 30; d++) for (const s of [-1, 1]) if (this.fits(x + s * d, lv)) return { x: x + s * d, lv };
    return null;
  }

  private makeStrip(canvas: HTMLCanvasElement) {
    const btn = (cls: string, ic: IconName, label: string, onclick: () => void, title = label, color?: string) =>
      h("button" + cls, { onclick, title, "aria-label": title }, icon(ic, { size: 18, color }), label ? h("span", null, label) : null);
    this.eraseBtn = btn(".build-erase", "x", "Снести", () => {
      this.erase = !this.erase;
      this.eraseBtn.classList.toggle("on", this.erase);
      toast(this.erase ? "Коснитесь размеченной или построенной комнаты" : "Снос отменён");
    }, "Снести", "#ee6b5f");
    this.placeBtn = btn(".build-place.primary", "check", "Разметить", () => this.place());
    this.strip.append(
      h(
        "div.build-tools",
        null,
        btn(".build-done", "x", "Готово", () => this.toggle(false), "Закончить стройку"),
        h("div.build-width", null, btn(".build-narrow", "minus", "", () => this.setWidth(this.width - 1), "Уже"), this.widthEl, btn(".build-wide", "plus", "", () => this.setWidth(this.width + 1), "Шире")),
        this.stripInfo,
        this.eraseBtn,
        this.placeBtn,
      ),
      h("div.build-row", null, h("button.build-all", { onclick: () => this.openList(), title: "Все комнаты" }, icon("menu", { size: 18 }), h("span", null, "Все")), this.stripCards),
    );
    ui().append(this.strip);
    // one finger on the scene drags the plan; a tap puts it there; two fingers are the camera's (touch.ts)
    canvas.addEventListener("pointerdown", (e) => {
      if (!this.active || e.pointerType === "mouse") return;
      this.fingers.add(e.pointerId);
      if (this.fingers.size > 1) {
        // a pinch: put the plan back where the first finger found it
        if (this.drag?.moved) this.pos = { x: this.drag.x0, lv: this.drag.lv0 };
        this.drag = null;
        return;
      }
      const p = this.pos ?? this.cellAt(e.clientX, e.clientY);
      this.drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x0: p.x, lv0: p.lv, moved: false };
    });
    window.addEventListener("pointermove", (e) => {
      const d = this.drag;
      if (!d || e.pointerId !== d.id || !this.active || this.erase) return;
      if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 10) return;
      d.moved = true;
      // the plan follows the finger by the finger's own way (not jumping under it), snapping to cells
      const [ax, ay] = this.r.toWorld(d.sx, d.sy);
      const [bx, by] = this.r.toWorld(e.clientX, e.clientY);
      const x = Math.round(d.x0 + (bx - ax));
      const lv = Math.max(0, Math.round(d.lv0 - (by - ay) / 2));
      this.pos = this.snap(x, lv) ?? { x, lv };
    });
    const up = (e: PointerEvent) => {
      this.fingers.delete(e.pointerId);
      const d = this.drag;
      if (!d || e.pointerId !== d.id) return;
      this.drag = null;
      if (d.moved || !this.active || this.fingers.size) return;
      // a tap
      const c = this.cellAt(e.clientX, e.clientY);
      if (this.erase) {
        this.erase = false;
        this.eraseBtn.classList.remove("on");
        this.cancelCell(c.x, c.lv);
        return;
      }
      const x = c.x - Math.floor(this.width / 2);
      this.pos = this.snap(x, c.lv) ?? { x, lv: c.lv };
    };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  private cellAt(sx: number, sy: number) {
    const [wx, wy] = this.r.toWorld(sx, sy);
    return { x: Math.floor(wx), lv: Math.max(0, Math.floor(-wy / 2)) };
  }

  private cardEl(id: string, v: any, big = false) {
    const d = ROOMS[id];
    const locked = v ? lockedRoom(v, id) : "";
    return h(
      "button.build-card" + (id === this.type ? ".sel" : "") + (locked ? ".locked" : "") + (big ? ".big" : ""),
      {
        "data-type": id,
        title: locked ? d.name + " — " + locked : d.name,
        onclick: () => {
          if (locked) return toast("🔒 " + locked);
          closeModal();
          this.select(id);
        },
      },
      h("span.build-card-ic", null, locked ? icon("lock", { size: big ? 22 : 18, color: "#9a8b76" }) : roomIcon(id, big ? 26 : 20)),
      h("span.build-card-t", null, h("b", null, d.name), h("small", null, costText(roomCost(id, d.w[0])))),
      big ? h("small.build-card-d", null, locked ? "🔒 " + locked : (d.w[0] === d.w[1] ? d.w[0] : d.w[0] + "–" + d.w[1]) + " кл. · " + d.desc) : null,
    );
  }

  private renderStrip() {
    const v = net.pub as any;
    let need: { type: string } | null = null;
    try {
      need = v ? neededRoom(v) : null;
    } catch {
      need = null;
    }
    const order = [...(need && ROOMS[need.type] ? [need.type] : []), ...ORDER.filter((id) => ROOMS[id] && id !== need?.type)];
    // what can be built first, the locked ones at the end
    const open = order.filter((id) => !v || !lockedRoom(v, id)),
      shut = order.filter((id) => v && lockedRoom(v, id));
    this.stripCards.replaceChildren(
      ...[...open, ...shut].map((id) => {
        const el = this.cardEl(id, v);
        if (id === need?.type) el.classList.add("need");
        return el;
      }),
    );
    this.widthEl.textContent = String(this.width);
    const sel = this.stripCards.querySelector<HTMLElement>(".sel");
    if (sel) this.stripCards.scrollLeft = Math.max(0, sel.offsetLeft - this.stripCards.clientWidth / 2 + sel.offsetWidth / 2);
  }

  /** The whole list, big cards with what each room does. */
  openList() {
    const v = net.pub as any;
    modal("🏗 Что построить", [h("div.build-grid", null, ...ORDER.filter((id) => ROOMS[id]).map((id) => this.cardEl(id, v, true)))], { wide: true, cls: "build-list" });
  }

  private stripKey = "";
  private updateStrip(err: string | null) {
    const key = JSON.stringify([this.type, this.width, err, this.erase]);
    if (key === this.stripKey) return;
    this.stripKey = key;
    this.placeBtn.toggleAttribute("disabled", !!err || this.erase);
    clear(this.stripInfo);
    add(
      this.stripInfo,
      h("b", null, ROOMS[this.type].name + " ×" + this.width),
      this.erase ? h("small.warn", null, "Коснитесь комнаты, чтобы снести") : err ? h("small.bad", null, err) : h("small.good", null, costText(roomCost(this.type, this.width))),
    );
  }

  renderPanel() {
    const v = net.pub;
    clear(this.panel);
    this.panel.append(
      h("div", { style: { color: "var(--warm)", marginBottom: "6px" } }, "🏗 Стройка" + (mobile ? "" : " (B — выход)")),
      h("div.dim", { style: { marginBottom: "6px" } }, mobile ? "Касание — разметить · «Уже» / «Шире» — ширина · «Снести», затем касание — отменить или снести. Размеченное надо выкопать (✋ у породы), вынести грунт к люку и построить каркас." : "ЛКМ — разметить · Shift+колесо / [ ] — ширина · Shift+ПКМ — отменить/снести. Размеченное надо выкопать (E у породы), вынести грунт к люку и построить каркас."),
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
    let lv = Math.floor(-mouseWy / 2);
    let x = Math.floor(mouseWx - this.width / 2 + 0.5);
    if (mobile) {
      if (!this.pos) this.pos = this.nearestFit(this.r.camX, -this.r.camY / 2) ?? { x: Math.round(this.r.camX), lv: 0 };
      ({ x, lv } = this.pos);
    }
    this.hover = { x, lv };
    const err = lv < 0 ? "Выше земли не строим" : lockedRoom(v, this.type) || canPlaceRoom(v as any, this.type, x, lv, this.width);
    this.ok = !err;
    if (mobile) {
      this.ghost.visible = !this.erase;
      this.ghost.scale.set(this.width, 1, 1);
      this.ghost.position.set(x + this.width / 2, -(lv * 2 + 1), -0.8);
      (this.ghost.material as THREE.MeshBasicMaterial).color.setHex(err ? 0xff4444 : 0x66ff66);
      this.info.classList.add("hidden");
      this.updateStrip(err || null);
      this.updateLabels();
      return;
    }
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
    if (this.hover) this.cancelCell(this.hover.x + Math.floor(this.width / 2), this.hover.lv);
  }

  cancelCell(x: number, lv: number) {
    const v = net.pub;
    if (!v) return;
    const r = roomAt(v as any, x, lv);
    if (!r) return mobile ? toast("Здесь нет комнаты") : undefined;
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
    const key = JSON.stringify(rooms.filter((r) => r.state !== "done").map((r) => [r.id, r.state, r.work])) + this.r.toScreen(0, 0).map((n) => Math.round(n)).join() + this.r.toScreen(10, -10).map((n) => Math.round(n)).join();
    if (key === this.labelKey) return;
    this.labelKey = key;
    clear(this.labels);
    for (const r of rooms) {
      if (r.state === "done" && !this.active) continue;
      const [sx, sy] = this.r.toScreen(r.x + r.w / 2, -(r.lv * 2) - 0.1);
      if (mobile && r.state === "done" && this.r.toScreen(r.x + r.w, 0)[0] - this.r.toScreen(r.x, 0)[0] < 70) continue;
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
