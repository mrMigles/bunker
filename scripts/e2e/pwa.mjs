// PWA and updates against a production build: `node scripts/e2e/pwa.mjs` (builds twice, runs its own server).
// Release A: the service worker installs and takes the page, its cache is named after the release.
// A player is in a game when release B is deployed: the page notices (/version or the new worker), shows
// «Вышло обновление» instead of cutting the game; «Обновить» reloads straight back into the same bunker on
// release B, and the old cache is gone. A fresh visit after the deploy gets B right away.
import { chromium } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OUT = "artifacts/e2e";
mkdirSync(OUT, { recursive: true });
const report = { steps: [], errors: [], ok: true };
const step = (name, ok, data = {}) => {
  report.steps.push({ name, ok, ...data });
  console.log(`${ok ? "✔" : "✘"} ${name}`, Object.keys(data).length ? JSON.stringify(data) : "");
  if (!ok) report.ok = false;
};
const PORT = 8097;
const URL = `http://localhost:${PORT}`;
const DATA = mkdtempSync(join(tmpdir(), "glubzhe-pwa-"));
const A = "pwa-a-" + Date.now().toString(36);
const B = "pwa-b-" + Date.now().toString(36);

const build = (id) => {
  const r = spawnSync("pnpm --filter @bunker/client build", { env: { ...process.env, BUILD_ID: id }, shell: true, stdio: "pipe" });
  if (r.status !== 0) throw new Error("build failed: " + r.stderr?.toString().slice(-400));
};
let server = null;
const start = async (id) => {
  server = spawn("node", ["--import", "tsx", "src/index.ts"], { cwd: "packages/server", env: { ...process.env, NODE_ENV: "production", PORT: String(PORT), BUILD_ID: id, DATA_DIR: DATA }, stdio: "pipe", shell: false });
  server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const ok = await fetch(`${URL}/healthz`).then((r) => r.ok).catch(() => false);
    if (ok) return;
  }
  throw new Error("server did not start");
};
const stop = async () => {
  if (!server) return;
  const s = server;
  server = null;
  s.kill("SIGINT");
  await new Promise((r) => setTimeout(r, 2500));
  if (s.exitCode === null) s.kill("SIGKILL");
  await new Promise((r) => setTimeout(r, 800));
};

const browser = await chromium.launch({ headless: true });
try {
  build(A);
  await start(A);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => report.errors.push(e.message));
  const ev = (fn, arg) => page.evaluate(fn, arg);
  await page.goto(URL);
  await page.waitForFunction(() => navigator.serviceWorker?.controller || navigator.serviceWorker?.ready, null, { timeout: 15000 });
  await page.waitForFunction(async () => (await caches.keys()).some((k) => k.startsWith("glubzhe-")), null, { timeout: 15000 });
  const cachesA = await ev(async () => caches.keys());
  step("release A: the worker installs, its cache carries the release id", cachesA.includes("glubzhe-" + A) && (await ev(() => window.__build)) === A, { cachesA });
  // into a game
  await ev(() => localStorage.setItem("bunker.tipsOff", "1"));
  await page.getByPlaceholder("Ваше имя").fill("Обновляшка");
  await page.getByRole("button", { name: "Создать бункер", exact: true }).click();
  await page.locator(".lobby .card").first().click();
  await page.getByRole("button", { name: /Начать/ }).first().click();
  await page.waitForFunction(() => window.__net?.pub?.phase === "prologue", null, { timeout: 20000 });
  const code = await ev(() => window.__net.code);
  // the server saves running games every 30 s (and on a graceful stop, which Windows test runs lack)
  await page.waitForTimeout(32000);

  // ------------------------------------------------ deploy release B while the game runs
  build(B);
  await stop();
  await start(B);
  // the tab comes back into view (or the 5-minute check fires)
  await page.waitForTimeout(3000);
  await ev(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForSelector(".update-banner", { timeout: 30000 }).catch(() => {});
  const banner = await page.$(".update-banner");
  const stillA = await ev(() => window.__build);
  step("in a game the update is offered, not forced", !!banner && stillA === A, { banner: !!banner, stillA });
  await page.screenshot({ path: `${OUT}/pwa-01-banner.png` });
  if (banner) await page.getByRole("button", { name: "Обновить" }).click();
  await page.waitForFunction((b) => window.__build === b, B, { timeout: 30000 }).catch(() => {});
  await page.waitForFunction(() => !!window.__net?.code, null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const after = await ev(async () => ({ toasts: [...document.querySelectorAll(".toast")].map((t) => t.textContent), url: location.href, build: window.__build, code: window.__net?.code, phase: window.__net?.pub?.phase, caches: await caches.keys() }));
  step("«Обновить» reloads into release B and back into the same bunker", after.build === B && after.code === code, after);
  await page.waitForFunction((b) => caches.keys().then((k) => k.filter((x) => x.startsWith("glubzhe-")).join() === "glubzhe-" + b), B, { timeout: 20000 }).catch(() => {});
  const cachesB = await ev(async () => caches.keys());
  step("the old release's cache is deleted", !cachesB.includes("glubzhe-" + A) && cachesB.includes("glubzhe-" + B), { cachesB });

  // ------------------------------------------------ a fresh visitor gets B at once
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto(URL);
  step("a new visitor gets the new release straight away", (await p2.evaluate(() => window.__build)) === B);
  // a returning visitor from the menu (not in a game) switches silently
  await ctx.close();
  await ctx2.close();
} catch (e) {
  step("script error", false, { error: String(e?.message ?? e).slice(0, 400) });
}
await stop();
step("no page errors", report.errors.length === 0, { errors: report.errors.slice(0, 5) });
writeFileSync(`${OUT}/pwa-report.json`, JSON.stringify(report, null, 2));
await browser.close();
process.exit(report.ok ? 0 : 1);
