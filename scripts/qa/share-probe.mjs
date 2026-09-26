// Bunker code under the clock + «Поделиться ссылкой» in the menu, and the link brings a friend
// into the same bunker. node scripts/qa/share-probe.mjs [W H]   (needs `pnpm dev`)
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
const [W, H, OUT] = [Number(process.argv[2] ?? 390), Number(process.argv[3] ?? 844), "artifacts/qa-share"];
mkdirSync(OUT, { recursive: true });
const touch = W < 1000;
const b = await chromium.launch();
const mk = async () => {
  const ctx = await b.newContext({ viewport: { width: W, height: H }, hasTouch: touch, isMobile: touch, permissions: ["clipboard-read", "clipboard-write"] });
  await ctx.addInitScript(() => { localStorage.setItem("bunker.introSeen", "1"); localStorage.setItem("bunker.guide", '{"done":true}'); localStorage.setItem("bunker.tipsOff", "1"); });
  const p = await ctx.newPage();
  p.setDefaultTimeout(60000);
  return p;
};
const res = {};
const p = await mk();
await p.goto("http://localhost:5173/" + (touch ? "?mobile=1" : ""), { timeout: 90000 });
await p.getByPlaceholder("Ваше имя").fill("Хозяин");
await p.getByRole("button", { name: "Создать бункер", exact: true }).click();
await p.locator(".card").first().click();
const l = p.getByLabel("Без пролога");
if (await l.count()) await l.check().catch(() => {});
await p.getByRole("button", { name: /Начать/ }).first().click();
await p.waitForFunction(() => window.__net?.pub?.phase === "day" && window.__net.myChar?.(), null, { timeout: 60000 });
await p.waitForTimeout(1500);
const code = await p.evaluate(() => window.__net.code);
res.code = code;
res.hudCode = await p.evaluate(() => {
  const s = document.querySelector(".hud-time small");
  if (!s) return null;
  const r = s.getBoundingClientRect(), t = document.querySelector(".hud-time strong").getBoundingClientRect();
  return { text: s.textContent, visible: r.width > 0 && r.height > 0 && getComputedStyle(s).display !== "none", underTime: r.top >= t.bottom - 1, inScreen: r.right <= innerWidth && r.bottom <= innerHeight };
});
await p.screenshot({ path: `${OUT}/${W}x${H}-hud.png` });
await p.evaluate(() => [...document.querySelectorAll(".game-toolbar button")].find((x) => /Меню/.test(x.title))?.click());
await p.waitForTimeout(500);
res.menuCode = await p.evaluate(() => document.querySelector(".bunker-code b")?.textContent);
await p.evaluate(() => { delete navigator.share; });
await p.getByRole("button", { name: /Поделиться ссылкой/ }).click();
await p.waitForTimeout(500);
const link = await p.evaluate(() => navigator.clipboard.readText());
res.link = link;
await p.screenshot({ path: `${OUT}/${W}x${H}-menu.png` });
// a friend opens the link
const f = await mk();
await f.goto(link.replace("?code", touch ? "?mobile=1&code" : "?code"), { timeout: 90000 });
await f.waitForTimeout(1500);
const name = f.getByPlaceholder("Ваше имя");
if (await name.count()) await name.fill("Друг");
await f.getByRole("button", { name: /Войти|Присоединиться|Продолжить|В бункер/ }).first().click().catch(() => {});
await f.waitForFunction(() => window.__net?.code && window.__net.pub, null, { timeout: 30000 }).catch(() => {});
res.friendCode = await f.evaluate(() => window.__net?.code);
res.friendIn = await p.evaluate(() => Object.values(window.__net.pub.players).map((x) => x.name));
console.log(JSON.stringify(res));
await b.close();
