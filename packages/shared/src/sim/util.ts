import type { Fx } from "../net/protocol";
import { Rng } from "../rng";
import { BAL } from "../data/balance";
import type { Char, LogEntry, World } from "../types";

export function fx(w: World, f: Fx) {
  (w.fx ??= []).push(f);
}

export function log(w: World, text: string, kind: LogEntry["kind"] = "info", who?: string) {
  w.log.push({ t: w.day * 100 + w.hour, day: w.day, text, kind, who });
  if (w.log.length > 200) w.log.splice(0, w.log.length - 200);
}

export function rng(w: World) {
  return new Rng(w.rng);
}

export function clamp(v: number, a = 0, b = 100) {
  return v < a ? a : v > b ? b : v;
}

export function skillLevel(c: Char, s: keyof Char["skills"]) {
  return Math.min(10, 1 + Math.floor(Math.sqrt((c.skills[s] ?? 0) / 12)));
}

export function addXp(c: Char, s: keyof Char["skills"], xp: number) {
  c.skills[s] = (c.skills[s] ?? 0) + xp;
  // skill practice also counts toward the character's level
  c.xp = (c.xp ?? 0) + xp * 0.5;
}

export function alive(c: Char) {
  return c.status !== "dead";
}

export function aliveChars(w: World) {
  return Object.values(w.chars).filter((c) => c.status !== "dead");
}

export function homeChars(w: World) {
  return Object.values(w.chars).filter((c) => c.status !== "dead" && c.status !== "away");
}

export function playerOf(w: World, c: Char) {
  return c.ctrl ? w.players[c.ctrl] : undefined;
}

/** Characters driven by the bot brain: no controller, or the controller is offline / in Aquarium mode. */
export function isBotDriven(w: World, charId: string) {
  const c = w.chars[charId];
  if (!c) return false;
  if (!c.ctrl) return true;
  const p = w.players[c.ctrl];
  return !p || !p.online || p.aquarium;
}

export function firstName(c: Char) {
  return c.card.name.split(" ")[0];
}

/** A first name in the instrumental case: «поговорить с Василием / Анной / Петром». */
export function nameWith(name: string, female?: boolean): string {
  const irregular: Record<string, string> = { Пётр: "Петром", Лев: "Львом", Павел: "Павлом", Любовь: "Любовью", Илья: "Ильёй", Никита: "Никитой" };
  if (irregular[name]) return irregular[name];
  const stem = name.slice(0, -1);
  const last = name.slice(-1);
  const hush = /[жшчщц]$/;
  if (/ий$|ей$|ай$|ой$/.test(name)) return stem + (name.endsWith("ий") ? "ем" : "ем");
  if (last === "а") return stem + (hush.test(stem) ? "ей" : "ой");
  if (last === "я") return stem + "ей";
  if (last === "ь") return female ? name + "ю" : stem + "ем";
  if (female) return name; // foreign female names ending in a consonant do not change
  return name + (hush.test(name) ? "ем" : "ом");
}

/** Card traits and learned perks share one namespace. */
export function hasTrait(c: Char, t: string) {
  return c.card.plus === t || c.card.minus === t || !!c.perks?.includes(t);
}

export function dist(c: { x: number; lv: number }, x: number, lv: number) {
  return Math.abs(c.x - x) + Math.abs(c.lv - lv) * 6;
}

/** Game-hours per real second during the day phase. */
export function hoursPerSec(w: World) {
  return (BAL.dayEndHour - BAL.dayStartHour) / w.settings.dayLength;
}

export function totalFood(w: World, nutOf: (k: string) => number) {
  let t = 0;
  for (const k in w.res) t += (w.res[k] || 0) * nutOf(k);
  return t;
}
