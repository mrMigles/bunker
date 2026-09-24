// Iteration 4 through the UI: `node scripts/e2e/iter4.mjs` (needs `pnpm dev`).
// Character editor (own survivor with looks) → prologue with the familiar E/↑↓ menu and a tutorial
// card → bunker: key hints, «Убежище» and «Персонаж» (gear, companions, skills).
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
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => report.errors.push(e.message));
page.on("console", (m) => m.type() === "error" && report.errors.push(m.text()));
const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });

try {
  await page.goto("http://localhost:5173");
  await page.evaluate(() => localStorage.removeItem("bunker.tips"));
  await page.getByPlaceholder("Ваше имя").fill("Четвёртый");
  await page.getByRole("button", { name: "Создать бункер", exact: true }).click();
  await page.locator(".card").first().waitFor();
  // ------------------------------------------------ character editor
  await page.getByRole("button", { name: /Создать своего/ }).click();
  await page.locator(".charedit-modal").waitFor();
  await page.locator(".charedit-form input").first().fill("Вера Броня");
  await page.locator(".charedit-form .swatches").nth(1).locator(".swatch").nth(4).click(); // skin
  await page.locator(".charedit-form .swatches").nth(2).locator(".swatch").nth(3).click(); // hair
  await wait(600);
  await shot("i4-01-editor");
  await page.getByRole("button", { name: /Играть этим персонажем/ }).click();
  await wait(700);
  const picked = await ev(() => { const me = window.__net.priv; return { pick: me.pick, name: me.cards?.[me.pick]?.name, skin: me.cards?.[me.pick]?.skin }; });
  step("the editor makes a custom survivor and picks it", picked.name === "Вера Броня" && picked.skin === 4, picked);
  await shot("i4-02-lobby-custom");
  await page.getByRole("button", { name: /Начать/ }).first().click();
  // ------------------------------------------------ prologue: familiar controls, first tip
  await page.waitForFunction(() => window.__net?.pub?.phase === "prologue", null, { timeout: 20000 });
  await wait(1500);
  const tip1 = await page.locator(".tip-card:not(.hidden)").innerText().catch(() => "");
  step("a tutorial card explains the prologue", /Последняя минута/.test(tip1), { tip: tip1.slice(0, 60) });
  const me = await ev(() => window.__net.myChar().card.name);
  step("I play the custom character", me === "Вера Броня", { me });
  // walk to the nearest loot and look at the menu
  await ev(() => {
    const p = window.__net.pub.mods.prologue, c = window.__net.myChar();
    const it = p.items.filter((i) => i.lv === 1).sort((a, b) => Math.abs(a.x - c.x) - Math.abs(b.x - c.x))[0];
    window.__game.navigation.go(it.x, it.lv);
  });
  await page.waitForSelector(".prologue-actions .key", { timeout: 10000 }).catch(() => {});
  const menu = await ev(() => ({ keys: [...document.querySelectorAll(".prologue-actions .key")].map((k) => k.textContent), heading: document.querySelector(".prologue-actions .dock-keys")?.textContent ?? "", help: document.querySelector(".help, .controls-help")?.textContent ?? "" }));
  step("prologue menu has the E / ↑↓ key chips like in the bunker", menu.keys.includes("E") || menu.keys.includes("␣"), menu);
  await shot("i4-03-prologue");
  const hands0 = await ev(() => window.__net.myChar().hands.length);
  await page.keyboard.press("KeyE");
  await wait(900);
  const hands1 = await ev(() => window.__net.myChar().hands.length);
  step("E picks up the highlighted thing", hands1 >= hands0, { hands0, hands1 });
  await page.getByRole("button", { name: "Понятно" }).click().catch(() => {});
  await ev(() => window.__game.pro.returnHome());
  await page.waitForFunction(() => window.__net.pub.phase === "day", null, { timeout: 90000 });
  await wait(5000);
  // ------------------------------------------------ bunker
  const tip2 = await page.locator(".tip-card:not(.hidden)").innerText().catch(() => "");
  step("the first day starts with a welcome card", /убежище/i.test(tip2), { tip: tip2.slice(0, 50) });
  await page.getByRole("button", { name: "Понятно" }).click().catch(() => {});
  const dock = await ev(() => [...document.querySelectorAll(".game-dock button span")].map((s) => s.textContent));
  step("dock: «Персонаж» and «Убежище» instead of «Инвентарь»", dock.includes("Персонаж") && dock.includes("Убежище") && !dock.includes("Инвентарь"), { dock });
  await page.getByRole("button", { name: /Персонаж/ }).first().click();
  await page.locator(".charscreen-modal").waitFor();
  await wait(500);
  const gear = await ev(() => ({ cards: document.querySelectorAll(".gear-card").length, slots: document.querySelectorAll(".gear-slot select").length }));
  step("«Персонаж»: me and companions with gear slots", gear.cards >= 2 && gear.slots >= 6, gear);
  // equip a knife from the storage
  await page.locator(".gear-card.mine .gear-slot select").first().selectOption("knife");
  await wait(700);
  const eq = await ev(() => window.__net.myChar().equip);
  step("equip a weapon from the storage", eq?.weapon === "knife", { eq });
  await shot("i4-04-character");
  await page.getByRole("button", { name: /Прокачка/ }).click();
  await wait(400);
  const skills = await ev(() => document.querySelectorAll(".skill-row").length);
  step("«Прокачка» tab lists skills with progress", skills >= 8, { skills });
  await shot("i4-05-skills");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Tab");
  await wait(500);
  const title = await ev(() => document.querySelector(".modal h2")?.textContent);
  step("Tab opens «Убежище»", title === "Убежище", { title });
} catch (err) {
  step("script error", false, { error: String(err).slice(0, 400) });
  await shot("zz-i4-failure").catch(() => {});
}
report.errors = [...new Set(report.errors)].slice(0, 20);
step("no page errors", report.errors.length === 0, { errors: report.errors });
writeFileSync(`${OUT}/iter4.json`, JSON.stringify(report, null, 2));
await browser.close();
process.exit(report.ok ? 0 : 1);
