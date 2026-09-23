import { ITEMS, itemName } from "../data/items";
import type { World } from "../types";
import { ROOMS, addObj, objsInRoom, roomAt } from "../world/rooms";
import { defAction, emitWork } from "./actions";
import { costText, give, hasRes, missingText, payRes } from "./items";
import { onTick } from "./tick";
import { clamp, log } from "./util";

// Furniture items produced at the workbench, carried and placed anywhere.
export const FURNITURE: Record<string, { name: string; icon: string; obj: string; cost: Record<string, number>; comfort: number }> = {
  furn_armchair: { name: "Кресло", icon: "🛋️", obj: "armchair", cost: { wood: 4, cloth: 3 }, comfort: 6 },
  furn_rug: { name: "Ковёр", icon: "🟥", obj: "rug", cost: { cloth: 4 }, comfort: 5 },
  furn_lamp: { name: "Торшер", icon: "💡", obj: "lamp", cost: { scrap: 2, parts: 1 }, comfort: 5 },
  furn_poster: { name: "Довоенный плакат", icon: "🖼️", obj: "poster", cost: { cloth: 1, chem: 1 }, comfort: 4 },
  furn_plant: { name: "Растение в горшке", icon: "🪴", obj: "plant", cost: { compost: 1, seed_herbs: 1 }, comfort: 6 },
  furn_bed: { name: "Нары", icon: "🛏️", obj: "bed", cost: { wood: 5, cloth: 2 }, comfort: 0 },
  furn_washtub: { name: "Корыто для стирки", icon: "🫧", obj: "washtub", cost: { scrap: 3 }, comfort: 0 },
  furn_bookshelf: { name: "Книжная полка", icon: "📚", obj: "bookshelf", cost: { wood: 5 }, comfort: 4 },
  furn_pet_bed: { name: "Лежанка питомца", icon: "🧺", obj: "pet_bed", cost: { cloth: 2, wood: 1 }, comfort: 2 },
  furn_darts: { name: "Дартс", icon: "🎯", obj: "darts", cost: { wood: 2, scrap: 1 }, comfort: 2 },
  furn_shower: { name: "Горячий душ", icon: "🚿", obj: "shower", cost: { scrap: 8, parts: 4 }, comfort: 3 },
  furn_projector: { name: "Кинопроектор", icon: "📽️", obj: "projector", cost: { parts: 6, scrap: 3 }, comfort: 2 },
  furn_still: { name: "Самогонный аппарат", icon: "⚗️", obj: "still", cost: { scrap: 6, parts: 2 }, comfort: 0 },
  furn_periscope: { name: "Перископ", icon: "🔭", obj: "periscope", cost: { scrap: 6, parts: 3 }, comfort: 0 },
  furn_tape_player: { name: "Магнитофон", icon: "📼", obj: "tape_player", cost: { parts: 3, scrap: 2 }, comfort: 2 },
  furn_piano: { name: "Пианино (собранное из хлама)", icon: "🎹", obj: "piano", cost: { wood: 8, scrap: 4, parts: 2 }, comfort: 4 },
  furn_drawing_wall: { name: "Стена для рисунков", icon: "🎨", obj: "drawing_wall", cost: { wood: 2, chem: 1 }, comfort: 3 },
  furn_rat_trap: { name: "Крысоловка", icon: "🪤", obj: "rat_trap", cost: { scrap: 1, wood: 1 }, comfort: 0 },
  furn_altar: { name: "Полка со свечами", icon: "🕯️", obj: "altar", cost: { wood: 3 }, comfort: 4 },
  furn_bike: { name: "Генератор-велосипед", icon: "🚲", obj: "bike_gen", cost: { scrap: 3, parts: 3, wood: 4 }, comfort: -2 },
};
for (const k in FURNITURE) {
  const f = FURNITURE[k];
  ITEMS[k] = { name: f.name, icon: f.icon, cat: "misc", large: true, value: 5, weight: 5, store: false };
}

// Keepsakes from the prologue become shelf decor.
const KEEPSAKES: Record<string, string> = { album: "keepsake", iron: "keepsake", teddy: "keepsake", gnome: "keepsake", radio_portable: "keepsake", plant_pot: "plant", guitar: "guitar_stand" };

/**
 * Keepsakes carried in during the prologue are unpacked straight into the living spaces
 * instead of piling up at the airlock (and cluttering everyone's action list).
 * Returns the items that found no free spot.
 */
export function settleKeepsakes(w: World, items: string[]): string[] {
  const rooms = Object.values(w.rooms)
    .filter((r) => r.state === "done" && ["living", "mess", "rec", "storage"].includes(r.type))
    .sort((a, b) => ["living", "mess", "rec", "storage"].indexOf(a.type) - ["living", "mess", "rec", "storage"].indexOf(b.type));
  const left: string[] = [];
  const placed: string[] = [];
  for (const item of items) {
    const kind = KEEPSAKES[item];
    let done = false;
    for (const r of rooms) {
      const used = new Set(objsInRoom(w, r.id).map((o) => o.x));
      for (let x = r.x; x < r.x + r.w && !done; x++) {
        if (used.has(x) || w.ladders[x + "," + r.lv]) continue;
        addObj(w, kind, x, r.lv, r.id, { item });
        if (item === "album") w.flags.album_home = 1;
        placed.push(itemName(item));
        done = true;
      }
      if (done) break;
    }
    if (!done) left.push(item);
  }
  if (placed.length) log(w, `🏠 Памятные вещи расставлены по бункеру: ${placed.join(", ")}. Стало уютнее.`, "good");
  return left;
}

export function isKeepsake(item: string) {
  return !!KEEPSAKES[item];
}

