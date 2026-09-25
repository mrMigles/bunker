import { net } from "../net";
import type { WorldRenderer } from "../render/world";
import { onKeyDown, onKeyUp, typing } from "../input";
import { BuildMode } from "./build";
import { CouncilUI } from "./council";
import { closeModal, h, isModalOpen, toast, ui } from "./dom";
import type { Hud } from "./hud";
import { Prompt } from "./prompt";
import { MouseNavigation } from "../navigation";
import { OBJECTS } from "@bunker/shared";

export class GameUI {
  navigation = new MouseNavigation();
  routeMarker = h("div.route-marker.hidden", null, "◎");
  hoverChar: string | null = null;
  mouse = { x: 0, y: 0, wx: 0, wy: 0 };
  dragging: { x: number; y: number; state: CameraGesture } | null = null;
  cameraControls = h("div.camera-controls", null);
  chatBox: HTMLInputElement;
  chatWrap: HTMLElement;
  prompt: Prompt;
  build: BuildMode;
  council: CouncilUI;
  aquarium = false;
  table: import("./tableui").TableUI | null = null;
  combat: import("./combat").CombatUI | null = null;
  exp: import("./expedition").ExpeditionUI | null = null;
  pro: import("./prologue").PrologueUI | null = null;
  private lastPhase = "";
  static extraKeys: ((e: KeyboardEvent, g: GameUI) => boolean | void)[] = [];
  static extraFrame: ((dt: number, g: GameUI) => void)[] = [];
  static extraPatch: ((g: GameUI) => void)[] = [];

