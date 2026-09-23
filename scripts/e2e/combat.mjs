// XCOM-style combat, played through the UI: `node scripts/e2e/combat.mjs`
// Test arena → my turn shows blue/yellow reach → clicking a cell moves right away → clicking an enemy
// attacks right away → «Конец хода» → enemies act → repeat until the fight ends.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
mkdirSync("artifacts/e2e", { recursive: true });
const report = [];
const step = (name, ok, data = {}) => {
  report.push({ name, ok });
  console.log(`${ok ? "✔" : "✘"} ${name}`, JSON.stringify(data));
};
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const ev = (fn, arg) => page.evaluate(fn, arg);
await page.goto("http://localhost:5173");
await page.getByPlaceholder("Ваше имя").fill("Тактик");
await page.getByRole("button", { name: "Создать бункер", exact: true }).click();
await page.locator(".card").first().click();
await page.getByRole("button", { name: "⚔ Тестовая арена", exact: true }).click();
await page.waitForFunction(() => window.__game?.combat?.active && window.__game.combat.cs?.phase === "plan", null, { timeout: 20000 });
await page.waitForTimeout(800);
const reach = await ev(() => ({ n: window.__game.combat.reach.length, blue: window.__game.combat.reach.filter((r) => !r.dash).length }));
step("my turn shows reachable cells (blue + yellow)", reach.n > 0 && reach.blue > 0, reach);
await page.screenshot({ path: "artifacts/e2e/combat-turn.png" });
// move one reachable blue cell toward the enemies by clicking it
const me0 = await ev(() => window.__game.combat.myUnit());
const target = await ev(() => {
  const c = window.__game.combat, u = c.myUnit();
  const blue = c.reach.filter((r) => !r.dash && r.floor === u.floor).sort((a, b) => b.col - a.col)[0] ?? c.reach[0];
  const [x, y] = c.pos(blue.col, blue.floor);
  return { cell: blue, screen: c.site.toScreen(x, y + 0.6) };
});
await page.mouse.click(target.screen[0], target.screen[1]);
await page.waitForFunction((c0) => { const u = window.__game.combat.myUnit(); return u && (u.col !== c0 || u.ap < 3); }, me0.col, { timeout: 8000 }).catch(() => {});
const me1 = await ev(() => window.__game.combat.myUnit());
step("clicking a cell moves right away (no plan queue)", me1.col !== me0.col || me1.ap < me0.ap, { from: me0.col, to: me1.col, ap: me1.ap });
let rounds = 0;
let attacks = 0;
while (rounds < 25) {
  const st = await ev(() => { const s = window.__game.combat.cs; return s ? { phase: s.phase, result: s.result, round: s.round } : null; });
  if (!st || st.result || st.phase === "over") break;
  if (st.phase !== "plan") {
    await page.waitForTimeout(400);
    continue;
  }
  // attack the nearest enemy in reach if we can, then end the turn
  const act = await ev(() => {
    const c = window.__game.combat, s = c.cs, u = c.myUnit();
    if (!u || u.down || u.ap <= 0) return null;
    const foes = Object.values(s.units).filter((x) => x.side === "enemy" && !x.dead && !x.down && !x.fled && x.floor === u.floor).sort((a, b) => Math.abs(a.col - u.col) - Math.abs(b.col - u.col));
    return foes[0] ? { id: foes[0].id, dist: Math.abs(foes[0].col - u.col) } : null;
  });
  if (act) {
    const before = await ev((id) => window.__game.combat.cs.units[id].hp, act.id);
    await ev((a) => { const c = window.__game.combat, u = c.myUnit(); const w = window.__shared?.WEAPONS; c.tryAdd(a.dist <= 1 ? { t: "melee", target: a.id } : { t: "shoot", target: a.id }); }, act);
    await page.waitForTimeout(700);
    const after = await ev((id) => window.__game.combat.cs?.units[id]?.hp, act.id);
    if (after !== undefined && after !== before) attacks++;
  }
  await page.waitForFunction(() => !window.__game.combat.queue.length, null, { timeout: 15000 }).catch(() => {});
  const round = await ev(() => window.__game.combat.cs?.round ?? 0);
  const btn = page.locator(".combat-ready");
  if (await btn.count()) await btn.first().click().catch(() => {});
  await page.waitForFunction((r) => { const s = window.__game.combat.cs; return !s || s.round > r || s.result; }, round, { timeout: 60000 }).catch(() => {});
  rounds++;
}
const end = await ev(() => window.__net.pub.mods.lastBattle ?? { result: window.__game.combat.cs?.result });
step("attacks land immediately during my turn", attacks > 0, { attacks });
step("the fight ends", !!end?.result, { result: end?.result, rounds });
const squad = await ev(() => Object.values(window.__net.pub.chars).filter((c) => c.ctrl || c.mind).map((c) => `${c.card.name.split(" ")[0]}:${c.status}:${Math.round(c.needs.health)}`));
step("nobody died", !squad.some((s) => s.includes(":dead:")), { squad: squad.slice(0, 4) });
await page.screenshot({ path: "artifacts/e2e/combat-end.png" });
step("no page errors", !errors.length, { errors: errors.slice(0, 3) });
await browser.close();
process.exit(report.every((r) => r.ok) ? 0 : 1);
