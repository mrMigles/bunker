// Portrait-phone regression: `node scripts/e2e/mobile-portrait.mjs` (needs `pnpm dev`).
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
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
  userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36",
});
const page = await context.newPage();
page.on("pageerror", (e) => report.errors.push(e.message));
page.on("console", (m) => m.type() === "error" && !/WebSocket|4\d\d/.test(m.text()) && report.errors.push(m.text()));
const rects = () =>
  page.evaluate(() => {
    const rect = (selector) => {
      const el = document.querySelector(selector);
      if (!el || getComputedStyle(el).display === "none") return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom) };
    };
    return {
      top: rect(".hud-top"), toolbar: rect(".game-toolbar"), objectives: rect(".objectives"), dock: rect(".game-dock"),
      stick: rect(".touch-stick:not(.hidden)"), stats: rect(".hud-me"), actions: rect(".action-dock:not(.hidden)"), pad: rect(".touch-pad"),
      rotateBlocker: getComputedStyle(document.body, "::before").display !== "none",
      width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
    };
  });
const overlaps = (a, b) => a && b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

try {
  await page.goto(process.env.PORTRAIT_URL ?? "http://localhost:5173/?mobile=1");
  await page.getByPlaceholder("Ваше имя").fill("Портрет");
  await page.getByRole("button", { name: "Создать бункер", exact: true }).tap();
  await page.locator(".lobby .card").first().tap();
  await page.getByLabel("Без пролога").check();
  await page.getByRole("button", { name: "Готов", exact: true }).tap();
  await page.getByRole("button", { name: /Начать/ }).first().tap();
  await page.waitForFunction(() => window.__net.pub.phase === "day", null, { timeout: 30000 });
  await page.waitForTimeout(1800);
  await page.getByRole("button", { name: "Понятно" }).tap().catch(() => {});
  const startLayout = await rects();
  step("portrait starts without the rotate-device blocker", !startLayout.rotateBlocker, startLayout);
  await page.evaluate(() => {
    const o = Object.values(window.__net.pub.objs).find((x) => ["water_tank", "shelf", "bed", "radio"].includes(x.kind));
    if (o) window.__game.navigation.go(o.x + 0.5, o.lv);
  });
  await page.waitForFunction(() => document.querySelector(".action-dock:not(.hidden) .opt"), null, { timeout: 12000 }).catch(() => {});
  const layout = await rects();
  const controlsClear = !overlaps(layout.stick, layout.stats) && !overlaps(layout.stats, layout.pad) && layout.scrollWidth <= layout.width;
  step("portrait HUD fits and thumb controls do not collide", controlsClear, layout);
  const actionCount = await page.locator(".action-dock:not(.hidden) .opt:visible").count();
  step("only the primary nearby action is shown initially", actionCount <= 1, { actionCount });
  await page.screenshot({ path: `${OUT}/mp-02-portrait-bunker.png`, fullPage: false });

  const more = page.locator(".mobile-action-toggle:visible");
  if (await more.count()) {
    await more.tap();
    const expandedCount = await page.locator(".action-dock:not(.hidden) .opt:visible").count();
    step("nearby actions expand on demand", expandedCount > actionCount, { actionCount, expandedCount });
    await page.screenshot({ path: `${OUT}/mp-03-actions-expanded.png`, fullPage: false });
  }
  await page.locator(".hud-me").tap();
  step("survivor indicators expand on demand", await page.locator(".hud-me.mobile-expanded .need").count() >= 5);
  await page.locator(".journal-dock-button").tap();
  const journal = await page.locator(".journal-modal").evaluate((el) => ({ clientHeight: el.clientHeight, scrollHeight: el.scrollHeight, bottom: Math.round(el.getBoundingClientRect().bottom), H: innerHeight }));
  step("journal opens as a viewport-sized scrollable window", journal.bottom <= journal.H + 1 && journal.clientHeight <= journal.H, journal);
  await page.keyboard.press("Escape");
  await page.locator(".game-dock button").first().tap();
  await page.locator(".modal").waitFor();
  const longModal = await page.locator(".modal").evaluate(async (el) => {
    el.scrollTop = el.scrollHeight;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return { clientHeight: el.clientHeight, scrollHeight: el.scrollHeight, scrollTop: Math.round(el.scrollTop), reachedEnd: el.scrollTop + el.clientHeight >= el.scrollHeight - 2 };
  });
  step("long mobile windows scroll all the way to their final controls", longModal.reachedEnd, longModal);
  await page.keyboard.press("Escape");

  await page.evaluate(() => window.__net.send({ k: "debug", op: "night" }));
  await page.waitForFunction(() => window.__net.pub.phase === "night", null, { timeout: 10000 });
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: "Понятно" }).tap().catch(() => {});
  const council = await page.locator(".council-panel").evaluate((el) => {
    const ready = [...el.querySelectorAll("button")].find((b) => /Готов/.test(b.textContent ?? ""));
    const r = el.getBoundingClientRect();
    const rr = ready?.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), H: innerHeight, scrolls: el.scrollHeight > el.clientHeight, readyBottom: rr ? Math.round(rr.bottom) : null };
  });
  step("portrait council is a scrollable bottom sheet with Ready in reach", council.top > 0 && council.bottom <= council.H + 1 && !!council.readyBottom && council.readyBottom <= council.H, council);
  await page.screenshot({ path: `${OUT}/mp-04-portrait-council.png`, fullPage: false });
} catch (e) {
  step("script error", false, { error: String(e?.message ?? e) });
  await page.screenshot({ path: `${OUT}/mp-error.png` }).catch(() => {});
}
step("no page errors", report.errors.length === 0, { errors: report.errors.slice(0, 5) });
writeFileSync(`${OUT}/mobile-portrait-report.json`, JSON.stringify(report, null, 2));
await browser.close();
process.exit(report.ok ? 0 : 1);
