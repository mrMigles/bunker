// Multiplayer through the UI: `node scripts/e2e/multi.mjs` (needs `pnpm dev`).
// Host creates a bunker, a friend joins by code from the menu; both pick, ready, start; the prologue and the
// first day run for both (each sees the other's character move), chat reaches the other side, the night
// council waits for both «Готов», a dropped connection comes back by itself, a reload returns to the bunker.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "artifacts/e2e";
mkdirSync(OUT, { recursive: true });
const report = { steps: [], errors: [], ok: true };
const step = (name, ok, data = {}) => {
  report.steps.push({ name, ok, ...data });
  console.log(`${ok ? "✔" : "✘"} ${name}`, Object.keys(data).length ? JSON.stringify(data) : "");
  if (!ok) report.ok = false;
};
const URL = "http://localhost:5173";
const browser = await chromium.launch({ headless: true });
const open = async (tag) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => report.errors.push(`${tag}: ${e.message} @ ${(e.stack ?? "").split("\n").slice(1, 3).join(" ")}`));
  p.on("framenavigated", (f) => f === p.mainFrame() && console.log(`[${tag}] navigated`, f.url()));
  p.on("console", (m) => m.type() === "error" && !/WebSocket|40\d|ERR_/.test(m.text()) && report.errors.push(`${tag}: ${m.text()}`));
  return { ctx, p, ev: (fn, arg) => p.evaluate(fn, arg) };
};
const A = await open("host");
const B = await open("guest");
const wait = (ms) => A.p.waitForTimeout(ms);

