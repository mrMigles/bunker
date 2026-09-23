import * as THREE from "three";
import {
  ABILITIES,
  ENEMIES,
  WEAPONS,
  hitChance,
  moveCost,
  pathTo,
  validatePlan,
  weaponOf,
  type Action,
  type CEvent,
  type CombatState,
  type Unit,
} from "@bunker/shared";
import { audio } from "../audio/audio";
import { net } from "../net";
import { CharView } from "../render/chars";
import { mat } from "../render/palette";
import { SiteRenderer, buildEnemy } from "../render/site";
import type { WorldRenderer } from "../render/world";
import { add, bar, clear, floatText, h, ui } from "./dom";
import "./combat.css";

type Mode = "move" | "shoot" | "aim" | "melee" | "shove" | "heal" | "throw" | "ability" | "door" | null;

interface UnitView {
  obj: THREE.Object3D;
  char?: CharView;
  x: number;
  y: number;
  dir: number;
  anim: string;
  lunge: number;
}

export class CombatUI {
  site = new SiteRenderer();
  active = false;
  where = "";
  stage = new THREE.Group();
  overlay = new THREE.Group();
  views = new Map<string, UnitView>();
  panel = h("div.panel.combat-panel.hidden");
  labels = h("div.layer");
  top = h("div.combat-top.hidden");
  mode: Mode = null;
  plan: Action[] = [];
  private reach: { col: number; floor: number; dash: boolean }[] = [];
  private reachKey = "";
  aimPart: "legs" | "arms" | "head" | undefined;
  queue: CEvent[] = [];
  qT = 0;
  playedRound = 0;
  hoverCell: { col: number; floor: number } | null = null;
  private key = "";
  private mouse = { x: 0, y: 0 };
  private attached: THREE.Scene | null = null;
  private selectedTarget: string | null = null;
  private submenu: "attack" | "items" | "more" | null = null;
  private markerMaterials = new Map<string, THREE.MeshBasicMaterial>();
  private markerGeometry = new THREE.PlaneGeometry(0.92, 1.9);
  intel = h("aside.combat-intel.panel.hidden");

  constructor(private r: WorldRenderer) {
    ui().append(this.labels, this.top, this.panel, this.intel);
    const canvas = r.renderer.domElement;
    canvas.addEventListener("mousemove", (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
    });
    canvas.addEventListener("mousedown", (e) => {
      if (!this.active || e.button !== 0) return;
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      this.click();
    });
    canvas.addEventListener("contextmenu", () => {
      if (this.active) this.mode = null;
    });
  }

  get cs():
    | (Omit<CombatState, "phase"> & {
        planLeft: number;
        phase: "plan" | "over" | "anim";
        eventsRound: number;
        where: string;
      })
    | null {
    const c = net.pub?.mods?.combat;
    return c?.active ? (c as any) : null;
  }

  myUnit(): Unit | null {
    const s = this.cs;
    const ch = net.priv?.char;
    return s && ch ? ((s.units["u_" + ch] as Unit) ?? null) : null;
  }

  pos(col: number, floor: number): [number, number] {
    const s = this.cs!;
    if (this.where === "bunker") return [s.field.originX + col + 0.5, -((s.field.originLv + floor) * 2 + 2) + 0.16];
    return this.site.pos(col, floor);
  }

  cellAtMouse(): { col: number; floor: number } | null {
    const s = this.cs;
    if (!s) return null;
    const [wx, wy] =
      this.where === "bunker"
        ? this.r.toWorld(this.mouse.x, this.mouse.y)
        : this.site.toWorld(this.mouse.x, this.mouse.y);
    const col = Math.floor(wx - (this.where === "bunker" ? s.field.originX : 0));
    const lvAbs = Math.floor(-wy / 2);
    const floor = lvAbs - (this.where === "bunker" ? s.field.originLv : 0);
    if (col < 0 || col >= s.field.cols || floor < 0 || floor >= s.field.floors) return null;
    return { col, floor };
  }

  unitAtCell(c: { col: number; floor: number } | null): Unit | null {
    const s = this.cs;
    if (!s || !c) return null;
    return (
      (Object.values(s.units) as Unit[]).find((u) => u.col === c.col && u.floor === c.floor && !u.dead && !u.fled) ??
      null
    );
  }

  /** Simulated position after the current plan. */
  simPos(): { col: number; floor: number } | null {
    const u = this.myUnit();
    if (!u) return null;
    let p = { col: u.col, floor: u.floor };
    for (const a of this.plan) if (a.t === "move") p = { col: a.col, floor: a.floor };
    return p;
  }

