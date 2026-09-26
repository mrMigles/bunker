// Smoke run of qa/ scenarios in one viewport mode: node smoke.mjs <mode> [stages]
// Modes: D, MP, ML, MLS, TGP. Stages: start,prologue,day,council,sortie,combat,persist
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const MODES = {
  D: { viewport: { width: 1440, height: 900 }, touch: false },
  MP: { viewport: { width: 390, height: 844 }, touch: true },
  ML: { viewport: { width: 844, height: 390 }, touch: true },
  MLS: { viewport: { width: 760, height: 300 }, touch: true },
  TGP: { viewport: { width: 390, height: 700 }, touch: true, tg: true },
  PIXEL: { viewport: { width: 412, height: 915 }, touch: true },
  S360: { viewport: { width: 360, height: 780 }, touch: true },
  LAND: { viewport: { width: 915, height: 412 }, touch: true },
};
const mode = process.argv[2] ?? "D";
const stages = (process.argv[3] ?? "start,prologue,day,council,sortie,combat,persist").split(",");
const M = MODES[mode];
const OUT = `artifacts/qa-smoke/${mode}`;
mkdirSync(OUT, { recursive: true });
const report = { mode, viewport: M.viewport, steps: [], audits: {}, errors: [] };
const log = (name, ok, data = {}) => {
  report.steps.push({ name, ok, ...data });
  console.log(`${ok ? "✔" : "✘"} [${mode}] ${name}`, Object.keys(data).length ? JSON.stringify(data).slice(0, 400) : "");
};

const browser = await chromium.launch({ headless: true });
async function newPage(tgUser) {
  const ctx = await browser.newContext({
    viewport: M.viewport,
    hasTouch: M.touch,
    isMobile: M.touch,
    deviceScaleFactor: 1,
    userAgent: M.touch ? "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36" : undefined,
  });
  // the intro cards are their own check (onboarding-check.mjs): here they would only cover the lobby
  await ctx.addInitScript(() => localStorage.setItem("bunker.introSeen", "1"));
  if (M.tg)
    await ctx.addInitScript(() => {
      const noop = () => {};
      window.Telegram = { WebApp: {
        initData: "", platform: "android", viewportHeight: innerHeight, viewportStableHeight: innerHeight,
        contentSafeAreaInset: { top: 18, right: 0, bottom: 13, left: 0 }, safeAreaInset: { top: 24, right: 0, bottom: 16, left: 0 },
        ready: noop, expand: noop, disableVerticalSwipes: noop, setHeaderColor: noop, setBackgroundColor: noop,
        requestFullscreen: noop, lockOrientation: noop, unlockOrientation: noop, onEvent: noop, offEvent: noop,
        BackButton: { onClick: noop, offClick: noop, show: noop, hide: noop }, HapticFeedback: { impactOccurred: noop, notificationOccurred: noop, selectionChanged: noop },
      } };
    });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000); page.setDefaultNavigationTimeout(60000);
  page.on("pageerror", (e) => report.errors.push("pageerror: " + e.message));
  page.on("console", (m) => m.type() === "error" && report.errors.push("console: " + m.text().slice(0, 300)));
  return page;
}
let page = await newPage();
const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
const dbg = (op, arg) => ev(([op, arg]) => window.__net.send({ k: "debug", op, arg }), [op, arg]);
const tapOrClick = async (loc) => (M.touch ? loc.tap() : loc.click());