try {
  // ------------------------------------------------ lobby
  await A.p.goto(URL);
  await A.p.evaluate(() => localStorage.setItem("bunker.tipsOff", "1"));
  await A.p.getByPlaceholder("Ваше имя").fill("Хозяин");
  await A.p.getByRole("button", { name: "Создать бункер", exact: true }).click();
  await A.p.locator(".lobby .card").first().waitFor();
  const code = await A.ev(() => window.__net.code);
  await B.p.goto(URL);
  await B.p.evaluate(() => localStorage.setItem("bunker.tipsOff", "1"));
  await B.p.getByPlaceholder("Ваше имя").fill("Гость");
  await B.p.getByPlaceholder(/Код/i).fill(code);
  await B.p.getByRole("button", { name: /Войти|Присоединиться/ }).first().click();
  await B.p.locator(".lobby .card").first().waitFor({ timeout: 10000 });
  await wait(600);
  const names = await A.ev(() => Object.values(window.__net.pub.players).map((p) => p.name));
  step("the friend joins by code and shows up in the host's lobby", names.includes("Гость") && names.includes("Хозяин"), { code, names });
  const guestHost = await B.ev(() => !!window.__net.pub.players[window.__net.priv.pid]?.host);
  step("only the creator is the host", !guestHost);
  await A.p.locator(".lobby .card").first().click();
  await B.p.locator(".lobby .card").nth(1).click();
  await B.p.getByRole("button", { name: "Готов", exact: true }).click();
  await wait(500);
  const readyB = await A.ev(() => Object.values(window.__net.pub.players).find((p) => p.name === "Гость")?.ready);
  step("the host sees the guest ready", !!readyB);
  await A.p.getByRole("button", { name: /Начать/ }).first().click();

  // ------------------------------------------------ prologue for both
  await Promise.all([A, B].map((x) => x.p.waitForFunction(() => window.__net?.pub?.phase === "prologue", null, { timeout: 20000 })));
  const chars = await A.ev(() => Object.values(window.__net.pub.players).map((p) => window.__net.pub.chars[p.char]?.card.name).filter(Boolean));
  step("both players have characters in the prologue", chars.length === 2, { chars });
  // the guest walks; the host sees it
  const bChar = await B.ev(() => window.__net.priv.char);
  const x0 = await A.ev((id) => window.__net.pub.chars[id].x, bChar);
  await B.p.keyboard.down("KeyD");
  await B.p.waitForTimeout(1500);
  await B.p.keyboard.up("KeyD");
  await wait(500);
  const x1 = await A.ev((id) => window.__net.pub.chars[id].x, bChar);
  step("the host sees the guest walk", Math.abs(x1 - x0) > 1, { x0, x1 });
  await A.p.screenshot({ path: `${OUT}/mp-01-prologue.png` });
  await A.ev(() => window.__game.pro.returnHome());
  await B.ev(() => window.__game.pro.returnHome());
  await Promise.all([A, B].map((x) => x.p.waitForFunction(() => window.__net.pub.phase === "day", null, { timeout: 90000 })));
  await wait(1500);

  // ------------------------------------------------ chat
  await B.p.keyboard.press("Enter");
  await B.p.locator(".chat input").fill("Привет из соседнего окна");
  await B.p.keyboard.press("Enter");
  await A.p.waitForFunction(() => document.body.innerText.includes("Привет из соседнего окна"), null, { timeout: 8000 }).catch(() => {});
  step("chat reaches the other player", await A.ev(() => document.body.innerText.includes("Привет из соседнего окна")));

  // ------------------------------------------------ both act in the bunker
  const pos = await A.ev((id) => ({ me: window.__net.myChar().x, him: window.__net.pub.chars[id].x }), bChar);
  await A.p.keyboard.down("KeyA");
  await wait(1200);
  await A.p.keyboard.up("KeyA");
  const seen = await B.ev((id) => window.__net.pub.chars[id].x, await A.ev(() => window.__net.priv.char));
  step("the guest sees the host move in the bunker", Math.abs(seen - pos.me) > 0.4, { before: pos.me, seen });
  await A.p.screenshot({ path: `${OUT}/mp-02-bunker.png` });

  // ------------------------------------------------ a dropped connection comes back
  await B.ev(() => window.__net.room.connection.close(4000, "test drop"));
  await B.p.waitForFunction(() => window.__net.room && window.__net.room.connection.isOpen, null, { timeout: 25000 }).catch(() => {});
  await B.p.waitForTimeout(1500);
  const back = await B.ev(() => ({ open: !!window.__net.room?.connection?.isOpen, char: window.__net.priv?.char, phase: window.__net.pub?.phase }));
  step("a dropped connection rejoins the same character", back.open && back.char === bChar, { back, bChar });
  const aCount = await A.ev(() => Object.keys(window.__net.pub.players).length);
  step("no duplicate player after the rejoin", aCount === 2, { aCount });

  // ------------------------------------------------ reload returns to the bunker
  await B.p.reload();
  await B.p.waitForFunction(() => window.__net?.pub?.phase && window.__net.pub.phase !== "lobby", null, { timeout: 20000 }).catch(() => {});
  const afterReload = await B.ev(() => ({ code: window.__net.code, char: window.__net.priv?.char }));
  step("a reload brings the player back into the same bunker and body", afterReload.code === code && afterReload.char === bChar, afterReload);

  // ------------------------------------------------ the council waits for both
  await A.ev(() => window.__net.send({ k: "debug", op: "night" }));
  await Promise.all([A, B].map((x) => x.p.waitForFunction(() => window.__net.pub.phase === "night" && window.__net.pub.council, null, { timeout: 15000 })));
  await wait(1000);
  const step0 = await A.ev(() => window.__net.pub.council.step);
  await A.p.getByRole("button", { name: /Готов →/ }).click();
  await wait(1200);
  const stepAfterOne = await A.ev(() => window.__net.pub.council.step);
  step("one «Готов» out of two does not move the council", stepAfterOne === step0, { step0, stepAfterOne });
  await B.p.getByRole("button", { name: /Готов →/ }).click();
  await A.p.waitForFunction((s) => window.__net.pub.council?.step !== s || window.__net.pub.phase !== "night", step0, { timeout: 8000 }).catch(() => {});
  const stepAfterTwo = await A.ev(() => window.__net.pub.council?.step ?? window.__net.pub.phase);
  step("both «Готов» move the council on", stepAfterTwo !== step0, { stepAfterTwo });
  await A.p.screenshot({ path: `${OUT}/mp-03-council.png` });
} catch (e) {
  step("script error", false, { error: String(e?.message ?? e).slice(0, 300) });
  await A.p.screenshot({ path: `${OUT}/mp-error-a.png` }).catch(() => {});
  await B.p.screenshot({ path: `${OUT}/mp-error-b.png` }).catch(() => {});
}
step("no page errors", report.errors.length === 0, { errors: report.errors.slice(0, 5) });
writeFileSync(`${OUT}/multi-report.json`, JSON.stringify(report, null, 2));
await browser.close();
process.exit(report.ok ? 0 : 1);