  apLeft(): number {
    const u = this.myUnit();
    const s = this.cs;
    if (!u || !s) return 0;
    let ap = u.ap;
    let pos = { col: u.col, floor: u.floor };
    const w = WEAPONS[u.weapon] ?? WEAPONS.fists;
    for (const a of this.plan) {
      if (a.t === "move") {
        const p = pathTo(s as any, { ...u, ...pos } as Unit, a.col, a.floor);
        ap -= moveCost(p?.length ?? 0);
        pos = { col: a.col, floor: a.floor };
      } else if (a.t === "shoot") ap -= w.ap + (a.aimed ? 1 : 0);
      else if (a.t === "melee") ap -= w.range <= 1 ? w.ap : 1;
      else if (a.t === "heal" || a.t === "throw") ap -= 2;
      else if (a.t === "ability") ap -= ABILITIES[u.ability ?? ""]?.ap ?? 1;
      else if (a.t !== "overwatch") ap -= 1;
    }
    return ap;
  }

  /** XCOM-style: every action is executed right away; the result plays out before the next one. */
  tryAdd(a: Action) {
    const s = this.cs;
    const u = this.myUnit();
    if (!s || !u || s.phase !== "plan" || u.dead || u.down || u.fled || this.queue.length) return;
    const err = validatePlan(s as any, u.id, [a]);
    if (err) {
      floatText(this.mouse.x, this.mouse.y - 10, err, "#ff8a6a");
      audio.sfx("click", 0.5);
      return;
    }
    this.plan = [];
    audio.sfx("blip", 0.5);
    this.mode = null;
    net.send({ k: "cact", action: a });
    this.key = "";
  }

  /** «Конец хода» — the enemies move after everyone ends the turn (or the clock runs out). */
  sync(ready: boolean) {
    if (this.cs?.phase !== "plan") return;
    net.send({ k: "cready", v: ready });
    this.key = "";
  }

  click() {
    const s = this.cs;
    const u = this.myUnit();
    if (!s || !u || s.phase !== "plan") return;
    const cell = this.cellAtMouse();
    if (!cell) return;
    const target = this.unitAtCell(cell);
    switch (this.mode) {
      case "move":
        this.tryAdd({ t: "move", col: cell.col, floor: cell.floor });
        break;
      case "shoot":
      case "aim":
        if (target && target.side === "enemy")
          this.tryAdd({
            t: "shoot",
            target: target.id,
            aimed: this.mode === "aim",
            part: this.mode === "aim" ? this.aimPart : undefined,
          });
        break;
      case "melee":
      case "shove":
        if (target && target.side === "enemy") this.tryAdd({ t: this.mode, target: target.id });
        break;
      case "heal":
        if (target && target.side === "ally") this.tryAdd({ t: "heal", target: target.id });
        break;
      case "throw":
        this.tryAdd({ t: "throw", col: cell.col, floor: cell.floor });
        break;
      case "ability": {
        const ab = ABILITIES[u.ability ?? ""];
        if (!ab) break;
        if (ab.target === "cell") this.tryAdd({ t: "ability", col: cell.col, floor: cell.floor });
        else if (target) this.tryAdd({ t: "ability", target: target.id });
        break;
      }
      case "door":
        this.tryAdd({ t: "door", col: cell.col, floor: cell.floor });
        break;
      default:
        // quick default: click enemy = shoot/melee, click floor = move
        if (target && target.side === "enemy") {
          this.selectedTarget = target.id;
          this.key = "";
          this.renderPanel();
        } else if (!target) this.tryAdd({ t: "move", col: cell.col, floor: cell.floor });
    }
  }

  /** Called on every patch. */
  update() {
    const s = this.cs;
    const was = this.active;
    this.active = !!s && (!!this.myUnit() || s.where === "bunker" || !!net.priv?.char);
    if (!s) {
      if (was) this.teardown();
      return;
    }
    if (!was) {
      this.where = s.where;
      this.plan = [];
      this.playedRound = s.eventsRound;
      this.attach();
    }
    if (this.where !== "bunker") this.site.build(s.field);
    // new resolution → animate
    if (s.eventsRound !== this.playedRound) {
      this.playedRound = s.eventsRound;
      this.queue = [...(s.events ?? [])];
      this.qT = 0;
      this.plan = [];
      this.mode = null;
    }
    this.syncViews();
    this.renderPanel();
  }

