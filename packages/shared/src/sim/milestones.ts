// «Вехи» (#31): a ladder of long-game goals. No strong bonuses — recognition, legacy points for everyone
// and a visible path to the endings («Дом», «Ковчег»). Checked once a game hour; each is taken once.
import type { World } from "../types";
import { objsOfKind } from "../world/rooms";
import { newsLine } from "./daygoal";
import { onTick } from "./tick";
import { fx, log } from "./util";

export interface MilestoneDef {
  id: string;
  name: string;
  /** which ending it leads to, shown as the path */
  path: "Дом" | "Ковчег" | "Выживание";
  points: number;
  check: (w: World) => boolean;
}

const doneRooms = (w: World, type?: string, level = 1) => Object.values(w.rooms).filter((r) => r.state === "done" && (!type || r.type === type) && (r.level ?? 1) >= level).length;
const alive = (w: World) => Object.values(w.chars).filter((c) => c.status !== "dead" && c.status !== "away").length;

export const MILESTONES: MilestoneDef[] = [
  { id: "first_room", name: "Первая своя комната", path: "Выживание", points: 1, check: (w) => doneRooms(w) > (w.flags._roomsAtStart ?? 99) },
  { id: "first_harvest", name: "Гидропоника даёт еду", path: "Дом", points: 1, check: (w) => (w.flags.harvests ?? 0) >= 1 },
  { id: "beds_all", name: "Койка у каждого", path: "Дом", points: 1, check: (w) => w.day >= 2 && objsOfKind(w, "bed").length + objsOfKind(w, "med_bed").length >= alive(w) },
  { id: "first_sortie", name: "Первая вылазка", path: "Выживание", points: 1, check: (w) => !!w.flags.tut_sortie },
  { id: "two_gens", name: "Два генератора", path: "Дом", points: 1, check: (w) => Object.values(w.objs).filter((o) => ["bike_gen", "diesel_gen", "thermal_gen", "solar_panel"].includes(o.kind)).length >= 2 },
  { id: "first_tech", name: "Первая технология", path: "Дом", points: 1, check: (w) => w.tech.length > (w.flags._techAtStart ?? 99) },
  { id: "first_raid", name: "Пережили первый налёт", path: "Выживание", points: 2, check: (w) => (w.director.lastRaidDay ?? 0) > 0 },
  { id: "ten_days_alive", name: "10 дней без смертей", path: "Выживание", points: 2, check: (w) => w.day - (w.flags._deathDay ?? 0) >= 10 && w.day >= 10 },
  { id: "rooms_10", name: "Десять комнат", path: "Дом", points: 2, check: (w) => doneRooms(w) >= 10 },
  { id: "radio_part", name: "Деталь дальней рации", path: "Ковчег", points: 2, check: (w) => (w.flags.radio_parts ?? 0) >= 1 },
  { id: "hydro_3", name: "Гидропоника 3-го уровня", path: "Дом", points: 2, check: (w) => doneRooms(w, "hydro", 3) >= 1 },
  { id: "living_2", name: "Жилой отсек 2-го уровня", path: "Дом", points: 2, check: (w) => doneRooms(w, "living", 2) >= 1 },
  { id: "ark_contact", name: "Связь с Ковчегом", path: "Ковчег", points: 3, check: (w) => !!w.flags.ark_contact },
  { id: "selfsuff", name: "Технология самодостаточности", path: "Дом", points: 3, check: (w) => w.tech.includes("tech_selfsuff") },
  { id: "day_30", name: "Тридцать дней под землёй", path: "Выживание", points: 3, check: (w) => w.day >= 30 },
];

/** Taken milestones: id → day. Public (in mods), shown in «Убежище», the paper and the ending. */
export function milestones(w: World): Record<string, number> {
  return ((w.mods as any).milestones ??= {});
}

onTick("milestones", "day", (w, dt) => {
  if (w.phase !== "day") return;
  // what the colony started with does not count as an achievement
  w.flags._roomsAtStart ??= Object.values(w.rooms).filter((r) => r.state === "done").length;
  w.flags._techAtStart ??= w.tech.length;
  w.flags._msT = (w.flags._msT ?? 0) + dt;
  if (w.flags._msT < 5) return;
  w.flags._msT = 0;
  const got = milestones(w);
  for (const m of MILESTONES) {
    if (got[m.id] !== undefined || !m.check(w)) continue;
    got[m.id] = w.day;
    // legacy for everyone who plays: a lost game still leaves something behind
    for (const c of Object.values(w.chars)) if (c.ctrl && c.status !== "dead") c.legacy = (c.legacy ?? 0) + m.points;
    const n = Object.keys(got).length;
    log(w, `🏅 Веха ${n}/${MILESTONES.length}: «${m.name}» (путь: ${m.path}, +${m.points} наследия).`, "good");
    fx(w, { k: "toast", text: `🏅 Веха: ${m.name}` });
    newsLine(w, `🏅 Колония достигла: «${m.name}».`);
  }
});