  constructor(
    public r: WorldRenderer,
    public hud: Hud,
  ) {
    const canvas = r.renderer.domElement;
    this.cameraControls.append(
      h("button", { "aria-label": "Отдалить камеру", onclick: () => this.zoomCamera(1.2) }, "−"),
      h("button", { "aria-label": "Вернуть камеру к персонажу", onclick: () => this.resumeCameraFollow() }, "⌾"),
      h("button", { "aria-label": "Приблизить камеру", onclick: () => this.zoomCamera(1 / 1.2) }, "+"),
    );
    ui().append(this.routeMarker, this.cameraControls);
    canvas.addEventListener("click", (e) => {
      if (e.button !== 0 || this.build.active || this.inputBlocked()) return;
      if (this.pro?.active) { this.pro.handleClick(e.clientX, e.clientY); return; }
      if (this.exp?.mode === "site" && this.exp.handleClick(e.clientX, e.clientY)) return;
      const site = this.exp?.mode === "site" ? this.exp.site : null;
      const [x, y] = site ? site.toWorld(e.clientX, e.clientY) : r.toWorld(e.clientX, e.clientY);
      const lv = Math.max(site ? 0 : -1, Math.floor(-y / 2));
      if (!site && this.hoverChar) return;
      if (!site && net.pub) {
        const object = Object.values(net.pub.objs).filter((o: any) => o.lv === lv && !o.st?.hidden && Math.abs(o.x + .5 - x) < .8).sort((a: any,b: any) => Math.abs(a.x+.5-x)-Math.abs(b.x+.5-x))[0] as any;
        if (object) {
          this.navigation.go(object.x+.5, lv, () => this.prompt.focus(object.id, OBJECTS[object.kind]?.name ?? "Действия"));
          r.follow = true;
          return;
        }
      }
      this.navigation.go(x, lv);
      r.follow = true;
    });
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.zoomCamera(e.deltaY > 0 ? 1.12 : 1 / 1.12);
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("mousedown", (e) => {
      if (e.button === 1 || (e.button === 2 && !e.shiftKey)) {
        this.dragging = { x: e.clientX, y: e.clientY, state: this.cameraGesture() };
        this.setCameraFollow(false);
      }
    });
    window.addEventListener("mouseup", () => (this.dragging = null));
    window.addEventListener("mousemove", (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      if (this.dragging) {
        this.applyCameraGesture(this.dragging.state, 1, e.clientX - this.dragging.x, e.clientY - this.dragging.y);
      }
    });
    this.chatBox = h("input", { placeholder: "Сообщение… (Enter)", maxLength: 200 }) as HTMLInputElement;
    this.chatWrap = h("div.chat.hidden", null, this.chatBox);
    ui().appendChild(this.chatWrap);
    this.chatBox.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const t = this.chatBox.value.trim();
        if (t) net.chat(t);
        this.chatBox.value = "";
        this.chatBox.blur();
        this.chatWrap.classList.add("hidden");
      } else if (e.key === "Escape") {
        this.chatBox.blur();
        this.chatWrap.classList.add("hidden");
      }
    });
    this.prompt = new Prompt(r);
    this.build = new BuildMode(r);
    this.council = new CouncilUI();
    onKeyDown((e) => this.keyDown(e));
    onKeyUp((e) => this.keyUp(e));
  }

  private cameraSurface() {
    if (this.combat?.active && this.combat.where !== "bunker") return this.combat.site;
    if (this.exp?.mode === "site") return this.exp.site;
    return this.r;
  }

  cameraGesture(): CameraGesture {
    if (this.table?.active) return { kind: "table", zoom: this.table.scene.zoom };
    const s = this.cameraSurface();
    return { kind: "world", surface: s, viewH: s.viewH, camX: s.camX, camY: s.camY };
  }

  applyCameraGesture(start: CameraGesture, distanceRatio: number, dx: number, dy: number) {
    if (start.kind === "table") {
      if (!this.table?.active) return;
      const desired = Math.max(0.55, Math.min(1.65, start.zoom * distanceRatio));
      this.table.scene.zoomBy(desired / this.table.scene.zoom);
      return;
    }
    const s = start.surface;
    s.viewH = Math.max(6, Math.min(48, start.viewH / Math.max(0.2, distanceRatio)));
    const k = s.viewH / innerHeight;
    s.camX = start.camX - dx * k;
    s.camY = start.camY + dy * k;
    if (s === this.r) this.r.updateCamera();
    this.setCameraFollow(false);
  }

  zoomCamera(factor: number) {
    if (this.table?.active) {
      this.table.scene.zoomBy(1 / factor);
      return;
    }
    const s = this.cameraSurface();
    s.viewH = Math.max(6, Math.min(48, s.viewH * factor));
    if (s === this.r) this.r.updateCamera();
    this.setCameraFollow(false);
  }

  setCameraFollow(on: boolean) {
    if (this.combat?.active) this.combat.setCameraFollow(on);
    else if (this.exp?.mode === "site") this.exp.setCameraFollow(on);
    else this.r.follow = on;
  }

  /** Moving always finds the controlled survivor again without changing player-selected zoom. */
  resumeCameraFollow() {
    this.setCameraFollow(true);
  }

  inputBlocked() {
    return typing() || isModalOpen() || this.aquarium || !!this.table?.active || !!this.combat?.active || this.exp?.mode === "map";
  }

  keyDown(e: KeyboardEvent): boolean | void {
    if (e.code === "Escape") {
      this.navigation.cancel();
      if (isModalOpen()) {
        closeModal();
        return true;
      }
      if (this.build.active) {
        this.build.toggle(false);
        return true;
      }
      if (this.aquarium) {
        this.setAquarium(false);
        return true;
      }
    }
    if (isModalOpen()) return;
    for (const k of GameUI.extraKeys) if (k(e, this)) return true;
    switch (e.code) {
      case "KeyE":
        this.prompt.trigger();
        return true;
      case "KeyQ":
        net.send({ k: "drop" });
        return true;
      case "KeyB":
        this.build.toggle();
        return true;
      case "Delete":
        if (!this.build.active) return;
        this.build.erase = !this.build.erase;
        toast(this.build.erase ? "Коснитесь размеченной комнаты — отменить или снести" : "Снос отменён");
        return true;
      case "BracketLeft":
        this.build.setWidth(this.build.width - 1);
        return true;
      case "BracketRight":
        this.build.setWidth(this.build.width + 1);
        return true;
      case "KeyH":
        this.setAquarium(!this.aquarium);
        return true;
      case "KeyZ":
      case "ArrowUp":
        if (e.code === "ArrowUp" && this.prompt.list.length < 2) return;
        this.prompt.cycle(-1);
        return true;
      case "KeyX":
      case "ArrowDown":
        if (e.code === "ArrowDown" && this.prompt.list.length < 2) return;
        this.prompt.cycle(1);
        return true;
      case "KeyC":
      case "Enter":
        this.chatWrap.classList.remove("hidden");
        setTimeout(() => this.chatBox.focus(), 0);
        return true;
      case "F1":
        net.send({ k: "emote", id: "help" });
        net.send({ k: "help" });
        return true;
      case "F2":
        net.send({ k: "emote", id: "here" });
        return true;
      case "F3":
        net.send({ k: "emote", id: "no" });
        return true;
      case "F4":
        net.send({ k: "emote", id: "lol" });
        return true;
    }
    if (/^Digit[1-7]$/.test(e.code)) {
      const i = Number(e.code.slice(5)) - 1;
      if (this.prompt.list[i]) {
        this.prompt.sel = i;
        this.prompt.trigger(i);
        return true;
      }
    }
  }

  static extraKeysUp: ((e: KeyboardEvent, g: GameUI) => boolean | void)[] = [];

  keyUp(e: KeyboardEvent): boolean | void {
    for (const k of GameUI.extraKeysUp) if (k(e, this)) return true;
    if (e.code === "KeyE" || /^Digit[1-7]$/.test(e.code)) this.prompt.release();
  }

  setAquarium(v: boolean) {
    this.aquarium = v;
    this.hud.setHidden(v);
    net.send({ k: "aquarium", v });
    if (v) {
      this.r.follow = false;
      this.build.toggle(false);
    } else this.r.follow = true;
  }

  onPatch() {
    this.hud.update();
    this.council.update();
    const v = net.pub;
    if (v && v.phase !== this.lastPhase) {
      this.lastPhase = v.phase;
      if (v.phase === "night") {
        // general shot of the mess hall
        const mess = Object.values(v.rooms).find((r: any) => r.type === "mess") as any;
        if (mess) {
          this.r.follow = false;
          this.r.camX = mess.x + mess.w / 2;
          this.r.camY = -(mess.lv * 2 + 1) - 2.5;
        }
        this.build.toggle(false);
      } else if (v.phase === "day" && !this.aquarium) this.r.follow = true;
    }
    for (const f of GameUI.extraPatch) f(this);
  }

  private aqT = 0;
  frame(dt: number) {
    const destination = this.navigation.target;
    this.routeMarker.classList.toggle("hidden", !destination);
    if (destination) {
      const scene = this.pro?.active ? this.pro.site : this.exp?.mode === "site" ? this.exp.site : this.r;
      const [sx, sy] = scene.toScreen(destination.x, -(destination.lv * 2 + 2) + .22);
      this.routeMarker.style.left = sx + "px";
      this.routeMarker.style.top = sy + "px";
    }
    const [wx, wy] = this.r.toWorld(this.mouse.x, this.mouse.y);
    this.mouse.wx = wx;
    this.mouse.wy = wy;
    this.hoverChar = null;
    let best = 0.6;
    for (const [id, cv] of this.r.chars) {
      const d = Math.abs(cv.x - wx) + Math.abs(-cv.y + 0.7 - wy) * 0.6;
      if (d < best) {
        best = d;
        this.hoverChar = id;
      }
    }
    this.prompt.update(this.aquarium || this.build.active || isModalOpen() || !!this.combat?.active || (this.exp?.mode ?? "none") !== "none" || !!this.table?.active);
    this.build.frame(wx, wy);
    if (net.pub?.phase === "night") this.council.update();
    if (this.aquarium) {
      // slow drifting camera over the bunker
      this.aqT += dt * 0.05;
      const v = net.pub;
      if (v) {
        const rooms = Object.values(v.rooms).filter((r: any) => r.state === "done") as any[];
        const minX = Math.min(...rooms.map((r) => r.x)),
          maxX = Math.max(...rooms.map((r) => r.x + r.w));
        const maxLv = Math.max(...rooms.map((r) => r.lv));
        const tx = (minX + maxX) / 2 + Math.sin(this.aqT) * ((maxX - minX) / 2 - 3);
        const ty = -(Math.sin(this.aqT * 0.37) * 0.5 + 0.5) * (maxLv * 2 + 2) - 1;
        this.r.camX += (tx - this.r.camX) * dt * 0.3;
        this.r.camY += (ty - this.r.camY) * dt * 0.3;
        this.r.viewH += (Math.max(14, (maxLv + 1) * 2 + 8) - this.r.viewH) * dt * 0.2;
        this.r.updateCamera();
      }
    }
    for (const f of GameUI.extraFrame) f(dt, this);
  }
}

export type CameraGesture =
  | { kind: "table"; zoom: number }
  | { kind: "world"; surface: { viewH: number; camX: number; camY: number }; viewH: number; camX: number; camY: number };
