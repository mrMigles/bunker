// Sortie windows at one viewport: the prep window (with «без меня» on the chart), «Связь с отрядом»,
// and the wasteland map's side panel — what sticks out, what cannot be reached.
// node scripts/qa/sortie-layout.mjs W H   (needs `pnpm dev`)
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
const [W, H, OUT] = [Number(process.argv[2] ?? 390), Number(process.argv[3] ?? 844), "artifacts/qa-sortie"];
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
/** inside `root`: boxes past the screen / the window, text crossing text, and buttons nobody can reach */
const check = (name, sel) => p.evaluate(([name, sel]) => {
  const m = [...document.querySelectorAll(sel)].filter((x) => x.getBoundingClientRect().width).pop();
  if (!m) return { name, open: false };
  const R = m.getBoundingClientRect();
  const lbl = (e) => (typeof e.className === "string" && e.className ? "." + e.className.split(" ")[0] : e.tagName.toLowerCase()) + ":" + (e.textContent ?? "").trim().slice(0, 24);
  const out = [];
  for (const e of m.querySelectorAll("*")) {
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height || getComputedStyle(e).visibility === "hidden" || e.closest("svg")) continue;
    if (r.right > Math.min(R.right, innerWidth) + 2 || r.left < Math.max(R.left, 0) - 2) out.push(lbl(e));
  }
  const runs = [];
  const tw = document.createTreeWalker(m, NodeFilter.SHOW_TEXT);
  for (let t; (t = tw.nextNode()); ) {
    if (!t.textContent.trim() || t.parentElement.closest("svg")) continue;
    const rg = document.createRange(); rg.selectNodeContents(t);
    for (const l of rg.getClientRects()) if (l.width > 1) runs.push([t, l]);
  }
  const overlap = [];
  for (let i = 0; i < runs.length; i++) for (let j = i + 1; j < runs.length; j++) {
    const [a, A] = runs[i], [c, B] = runs[j];
    if (a !== c && Math.min(A.right, B.right) - Math.max(A.left, B.left) > 3 && Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top) > 3) overlap.push(a.textContent.trim().slice(0, 18) + " × " + c.textContent.trim().slice(0, 18));
  }
  // every button can be brought on screen (scrolled into view) and is then on top
  const unreachable = [];
  for (const btn of m.querySelectorAll("button")) {
    if (!btn.getBoundingClientRect().width || btn.closest(".map-zoom")) continue;
    btn.scrollIntoView({ block: "center" });
    const r = btn.getBoundingClientRect();
    const top = document.elementFromPoint(Math.min(innerWidth - 1, r.left + r.width / 2), Math.min(innerHeight - 1, r.top + r.height / 2));
    if (r.bottom > innerHeight + 1 || r.top < -1 || r.right > innerWidth + 1 || !(top && (btn === top || btn.contains(top)))) unreachable.push(lbl(btn) + (top ? " под " + lbl(top) : ""));
  }
  m.scrollTop = 0;
  return { name, out: out.slice(0, 5), outN: out.length, overlap: overlap.slice(0, 5), unreachable: unreachable.slice(0, 6) };
}, [name, sel]);
const res = [];
const shot = (n) => p.screenshot({ path: `${OUT}/${W}x${H}-${n}.png` });

