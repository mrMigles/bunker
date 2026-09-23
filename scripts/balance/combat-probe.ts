// Win/death rates of bot squads against typical encounters: `npx tsx scripts/balance/combat-probe.ts`
import { battle, departExpedition, newExpedition, roadFight, tickWorld, type World } from "../../packages/shared/src/index";
import { startedWorld } from "../../packages/shared/test/helpers";

const SCEN: [string, string[]][] = [
  ["2 собаки", ["dog", "dog"]],
  ["крысы+собака", ["rat", "rat", "dog"]],
  ["мародёр", ["marauder"]],
  ["мародёр+налётчик", ["marauder", "raider"]],
  ["налётчик+мародёр×2", ["raider", "marauder", "marauder"]],
];
const WEAPON = process.argv[2] ?? "knife"; // "none" = fists
const kit = (w: World, e: any) => {
  for (const k of ["knife", "pipe", "pistol", "rifle", "shotgun", "crowbar"]) w.res[k] = 0;
  if (WEAPON !== "none") w.res[WEAPON] = 3;
  for (const [k, n] of [["meds", 1], ["water", 2], ["food_can", 1]] as const) e.gear[k] = n;
};
for (const size of [1, 2, 3])
  for (const [name, foes] of SCEN) {
    let wins = 0, deaths = 0, hp = 0, rounds = 0;
    const N = 20;
    for (let s = 0; s < N; s++) {
      const w = startedWorld({ players: 1, seed: 500 + s * 31 });
      w.players.p0.online = false;
      const e = newExpedition(w);
      e.squad = Object.values(w.chars).slice(0, size).map((c) => c.id);
      kit(w, e);
      w.mods.expedition = e;
      departExpedition(w, e);
      roadFight(w, e, foes);
      let t = 0;
      while (battle(w) && t < 600) {
        tickWorld(w, 0.05);
        w.fx = [];
        t += 0.05;
      }
      const sq = e.squad.map((id) => w.chars[id]);
      const b = (w.mods as any).lastBattle;
      const dead = sq.filter((c) => c.status === "dead").length;
      deaths += dead;
      if (dead === 0 && sq.every((c) => c.needs.health > 5)) wins++;
      hp += sq.reduce((a, c) => a + (c.status === "dead" ? 0 : c.needs.health), 0) / size;
      rounds += t;
    }
    console.log(`отряд ${size} vs ${name.padEnd(20)} победы ${Math.round((wins / N) * 100)}%  смертей ${deaths}/${N * size}  ср.здоровье ${Math.round(hp / N)}  ~${Math.round(rounds / N)}с`);
  }
