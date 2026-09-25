// Prologue playability with REAL input only (taps on what is visible). node prologue-probe.mjs <mode> <run> [mp]
// Measures: where the timer sits, how much of the character / loot / hatch is covered by UI, whether tapping works.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
const MODES = {
  PIXEL: { width: 412, height: 915, touch: true, dpr: 2.625 }, // Pixel 7 / typical Android, CSS px
  S360: { width: 360, height: 780, touch: true, dpr: 3 },
  IPH: { width: 390, height: 844, touch: true, dpr: 3 },
  LAND: { width: 915, height: 412, touch: true, dpr: 2.625 },
  TGP: { width: 412, height: 800, touch: true, dpr: 2.625, tg: true },
  D: { width: 1440, height: 900, touch: false, dpr: 1 },
};
const mode = process.argv[2] ?? "PIXEL", RUN = process.argv[3] ?? "1";
const M = MODES[mode];
const OUT = "artifacts/qa-smoke/prologue2";
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: M.width, height: M.height }, hasTouch: M.touch, isMobile: M.touch, deviceScaleFactor: 1, userAgent: M.touch ? "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36" : undefined });
if (M.tg) await ctx.addInitScript(() => { const n = () => {}; window.Telegram = { WebApp: { initData: "", platform: "android", viewportHeight: innerHeight, viewportStableHeight: innerHeight, contentSafeAreaInset: { top: 18, right: 0, bottom: 13, left: 0 }, safeAreaInset: { top: 24, right: 0, bottom: 16, left: 0 }, ready: n, expand: n, disableVerticalSwipes: n, setHeaderColor: n, setBackgroundColor: n, requestFullscreen: n, lockOrientation: n, unlockOrientation: n, onEvent: n, offEvent: n, BackButton: { onClick: n, offClick: n, show: n, hide: n }, HapticFeedback: { impactOccurred: n, notificationOccurred: n, selectionChanged: n } } }; });
const p = await ctx.newPage();
p.setDefaultTimeout(60000);
const tap = async (x, y) => (M.touch ? p.touchscreen.tap(x, y) : p.mouse.click(x, y));
if (M.tg) {
  const r = await fetch(`http://localhost:2567/api/tg/dev-token?chat=pro-${Date.now()}&user=${RUN}77&name=TG`);
  await p.goto(`http://localhost:5173/?mobile=1&tg=${encodeURIComponent((await r.json()).token)}`, { timeout: 90000 });
} else {
  await p.goto("http://localhost:5173/" + (M.touch ? "?mobile=1" : ""), { timeout: 90000 });
  await p.getByPlaceholder("Ваше имя").fill("Пролог" + RUN);
  const cb = p.getByRole("button", { name: "Создать бункер", exact: true });
  M.touch ? await cb.tap() : await cb.click();
}
await p.locator(".card").first().waitFor({ timeout: 60000 });
M.touch ? await p.locator(".card").first().tap() : await p.locator(".card").first().click();
const st = p.getByRole("button", { name: /Начать/ }).first();
M.touch ? await st.tap() : await st.click();
await p.waitForFunction(() => window.__net?.pub?.phase === "prologue" && window.__game?.pro?.active, null, { timeout: 60000 });
await p.waitForTimeout(2500);
// close the first tip by tapping «Понятно» if present (a real player would)
const ok = p.getByRole("button", { name: "Понятно", exact: true });
if (await ok.count()) M.touch ? await ok.first().tap().catch(() => {}) : await ok.first().click().catch(() => {});
await p.waitForTimeout(500);