  attach() {
    const scene = this.where === "bunker" ? this.r.scene : this.site.scene;
    scene.add(this.stage, this.overlay);
    this.attached = scene;
    this.panel.classList.remove("hidden");
    this.top.classList.remove("hidden");
    this.intel.classList.remove("hidden");
    audio.sfx("siren", 0.4);
  }

  teardown() {
    this.attached?.remove(this.stage);
    this.attached?.remove(this.overlay);
    this.attached = null;
    this.stage.clear();
    this.overlay.clear();
    this.views.clear();
    clear(this.labels);
    this.panel.classList.add("hidden");
    this.top.classList.add("hidden");
    this.intel.classList.add("hidden");
    this.selectedTarget = null;
    this.submenu = null;
    this.queue = [];
    this.active = false;
  }

  syncViews() {
    const s = this.cs!;
    const v = net.pub!;
    for (const u of Object.values(s.units) as Unit[]) {
      let vw = this.views.get(u.id);
      if (!vw) {
        let obj: THREE.Object3D;
        let cv: CharView | undefined;
        if (u.side === "ally") {
          const c = u.char ? v.chars[u.char] : undefined;
          if (this.where === "bunker") {
            // the world renderer already draws residents; use an invisible anchor
            obj = new THREE.Group();
          } else {
            cv = new CharView(u.id, c?.card.color ?? 0x888888, c?.card.hat ?? 0, 1);
            obj = cv.root;
          }
        } else obj = buildEnemy(u.etype ?? "marauder", ENEMIES[u.etype ?? ""]?.color ?? 0x666666);
        const [x, y] = this.pos(u.col, u.floor);
        obj.position.set(x, y, -0.45);
        this.stage.add(obj);
        vw = { obj, char: cv, x, y, dir: u.side === "ally" ? 1 : -1, anim: "idle", lunge: 0 };
        this.views.set(u.id, vw);
      }
      vw.obj.visible = !u.fled && !(u.dead && u.side === "enemy" && this.queue.length === 0);
    }
  }

  /** Per frame. Returns true if this UI renders the frame itself (arena/location). */
  frame(dt: number): boolean {
    if (!this.active) return false;
    const s = this.cs;
    if (!s) return false;
    // animation queue
    const animating = this.queue.length > 0;
    if (animating) {
      this.qT -= dt * (this.fast ? 4 : 1);
      if (this.qT <= 0) {
        const e = this.queue.shift()!;
        this.qT = this.playEvent(e);
      }
    }
    // unit positions
    for (const [id, vw] of this.views) {
      const u = s.units[id] as Unit | undefined;
      if (!u) continue;
      if (!animating) {
        const [x, y] = this.pos(u.col, u.floor);
        vw.x += (x - vw.x) * Math.min(1, dt * 8);
        vw.y += (y - vw.y) * Math.min(1, dt * 8);
      }
      vw.lunge = Math.max(0, vw.lunge - dt * 3);
      vw.obj.position.set(vw.x + vw.lunge * vw.dir * 0.4, vw.y, -0.45);
      if (vw.char) {
        const anim = u.dead ? "dead" : u.down ? "down" : vw.anim;
        vw.char.update(dt, anim, vw.dir);
        vw.char.x = vw.x;
        vw.char.y = -vw.y;
      } else if (u.side === "enemy") {
        vw.obj.rotation.y = vw.dir > 0 ? 0.6 : Math.PI - 0.6;
        if (u.dead || u.down) vw.obj.rotation.z = Math.PI / 2;
        if (u.etype === "drone") vw.obj.position.y += Math.sin(performance.now() / 300) * 0.05;
      }
      if (this.where === "bunker" && u.char) {
        // move the real resident mesh
        const cv = this.r.chars.get(u.char);
        if (cv) {
          cv.x = vw.x;
          cv.y = -(vw.y - 0.16);
        }
      }
    }
    this.drawOverlay();
    if (this.where !== "bunker") {
      this.site.render(this.r.renderer);
      this.renderLabels();
      return true;
    }
    this.renderLabels();
    return false;
  }

  fast = false;