/** Screenshot + layout audit of visible interactive elements. */
async function shot(name) {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  const a = await ev((touch) => {
    const vis = (e) => {
      const r = e.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      const cs = getComputedStyle(e);
      if (cs.visibility === "hidden" || cs.display === "none" || +cs.opacity === 0) return false;
      for (let p = e; p; p = p.parentElement) if (getComputedStyle(p).display === "none") return false;
      return true;
    };
    const label = (e) => ((e.innerText || e.getAttribute("aria-label") || e.title || e.className || e.tagName) + "").replace(/\s+/g, " ").trim().slice(0, 40);
    const els = [...document.querySelectorAll("button, a, input, select, [role=button], .btn")].filter(vis);
    const out = [], small = [], overlaps = [];
    const rects = els.map((e) => ({ e, r: e.getBoundingClientRect() }));
    for (const { e, r } of rects) {
      if (r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || r.left < -1 || r.top < -1) {
        // inside a scroll container is fine
        let sc = false;
        for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
          const cs = getComputedStyle(p);
          if (/(auto|scroll)/.test(cs.overflowY + cs.overflowX) && (p.scrollHeight > p.clientHeight + 2 || p.scrollWidth > p.clientWidth + 2)) { sc = true; break; }
        }
        if (!sc) out.push({ l: label(e), r: [r.left, r.top, r.width, r.height].map(Math.round) });
      }
      if (touch && (r.width < 32 || r.height < 32) && r.width > 0) small.push({ l: label(e), wh: [Math.round(r.width), Math.round(r.height)] });
    }
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        if (a.e.contains(b.e) || b.e.contains(a.e)) continue;
        const ix = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left), iy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (ix > 4 && iy > 4) {
          // is the overlap visible (topmost element at the centre of the intersection is one of them)?
          const cx = Math.max(a.r.left, b.r.left) + ix / 2, cy = Math.max(a.r.top, b.r.top) + iy / 2;
          const top = document.elementFromPoint(cx, cy);
          overlaps.push({ a: label(a.e), b: label(b.e), hidden: top && !(a.e.contains(top) || b.e.contains(top)) ? "" : (a.e.contains(top) ? "b under a" : "a under b") });
        }
      }
    const tiny = [...document.querySelectorAll("body *")].filter((e) => e.childElementCount === 0 && e.textContent.trim().length > 1 && vis(e)).filter((e) => parseFloat(getComputedStyle(e).fontSize) < 11).map((e) => e.textContent.trim().slice(0, 30) + "@" + getComputedStyle(e).fontSize);
    const keys = touch ? [...new Set((document.body.innerText.match(/[[A-ZА-Я]]|Esc|Пробел|Tab|клавиш[аеуи]?s+S+|нажмитеs+[A-Z]|[AD]s+иs+[AD]/g) ?? []))] : [];
    return { keys, hscroll: document.documentElement.scrollWidth > innerWidth + 1, out, small: small.slice(0, 40), overlaps: overlaps.slice(0, 30), tinyText: [...new Set(tiny)].slice(0, 30) };
  }, M.touch);
  report.audits[name] = a;
  return a;
}
async function dismissTips() {
  for (let i = 0; i < 3; i++) {
    const b = page.getByRole("button", { name: "Понятно", exact: true });
    if (await b.count() && await b.first().isVisible()) { await tapOrClick(b.first()).catch(() => {}); await wait(300); } else break;
  }
}

async function createBunker({ skipPrologue = true, name = "QA-" + mode } = {}) {
  if (M.tg) {
    const r = await fetch(`http://localhost:2567/api/tg/dev-token?chat=qa-${mode}-${Date.now()}&user=${Math.floor(Math.random() * 1e6)}&name=TG-QA`);
    const { token } = await r.json();
    await page.goto(`http://localhost:5173/?mobile=1&tg=${encodeURIComponent(token)}`);
  } else {
    await page.goto("http://localhost:5173/" + (M.touch ? "?mobile=1" : ""));
    await page.getByPlaceholder("Ваше имя").fill(name);
    await tapOrClick(page.getByRole("button", { name: "Создать бункер", exact: true }));
  }
  await page.locator(".card").first().waitFor({ timeout: 20000 });
  await tapOrClick(page.locator(".card").first());
  if (skipPrologue) {
    const l = page.getByLabel("Без пролога");
    if (await l.count()) await l.check().catch(async () => tapOrClick(l));
  }
}
async function startGame() {
  const ready = page.getByRole("button", { name: "Готов", exact: true });
  if (await ready.count()) await tapOrClick(ready.first()).catch(() => {});
  await tapOrClick(page.getByRole("button", { name: /Начать/ }).first());
}
async function waitDay() {
  await page.waitForFunction(() => window.__net?.pub?.phase === "day" && window.__net.myChar?.(), null, { timeout: 30000 });
  await wait(2500);
}

