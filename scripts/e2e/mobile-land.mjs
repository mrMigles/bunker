// Phone in landscape: a sortie keeps the scene clear, and building works with the finger.
// `node scripts/e2e/mobile-land.mjs` (dev server on :5173). Screenshots go to artifacts/mobile-land.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const base = process.env.URL || "http://localhost:5173";
const out = "artifacts/mobile-land";
mkdirSync(out, { recursive: true });
const only = process.argv[2] ?? "";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 780, height: 320 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
await ctx.addInitScript(() => localStorage.setItem("bunker.tipsOff", "1"));
const page = await ctx.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let fails = 0;
const check = (name, ok, data) => {
  if (!ok) fails++;
  console.log(ok ? "✔" : "✘", name, ok ? "" : JSON.stringify(data ?? ""));
};
const ev = (fn, arg) => page.evaluate(fn, arg);
const cdp = await ctx.newCDPSession(page);
const touch = async (pts, type) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], i) => ({ id: i + 1, x, y, radiusX: 4, radiusY: 4, force: 1 })) });
async function drag(x0, y0, x1, y1, steps = 10) {
  await touch([[x0, y0]], "touchStart");
  for (let i = 1; i <= steps; i++) {
    await touch([[x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps]], "touchMove");
    await page.waitForTimeout(20);
  }
  await touch([], "touchEnd");
  await page.waitForTimeout(150);
}
/** Rectangles of visible elements, and which of them overlap each other. */
const layout = (sels) =>
  ev((sels) => {
    const found = sels.flatMap((s) =>
      [...document.querySelectorAll(s)]
        .filter((e) => e.getBoundingClientRect().width && getComputedStyle(e).display !== "none" && getComputedStyle(e).visibility !== "hidden")
        .map((e) => {
          const r = e.getBoundingClientRect();
          return { s, x: r.x, y: r.y, right: r.right, bottom: r.bottom };
        }),
    );
    const overlaps = [];
    for (let i = 0; i < found.length; i++)
      for (let j = i + 1; j < found.length; j++) {
        const a = found[i],
          b = found[j];
        if (a.x < b.right - 2 && b.x < a.right - 2 && a.y < b.bottom - 2 && b.y < a.bottom - 2) overlaps.push([a.s, b.s]);
      }
    return { found, overlaps, outside: found.filter((r) => r.x < -1 || r.y < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1).map((r) => r.s) };
  }, sels);

