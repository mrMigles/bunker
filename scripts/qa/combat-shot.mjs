// Enter the test arena at a viewport, optionally run steps, screenshot. node scripts/qa/combat-shot.mjs W H out.png [steps-js]
// steps-js runs in node with (p, M) in scope before the shot, e.g. "await p.locator('.camera-controls button').last().tap()"
import { chromium } from "@playwright/test";
const [W, H, OUT, STEPS] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], process.argv[5] ?? ""];
const M = { touch: W < 1000 };
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: W, height: H }, hasTouch: M.touch, isMobile: M.touch });
await ctx.addInitScript(() => localStorage.setItem("bunker.tipsOff", "1"));
const p = await ctx.newPage();
p.setDefaultTimeout(60000);
p.on("pageerror", (e) => console.log("pageerror", e.message));
const tap = (l) => (M.touch ? l.tap() : l.click());
await p.goto("http://localhost:5173/" + (M.touch ? "?mobile=1" : ""), { timeout: 90000 });
await p.getByPlaceholder("Ваше имя").fill("Shot");
await tap(p.getByRole("button", { name: "Создать бункер", exact: true }));
await tap(p.locator(".card").first());
await tap(p.getByRole("button", { name: /Тестовая арена/ }).first());
await p.waitForFunction(() => window.__game?.combat?.active && window.__game.combat.cs?.phase === "plan", null, { timeout: 60000 });
await p.waitForTimeout(1500);
if (STEPS) await new Function("p", "M", "tap", `return (async () => { ${STEPS} })()`)(p, M, tap);
await p.waitForTimeout(600);
console.log(JSON.stringify(await p.evaluate(() => { const c = window.__game.combat, s = c.site, f = c.cs.field; const [l, t] = s.toScreen(0, 0.3), [r, bt] = s.toScreen(f.cols, -f.floors * 2); return { field: [l, t, r, bt].map(Math.round), cell: Math.round((r - l) / f.cols), panel: (() => { const b = c.panel.getBoundingClientRect(); return [Math.round(b.top), Math.round(b.bottom)]; })() }; })));
await p.screenshot({ path: OUT });
await b.close();