  playEvent(e: CEvent): number {
    const s = this.cs!;
    const vw = this.views.get(e.u);
    const tv = e.to ? this.views.get(e.to) : undefined;
    switch (e.k) {
      case "move": {
        if (vw && e.col !== undefined) {
          const [x, y] = this.pos(e.col, e.floor!);
          vw.dir = x > vw.x ? 1 : x < vw.x ? -1 : vw.dir;
          vw.x = x;
          vw.y = y;
          vw.anim = "walk";
          audio.sfx("step", 0.5);
        }
        return 0.13;
      }
      case "shoot":
        if (vw && tv) {
          vw.dir = tv.x > vw.x ? 1 : -1;
          this.tracer(vw, tv, e.hit ?? false);
          audio.sfx("shot");
          this.floatAt(tv, e.hit ? `−${e.dmg}${e.crit ? "!" : ""}` : "мимо", e.hit ? "#ff6a4a" : "#bbbbbb");
          vw.anim = "work";
        }
        return 0.55;
      case "melee":
        if (vw && tv) {
          vw.dir = tv.x > vw.x ? 1 : -1;
          vw.lunge = 1;
          audio.sfx("hit");
          this.floatAt(tv, e.hit ? (e.dmg ? `−${e.dmg}` : (e.text ?? "")) : "мимо", e.hit ? "#ff6a4a" : "#bbbbbb");
        }
        return 0.45;
      case "heal":
        if (tv) this.floatAt(tv, `+${e.dmg}`, "#8fcf6a");
        return 0.45;
      case "down":
      case "dead":
        if (vw) this.floatAt(vw, e.k === "dead" ? "☠" : (e.text ?? "✚"), "#ffffff");
        return 0.5;
      case "fire":
        if (e.col !== undefined) {
          const [x, y] = this.pos(e.col, e.floor!);
          for (let i = 0; i < 2; i++) {
            const f = new THREE.Mesh(
              new THREE.ConeGeometry(0.3, 0.8, 5),
              mat(0xff7a1a, { emissive: 0xff4400, opacity: 0.85 }),
            );
            f.position.set(x + i, y + 0.4, -0.3);
            this.overlay.add(f);
            setTimeout(() => this.overlay.remove(f), 1200);
          }
          audio.sfx("boom", 0.5);
          if (e.text) this.floatAtXY(x, y, e.text, "#ffaa55");
        }
        return 0.5;
      case "flee":
        if (vw) this.floatAt(vw, "убегает", "#e8c14a");
        return 0.3;
      case "ability":
        if (vw) this.floatAt(vw, e.text ?? "", "#a0d0ff");
        audio.sfx("find", 0.4);
        return 0.5;
      case "door":
        audio.sfx("door", 0.6);
        if (vw) this.floatAt(vw, e.text ?? "", "#dddddd");
        return 0.35;
      default:
        if (vw && e.text) this.floatAt(vw, e.text, "#dddddd");
        return 0.25;
    }
    void s;
  }