/** What covers the play area: the character, loot labels, the hatch. */
const measure = () => p.evaluate(() => {
  const g = window.__game, pro = g.pro, c = window.__net.myChar();
  const canvas = document.querySelector("canvas");
  const isScene = (el) => !el || el === canvas || el === document.body || el.closest?.(".loot-marker, .hatch-marker, .markers, .labels");
  const coverAt = (x, y) => { if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return "offscreen"; const el = document.elementFromPoint(x, y); return isScene(el) ? null : (el.className?.toString?.() || el.tagName).slice(0, 40); };
  // character: sample a column of points from feet to head
  const [cx, cy] = pro.site.pos(c.x - 0.5, c.lv);
  const pts = [0.2, 0.6, 1.0, 1.4].map((h) => pro.site.toScreen(cx + 0.25, cy + h));
  const charCover = pts.map(([x, y]) => coverAt(x, y));
  const charCovered = charCover.filter((v) => v && v !== "offscreen").length / pts.length;
  // loot labels on screen: is each one actually tappable at its centre?
  const markers = [...document.querySelectorAll(".loot-marker")].filter((e) => e.getBoundingClientRect().width);
  let visible = 0, blocked = 0; const blockers = {};
  for (const m of markers) {
    const r = m.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
    visible++;
    const el = document.elementFromPoint(x, y);
    if (!m.contains(el)) { blocked++; const k = (el?.closest?.("[class]")?.className ?? "?").toString().slice(0, 30); blockers[k] = (blockers[k] ?? 0) + 1; }
  }
  const timer = document.querySelector(".prologue-hud")?.getBoundingClientRect();
  const sheet = document.querySelector(".prologue-actions")?.getBoundingClientRect();
  // playfield: the band of the street where people walk (feet y ± 1.6 cells), share covered by UI, sampled on a grid
  const [, fy] = pro.site.toScreen(cx, cy);
  const [, hy] = pro.site.toScreen(cx, cy + 1.6);
  let cov = 0, n = 0;
  for (let x = 8; x < innerWidth; x += innerWidth / 24) for (let y = Math.min(fy, hy); y <= Math.max(fy, hy); y += Math.max(4, Math.abs(fy - hy) / 5)) { n++; const v = coverAt(x, y); if (v && v !== "offscreen") cov++; }
  return {
    charScreen: pts[1].map(Math.round), charCover, charCovered,
    loot: { visible, blocked, blockers },
    timer: timer && { x: Math.round(timer.left), y: Math.round(timer.top), w: Math.round(timer.width), h: Math.round(timer.height), quadrant: `${timer.top + timer.height / 2 < innerHeight / 2 ? "top" : "bottom"}-${timer.left + timer.width / 2 < innerWidth / 3 ? "left" : timer.left + timer.width / 2 > innerWidth * 2 / 3 ? "right" : "center"}` },
    sheet: sheet && { top: Math.round(sheet.top), h: Math.round(sheet.height), shareOfScreen: Math.round((sheet.height / innerHeight) * 100) },
    streetCoveredPct: Math.round((cov / Math.max(1, n)) * 100),
    hands: c.hands.length,
  };
});
const out = { mode, run: RUN, steps: [] };
out.steps.push({ at: "start", ...(await measure()) });
await p.screenshot({ path: `${OUT}/${mode}-${RUN}-1-start.png` });
// play: tap up to 4 visible loot labels, one after another, then tap the hatch / «Отнести»
for (let k = 0; k < 7; k++) {
  const target = await p.evaluate(() => {
    const ms = [...document.querySelectorAll(".loot-marker")].map((e) => ({ e, r: e.getBoundingClientRect() })).filter(({ r }) => r.width && r.left > 0 && r.right < innerWidth && r.top > 0 && r.bottom < innerHeight);
    const free = ms.filter(({ e, r }) => e.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)));
    const pick = free[0] ?? ms[0];
    return pick ? { x: pick.r.left + pick.r.width / 2, y: pick.r.top + pick.r.height / 2, free: free.length, all: ms.length, text: pick.e.innerText.replace(/\s+/g, " ") } : null;
  });
  if (!target) {
    // walk like a player: joystick (touch) or A/D toward the nearest item, then look again
    const dir = await p.evaluate(() => { const pr = window.__net.pub.mods.prologue, c = window.__net.myChar(); const it = (pr?.items ?? []).filter((i) => !i.by).sort((a, b) => Math.abs(a.x - c.x) - Math.abs(b.x - c.x))[0]; return it ? Math.sign(it.x - c.x) : 1; });
    if (M.touch) {
      const j = await p.evaluate(() => { const e = document.querySelector('.touch-stick, .joystick, [class*=joystick]'); const r = e?.getBoundingClientRect(); return r ? [r.left + r.width / 2, r.top + r.height / 2] : [70, innerHeight - 120]; });
      const cdp = await ctx.newCDPSession(p);
      const t = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ id: i + 1, x, y })) });
      await t('touchStart', [[j[0], j[1]]]); for (let i = 1; i <= 6; i++) { await t('touchMove', [[j[0] + dir * i * 9, j[1]]]); await p.waitForTimeout(30); }
      await p.waitForTimeout(1800); await t('touchEnd', []);
    } else { const key = dir < 0 ? 'KeyA' : 'KeyD'; await p.keyboard.down(key); await p.waitForTimeout(1800); await p.keyboard.up(key); }
    out.steps.push({ at: `walk${k}`, note: "no loot label on screen — walked " + (dir < 0 ? "left" : "right"), ...(await measure()) });
    if (k === 0) await p.screenshot({ path: `${OUT}/${mode}-${RUN}-1b-walked.png` });
    continue;
  }
  const before = await p.evaluate(() => window.__net.myChar().hands.length);
  await tap(target.x, target.y);
  await p.waitForFunction((b) => window.__net.myChar().hands.length > b, before, { timeout: 15000 }).catch(() => {});
  const m = await measure();
  out.steps.push({ at: `tap${k}`, target, got: m.hands > before, ...m });
  if (k === 0) await p.screenshot({ path: `${OUT}/${mode}-${RUN}-2-carrying.png` });
}
// deliver with the big button
const deliver = p.locator("button.return-hatch").first();
if (await deliver.count()) M.touch ? await deliver.tap().catch(() => {}) : await deliver.click().catch(() => {});
await p.waitForTimeout(5000);
out.steps.push({ at: "delivering", ...(await measure()), delivered: await p.evaluate(() => Object.values(window.__net.pub.mods.prologue?.delivered ?? {}).reduce((a, b) => a + b, 0)) });
await p.screenshot({ path: `${OUT}/${mode}-${RUN}-3-hatch.png` });
console.log(JSON.stringify(out));
await b.close();
