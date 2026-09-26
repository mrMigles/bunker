// Ladders inside a sortie building: walk between floors by tap-to-go and by a held joystick, report
// every time the survivor or a companion hangs on / at the ladder. node scripts/qa/ladder-probe.mjs [W H]
import { chromium } from "@playwright/test";
const [W, H] = [Number(process.argv[2] ?? 390), Number(process.argv[3] ?? 844)];
const touch = W < 1000;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: W, height: H }, hasTouch: touch, isMobile: touch });
await ctx.addInitScript(() => { localStorage.setItem("bunker.introSeen", "1"); localStorage.setItem("bunker.guide", '{"done":true}'); localStorage.setItem("bunker.tipsOff", "1"); });
const p = await ctx.newPage();
p.setDefaultTimeout(60000);
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
await p.goto("http://localhost:5173/" + (touch ? "?mobile=1" : ""), { timeout: 90000 });
await p.getByPlaceholder("Ваше имя").fill("Лестница");
await p.getByRole("button", { name: "Создать бункер", exact: true }).click();
await p.locator(".card").first().click();
const l = p.getByLabel("Без пролога");
if (await l.count()) await l.check().catch(() => {});
await p.getByRole("button", { name: /Начать/ }).first().click();
await p.waitForFunction(() => window.__net?.pub?.phase === "day" && window.__net.myChar?.(), null, { timeout: 60000 });
await p.evaluate(() => window.__net.send({ k: "debug", op: "sortie", arg: "hospital" }));
await p.waitForFunction(() => document.body.classList.contains("mode-site"), null, { timeout: 30000 });
await p.evaluate(() => window.__net.send({ k: "debug", op: "quiet" }));
await p.waitForTimeout(1500);
const state = () => p.evaluate(() => {
  const e = window.__net.pub.mods.expedition, me = window.__net.myChar();
  return { me: { x: +me.x.toFixed(2), lv: me.lv, y: +me.y.toFixed(2), climbing: !!me.climbing, anim: me.anim }, mates: e.squad.filter((id) => id !== me.id).map((id) => { const c = window.__net.pub.chars[id]; return { x: +c.x.toFixed(2), lv: c.lv, climbing: !!c.climbing, anim: c.anim }; }), floors: [...new Set(e.site.rooms.map((r) => r.lv))], rooms: e.site.rooms.map((r) => ({ lv: r.lv, x: r.x, w: r.w, stairs: !!r.stairs })) };
});
await p.evaluate(() => { window.__toasts = []; new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains("toast") || n.querySelector?.(".toast")) window.__toasts.push(n.textContent); }).observe(document.body, { childList: true, subtree: true }); });
const s0 = await state();
const problems = [];
const rooms = s0.rooms.filter((r) => !r.stairs);
// 1) tap-to-go between floors
for (let i = 0; i < 10; i++) {
  const r = rooms[(i * 7 + 3) % rooms.length];
  const tx = r.x + 0.5 + ((i * 3) % Math.max(1, r.w - 1));
  await p.evaluate(([x, lv]) => { window.__toasts.length = 0; window.__net.send({ k: "debug", op: "quiet" }); window.__game.navigation.go(x, lv); }, [tx, r.lv]);
  const ok = await p.waitForFunction(([x, lv]) => { const c = window.__net.myChar(); return c.lv === lv && !c.climbing && Math.abs(c.x - x) < 0.6; }, [tx, r.lv], { timeout: 15000 }).then(() => true, () => false);
  await p.waitForTimeout(3500);
  const st = await state();
  if (!ok) {
    const why = await p.evaluate(() => window.__toasts.splice(0).slice(-3).join(" | ").slice(0, 200));
    const doors = await p.evaluate(() => window.__net.pub.mods.expedition.site.doors.filter((d) => d.state !== "open").map((d) => `${d.state}@${d.x},${d.lv}`).join(" "));
    // a locked door on the way is the game working: only report the rest
    const locked = doors.split(" ").filter((d) => d.startsWith("locked@")).map((d) => d.slice(7).split(",").map(Number));
    const behindLock = locked.some(([dx, dl]) => (dl === r.lv && (dx - tx) * (dx - 2.5) < 0) || (dl === st.me.lv && (dx - st.me.x) * (dx - 2.5) < 0));
    if (!behindLock || st.me.climbing) problems.push({ kind: "tap", to: [tx, r.lv], ...st.me, why, doors });
  }
  for (const m of st.mates) if (m.lv !== st.me.lv || m.climbing) problems.push({ kind: "mate", leader: st.me, mate: m });
}
// 2) the joystick held a little off vertical on the ladder, then sideways (the phone case)
const pad = (mx, my) => p.evaluate(([mx, my]) => { window.__padTest = { mx, my }; }, [mx, my]);
await p.evaluate(() => {
  // feed the held stick through the same input path the touch stick uses
  const g = window.__game;
  const orig = g.navigation.input.bind(g.navigation);
  g.navigation.input = (manual, dt) => (window.__padTest && (window.__padTest.mx || window.__padTest.my) ? orig({ mx: window.__padTest.mx, my: window.__padTest.my, run: false }, dt) : orig(manual, dt));
});
for (const [dir, label] of [[-1, "up"], [1, "down"]]) {
  const st = await state();
  // to the stair column
  await p.evaluate(([lv]) => window.__game.navigation.go(2.5, lv), [st.me.lv]);
  await p.waitForTimeout(3000);
  await pad(0, dir);
  await p.waitForTimeout(350);
  const mid = await state();
  await pad(0.9, 0); // thumb slides sideways
  await p.waitForTimeout(2500);
  await pad(0, 0);
  const after = await state();
  if (after.me.climbing) problems.push({ kind: "sideways-" + label, mid: mid.me, after: after.me });
}
console.log(JSON.stringify({ floors: s0.floors, problems: problems.slice(0, 12), n: problems.length, errors: errs.slice(0, 3) }));
await b.close();
