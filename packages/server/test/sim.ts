// Balance simulator: `pnpm sim --players 6 --days 10 [--seeds 5] [--storyteller classic] [--out report.md]`
// Runs whole games in-process (every resident is bot-driven, as in "aquarium"), then prints a per-day
// report of needs, resources, deaths and how the residents spent their time.
import { writeFileSync } from "node:fs";
import { addPlayer, applyCmd, createWorld, foodUnits, tickWorld, type World } from "@bunker/shared";

const args = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = args.indexOf("--" + k);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const PLAYERS = Number(arg("players", "6"));
const DAYS = Number(arg("days", "10"));
const SEEDS = Number(arg("seeds", "3"));
const TELLER = arg("storyteller", "classic");
const OUT = arg("out", "");
const DAY_LEN = Number(arg("daylen", "360"));
const INITIATIVE = arg("initiative", "1") !== "0";
const HUMAN = arg("human", "0") === "1"; // 1 = a player stays online (idle): the colony may build but never sorties on its own // 0 = residents never plan or sortie on their own

const NEEDS = ["food", "water", "energy", "sanity", "health"] as const;

interface DayRow {
  day: number;
  alive: number;
  food: number;
  water: number;
  battery: number;
  gen: number;
  demand: number;
  offShare: number;
  needsAvg: Record<string, number>;
  needsMin: Record<string, number>;
  critShare: Record<string, number>; // share of resident-time with need < 25
  acts: Record<string, number>; // resident-seconds per action
  events: string[];
  deaths: string[];
}

function runGame(seed: number) {
  const w: World = createWorld("SIM" + seed, seed, { skipPrologue: true, residents: PLAYERS, dayLength: DAY_LEN, storyteller: TELLER as any, botInitiative: INITIATIVE });
  addPlayer(w, "p0", "Сим");
  applyCmd(w, "p0", { k: "start" });
  // nobody at the keyboard: every resident is a bot
  w.players.p0.online = HUMAN;
  const rows: DayRow[] = [];
  let cur: DayRow | null = null;
  let samples = 0;
  const sum: Record<string, number> = {};
  const crit: Record<string, number> = {};
  const deathsSeen = new Set<string>();
  const startDay = w.day;
  const t0 = Date.now();
  let steps = 0;
  let pw = { n: 0, gen: 0, dem: 0, off: 0 };
  const flush = () => {
    if (!cur) return;
    for (const n of NEEDS) {
      cur.needsAvg[n] = samples ? Math.round(sum[n] / samples) : 0;
      cur.critShare[n] = samples ? Math.round((crit[n] / samples) * 100) : 0;
    }
    rows.push(cur);
  };
  while (w.day < startDay + DAYS && w.phase !== "ending") {
    if (w.phase === "night" && w.council) for (const pid in w.players) w.council.ready[pid] = true;
    if (!cur || cur.day !== w.day) {
      flush();
      cur = { day: w.day, alive: 0, food: 0, water: 0, battery: 0, gen: 0, demand: 0, offShare: 0, needsAvg: {}, needsMin: {}, critShare: {}, acts: {}, events: [], deaths: [] };
      samples = 0;
      pw = { n: 0, gen: 0, dem: 0, off: 0 };
      for (const n of NEEDS) (sum[n] = 0), (crit[n] = 0), (cur.needsMin[n] = 100);
    }
    tickWorld(w, 0.05);
    w.fx = [];
    steps++;
    if (steps % 20 === 0) {
      const alive = Object.values(w.chars).filter((c) => c.status !== "dead");
      for (const c of alive) {
        samples++;
        for (const n of NEEDS) {
          const v = c.needs[n];
          sum[n] += v;
          if (v < 25) crit[n]++;
          cur.needsMin[n] = Math.min(cur.needsMin[n], Math.round(v));
        }
        const m = c.mind;
        const a =
          c.status === "away" ? "(вылазка)" : c.status !== "ok" ? `(${c.status})` : c.task ? c.task.action : m.plan === "go" ? "(идёт) " + (m.act?.a ?? "?") : m.plan === "wander" ? "(бродит)" : "(бездельничает: " + (m.thought ?? "") + ")";
        cur.acts[a] = (cur.acts[a] ?? 0) + 1;
      }
      cur.alive = alive.length;
      cur.food = Math.round(foodUnits(w) * 10) / 10;
      cur.water = Math.round((w.res.water ?? 0) * 10) / 10;
      cur.battery = Math.round(w.power.battery * 100) / 100;
      if (w.phase === "day") {
        pw.n++;
        pw.gen += w.power.gen;
        pw.dem += w.power.demand;
        if (w.power.off.length) pw.off++;
        cur.gen = Math.round((pw.gen / pw.n) * 100) / 100;
        cur.demand = Math.round((pw.dem / pw.n) * 100) / 100;
        cur.offShare = Math.round((pw.off / pw.n) * 100);
      }
      for (const c of Object.values(w.chars))
        if (c.status === "dead" && !deathsSeen.has(c.id)) {
          deathsSeen.add(c.id);
          cur.deaths.push(`${c.card.name} (${c.deathCause ?? "?"})`);
        }
    }
    for (const h of w.history) if (h.day === w.day && cur && !cur.events.includes(h.id)) cur.events.push(h.id);
  }
  flush();
  const errs = (w.mods as any)._botErr ?? {};
  for (const [k, v] of Object.entries(errs).sort((a: any, b: any) => b[1] - a[1]).slice(0, 12)) botErr[k] = (botErr[k] ?? 0) + (v as number);
  return { rows, ending: w.phase === "ending" ? w.ending?.kind : null, secs: (Date.now() - t0) / 1000, w };
}

