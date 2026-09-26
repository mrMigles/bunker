// Every window at one viewport: screenshots + elements that stick out of the window or get clipped.
// node scripts/qa/menus-layout.mjs W H [outdir]   (needs `pnpm dev`)
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
const [W, H, OUT] = [Number(process.argv[2] ?? 390), Number(process.argv[3] ?? 844), process.argv[4] ?? "artifacts/qa-menus"];
mkdirSync(OUT, { recursive: true });
const touch = W < 1000 || H < 500;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: W, height: H }, hasTouch: touch, isMobile: touch, deviceScaleFactor: touch ? 2 : 1 });
await ctx.addInitScript(() => { localStorage.setItem("bunker.introSeen", "1"); localStorage.setItem("bunker.guide", '{"done":true}'); localStorage.setItem("bunker.tipsOff", "1"); });
const p = await ctx.newPage();
p.setDefaultTimeout(60000);
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
const dbg = (op, arg) => p.evaluate(([op, arg]) => window.__net.send({ k: "debug", op, arg }), [op, arg]);
/** what sticks out of the open window: boxes past its edges and text cut off inside its own box */
const check = (name) => p.evaluate((name) => {
  const m = [...document.querySelectorAll(".modal")].pop();
  if (!m) return { name, open: false };
  const R = m.getBoundingClientRect();
  const out = [], clipped = [];
  const label = (e) => (e.className && typeof e.className === "string" ? "." + e.className.split(" ")[0] : e.tagName.toLowerCase()) + ":" + (e.textContent ?? "").trim().slice(0, 24);
  for (const e of m.querySelectorAll("*")) {
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height || getComputedStyle(e).visibility === "hidden") continue;
    if (r.right > Math.min(R.right, innerWidth) + 2 || r.left < Math.max(R.left, 0) - 2) out.push(label(e));
    const cs = getComputedStyle(e);
    if (e.children.length === 0 && e.textContent.trim() && e.scrollWidth > e.clientWidth + 2 && cs.overflowX !== "visible" && cs.textOverflow !== "ellipsis") clipped.push(label(e));
  }
  // text runs: overlapping each other, or spilling out of the chip / button / card that frames them
  const runs = [];
  const tw = document.createTreeWalker(m, NodeFilter.SHOW_TEXT);
  for (let t; (t = tw.nextNode()); ) {
    if (!t.textContent.trim()) continue;
    const rg = document.createRange(); rg.selectNodeContents(t);
    const r = rg.getBoundingClientRect();
    if (!r.width || !r.height || getComputedStyle(t.parentElement).visibility === "hidden") continue;
    for (const line of rg.getClientRects()) if (line.width > 1) runs.push([t, line]);
  }
  const overlap = [], spill = [];
  const tl = (t) => t.textContent.trim().slice(0, 20);
  for (let i = 0; i < runs.length; i++) {
    const [a, A] = runs[i];
    const box = a.parentElement.closest("button, .chip, .sect, .card, .crew-entry, .stat-tile, .panel");
    if (box) { const Bx = box.getBoundingClientRect(); if (A.right > Bx.right + 2 || A.left < Bx.left - 2) spill.push(tl(a)); }
    if (A.right > Math.min(R.right, innerWidth) + 2) spill.push("offscreen:" + tl(a));
    for (let j = i + 1; j < runs.length; j++) {
      const [c, B] = runs[j];
      if (c === a) continue;
      if (Math.min(A.right, B.right) - Math.max(A.left, B.left) > 3 && Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top) > 3) overlap.push(tl(a) + " × " + tl(c));
    }
  }
  return { name, w: Math.round(R.width), pageScrollX: document.documentElement.scrollWidth > innerWidth, out: out.slice(0, 6), outN: out.length, clipped: clipped.slice(0, 6), spill: spill.slice(0, 6), spillN: spill.length, overlap: overlap.slice(0, 6), overlapN: overlap.length };
}, name);
const res = [];
const snap = async (name) => { await p.waitForTimeout(500); await p.screenshot({ path: `${OUT}/${W}x${H}-${name}.png` }); res.push(await check(name)); };
const closeAll = async () => { for (let i = 0; i < 3; i++) { await p.keyboard.press("Escape"); await p.waitForTimeout(150); } };

