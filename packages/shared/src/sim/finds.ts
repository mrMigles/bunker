import type { Char, World } from "../types";
import { addObj, roomAt } from "../world/rooms";
import { findHooks } from "./build";
import { spawnItem } from "./items";
import { clamp, firstName, fx, log, rng } from "./util";

export const FIND_NAMES: Record<string, string> = {
  cache: "Тайник прошлых жильцов",
  stream: "Подземный ручей",
  mushroom_cave: "Пещера с грибницей",
  metro: "Старый туннель метро",
  bones: "Кости и записка",
  ai_capsule: "Капсула бункерного ИИ",
  rad_pocket: "Заражённая полость",
  nest: "Гнездо кротовиков",
  thermal: "Термальный источник",
  metal: "Залежь металла",
  newspaper_bundle: "Пачка старых газет",
  boardgame_box: "Коробка в земле",
};

function announce(w: World, c: Char, id: string, text: string, kind: "good" | "bad" | "event" = "event") {
  log(w, `🔍 ${firstName(c)}: ${FIND_NAMES[id]}! ${text}`, kind);
  fx(w, { k: "toast", text: `🔍 ${FIND_NAMES[id]}` });
  fx(w, { k: "sound", id: kind === "bad" ? "alarm" : "find" });
}

findHooks.cache = (w, c, x, lv) => {
  const r = rng(w);
  spawnItem(w, "crate", 1, x + 0.5, lv);
  spawnItem(w, r.pick(["meds", "parts", "ammo", "batteries"]), r.int(2, 4), x + 0.3, lv);
  if (r.chance(0.5)) spawnItem(w, r.pick(["pickaxe", "flashlight", "seed_strawberry", "seed_tomato", "radpills"]), 1, x + 0.7, lv);
  w.unread.push(r.pick(["n_cache1", "n_cache2"]));
  announce(w, c, "cache", "Ящик с припасами и записка.", "good");
};

findHooks.stream = (w, c, x, lv) => {
  addObj(w, "stream", x, lv, roomAt(w, x, lv)?.id);
  announce(w, c, "stream", "Бесплатная вода — но осторожнее с затоплением.", "good");
  const r = roomAt(w, x, lv);
  if (r) r.flood = clamp(r.flood + 20);
};

findHooks.mushroom_cave = (w, c, x, lv) => {
  spawnItem(w, "mushroom", 6, x + 0.5, lv);
  spawnItem(w, "spores", 3, x + 0.3, lv);
  announce(w, c, "mushroom_cave", "Грибы и грибница для фермы.", "good");
};

findHooks.metro = (w, c, x, lv) => {
  addObj(w, "metro", x, lv, roomAt(w, x, lv)?.id);
  w.flags.metro = 1;
  w.flags.metro_x = x;
  w.flags.metro_lv = lv;
  announce(w, c, "metro", "Второй выход наружу! И второй вход — для налётчиков…");
};

findHooks.bones = (w, c, x, lv) => {
  c.needs.sanity = clamp(c.needs.sanity - 4);
  const r = rng(w);
  w.unread.push(r.pick(["n_bones1", "n_bones2", "n_bones3"]));
  spawnItem(w, "note", 1, x + 0.5, lv);
  announce(w, c, "bones", "Жутко. В кармане — записка.", "event");
};

findHooks.ai_capsule = (w, c, x, lv) => {
  addObj(w, "ai_capsule", x, lv, roomAt(w, x, lv)?.id, { talked: 0 });
  w.flags.ai_capsule = 1;
  announce(w, c, "ai_capsule", "Внутри мигает экран: «ПРИВЕТСТВУЮ, ЖИЛЕЦ».", "good");
};

findHooks.rad_pocket = (w, c) => {
  c.needs.rad = clamp(c.needs.rad + 30);
  for (const id in w.chars) {
    const o = w.chars[id];
    if (o.id !== c.id && o.lv === c.lv && Math.abs(o.x - c.x) < 4) o.needs.rad = clamp(o.needs.rad + 12);
  }
  announce(w, c, "rad_pocket", "Счётчик Гейгера захлёбывается! +30 радиации.", "bad");
};

findHooks.nest = (w, c, x, lv) => {
  addObj(w, "nest", x, lv, roomAt(w, x, lv)?.id);
  w.flags.nest_found = 1;
  w.flags.nest_x = x;
  w.flags.nest_lv = lv;
  announce(w, c, "nest", "Из земли лезут кротовики!", "bad");
  // spawn a fight if combat module is present
  (w.mods as any)._pendingNest = { x, lv };
};

findHooks.thermal = (w, c, x, lv) => {
  addObj(w, "thermal_gen", x, lv, roomAt(w, x, lv)?.id);
  announce(w, c, "thermal", "Тёплый источник! Термоэлемент даёт 1.2 кВт бесплатно.", "good");
};

findHooks.metal = (w, c, x, lv) => {
  spawnItem(w, "scrap", 8, x + 0.4, lv);
  spawnItem(w, "parts", 3, x + 0.7, lv);
  announce(w, c, "metal", "Металлолом и детали.", "good");
};

findHooks.newspaper_bundle = (w, c, x, lv) => {
  const r = rng(w);
  for (let i = 0; i < 3; i++) w.unread.push("rand" + r.int(0, 9999));
  spawnItem(w, "newspaper", 3, x + 0.5, lv);
  announce(w, c, "newspaper_bundle", "Довоенные газеты — почитаем.", "good");
};

findHooks.boardgame_box = (w, c, x, lv) => {
  spawnItem(w, "boardgame", 1, x + 0.5, lv);
  (w.mods as any)._boxGame = "domino";
  announce(w, c, "boardgame_box", "Домино! Почти полное.", "good");
};
