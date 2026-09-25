// Several Telegram players of one chat: do they land in one lobby and one prologue?
// node tg-multi.mjs <variant>   variants: seq, simul, mixed, late, three, reload
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
const OUT = "artifacts/qa-smoke/tgmp";
mkdirSync(OUT, { recursive: true });
const V = process.argv[2] ?? "seq";
const RUN = process.argv[3] ?? "1";
const chat = `qa-${V}-${Date.now()}`;
const b = await chromium.launch();
const log = (...a) => console.log(`[${V}#${RUN}]`, ...a);

/** A Telegram client: via the game button (token) or as a Mini App (initData with chat_instance). */
async function client(user, name, via = "game", vp = { width: 412, height: 800 }) {
  const ctx = await b.newContext({ viewport: vp, hasTouch: true, isMobile: true, deviceScaleFactor: 1, userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36" });
  const initData = via === "dm" ? new URLSearchParams({ user: JSON.stringify({ id: user, first_name: name }), chat_type: "sender", auth_date: String(Math.floor(Date.now() / 1000)), hash: "dev" }).toString() : via === "app" ? new URLSearchParams({ user: JSON.stringify({ id: user, first_name: name }), chat_instance: chat, chat_type: "group", auth_date: String(Math.floor(Date.now() / 1000)), hash: "dev" }).toString() : "";
  await ctx.addInitScript((initData) => {
    const noop = () => {};
    window.Telegram = { WebApp: { initData, platform: "android", viewportHeight: innerHeight, viewportStableHeight: innerHeight, contentSafeAreaInset: { top: 18, right: 0, bottom: 13, left: 0 }, safeAreaInset: { top: 24, right: 0, bottom: 16, left: 0 }, ready: noop, expand: noop, disableVerticalSwipes: noop, setHeaderColor: noop, setBackgroundColor: noop, requestFullscreen: noop, lockOrientation: noop, unlockOrientation: noop, onEvent: noop, offEvent: noop, BackButton: { onClick: noop, offClick: noop, show: noop, hide: noop }, HapticFeedback: { impactOccurred: noop, notificationOccurred: noop, selectionChanged: noop } } };
  }, initData);
  const p = await ctx.newPage();
  p.setDefaultTimeout(60000);
  p.errs = [];
  p.on("pageerror", (e) => p.errs.push(e.message));
  p.on("console", (m) => m.type() === "error" && p.errs.push(m.text().slice(0, 200)));
  p.nm = name;
  p.open = async () => {
    let url = "http://localhost:5173/?mobile=1";
    if (via === "game") {
      const r = await fetch(`http://localhost:2567/api/tg/dev-token?chat=ci${chat}&user=${user}&name=${encodeURIComponent(name)}`);
      url += "&tg=" + encodeURIComponent((await r.json()).token);
    }
    await p.goto(url, { timeout: 90000 });
    await p.waitForFunction(() => !!window.__net?.pub, null, { timeout: 60000 }).catch(() => {});
  };
  return p;
}
const state = (p) => p.evaluate(() => ({ code: window.__net?.pub?.code ?? window.__net?.code, phase: window.__net?.pub?.phase, players: Object.values(window.__net?.pub?.players ?? {}).map((x) => `${x.name}${x.online ? "" : "(off)"}`), me: window.__net?.priv?.pid, lobbyCards: document.querySelectorAll(".lobby .card").length, readyBtn: [...document.querySelectorAll("button")].some((x) => /^Готов$/.test(x.innerText.trim())), startBtn: [...document.querySelectorAll("button")].some((x) => /Начать/.test(x.innerText)), waiting: /Ждём хоста/.test(document.body.innerText) })).catch((e) => ({ err: String(e).slice(0, 100) }));
const shot = (p, n) => p.screenshot({ path: `${OUT}/${V}-${RUN}-${p.nm}-${n}.png` });
const pick = async (p, i) => { const c = p.locator(".lobby .card, .card").nth(i); if (await c.count()) await c.tap().catch(() => {}); };
const ready = async (p) => { const r = p.getByRole("button", { name: "Готов", exact: true }); if (await r.count()) await r.tap().catch(() => {}); };
const start = async (p) => { const s = p.getByRole("button", { name: /Начать/ }).first(); if (await s.count()) { await s.tap().catch(() => {}); return true; } return false; };

let A, B, C;
if (V === "seq" || V === "late" || V === "reload") {
  A = await client(101, "Анна");
  B = await client(102, "Борис");
  await A.open();
  await A.waitForTimeout(1500);
  if (V === "late") {
    await pick(A, 0); await ready(A); await start(A);
    await A.waitForTimeout(3000);
  }
  await B.open();
} else if (V === "simul") {
  A = await client(101, "Анна");
  B = await client(102, "Борис");
  await Promise.all([A.open(), B.open()]);
} else if (V === "mixed") {
  A = await client(101, "Анна", "app");
  B = await client(102, "Борис", "game");
  await A.open();
  await A.waitForTimeout(1500);
  await B.open();
} else if (V === "dm") {
  A = await client(101, "Анна", "game");
  B = await client(102, "Борис", "dm");
  await A.open();
  await A.waitForTimeout(1500);
  await B.open();
} else if (V === "three") {
  A = await client(101, "Анна");
  B = await client(102, "Борис", "app");
  C = await client(103, "Вера");
  await Promise.all([A.open(), B.open(), C.open()]);
}
await A.waitForTimeout(2500);
const all = [A, B, C].filter(Boolean);
for (const p of all) { log(p.nm, "after open", JSON.stringify(await state(p))); await shot(p, "1-open"); }
if (V === "reload") {
  await B.reload();
  await B.waitForFunction(() => !!window.__net?.pub, null, { timeout: 60000 }).catch(() => {});
  await B.waitForTimeout(2000);
  log("B after reload", JSON.stringify(await state(B)));
}
// everyone picks a card and presses ready; the first one (host?) starts
for (const [i, p] of all.entries()) { await pick(p, i); await ready(p); }
await A.waitForTimeout(1500);
for (const p of all) { log(p.nm, "after ready", JSON.stringify(await state(p))); await shot(p, "2-ready"); }
let started = false;
for (const p of all) if (!started && (await state(p)).startBtn) { started = await start(p); log(p.nm, "pressed Начать"); }
await A.waitForTimeout(6000);
for (const p of all) { log(p.nm, "after start", JSON.stringify(await state(p))); await shot(p, "3-start"); }
const codes = new Set((await Promise.all(all.map(state))).map((s) => s.code));
const phases = (await Promise.all(all.map(state))).map((s) => s.phase);
log("VERDICT", JSON.stringify({ sameRoom: codes.size === 1, codes: [...codes], phases, errors: all.map((p) => p.errs.slice(0, 3)) }));
await b.close();
