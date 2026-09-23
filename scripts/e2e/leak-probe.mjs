// Memory over time: `node scripts/e2e/leak-probe.mjs` — samples WebGL objects and JS heap in the bunker and in a site.
import { chromium } from "@playwright/test";
const browser = await chromium.launch({ headless: true, args: ["--enable-precise-memory-info"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://localhost:5173");
await page.getByPlaceholder("Ваше имя").fill("Память");
await page.getByRole("button", { name: "Создать бункер", exact: true }).click();
await page.locator(".card").first().click();
await page.getByText("Без пролога", { exact: true }).click();
await page.getByRole("button", { name: "Готов", exact: true }).click();
await page.getByRole("button", { name: /Начать/ }).first().click();
await page.waitForFunction(() => window.__net?.pub?.phase === "day");
const sample = (tag) => page.evaluate((tag) => {
  const i = window.__game.r.renderer.info;
  return `${tag} geo ${i.memory.geometries} tex ${i.memory.textures} prog ${i.programs?.length} calls ${i.render.calls} heap ${Math.round(performance.memory.usedJSHeapSize / 1e6)}MB dom ${document.getElementsByTagName("*").length}`;
}, tag);
for (let k = 0; k < 6; k++) { console.log(await sample("bunker " + k * 15 + "s")); await page.waitForTimeout(15000); }
await page.evaluate(() => { const o = Object.values(window.__net.pub.objs).find((o) => o.kind === "sortie_terminal"); window.__game.navigation.go(o.x + 0.5, o.lv, () => window.__net.send({ k: "do", a: "sortie", tt: "obj", t: o.id })); });
await page.waitForFunction(() => window.__net.pub.mods.expedition?.stage === "prep", null, { timeout: 30000 });
await page.getByRole("button", { name: "Выйти на поверхность →", exact: true }).click();
await page.waitForFunction(() => window.__net.pub.mods.expedition?.stage === "map");
for (let k = 0; k < 3; k++) { console.log(await sample("map " + k * 10 + "s")); await page.waitForTimeout(10000); }
await page.evaluate(() => window.__net.send({ k: "debug", op: "speed", arg: 8 }));
const dest = await page.evaluate(() => Object.values(window.__net.pub.mods.wmap.nodes).find((n) => n.id !== "home" && n.type !== "trader"));
await page.evaluate((id) => window.__net.send({ k: "expGo", node: id }), dest.id);
await page.waitForFunction((id) => window.__net.pub.mods.expedition?.node === id && window.__net.pub.mods.expedition.stage === "map", dest.id, { timeout: 90000 });
await page.evaluate(() => { window.__net.send({ k: "debug", op: "speed", arg: 1 }); window.__net.send({ k: "expEnter" }); });
await page.waitForFunction(() => window.__game.exp.mode === "site");
for (let k = 0; k < 8; k++) {
  console.log(await sample("site " + k * 15 + "s"));
  await page.keyboard.down(k % 2 ? "KeyA" : "KeyD"); await page.waitForTimeout(3000); await page.keyboard.up(k % 2 ? "KeyA" : "KeyD");
  await page.waitForTimeout(12000);
}
await browser.close();