await p.goto("http://localhost:5173/" + (touch ? "?mobile=1" : ""), { timeout: 90000 });
await p.getByPlaceholder("Ваше имя").fill("Разведчик");
await p.getByRole("button", { name: "Создать бункер", exact: true }).click();
await p.locator(".card").first().click();
const l = p.getByLabel("Без пролога");
if (await l.count()) await l.check().catch(() => {});
await p.getByRole("button", { name: /Начать/ }).first().click();
await p.waitForFunction(() => window.__net?.pub?.phase === "day" && window.__net.myChar?.(), null, { timeout: 60000 });
await p.waitForTimeout(1500);
await p.keyboard.press("Escape");
// 1) the prep window from the terminal
const terminal = await p.evaluate(() => Object.values(window.__net.pub.objs).find((o) => o.kind === "sortie_terminal"));
await p.evaluate((t) => { const c = window.__net.pub.chars[window.__net.priv.char]; window.__net.send({ k: "debug", op: "hour", arg: 8 }); window.__game.navigation.go(t.x + 0.5, t.lv, () => window.__net.send({ k: "do", a: "sortie", tt: "obj", t: t.id })); }, terminal);
await p.waitForSelector(".exp-prep-modal", { timeout: 40000 });
await p.waitForTimeout(800);
await shot("01-prep");
res.push(await check("prep", ".modal.exp-prep-modal, .exp-prep-modal"));
// «без меня» on the chart: tap another place, the choice and the trip line follow
res.push(await p.evaluate(() => {
  const sel = document.querySelector(".exp-sendbots select");
  const before = sel?.value;
  const g = [...document.querySelectorAll(".exp-send-map g[role=button]")].map((x) => x).find((x) => x.getAttribute("aria-label") && x.getAttribute("aria-label") !== "Наш бункер" && !(x.getAttribute("aria-label") || "").includes("Торгов"));
  return { name: "send-map", places: document.querySelectorAll(".exp-send-map g[role=button]").length, before, trip: document.querySelector(".exp-trip")?.textContent, pickLabel: g?.getAttribute("aria-label") };
}));
const far = await p.evaluate(() => { const o = [...document.querySelectorAll(".exp-sendbots option")]; return o[o.length - 1]?.value; });
await p.evaluate((v) => { const s = document.querySelector(".exp-sendbots select"); s.value = v; s.dispatchEvent(new Event("change")); }, far);
await p.waitForTimeout(600);
res.push({ name: "send-far", trip: await p.evaluate(() => document.querySelector(".exp-trip")?.textContent) });
const tap = await p.evaluate(() => { document.querySelector(".exp-send-map")?.scrollIntoView({ block: "center" }); const g = [...document.querySelectorAll(".exp-send-map g[role=button]")].find((x) => /магазин|Заправка|Школа/.test(x.getAttribute("aria-label") || "")); const r = g?.querySelector("circle")?.getBoundingClientRect(); return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2, label: g.getAttribute("aria-label") } : null; });
if (tap) {
  await p.mouse.click(tap.x, tap.y);
  await p.waitForTimeout(600);
  res.push({ name: "send-tap", tapped: tap.label, selected: await p.evaluate(() => { const s = document.querySelector(".exp-sendbots select"); return s?.selectedOptions[0]?.textContent; }), trip: await p.evaluate(() => document.querySelector(".exp-trip")?.textContent) });
}
await shot("02-prep-sendmap");
// 2) send them, then «Связь с отрядом» from the terminal
await p.evaluate(() => [...document.querySelectorAll(".exp-sendbots button")].find((b) => /без меня/.test(b.textContent))?.click());
await p.waitForTimeout(1500);
await p.evaluate((t) => window.__net.send({ k: "do", a: "sortie", tt: "obj", t: t.id }), terminal);
await p.waitForSelector(".op-modal", { timeout: 20000 }).catch(() => {});
await p.waitForTimeout(800);
await shot("03-operator");
res.push(await check("operator", ".modal.op-modal, .op-modal"));
await p.keyboard.press("Escape");
// 3) the map with the player in the squad
await dbg("sortie");
await p.waitForFunction(() => document.body.classList.contains("mode-site"), null, { timeout: 30000 }).catch(() => {});
await dbg("leaveSite");
await p.waitForFunction(() => document.body.classList.contains("mode-map"), null, { timeout: 30000 }).catch(() => {});
await p.waitForTimeout(1500);
await shot("04-map");
res.push(await check("map", ".exp-map"));
for (const r of res) console.log(JSON.stringify(r));
console.log("errors", JSON.stringify(errs.slice(0, 3)));
await b.close();
