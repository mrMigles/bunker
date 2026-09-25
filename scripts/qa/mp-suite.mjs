// Two browsers in one bunker. node mp-suite.mjs <variant> <run>
// variants: prologue, table-bots, table-playing, table-race, table-reload
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
const V = process.argv[2] ?? "prologue", RUN = process.argv[3] ?? "1";
const OUT = "artifacts/qa-smoke/mp2";
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch();
const log = (...a) => console.log(`[${V}#${RUN}]`, ...a);
async function mk(name, vp, touch) {
  const ctx = await b.newContext({ viewport: vp, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => localStorage.setItem("bunker.tipsOff", "1"));
  const p = await ctx.newPage();
  p.setDefaultTimeout(60000);
  p.nm = name; p.touch = touch; p.errs = [];
  p.on("pageerror", (e) => p.errs.push(e.message));
  p.act = (l) => (touch ? l.tap() : l.click());
  return p;
}
const A = await mk("A-D", { width: 1280, height: 800 }, false);
const B = await mk("B-PIXEL", { width: 412, height: 915 }, true);
const shot = (p, n) => p.screenshot({ path: `${OUT}/${V}-${RUN}-${p.nm}-${n}.png` });
await A.goto("http://localhost:5173", { timeout: 90000 });
await A.getByPlaceholder("Ваше имя").fill("Анна");
await A.act(A.getByRole("button", { name: "Создать бункер", exact: true }));
await A.locator(".card").first().waitFor();
const code = await A.evaluate(() => window.__net.pub.code ?? document.body.innerText.match(/Код бункера:\s*([A-Z0-9]{5})/)?.[1]);
await B.goto(`http://localhost:5173/?mobile=1&code=${code}`, { timeout: 90000 });
const nm = B.getByPlaceholder("Ваше имя");
if (await nm.count()) { await nm.fill("Борис"); const j = B.getByRole("button", { name: /Войти/ }).first(); if (await j.count()) await B.act(j).catch(() => {}); }
await B.locator(".card").first().waitFor();
await A.act(A.locator(".card").first());
await B.act(B.locator(".card").nth(1));
if (V !== "prologue") await A.getByLabel("Без пролога").check();
await B.act(B.getByRole("button", { name: "Готов", exact: true })).catch(() => {});
await A.act(A.getByRole("button", { name: "Готов", exact: true })).catch(() => {});
await A.act(A.getByRole("button", { name: /Начать/ }).first());
const res = { code };

if (V === "prologue") {
  for (const p of [A, B]) await p.waitForFunction(() => window.__net?.pub?.phase === "prologue" && window.__game?.pro?.active, null, { timeout: 60000 }).catch(() => {});
  await A.waitForTimeout(2500);
  res.phases = await Promise.all([A, B].map((p) => p.evaluate(() => window.__net.pub.phase)));
  // both go for the same nearest item: A by click on its label, B by tap on its label (if visible), otherwise hook
  const target = await A.evaluate(() => { const p = window.__net.pub.mods.prologue, c = window.__net.myChar(); return p.items.filter((i) => i.lv === 1 && !i.by).sort((a, b) => Math.abs(a.x - c.x) - Math.abs(b.x - c.x))[0]?.id; });
  const tapLabel = async (p) => {
    const pos = await p.evaluate((id) => { const it = window.__net.pub.mods.prologue.items.find((i) => i.id === id); const name = it && window.__game.pro.labels?.get(id); const r = name?.getBoundingClientRect(); return r && r.width && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight ? [r.left + r.width / 2, r.top + r.height / 2] : null; }, target);
    if (pos) { p.touch ? await p.touchscreen.tap(pos[0], pos[1]) : await p.mouse.click(pos[0], pos[1]); return "tap"; }
    await p.evaluate((id) => window.__game.pro.selectItem(id), target); return "hook (label not on screen)";
  };
  res.howA = await tapLabel(A);
  res.howB = await tapLabel(B);
  await A.waitForTimeout(8000);
  res.hands = await Promise.all([A, B].map((p) => p.evaluate(() => window.__net.myChar().hands.map((h) => h.item))));
  res.itemTakenTwice = res.hands[0].length && res.hands[1].length && res.hands[0][0] === res.hands[1][0];
  for (const p of [A, B]) await shot(p, "1-both");
  for (const p of [A, B]) { const d = p.locator("button.return-hatch").first(); if (await d.count()) await p.act(d).catch(() => {}); }
  await A.waitForTimeout(12000);
  res.delivered = await Promise.all([A, B].map((p) => p.evaluate(() => Object.values(window.__net.pub.mods.prologue?.delivered ?? {}).reduce((a, b) => a + b, 0)).catch(() => "n/a")));
  res.counterText = await Promise.all([A, B].map((p) => p.evaluate(() => document.body.innerText.match(/В убежище:\s*\d+/)?.[0] ?? null)));
  for (const p of [A, B]) await shot(p, "2-delivered");
  await A.waitForFunction(() => window.__net.pub.phase === "day", null, { timeout: 120000 }).catch(() => {});
  await A.waitForTimeout(3000);
  res.afterFlash = await Promise.all([A, B].map((p) => p.evaluate(() => window.__net.pub.phase)));
} else {
  for (const p of [A, B]) await p.waitForFunction(() => window.__net?.pub?.phase === "day" && window.__net.myChar?.(), null, { timeout: 60000 });
  await A.evaluate(() => window.__net.send({ k: "debug", op: "hour", arg: 19 }));
  await A.waitForTimeout(1500);
  const table = await A.evaluate(() => { const o = Object.values(window.__net.pub.objs).find((o) => o.kind === "game_table"); return { id: o.id, x: o.x, lv: o.lv }; });
  const walk = (p, dx = 0.8) => p.evaluate(([o, dx]) => new Promise((r) => window.__game.navigation.go(o.x + dx, o.lv, r)), [table, dx]);
  const nearby = (p) => p.evaluate(() => [...document.querySelectorAll(".prompt button, .prompt .act, .prompt .opt")].map((b) => b.innerText.replace(/\s+/g, " ").trim()).filter(Boolean));
  const sit = async (p) => { const btn = p.locator(".prompt button, .prompt .act, .prompt .opt", { hasText: /Сесть/ }).first(); if (!(await btn.count())) return "no sit button"; await p.act(btn).catch((e) => String(e).slice(0, 60)); await p.waitForTimeout(2000); return p.evaluate(() => ({ task: window.__net.myChar().task?.action, seat: window.__net.myChar().seat, ui: !!window.__game.table?.active })); };
  const seats = () => A.evaluate(() => Object.values(window.__net.pub.mods.tables ?? {}).map((t) => ({ seats: t.seats, status: t.status, game: t.game })));
  await walk(A);
  res.aSit = await sit(A);
  if (V === "table-bots" || V === "table-race") {
    const n = V === "table-bots" ? 3 : 2;
    for (let i = 0; i < n; i++) { const c = A.getByRole("button", { name: /Позвать жильца/ }).first(); if (await c.count()) await A.act(c).catch(() => {}); await A.waitForTimeout(800); }
    res.seatsAfterBots = await seats();
  }
  if (V === "table-playing" || V === "table-reload") {
    const c = A.getByRole("button", { name: /Позвать жильца/ }).first(); if (await c.count()) await A.act(c).catch(() => {});
    await A.waitForTimeout(800);
    const s = A.getByRole("button", { name: /Начать/ }).last(); if (await s.count()) await A.act(s).catch(() => {});
    await A.waitForTimeout(2000);
    res.seatsPlaying = await seats();
  }
  if (V === "table-race") {
    // leave one seat: A stands up; then A and B sit at the same moment
    await walk(B, 1.4);
    await A.keyboard.press("Escape"); await A.waitForTimeout(1500);
    res.seatsBeforeRace = await seats();
    await walk(A, 0.3);
    const [ra, rb] = await Promise.all([sit(A), sit(B)]);
    res.race = { A: ra, B: rb, seats: await seats() };
  } else {
    await walk(B, 1.4);
    res.bNearby = await nearby(B);
    res.bSit = await sit(B);
    res.seatsAfterB = await seats();
  }
  if (V === "table-reload") {
    await B.reload(); await B.waitForFunction(() => window.__net?.myChar?.(), null, { timeout: 60000 }).catch(() => {}); await B.waitForTimeout(2500);
    res.bAfterReload = await B.evaluate(() => ({ task: window.__net.myChar().task?.action, seat: window.__net.myChar().seat, ui: !!window.__game.table?.active, inSeats: Object.values(window.__net.pub.mods.tables ?? {}).some((t) => t.seats.includes(window.__net.myChar().id)) }));
  }
  for (const p of [A, B]) await shot(p, "table");
}
res.errors = [A.errs.slice(0, 2), B.errs.slice(0, 2)];
log(JSON.stringify(res));
await b.close();
