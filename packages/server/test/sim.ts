// Balance simulator: `pnpm sim --players 6 --days 10 [--seeds 5] [--storyteller classic] [--out report.md]`
// Runs whole games in-process (every resident is bot-driven, as in "aquarium"), then prints a per-day
// report of needs, resources, deaths and how the residents spent their time.
import { writeFileSync } from "node:fs";
import { addPlayer, applyCmd, createWorld, exped, findSpot, foodDays, foodUnits, mapPath, neededRoom, newExpedition, roomAt, roomCost, ROOMS, tickWorld, wmap, type World } from "@bunker/shared";
import LOC from "../../shared/src/data/locations.json" with { type: "json" };

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
const JSON_OUT = arg("json", "");
/** stand-in for an active player: every N days send the two fittest residents on a sortie (0 = off) */
const SORTIE_EVERY = Number(arg("sortie-every", "0"));
/** idle residents closer than this (cells) on one floor count as one crowd */
const CLUMP_GAP = 0.8;
/** a resident with no task standing still this long (game seconds) is "frozen" */
const STILL_SEC = 45;
const DAY_LEN = Number(arg("daylen", "360"));
const INITIATIVE = arg("initiative", "1") !== "0";
/** 1 = the council puts two residents on the generator whenever the daytime power balance is negative (#26) */
const SHIFTS = arg("shifts", "0") === "1";
const HUMAN = arg("human", "0") === "1"; // 1 = a player stays online (idle): the colony may build but never sorties on its own // 0 = residents never plan or sortie on their own

const NEEDS = ["food", "water", "energy", "sanity", "health"] as const;

/**
 * «Active player» stand-in (--sortie-every N): in the morning of every N-th day the two fittest residents go
 * «без меня» to the nearest known place — for food when under 3 days are left, otherwise for materials.
 */
