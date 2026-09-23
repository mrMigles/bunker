// Watch a bunker day like a newcomer: screenshots every 10 s + what is on screen (labels, toasts, feed).
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
mkdirSync("artifacts/e2e", { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://localhost:5173");
await page.getByPlaceholder("Ваше имя").fill("Наблюдатель");
await page.getByRole("button", { name: "Создать бункер", exact: true }).click();
await page.locator(".card").first().click();
await page.getByText("Без пролога", { exact: true }).click();
await page.getByRole("button", { name: "Готов", exact: true }).click();
await page.getByRole("button", { name: /Начать/ }).first().click();
await page.waitForFunction(() => window.__net?.pub?.phase === "day");
for (let i = 0; i < 6; i++) {
  await page.waitForTimeout(10000);
  const s = await page.evaluate(() => ({
    hour: window.__net.pub.hour.toFixed(1),
    labels: [...document.querySelectorAll(".layer *")].filter((e) => e.children.length === 0 && e.textContent.trim() && e.offsetParent).map((e) => e.textContent.trim()).slice(0, 30),
    toasts: [...document.querySelectorAll(".toast, .toasts *")].map((e) => e.textContent.trim()).filter(Boolean).slice(0, 6),
    feed: window.__net.pub.log.slice(-6).map((l) => l.text.slice(0, 90)),
  }));
  console.log(JSON.stringify(s));
  await page.screenshot({ path: `artifacts/e2e/watch-${i}.png` });
}
await browser.close();