  tracer(a: UnitView, b: UnitView, hit: boolean) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(a.x, a.y + 0.75, -0.3),
      new THREE.Vector3(b.x + (hit ? 0 : 0.4), b.y + 0.75, -0.3),
    ]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe08a }));
    this.overlay.add(line);
    setTimeout(() => {
      this.overlay.remove(line);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }, 180);
  }

  floatAt(vw: UnitView, text: string, color: string) {
    this.floatAtXY(vw.x, vw.y, text, color);
  }

  floatAtXY(x: number, y: number, text: string, color: string) {
    const [sx, sy] = this.where === "bunker" ? this.r.toScreen(x, y + 1.6) : this.site.toScreen(x, y + 1.6);
    floatText(sx, sy, text, color);
  }

  drawOverlay() {
    const s = this.cs!;
    const u = this.myUnit();
    // cleanup previous frame's plan markers (keep fire meshes which remove themselves)
    for (const o of [...this.overlay.children]) if (o.userData.plan) this.overlay.remove(o);
    if (!u || s.phase !== "plan") return;
    const addMark = (col: number, floor: number, color: number, op = 0.35) => {
      const [x, y] = this.pos(col, floor);
      const key = color + ":" + op;
      let material = this.markerMaterials.get(key);
      if (!material) {
        material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, depthWrite: false });
        this.markerMaterials.set(key, material);
      }
      const m = new THREE.Mesh(this.markerGeometry, material);
      m.position.set(x, y + 0.95, 0.05);
      m.userData.plan = true;
      this.overlay.add(m);
    };
    // XCOM-style reach: blue = you can still shoot after moving there, yellow = a dash
    if (!this.queue.length && u.ap > 0 && !u.down && (this.mode === null || this.mode === "move")) {
      const key = JSON.stringify([u.col, u.floor, u.ap, Object.values(s.units).map((x) => [x.col, x.floor, x.dead]), s.field.doors.map((d) => d.closed)]);
      if (key !== this.reachKey) {
        this.reachKey = key;
        this.reach = [];
        const wap = weaponOf(u as Unit).ap;
        for (let fl = 0; fl < s.field.floors; fl++)
          for (let col = 0; col < s.field.cols; col++) {
            if (col === u.col && fl === u.floor) continue;
            if (!s.field.walk[fl * s.field.cols + col]) continue;
            // standing room only: cells taken by anyone alive are not destinations
            if (Object.values(s.units).some((o) => o.col === col && o.floor === fl && !o.dead && !o.fled)) continue;
            const path = pathTo(s as any, u as Unit, col, fl);
            if (!path) continue;
            const cost = moveCost(path.length);
            if (cost > u.ap) continue;
            this.reach.push({ col, floor: fl, dash: u.ap - cost < wap });
          }
      }
      for (const r of this.reach) addMark(r.col, r.floor, r.dash ? 0xe8c14a : 0x4fa8ff, 0.3);
    }
    // my plan
    let p = { col: u.col, floor: u.floor };
    for (const a of this.plan)
      if (a.t === "move") ((p = { col: a.col, floor: a.floor }), addMark(p.col, p.floor, 0x66ccff, 0.3));
    // allies' plans (ghosts)
    for (const [uid, acts] of Object.entries(s.plans ?? {})) {
      if (uid === u.id) continue;
      for (const a of acts as Action[]) if (a.t === "move") addMark(a.col, a.floor, 0x99ff99, 0.15);
    }
    // hover
    const cell = this.cellAtMouse();
    this.hoverCell = cell;
    if (cell) addMark(cell.col, cell.floor, 0xffffff, 0.12);
    // move reach preview
    if (this.mode === "move" && cell) {
      const path = pathTo(s as any, { ...u, col: p.col, floor: p.floor } as Unit, cell.col, cell.floor);
      if (path)
        for (const st of path)
          addMark(st.col, st.floor, moveCost(path.length) <= this.apLeft() ? 0x66ff66 : 0xff6666, 0.18);
    }
  }

  private labKey = "";
  renderLabels() {
    const s = this.cs!;
    const u = this.myUnit();
    const cell = this.hoverCell;
    const target = this.unitAtCell(cell);
    const key = JSON.stringify([
      Object.values(s.units).map((x: any) => [x.id, x.hp, x.intentText, x.dead, x.down, x.fled]),
      [...this.views.values()].map((v) => [Math.round(v.x * 10), Math.round(v.y * 10)]),
      target?.id,
      this.selectedTarget,
      this.mode,
      this.plan.length,
      this.r.camX.toFixed(1),
      this.r.camY.toFixed(1),
      this.r.viewH,
      s.phase,
    ]);
    if (key === this.labKey) return;
    this.labKey = key;
    clear(this.labels);
    for (const x of Object.values(s.units) as Unit[]) {
      if (x.dead || x.fled) continue;
      const vw = this.views.get(x.id);
      if (!vw) continue;
      const [sx, sy] =
        this.where === "bunker" ? this.r.toScreen(vw.x, vw.y + 1.75) : this.site.toScreen(vw.x, vw.y + 1.75);
      const el = h("div.label.combat-unit-label" + (x.id === this.selectedTarget ? ".selected" : ""), {
        style: { left: sx + "px", top: sy + "px" },
        role: "button",
        tabindex: 0,
        "aria-label": `${x.name}: ${Math.max(0, x.hp)} здоровья`,
        onclick: () => {
          if (this.mode && s.phase === "plan") {
            this.mouse.x = sx;
            this.mouse.y = sy + 30;
            const [px, py] =
              this.where === "bunker" ? this.r.toScreen(vw.x, vw.y + 0.7) : this.site.toScreen(vw.x, vw.y + 0.7);
            this.mouse.x = px;
            this.mouse.y = py;
            this.click();
          } else {
            this.selectedTarget = x.id;
            this.key = "";
            this.renderPanel();
          }
        },
      });
      if (x.side === "enemy" && x.intentText && s.phase === "plan")
        el.append(h("div.intent", null, intentIcon(x) + " " + x.intentText));
      el.append(
        h("div.nm" + (x.side === "ally" ? ".player" : ""), null, `${x.side === "enemy" ? x.icon + " " : ""}${x.name}`),
      );
      const hb = bar(Math.max(0, x.hp), x.side === "ally" ? "#8fcf6a" : "#e0503a", x.maxHp);
      hb.style.width = "50px";
      hb.style.margin = "0 auto";
      el.append(hb);
      if (x.down) el.append(h("div.bad", null, x.captured ? "сдался" : "без сознания"));
      if (
        u &&
        target?.id === x.id &&
        x.side === "enemy" &&
        (this.mode === "shoot" || this.mode === "aim" || this.mode === null)
      ) {
        const pos = this.simPos();
        const me = { ...u, ...pos } as Unit;
        const ch = hitChance(s as any, me, x, this.mode === "aim", this.mode === "aim" ? this.aimPart : undefined);
        el.append(h("div.warn", null, `🎯 ${ch}%`));
      }
      this.labels.appendChild(el);
    }
  }

  renderPanel() {
    const s = this.cs!,
      u = this.myUnit();
    const key = JSON.stringify([
      s.phase,
      Math.ceil(s.planLeft),
      s.round,
      this.plan,
      this.mode,
      this.submenu,
      this.selectedTarget,
      this.aimPart,
      u?.hp,
      u?.ap,
      u?.ammo,
      u?.cd,
      s.ready,
      s.result,
      s.log?.length,
      this.queue.length > 0,
      Object.values(s.units).map((x) => [x.id, x.hp, x.dead, x.fled]),
    ]);
    if (key === this.key) return;
    this.key = key;
    clear(this.top);
    clear(this.intel);
    clear(this.panel);
    const enemies = Object.values(s.units).filter((x) => x.side === "enemy" && !x.dead && !x.fled).length;
    const allies = Object.values(s.units).filter((x) => x.side === "ally" && !x.dead && !x.fled).length;
    add(
      this.top,
      h("div.combat-phase", null, h("span.combat-eyebrow", null, "ТАКТИЧЕСКИЙ БОЙ"), h("b", null, `Ход ${s.round}`)),
      h(
        "div.combat-clock" + (s.phase === "plan" && s.planLeft <= 8 ? ".urgent" : ""),
        null,
        h("strong", null, s.phase === "plan" ? `${Math.ceil(s.planLeft)}` : s.phase === "anim" ? "•••" : "✓"),
        h("span", null, s.phase === "plan" ? "сек. — ваш ход" : s.phase === "anim" ? "Идёт действие…" : "Бой завершён"),
      ),
      h("div.combat-forces", null, h("span", null, `Отряд ${allies}`), h("b", null, `Противники ${enemies}`)),
    );
    const target = this.selectedTarget ? s.units[this.selectedTarget] : null;
    if (target && !target.dead && !target.fled) {
      const chance = u
        ? hitChance(s as any, { ...u, ...this.simPos() } as Unit, target, this.mode === "aim", this.aimPart)
        : 0;
      add(
        this.intel,
        h("div.combat-eyebrow", null, target.side === "enemy" ? "ВЫБРАННАЯ ЦЕЛЬ" : "БОЕЦ ОТРЯДА"),
        h("h3", null, target.name),
        h(
          "div.combat-target-health",
          null,
          bar(target.hp, target.side === "enemy" ? "#cd7058" : "#93c58c", target.maxHp),
          h("b", null, `${Math.max(0, target.hp)} / ${target.maxHp}`),
        ),
        target.intentText ? h("p.combat-intent-text", null, intentIcon(target) + " " + target.intentText) : null,
        target.side === "enemy" && u && s.phase === "plan"
          ? h(
              "button.combat-target-attack",
              {
                onclick: () => {
                  const w = WEAPONS[u.weapon] ?? WEAPONS.fists;
                  this.tryAdd(
                    w.range > 1
                      ? { t: "shoot", target: target.id, aimed: this.mode === "aim", part: this.aimPart }
                      : { t: "melee", target: target.id },
                  );
                },
              },
              "Атаковать",
              h("span", null, `${chance}% попадание`),
            )
          : null,
      );
    } else
      add(
        this.intel,
        h("div.combat-eyebrow", null, "ТАКТИЧЕСКАЯ ОБСТАНОВКА"),
        h("h3", null, "Держитесь вместе"),
        h("p.dim", null, "Синие клетки — можно дойти и ещё выстрелить, жёлтые — рывок. Щёлкните врага, чтобы увидеть шанс попадания. После «Конец хода» враги делают то, что подписано над ними."),
      );
    add(
      this.intel,
      h(
        "details.combat-journal",
        null,
        h("summary", null, "Журнал боя"),
        h(
          "div.combat-log",
          null,
          (s.log ?? []).slice(-5).map((l) => h("div", null, l)),
        ),
      ),
    );
    if (!u) {
      add(this.panel, h("p", null, "Вы наблюдаете за боем"));
      return;
    }
    const w = WEAPONS[u.weapon] ?? WEAPONS.fists,
      ap = this.apLeft(),
      ab = u.ability ? ABILITIES[u.ability] : undefined;
    const canPlan = s.phase === "plan" && !u.dead && !u.down && !u.fled;
    const setMode = (mode: Mode) => {
      this.mode = this.mode === mode ? null : mode;
      this.key = "";
      this.renderPanel();
    };
    const action = (glyph: string, title: string, subtitle: string, fn: () => void, active = false, disabled = false) =>
      h(
        "button.combat-action" + (active ? ".active" : ""),
        { disabled: disabled || !canPlan, onclick: fn },
        h("span.combat-action-icon", null, glyph),
        h("b", null, title),
        h("small", null, subtitle),
      );
    const stats = h(
      "div.combat-operative",
      null,
      h("div.combat-eyebrow", null, "ВАШ ПЕРСОНАЖ"),
      h("h3", null, u.name),
      h(
        "div.combat-health",
        null,
        h("span", null, "♥"),
        bar(Math.max(0, u.hp), "#92c98b", u.maxHp),
        h("b", null, `${Math.max(0, u.hp)}`),
      ),
      h("div.combat-weapon", null, w.name, w.ammo ? h("span", null, `${u.ammo} / ${w.ammo}`) : null),
      h(
        "div.combat-ap",
        null,
        h("b", null, `${ap} / ${u.ap}`),
        h("span", null, "очки действий"),
        h(
          "div.combat-ap-pips",
          null,
          Array.from({ length: u.ap }, (_, i) => h("i" + (i < ap ? ".available" : ""))),
        ),
      ),
    );
    const commands = h("div.combat-commands");
    const hints: Partial<Record<NonNullable<Mode>, string>> = {
      move: "Выберите клетку. Зелёный маршрут доступен за оставшиеся очки.",
      shoot: "Выберите противника для выстрела.",
      aim: "Выберите часть тела, затем противника.",
      melee: "Выберите противника рядом для удара.",
      heal: "Выберите раненого бойца, включая себя.",
      throw: "Выберите клетку для броска.",
      ability: "Выберите цель для навыка.",
      shove: "Выберите противника рядом.",
      door: "Выберите соседнюю дверь.",
    };
    add(
      commands,
      h(
        "div.combat-plan-line",
        null,
        h("span.combat-eyebrow", null, "ВАШ ХОД"),
        h(
          "div.combat-queue",
          null,
          h("span.dim", null, u.ap > 0 ? `Осталось ${u.ap} ОД. Клетка — идти, враг — атаковать. Действия выполняются сразу.` : "ОД кончились — нажмите «Конец хода»."),
        ),
      ),
      h(
        "div.combat-actions",
        null,
        action(
          w.range > 1 ? "⌖" : "✊",
          w.range > 1 ? "Выстрел" : "Удар",
          `${w.ap} ОД`,
          () => {
            this.submenu = w.range > 1 ? "attack" : null;
            setMode(w.range > 1 ? "shoot" : "melee");
          },
          this.mode === "shoot" || this.mode === "aim" || this.mode === "melee",
          ap < w.ap,
        ),
        action(
          "↗",
          "Движение",
          "Выбрать клетку",
          () => {
            this.submenu = null;
            setMode("move");
          },
          this.mode === "move",
          ap < 1,
        ),
        action(
          "✦",
          "Навык",
          ab ? `${ab.name} · ${ab.ap} ОД${u.cd ? " · перезарядка " + u.cd : ""}` : "Нет навыка",
          () => {
            this.submenu = null;
            if (ab?.target === "none" || ab?.target === "self") this.tryAdd({ t: "ability" });
            else setMode("ability");
          },
          this.mode === "ability",
          !ab || u.cd > 0 || ap < (ab?.ap ?? 0),
        ),
        action(
          "✚",
          "Предметы",
          "Аптечка / граната",
          () => {
            this.submenu = this.submenu === "items" ? null : "items";
            this.key = "";
            this.renderPanel();
          },
          this.submenu === "items",
        ),
        action("◇", "Укрыться", "Защита · 1 ОД", () => this.tryAdd({ t: "hunker" }), false, ap < 1),
        action(
          "•••",
          "Ещё",
          "Тактика и оружие",
          () => {
            this.submenu = this.submenu === "more" ? null : "more";
            this.key = "";
            this.renderPanel();
          },
          this.submenu === "more",
        ),
      ),
    );
    const sub = h("div.combat-submenu");
    const smallMode = (mode: Mode, label: string, disabled = false) =>
      h(
        "button" + (this.mode === mode ? ".active" : ""),
        { disabled: !canPlan || disabled, onclick: () => setMode(mode) },
        label,
      );
    const direct = (a: Action, label: string, disabled = false) =>
      h("button", { disabled: !canPlan || disabled, onclick: () => this.tryAdd(a) }, label);
    if (this.submenu === "attack")
      add(
        sub,
        smallMode("shoot", `Обычный · ${w.ap} ОД`, ap < w.ap),
        smallMode("aim", `Прицельный · ${w.ap + 1} ОД`, ap < w.ap + 1),
      );
    if (this.mode === "aim")
      add(
        sub,
        ...(
          [
            [undefined, "Корпус"],
            ["legs", "Ноги"],
            ["arms", "Руки"],
            ["head", "Голова"],
          ] as const
        ).map(([part, label]) =>
          h(
            "button" + (this.aimPart === part ? ".active" : ""),
            {
              title: part === "head" ? "−15% точности, ×1.5 урон" : "",
              onclick: () => {
                this.aimPart = part;
                this.key = "";
                this.renderPanel();
              },
            },
            label,
          ),
        ),
      );
    if (this.submenu === "items")
      add(
        sub,
        smallMode(
          "heal",
          `Лечить · ${(u.items.medkit ?? 0) + (u.items.meds ?? 0)} шт. · 2 ОД`,
          ap < 2 || !(u.items.medkit || u.items.meds),
        ),
        smallMode("throw", `Коктейль Молотова · ${u.items.molotov ?? 0} шт. · 2 ОД`, ap < 2 || !u.items.molotov),
      );
    if (this.submenu === "more")
      add(
        sub,
        w.ammo ? direct({ t: "reload" }, "Перезарядить · 1 ОД", ap < 1 || u.ammo >= w.ammo) : null,
        direct({ t: "overwatch" }, "Огонь наготове"),
        smallMode("melee", "Удар вблизи · 1 ОД", ap < 1),
        smallMode("shove", "Толкнуть · 1 ОД", ap < 1),
        smallMode("door", "Дверь · 1 ОД", ap < 1),
        direct({ t: "flee" }, "Отступить · 1 ОД", ap < 1),
      );
    if (sub.children.length) commands.append(sub);
    commands.append(
      h(
        "div.combat-guidance",
        null,
        this.mode
          ? (hints[this.mode] ?? "Выберите цель на поле.")
          : "Щёлкните врага — информация о цели. Щёлкните пол — движение.",
      ),
    );
    const finish = h(
      "div.combat-finish",
      null,
      s.phase === "anim"
        ? h(
            "button.combat-ready",
            {
              onclick: () => {
                this.fast = true;
                net.send({ k: "cskip" });
                setTimeout(() => (this.fast = false), 1500);
              },
            },
            "Ускорить",
            h("small", null, "Смотрим, что вышло…"),
          )
        : h(
            "button.combat-ready" + (s.ready?.[net.priv!.pid] ? ".confirmed" : ""),
            { disabled: !canPlan, onclick: () => this.sync(true) },
            s.ready?.[net.priv!.pid] ? "✓ Ход завершён" : "Конец хода",
            h("small", null, s.ready?.[net.priv!.pid] ? "Ждём остальных" : "Затем ходят враги"),
          ),
      h(
        "span.dim",
        null,
        s.dark ? "Темнота снижает точность" : `Стресс ${Math.round(u.stress)}${u.st.panic ? " · ПАНИКА" : ""}`,
      ),
    );
    add(this.panel, stats, commands, finish);
  }
}

function intentIcon(u: Unit) {
  const a = u.intent?.find((x) => x.t !== "move");
  if (!a) return u.intent?.length ? "🚶" : "…";
  return a.t === "shoot"
    ? "🔫"
    : a.t === "melee"
      ? "👊"
      : a.t === "throw"
        ? "🔥"
        : a.t === "flee"
          ? "🏃"
          : a.t === "steal"
            ? "💰"
            : a.t === "hunker"
              ? "🛡"
              : a.t === "door"
                ? "🚪"
                : "✨";
}

function describe(a: Action): string {
  switch (a.t) {
    case "move":
      return `идти ${a.col}`;
    case "shoot":
      return a.aimed ? "прицельный" : "выстрел";
    case "melee":
      return "удар";
    case "ability":
      return "навык";
    default:
      return (
        (
          {
            reload: "перезарядка",
            heal: "лечение",
            throw: "бросок",
            hunker: "укрыться",
            overwatch: "ожидание",
            door: "дверь",
            flee: "бежать",
            shove: "толчок",
            steal: "грабёж",
          } as Record<string, string>
        )[a.t] ?? a.t
      );
  }
}
