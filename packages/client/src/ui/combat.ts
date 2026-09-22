import * as THREE from "three";
import { ABILITIES, ENEMIES, WEAPONS, hitChance, moveCost, pathTo, validatePlan, type Action, type CEvent, type CombatState, type Unit } from "@bunker/shared";
import { audio } from "../audio/audio";
import { net } from "../net";
import { CharView } from "../render/chars";
import { mat } from "../render/palette";
import { SiteRenderer, buildEnemy } from "../render/site";
import type { WorldRenderer } from "../render/world";
import { add, bar, clear, floatText, h, ui } from "./dom";

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
  aimPart: "legs" | "arms" | "head" | undefined;
  queue: CEvent[] = [];
  qT = 0;
  playedRound = 0;
  hoverCell: { col: number; floor: number } | null = null;
  private key = "";
  private mouse = { x: 0, y: 0 };
  private attached: THREE.Scene | null = null;

  constructor(private r: WorldRenderer) {
    ui().append(this.labels, this.top, this.panel);
    const canvas = r.renderer.domElement;
    canvas.addEventListener("mousemove", (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
    });
    canvas.addEventListener("mousedown", (e) => {
      if (!this.active || e.button !== 0) return;
      this.click();
    });
    canvas.addEventListener("contextmenu", () => {
      if (this.active) this.mode = null;
    });
  }

  get cs(): (Omit<CombatState, "phase"> & { planLeft: number; phase: "plan" | "over" | "anim"; eventsRound: number; where: string }) | null {
    const c = net.pub?.mods?.combat;
    return c?.active ? (c as any) : null;
  }

  myUnit(): Unit | null {
    const s = this.cs;
    const ch = net.priv?.char;
    return s && ch ? (s.units["u_" + ch] as Unit) ?? null : null;
  }

  pos(col: number, floor: number): [number, number] {
    const s = this.cs!;
    if (this.where === "bunker") return [s.field.originX + col + 0.5, -((s.field.originLv + floor) * 2 + 2) + 0.16];
    return this.site.pos(col, floor);
  }

  cellAtMouse(): { col: number; floor: number } | null {
    const s = this.cs;
    if (!s) return null;
    const [wx, wy] = this.where === "bunker" ? this.r.toWorld(this.mouse.x, this.mouse.y) : this.site.toWorld(this.mouse.x, this.mouse.y);
    const col = Math.floor(wx - (this.where === "bunker" ? s.field.originX : 0));
    const lvAbs = Math.floor(-wy / 2);
    const floor = lvAbs - (this.where === "bunker" ? s.field.originLv : 0);
    if (col < 0 || col >= s.field.cols || floor < 0 || floor >= s.field.floors) return null;
    return { col, floor };
  }

  unitAtCell(c: { col: number; floor: number } | null): Unit | null {
    const s = this.cs;
    if (!s || !c) return null;
    return (Object.values(s.units) as Unit[]).find((u) => u.col === c.col && u.floor === c.floor && !u.dead && !u.fled) ?? null;
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

  tryAdd(a: Action) {
    const s = this.cs;
    const u = this.myUnit();
    if (!s || !u) return;
    const next = [...this.plan, a];
    const err = validatePlan(s as any, u.id, next);
    if (err) {
      floatText(this.mouse.x, this.mouse.y - 10, err, "#ff8a6a");
      audio.sfx("click", 0.5);
      return;
    }
    this.plan = next;
    audio.sfx("blip", 0.5);
    if (a.t !== "move") this.mode = null;
    this.sync(false);
  }

  sync(ready: boolean) {
    net.send({ k: "cplan", actions: this.plan, ready });
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
        if (target && target.side === "enemy") this.tryAdd({ t: "shoot", target: target.id, aimed: this.mode === "aim", part: this.mode === "aim" ? this.aimPart : undefined });
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
          const w = WEAPONS[u.weapon] ?? WEAPONS.fists;
          this.tryAdd(w.range > 1 ? { t: "shoot", target: target.id } : { t: "melee", target: target.id });
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
          this.floatAt(tv, e.hit ? (e.dmg ? `−${e.dmg}` : e.text ?? "") : "мимо", e.hit ? "#ff6a4a" : "#bbbbbb");
        }
        return 0.45;
      case "heal":
        if (tv) this.floatAt(tv, `+${e.dmg}`, "#8fcf6a");
        return 0.45;
      case "down":
      case "dead":
        if (vw) this.floatAt(vw, e.k === "dead" ? "☠" : e.text ?? "✚", "#ffffff");
        return 0.5;
      case "fire":
        if (e.col !== undefined) {
          const [x, y] = this.pos(e.col, e.floor!);
          for (let i = 0; i < 2; i++) {
            const f = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.8, 5), mat(0xff7a1a, { emissive: 0xff4400, opacity: 0.85 }));
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
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(a.x, a.y + 0.75, -0.3), new THREE.Vector3(b.x + (hit ? 0 : 0.4), b.y + 0.75, -0.3)]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe08a }));
    this.overlay.add(line);
    setTimeout(() => this.overlay.remove(line), 180);
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
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 1.9), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, depthWrite: false }));
      m.position.set(x, y + 0.95, 0.05);
      m.userData.plan = true;
      this.overlay.add(m);
    };
    // my plan
    let p = { col: u.col, floor: u.floor };
    for (const a of this.plan) if (a.t === "move") ((p = { col: a.col, floor: a.floor }), addMark(p.col, p.floor, 0x66ccff, 0.3));
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
      if (path) for (const st of path) addMark(st.col, st.floor, moveCost(path.length) <= this.apLeft() ? 0x66ff66 : 0xff6666, 0.18);
    }
  }

  private labKey = "";
  renderLabels() {
    const s = this.cs!;
    const u = this.myUnit();
    const cell = this.hoverCell;
    const target = this.unitAtCell(cell);
    const key = JSON.stringify([Object.values(s.units).map((x: any) => [x.id, x.hp, x.intentText, x.dead, x.down, x.fled]), [...this.views.values()].map((v) => [Math.round(v.x * 10), Math.round(v.y * 10)]), target?.id, this.mode, this.plan.length, this.r.camX.toFixed(1), this.r.camY.toFixed(1), this.r.viewH, s.phase]);
    if (key === this.labKey) return;
    this.labKey = key;
    clear(this.labels);
    for (const x of Object.values(s.units) as Unit[]) {
      if (x.dead || x.fled) continue;
      const vw = this.views.get(x.id);
      if (!vw) continue;
      const [sx, sy] = this.where === "bunker" ? this.r.toScreen(vw.x, vw.y + 1.75) : this.site.toScreen(vw.x, vw.y + 1.75);
      const el = h("div.label", { style: { left: sx + "px", top: sy + "px" } });
      if (x.side === "enemy" && x.intentText && s.phase === "plan") el.append(h("div.intent", null, intentIcon(x) + " " + x.intentText));
      el.append(h("div.nm" + (x.side === "ally" ? ".player" : ""), null, `${x.side === "enemy" ? x.icon + " " : ""}${x.name}`));
      const hb = bar(Math.max(0, x.hp), x.side === "ally" ? "#8fcf6a" : "#e0503a", x.maxHp);
      hb.style.width = "50px";
      hb.style.margin = "0 auto";
      el.append(hb);
      if (x.down) el.append(h("div.bad", null, x.captured ? "сдался" : "без сознания"));
      if (u && target?.id === x.id && x.side === "enemy" && (this.mode === "shoot" || this.mode === "aim" || this.mode === null)) {
        const pos = this.simPos();
        const me = { ...u, ...pos } as Unit;
        const ch = hitChance(s as any, me, x, this.mode === "aim", this.mode === "aim" ? this.aimPart : undefined);
        el.append(h("div.warn", null, `🎯 ${ch}%`));
      }
      this.labels.appendChild(el);
    }
  }

  renderPanel() {
    const s = this.cs!;
    const u = this.myUnit();
    const key = JSON.stringify([s.phase, s.planLeft, s.round, this.plan, this.mode, this.aimPart, u?.hp, u?.ap, u?.ammo, u?.cd, s.ready, s.result, s.log?.length, this.queue.length > 0]);
    if (key === this.key) return;
    this.key = key;
    clear(this.top);
    add(this.top, h("b", null, `⚔ Ход ${s.round}`), s.phase === "plan" ? h("span", null, ` · планирование ⏱ ${s.planLeft}с`) : s.phase === "anim" ? h("span.warn", null, " · разыгрываем…") : null, s.dark ? h("span.dim", null, " · темнота") : null);
    const log = h("div.combat-log", null, (s.log ?? []).slice(-4).map((l) => h("div", null, l)));
    this.top.append(log);
    clear(this.panel);
    if (!u) {
      add(this.panel, h("span.dim", null, "Вы наблюдаете за боем."), s.phase === "anim" ? h("button.small", { onclick: () => net.send({ k: "cskip" }) }, "⏩ Быстрее") : null);
      return;
    }
    const w = WEAPONS[u.weapon] ?? WEAPONS.fists;
    const ap = this.apLeft();
    const ab = u.ability ? ABILITIES[u.ability] : undefined;
    const modeBtn = (m: Mode, label: string, title = "", disabled = false) => h("button.small" + (this.mode === m ? ".primary" : ""), { title, disabled, onclick: () => ((this.mode = this.mode === m ? null : m), (this.key = "")) }, label);
    const direct = (a: Action, label: string, disabled = false) => h("button.small", { disabled, onclick: () => this.tryAdd(a) }, label);
    add(
      this.panel,
      h(
        "div.col",
        { style: { gap: "4px", minWidth: "170px" } },
        h("b", null, u.name),
        h("div.row", null, "❤", bar(Math.max(0, u.hp), "#8fcf6a", u.maxHp), `${Math.max(0, u.hp)}/${u.maxHp}`),
        h("div", null, `ОД: `, h("b", { class: ap > 0 ? "good" : "dim" }, `${ap}`), `/${u.ap} · ${w.name}${w.ammo ? ` ${u.ammo}/${w.ammo}` : ""}`),
        h("div.dim", null, `Стресс ${Math.round(u.stress)}${u.st.panic ? " · ПАНИКА" : ""}`),
      ),
      h(
        "div.col",
        { style: { gap: "4px" } },
        h(
          "div.row",
          { style: { flexWrap: "wrap", gap: "4px" } },
          modeBtn("move", "🚶 Идти", "1 клетка — 1 ОД, 3 клетки — 2 ОД"),
          w.range > 1 ? modeBtn("shoot", `🔫 Выстрел (${w.ap})`) : modeBtn("melee", `👊 Удар (${w.ap})`),
          w.range > 1 ? modeBtn("aim", `🎯 Прицельно (${w.ap + 1})`, "+20% к попаданию") : null,
          w.range > 1 ? modeBtn("melee", "👊 Удар (1)") : null,
          modeBtn("shove", "✋ Толкнуть (1)"),
          w.ammo ? direct({ t: "reload" }, "🔄 Перезарядка (1)") : null,
          (u.items.medkit ?? 0) + (u.items.meds ?? 0) > 0 ? modeBtn("heal", "🩹 Лечить (2)") : null,
          (u.items.molotov ?? 0) > 0 ? modeBtn("throw", "🍾 Бросить (2)") : null,
          ab ? h("button.small" + (this.mode === "ability" ? ".primary" : ""), { title: ab.desc, disabled: u.cd > 0, onclick: () => (ab.target === "none" || ab.target === "self" ? this.tryAdd({ t: "ability" }) : ((this.mode = "ability"), (this.key = ""))) }, `✨ ${ab.name} (${ab.ap})${u.cd > 0 ? ` ⏳${u.cd}` : ""}`) : null,
          direct({ t: "hunker" }, "🛡 Укрыться (1)"),
          direct({ t: "overwatch" }, "👁 Ожидание"),
          modeBtn("door", "🚪 Дверь (1)"),
          direct({ t: "flee" }, "🏃 Бежать (1)"),
        ),
        this.mode === "aim"
          ? h(
              "div.row",
              { style: { gap: "4px" } },
              h("span.dim", null, "Часть тела:"),
              ...([[undefined, "корпус"], ["legs", "ноги (замедлить)"], ["arms", "руки (сбить прицел)"], ["head", "голова (−15%, ×1.5)"]] as const).map(([p, l]) => h("button.small" + (this.aimPart === p ? ".primary" : ""), { onclick: () => ((this.aimPart = p as any), (this.key = "")) }, l)),
            )
          : null,
        h("div.dim", null, this.plan.length ? "План: " + this.plan.map(describe).join(" → ") : this.mode ? "Щёлкните цель на поле. ПКМ — отмена режима." : "Щёлкните врага — атака, клетку — идти. Или выберите действие."),
      ),
      h(
        "div.col",
        { style: { gap: "4px" } },
        h("button.small", { disabled: !this.plan.length, onclick: () => (this.plan.pop(), this.sync(false)) }, "↶ Отменить шаг"),
        s.phase === "anim"
          ? h("button.small", { onclick: () => ((this.fast = true), net.send({ k: "cskip" }), setTimeout(() => (this.fast = false), 1500)) }, "⏩ Быстрее")
          : h("button" + (s.ready?.[net.priv!.pid] ? ".good" : ".primary"), { onclick: () => this.sync(true) }, s.ready?.[net.priv!.pid] ? "✔ Готов" : "Готов ⏎"),
      ),
    );
  }
}

function intentIcon(u: Unit) {
  const a = u.intent?.find((x) => x.t !== "move");
  if (!a) return u.intent?.length ? "🚶" : "…";
  return a.t === "shoot" ? "🔫" : a.t === "melee" ? "👊" : a.t === "throw" ? "🔥" : a.t === "flee" ? "🏃" : a.t === "steal" ? "💰" : a.t === "hunker" ? "🛡" : a.t === "door" ? "🚪" : "✨";
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
        ({ reload: "перезарядка", heal: "лечение", throw: "бросок", hunker: "укрыться", overwatch: "ожидание", door: "дверь", flee: "бежать", shove: "толчок", steal: "грабёж" } as Record<string, string>)[a.t] ?? a.t
      );
  }
}
