// What bots alone carry in during the prologue: `npx tsx scripts/balance/prologue-probe.ts`
import { addPlayer, applyCmd, createWorld, foodUnits, tickWorld } from "../../packages/shared/src/index";
for (const seed of [1, 2, 3, 4, 5]) {
  const w = createWorld("P" + seed, seed * 977, { residents: 6 });
  addPlayer(w, "p0", "Игрок");
  applyCmd(w, "p0", { k: "start" });
  w.players.p0.online = false;
  let t = 0;
  while (w.phase === "prologue" && t < 120) {
    tickWorld(w, 0.05);
    w.fx = [];
    t += 0.05;
  }
  const n = Object.values(w.chars).filter((c) => c.status !== "dead").length;
  console.log(`seed ${seed}: people ${n}, food ${foodUnits(w).toFixed(1)} (${(foodUnits(w) / n).toFixed(1)} дн.), water ${Math.round(w.res.water ?? 0)}, meds ${w.res.meds ?? 0}, parts ${w.res.parts ?? 0}, scrap ${w.res.scrap ?? 0}`);
}
