import * as THREE from "three";
import { ITEMS, itemName, listPrologueActions, type PAction } from "@bunker/shared";
import { audio } from "../audio/audio";
import { net } from "../net";
import { CharView } from "../render/chars";
import { box, cyl, glyphTex, mat } from "../render/palette";
import { SiteRenderer, buildEnemy } from "../render/site";
import type { WorldRenderer } from "../render/world";
import { add, clear, h, ui } from "./dom";

/** The «90 seconds» street: rendered as its own side-view stage. */
export class PrologueUI {
  site = new SiteRenderer();
  dyn = new THREE.Group();
  chars = new Map<string, CharView>();
  npcs = new Map<string, THREE.Object3D>();
  hud = h("div.prologue-hud.hidden");
  prompt = h("div.prompt.hidden");
  flash = h("div.flash.hidden");
  active = false;
  actions: PAction[] = [];
  sel = 0;
  private built = false;
  private hudKey = "";
  private promptKey = "";
  private holding = false;
  private lastSiren = -1;

  constructor(private r: WorldRenderer) {
    this.site.scene.add(this.dyn);
    ui().append(this.hud, this.prompt, this.flash);
  }

  get p(): any {
    return net.pub?.phase === "prologue" ? net.pub.mods?.prologue : null;
  }

  update() {
    const p = this.p;
    this.active = !!p;
    this.hud.classList.toggle("hidden", !p);
    if (!p) {
      this.prompt.classList.add("hidden");
      return;
    }
    if (!this.built) {
      const floors = p.H / 2;
      const walk: boolean[] = [];
      for (let lv = 0; lv < floors; lv++) for (let x = 0; x < p.W; x++) walk.push(p.grid[lv * 2 * p.W + x] === 0);
      this.site.build({ cols: p.W, floors, walk, ladders: Object.keys(p.ladders), covers: [], doors: [], exits: [] });
      this.built = true;
    }
    const left = Math.max(0, Math.ceil(p.dur - p.t));
    const saved = Object.values(p.delivered as Record<string, number>).reduce((a, b) => a + b, 0);
    const key = JSON.stringify([left, saved, p.done]);
    if (key !== this.hudKey) {
      this.hudKey = key;
      clear(this.hud);
      add(
        this.hud,
        h("div.prologue-timer" + (left <= 15 ? ".urgent" : ""), null, p.done ? "☢" : `0:${String(left).padStart(2, "0")}`),
        h("div", null, `В люке: ${saved} предм. `, h("span.dim", null, "· E — взять/бросить в люк · Q — кинуть вперёд (товарищу) · держите E — уговорить соседа")),
      );
      if (left <= 20 && left !== this.lastSiren && left % 5 === 0) {
        this.lastSiren = left;
        audio.sfx("siren", 0.5);
      }
    }
    if (p.done) {
      this.flash.classList.remove("hidden");
      this.flash.style.opacity = String(Math.max(0, 1 - p.flashT / 4));
    } else this.flash.classList.add("hidden");
  }

  frame(dt: number): boolean {
    const p = this.p;
    if (!p) {
      if (this.active) this.active = false;
      return false;
    }
    const v = net.pub!;
    // sky turns red as time runs out
    const k = Math.min(1, p.t / p.dur);
    (this.site.scene.background as THREE.Color).setRGB(0.15 + k * 0.55, 0.1 + (1 - k) * 0.1, 0.1);
    this.dyn.clear();
    // hatch
    const [hx, hy] = this.site.pos(p.hatchX, 1);
    this.dyn.add(cyl(0.55, 0.12, 0x6e6a60, hx, hy, -0.4, 12), box(0.1, 0.9, 0.1, 0xd62828, hx + 0.7, hy, -0.6));
    this.dyn.add(this.icon("⬇", hx, hy + 1.2, 0.6));
    for (const it of p.items) {
      const [x, y] = this.site.pos(it.x - 0.5, it.lv);
      this.dyn.add(this.icon(ITEMS[it.item]?.icon ?? "📦", x, y + 0.3, ITEMS[it.item]?.large ? 0.55 : 0.4));
    }
    for (const n of p.npcs) {
      if (n.state === "saved") continue;
      let g = this.npcs.get(n.id);
      if (!g) {
        g = buildEnemy("marauder", 0x7a8aa0);
        this.npcs.set(n.id, g);
      }
      const [x, y] = this.site.pos(n.x - 0.5, n.lv);
      g.position.set(x, y, -0.4);
      g.rotation.y = n.dir > 0 ? 0.6 : Math.PI - 0.6;
      this.dyn.add(g, this.icon(n.state === "follow" ? "🏃" : "😱", x, y + 1.6, 0.4));
    }
    for (const c of Object.values(v.chars) as any[]) {
      let cv = this.chars.get(c.id);
      if (!cv) {
        cv = new CharView(c.id, c.card.color, c.card.hat, 1);
        this.chars.set(c.id, cv);
      }
      const mine = c.id === net.priv?.char && net.pred;
      const tx = mine ? net.pred!.x : c.x,
        ty = mine ? net.pred!.y : c.y;
      cv.x += (tx - cv.x) * Math.min(1, dt * 12);
      cv.y += (ty - cv.y) * Math.min(1, dt * 12);
      const moving = Math.abs(tx - cv.userPrevX) > 0.002;
      cv.userPrevX = tx;
      cv.setCarry(c.hands ?? []);
      cv.update(dt, c.climbing ? "climb" : moving ? "run" : "idle", c.dir ?? 1);
      cv.root.position.set(cv.x, -cv.y + 0.16, -0.45);
      cv.setMine(c.id === net.priv?.char);
      this.dyn.add(cv.root);
    }
    const me = net.myChar();
    if (me) {
      const x = net.pred ? net.pred.x : me.x,
        y = net.pred ? net.pred.y : me.y;
      this.site.follow = false;
      this.site.viewH = 7;
      this.site.camX += (x - this.site.camX) * Math.min(1, dt * 4);
      this.site.camY += (-y + 1.2 - this.site.camY) * Math.min(1, dt * 4);
    }
    // camera shake near the end
    const shake = p.t > 60 ? (p.t - 60) / 30 : 0;
    const cx = this.site.camX;
    this.site.camX += (Math.random() - 0.5) * shake * 0.15;
    this.site.render(this.r.renderer);
    this.site.camX = cx;
    this.updatePrompt();
    return true;
  }

