import { Client, type Room } from "@colyseus/sdk";
import { MSG, applyPatch, clone, prologueWorld, siteWorld, stepMove, type Cmd, type Fx, type InputMsg, type PrivateView, type PublicView } from "@bunker/shared";

export const SERVER = import.meta.env.DEV ? `${location.protocol}//${location.hostname}:2567` : location.origin;

function randId() {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

let pidOverride = "";
/** Telegram: the player is their Telegram account, not this browser. */
export function setPlayerId(id: string) {
  pidOverride = id;
}

export function playerId(): string {
  if (pidOverride) return pidOverride;
  let id = localStorage.getItem("bunker.pid");
  if (!id) {
    id = randId();
    localStorage.setItem("bunker.pid", id);
  }
  return id;
}

export type View = PublicView & Record<string, any>;
export type Priv = PrivateView & Record<string, any>;

export interface Pred {
  x: number;
  y: number;
  lv: number;
  climbing: boolean;
  prevX: number;
  prevY: number;
  stepT: number; // seconds since last predicted step
}

export class Net {
  client = new Client(SERVER);
  room: Room | null = null;
  pub: View | null = null;
  priv: Priv | null = null;
  onChange = new Set<(kind: "snap" | "patch") => void>();
  onFx = new Set<(f: Fx) => void>();
  onError = new Set<(text: string) => void>();
  onLeave = new Set<(code: number) => void>();
  /** set while the player leaves on purpose (no auto-rejoin) */
  leaving = false;

  /** Leaves the bunker for the main menu: the character stays in the colony (a bot takes over). */
  async leaveToMenu() {
    this.leaving = true;
    try {
      sessionStorage.removeItem("bunker.session");
    } catch {}
    try {
      await this.room?.leave(true);
    } catch {}
    const tg = (window as any).Telegram?.WebApp;
    if (tg?.initData) {
      tg.close?.();
      return;
    }
    const u = new URL(location.href);
    u.searchParams.delete("code");
    location.replace(u.toString());
  }
  latency = 0;
  // prediction
  seq = 1;
  pending: InputMsg[] = [];
  pred: Pred | null = null;
  lastPatchAt = 0;

  get code() {
    return this.room?.roomId ?? "";
  }

  async create(name: string, opts: { private?: boolean; settings?: any } = {}) {
    const room = await this.client.create("game", { pid: playerId(), name, ...this.joinExtra, ...opts });
    this.attach(room);
  }

  /** extra join options (Telegram: the signed identity) */
  joinExtra: Record<string, unknown> = {};
  private pingTimer = 0;
  lastName = "";

  async join(code: string, name: string) {
    code = code.toUpperCase().trim();
    this.lastName = name;
    const r = await fetch(`${SERVER}/api/room/${code}`);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error || "Комната не найдена");
    }
    const room = await this.client.joinById(code, { pid: playerId(), name, ...this.joinExtra });
    this.attach(room);
  }

  attach(room: Room) {
    this.room = room;
    localStorage.setItem("bunker.lastCode", room.roomId);
    try {
      sessionStorage.setItem("bunker.session", room.roomId);
    } catch {}
    room.onMessage(MSG.snap, (m: { p: View; m: Priv }) => {
      this.pub = m.p;
      this.priv = m.m;
      this.pending = [];
      this.pred = null;
      this.syncPred();
      this.emit("snap");
    });
    room.onMessage(MSG.patch, (m: { p?: any; m?: any }) => {
      if (!this.pub) return;
      if (m.p) applyPatch(this.pub, m.p);
      if (m.m && this.priv) applyPatch(this.priv, m.m);
      this.lastPatchAt = performance.now();
      this.reconcile();
      this.emit("patch");
    });
    room.onMessage(MSG.fx, (list: Fx[]) => {
      for (const f of list) for (const h of this.onFx) h(f);
    });
    room.onMessage(MSG.err, (m: { text: string }) => {
      for (const h of this.onError) h(m.text);
    });
    room.onLeave((code: number) => {
      for (const h of this.onLeave) h(code);
    });
    room.onReconnect?.(() => {
      /* server sends a fresh snapshot on reconnect */
    });
    clearInterval(this.pingTimer);
    this.pingTimer = window.setInterval(() => {
      room.ping?.((ms: number) => (this.latency = ms));
    }, 3000);
  }

  emit(kind: "snap" | "patch") {
    for (const h of this.onChange) h(kind);
  }

  send(cmd: Cmd) {
    this.room?.send(MSG.act, cmd);
  }

  chat(text: string) {
    this.room?.send(MSG.chat, { text });
  }

  myChar(): any | undefined {
    const id = this.priv?.char;
    return id && this.pub ? this.pub.chars[id] : undefined;
  }

  /** Called at 20 Hz by the game loop with current held input. */
  sendInput(mx: number, my: number, run: boolean, dt: number) {
    const c = this.myChar();
    if (!this.room || !c || !this.pub) return;
    const moving = mx !== 0 || my !== 0;
    const inp: InputMsg = { seq: this.seq++, mx, my, run, dt };
    // skip idle inputs unless we need to stop
    if (!moving && this.pending.length === 0 && !(c as any).__lastMoving) return;
    (c as any).__lastMoving = moving;
    this.room.send(MSG.input, inp);
    if ((c.status !== "ok" && c.status !== "away") || (this.pub.phase !== "day" && this.pub.phase !== "prologue") || c.task) return;
    this.pending.push(inp);
    if (this.pending.length > 60) this.pending.shift();
    this.predictStep(inp);
  }

  syncPred() {
    const c = this.myChar();
    if (!c) {
      this.pred = null;
      return;
    }
    this.pred = { x: c.x, y: c.y, lv: c.lv, climbing: c.climbing, prevX: c.x, prevY: c.y, stepT: 1 };
  }

  private predictStep(inp: InputMsg) {
    const c = this.myChar();
    if (!c || !this.pub) return;
    if (!this.pred) this.syncPred();
    const p = this.pred!;
    const tmp = { ...c, x: p.x, y: p.y, lv: p.lv, climbing: p.climbing, run: inp.run, drunk: 0 };
    this.step(tmp, inp);
    p.prevX = p.x;
    p.prevY = p.y;
    p.x = tmp.x;
    p.y = tmp.y;
    p.lv = tmp.lv;
    p.climbing = tmp.climbing;
    p.stepT = 0;
  }

  /** Same movement rules as the server: in an expedition site Shift means sneaking at reduced speed. */
  private step(tmp: any, inp: InputMsg) {
    const site = this.pub?.mods?.expedition?.site;
    const pro = this.pub?.mods?.prologue;
    if (this.pub?.phase === "prologue") {
      if (pro && !pro.done) stepMove(prologueWorld(pro) as any, tmp, inp.mx, inp.my, inp.dt);
      return;
    }
    if (tmp.status === "away") {
      if (!site || this.pub?.mods?.combat?.active) return;
      tmp.run = false;
      stepMove(siteWorld(site) as any, tmp, inp.mx, inp.my, inp.run ? inp.dt * 0.55 : inp.dt);
      return;
    }
    stepMove(this.pub as any, tmp, inp.mx, inp.my, inp.dt);
  }

  private reconcile() {
    const c = this.myChar();
    if (!c || !this.pub) {
      this.pred = null;
      return;
    }
    const ack = c.seq ?? 0;
    this.pending = this.pending.filter((i) => i.seq > ack);
    const tmp = clone({ ...c, drunk: 0 });
    for (const inp of this.pending) {
      tmp.run = inp.run;
      this.step(tmp, inp);
    }
    if (!this.pred) {
      this.syncPred();
      return;
    }
    const p = this.pred;
    const err = Math.abs(tmp.x - p.x) + Math.abs(tmp.y - p.y);
    if (err > 1.5 || tmp.lv !== p.lv && !tmp.climbing && !p.climbing) {
      p.prevX = p.x = tmp.x;
      p.prevY = p.y = tmp.y;
    } else {
      // gentle correction
      p.x += (tmp.x - p.x) * 0.35;
      p.y += (tmp.y - p.y) * 0.35;
    }
    p.lv = tmp.lv;
    p.climbing = tmp.climbing;
  }
}

export const net = new Net();
