import { BAL } from "../data/balance";
import { OBJECTS } from "../data/objects";
import type { Obj, RoomInst, World } from "../types";
import { ROOMS, objsOfKind, roomAt } from "../world/rooms";
import { killChar, knockDown } from "./needs";
import { onTick } from "./tick";
import { timeMult } from "./time";
import { clamp, fx, hoursPerSec, log, rng } from "./util";

// ---------------------------------------------------------------- power

export const GROUP_NAMES: Record<string, string> = {
  air: "Фильтр воздуха",
  water: "Водоочистка",
  hydro: "Гидропоника",
  light: "Свет",
  kitchen: "Кухня",
  radio: "Радио",
  defense: "Оборона",
  work: "Мастерские",
  comfort: "Комфорт",
};

function occupied(w: World, r: RoomInst) {
  for (const id in w.chars) {
    const c = w.chars[id];
    if (c.status !== "dead" && c.status !== "away" && c.lv === r.lv && c.x >= r.x && c.x < r.x + r.w) return true;
  }
  return false;
}

/** Demand per power group in kW. */
export function powerDemand(w: World): Record<string, number> {
  const d: Record<string, number> = {};
  const add = (g: string, kw: number) => (d[g] = (d[g] ?? 0) + kw);
  for (const id in w.rooms) {
    const r = w.rooms[id];
    if (r.state !== "done") continue;
    const def = ROOMS[r.type];
    if (def?.light && w.phase === "day" && (occupied(w, r) || r.type === "hydro")) add("light", BAL.lightKwPerRoom);
    if (def?.power) add("work", def.power);
  }
  for (const id in w.objs) {
    const o = w.objs[id];
    if (o.broken || !o.on) continue;
    switch (o.kind) {
      case "air_filter":
        add("air", BAL.airFilterKw);
        break;
      case "water_filter":
        if ((w.res.water_dirty ?? 0) > 0.05) add("water", BAL.waterFilterKw);
        break;
      case "hydro_tray":
        if (o.st.crop && lampHours(w)) add("hydro", BAL.hydroKw / 3);
        break;
      case "stove":
        if (o.st.cooking) add("kitchen", BAL.stoveKw);
        break;
      case "kettle":
        if (o.st.boil) add("kitchen", 0.1);
        break;
      case "radio":
        if (w.radio.on) add("radio", 0.05);
        break;
      case "radio_station":
        if (w.mods.expedition) add("radio", BAL.radioKw);
        break;
      case "turret":
        add("defense", BAL.turretKw);
        break;
      case "shower":
        if (o.st.running) add("comfort", BAL.showerKw);
        break;
      case "projector":
        if (o.st.running) add("comfort", 0.2);
        break;
      case "chem_bench":
        if (o.st.busy) add("work", 0.1);
        break;
    }
  }
  return d;
}

/** Grow lamps follow an 18h photoperiod: on during the whole day phase. */
export function lampHours(w: World) {
  return w.phase === "day";
}

export function generation(w: World): number {
  let g = 0;
  for (const id in w.objs) {
    const o = w.objs[id];
    if (o.broken) continue;
    switch (o.kind) {
      case "bike_gen":
        if (o.st.rider) g += BAL.bikeKw * (o.st.oil > 30 ? 1 : 0.6) * (o.wear > 20 ? 1 : 0.7);
        break;
      case "diesel_gen":
        if (o.on && o.st.running && (w.res.fuel ?? 0) > 0) g += BAL.dieselKw;
        break;
      case "thermal_gen":
        g += BAL.thermalKw;
        break;
      case "solar_panel":
        if (w.weather.today !== "storm" && w.weather.today !== "ash") g += BAL.solarKw;
        else g += BAL.solarKw * 0.3;
        break;
    }
  }
  return g;
}

export function batteryCap(w: World) {
  const perBank = BAL.batteryCapPerBank * (w.tech.includes("tech_battery2") ? 1.5 : 1);
  return BAL.batteryCap * (w.tech.includes("tech_battery2") ? 1.5 : 1) + Math.max(0, objsOfKind(w, "battery").filter((b) => !b.broken).length - 1) * perBank;
}

