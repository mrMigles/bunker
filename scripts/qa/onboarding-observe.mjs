import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const out = "artifacts/onboarding-issue";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const observations = [];
const record = async (name) => {
  await page.screenshot({ path: `${out}/${name}.png` });
  observations.push({ name, text: (await page.locator("body").innerText()).slice(0, 5000), phase: await page.evaluate(() => window.__net?.pub?.phase ?? null) });
};
await page.goto("http://localhost:5173/", { timeout: 90000 });
await record("01-menu");
await page.getByPlaceholder("Ваше имя").fill(`Новый игрок ${Date.now()}`);
await page.getByRole("button", { name: "Создать бункер", exact: true }).click();
await page.locator(".card").first().waitFor({ timeout: 60000 });
await record("02-lobby-unselected");
await page.locator(".card").first().click();
await record("03-lobby-selected");
await page.getByRole("button", { name: "Начать", exact: true }).click();
await page.waitForFunction(() => window.__net?.pub?.phase === "prologue", null, { timeout: 60000 });
await page.waitForTimeout(2000);
await record("04-prologue-start");
const ok = page.getByRole("button", { name: "Понятно", exact: true });
if (await ok.count()) await ok.first().click();
await record("05-prologue-after-tip");
const loot = page.locator(".loot-marker:visible").first();
if (await loot.count()) {
  await loot.click({ timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await record("06-prologue-loot");
}
await page.waitForFunction(() => window.__net?.pub?.phase === "day", null, { timeout: 160000 });
await page.waitForTimeout(3000);
await record("07-bunker-entry");
if (await ok.count()) await ok.first().click().catch(() => {});
await record("08-bunker-after-tip");
writeFileSync(`${out}/observations.json`, JSON.stringify(observations, null, 2));
console.log(JSON.stringify(observations.map(({ name, phase, text }) => ({ name, phase, text: text.slice(0, 1000) }))));
await browser.close();
