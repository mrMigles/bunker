// Smoke of the colony features: goal of the day, «Вехи», council shifts + door policy, morning card.
// node scripts/qa/features-smoke.mjs W H outdir
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
const [W, H, OUT] = [Number(process.argv[2] ?? 1440), Number(process.argv[3] ?? 900), process.argv[4] ?? "artifacts/qa-features"];
mkdirSync(OUT, { recursive: true });
const touch = W < 1000;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: W, height: H }, hasTouch: touch, isMobile: touch });
await ctx.addInitScript(() => { localStorage.setItem("bunker.tipsOff", "1"); localStorage.setItem("bunker.introSeen", "1"); localStorage.setItem("bunker.guide", '{"done":true}'); });
const p = await ctx.newPage();
p.setDefaultTimeout(60000);
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
const tap = (l) => (touch ? l.tap() : l.click());
const res = {};
await p.goto("http://localhost:5173/" + (touch ? "?mobile=1" : ""), { timeout: 90000 });
await p.getByPlaceholder("Ваше имя").fill("Фичи");
await tap(p.getByRole("button", { name: "Создать бункер", exact: true }));
await p.locator(".card").first().waitFor();
await tap(p.locator(".card").first());
res.blurb = await p.locator(".storyteller-blurb").textContent().catch(() => null);
const l = p.getByLabel("Без пролога");
if (await l.count()) await l.check().catch(() => {});
await tap(p.getByRole("button", { name: /Начать/ }).first());
await p.waitForFunction(() => window.__net?.pub?.phase === "day" && window.__net.myChar?.(), null, { timeout: 60000 });
await p.waitForTimeout(4000);
const dbg = (op, arg) => p.evaluate(([op, arg]) => window.__net.send({ k: "debug", op, arg }), [op, arg]);
res.goal = await p.evaluate(() => window.__net.pub.mods.dayGoal?.text ?? null);
res.goalInList = await p.evaluate(() => (window.__net.pub.mods.objectives ?? []).some((o) => o.kind === "goal"));
await p.screenshot({ path: `${OUT}/${W}-1-day.png` });
// «Вехи» tab
await p.evaluate(() => window.__openBoard?.("milestones"));
if (!(await p.locator(".milestone").count())) {
  await p.keyboard.press("Tab").catch(() => {});
  await p.waitForTimeout(500);
  const t = p.getByRole("button", { name: /Вехи/ });
  if (await t.count()) await tap(t.first());
}
await p.waitForTimeout(500);
res.milestoneRows = await p.locator(".milestone").count();
await p.screenshot({ path: `${OUT}/${W}-2-milestones.png` });
await p.keyboard.press("Escape").catch(() => {});
await p.evaluate(() => document.querySelector(".modal-close, .modal .close")?.click());
// night → council plan step
await dbg("night");
await p.waitForFunction(() => window.__net.pub.phase === "night" && window.__net.pub.council, null, { timeout: 30000 });
for (let i = 0; i < 40; i++) {
  const step = await p.evaluate(() => window.__net.pub.council?.step);
  if (step === "plan") break;
  await p.evaluate(() => window.__net.send({ k: "ready", v: true }));
  await p.waitForTimeout(700);
}
await p.waitForTimeout(800);
res.shiftRows = await p.locator(".shift-row").count();
res.doorButtons = await p.locator(".door-policy button").count();
const shiftBtn = p.locator(".shift-row").first().locator("button").first();
if (await shiftBtn.count()) await tap(shiftBtn);
await p.locator(".door-policy button").first().click().catch(() => {});
await p.waitForTimeout(800);
res.shifts = await p.evaluate(() => window.__net.pub.mods.shifts);
res.doorPolicy = await p.evaluate(() => window.__net.pub.settings.doorPolicy);
await p.screenshot({ path: `${OUT}/${W}-3-council.png` });
// finish the night → morning card
for (let i = 0; i < 40; i++) {
  if (await p.evaluate(() => window.__net.pub.phase === "day")) break;
  await p.evaluate(() => window.__net.send({ k: "ready", v: true }));
  await p.waitForTimeout(800);
}
await p.waitForTimeout(4000);
res.morning = await p.locator(".morning").count();
res.morningText = (await p.locator(".morning").textContent().catch(() => ""))?.slice(0, 300);
await p.screenshot({ path: `${OUT}/${W}-4-morning.png` });
res.errors = errs.slice(0, 5);
console.log(JSON.stringify(res, null, 1));
await b.close();
