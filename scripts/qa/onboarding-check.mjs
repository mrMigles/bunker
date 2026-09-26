// #43 targeted checks: a second player reading «Как играть» holds the start; the prologue lesson
// goes take → carry → done; the first-day guide closes a step when the player pedals.
import { chromium } from "@playwright/test";
const b = await chromium.launch();
const mk = async () => {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await ctx.newPage();
  p.setDefaultTimeout(60000);
  return p;
};
const res = {};
const until = async (p, fn, ms = 30000, arg) => p.waitForFunction(fn, arg, { timeout: ms, polling: 250 }).then(() => true).catch(() => false);
const A = await mk();
await A.goto("http://localhost:5173/", { timeout: 90000 });
await A.getByPlaceholder("Ваше имя").fill("Хост");
await A.getByRole("button", { name: "Создать бункер", exact: true }).click();
await A.locator(".card").first().click();
await A.locator(".intro").waitFor({ timeout: 10000 });
await A.getByRole("button", { name: "Пропустить" }).click();
const code = await A.evaluate(() => window.__net.code);
const B = await mk();
await B.goto("http://localhost:5173/", { timeout: 90000 });
await B.getByPlaceholder("Ваше имя").fill("Гость");
await B.locator(".code-field input").fill(code);
await B.getByRole("button", { name: "Войти по коду" }).click();
await B.locator(".card").first().click();
await B.locator(".intro").waitFor({ timeout: 10000 }).catch(() => {});
res.guestSeesIntro = await B.locator(".intro").count();
res.hostSeesReading = await until(A, () => Object.values(window.__net.pub.players).some((x) => x.reading), 10000);
res.readerChip = await A.locator(".pchip", { hasText: "читает" }).count();
await A.getByRole("button", { name: /Начать/ }).first().click();
await A.waitForTimeout(1500);
res.startHeld = await A.evaluate(() => window.__net.pub.phase === "lobby");
await B.getByRole("button", { name: "Пропустить" }).click();
res.readingCleared = await until(A, () => !Object.values(window.__net.pub.players).some((x) => x.reading), 10000);
await A.getByRole("button", { name: /Начать/ }).first().click();
res.started = await until(A, () => window.__net.pub.phase === "prologue", 30000);
await B.close();
// the prologue lesson
await until(A, () => window.__game?.pro?.active, 30000);
await A.waitForTimeout(1500);
res.step1 = await A.locator(".pro-step").textContent().catch(() => null);
// take the nearest supply: walk with the key toward it, then E
const took = await (async () => {
  for (let k = 0; k < 40; k++) {
    const st = await A.evaluate(() => {
      const pr = window.__net.pub.mods.prologue, c = window.__net.myChar();
      if (c.hands?.length) return "hold";
      const it = pr.items.filter((i) => !i.by && i.lv === c.lv).sort((a, b) => Math.abs(a.x - c.x) - Math.abs(b.x - c.x))[0];
      if (!it) return "none";
      return Math.abs(it.x - c.x) < 0.8 ? "near" : it.x > c.x ? "right" : "left";
    });
    if (st === "hold") return true;
    if (st === "near") await A.keyboard.press("KeyE");
    else if (st === "right" || st === "left") { const key = st === "right" ? "KeyD" : "KeyA"; await A.keyboard.down(key); await A.waitForTimeout(300); await A.keyboard.up(key); }
    await A.waitForTimeout(250);
  }
  return false;
})();
res.took = took;
res.step2 = await A.locator(".pro-step").textContent().catch(() => null);
res.hatchGlows = await A.locator(".hatch-marker.hint").count();
await A.keyboard.press("Space");
res.delivered = await until(A, () => { const pr = window.__net.pub.mods.prologue, id = window.__net.myChar()?.id; return (pr?.by?.[id]?.length ?? 0) > 0; }, 40000);
res.step3 = await A.locator(".pro-step").textContent().catch(() => null);
// the first day
res.day = await until(A, () => window.__net.pub.phase === "day", 120000);
await A.waitForTimeout(3000);
for (let i = 0; i < 3; i++) await A.keyboard.press("Escape");
res.guideStep = await A.locator(".first-day:not(.hidden) .fd-head").textContent().catch(() => null);
await A.locator(".first-day button", { hasText: "Показать где" }).click().catch(() => {});
res.reachedBike = await until(A, () => { const v = window.__net.pub, c = window.__net.myChar(); return Object.values(v.objs).some((o) => o.kind === "bike_gen" && o.lv === c.lv && Math.abs(o.x + 0.5 - c.x) < 1.2); }, 40000);
await A.waitForTimeout(800);
await A.keyboard.press("KeyE");
res.pedalling = await until(A, () => window.__net.myChar()?.task?.action === "pedal", 8000);
await A.waitForTimeout(1500);
// pedalling opens the bike minigame (a modal): the guide waits behind it and shows the next step after
res.modalWhilePedal = await A.evaluate(() => document.querySelector(".modal")?.className ?? null);
await A.keyboard.press("Escape");
await A.waitForTimeout(1500);
res.guideNext = await A.locator(".first-day:not(.hidden) .fd-step").textContent().catch(() => null);
await A.screenshot({ path: "artifacts/qa-onboarding/guide-food.png" });
res.diag = await A.evaluate(() => ({ cls: document.querySelector(".first-day")?.className, body: document.body.className, modal: !!document.querySelector(".modal-back, .modal"), urgent: (window.__net.pub.mods.objectives ?? []).filter((o) => o.kind === "urgent").map((o) => o.id), guide: localStorage.getItem("bunker.guide"), day: window.__net.pub.day, phase: window.__net.pub.phase }));
console.log(JSON.stringify(res, null, 1));
await b.close();
