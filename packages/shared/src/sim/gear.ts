// Снаряжение и руки: each resident can wear a weapon, armour and a tool of their own (taken out of the
// common storage), and residents standing close together can pass what they carry to each other.
// Players manage themselves and the bot residents (their companions); another player's character is theirs.
import { ITEMS, itemName } from "../data/items";
import type { Char, World } from "../types";
import { registerCmd } from "./commands";
import { deathHooks } from "./needs";
import { log } from "./util";

export type GearSlot = "weapon" | "armor" | "tool";

export const GEAR: Record<GearSlot, { name: string; items: string[] }> = {
  weapon: { name: "Оружие", items: ["knife", "pipe", "crowbar", "pistol", "shotgun", "rifle"] },
  armor: { name: "Защита", items: ["armor"] },
  tool: { name: "Инструмент", items: ["flashlight", "gasmask", "nvg", "geiger", "lockpick"] },
};

export function gearOf(c: Char): Partial<Record<GearSlot, string>> {
  return (c.equip ??= {});
}

/** Whom may this player dress and hand things to: themselves and the residents run by bots. */
function manageable(w: World, pid: string, c: Char | undefined): string | void {
  if (!c || c.status === "dead") return "Нет такого жильца";
  if (c.ctrl && c.ctrl !== pid) return "Это персонаж другого игрока";
  if (c.status === "away") return "Жилец на вылазке";
}

registerCmd("equip", (w, p, cmd) => {
  const c = w.chars[String(cmd.char ?? p.char)];
  const err = manageable(w, p.id, c);
  if (err) return err;
  const slot = String(cmd.slot) as GearSlot;
  if (!GEAR[slot]) return "Нет такого слота";
  const eq = gearOf(c!);
  const item = cmd.item ? String(cmd.item) : "";
  if (item && !GEAR[slot].items.includes(item)) return "Сюда это не надеть";
  if (item && (w.res[item] ?? 0) < 1) return `На складе нет: ${itemName(item)}`;
  // the old thing goes back to the storage
  if (eq[slot]) w.res[eq[slot]!] = (w.res[eq[slot]!] ?? 0) + 1;
  delete eq[slot];
  if (item) {
    w.res[item] -= 1;
    eq[slot] = item;
    log(w, `🎒 ${c!.card.name.split(" ")[0]} берёт: ${ITEMS[item]?.icon ?? ""}${itemName(item)}.`, "info");
  }
});

registerCmd("handGive", (w, p, cmd) => {
  const from = w.chars[String(cmd.from)];
  const to = w.chars[String(cmd.to)];
  const e1 = manageable(w, p.id, from) ?? manageable(w, p.id, to);
  if (e1) return e1;
  if (from === to) return;
  if (from!.lv !== to!.lv || Math.abs(from!.x - to!.x) > 4) return "Подойдите ближе друг к другу";
  const i = Number(cmd.i);
  const h = from!.hands[i];
  if (!h) return "Нечего передать";
  if (to!.hands.length >= 3) return "У того руки заняты";
  from!.hands.splice(i, 1);
  to!.hands.push(h);
});

// the dead leave their gear behind: it returns to the common storage
deathHooks.push((w, c) => {
  for (const it of Object.values(c.equip ?? {})) if (it) w.res[it] = (w.res[it] ?? 0) + 1;
  c.equip = {};
});