  icon(glyph: string, x: number, y: number, size: number) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glyphTex(glyph), transparent: true, depthWrite: false }));
    sp.scale.setScalar(size);
    sp.position.set(x, y, 0.3);
    return sp;
  }

  updatePrompt() {
    const p = this.p;
    const c = net.myChar();
    if (!p || !c || p.done) {
      this.prompt.classList.add("hidden");
      return;
    }
    const me = { ...c, x: net.pred?.x ?? c.x, lv: net.pred?.lv ?? c.lv, climbing: net.pred?.climbing ?? c.climbing };
    this.actions = listPrologueActions(p, me as any).slice(0, 6);
    if (this.sel >= this.actions.length) this.sel = 0;
    const cv = this.chars.get(c.id);
    const [sx, sy] = this.site.toScreen(cv ? cv.x : c.x, -(cv ? cv.y : c.y) + 2.2);
    this.prompt.style.left = sx + "px";
    this.prompt.style.top = sy + "px";
    const task = p.tasks?.[c.id];
    const key = JSON.stringify([this.actions.map((a) => a.label + (a.reason ?? "")), this.sel, task ? Math.round(task.t * 3) : -1, c.hands]);
    if (key === this.promptKey) return;
    this.promptKey = key;
    clear(this.prompt);
    if (c.hands.length) this.prompt.append(h("div.dim", null, "В руках: " + c.hands.map((x: any) => itemName(x.item)).join(", ")));
    if (task) this.prompt.append(h("div.warn", null, `🗣 Уговариваю… ${Math.min(100, Math.round((task.t / 3) * 100))}%`));
    this.actions.forEach((a, i) =>
      this.prompt.appendChild(h("div.opt" + (i === this.sel ? ".sel" : "") + (a.reason ? ".dis" : ""), { onmousedown: (e: MouseEvent) => (e.preventDefault(), this.trigger(i)) }, h("span.key", null, i === this.sel ? "E" : String(i + 1)), a.label, a.reason ? h("span.bad", null, " — " + a.reason) : null)),
    );
    this.prompt.classList.toggle("hidden", !this.actions.length && !task && !c.hands.length);
  }

  trigger(i = this.sel) {
    const a = this.actions[i];
    if (!a || a.reason) return;
    net.send({ k: "pdo", a: a.a, id: a.id });
    if (a.a === "persuade") this.holding = true;
    audio.sfx(a.a === "drop" ? "find" : "click", 0.5);
  }

  handleKey(e: KeyboardEvent, down: boolean): boolean {
    if (!this.active) return false;
    if (!down) {
      if (e.code === "KeyE" && this.holding) {
        net.send({ k: "pstop" });
        this.holding = false;
      }
      return false;
    }
    if (e.code === "KeyE") {
      this.trigger();
      return true;
    }
    if (e.code === "KeyQ") {
      net.send({ k: "pthrow" });
      audio.sfx("hit", 0.4);
      return true;
    }
    if (/^Digit[1-6]$/.test(e.code)) {
      this.trigger(Number(e.code.slice(5)) - 1);
      return true;
    }
    return e.code !== "KeyC" && e.code !== "Enter" && e.code !== "Escape";
  }
}
