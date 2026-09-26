// Layout pass for the small overlap issues: lobby, day tips, council, build, pedal minigame, table,
// sortie site and the wasteland map at one viewport. node scripts/qa/layout-shots.mjs W H outdir [only,...]
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
const [W, H, OUT, ONLY] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4] ?? "artifacts/qa-layout", process.argv[5]];
mkdirSync(OUT, { recursive: true });
const want = (s) => !ONLY || ONLY.split(",").includes(s);
const touch = W < 1000;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: W, height: H }, hasTouch: touch, isMobile: touch });
await ctx.addInitScript(() => { localStorage.setItem("bunker.introSeen", "1"); localStorage.setItem("bunker.guide", '{"done":true}'); });
const p = await ctx.newPage();
p.setDefaultTimeout(60000);
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
const shot = (n) => p.screenshot({ path: `${OUT}/${W}x${H}-${n}.png` });
const dbg = (op, arg) => p.evaluate(([op, arg]) => window.__net.send({ k: "debug", op, arg }), [op, arg]);
/** rectangles of selectors, and which pairs overlap */
const overlaps = (pairs) => p.evaluate((pairs) => {
  const r = (s) => { const e = [...document.querySelectorAll(s)].find((x) => { const b = x.getBoundingClientRect(); return b.width && b.height && getComputedStyle(x).visibility !== "hidden"; }); return e?.getBoundingClientRect(); };
  const out = {};
  for (const [a, b] of pairs) { const A = r(a), B = r(b); out[a + " × " + b] = A && B ? Math.max(0, Math.min(A.right, B.right) - Math.max(A.left, B.left)) * Math.max(0, Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top)) > 4 : null; }
  return out;
}, pairs);
const res = {};
await p.goto("http://localhost:5173/" + (touch ? "?mobile=1" : ""), { timeout: 90000 });
await p.getByPlaceholder("Ваше имя").fill("Раскладка");
await p.getByRole("button", { name: "Создать бункер", exact: true }).click();
await p.locator(".card").first().click();
await p.waitForTimeout(800);
if (want("lobby")) {
  await shot("lobby");
  res.lobby = await p.evaluate(() => {
    // #11: buttons over the first card's text
    const card = document.querySelector(".card")?.getBoundingClientRect();
    const btns = [...document.querySelectorAll(".lobby-actions button, .lobby button")].map((x) => x.getBoundingClientRect()).filter((r) => r.width);
    return { cardBottom: Math.round(card?.bottom ?? 0), btnsOverCard: btns.filter((r) => card && r.top < card.bottom && r.bottom > card.top && r.left < card.right && r.right > card.left).length };
  });
}
const l = p.getByLabel("Без пролога");
if (await l.count()) await l.check().catch(() => {});
await p.getByRole("button", { name: /Начать/ }).first().click();
await p.waitForFunction(() => window.__net?.pub?.phase === "day" && window.__net.myChar?.(), null, { timeout: 60000 });
await p.evaluate(() => localStorage.removeItem("bunker.tipsOff"));
await p.waitForTimeout(5000);
if (want("day")) { await shot("day-tip"); res.day = await overlaps([[".tip-card", ".game-toolbar"], [".tip-card", ".game-dock"], [".tip-card", ".objectives"]]); }
await p.evaluate(() => document.querySelector(".tip-card .primary")?.click());
if (want("build")) {
  await p.keyboard.press("KeyB").catch(() => {});
  if (touch) await p.evaluate(() => window.__game.build.toggle(true));
  await p.waitForTimeout(1200);
  await shot("build");
  res.build = await overlaps([[".build-strip .build-all, .build-strip button", ".build-strip .build-card, .build-strip .build-room"], [".panel[style*='300px']", ".hud-top"]]);
  await p.evaluate(() => window.__game.build.toggle(false));
}
if (want("pedal")) {
  const bike = await p.evaluate(() => Object.values(window.__net.pub.objs).find((o) => o.kind === "bike_gen")?.id);
  await p.evaluate(() => { const v = window.__net.pub, o = Object.values(v.objs).find((o) => o.kind === "bike_gen"); window.__game.navigation.go(o.x + 0.5, o.lv); });
  await p.waitForFunction(() => { const v = window.__net.pub, c = window.__net.myChar(), o = Object.values(v.objs).find((o) => o.kind === "bike_gen"); return o.lv === c.lv && Math.abs(o.x + 0.5 - c.x) < 1; }, null, { timeout: 40000 }).catch(() => {});
  res.pedalReach = await p.evaluate(() => { const v = window.__net.pub, c = window.__net.myChar(), o = Object.values(v.objs).find((o) => o.kind === "bike_gen"); return { me: [+c.x.toFixed(1), c.lv], bike: [o.x, o.lv] }; });
  await p.evaluate((id) => window.__net.send({ k: "do", a: "pedal", tt: "obj", t: id }), bike);
  await p.waitForTimeout(2500);
  await shot("pedal");
  res.pedal = await p.evaluate(() => {
    const m = document.querySelector(".mini-modal");
    const auto = [...(m?.querySelectorAll("button") ?? [])].find((x) => /сам/.test(x.textContent));
    const r = auto?.getBoundingClientRect();
    return { modal: !!m, text: m?.textContent?.slice(0, 160), autoBtnVisible: r ? r.bottom <= innerHeight : null };
  });
  await p.keyboard.press("Escape");
  await p.evaluate(() => document.querySelector(".mini-modal .close, .modal .close")?.click());
  await p.evaluate(() => window.__net.send({ k: "stop" }));
  await p.waitForTimeout(800);
}
if (want("table")) {
  await dbg("sit");
  await p.waitForTimeout(2500);
  await shot("table");
  res.table = await overlaps([[".game-dock", ".table-panel, .table-ui .panel"], [".game-toolbar", ".table-panel, .table-ui .panel"]]);
  res.tableLeaveVisible = await p.evaluate(() => { const x = [...document.querySelectorAll("button")].find((b) => /Встать/.test(b.textContent)); if (!x) return null; const r = x.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return x.contains(top); });
  await p.keyboard.press("Escape");
  await p.evaluate(() => window.__net.send({ k: "stop" }));
  await p.waitForTimeout(800);
}
if (want("site")) {
  await dbg("sortie");
  await p.waitForFunction(() => document.body.classList.contains("mode-site"), null, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(600);
  await shot("site-enter");
  res.site = await overlaps([[".toast", ".exp-hud"], [".exp-dock-hint", ".hud-me"], [".help", ".hud-me"]]);
  await p.waitForTimeout(3000);
  await shot("site");
}
if (want("map")) {
  await dbg("leaveSite");
  await p.waitForFunction(() => document.body.classList.contains("mode-map"), null, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(1500);
  await shot("map");
  res.map = await p.evaluate(() => {
    const labels = [...document.querySelectorAll(".exp-map text, .exp-map-inner text")].map((t) => t.getBoundingClientRect()).filter((r) => r.width && r.top >= 0 && r.bottom <= innerHeight);
    let over = 0;
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) { const A = labels[i], B = labels[j]; if (Math.min(A.right, B.right) - Math.max(A.left, B.left) > 2 && Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top) > 2) over++; }
    const hits = [...document.querySelectorAll(".exp-map g[role=button], .exp-map-inner g[role=button]")].map((g) => g.getBoundingClientRect()).filter((r) => r.width);
    const font = Math.min(...labels.map((r) => r.height));
    return { labels: labels.length, overlappingPairs: over, smallestTarget: hits.length ? Math.round(Math.min(...hits.map((r) => Math.min(r.width, r.height)))) : null, minLabelH: Math.round(font) };
  });
}
if (want("council")) {
  await dbg("night");
  await p.waitForFunction(() => window.__net.pub.phase === "night" && window.__net.pub.council, null, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(2500);
  await shot("council");
  res.council = await overlaps([[".council-panel", ".hud-top"], [".tip-card", ".council-panel .council-head"], [".tip-card", ".council-summary"]]);
  res.councilRows = await p.evaluate(() => { const panel = document.querySelector(".council-panel").getBoundingClientRect(); const row = document.querySelector(".ration-row")?.getBoundingClientRect(); return { firstRowVisible: row ? row.bottom <= panel.bottom : null, scrollable: document.querySelector(".council-panel").scrollHeight > document.querySelector(".council-panel").clientHeight }; });
}
res.errors = errs.slice(0, 3);
console.log(JSON.stringify(res));
await b.close();
