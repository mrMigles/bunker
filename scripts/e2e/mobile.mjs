// Phones and Telegram: `node scripts/e2e/mobile.mjs` (needs `pnpm dev`).
// A landscape phone opens the game from a Telegram chat (fake initData; the dev server has no bot token
// and trusts it): straight into the chat's bunker with the real name, no code, no menu. On-screen stick
// and context buttons instead of key hints; the stick walks, ✋ picks up, the bunker has its buttons.
// A second chat member lands in the same bunker; a web player with the code is turned away.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "artifacts/e2e";
mkdirSync(OUT, { recursive: true });
const report = { steps: [], errors: [], ok: true };
const step = (name, ok, data = {}) => {
  report.steps.push({ name, ok, ...data });
  console.log(`${ok ? "✔" : "✘"} ${name}`, Object.keys(data).length ? JSON.stringify(data) : "");
  if (!ok) report.ok = false;
};
const URL = "http://localhost:5173";
const chat = String(-100000 - Math.floor(Math.random() * 1e6));
const initData = (id, first, last) =>
  new URLSearchParams({
    user: JSON.stringify({ id, first_name: first, last_name: last, language_code: "ru" }),
    chat: JSON.stringify({ id: Number(chat), type: "group", title: "Соседи по подъезду" }),
    chat_instance: "ci" + chat,
    auth_date: String(Math.floor(Date.now() / 1000)),
    hash: "dev",
  }).toString();
const tgUrl = (id, first, last) => `${URL}/#tgWebAppData=${encodeURIComponent(initData(id, first, last))}&tgWebAppPlatform=android&tgWebAppVersion=8.0`;

const browser = await chromium.launch({ headless: true });
const phone = {
  viewport: { width: 844, height: 390 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
  userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36",
};
const ctx = await browser.newContext(phone);
// Telegram's script is not reachable from the test box: stub it
await ctx.route("https://telegram.org/**", (r) => r.fulfill({ contentType: "text/javascript", body: "window.Telegram={WebApp:{initData:'',ready(){},expand(){},disableVerticalSwipes(){},setHeaderColor(){},setBackgroundColor(){},requestFullscreen(){},BackButton:{show(){},hide(){},onClick(){}},HapticFeedback:{impactOccurred(){},notificationOccurred(){}}}}" }));
const page = await ctx.newPage();
page.on("pageerror", (e) => report.errors.push(e.message));
page.on("console", (m) => m.type() === "error" && !/WebSocket|4\d\d/.test(m.text()) && report.errors.push(m.text()));
const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });
const visible = (sel) => ev((s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && getComputedStyle(e).display !== "none" && getComputedStyle(e).visibility !== "hidden"; }, sel);

