// Quick manual smoke run: `npx tsx packages/shared/test/smoke.ts [idle]`
import { runDays, startedWorld, summary } from "./helpers";

const idle = process.argv.includes("idle");
const w = startedWorld({ players: 1, dayLength: 360 });
if (idle) {
  // nobody works: mark every character as player-controlled so bots don't act
  for (const c of Object.values(w.chars)) c.ctrl = "p0";
}
console.log("start", summary(w));
for (let d = 0; d < 6; d++) {
  runDays(w, 1);
  console.log(summary(w));
  const plans: Record<string, number> = {};
  for (const c of Object.values(w.chars)) plans[c.mind.thought] = (plans[c.mind.thought] ?? 0) + 1;
  if (!idle) console.log("  thoughts:", JSON.stringify(plans), "chores:", Object.keys(w.chores).length);
  if (Object.values(w.chars).every((c) => c.status === "dead")) break;
}
console.log(w.log.slice(-15).map((l) => `[${l.day}] ${l.text}`).join("\n"));
