import { Room, type Client } from "@colyseus/core";
import { verifyPid } from "./telegram";
import {
  MSG,
  addPlayer,
  applyCmd,
  applyInput,
  applyPatch,
  clone,
  createWorld,
  diff,
  migrateWorld,
  privateView,
  publicView,
  restartAgree,
  setOffline,
  tickWorld,
  type Cmd,
  type InputMsg,
  type World,
} from "@bunker/shared";
import { deleteSave, loadWorld, saveWorld } from "./persistence";
import { announceRestart } from "./tgbot";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const SAVE_INTERVAL = 30; // seconds
const EMPTY_UNLOAD = Number(process.env.EMPTY_UNLOAD_SEC || 300);

export const activeCodes = new Set<string>();
/** running rooms by code (the Telegram bot reaches a chat's bunker through this) */
export const liveRooms = new Map<string, GameRoom>();

export function genCode(): string {
  for (;;) {
    let s = "";
    for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    // codes starting with T belong to Telegram chats
    if (!activeCodes.has(s) && s[0] !== "T") return s;
  }
}

interface Limiter {
  t: number;
  n: number;
  inputDt: number;
  inputT: number;
}

export class GameRoom extends Room {
  maxClients = 6;
  autoDispose = false;
  world!: World;
  lastPub: Record<string, any> = {};
  lastPriv = new Map<string, Record<string, any>>();
  pidOf = new Map<string, string>(); // sessionId → player id
  limiter = new Map<string, Limiter>();
  saveT = 0;
  emptyT = 0;
  lastDay = 0;
  devMode = process.env.NODE_ENV !== "production";

  onCreate(options: any) {
    const code = typeof options?.code === "string" && /^[A-Z0-9]{5}$/.test(options.code) ? options.code : genCode();
    this.roomId = code;
    activeCodes.add(code);
    liveRooms.set(code, this);
    const saved = options?.restore ? loadWorld(code) : null;
    if (saved) {
      this.world = migrateWorld(saved);
      for (const p of Object.values(this.world.players)) {
        p.online = false;
        if (p.char && this.world.chars[p.char]) this.world.chars[p.char].ctrl = null;
      }
      console.log(`[room ${code}] restored from save, day ${this.world.day}`);
    } else {
      const seed = (Math.random() * 2 ** 31) | 0;
      this.world = createWorld(code, seed, options?.settings ?? {});
      console.log(`[room ${code}] created, seed ${seed}`);
    }
    this.lastDay = this.world.day;
    this.setPrivate(!!options?.private);
    this.updateMeta();
    this.lastPub = clone(publicView(this.world));

    this.onMessage(MSG.input, (client, msg: InputMsg) => {
      const pid = this.pidOf.get(client.sessionId);
      if (!pid || !msg || typeof msg !== "object") return;
      // anti speed-hack: a token bucket of movement time refilled by real time. Packets bunched up by the
      // network spend the saved-up budget; a step beyond it is trimmed, never dropped — a dropped step was
      // lost walking and a pull-back on the client (#41)
      const lim = this.lim(client);
      const now = Date.now() / 1000;
      lim.inputDt = Math.min(0.75, (lim.inputDt ?? 0.5) + Math.max(0, now - (lim.inputT || now)));
      lim.inputT = now;
      const want = Math.max(0, Math.min(0.1, Number(msg.dt) || 0));
      const dt = Math.min(want, lim.inputDt);
      lim.inputDt -= dt;
      applyInput(this.world, pid, { ...msg, dt });
    });

    this.onMessage(MSG.act, (client, cmd: Cmd) => {
      const pid = this.pidOf.get(client.sessionId);
      if (!pid || !this.rate(client)) return;
      if (!cmd || typeof cmd !== "object" || typeof cmd.k !== "string") return;
      if (cmd.k.startsWith("debug") && !this.devMode) return;
      const phase = this.world.phase;
      try {
        const err = applyCmd(this.world, pid, cmd);
        if (err) client.send(MSG.err, { text: err });
        else if (cmd.k === "restartAsk" && this.roomId.startsWith("T")) announceRestart(this.roomId, this.world.players[pid]?.name ?? "Кто-то");
      } catch (e) {
        console.error(`[room ${this.roomId}] cmd ${cmd.k} failed`, e);
        client.send(MSG.err, { text: "Ошибка сервера" });
      }
      if (phase !== "lobby" && this.world.phase === "lobby") this.afterReset();
      if (cmd.k === "start" || cmd.k === "settings") this.updateMeta();
    });

    this.onMessage(MSG.chat, (client, msg: { text: string }) => {
      const pid = this.pidOf.get(client.sessionId);
      if (!pid || !this.rate(client)) return;
      applyCmd(this.world, pid, { k: "chat", text: String(msg?.text ?? "") });
    });

    this.setSimulationInterval((ms) => this.tick(Math.min(0.2, ms / 1000)), 50);
  }

  /** The bunker was started over: the old save must not come back when the room reloads. */
  afterReset() {
    deleteSave(this.roomId);
    this.lastDay = this.world.day;
    this.updateMeta();
  }

  /** «Начать заново» confirmed from the Telegram chat (a member who may not be in the game). */
  restartFromChat(pid: string, name: string): string | void {
    const was = this.world.phase;
    const err = restartAgree(this.world, pid, name);
    if (!err && was !== "lobby" && this.world.phase === "lobby") this.afterReset();
    return err;
  }

