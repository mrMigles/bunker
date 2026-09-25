// Combat probe: label alignment under zoom/pan, enemy visibility, ally blocking. node combat-probe.mjs <mode> <run>
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
const MODES = { D: { width: 1440, height: 900, touch: false }, MP: { width: 412, height: 915, touch: true }, ML: { width: 915, height: 412, touch: true }, TGP: { width: 412, height: 800, touch: true } };
const mode = process.argv[2] ?? "MP", RUN = process.argv[3] ?? "1";
const M = MODES[mode];
const OUT = "artifacts/qa-smoke/combat2";
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: M.width, height: M.height }, hasTouch: M.touch, isMobile: M.touch, deviceScaleFactor: 1 });
await ctx.addInitScript(() => localStorage.setItem("bunker.tipsOff", "1"));
const p = await ctx.newPage();
p.setDefaultTimeout(60000);
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
const tap = (l) => (M.touch ? l.tap() : l.click());
await p.goto("http://localhost:5173/" + (M.touch ? "?mobile=1" : ""), { timeout: 90000 });
await p.getByPlaceholder("Ваше имя").fill("Бой" + RUN);
await tap(p.getByRole("button", { name: "Создать бункер", exact: true }));
await tap(p.locator(".card").first());
await tap(p.getByRole("button", { name: /Тестовая арена/ }).first());
await p.waitForFunction(() => window.__game?.combat?.active && window.__game.combat.cs?.phase === "plan", null, { timeout: 60000 });
await p.waitForTimeout(1500);
/** distance between each unit's label and the unit's head on screen */
const align = () => p.evaluate(() => {
  const c = window.__game.combat, s = c.cs;
  const labels = [...document.querySelectorAll(".combat-unit-label")];
  const out = [];
  for (const u of Object.values(s.units)) {
    if (u.dead || u.fled) continue;
    const vw = c.views.get(u.id);
    if (!vw) continue;
    const [hx, hy] = c.site.toScreen(vw.x, vw.y + 1.75);
    const el = labels.find((e) => (e.getAttribute("aria-label") ?? "").startsWith(c.displayName(u.id) + ":"));
    if (!el) { out.push({ n: u.name, side: u.side, missing: true, offscreenByDesign: hx < 0 || hx > innerWidth }); continue; }
    const r = el.getBoundingClientRect();
    out.push({ n: u.name, side: u.side, dx: Math.round(r.left + r.width / 2 - hx), dy: Math.round(r.bottom - hy), onScreen: hx > 0 && hx < innerWidth && hy > 0 && hy < innerHeight });
  }
  return out;
});
const summary = (a) => ({ maxDx: Math.max(...a.filter((x) => !x.missing).map((x) => Math.abs(x.dx))), maxDy: Math.max(...a.filter((x) => !x.missing).map((x) => Math.abs(x.dy))), missing: a.filter((x) => x.missing).length, offscreen: a.filter((x) => x.onScreen === false).length });
const res = {};
res.initial = summary(await align());
await p.screenshot({ path: `${OUT}/${mode}-${RUN}-1-initial.png` });
// zoom in twice with the on-screen «+»
const plus = p.locator(".camera-controls button").last();
if (M.touch) for (let i = 0; i < 2; i++) { await tap(plus); await p.waitForTimeout(500); } else { await p.mouse.move(M.width/2, M.height/2); for (let i = 0; i < 4; i++) { await p.mouse.wheel(0, -240); await p.waitForTimeout(200); } }
await p.waitForTimeout(800);
res.zoomIn = summary(await align());
res.zoomInDetail = (await align()).slice(0, 8);
await p.screenshot({ path: `${OUT}/${mode}-${RUN}-2-zoomed.png` });
// pan by drag
if (M.touch) {
  const cdp = await ctx.newCDPSession(p);
  const t = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], i) => ({ id: i + 1, x, y })) });
  const y = M.height * 0.45;
  await t("touchStart", [[M.width * 0.7, y]]);
  for (let i = 1; i <= 10; i++) { await t("touchMove", [[M.width * 0.7 - i * 15, y]]); await p.waitForTimeout(20); }
  await t("touchEnd", []);
} else {
  await p.mouse.move(M.width * 0.6, M.height * 0.45); await p.mouse.down({ button: "right" }).catch(() => {}); await p.mouse.move(M.width * 0.4, M.height * 0.45, { steps: 10 }); await p.mouse.up({ button: "right" }).catch(() => {});
  await p.mouse.wheel(0, -400);
}
await p.waitForTimeout(800);
res.panned = summary(await align());
await p.screenshot({ path: `${OUT}/${mode}-${RUN}-3-panned.png` });
// zoom out twice
const minus = p.locator(".camera-controls button").first();
if (M.touch) for (let i = 0; i < 4; i++) { await tap(minus); await p.waitForTimeout(400); } else for (let i = 0; i < 8; i++) { await p.mouse.wheel(0, 240); await p.waitForTimeout(200); }
await p.waitForTimeout(800);
res.zoomOut = summary(await align());
await p.screenshot({ path: `${OUT}/${mode}-${RUN}-4-zoomedout.png` });
// recentre
if (M.touch) { await tap(p.locator(".camera-controls button").nth(1)); } else await p.keyboard.press("KeyF"); await p.waitForTimeout(800);
res.recentred = summary(await align());
// ally blocking over a few rounds: reach size and cells lost to allies
const block = [];
for (let r = 0; r < 6; r++) {
  const st = await p.evaluate(() => { const c = window.__game.combat, s = c.cs; if (!s || s.result) return null; const u = c.myUnit(); if (!u || u.down) return { down: true };
    const allies = Object.values(s.units).filter((x) => x.side === u.side && x.id !== u.id && !x.dead && !x.down);
    const adjAlly = allies.filter((a) => a.floor === u.floor && Math.abs(a.col - u.col) <= 2).length;
    return { round: s.round, phase: s.phase, ap: u.ap, reach: c.reach.length, alliesNear: adjAlly, alliesOnFloor: allies.filter((a) => a.floor === u.floor).length }; });
  if (!st) break;
  block.push(st);
  if (st.down) break;
  // attack nearest reachable foe or move forward, then end turn
  await p.evaluate(() => { const c = window.__game.combat, s = c.cs, u = c.myUnit(); if (!u || u.ap <= 0) return; const f = Object.values(s.units).filter((x) => x.side === "enemy" && !x.dead && !x.down && x.floor === u.floor).sort((a, b) => Math.abs(a.col - u.col) - Math.abs(b.col - u.col))[0]; if (f) c.tryAdd(Math.abs(f.col - u.col) <= 1 ? { t: "melee", target: f.id } : { t: "shoot", target: f.id }); });
  await p.waitForTimeout(900);
  const round = await p.evaluate(() => window.__game.combat.cs?.round ?? 0);
  const btn = p.locator(".combat-ready").first();
  if (await btn.count()) await btn.click({ force: true }).catch(() => {});
  await p.waitForFunction((r) => { const s = window.__game.combat.cs; return !s || s.result || (s.round > r && s.phase === "plan"); }, round, { timeout: 60000 }).catch(() => {});
  await p.waitForTimeout(600);
  if (r === 1) await p.screenshot({ path: `${OUT}/${mode}-${RUN}-5-round3.png` });
}
res.block = block;
res.errors = errs.slice(0, 3);
console.log(JSON.stringify({ mode, run: RUN, ...res }));
await b.close();
