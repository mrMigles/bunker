import { Rng } from "../rng";
import type { World } from "../types";
import { walkable } from "../world/grid";
import type { Cover, Door, Field } from "./combat";

/** Test arena for debug fights: two floors joined by ladders, scattered cover, a door. */
export function makeArena(seed: number, cols = 14, floors = 2): Field {
  const R = Rng.from(seed);
  const walk: boolean[] = new Array(cols * floors).fill(true);
  const covers: Cover[] = [];
  for (let i = 0; i < 6; i++) {
    const col = R.int(2, cols - 3);
    const floor = R.int(0, floors - 1);
    if (covers.some((c) => c.col === col && c.floor === floor)) continue;
    covers.push({ col, floor, kind: R.chance(0.35) ? "full" : "half", hp: 4, name: R.pick(["ящики", "стол", "мешки", "шкаф"]) });
  }
  const doors: Door[] = [{ col: Math.floor(cols / 2), floor: 0, closed: false, hp: 12 }];
  return {
    cols,
    floors,
    walk,
    ladders: floors > 1 ? [`2,1`, `${cols - 3},1`] : [],
    covers,
    doors,
    exits: [{ col: 0, floor: 0 }],
    loot: [],
    originX: 17,
    originLv: 0,
  };
}

const COVER_OBJ: Record<string, "half" | "full"> = {
  sandbags: "full",
  shelf: "full",
  dining_table: "half",
  game_table: "half",
  workbench: "half",
  bed: "half",
  stove: "half",
  battery: "half",
  water_filter: "half",
  armchair: "half",
  piano: "full",
  bookshelf: "full",
  radio_station: "half",
  med_bed: "half",
  rabbit_hutch: "half",
  hydro_tray: "half",
  diesel_gen: "full",
};

/** Builds the battlefield from the bunker cut-away: columns are grid x, floors are levels. */
export function bunkerField(w: World, entry: "airlock" | "metro" | "top"): Field {
  let minLv = 99,
    maxLv = -1;
  for (const id in w.rooms) {
    const r = w.rooms[id];
    if (r.state !== "done" && r.state !== "frame") continue;
    minLv = Math.min(minLv, r.lv);
    maxLv = Math.max(maxLv, r.lv);
  }
  if (maxLv < 0) ((minLv = 0), (maxLv = 0));
  // floor 0 is the street above the hatch; the hatch itself is a door the attackers must get through
  minLv = Math.min(minLv, 0) - 1;
  const floors = maxLv - minLv + 1;
  const cols = w.W;
  const hatch = Object.values(w.objs).find((o) => o.kind === "hatch_ladder");
  const hx = hatch?.x ?? 21;
  const walk: boolean[] = new Array(cols * floors).fill(false);
  for (let f = 0; f < floors; f++)
    for (let c = 0; c < cols; c++) {
      const lv = f + minLv;
      walk[f * cols + c] = lv < 0 ? Math.abs(c - hx) <= 3 : walkable(w, c, lv);
    }
  const ladders: string[] = [`${hx},${-minLv}`];
  for (const k in w.ladders) {
    const [x, lv] = k.split(",").map(Number);
    if (lv - minLv >= 1 && lv - minLv < floors) ladders.push(`${x},${lv - minLv}`);
  }
  const covers: Cover[] = [];
  const doors: Door[] = [];
  const loot: Field["loot"] = [];
  const blast = Object.values(w.objs).find((o) => o.kind === "door_blast");
  doors.push({ col: hx, floor: -minLv + (hatch?.lv ?? 0), closed: blast ? !!blast.st.closed : true, hp: 24 + (blast?.st.barricade ? 20 : 0), barricaded: !!blast?.st.barricade });
  for (const id in w.objs) {
    const o = w.objs[id];
    const f = o.lv - minLv;
    if (f < 0 || f >= floors) continue;
    if (COVER_OBJ[o.kind] && !covers.some((c) => c.col === o.x && c.floor === f)) covers.push({ col: o.x, floor: f, kind: COVER_OBJ[o.kind], hp: COVER_OBJ[o.kind] === "full" ? 6 : 4, name: o.kind });
    if (o.kind === "shelf") loot.push({ col: o.x, floor: f, room: o.room });
  }
  // entry point = exit for the attackers
  let exit = { col: hx + 1, floor: 0 };
  if (entry === "metro" && w.flags.metro) exit = { col: w.flags.metro_x, floor: w.flags.metro_lv - minLv };
  return { cols, floors, walk, ladders, covers, doors, exits: [exit], loot, originX: 0, originLv: minLv };
}

/** Field for an expedition location (a building section of `cols` × `floors`). */
export function locationField(seed: number, cols: number, floors: number, walkMask?: boolean[], covers: Cover[] = [], doors: Door[] = [], ladders: string[] = [], originX = 0, originLv = 0): Field {
  const walk = walkMask ?? new Array(cols * floors).fill(true);
  void seed;
  return { cols, floors, walk, ladders, covers, doors, exits: [{ col: 0, floor: floors - 1 }, { col: cols - 1, floor: floors - 1 }], loot: [], originX, originLv };
}