/** Advances the power grid by `hours`. Returns the set of groups that are powered. */
export function stepPower(w: World, hours: number) {
  const p = w.power;
  p.cap = batteryCap(w);
  const demand = powerDemand(w);
  const gen = generation(w);
  let total = 0;
  for (const k in demand) total += demand[k];
  p.demand = total;
  p.gen = gen;
  // how much can we supply this step
  let avail = gen + (p.battery > 0 ? p.battery / Math.max(hours, 1e-6) : 0);
  const off: string[] = [];
  let used = 0;
  for (const g of p.prio) {
    const need = demand[g] ?? 0;
    if (need <= 0) continue;
    if (avail + 1e-9 >= need) {
      avail -= need;
      used += need;
    } else off.push(g);
  }
  for (const g in demand) if (!p.prio.includes(g) && demand[g] > 0) off.push(g);
  p.use = used;
  p.off = off;
  p.battery = clamp(p.battery + (gen - used) * hours, 0, p.cap);
  // diesel consumes fuel and makes noise
  for (const o of objsOfKind(w, "diesel_gen")) {
    if (o.on && o.st.running && !o.broken && (w.res.fuel ?? 0) > 0) {
      w.res.fuel = Math.max(0, (w.res.fuel ?? 0) - BAL.dieselFuelPerHour * hours);
      w.notice = clamp(w.notice + (OBJECTS.diesel_gen.noise ?? 0) * hours);
    }
  }
  // room lighting state
  for (const id in w.rooms) {
    const r = w.rooms[id];
    const def = ROOMS[r.type];
    r.lit = !!def?.light && r.state === "done" && !off.includes("light") && r.fire < 80;
  }
}

export function powered(w: World, group: string | undefined) {
  if (!group) return true;
  return !w.power.off.includes(group);
}

// ---------------------------------------------------------------- machines

function isRunning(w: World, o: Obj): boolean {
  if (o.broken || !o.on) return false;
  const def = OBJECTS[o.kind];
  switch (o.kind) {
    case "bike_gen":
      return !!o.st.rider;
    case "diesel_gen":
      return !!o.st.running && (w.res.fuel ?? 0) > 0;
    case "water_filter":
      return powered(w, def.group) && (w.res.water_dirty ?? 0) > 0.05;
    case "hydro_tray":
      return !!o.st.crop && powered(w, "hydro");
    default:
      return def?.group ? powered(w, def.group) : false;
  }
}

export function stepMachines(w: World, hours: number, realDt: number) {
  const st = BAL.storyteller[w.settings.storyteller] ?? BAL.storyteller.classic;
  const r = rng(w);
  let filterOk = false;
  let filterEff = 0;
  for (const id in w.objs) {
    const o = w.objs[id];
    const running = isRunning(w, o);
    o.st.running_ = running ? 1 : 0;
    if (running) {
      const wr = BAL.wearPerHour[o.kind] ?? OBJECTS[o.kind]?.wear ?? 0;
      if (wr > 0) {
        o.wear = Math.max(0, o.wear - wr * hours * st.breakMult);
        if (o.wear <= 0 && !o.broken) breakObj(w, o, r.chance(BAL.fireChanceOnBreak));
      }
    }
    switch (o.kind) {
      case "air_filter":
        if (running) {
          o.st.dirt = clamp((o.st.dirt ?? 0) + 3.5 * hours * (w.tech.includes("tech_filters2") ? 0.6 : 1));
          filterOk = true;
          filterEff = Math.max(filterEff, 1 - (o.st.dirt ?? 0) / 130);
        }
        break;
      case "water_filter":
        if (running) {
          o.st.dirt = clamp((o.st.dirt ?? 0) + 4 * hours * (w.tech.includes("tech_filters2") ? 0.6 : 1));
          const eff = (1 - (o.st.dirt ?? 0) / 120) * (w.tech.includes("tech_water2") ? 1.5 : 1);
          const amount = Math.min(w.res.water_dirty ?? 0, BAL.waterFilterPerHour * eff * hours);
          w.res.water_dirty = (w.res.water_dirty ?? 0) - amount;
          w.res.water = (w.res.water ?? 0) + amount;
        }
        break;
      case "bike_gen":
        if (running) o.st.oil = clamp((o.st.oil ?? 100) - 5 * hours);
        break;
      case "stream":
        // underground stream: free dirty water
        w.res.water_dirty = (w.res.water_dirty ?? 0) + 1.5 * hours;
        break;
    }
  }
  // CO2
  const people = Object.values(w.chars).filter((c) => c.status !== "dead" && c.status !== "away").length;
  if (filterOk && filterEff > 0.2) {
    w.air.filterOffT = 0;
    const net = BAL.co2FallPerHour * filterEff - people * 1.5;
    w.air.co2 = clamp(w.air.co2 - net * hours);
  } else {
    w.air.filterOffT += realDt;
    if (w.air.filterOffT > BAL.airFilterGraceSeconds || realDt === 0) w.air.co2 = clamp(w.air.co2 + BAL.co2RisePerHour * (people / 6) * hours);
  }
}