try {
  await page.goto(base + "/?mobile=1");
  await page.getByPlaceholder("Ваше имя").fill("Альбом");
  await page.getByRole("button", { name: "Создать бункер", exact: true }).tap();
  await page.locator(".card").first().tap();
  await page.getByLabel("Без пролога").check();
  await page.getByRole("button", { name: "Готов", exact: true }).tap();
  await page.getByRole("button", { name: "Начать", exact: true }).tap();
  await page.waitForFunction(() => window.__net?.pub?.phase === "day");
  await page.waitForTimeout(500);

  if (!only || only === "build") {
    // ------------------------------------------------------------ building with a finger
    await ev(() => window.__net.send({ k: "debug", op: "res", arg: 200 }));
    const dockBuild = page.locator('.game-dock button[data-k="build"], .game-dock button[title*="Стройка"], .game-dock button[aria-label*="Стройка"]').first();
    if (await dockBuild.count()) await dockBuild.tap();
    else await page.keyboard.press("b");
    await page.locator(".build-strip").waitFor();
    await page.waitForTimeout(400);
    const cam = await ev(() => ({ viewH: window.__r.viewH, follow: window.__r.follow }));
    check("build: the camera pulls back to the whole bunker", cam.viewH > 14 && !cam.follow, cam);
    const strip = await layout([".build-strip", ".hud-top", ".game-toolbar", ".touch-pad", ".touch-stick", ".game-dock"]);
    check("build: the room strip sits in the screen without covering the bars", !strip.outside.length && !strip.overlaps.length, strip);
    const cards = await page.locator(".build-card").count();
    check("build: rooms to choose from in the strip", cards >= 6, { cards });
    const stripH = await ev(() => document.querySelector(".build-strip").getBoundingClientRect().height);
    check("build: the strip is a row, not a 1-pixel list", stripH >= 60 && stripH <= 130, { stripH });
    // the full list
    await page.locator(".build-all").tap();
    await page.locator(".modal .build-grid").waitFor();
    const all = await page.locator(".modal .build-grid .build-card").count();
    check("build: «Все» opens the whole list", all >= 20, { all });
    await page.screenshot({ path: `${out}/build-list.png` });
    await page.locator('.modal .build-grid .build-card[data-type="storage"]').tap();
    await page.waitForTimeout(300);
    const sel = await ev(() => ({ type: window.__game.build.type, open: !!document.querySelector(".modal") }));
    check("build: picking in the list selects the room and closes it", sel.type === "storage" && !sel.open, sel);
    // a picked room appears on a free spot next to the base
    const g0 = await ev(() => ({ ...window.__game.build.hover, ok: window.__game.build.ok, vis: window.__game.build.ghost.visible }));
    check("build: the plan appears on a spot where it fits", g0.vis && g0.ok, g0);
    await page.screenshot({ path: `${out}/build-picked.png` });
    // drag it with a finger
    const [gx, gy] = await ev(() => window.__r.toScreen(window.__game.build.hover.x + window.__game.build.width / 2, -(window.__game.build.hover.lv * 2 + 1)));
    await drag(gx, gy, gx + 90, gy, 12);
    const g1 = await ev(() => ({ ...window.__game.build.hover }));
    check("build: dragging moves the plan", g1.x !== g0.x || g1.lv !== g0.lv, { g0, g1 });
    // drop it one floor down, where it fits (the strip «Разметить» button marks it)
    const spot = await ev(() => {
      const b = window.__game.build;
      return b.bestSpot(b.hover.x, b.hover.lv + 1) ?? b.bestSpot(b.hover.x, b.hover.lv);
    });
    const [sx, sy] = await ev((s) => window.__r.toScreen(s.x + window.__game.build.width / 2, -(s.lv * 2 + 1)), spot);
    const [cx, cy] = await ev(() => window.__r.toScreen(window.__game.build.hover.x + window.__game.build.width / 2, -(window.__game.build.hover.lv * 2 + 1)));
    await drag(cx, cy, sx, sy, 12);
    const g2 = await ev(() => ({ ...window.__game.build.hover, ok: window.__game.build.ok }));
    check("build: the plan snaps to a spot where it fits", g2.ok, { spot, g2 });
    const before = await ev(() => Object.keys(window.__net.pub.rooms).length);
    await page.locator(".build-place").tap();
    await page.waitForFunction((n) => Object.keys(window.__net.pub.rooms).length > n, before).catch(() => {});
    const after = await ev(() => Object.values(window.__net.pub.rooms).filter((r) => r.state !== "done").map((r) => r.type));
    check("build: «Разметить» marks the room", after.includes("storage"), after);
    await page.screenshot({ path: `${out}/build-marked.png` });
    // pinch still zooms in build mode
    const vh0 = await ev(() => window.__r.viewH);
    await touch([[300, 180], [380, 180]], "touchStart");
    for (let i = 1; i <= 6; i++) {
      await touch([[300 - i * 12, 180], [380 + i * 12, 180]], "touchMove");
      await page.waitForTimeout(25);
    }
    await touch([], "touchEnd");
    await page.waitForTimeout(200);
    const vh1 = await ev(() => window.__r.viewH);
    check("build: pinch zooms", vh1 < vh0 * 0.85, { vh0, vh1 });
    const plans = await ev(() => Object.values(window.__net.pub.rooms).filter((r) => r.state !== "done").length);
    check("build: a pinch does not mark anything", plans === after.length, { plans });
    await page.locator(".build-done").tap();
    await page.waitForTimeout(300);
    const off = await ev(() => ({ active: window.__game.build.active, strip: !!document.querySelector(".build-strip:not(.hidden)") }));
    check("build: «Готово» leaves building", !off.active && !off.strip, off);
    // portrait too
    await page.setViewportSize({ width: 390, height: 780 });
    await page.keyboard.press("b");
    await page.waitForTimeout(400);
    const port = await layout([".build-strip", ".hud-top", ".game-toolbar", ".touch-pad", ".game-dock"]);
    check("build portrait: the strip fits the screen", !port.outside.length && !port.overlaps.length, port);
    await page.screenshot({ path: `${out}/build-portrait.png` });
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 780, height: 320 });
    await page.waitForTimeout(300);
  }

  if (!only || only === "site") {
    // ------------------------------------------------------------ a sortie in landscape
    await ev(() => {
      const o = Object.values(window.__net.pub.objs).find((o) => o.kind === "sortie_terminal");
      window.__game.navigation.go(o.x + 0.5, o.lv, () => window.__net.send({ k: "do", a: "sortie", tt: "obj", t: o.id }));
    });
    await page.waitForFunction(() => window.__net.pub.mods.expedition?.stage === "prep", null, { timeout: 30000 });
    await page.getByRole("button", { name: /Выйти на поверхность/ }).tap();
    await page.waitForFunction(() => window.__net.pub.mods.expedition?.stage === "map");
    const dest = await ev(() => Object.values(window.__net.pub.mods.wmap.nodes).filter((n) => n.id !== "home" && !["trader", "camp", "ark"].includes(n.type)).sort((a, b) => a.danger - b.danger)[0].id);
    await ev(() => window.__net.send({ k: "debug", op: "speed", arg: 8 }));
    await ev((id) => window.__net.send({ k: "expGo", node: id }), dest);
    await page.waitForFunction((id) => { const e = window.__net.pub.mods.expedition; return e?.stage === "map" && e.node === id && !window.__net.pub.mods.battle; }, dest, { timeout: 120000 });
    await ev(() => window.__net.send({ k: "debug", op: "speed", arg: 1 }));
    await ev(() => window.__net.send({ k: "expEnter" }));
    await page.waitForFunction(() => window.__game.exp.mode === "site");
    await page.waitForTimeout(800);
    for (const [w, hgt] of [[780, 320], [844, 390], [640, 300]]) {
      await page.setViewportSize({ width: w, height: hgt });
      await page.waitForTimeout(400);
      const l = await layout([".hud-top", ".game-toolbar", ".exp-hud", ".exp-dock", ".camera-controls", ".touch-pad", ".touch-stick"]);
      check(`site ${w}x${hgt}: panels in the screen and apart`, !l.outside.length && !l.overlaps.length, l);
      // the survivor stands in the clear: nothing but the stick and the buttons over them
      const me = await ev(() => {
        const c = window.__net.myChar();
        const [x, y] = window.__game.exp.site.toScreen(c.x, -(c.lv * 2) - 1);
        const hit = document.elementsFromPoint(x, y).filter((e) => e.closest(".exp-hud, .exp-dock, .camera-controls, .hud-top, .exp-context"));
        return { x, y, covered: hit.map((e) => e.className).slice(0, 3) };
      });
      check(`site ${w}x${hgt}: the survivor is not covered`, !me.covered.length, me);
      const hudH = await ev(() => document.querySelector(".exp-hud").getBoundingClientRect().height);
      check(`site ${w}x${hgt}: noise strip is one slim line`, hudH <= 32, { hudH });
      await page.screenshot({ path: `${out}/site-${w}x${hgt}.png` });
    }
  }
} catch (e) {
  fails++;
  console.log("✘ script error", JSON.stringify({ error: String(e).slice(0, 300) }));
  await page.screenshot({ path: `${out}/error.png` }).catch(() => {});
}
check("no page errors", !errors.length, errors.slice(0, 5));
await browser.close();
console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
