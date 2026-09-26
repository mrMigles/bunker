// Captures the three pictures of the intro cards (#43): the bunker, a sortie, the build mode.
// node scripts/qa/intro-shots.mjs → packages/client/public/assets/intro/*.jpg
import { chromium } from "@playwright/test";
const OUT = "packages/client/public/assets/intro";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 960, height: 600 } });
await ctx.addInitScript(() => localStorage.setItem("bunker.tipsOff", "1"));
await ctx.addInitScript(() => localStorage.setItem("bunker.introSeen", "1"));
const p = await ctx.newPage();
p.setDefaultTimeout(60000);
await p.goto("http://localhost:5173/", { timeout: 90000 });
await p.getByPlaceholder("Ваше имя").fill("Кадр");
await p.getByRole("button", { name: "Создать бункер", exact: true }).click();
await p.locator(".card").first().click();
const l = p.getByLabel("Без пролога");
if (await l.count()) await l.check().catch(() => {});
await p.getByRole("button", { name: /Начать/ }).first().click();
await p.waitForFunction(() => window.__net?.pub?.phase === "day" && window.__net.myChar?.(), null, { timeout: 60000 });
await p.waitForTimeout(4000);
await p.keyboard.press("Escape").catch(() => {});
// the scene only: the cards say the words
const shot = async (name) => {
  await p.evaluate(() => (document.getElementById("ui").style.visibility = "hidden"));
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/${name}.jpg`, type: "jpeg", quality: 68 });
  await p.evaluate(() => (document.getElementById("ui").style.visibility = ""));
};
await shot("bunker");
// the self-supply loop: hydroponics next to the pump and the filters
await p.evaluate(() => {
  const r = window.__r, v = window.__net.pub;
  const room = Object.values(v.rooms).find((x) => x.type === "hydro") ?? Object.values(v.rooms)[0];
  r.follow = false;
  r.viewH = 5.2;
  r.camX = room.x + room.w / 2 - 1;
  r.camY = -(room.lv * 2 + 1.1);
  r.updateCamera();
});
await p.waitForTimeout(1500);
await shot("grow");
await p.evaluate(() => (window.__r.follow = true));
// a sortie: straight into the nearest shop
await p.evaluate(() => window.__net.send({ k: "debug", op: "sortie" }));
await p.waitForFunction(() => document.body.classList.contains("mode-site"), null, { timeout: 30000 }).catch(() => {});
await p.waitForTimeout(4000);
await shot("sortie");
await b.close();
