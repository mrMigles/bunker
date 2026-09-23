// Odds of residents sent without a player: `npx tsx scripts/balance/bot-sortie-probe.ts`
import { applyCmd, objsOfKind, startAction, tickWorld, wmap, type World } from "../../packages/shared/src/index";
import { startedWorld } from "../../packages/shared/test/helpers";

function once(seed: number, size: number, danger: number) {
  const w: World = startedWorld({ players: 1, seed });
  const me = w.chars[w.players.p0.char!];
  const term = objsOfKind(w, "sortie_terminal")[0];
  me.x = term.x + 0.5; me.lv = term.lv; me.y = term.lv * 2 + 2;
  startAction(w, me, "sortie", { type: "obj", id: term.id });
  const e = w.mods.expedition;
  e.squad = e.squad.filter((id: string) => id !== me.id);
  for (const c of Object.values(w.chars)) if (e.squad.length < size && c.id !== me.id && !e.squad.includes(c.id)) e.squad.push(c.id);
  e.squad = e.squad.slice(0, size);
  const m = wmap(w);
  const node = Object.values(m.nodes).find((n) => n.known && n.id !== "home" && !["trader", "camp"].includes(n.type) && n.danger === danger);
  if (!node) return null;
  node.looted = 0;
  const err = applyCmd(w, "p0", { k: "expSendBots", node: node.id });
  if (err) return null;
  for (let t = 0; t < 600 && w.mods.expedition; t += 0.05) {
    if (w.phase === "night" && w.council) for (const p in w.players) w.council.ready[p] = true;
    tickWorld(w, 0.05); w.fx = [];
  }
  const r = (w.mods._autoReports ?? [])[0];
  const dead = Object.values(w.chars).filter((c) => c.status === "dead").length;
  return r ? { outcome: r.outcome, dead } : null;
}
for (const size of [2, 3])
  for (const danger of [1, 2, 3]) {
    const tally: Record<string, number> = { clean: 0, rough: 0, rout: 0 };
    let n = 0, dead = 0;
    for (let s = 0; s < 40 && n < 20; s++) {
      const r = once(3000 + s * 17 + danger, size, danger);
      if (!r) continue;
      n++; tally[r.outcome]++; dead += r.dead;
    }
    console.log(`${size} жильца, опасность ${danger}: ${n} вылазок — чисто ${Math.round(tally.clean / Math.max(1, n) * 100)}%, тяжело ${Math.round(tally.rough / Math.max(1, n) * 100)}%, провал ${Math.round(tally.rout / Math.max(1, n) * 100)}%, погибло ${dead}`);
  }