try {
  // ------------------------------------------------ Telegram: straight into the chat's bunker
  await page.goto(tgUrl(7001, "Анна", "Петрова"));
  await page.locator(".lobby .card").first().waitFor({ timeout: 15000 });
  const lobby = await ev(() => ({ code: window.__net.code, head: document.querySelector(".lobby .row")?.textContent ?? "", menu: !!document.querySelector(".menu"), mobile: document.documentElement.classList.contains("mobile"), name: window.__net.pub.players[window.__net.priv.pid]?.name, pid: window.__net.priv.pid }));
  step("Telegram opens the chat's bunker directly, no menu", lobby.code?.startsWith("T") && !lobby.menu, lobby);
  step("the player carries the Telegram name and id", lobby.name === "Анна П." && lobby.pid === "tg_7001", lobby);
  step("the lobby names the chat instead of showing a code", /Соседи по подъезду/.test(lobby.head) && !lobby.head.includes(lobby.code), { head: lobby.head });
  step("a phone gets the mobile layout", lobby.mobile, lobby);
  await shot("m-01-tg-lobby");

  // a second member of the same chat lands in the same bunker
  const ctx2 = await browser.newContext(phone);
  await ctx2.route("https://telegram.org/**", (r) => r.fulfill({ contentType: "text/javascript", body: "window.Telegram={WebApp:{ready(){},expand(){}}}" }));
  const p2 = await ctx2.newPage();
  await p2.goto(tgUrl(7002, "Борис", ""));
  await p2.locator(".lobby .card").first().waitFor({ timeout: 15000 });
  const code2 = await p2.evaluate(() => window.__net.code);
  await wait(800);
  const players = await ev(() => Object.values(window.__net.pub.players).map((p) => p.name));
  step("a second chat member joins the same bunker", code2 === lobby.code && players.includes("Борис"), { code2, players });

  // a web player who knows the code is turned away
  const p3 = await browser.newPage();
  await p3.goto(URL);
  await p3.getByPlaceholder("Ваше имя").fill("Чужак");
  await p3.locator("input").nth(1).fill(lobby.code).catch(() => {});
  const joinErr = await p3.evaluate(async (code) => { try { await window.__net.join(code, "Чужак"); return "joined"; } catch (e) { return String(e?.message ?? e); } }, lobby.code);
  step("the chat's bunker refuses players from outside Telegram", /Telegram/.test(joinErr), { joinErr });
  await p3.close();

  // ------------------------------------------------ prologue on the phone
  await page.locator(".lobby .card").first().tap();
  await page.getByRole("button", { name: "Готов", exact: true }).tap();
  await p2.locator(".lobby .card").first().tap();
  await p2.getByRole("button", { name: "Готов", exact: true }).tap();
  await page.getByRole("button", { name: /Начать/ }).first().tap();
  await page.waitForFunction(() => window.__net?.pub?.phase === "prologue", null, { timeout: 20000 });
  await wait(1500);
  const ui = await ev(() => ({
    stick: !!document.querySelector(".touch-stick:not(.hidden)"),
    pad: [...document.querySelectorAll(".touch-pad .touch-btn small")].map((s) => s.textContent),
    help: (() => { const h = document.querySelector(".help"); return h ? getComputedStyle(h).display : "none"; })(),
    keys: [...document.querySelectorAll(".prologue-actions .key")].filter((k) => getComputedStyle(k).display !== "none").length,
    tip: document.querySelector(".tip-card:not(.hidden)")?.textContent ?? "",
  }));
  step("prologue: stick and ✋ on screen, no key hints", ui.stick && ui.pad.includes("Взять") && ui.help === "none" && ui.keys === 0, ui);
  step("the tutorial speaks of touches, not keys", !ui.tip || (/коснитесь/i.test(ui.tip) && !/<b>E<\/b>|Пробел/.test(ui.tip)), { tip: ui.tip.slice(0, 90) });
  await shot("m-02-prologue");
  await page.getByRole("button", { name: "Понятно" }).tap().catch(() => {});
  // push the stick right for a second: the character walks
  const x0 = await ev(() => window.__net.myChar().x);
  const box = await page.locator(".touch-stick").boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
  await touch("touchStart", cx, cy);
  for (let i = 1; i <= 5; i++) await touch("touchMove", cx + i * 12, cy);
  await wait(1400);
  const running = await ev(() => window.__net.myChar().anim);
  await touch("touchEnd");
  const x1 = await ev(() => window.__net.myChar().x);
  step("the stick walks the character", Math.abs(x1 - x0) > 1, { x0, x1, anim: running });
  // walk to the nearest loot and take it with ✋
  await ev(() => {
    const p = window.__net.pub.mods.prologue, c = window.__net.myChar();
    const it = p.items.filter((i) => i.lv === 1 && !i.by).sort((a, b) => Math.abs(a.x - c.x) - Math.abs(b.x - c.x))[0];
    window.__game.navigation.go(it.x, it.lv);
  });
  await page.waitForFunction(() => document.querySelectorAll(".prologue-actions .opt:not(.dis)").length > 0, null, { timeout: 12000 }).catch(() => {});
  await ev(() => { const n = window.__net; const orig = n.send.bind(n); window.__sent = []; n.send = (m) => (window.__sent.push(m), orig(m)); });
  const h0 = await ev(() => window.__net.myChar().hands.length);
  const before = await ev(() => ({ acts: window.__game.pro.actions.map((a) => a.a + (a.reason ? "!" + a.reason : "")), held: [...(window.__held ?? [])], sel: window.__game.pro.sel, under: (() => { const b = document.querySelector(".touch-pad .touch-btn.big").getBoundingClientRect(); const e = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return e?.tagName + "." + e?.className; })() }));
  console.log("before ✋", JSON.stringify(before));
  for (let i = 0; i < 3; i++) {
    await page.locator(".touch-pad .touch-btn.big").tap();
    await wait(1200);
    if (await ev(() => window.__sent.length)) break;
    console.log("retry ✋", JSON.stringify(await ev(() => ({ acts: window.__game.pro.actions.map((a) => a.a), active: window.__game.pro.active, modal: !!document.querySelector(".modal") }))));
  }
  const h1 = await ev(() => window.__net.myChar().hands.length);
  const sent = await ev(() => window.__sent.map((m) => m.k + ":" + (m.a ?? "")));
  step("✋ does the highlighted thing (takes it)", sent.some((m) => m.startsWith("pdo")) , { h0, h1, sent });
  const pad2 = await ev(() => [...document.querySelectorAll(".touch-pad .touch-btn small")].map((s) => s.textContent));
  step("with things in hand a «Бросить» button appears", h1 === 0 || pad2.includes("Бросить"), { h1, pad2 });
  await ev(() => window.__game.pro.returnHome());
  await p2.evaluate(() => window.__game.pro.returnHome());

  // ------------------------------------------------ bunker on the phone
  await page.waitForFunction(() => window.__net.pub.phase === "day", null, { timeout: 90000 });
  await wait(4000);
  await page.getByRole("button", { name: "Понятно" }).tap().catch(() => {});
  await shot("m-03-bunker");
  const layout = await ev(() => {
    const r = (s) => { const e = document.querySelector(s); if (!e || getComputedStyle(e).display === "none") return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
    return { stick: r(".touch-stick"), me: r(".hud-me"), dock: r(".game-dock"), actions: r(".action-dock"), pad: r(".touch-pad"), top: r(".hud-top"), W: innerWidth, H: innerHeight, scrollW: document.documentElement.scrollWidth };
  });
  const overlap = (a, b) => a && b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  step("bunker HUD fits the phone without overlapping the stick", layout.stick && !overlap(layout.stick, layout.me) && !overlap(layout.stick, layout.actions) && layout.scrollW <= layout.W, layout);
  // walk to something and use ✋
  await ev(() => {
    const o = Object.values(window.__net.pub.objs).find((o) => o.kind === "water_tank" || o.kind === "shelf" || o.kind === "bed");
    window.__game.navigation.go(o.x + 0.5, o.lv);
  });
  await page.waitForFunction(() => document.querySelector(".touch-pad .touch-btn.big"), null, { timeout: 12000 }).catch(() => {});
  step("near things the ✋ «Действие» button appears", !!(await page.$(".touch-pad .touch-btn.big")));
  // «Персонаж» from the dock, then close it
  await page.locator(".game-dock button").first().tap();
  await page.locator(".modal").first().waitFor({ timeout: 5000 }).catch(() => {});
  const modalFits = await ev(() => { const m = document.querySelector(".modal"); if (!m) return null; const b = m.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), W: innerWidth, H: innerHeight, stickHidden: !!document.querySelector(".touch-stick.hidden") }; });
  step("windows fit the phone and hide the stick", modalFits && modalFits.w <= modalFits.W && modalFits.stickHidden, modalFits);
  await shot("m-04-character");
  await page.keyboard.press("Escape");
  // build mode: width buttons instead of [ ]
  await page.getByRole("button", { name: /Строить/ }).first().tap().catch(async () => ev(() => window.__game.build.toggle(true)));
  await wait(600);
  const buildPad = await ev(() => [...document.querySelectorAll(".touch-pad .touch-btn small")].map((s) => s.textContent));
  step("build mode: «Уже / Шире / Готово» buttons", buildPad.includes("Шире") && buildPad.includes("Готово"), { buildPad });
  await shot("m-05-build");
  await page.locator(".touch-pad .touch-btn", { hasText: "Готово" }).tap();
  await wait(400);
  step("«Готово» leaves build mode", await ev(() => !window.__game.build.active));
  // pinch zoom
  await page.getByRole("button", { name: "Понятно" }).tap().catch(() => {});
  await wait(300);
  const vh0 = await ev(() => window.__game.r.viewH);
  await ev(() => { window.__pd = []; window.addEventListener("pointerdown", (e) => window.__pd.push(e.pointerType + ":" + e.target.className), true); window.addEventListener("pointermove", (e) => window.__pd.push("m"), true); });
  const under = await ev(() => { const e = document.elementFromPoint(422, 195); return e?.tagName + "." + e?.className; });
  const W = 844, H = 390;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: W / 2 - 40, y: H / 2, id: 1 }, { x: W / 2 + 40, y: H / 2, id: 2 }] });
  for (let i = 1; i <= 6; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: W / 2 - 40 - i * 20, y: H / 2, id: 1 }, { x: W / 2 + 40 + i * 20, y: H / 2, id: 2 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  const vh1 = await ev(() => window.__game.r.viewH);
  console.log("pd", JSON.stringify(await ev(() => window.__pd.slice(0, 12))));
  step("pinch zooms the bunker in", vh1 < vh0 * 0.8, { vh0, vh1, under });
  // ------------------------------------------------ sortie on the phone
  await ev(() => window.__net.send({ k: "debug", op: "sortie" }));
  await page.waitForFunction(() => window.__game.exp.mode === "site", null, { timeout: 20000 });
  await ev(() => window.__net.send({ k: "debug", op: "quiet" }));
  await page.waitForFunction(() => !window.__net.pub.mods.combat?.active && document.body.classList.contains("mode-site"), null, { timeout: 30000 }).catch(() => {});
  await wait(1500);
  await page.getByRole("button", { name: "Понятно" }).tap().catch(() => {});
  const sitePad = await ev(() => [...document.querySelectorAll(".touch-pad .touch-btn small")].map((s) => s.textContent));
  step("site: Камень / Обыск buttons, stick stays", ["Камень", "Обыск"].every((x) => sitePad.includes(x)) && !!(await page.$(".touch-stick:not(.hidden)")), { sitePad });
  await ev(() => { window.__sent = []; });
  const lightOff = await page.locator(".exp-dock button").nth(1).isDisabled();
  if (!lightOff) await page.locator(".exp-dock button").nth(1).tap();
  await wait(300);
  step("the site bar's flashlight button works by touch", lightOff || (await ev(() => window.__sent.some((m) => m.k === "expLight"))), { lightOff });
  await shot("m-06-site");
  await page.locator(".exp-dock button").nth(2).tap();
  await page.locator(".modal").first().waitFor({ timeout: 5000 }).catch(() => {});
  step("the backpack opens by touch", !!(await page.$(".modal")));
  await shot("m-07-backpack");
  await page.keyboard.press("Escape");
  await ev(() => window.__net.send({ k: "debug", op: "leaveSite" }));
  await ev(() => window.__net.send({ k: "expHome" }));
  await ev(() => window.__net.send({ k: "debug", op: "speed", arg: 20 }));
  await page.waitForFunction(() => !window.__net.pub.mods.expedition && window.__net.myChar()?.status !== "away", null, { timeout: 60000 }).catch(() => {});
  await ev(() => window.__net.send({ k: "debug", op: "speed", arg: 1 }));
  await wait(800);
  // ------------------------------------------------ a minigame by finger
  await ev(() => new Promise((res) => {
    const o = Object.values(window.__net.pub.objs).find((o) => o.kind === "hand_pump");
    if (!o) return res(false);
    window.__game.navigation.go(o.x + 0.5, o.lv, () => { window.__net.send({ k: "do", a: "pump", tt: "obj", t: o.id }); res(true); });
  }));
  const mini = await page.waitForSelector(".mini-modal", { timeout: 20000 }).then(() => true).catch(() => false);
  const mbox = mini ? await page.locator(".mini-canvas").boundingBox() : null;
  step("the pump minigame fits the phone screen", !!mbox && mbox.y >= 0 && mbox.y + mbox.height <= 390 + 1, { mbox });
  if (mbox) {
    const dirty0 = await ev(() => window.__net.pub.res.water_dirty ?? 0);
    const x = mbox.x + mbox.width * 0.25;
    for (let i = 0; i < 7; i++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: mbox.y + mbox.height * 0.12, id: 3 }] });
      for (let k = 1; k <= 6; k++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: mbox.y + mbox.height * (0.12 + k * 0.12), id: 3 }] });
      await wait(150);
      for (let k = 5; k >= 0; k--) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: mbox.y + mbox.height * (0.12 + k * 0.12), id: 3 }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await wait(150);
    }
    await shot("m-09-minigame");
    await page.waitForFunction((d) => (window.__net.pub.res.water_dirty ?? 0) > d, dirty0, { timeout: 8000 }).catch(() => {});
    const dirty1 = await ev(() => window.__net.pub.res.water_dirty ?? 0);
    step("finger strokes work the pump", dirty1 > dirty0, { dirty0, dirty1 });
    await page.keyboard.press("Escape");
  }
  // ------------------------------------------------ the night council on the phone
  await ev(() => window.__net.send({ k: "debug", op: "night" }));
  await wait(2500);
  await page.getByRole("button", { name: "Понятно" }).tap().catch(() => {});
  await shot("m-10-council");
  const council = await ev(() => { const e = [...document.querySelectorAll(".panel, .council")].find((x) => /Совет|совет/.test(x.textContent) && x.getBoundingClientRect().width > 0); if (!e) return null; const b = e.getBoundingClientRect(); const ready = [...e.querySelectorAll("button")].find((b) => /Готов/.test(b.textContent)); const rb = ready?.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), H: innerHeight, scrolls: e.scrollHeight > e.clientHeight, ready: rb ? Math.round(rb.bottom) : null }; });
  step("the council fits (or scrolls) on the phone", !!council && council.top >= 0 && council.bottom <= council.H + 1, council);
  await ctx2.close();

  // ------------------------------------------------ a fight on the phone (test arena, web + ?mobile=1)
  const ctx3 = await browser.newContext(phone);
  const p4 = await ctx3.newPage();
  p4.on("pageerror", (e) => report.errors.push(e.message));
  await p4.goto(URL + "/?mobile=1");
  await p4.getByPlaceholder("Ваше имя").fill("Тактик");
  await p4.getByRole("button", { name: "Создать бункер", exact: true }).tap();
  await p4.locator(".card").first().tap();
  await p4.waitForTimeout(500);
  await p4.evaluate(() => [...document.querySelectorAll("button")].find((b) => /Тестовая арена/.test(b.textContent)).click());
  await p4.waitForFunction(() => window.__game?.combat?.active && window.__game.combat.cs?.phase === "plan", null, { timeout: 20000 });
  await p4.waitForTimeout(1200);
  await p4.getByRole("button", { name: "Понятно" }).tap().catch(() => {});
  await p4.waitForTimeout(300);
  const fight = await p4.evaluate(() => ({ pad: document.querySelectorAll(".touch-pad .touch-btn").length, stick: !!document.querySelector(".touch-stick:not(.hidden)"), end: [...document.querySelectorAll("button")].some((b) => /Конец хода/.test(b.textContent) && b.getBoundingClientRect().width > 0), scrollW: document.documentElement.scrollWidth, W: innerWidth }));
  step("fight: no stick or pad, «Конец хода» on screen, nothing off-screen", !fight.pad && !fight.stick && fight.end && fight.scrollW <= fight.W, fight);
  // tap a blue cell: the unit moves
  const u0 = await p4.evaluate(() => { const u = window.__game.combat.myUnit(); return { col: u.col, ap: u.ap }; });
  const cell = await p4.evaluate(() => {
    const c = window.__game.combat, u = c.myUnit();
    const blue = c.reach.filter((r) => !r.dash && r.floor === u.floor).sort((a, b) => b.col - a.col)[0] ?? c.reach[0];
    const [x, y] = c.pos(blue.col, blue.floor);
    return c.site.toScreen(x, y + 0.6);
  });
  await p4.touchscreen.tap(cell[0], cell[1]);
  await p4.waitForTimeout(1500);
  const u1 = await p4.evaluate(() => { const u = window.__game.combat.myUnit(); return { col: u.col, ap: u.ap }; });
  step("fight: a tap on a cell moves the unit", u1.col !== u0.col || u1.ap < u0.ap, { u0, u1, viaTap: !!cell });
  await p4.screenshot({ path: `${OUT}/m-08-combat.png` });
  await ctx3.close();
} catch (e) {
  step("script error", false, { error: String(e?.message ?? e).slice(0, 300) });
  await shot("m-error").catch(() => {});
}
step("no page errors", report.errors.length === 0, { errors: report.errors.slice(0, 5) });
writeFileSync(`${OUT}/mobile-report.json`, JSON.stringify(report, null, 2));
await browser.close();
process.exit(report.ok ? 0 : 1);