function playerSortie(w: World): string | null {
  if (exped(w) || w.mods.expedition) return null;
  const squad = Object.values(w.chars)
    .filter((c) => c.status === "ok" && !c.ctrl && c.needs.health > 60 && !c.injury)
    .sort((a, b) => b.card.stats.sil + b.card.stats.vyn - (a.card.stats.sil + a.card.stats.vyn))
    .slice(0, 2);
  if (squad.length < 2) return null;
  const want = foodDays(w) < 3 ? ["food", "seeds"] : ["fuel", "tools", "base"]; // the only location tables with scrap
  const m = wmap(w);
  const types = (LOC as any).types as Record<string, { loot: string }>;
  const nodes = Object.values(m.nodes).filter((n) => n.id !== "home" && n.known && types[n.type] && n.type !== "ark" && mapPath(m, "home", n.id, false));
  const score = (n: (typeof nodes)[number]) => (want.includes(types[n.type].loot) ? 0 : 10) + n.danger * 3 + (n.looted ?? 0) * 12 + Math.hypot(n.x - m.nodes.home.x, n.y - m.nodes.home.y) / 10;
  const target = nodes.sort((a, b) => score(a) - score(b))[0];
  if (!target) return null;
  const e = newExpedition(w);
  e.squad = squad.map((c) => c.id);
  for (const [k, n] of [["water", 2], ["food_can", 1], ["meds", 1], ["flashlight", 1]] as const) if (Math.floor(w.res[k] ?? 0) >= n + (k === "water" ? 4 : 0)) e.gear[k] = n;
  w.mods.expedition = e;
  const err = applyCmd(w, "p0", { k: "expSendBots", node: target.id } as any);
  if (err) {
    delete w.mods.expedition;
    return null;
  }
  return `${target.type}:${types[target.type].loot}`;
}

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
  /** behaviour: share of daytime samples with a crowd of 3+ idle residents, the biggest crowd, where crowds stand */
  clumpShare: number;
  clumpMax: number;
  clumpWhere: Record<string, number>;
  /** behaviour: residents frozen in place without a task for STILL_SEC+, and where */
  frozen: number;
  frozenWhere: Record<string, number>;
  /** progress */
  roomsDone: number;
  roomsPlanned: number;
  avgLevel: number;
  sorties: number;
  raids: number;
  tableGames: number;
  notice: number;
  /** what the foreman wants to build at the end of the day, and why it cannot */
  foreman: string;
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
  // behaviour and progress trackers
  let daySamples = 0;
  let clumpSamples = 0;
  const still: Record<string, { x: number; lv: number; t: number; flagged: boolean }> = {};
  const away = new Set<string>();
  let lastRaid = 0;
  const tablePlaying = new Set<string>();
  const where = (x: number, lv: number) => roomAt(w, x, lv)?.type ?? "вне комнат";
  const flush = () => {
    if (!cur) return;
    for (const n of NEEDS) {
      cur.needsAvg[n] = samples ? Math.round(sum[n] / samples) : 0;
      cur.critShare[n] = samples ? Math.round((crit[n] / samples) * 100) : 0;
    }
    cur.clumpShare = daySamples ? Math.round((clumpSamples / daySamples) * 100) : 0;
    const rooms = Object.values(w.rooms);
    cur.roomsDone = rooms.filter((r) => r.state === "done").length;
    cur.roomsPlanned = rooms.length - cur.roomsDone;
    const alive = Object.values(w.chars).filter((c) => c.status !== "dead");
    cur.avgLevel = alive.length ? Math.round((alive.reduce((a, c) => a + (c.level ?? 1), 0) / alive.length) * 10) / 10 : 0;
    cur.notice = Math.round(w.notice);
    const need = neededRoom(w);
    const building = rooms.find((r) => r.state !== "done");
    if (building) {
      const miss = building.paid ? [] : Object.entries(roomCost(building.type, building.w)).filter(([k, n]) => (w.res[k] ?? 0) < n).map(([k, n]) => `${k} ${Math.floor(w.res[k] ?? 0)}/${n}`);
      const left = Object.values(w.marks).filter((id) => id === building.id).length;
      cur.foreman = `строят ${building.type} (${building.state}${building.state === "dig" ? `, осталось клеток ${left}` : ""}${miss.length ? ", на каркас не хватает " + miss.join(", ") : ""})`;
    } else if (!need) cur.foreman = "ничего не нужно";
    else if (findSpot(w, need.type)) cur.foreman = `${need.type}: есть место и ресурсы`;
    else {
      const cost = roomCost(need.type, ROOMS[need.type]?.w[0] ?? 3);
      const miss = Object.entries(cost).filter(([k, n]) => (w.res[k] ?? 0) < n).map(([k, n]) => `${k} ${Math.floor(w.res[k] ?? 0)}/${n}`);
      cur.foreman = `${need.type}: ${miss.length ? "не хватает " + miss.join(", ") : "нет места"}`;
    }
    rows.push(cur);
  };
  while (w.day < startDay + DAYS && w.phase !== "ending") {
    if (w.phase === "night" && w.council) {
      if (SHIFTS && w.council.step === "plan" && w.flags._simShiftDay !== w.day) {
        w.flags._simShiftDay = w.day;
        const s = ((w.mods as any).shifts ??= { gen: [], pump: [] });
        const short = (w.flags._demAvg ?? w.power.demand) > w.power.gen + 0.05;
        if (short && s.gen.length < 2) {
          const fit = Object.values(w.chars).filter((c) => c.status === "ok" && !s.gen.includes(c.id)).sort((a, b) => b.needs.energy - a.needs.energy);
          for (const c of fit.slice(0, 2 - s.gen.length)) applyCmd(w, "p0", { k: "shift", char: c.id, job: "gen" } as any);
        }
      }
      for (const pid in w.players) w.council.ready[pid] = true;
    }
    if (!cur || cur.day !== w.day) {
      flush();
      cur = {
        day: w.day, alive: 0, food: 0, water: 0, battery: 0, gen: 0, demand: 0, offShare: 0, needsAvg: {}, needsMin: {}, critShare: {}, acts: {}, events: [], deaths: [],
        clumpShare: 0, clumpMax: 0, clumpWhere: {}, frozen: 0, frozenWhere: {}, roomsDone: 0, roomsPlanned: 0, avgLevel: 0, sorties: 0, raids: 0, tableGames: 0, notice: 0, foreman: "",
      };
      samples = 0;
      daySamples = 0;
      clumpSamples = 0;
      pw = { n: 0, gen: 0, dem: 0, off: 0 };
      for (const n of NEEDS) (sum[n] = 0), (crit[n] = 0), (cur.needsMin[n] = 100);
    }
    if (SORTIE_EVERY > 0 && w.phase === "day" && w.hour >= 8 && w.hour < 11 && (w.day - startDay) % SORTIE_EVERY === 0 && w.flags._simSortieDay !== w.day) {
      const went = playerSortie(w);
      if (went) {
        w.flags._simSortieDay = w.day;
        cur.events.push("🎒" + went);
      }
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
      // crowds: idle residents (no task) standing within CLUMP_GAP of each other on one floor, daytime only
      if (w.phase === "day") {
        daySamples++;
        const loose = alive.filter((c) => c.status === "ok" && c.lv >= 0 && !c.task).sort((a, b) => a.lv - b.lv || a.x - b.x);
        let run: typeof loose = [];
        let biggest: typeof loose = [];
        for (const c of loose) {
          const prev = run[run.length - 1];
          if (prev && prev.lv === c.lv && c.x - prev.x <= CLUMP_GAP) run.push(c);
          else run = [c];
          if (run.length > biggest.length) biggest = [...run];
        }
        if (biggest.length >= 3) {
          clumpSamples++;
          const k = where(biggest[0].x, biggest[0].lv);
          cur.clumpWhere[k] = (cur.clumpWhere[k] ?? 0) + 1;
        }
        cur.clumpMax = Math.max(cur.clumpMax, biggest.length);
        // frozen: no task and not moving for STILL_SEC game seconds (one sample ≈ 1 s)
        for (const c of alive) {
          const s = (still[c.id] ??= { x: c.x, lv: c.lv, t: 0, flagged: false });
          if (c.status === "ok" && !c.task && Math.abs(c.x - s.x) < 0.05 && c.lv === s.lv) {
            s.t += 20 * 0.05;
            if (s.t >= STILL_SEC && !s.flagged) {
              s.flagged = true;
              cur.frozen++;
              const k = `${where(c.x, c.lv)}: ${c.mind.plan}${c.mind.thought ? " · " + c.mind.thought : ""}`;
              cur.frozenWhere[k] = (cur.frozenWhere[k] ?? 0) + 1;
            }
          } else Object.assign(s, { x: c.x, lv: c.lv, t: 0, flagged: false });
        }
      }
      // sorties (a resident leaving), raids (a bunker battle starting), table games (a table starting to play)
      for (const c of Object.values(w.chars)) {
        if (c.status === "away" && !away.has(c.id)) {
          away.add(c.id);
          cur.sorties++;
        } else if (c.status !== "away") away.delete(c.id);
      }
      // a raid on an unattended bunker may start and end between two samples: count the director's record
      if ((w.director.lastRaidDay ?? 0) > lastRaid) {
        lastRaid = w.director.lastRaidDay;
        cur.raids++;
      }
      for (const [id, t] of Object.entries((w.mods.tables ?? {}) as Record<string, { status: string }>)) {
        if (t.status === "playing" && !tablePlaying.has(id)) {
          tablePlaying.add(id);
          cur.tableGames++;
        } else if (t.status !== "playing") tablePlaying.delete(id);
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

out(`# Баланс${INITIATIVE ? "" : " (без инициативы жильцов: ни вылазок, ни стройки)"}${HUMAN ? " (игрок в игре, на вылазки не ходит)" : ""}${SORTIE_EVERY ? ` (игрок отправляет двоих «без меня» каждые ${SORTIE_EVERY} дн.)` : ""}: ${PLAYERS} жильцов, ${DAYS} дней, рассказчик «${TELLER}», ${SEEDS} сид(ов), день ${DAY_LEN} с`);
const agg: Record<number, { alive: number[]; needs: Record<string, number[]>; crit: Record<string, number[]>; food: number[]; water: number[]; extra: Record<string, number[]> }> = {};
const clumpWhereTotal: Record<string, number> = {};
const frozenWhereTotal: Record<string, number> = {};
const runs: { seed: number; ending: string | null | undefined; firstDeathDay: number | null; rows: DayRow[] }[] = [];
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
    const a = (agg[r.day] ??= { alive: [], needs: {}, crit: {}, food: [], water: [], extra: {} });
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
  out("\n| день | толпа 3+ (% дня) | макс. толпа | где толпятся | застыли | где застыли | комнат (+в работе) | ср. уровень | ушли на вылазки (чел.) | налёты | партии за столом | заметность | бригадир хочет |");
  out("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  const top = (m: Record<string, number>, n = 3) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} ×${v}`).join("; ");
  for (const r of rows) {
    out(`| ${r.day} | ${r.clumpShare} | ${r.clumpMax} | ${top(r.clumpWhere)} | ${r.frozen} | ${top(r.frozenWhere, 2)} | ${r.roomsDone} (+${r.roomsPlanned}) | ${r.avgLevel} | ${r.sorties} | ${r.raids} | ${r.tableGames} | ${r.notice} | ${r.foreman} |`);
    const a = agg[r.day];
    for (const [k, v] of Object.entries({ clump: r.clumpShare, frozen: r.frozen, rooms: r.roomsDone, level: r.avgLevel, sorties: r.sorties, raids: r.raids, tables: r.tableGames, notice: r.notice })) (a.extra[k] ??= []).push(v);
    for (const [k, v] of Object.entries(r.clumpWhere)) clumpWhereTotal[k] = (clumpWhereTotal[k] ?? 0) + v;
    for (const [k, v] of Object.entries(r.frozenWhere)) frozenWhereTotal[k] = (frozenWhereTotal[k] ?? 0) + v;
  }
  runs.push({ seed, ending, firstDeathDay: rows.find((r) => r.deaths.length)?.day ?? null, rows });
}
const avg = (x: number[]) => Math.round((x.reduce((a, b) => a + b, 0) / Math.max(1, x.length)) * 10) / 10;
out("\n## Среднее по сидам");
out("| день | живы | еда | вода | сытость | вода | бодрость | рассудок | здоровье | крит.% (е/в/б/р/з) |");
out("|---|---|---|---|---|---|---|---|---|---|");
for (const d of Object.keys(agg).map(Number).sort((a, b) => a - b)) {
  const a = agg[d];
  out(`| ${d} | ${avg(a.alive)} | ${avg(a.food)} | ${avg(a.water)} | ${NEEDS.map((k) => avg(a.needs[k])).join(" | ")} | ${NEEDS.map((k) => avg(a.crit[k])).join("/")} |`);
}
out("\n## Поведение и прогресс, среднее по сидам");
out("| день | толпа 3+ (% дня) | застыли | комнат | ср. уровень | ушли на вылазки (чел.) | налёты | партии за столом | заметность |");
out("|---|---|---|---|---|---|---|---|---|");
for (const d of Object.keys(agg).map(Number).sort((a, b) => a - b)) {
  const e = agg[d].extra;
  out(`| ${d} | ${["clump", "frozen", "rooms", "level", "sorties", "raids", "tables", "notice"].map((k) => avg(e[k] ?? [])).join(" | ")} |`);
}
out("\nГде толпятся (сэмплы с толпой 3+): " + (Object.entries(clumpWhereTotal).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ×${v}`).join("; ") || "нигде"));
out("\nКто и где застывает (эпизоды): " + (Object.entries(frozenWhereTotal).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k} ×${v}`).join("; ") || "никто"));
out(`\nФиналы: ${runs.map((r) => `${r.seed}: ${r.ending ?? "—"}${r.firstDeathDay ? ` (первая смерть в день ${r.firstDeathDay})` : ""}`).join(", ")}`);
out(`\nВсего смертей: ${deaths} на ${SEEDS * PLAYERS} жильцов.`);
const total = Object.values(actTotal).reduce((a, b) => a + b, 0);
out("\n## На что уходит время жильцов");
for (const [k, v] of Object.entries(actTotal).sort((a, b) => b[1] - a[1]).slice(0, 40)) out(`- ${k}: ${((v / total) * 100).toFixed(1)}%`);
out("\n## Почему боты не смогли начать дело (число отказов)");
for (const [k, v] of Object.entries(botErr).sort((a, b) => b[1] - a[1]).slice(0, 15)) out(`- ${k}: ${v}`);
if (OUT) writeFileSync(OUT, lines.join("\n") + "\n");
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ config: { PLAYERS, DAYS, SEEDS, TELLER, DAY_LEN, INITIATIVE, HUMAN }, deaths, botErr, clumpWhereTotal, frozenWhereTotal, runs }, null, 1));
