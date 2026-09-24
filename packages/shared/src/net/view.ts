import type { Char, World } from "../types";
import { ROOMS } from "../world/rooms";

// Builds what clients are allowed to see. Public view is shared by all clients;
// private view carries per-player secrets (goal, stash, offered cards, private hands...).

const r2 = (v: number) => Math.round(v * 100) / 100;
const r1 = (v: number) => Math.round(v * 10) / 10;

/** Progress of open-ended work (digging a cell, raising a frame) for the progress bars. */
function taskProgress(w: World, c: Char): number {
  const t = c.task!;
  if (t.dur > 0) return r2(t.t / t.dur);
  if (t.action === "dig" && t.cell !== undefined) return r2(Math.min(1, w.dig[t.cell] ?? 0));
  if (t.action === "build_frame" && t.room && w.rooms[t.room]) return r2(Math.min(1, w.rooms[t.room].work / Math.max(1, ROOMS[w.rooms[t.room].type]?.work ?? 30)));
  return -1;
}

function pubChar(c: Char, w: World) {
  const needs: Record<string, number> = {};
  for (const k in c.needs) needs[k] = Math.round((c.needs as any)[k]);
  const card = { ...c.card, goal: undefined };
  return {
    id: c.id,
    card,
    needs,
    skills: c.skills,
    x: r2(c.x),
    y: r2(c.y),
    lv: c.lv,
    dir: c.dir,
    climbing: c.climbing,
    task: c.task ? { action: c.task.action, obj: c.task.obj, cell: c.task.cell, p: taskProgress(w, c) } : null,
    hands: c.hands,
    ctrl: c.ctrl,
    thought: c.mind.thought,
    plan: c.mind.plan,
    status: c.status,
    downT: Math.ceil(c.downT),
    anim: c.anim,
    bark: c.bark ? { text: c.bark.text, to: c.bark.to } : null,
    rel: c.rel,
    emote: c.emote ? c.emote.id : null,
    drunk: c.drunk > 0 ? 1 : 0,
    sick: Math.round(c.sick),
    injury: c.injury,
    npc: c.npc,
    seat: c.seat,
    run: c.run,
    seq: c.seq,
    legacy: c.legacy,
    xp: c.xp ?? 0,
    level: c.level ?? 1,
    perks: c.perks ?? [],
    perkOffer: c.perkOffer,
    equip: c.equip ?? {},
  };
}

export type PubChar = ReturnType<typeof pubChar>;

export function publicView(w: World) {
  const chars: Record<string, PubChar> = {};
  for (const id in w.chars) chars[id] = pubChar(w.chars[id], w);
  const players: Record<string, any> = {};
  for (const id in w.players) {
    const p = w.players[id];
    players[id] = { id: p.id, name: p.name, char: p.char, online: p.online, ready: p.ready, host: p.host, color: p.color, ghost: p.ghost, pick: p.pick !== undefined ? 1 : 0, aquarium: p.aquarium };
  }
  const dig: Record<string, number> = {};
  for (const k in w.dig) dig[k] = r1(w.dig[k]);
  const res: Record<string, number> = {};
  for (const k in w.res) if (w.res[k] > 0.001) res[k] = r1(w.res[k]);
  const objs: Record<string, any> = {};
  for (const id in w.objs) {
    const o = w.objs[id];
    const st: Record<string, any> = {};
    for (const k in o.st) {
      const v = o.st[k];
      st[k] = typeof v === "number" ? r1(v) : v;
    }
    objs[id] = { ...o, wear: Math.round(o.wear), st };
  }
  const rooms: Record<string, any> = {};
  for (const id in w.rooms) {
    const r = w.rooms[id];
    rooms[id] = { ...r, work: r1(r.work), dirt: Math.round(r.dirt), fire: Math.round(r.fire), flood: Math.round(r.flood), comfort: Math.round(r.comfort) };
  }
  return {
    code: w.code,
    settings: w.settings,
    phase: w.phase,
    phaseT: Math.floor(w.phaseT),
    day: w.day,
    hour: r2(w.hour),
    speed: w.speed,
    paused: w.paused,
    W: w.W,
    H: w.H,
    grid: w.grid,
    dig,
    marks: w.marks,
    found: w.found,
    ladders: w.ladders,
    rooms,
    objs,
    items: w.items,
    chars,
    players,
    res,
    power: { battery: r2(w.power.battery), cap: w.power.cap, gen: r2(w.power.gen), use: r2(w.power.use), demand: r2(w.power.demand), prio: w.power.prio, off: w.power.off },
    air: { co2: Math.round(w.air.co2) },
    chores: w.chores,
    council: w.council ? { ...w.council, vote: w.council.vote ? voteView(w.council.vote) : null } : null,
    vote: w.vote ? voteView(w.vote) : null,
    log: w.log.slice(-40),
    gazette: w.gazette.slice(-1),
    gazetteCount: w.gazette.length,
    director: { tension: Math.round(w.director.tension), quiet: w.director.quiet, raidWarn: w.director.raidWarn },
    notice: Math.round(w.notice),
    pet: w.pet ? { ...w.pet, x: r2(w.pet.x) } : null,
    elder: w.elder,
    archive: w.archive,
    unread: w.unread,
    tapes: w.tapes,
    books: w.books,
    films: w.films,
    games: w.games,
    recipes: w.recipes,
    tech: w.tech,
    research: w.research ? { id: w.research.id, progress: r1(w.research.progress) } : null,
    factions: w.factions,
    canvas: w.canvas,
    radio: w.radio,
    ending: w.ending,
    weather: w.weather,
    flags: publicFlags(w.flags),
    mods: publicMods(w),
  };
}

function voteView(v: NonNullable<World["vote"]>) {
  return { ...v, data: undefined };
}

function publicFlags(f: Record<string, number>) {
  const out: Record<string, number> = {};
  for (const k in f) if (!k.startsWith("_")) out[k] = f[k];
  return out;
}

/** Subsystems (expedition, combat, tables, prologue) register public/private view builders here. */
export const modViews: Record<string, { pub?: (w: World, m: any) => any; priv?: (w: World, m: any, pid: string) => any }> = {};

function publicMods(w: World) {
  const out: Record<string, any> = {};
  for (const k in w.mods) {
    if (k.startsWith("_")) continue;
    const v = modViews[k];
    if (v?.pub) out[k] = v.pub(w, w.mods[k]);
    else if (!v) out[k] = w.mods[k];
  }
  return out;
}

export function privateView(w: World, pid: string) {
  const p = w.players[pid];
  if (!p) return { pid };
  const c = p.char ? w.chars[p.char] : undefined;
  const mods: Record<string, any> = {};
  for (const k in w.mods) {
    const v = modViews[k];
    if (v?.priv) mods[k] = v.priv(w, w.mods[k], pid);
  }
  return {
    pid,
    char: p.char,
    cards: p.cards,
    pick: p.pick,
    goal: c?.card.goal,
    stash: c?.stash,
    halluc: c && c.needs.sanity < 30 ? 1 : 0,
    host: p.host,
    mods,
  };
}

export type PublicView = ReturnType<typeof publicView>;
export type PrivateView = ReturnType<typeof privateView>;