export function breakObj(w: World, o: Obj, fire: boolean) {
  o.broken = true;
  o.wear = 0;
  const name = OBJECTS[o.kind]?.name ?? o.kind;
  log(w, `💥 Сломалось: ${name}!`, "bad");
  fx(w, { k: "sound", id: "break", x: o.x, lv: o.lv });
  fx(w, { k: "float", x: o.x + 0.5, lv: o.lv, text: "💥 поломка", color: "#ff8a6a" });
  if (o.kind === "bike_gen" && o.st.rider) {
    const c = w.chars[o.st.rider];
    if (c) c.task = null;
    o.st.rider = undefined;
  }
  if (fire && o.room) {
    const room = w.rooms[o.room];
    if (room) igniteRoom(w, room);
  }
}

export function igniteRoom(w: World, room: RoomInst, amount = 25) {
  if (room.fire <= 0) {
    log(w, `🔥 Пожар: ${ROOMS[room.type]?.name ?? room.type}!`, "bad");
    fx(w, { k: "toast", text: `🔥 Пожар: ${ROOMS[room.type]?.name}` });
    fx(w, { k: "sound", id: "alarm" });
  }
  room.fire = clamp(room.fire + amount);
}

export function stepFire(w: World, hours: number) {
  const r = rng(w);
  for (const id in w.rooms) {
    const room = w.rooms[id];
    if (room.fire <= 0) continue;
    room.fire = clamp(room.fire + 18 * hours);
    // damage objects and people inside
    for (const oid in w.objs) {
      const o = w.objs[oid];
      if (o.room === room.id && !o.broken) {
        o.wear = Math.max(0, o.wear - room.fire * 0.4 * hours);
        if (o.wear <= 0 && OBJECTS[o.kind]?.group) breakObj(w, o, false);
      }
    }
    for (const cid in w.chars) {
      const c = w.chars[cid];
      if (c.status === "dead" || c.lv !== room.lv || c.x < room.x || c.x > room.x + room.w) continue;
      c.needs.health = clamp(c.needs.health - room.fire * 0.5 * hours);
      if (c.needs.health <= 0 && c.status === "ok") knockDown(w, c, "ожоги");
      else if (c.needs.health <= 0 && c.status === "down") killChar(w, c, "сгорел(а)");
    }
    // flammable resources in storage rooms
    if (room.type === "storage" && room.fire > 50) {
      for (const k of ["wood", "cloth", "food_can"]) if ((w.res[k] ?? 0) > 0 && r.chance(0.2 * hours)) w.res[k] = Math.max(0, w.res[k] - 1);
    }
    // spread
    if (room.fire > 60 && r.chance(BAL.fireSpreadPerHour * hours)) {
      const nb = [roomAt(w, room.x - 1, room.lv), roomAt(w, room.x + room.w, room.lv), roomAt(w, room.x, room.lv - 1), roomAt(w, room.x, room.lv + 1)].filter((x) => x && x.fire <= 0 && x.state === "done");
      if (nb.length) igniteRoom(w, r.pick(nb)!, 15);
    }
    // burns out
    if (room.fire >= 100) {
      room.dmg = clamp(room.dmg + 20 * hours);
      if (r.chance(0.3 * hours)) {
        room.fire = 0;
        log(w, `Огонь в ${ROOMS[room.type]?.name ?? ""} выгорел сам, оставив копоть.`, "info");
        room.dirt = clamp(room.dirt + 50);
      }
    }
  }
  // fire makes noise & smoke
}

onTick("systems", "day", (w, dt) => {
  const hours = dt * hoursPerSec(w) * timeMult(w);
  stepPower(w, hours);
  stepMachines(w, hours, dt);
  stepFire(w, hours);
});
