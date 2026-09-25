import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { World } from "@bunker/shared";

const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), "data");
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, "saves.sqlite");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS saves (
    code TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    day INTEGER NOT NULL,
    phase TEXT NOT NULL,
    players TEXT NOT NULL,
    updated INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tgchats (
    code TEXT PRIMARY KEY,
    chat TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tglast (
    user TEXT PRIMARY KEY,
    chat TEXT NOT NULL,
    title TEXT,
    updated INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS legacy (
    name TEXT PRIMARY KEY,
    points INTEGER NOT NULL,
    unlocks TEXT NOT NULL
  );
`);

const stmtSave = db.prepare(
  "INSERT INTO saves(code, data, day, phase, players, updated) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(code) DO UPDATE SET data=excluded.data, day=excluded.day, phase=excluded.phase, players=excluded.players, updated=excluded.updated",
);
const stmtLoad = db.prepare("SELECT data FROM saves WHERE code = ?");
const stmtList = db.prepare("SELECT code, day, phase, players, updated FROM saves ORDER BY updated DESC LIMIT ?");
const stmtDel = db.prepare("DELETE FROM saves WHERE code = ?");
const stmtLastSet = db.prepare("INSERT INTO tglast(user, chat, title, updated) VALUES (?, ?, ?, ?) ON CONFLICT(user) DO UPDATE SET chat=excluded.chat, title=excluded.title, updated=excluded.updated");
const stmtLastGet = db.prepare("SELECT chat, title, updated FROM tglast WHERE user = ?");
const stmtLegacyGet = db.prepare("SELECT points, unlocks FROM legacy WHERE name = ?");
const stmtLegacySet = db.prepare("INSERT INTO legacy(name, points, unlocks) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET points=excluded.points, unlocks=excluded.unlocks");

export function serializeWorld(w: World): string {
  const { fx: _fx, ...rest } = w;
  return JSON.stringify(rest);
}

export function saveWorld(w: World) {
  if (w.phase === "lobby") return;
  const players = Object.values(w.players).map((p) => p.name);
  stmtSave.run(w.code, serializeWorld(w), w.day, w.phase, JSON.stringify(players), Date.now());
}

export function loadWorld(code: string): World | null {
  const row = stmtLoad.get(code) as { data: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.data) as World;
  } catch {
    return null;
  }
}

export function hasSave(code: string) {
  return !!stmtLoad.get(code);
}

export function listSaves(limit = 20) {
  return stmtList.all(limit) as { code: string; day: number; phase: string; players: string; updated: number }[];
}

export function deleteSave(code: string) {
  stmtDel.run(code);
}

const stmtChatSet = db.prepare("INSERT INTO tgchats(code, chat) VALUES (?, ?) ON CONFLICT(code) DO UPDATE SET chat=excluded.chat");
const stmtChatGet = db.prepare("SELECT chat FROM tgchats WHERE code = ?");

/** The Telegram chat a chat bunker lives in (known once someone pressed «Играть» there): the bot writes to it. */
export function setBunkerChat(code: string, chat: string) {
  stmtChatSet.run(code, chat);
}
export function bunkerChat(code: string): string | null {
  return (stmtChatGet.get(code) as { chat: string } | undefined)?.chat ?? null;
}

export function getLegacy(name: string) {
  const row = stmtLegacyGet.get(name) as { points: number; unlocks: string } | undefined;
  return row ? { points: row.points, unlocks: JSON.parse(row.unlocks) as string[] } : { points: 0, unlocks: [] as string[] };
}

export function addLegacy(name: string, points: number) {
  const cur = getLegacy(name);
  stmtLegacySet.run(name, cur.points + points, JSON.stringify(cur.unlocks));
}

/** The group bunker a Telegram user last played in: a Mini App opened from the bot's private chat goes there. */
export function rememberLastGroup(user: string, chat: string, title?: string) {
  stmtLastSet.run(user, chat, title ?? null, Date.now());
}
export function lastGroup(user: string): { chat: string; title?: string } | null {
  const row = stmtLastGet.get(user) as { chat: string; title: string | null; updated: number } | undefined;
  // a month-old game is not "the game with friends" any more
  if (!row || Date.now() - row.updated > 30 * 86400_000) return null;
  return { chat: row.chat, title: row.title ?? undefined };
}
