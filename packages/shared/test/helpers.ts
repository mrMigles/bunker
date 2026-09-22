import { addPlayer, applyCmd, createWorld, foodUnits, tickWorld, type World } from "../src/index";

/** Creates a started world with `players` fake players and bots filling up to `residents`. */
export function startedWorld(opts: { seed?: number; players?: number; residents?: number; dayLength?: number } = {}): World {
  const w = createWorld("TEST1", opts.seed ?? 12345, { skipPrologue: true, residents: opts.residents ?? 6, dayLength: opts.dayLength ?? 360 });
  const n = opts.players ?? 1;
  for (let i = 0; i < n; i++) addPlayer(w, "p" + i, "Игрок" + i);
  applyCmd(w, "p0", { k: "start" });
  return w;
}

/** Runs the world for `seconds` of real time at 20 Hz. */
export function run(w: World, seconds: number, dt = 0.05) {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    tickWorld(w, dt);
    w.fx = [];
  }
}

/** Runs until the given day number starts (or maxSeconds elapse). Players are auto-ready at night. */
export function runDays(w: World, days: number, maxSeconds = 100000) {
  const target = w.day + days;
  let t = 0;
  while (w.day < target && t < maxSeconds && w.phase !== "ending") {
    if (w.phase === "night" && w.council) for (const pid in w.players) w.council.ready[pid] = true;
    tickWorld(w, 0.05);
    w.fx = [];
    t += 0.05;
  }
  return t;
}

export function summary(w: World) {
  const alive = Object.values(w.chars).filter((c) => c.status !== "dead");
  return {
    day: w.day,
    hour: Math.round(w.hour * 10) / 10,
    alive: alive.length,
    food: Math.round(foodUnits(w) * 10) / 10,
    water: Math.round((w.res.water ?? 0) * 10) / 10,
    dirty: Math.round((w.res.water_dirty ?? 0) * 10) / 10,
    battery: Math.round(w.power.battery * 100) / 100,
    co2: Math.round(w.air.co2),
    needs: alive.map((c) => `${c.card.name.split(" ")[0]}:${Math.round(c.needs.food)}/${Math.round(c.needs.water)}/${Math.round(c.needs.energy)}/${Math.round(c.needs.sanity)}/${Math.round(c.needs.health)}`).join(" "),
  };
}
