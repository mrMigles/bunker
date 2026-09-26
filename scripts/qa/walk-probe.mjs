// #41: hold D and sample the rendered position of the own survivor every frame; count stalls and pull-backs.
// node scripts/qa/walk-probe.mjs [seconds] [latencyMs]
import { chromium } from "@playwright/test";
const SECS = Number(process.argv[2] ?? 5);
const LAT = Number(process.argv[3] ?? 0);
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => localStorage.setItem("bunker.tipsOff", "1"));
const p = await ctx.newPage();
p.setDefaultTimeout(60000);
if (LAT) {
  const cdp = await ctx.newCDPSession(p);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: LAT, downloadThroughput: -1, uploadThroughput: -1 });
}
await p.goto("http://localhost:5173/", { timeout: 90000 });
await p.getByPlaceholder("Ваше имя").fill("Ходок");
await p.getByRole("button", { name: "Создать бункер", exact: true }).click();
await p.locator(".card").first().click();
const l = p.getByLabel("Без пролога");
if (await l.count()) await l.check().catch(() => {});
await p.getByRole("button", { name: /Начать/ }).first().click();
await p.waitForFunction(() => window.__net?.pub?.phase === "day" && window.__net.myChar?.(), null, { timeout: 60000 });
await p.waitForTimeout(2500);
await p.keyboard.press("Escape").catch(() => {});
// every reconcile: how far the server's replay disagrees with what the player sees
await p.evaluate(() => {
  const n = window.__net;
  window.__corr = [];
  window.__sent = 0;
  const orig = n.reconcile.bind(n);
  n.reconcile = function () {
    const before = n.pred ? n.pred.x : NaN;
    orig();
    if (n.pred) window.__corr.push(n.pred.x - before);
    if (n.pred && Math.abs(n.pred.x - before) > 0.05) (window.__big ??= []).push([+before.toFixed(2), +n.pred.x.toFixed(2), n.myChar().x.toFixed(2), n.pending.length]);
  };
  const si = n.sendInput.bind(n);
  n.sendInput = function (mx, my, run, dt) { if (mx) window.__sent += dt; return si(mx, my, run, dt); };
  window.__x0 = n.myChar().x;
});
await p.keyboard.down("KeyD");
await p.waitForTimeout(SECS * 1000);
await p.keyboard.up("KeyD");
await p.waitForTimeout(1500);
const r = await p.evaluate(() => {
  const c = window.__corr.filter((x) => !Number.isNaN(x));
  const big = c.filter((x) => Math.abs(x) > 0.05);
  const moved = window.__net.myChar().x - window.__x0;
  return { reconciles: c.length, corrections: big.length, pullBacks: big.filter((x) => x < 0).length, maxCorr: +Math.max(0, ...c.map(Math.abs)).toFixed(2), sentSec: +window.__sent.toFixed(2), serverMoved: +moved.toFixed(2), speedServer: +(moved / window.__sent).toFixed(2), big: window.__big, end: +window.__net.myChar().x.toFixed(2), start: +window.__x0.toFixed(2) };
});
console.log(JSON.stringify({ latency: LAT, ...r }));
await b.close();