const botErr: Record<string, number> = {};
const lines: string[] = [];
const out = (s = "") => {
  lines.push(s);
  console.log(s);
};

out(`# Баланс${INITIATIVE ? "" : " (без инициативы жильцов: ни вылазок, ни стройки)"}${HUMAN ? " (игрок в игре, на вылазки не ходит)" : ""}: ${PLAYERS} жильцов, ${DAYS} дней, рассказчик «${TELLER}», ${SEEDS} сид(ов), день ${DAY_LEN} с`);
const agg: Record<number, { alive: number[]; needs: Record<string, number[]>; crit: Record<string, number[]>; food: number[]; water: number[] }> = {};
const actTotal: Record<string, number> = {};
let deaths = 0;
for (let s = 0; s < SEEDS; s++) {
  const seed = 1000 + s * 7919;
  const { rows, ending, secs } = runGame(seed);
  out(`\n## Сид ${seed} — ${rows.length} дней за ${secs.toFixed(1)} с${ending ? `, финал: ${ending}` : ""}`);
  out("| день | живы | еда | вода | батарея | кВт выр/потр (откл.%) | сытость | вода | бодрость | рассудок | здоровье | крит.% (е/в/б/р/з) | события | смерти |");
  out("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    const n = (k: string) => `${r.needsAvg[k]} (${r.needsMin[k]})`;
    out(`| ${r.day} | ${r.alive} | ${r.food} | ${r.water} | ${r.battery} | ${r.gen}/${r.demand} (${r.offShare}) | ${n("food")} | ${n("water")} | ${n("energy")} | ${n("sanity")} | ${n("health")} | ${NEEDS.map((k) => r.critShare[k]).join("/")} | ${r.events.join(", ")} | ${r.deaths.join(", ")} |`);
    const a = (agg[r.day] ??= { alive: [], needs: {}, crit: {}, food: [], water: [] });
    a.alive.push(r.alive);
    a.food.push(r.food);
    a.water.push(r.water);
    for (const k of NEEDS) {
      (a.needs[k] ??= []).push(r.needsAvg[k]);
      (a.crit[k] ??= []).push(r.critShare[k]);
    }
    for (const k in r.acts) actTotal[k] = (actTotal[k] ?? 0) + r.acts[k];
    deaths += r.deaths.length;
  }
}
const avg = (x: number[]) => Math.round((x.reduce((a, b) => a + b, 0) / Math.max(1, x.length)) * 10) / 10;
out("\n## Среднее по сидам");
out("| день | живы | еда | вода | сытость | вода | бодрость | рассудок | здоровье | крит.% (е/в/б/р/з) |");
out("|---|---|---|---|---|---|---|---|---|---|");
for (const d of Object.keys(agg).map(Number).sort((a, b) => a - b)) {
  const a = agg[d];
  out(`| ${d} | ${avg(a.alive)} | ${avg(a.food)} | ${avg(a.water)} | ${NEEDS.map((k) => avg(a.needs[k])).join(" | ")} | ${NEEDS.map((k) => avg(a.crit[k])).join("/")} |`);
}
out(`\nВсего смертей: ${deaths} на ${SEEDS * PLAYERS} жильцов.`);
const total = Object.values(actTotal).reduce((a, b) => a + b, 0);
out("\n## На что уходит время жильцов");
for (const [k, v] of Object.entries(actTotal).sort((a, b) => b[1] - a[1]).slice(0, 40)) out(`- ${k}: ${((v / total) * 100).toFixed(1)}%`);
out("\n## Почему боты не смогли начать дело (число отказов)");
for (const [k, v] of Object.entries(botErr).sort((a, b) => b[1] - a[1]).slice(0, 15)) out(`- ${k}: ${v}`);
if (OUT) writeFileSync(OUT, lines.join("\n") + "\n");