const DECOR: Record<string, number> = { armchair: 6, rug: 5, lamp: 5, poster: 4, plant: 6, keepsake: 5, guitar_stand: 4, bookshelf: 4, piano: 4, drawing_wall: 3, pet_bed: 2, altar: 4, radio: 3, tape_player: 2, game_table: 3, grave: -3 };

export function computeComfort(w: World) {
  const people: Record<string, number> = {};
  for (const id in w.chars) {
    const c = w.chars[id];
    if (c.status === "dead" || c.status === "away") continue;
    const r = roomAt(w, Math.floor(c.x), c.lv);
    if (r) people[r.id] = (people[r.id] ?? 0) + 1;
  }
  for (const id in w.rooms) {
    const r = w.rooms[id];
    if (r.state !== "done") {
      r.comfort = 20;
      continue;
    }
    let v = 50 + (ROOMS[r.type]?.comfort ?? 0);
    v += r.lit ? 8 : -20;
    let decor = 0;
    for (const o of objsInRoom(w, r.id)) {
      decor += DECOR[o.kind] ?? 0;
      if (o.kind === "diesel_gen" && o.st.running) v -= 15;
      if (o.broken) v -= 4;
    }
    v += Math.min(25, decor);
    v -= r.dirt / 3;
    v -= r.flood / 2;
    v -= r.fire;
    v -= r.dmg / 5;
    const crowd = (people[r.id] ?? 0) - r.w / 2;
    if (crowd > 0) v -= crowd * 6;
    if (r.level >= 3) v += 10;
    else if (r.level >= 2) v += 5;
    if (w.flags.party_day === w.day) v += 10;
    r.comfort = clamp(v);
  }
}

onTick("comfort", "day", (w, dt) => {
  w.flags._comfT = (w.flags._comfT ?? 0) + dt;
  if (w.flags._comfT < 2) return;
  w.flags._comfT = 0;
  computeComfort(w);
});

// ---------------------------------------------------------------- crafting furniture at the workbench

defAction({
  id: "craft",
  type: "obj",
  kinds: ["workbench"],
  prio: 20,
  avail: ({ c }) => (c.hands.length ? { label: "🔨 Мастерить…", reason: "Освободите руки" } : "🔨 Мастерить мебель и вещи…"),
  dur: () => 20,
  anim: "repair",
  skill: "repair",
  xp: 5,
  start: ({ w, param }) => {
    const f = FURNITURE[String(param)];
    if (!f) return "Выберите, что мастерить";
    if (!hasRes(w, f.cost)) return missingText(w, f.cost);
    payRes(w, f.cost);
  },
  done: ({ w, c, param }) => {
    const k = String(param);
    if (!FURNITURE[k]) return;
    give(c, k, 1);
    emitWork(w, c, `${FURNITURE[k].icon} ${FURNITURE[k].name} — несите и ставьте!`, "#8fcf6a");
  },
});

// ---------------------------------------------------------------- placing things

defAction({
  id: "place",
  type: "self",
  prio: 4,
  avail: ({ w, c }) => {
    const h = c.hands.find((x) => FURNITURE[x.item] || KEEPSAKES[x.item]);
    if (!h) return null;
    const r = roomAt(w, Math.floor(c.x), c.lv);
    const label = `📌 Поставить здесь: ${ITEMS[h.item]?.icon ?? ""} ${itemName(h.item)}`;
    if (!r || r.state !== "done") return { label, reason: "Только в построенной комнате" };
    const clash = Object.values(w.objs).some((o) => o.lv === c.lv && o.x === Math.floor(c.x) && o.kind !== "ladder" && FURNITURE[h.item]?.obj !== "poster" && FURNITURE[h.item]?.obj !== "rug");
    if (clash) return { label, reason: "Здесь уже что-то стоит — отойдите" };
    return label;
  },
  dur: () => 2,
  anim: "work",
  done: ({ w, c }) => {
    const i = c.hands.findIndex((x) => FURNITURE[x.item] || KEEPSAKES[x.item]);
    if (i < 0) return;
    const h = c.hands[i];
    const r = roomAt(w, Math.floor(c.x), c.lv);
    const kind = FURNITURE[h.item]?.obj ?? KEEPSAKES[h.item];
    addObj(w, kind, Math.floor(c.x), c.lv, r?.id, KEEPSAKES[h.item] ? { item: h.item } : {});
    if (h.item === "album") w.flags.album_home = 1;
    c.hands.splice(i, 1);
    c.needs.sanity = clamp(c.needs.sanity + 4);
    log(w, `${c.card.name.split(" ")[0]} обустраивает бункер: ${itemName(h.item)}.`, "good");
  },
});

defAction({
  id: "pickup_furniture",
  type: "obj",
  kinds: ["armchair", "rug", "lamp", "poster", "plant", "keepsake", "pet_bed", "darts", "washtub", "bookshelf"],
  prio: 90,
  avail: ({ c, o }) => (c.hands.length || !o!.room ? null : `🤲 Переставить: ${o!.kind === "keepsake" ? itemName(o!.st.item) : ""}`.replace(/: $/, "")),
  dur: () => 2,
  done: ({ w, c, o }) => {
    const back = o!.kind === "keepsake" ? o!.st.item : Object.keys(FURNITURE).find((k) => FURNITURE[k].obj === o!.kind);
    if (!back) return;
    if (o!.st.item === "album") w.flags.album_home = 0;
    delete w.objs[o!.id];
    give(c, back, 1);
  },
});

// The notice board is a client screen (chores, «Вестник», archive, recipes).
defAction({
  id: "board",
  type: "obj",
  kinds: ["notice_board"],
  prio: 10,
  avail: () => "📋 Доска дел · «Вестник» · Архив",
  dur: () => 0,
  done: () => {},
});

export { costText };
