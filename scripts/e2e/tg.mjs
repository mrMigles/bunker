// Telegram chat bunker with several members: `node scripts/e2e/tg.mjs` (dev server on :5173 / :2567).
// Residents carry the members' Telegram names and faces; one who leaves stays as «бот»; a member coming later
// gets their own resident; «Начать заново» needs a second member's yes.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const URL = process.env.URL || "http://localhost:5173";
const API = process.env.API || "http://localhost:2567";
const out = "artifacts/tg";
mkdirSync(out, { recursive: true });
const chat = "ci-e2e-tg-" + Date.now();
let fails = 0;
const check = (name, ok, data) => {
  if (!ok) fails++;
  console.log(ok ? "✔" : "✘", name, ok ? "" : JSON.stringify(data ?? ""));
};
const token = async (user, name) => (await (await fetch(`${API}/api/tg/dev-token?chat=${chat}&user=${user}&name=${encodeURIComponent(name)}&title=${encodeURIComponent("Чат тестеров")}`)).json()).token;

const browser = await chromium.launch({ headless: true });
const errors = [];
async function open(user, name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  await ctx.addInitScript(() => localStorage.setItem("bunker.tipsOff", "1"));
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => errors.push(name + ": " + e.message));
  await page.goto(`${URL}/?tg=${await token(user, name)}`);
  await page.waitForFunction(() => !!window.__net?.pub);
  return { ctx, page };
}

try {
  const a = await open(9101, "Вера Г.");
  const b = await open(9102, "Пётр С.");
  await a.page.locator(".lobby .card").first().waitFor();
  await b.page.locator(".lobby .card").first().waitFor();
  // lobby: cards carry the member's name; chips show a face
  const cardNames = await a.page.evaluate(() => [...document.querySelectorAll(".lobby .card")].map((c) => c.textContent));
  check("lobby: every card carries the Telegram name", cardNames.length >= 3 && cardNames.every((t) => t.includes("Вера Г.")), cardNames.map((t) => t.slice(0, 40)));
  check("lobby: players shown with a face", (await a.page.locator(".lobby-players .ava").count()) >= 2);
  await a.page.locator(".lobby .card").nth(1).click();
  await b.page.locator(".lobby .card").first().click();
  await a.page.getByText("Без пролога", { exact: true }).click().catch(() => {});
  await b.page.getByRole("button", { name: "Готов", exact: true }).click();
  await a.page.getByRole("button", { name: "Готов", exact: true }).click();
  await a.page.getByRole("button", { name: /Начать/ }).first().click();
  await a.page.waitForFunction(() => ["day", "prologue"].includes(window.__net.pub.phase), null, { timeout: 20000 });
  if ((await a.page.evaluate(() => window.__net.pub.phase)) === "prologue") {
    await a.page.evaluate(() => window.__net.send({ k: "debug", op: "hour", arg: 7 }));
  }
  const names = await a.page.evaluate(() => Object.values(window.__net.pub.chars).map((c) => ({ n: c.card.name, tg: !!c.card.tg, ctrl: c.ctrl })));
  check("game: members' residents are named after them", names.some((c) => c.n === "Вера Г." && c.tg) && names.some((c) => c.n === "Пётр С." && c.tg), names);
  await a.page.waitForFunction(() => window.__net.pub.phase === "day", null, { timeout: 60000 }).catch(() => {});
  await a.page.waitForTimeout(800);
  const labels = await a.page.evaluate(() => [...document.querySelectorAll(".label .nm.player")].map((e) => ({ t: e.textContent, ava: !!e.querySelector(".ava") })));
  check("game: players' names over heads with a face", labels.length >= 2 && labels.every((l) => l.ava) && labels.some((l) => l.t.includes("Пётр С.")), labels);
  const ava = await (await fetch(`${API}/api/tg/avatar/9101`)).status;
  check("avatar: a member without a photo (no bot here) gets 404, the letter stays", ava === 404, { ava });
  const stranger = await (await fetch(`${API}/api/tg/avatar/123456789`)).status;
  check("avatar: users who never opened the game are not served", stranger === 404, { stranger });
  await a.page.screenshot({ path: `${out}/names.png` });

  // Пётр leaves: his resident stays, played by a bot, still under his name
  await b.ctx.close();
  await a.page.waitForFunction(() => [...document.querySelectorAll(".label .nm.player.away")].some((e) => e.textContent.includes("Пётр С.")), null, { timeout: 45000 }).catch(() => {});
  const away = await a.page.evaluate(() => [...document.querySelectorAll(".label .nm.player.away")].map((e) => e.textContent));
  check("away member: resident keeps the name, marked «бот»", away.some((t) => t.includes("Пётр С.") && t.includes("бот")), away);
  const petr = await a.page.evaluate(() => Object.values(window.__net.pub.chars).find((c) => c.card.name === "Пётр С."));
  check("away member: a bot plays the resident", petr && !petr.ctrl, petr && { ctrl: petr.ctrl });

  // a member who comes later gets their own resident
  const c = await open(9103, "Лена К.");
  await c.page.waitForFunction(() => { const v = window.__net.pub, me = window.__net.priv?.char; return v.phase !== "lobby" && !!me && v.chars[me]; }, null, { timeout: 20000 });
  const lena = await c.page.evaluate(() => window.__net.pub.chars[window.__net.priv.char].card.name);
  check("newcomer: a new resident under the member's name", lena === "Лена К.", { lena });

  // «Начать заново»: Вера asks, Лена agrees
  const day0 = await a.page.evaluate(() => Object.keys(window.__net.pub.chars).length);
  a.page.once("dialog", (d) => d.accept());
  await a.page.evaluate(() => window.__net.send({ k: "restartAsk" }));
  await c.page.locator(".restart-banner").waitFor();
  const banner = await c.page.locator(".restart-banner").textContent();
  check("restart: the others see the question", /Вера Г\. предлагает начать заново/.test(banner), { banner });
  const own = await a.page.locator(".restart-banner").textContent();
  check("restart: the asker waits for someone else", /Ждём согласия/.test(own), { own });
  const self = await a.page.evaluate(() => new Promise((ok) => {
    window.__net.send({ k: "restartYes" });
    setTimeout(() => ok(window.__net.pub.phase), 800);
  }));
  check("restart: one's own yes does not count", self !== "lobby", { self });
  await c.page.screenshot({ path: `${out}/restart-banner.png` });
  await c.page.locator(".restart-banner button.primary").click();
  await a.page.waitForFunction(() => window.__net.pub.phase === "lobby", null, { timeout: 10000 }).catch(() => {});
  const after = await a.page.evaluate(() => ({ phase: window.__net.pub.phase, chars: Object.keys(window.__net.pub.chars).length, banner: !!document.querySelector(".restart-banner") }));
  check("restart: a second member's yes starts the bunker over", after.phase === "lobby" && !after.banner, { day0, after });
  await a.page.locator(".lobby .card").first().waitFor();
  await a.page.screenshot({ path: `${out}/after-restart.png` });
  await a.ctx.close();
  await c.ctx.close();
} catch (e) {
  fails++;
  console.log("✘ script error", JSON.stringify({ error: String(e).slice(0, 300) }));
}
check("no page errors", !errors.length, errors.slice(0, 5));
await browser.close();
console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