await p.goto("http://localhost:5173/" + (touch ? "?mobile=1" : ""), { timeout: 90000 });
await p.getByPlaceholder("Ваше имя").fill("Сергей Длинноимённый");
await p.getByRole("button", { name: "Создать бункер", exact: true }).click();
await p.locator(".card").first().click();
const l = p.getByLabel("Без пролога");
if (await l.count()) await l.check().catch(() => {});
await p.getByRole("button", { name: /Начать/ }).first().click();
await p.waitForFunction(() => window.__net?.pub?.phase === "day" && window.__net.myChar?.(), null, { timeout: 60000 });
await p.waitForTimeout(2500);
await closeAll();
await p.screenshot({ path: `${OUT}/${W}x${H}-00-bunker.png` });

await p.evaluate(() => [...document.querySelectorAll(".game-toolbar button")].find((b) => /Жильцы/.test(b.title))?.click());
await snap("01-crew");
await p.evaluate(() => document.querySelector(".crew-entry")?.click());
await snap("02-dossier");
await closeAll();
for (const [i, tab] of ["gear", "skills", "card"].entries()) {
  await p.evaluate(() => window.__openCharacter());
  await p.waitForTimeout(300);
  if (i) await p.evaluate((i) => document.querySelectorAll(".charscreen-tabs button")[i]?.click(), i);
  await snap(`03-char-${tab}`);
  await closeAll();
}
for (const tab of ["store", "chores", "gazette", "recipes", "milestones"]) {
  await p.evaluate((t) => window.__openBoard(t), tab);
  await snap(`04-board-${tab}`);
  await closeAll();
}
await p.evaluate(() => document.querySelector(".journal-dock-button")?.click());
await snap("05-journal");
await closeAll();
await p.evaluate(() => [...document.querySelectorAll(".game-toolbar button")].find((b) => /Меню/.test(b.title))?.click());
await snap("06-settings");
await closeAll();
await dbg("sortie");
await p.waitForFunction(() => document.body.classList.contains("mode-site") || document.body.classList.contains("mode-map"), null, { timeout: 30000 }).catch(() => {});
await p.waitForTimeout(1500);
await p.screenshot({ path: `${OUT}/${W}x${H}-07-site.png` });
await dbg("leaveSite");
await p.waitForFunction(() => document.body.classList.contains("mode-map"), null, { timeout: 30000 }).catch(() => {});
await p.waitForTimeout(1500);
await p.screenshot({ path: `${OUT}/${W}x${H}-08-map.png` });
// the chart zooms: buttons, wheel, and the view survives the chart's rebuilds
const vb = () => p.evaluate(() => document.querySelector(".exp-map svg.wmap-zoom")?.getAttribute("viewBox"));
const zoom = { start: await vb() };
await p.evaluate(() => document.querySelector(".map-zoom button[title='Приблизить']")?.click());
await p.waitForTimeout(400);
zoom.plus = await vb();
const box = await p.locator(".exp-map svg.wmap-zoom").boundingBox();
if (box && !touch) {
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.wheel(0, 600);
  await p.waitForTimeout(500);
  zoom.wheelOut = await vb();
}
if (box) {
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.down();
  await p.mouse.move(box.x + box.width / 2 - 80, box.y + box.height / 2 - 40, { steps: 6 });
  await p.mouse.up();
  await p.waitForTimeout(500);
  zoom.dragged = await vb();
}
zoom.buttonsVisible = await p.evaluate(() => { const b = document.querySelector(".map-zoom button"); if (!b) return false; const r = b.getBoundingClientRect(); return r.width > 0 && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === b; });
console.log("zoom", JSON.stringify(zoom));
await p.screenshot({ path: `${OUT}/${W}x${H}-09-map-zoomed.png` });
for (const r of res) console.log(JSON.stringify(r));
console.log("errors", JSON.stringify(errs.slice(0, 3)));
await b.close();
