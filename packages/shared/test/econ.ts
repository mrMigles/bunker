// Detailed economy trace: `npx tsx packages/shared/test/econ.ts`
import { foodUnits, tickWorld } from "../src/index";
import { startedWorld } from "./helpers";

const w = startedWorld({ players: 1 });
let lastH = -1;
const acts: Record<string, number> = {};
for (let i = 0; i < 20 * 60 * 25; i++) {
  if (w.phase === "night" && w.council) for (const pid in w.players) w.council.ready[pid] = true;
  tickWorld(w, 0.05);
  w.fx = [];
  for (const c of Object.values(w.chars)) if (c.task) acts[c.task.action] = (acts[c.task.action] ?? 0) + 0.05;
  const h = Math.floor(w.hour / 2);
  if (w.phase === "day" && h !== lastH) {
    lastH = h;
    const air = Object.values(w.objs).find((o) => o.kind === "air_filter")!;
    const wf = Object.values(w.objs).find((o) => o.kind === "water_filter")!;
    console.log(
      `d${w.day} ${w.hour.toFixed(1)}h food=${foodUnits(w).toFixed(1)} water=${(w.res.water ?? 0).toFixed(1)} dirty=${(w.res.water_dirty ?? 0).toFixed(1)} bat=${w.power.battery.toFixed(2)} gen=${w.power.gen.toFixed(2)} dem=${w.power.demand.toFixed(2)} off=${w.power.off.join(",")} co2=${w.air.co2.toFixed(0)} airDirt=${air.st.dirt?.toFixed(0)} wfDirt=${wf.st.dirt?.toFixed(0)} broken=${Object.values(w.objs).filter((o) => o.broken).map((o) => o.kind).join(",")}`,
    );
    const top = Object.entries(acts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([k, v]) => `${k}:${Math.round(v)}`)
      .join(" ");
    console.log("   acts:", top);
    for (const k in acts) delete acts[k];
  }
  if (w.day > 4) break;
}