  lim(client: Client): Limiter {
    let l = this.limiter.get(client.sessionId);
    if (!l) {
      l = { t: Date.now(), n: 0, inputDt: 0, inputT: Date.now() / 1000 };
      this.limiter.set(client.sessionId, l);
    }
    return l;
  }

  rate(client: Client) {
    const l = this.lim(client);
    const now = Date.now();
    if (now - l.t > 1000) {
      l.t = now;
      l.n = 0;
    }
    return ++l.n <= 30;
  }

  onJoin(client: Client, options: any) {
    let pid = typeof options?.pid === "string" ? options.pid.slice(0, 40) : client.sessionId;
    // Telegram identities are signed by the server: without a valid signature it is just a guest
    if (pid.startsWith("tg_") && !verifyPid(pid, this.roomId, options?.sig)) pid = "guest_" + client.sessionId;
    // a chat's bunker is only for that chat's members, opened from Telegram
    if (this.roomId.startsWith("T") && !pid.startsWith("tg_")) throw new Error("Этот бункер принадлежит чату в Telegram — откройте игру из чата");
    // kick an older connection of the same player (duplicate tab)
    for (const [sid, p] of this.pidOf) {
      if (p === pid && sid !== client.sessionId) {
        const old = this.clients.find((c) => c.sessionId === sid);
        this.pidOf.delete(sid);
        old?.leave(4001);
      }
    }
    this.pidOf.set(client.sessionId, pid);
    addPlayer(this.world, pid, String(options?.name ?? ""));
    this.emptyT = 0;
    this.sendSnap(client, pid);
    this.updateMeta();
  }

  sendSnap(client: Client, pid: string) {
    const priv = clone(privateView(this.world, pid));
    this.lastPriv.set(client.sessionId, priv);
    client.send(MSG.snap, { p: this.lastPub, m: priv });
  }

  async onDrop(client: Client) {
    const pid = this.pidOf.get(client.sessionId);
    if (pid) setOffline(this.world, pid);
    try {
      await this.allowReconnection(client, 30);
    } catch {
      /* not reconnected: onLeave follows */
    }
  }

  onReconnect(client: Client) {
    const pid = this.pidOf.get(client.sessionId);
    if (!pid) return;
    addPlayer(this.world, pid, "");
    this.sendSnap(client, pid);
  }

  onLeave(client: Client) {
    const pid = this.pidOf.get(client.sessionId);
    this.pidOf.delete(client.sessionId);
    this.lastPriv.delete(client.sessionId);
    this.limiter.delete(client.sessionId);
    if (pid && ![...this.pidOf.values()].includes(pid)) setOffline(this.world, pid);
    this.updateMeta();
    if (this.world.phase !== "lobby") saveWorld(this.world);
  }

  onDispose() {
    if (this.world.phase !== "lobby") saveWorld(this.world);
    activeCodes.delete(this.roomId);
    liveRooms.delete(this.roomId);
    console.log(`[room ${this.roomId}] disposed`);
  }

  updateMeta() {
    const w = this.world;
    this.setMetadata({
      code: w.code,
      phase: w.phase,
      day: w.day,
      players: Object.values(w.players).filter((p) => p.online).map((p) => p.name),
      storyteller: w.settings.storyteller,
    });
  }

  tick(dt: number) {
    const w = this.world;
    const online = Object.values(w.players).some((p) => p.online);
    if (!online) {
      // nobody here: the world does not advance; unload after a while
      this.emptyT += dt;
      if (this.emptyT > EMPTY_UNLOAD && this.clients.length === 0) {
        saveWorld(w);
        this.disconnect();
      }
      return;
    }
    try {
      tickWorld(w, dt);
    } catch (e) {
      console.error(`[room ${this.roomId}] tick failed`, e);
    }
    this.flushFx();
    this.sync();
    this.saveT += dt;
    if (this.saveT > SAVE_INTERVAL || w.day !== this.lastDay) {
      this.saveT = 0;
      if (w.day !== this.lastDay) this.updateMeta();
      this.lastDay = w.day;
      saveWorld(w);
    }
  }

  flushFx() {
    const list = this.world.fx;
    if (!list || !list.length) return;
    this.world.fx = [];
    const pub = list.filter((f) => !f.to);
    if (pub.length) this.broadcast(MSG.fx, pub);
    for (const f of list) {
      if (!f.to) continue;
      for (const [sid, pid] of this.pidOf) {
        if (pid !== f.to) continue;
        this.clients.find((c) => c.sessionId === sid)?.send(MSG.fx, [f]);
      }
    }
  }

  sync() {
    const pub = publicView(this.world);
    const pd = diff(this.lastPub, pub);
    if (pd) applyPatch(this.lastPub, pd);
    for (const client of this.clients) {
      const pid = this.pidOf.get(client.sessionId);
      if (!pid) continue;
      let last = this.lastPriv.get(client.sessionId);
      if (!last) {
        last = {};
        this.lastPriv.set(client.sessionId, last);
      }
      const md = diff(last, privateView(this.world, pid));
      if (md) applyPatch(last, md);
      if (pd || md) client.send(MSG.patch, md ? { p: pd, m: md } : { p: pd });
    }
  }
}