const S = {};
S.start = async () => {
  if (!M.tg) {
    await page.goto("http://localhost:5173/" + (M.touch ? "?mobile=1" : ""));
    await page.getByPlaceholder("Ваше имя").waitFor();
    await wait(800);
    await shot("01-menu");
  }
  await createBunker({ skipPrologue: false });
  await wait(700);
  await shot("02-lobby");
  // scroll the lobby to the bottom to see settings and buttons
  await ev(() => { const s = [...document.querySelectorAll("*")].find((e) => e.scrollHeight > e.clientHeight + 20 && /(auto|scroll)/.test(getComputedStyle(e).overflowY)); if (s) s.scrollTop = s.scrollHeight; else scrollTo(0, 1e5); });
  await wait(300);
  await shot("03-lobby-bottom");
  log("lobby reachable", true);
};
S.prologue = async () => {
  await page.close().catch(() => {});
  page = await newPage();
  await createBunker({ skipPrologue: false });
  await startGame();
  await page.waitForFunction(() => window.__net?.pub?.phase === "prologue" && window.__net.pub.mods.prologue, null, { timeout: 20000 });
  await wait(1500);
  await shot("10-prologue-start");
  await dismissTips();
  // tap the nearest loot on screen through the UI hook (as clicking the label does)
  const t = await ev(() => { const p = window.__net.pub.mods.prologue, c = window.__net.myChar(); const it = p.items.filter((i) => i.lv === 1 && !i.by).sort((a, b) => Math.abs(a.x - c.x) - Math.abs(b.x - c.x))[0]; return it?.id; });
  await ev((id) => window.__game.pro.selectItem(id), t);
  await page.waitForFunction(() => window.__net.myChar().hands.length > 0, null, { timeout: 15000 }).catch(() => {});
  await wait(500);
  await shot("11-prologue-carrying");
  const carrying = await ev(() => window.__net.myChar().hands.length);
  log("prologue: pick up loot", carrying > 0);
  await ev(() => window.__game.pro.returnHome());
  await page.waitForFunction(() => window.__net.myChar().hands.length === 0, null, { timeout: 20000 }).catch(() => {});
  const delivered = await ev(() => Object.values(window.__net.pub.mods.prologue?.delivered ?? {}).reduce((a, b) => a + b, 0));
  log("prologue: delivered to hatch", delivered > 0, { delivered });
  await shot("12-prologue-hatch");
  await page.waitForFunction(() => window.__net.pub.phase === "day", null, { timeout: 180000 });
  await wait(3000);
  await shot("13-day1-after-prologue");
  log("prologue → day", true);
};
S.day = async () => {
  await page.close().catch(() => {});
  page = await newPage();
  await createBunker();
  await startGame();
  await waitDay();
  await shot("20-day-first-frame");
  await dismissTips();
  await shot("21-day-hud");
  // walk to the bike through the objective / context: find the bike object and navigate
  const bike = await ev(() => { const o = Object.values(window.__net.pub.objs).find((o) => /bike|pedal|gen/.test(o.kind)); return o ? { id: o.id, kind: o.kind, x: o.x, lv: o.lv } : null; });
  if (bike) {
    await ev((o) => new Promise((res) => window.__game.navigation.go(o.x + 0.5, o.lv, res)), bike);
    await wait(1500);
    await shot("22-ctx-near-bike");
    const acts = await ev(() => [...document.querySelectorAll(".prompt button, .prompt .act, .actions button")].map((b) => b.innerText.trim()).filter(Boolean).slice(0, 10));
    log("ctx menu near bike", acts.length > 0, { acts, kind: bike.kind });
    // perform first action via UI: action button on touch, E on desktop
    if (M.touch) {
      const act = page.locator("button", { hasText: "Действие" }).first();
      if (await act.count()) await act.tap().catch(() => {});
    } else await page.keyboard.press("KeyE");
    await wait(1500);
    await shot("23-minigame");
    const mg = await ev(() => !!document.querySelector(".mini-modal, .minigame, .mg, [class*=minigame]"));
    log("minigame opens", mg);
    await dismissTips();
    // play a bit
    for (let i = 0; i < 10; i++) { if (M.touch) { const b = page.locator(".minigame button, [class*=minigame] button").first(); if (await b.count()) await b.tap().catch(() => {}); } else { await page.keyboard.press(i % 2 ? "KeyD" : "KeyA"); } await wait(150); }
    await shot("24-minigame-played");
    const self = page.getByRole("button", { name: /Пусть делает сам/ });
    if (await self.count()) await tapOrClick(self.first()).catch(() => {});
    else await page.keyboard.press("Escape");
    await wait(800);
  } else log("bike not found", false);
  // build mode
  if (M.touch) { const b = page.getByTitle(/Строить|Стройка/).first(); if (await b.count()) await b.tap().catch(() => {}); } else await page.keyboard.press("KeyB");
  await wait(1500);
  await dismissTips();
  await shot("25-build");
  log("build mode", await ev(() => window.__game.build.active));
  const done = page.getByRole("button", { name: /Готово|Закончить стройку/ }).first();
  if (await done.count()) await tapOrClick(done).catch(() => {}); else await page.keyboard.press("KeyB");
  await wait(800);
  // shelter window
  if (M.touch) { const b = page.getByTitle(/Убежище/).first(); if (await b.count()) await b.tap().catch(() => {}); } else await page.keyboard.press("Tab");
  await wait(1000);
  await shot("26-shelter");
  await page.keyboard.press("Escape");
  const close = page.locator(".modal .close, .modal button[aria-label*=Закрыть], button.close").first();
  if (await close.count() && await close.isVisible()) await tapOrClick(close).catch(() => {});
  await wait(500);
  // game menu
  const menuBtn = page.getByTitle(/Меню/).first();
  if (await menuBtn.count()) await tapOrClick(menuBtn).catch(() => {}); else await page.keyboard.press("KeyO");
  await wait(800);
  await shot("27-game-menu");
  await page.keyboard.press("Escape");
  if (await close.count() && await close.isVisible()) await tapOrClick(close).catch(() => {});
  await wait(500);
  await shot("28-after-menus");
};
S.council = async () => {
  if (!(await ev(() => window.__net?.pub?.phase === "day").catch(() => false))) {
    await page.close().catch(() => {});
    page = await newPage();
    await createBunker();
    await startGame();
    await waitDay();
    await dismissTips();
  }
  await dbg("night");
  await page.waitForFunction(() => window.__net.pub.phase === "night" && window.__net.pub.council, null, { timeout: 20000 });
  await wait(1500);
  await shot("30-council-step1");
  await dismissTips();
  await shot("31-council-step1-notip");
  for (let step = 2; step <= 4; step++) {
    const r = page.getByRole("button", { name: /Готов/ }).first();
    if (!(await r.count())) break;
    await tapOrClick(r).catch(() => {});
    await wait(1500);
    await dismissTips();
    await shot(`3${step}-council-step${step}`);
    if (await ev(() => window.__net.pub.phase === "day")) break;
  }
  await page.waitForFunction(() => window.__net.pub.phase === "day", null, { timeout: 30000 }).catch(() => {});
  await wait(2500);
  await shot("35-morning");
  log("council → morning", await ev(() => window.__net.pub.phase === "day"));
};
S.sortie = async () => {
  await page.close().catch(() => {});
  page = await newPage();
  await createBunker();
  await startGame();
  await waitDay();
  await dismissTips();
  // tap the sortie icon in HUD (real UI)
  const sb = page.getByTitle(/Вылазка|Карта и подготовка/).first();
  if (await sb.count()) await tapOrClick(sb).catch(() => {});
  await page.waitForFunction(() => window.__net.pub.mods.expedition?.stage === "prep", null, { timeout: 40000 }).catch(() => {});
  if (!(await ev(() => window.__net.pub.mods.expedition?.stage === "prep"))) {
    log("sortie icon did not open prep; falling back to terminal", false);
    await ev(() => { const o = Object.values(window.__net.pub.objs).find((o) => o.kind === "sortie_terminal"); window.__game.navigation.go(o.x + 0.5, o.lv, () => window.__net.send({ k: "do", a: "sortie", tt: "obj", t: o.id })); });
    await page.waitForFunction(() => window.__net.pub.mods.expedition?.stage === "prep", null, { timeout: 40000 });
  }
  await wait(1200);
  await dismissTips();
  await shot("40-prep");
  await ev(() => { const s = [...document.querySelectorAll("*")].filter((e) => e.scrollHeight > e.clientHeight + 20 && /(auto|scroll)/.test(getComputedStyle(e).overflowY)).pop(); if (s) s.scrollTop = s.scrollHeight; });
  await wait(300);
  await shot("41-prep-bottom");
  await tapOrClick(page.getByRole("button", { name: "Выйти на поверхность →", exact: true }));
  await page.waitForFunction(() => window.__net.pub.mods.expedition?.stage === "map", null, { timeout: 15000 });
  await wait(1500);
  await dismissTips();
  await shot("42-map");
  const dest = await ev(() => { const n = Object.values(window.__net.pub.mods.wmap.nodes); return (n.find((x) => x.type === "shop") ?? n.find((x) => x.id !== "home")).id; });
  await ev((id) => window.__game.exp.selectNode?.(id), dest).catch(() => {});
  await wait(800);
  await shot("43-map-selected");
  await dbg("speed", 8);
  await ev((id) => window.__net.send({ k: "expGo", node: id }), dest);
  await wait(1500);
  await shot("44-travel");
  await page.waitForFunction((id) => window.__net.pub.mods.expedition?.stage === "map" && window.__net.pub.mods.expedition.node === id, dest, { timeout: 120000 });
  await dbg("speed", 1);
  await wait(800);
  await shot("45-arrived");
  const enter = page.getByRole("button", { name: /Войти и исследовать/ }).first();
  if (await enter.count()) await tapOrClick(enter); else await ev(() => window.__net.send({ k: "expEnter" }));
  await page.waitForFunction(() => window.__game.exp.mode === "site", null, { timeout: 15000 });
  await wait(2000);
  await dismissTips();
  await shot("46-site");
  const ct = await ev(() => { const s = window.__net.pub.mods.expedition.site, c = window.__net.myChar(); return s.conts.filter((o) => o.searched < 1 && !o.locked && !o.coop && o.lv === c.lv).sort((a, b) => Math.abs(a.x - c.x) - Math.abs(b.x - c.x))[0] ?? null; });
  if (ct) {
    await ev((ct) => new Promise((res) => window.__game.navigation.go(ct.x + 0.5, ct.lv, res)), ct);
    await wait(800);
    await shot("47-site-near-container");
    if (M.touch) { const b = page.locator("button", { hasText: "Обыск" }).first(); if (await b.count()) await b.tap().catch(() => {}); else await ev((id) => window.__net.send({ k: "sdo", a: "search", id }), ct.id); }
    else await page.keyboard.press("KeyE");
    await wait(1200);
    await shot("48-searching");
    await page.waitForFunction((id) => { const s = window.__net.pub.mods.expedition?.site; return !s || window.__net.pub.mods.battle || (s.conts.find((c) => c.id === id)?.searched ?? 1) >= 1; }, ct.id, { timeout: 30000 }).catch(() => {});
    await wait(600);
    await shot("49-searched");
    log("site search", await ev((id) => (window.__net.pub.mods.expedition?.site?.conts.find((c) => c.id === id)?.searched ?? 0) >= 1, ct.id));
  }
  if (await ev(() => !!window.__net.pub.mods.battle)) {
    await wait(1500);
    await shot("4a-site-battle");
    await dbg("speed", 4);
    await page.waitForFunction(() => !window.__net.pub.mods.battle, null, { timeout: 120000 }).catch(() => {});
    await dbg("speed", 1);
  }
  // backpack
  const bp = page.getByTitle(/снаряжение и добычу|Снаряжение/).first();
  if (await bp.count()) { await tapOrClick(bp).catch(() => {}); await wait(800); await shot("4b-backpack"); await page.keyboard.press("Escape"); const c2 = page.locator("button.close").first(); if (await c2.count() && await c2.isVisible()) await tapOrClick(c2).catch(() => {}); }
  // leave & go home
  await dbg("speed", 8);
  await ev(() => { const s = window.__net.pub.mods.expedition.site; window.__game.navigation.go(s.exitX + 0.5, s.exitLv, () => window.__net.send({ k: "expLeaveSite" })); });
  await page.waitForFunction(() => window.__net.pub.mods.expedition?.stage === "map", null, { timeout: 60000 }).catch(() => {});
  await ev(() => window.__net.send({ k: "expHome" }));
  for (let i = 0; i < 60 && (await ev(() => !!window.__net.pub.mods.expedition)); i++) {
    await ev(() => { const v = window.__net.pub; if (v.phase === "night" && v.council && !v.council.ready[window.__net.priv.pid]) window.__net.send({ k: "ready", v: true }); });
    await wait(2000);
  }
  await dbg("speed", 1);
  await wait(2500);
  await dismissTips();
  await shot("4c-home");
  const floor = await ev(() => Object.values(window.__net.pub.items ?? {}).length);
  log("return home", await ev(() => !window.__net.pub.mods.expedition), { floorItems: floor });
};
S.combat = async () => {
  await page.close().catch(() => {});
  page = await newPage();
  await createBunker();
  const arena = page.getByRole("button", { name: /Тестовая арена/ }).first();
  await tapOrClick(arena);
  await page.waitForFunction(() => window.__game?.combat?.active && window.__game.combat.cs?.phase === "plan", null, { timeout: 25000 });
  await wait(1500);
  await shot("50-combat-start");
  await dismissTips();
  await shot("51-combat-myturn");
  // tap a blue cell toward enemies through the screen
  const tgt = await ev(() => { const c = window.__game.combat, u = c.myUnit(); const blue = c.reach.filter((r) => !r.dash && r.floor === u.floor).sort((a, b) => b.col - a.col)[0] ?? c.reach[0]; const [x, y] = c.pos(blue.col, blue.floor); return { s: c.site.toScreen(x, y + 0.6), col: u.col, blue }; });
  if (M.touch) await page.touchscreen.tap(tgt.s[0], tgt.s[1]); else await page.mouse.click(tgt.s[0], tgt.s[1]);
  await wait(1500);
  const moved = await ev((c0) => { const u = window.__game.combat.myUnit(); return { col: u.col, ap: u.ap }; }, tgt.col);
  log("combat: tap cell moves", moved.col !== tgt.col || moved.ap < 3, { ...moved, from: tgt.col, tapAt: tgt.s });
  await shot("52-combat-moved");
  // tap nearest enemy on screen
  const foe = await ev(() => { const c = window.__game.combat, s = c.cs, u = c.myUnit(); const f = Object.values(s.units).filter((x) => x.side === "enemy" && !x.dead && !x.down).sort((a, b) => Math.abs(a.col - u.col) + 9 * Math.abs(a.floor - u.floor) - Math.abs(b.col - u.col) - 9 * Math.abs(b.floor - u.floor))[0]; const [x, y] = c.pos(f.col, f.floor); return { id: f.id, s: c.site.toScreen(x, y + 0.8), hp: f.hp }; });
  if (M.touch) await page.touchscreen.tap(foe.s[0], foe.s[1]); else await page.mouse.click(foe.s[0], foe.s[1]);
  await wait(900);
  await shot("53-combat-target");
  const hitText = await ev(() => document.body.innerText.match(/(\S+)% ?попадан/gi));
  log("combat: hit chance shown", !!hitText && !hitText.some((t) => /NaN|undefined/.test(t)), { hitText });
  await wait(1500);
  await shot("54-combat-after-attack");
  // end turn via UI
  const endBtn = page.locator(".combat-ready").first();
  if (await endBtn.count()) await tapOrClick(endBtn).catch(() => {}); else await page.keyboard.press("Enter");
  await wait(1200);
  await shot("55-combat-enemy-turn");
  await wait(2500);
  await shot("56-combat-enemy-turn2");
  await page.waitForFunction(() => { const s = window.__game.combat.cs; return !s || s.phase === "plan" || s.result; }, null, { timeout: 60000 }).catch(() => {});
  await wait(800);
  await shot("57-combat-turn2");
  // open extra commands / items
  const more = page.getByRole("button", { name: /Показать команды|Ещё|•••/ }).first();
  if (await more.count() && await more.isVisible()) { await tapOrClick(more).catch(() => {}); await wait(600); await shot("58-combat-more"); }
  const items = page.getByRole("button", { name: /Предметы/ }).first();
  if (await items.count() && await items.isVisible()) { await tapOrClick(items).catch(() => {}); await wait(600); await shot("59-combat-items"); await page.keyboard.press("Escape"); }
  const logBtn = page.getByRole("button", { name: /Журнал боя/ }).first();
  if (await logBtn.count() && await logBtn.isVisible()) { await tapOrClick(logBtn).catch(() => {}); await wait(600); await shot("5a-combat-log"); }
  // finish the fight: keep ending turns with attacks via hook
  for (let r = 0; r < 25; r++) {
    const st = await ev(() => { const s = window.__game.combat.cs; return s ? { phase: s.phase, result: s.result } : null; });
    if (!st || st.result || st.phase === "over") break;
    if (st.phase !== "plan") { await wait(500); continue; }
    await ev(() => { const c = window.__game.combat, s = c.cs, u = c.myUnit(); if (!u || u.down || u.ap <= 0) return; const f = Object.values(s.units).filter((x) => x.side === "enemy" && !x.dead && !x.down && !x.fled && x.floor === u.floor).sort((a, b) => Math.abs(a.col - u.col) - Math.abs(b.col - u.col))[0]; if (f) c.tryAdd(Math.abs(f.col - u.col) <= 1 ? { t: "melee", target: f.id } : { t: "shoot", target: f.id }); });
    await wait(800);
    const round = await ev(() => window.__game.combat.cs?.round ?? 0);
    const b = page.locator(".combat-ready").first();
    if (await b.count()) await b.click({ force: true }).catch(() => {});
    await page.waitForFunction((r) => { const s = window.__game.combat.cs; return !s || s.round > r || s.result; }, round, { timeout: 60000 }).catch(() => {});
  }
  await wait(1500);
  await shot("5b-combat-end");
  const res = await ev(() => window.__net.pub.mods.lastBattle?.result ?? window.__game.combat.cs?.result);
  log("combat ends", !!res, { res });
  const after = page.getByRole("button", { name: /Закрыть|Продолжить|Вернуться|OK|Ок/ }).first();
  if (await after.count() && await after.isVisible()) { await tapOrClick(after).catch(() => {}); await wait(1500); }
  await shot("5c-after-combat");
};
S.persist = async () => {
  await page.close().catch(() => {});
  page = await newPage();
  await createBunker();
  await startGame();
  await waitDay();
  await dismissTips();
  const before = await ev(() => ({ id: window.__net.myChar().id, day: window.__net.pub.day, code: window.__net.pub.code ?? window.__net.code }));
  await page.reload();
  await page.waitForFunction(() => window.__net?.pub?.phase === "day" && window.__net.myChar?.(), null, { timeout: 30000 }).catch(() => {});
  await wait(2500);
  await shot("60-after-reload");
  const after = await ev(() => ({ id: window.__net?.myChar?.()?.id, day: window.__net?.pub?.day })).catch(() => ({}));
  log("reload returns to same bunker & char", after.id === before.id, { before, after });
  // exit to menu & come back (not in TG)
  if (!M.tg) {
    const menuBtn = page.getByTitle(/Меню/).first();
    if (await menuBtn.count()) await tapOrClick(menuBtn); else await page.keyboard.press("KeyO");
    await wait(600);
    await tapOrClick(page.getByRole("button", { name: /Выйти в меню/ }).first());
    await wait(1500);
    await shot("61-menu-return");
    const ret = page.getByRole("button", { name: /Вернуться в/ }).first();
    log("return button in menu", (await ret.count()) > 0);
    if (await ret.count()) { await tapOrClick(ret); await page.waitForFunction(() => window.__net?.myChar?.(), null, { timeout: 20000 }).catch(() => {}); await wait(2000); await shot("62-returned"); log("returned to own char", (await ev(() => window.__net.myChar()?.id)) === before.id); }
  }
};

for (const s of stages) {
  try {
    console.log(`--- ${mode} ${s}`);
    await S[s]();
  } catch (e) {
    log(`${s}: script error`, false, { error: String(e).split("\n")[0].slice(0, 300) });
    await page.screenshot({ path: `${OUT}/zz-${s}-failure.png` }).catch(() => {});
  }
}
report.errors = [...new Set(report.errors)].slice(0, 30);
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
await browser.close();
