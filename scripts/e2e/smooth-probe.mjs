// Frame-by-frame smoothness of the player's own character and of a bot: `node scripts/e2e/smooth-probe.mjs`
import { chromium } from "@playwright/test";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto("http://localhost:5173");
await page.getByPlaceholder("Ваше имя").fill("Плавность");
await page.getByRole("button", { name: "Создать бункер", exact: true }).click();
await page.locator(".card").first().click();
await page.getByText("Без пролога", { exact: true }).click();
await page.getByRole("button", { name: "Готов", exact: true }).click();
await page.getByRole("button", { name: /Начать/ }).first().click();
await page.waitForFunction(() => window.__net?.pub?.phase === "day");
await page.waitForTimeout(1500);
await page.evaluate(() => {
  window.__trace = [];
  const r = window.__game.r;
  const me = window.__net.priv.char;
  const bot = Object.keys(window.__net.pub.chars).find((id) => id !== me);
  const loop = (t) => {
    const cm = r.chars.get(me), cb = r.chars.get(bot);
    window.__trace.push([t, cm?.root.position.x, cb?.root.position.x]);
    if (window.__trace.length < 400) requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
});
await page.keyboard.down("KeyD");
await page.waitForTimeout(2500);
await page.keyboard.up("KeyD");
await page.keyboard.down("KeyA");
await page.waitForTimeout(2500);
await page.keyboard.up("KeyA");
const tr = await page.evaluate(() => window.__trace);
const stats = (col) => {
  const v = [];
  for (let i = 1; i < tr.length; i++) {
    const dt = (tr[i][0] - tr[i - 1][0]) / 1000;
    if (dt <= 0) continue;
    v.push(Math.abs(tr[i][col] - tr[i - 1][col]) / dt);
  }
  const moving = v.filter((x) => x > 0.2);
  const mean = moving.reduce((a, b) => a + b, 0) / Math.max(1, moving.length);
  const sd = Math.sqrt(moving.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, moving.length));
  const stalls = v.filter((x, i) => x < 0.05 && v[i - 1] > 1 && v[i + 1] > 1).length;
  return `кадров ${v.length}, в движении ${moving.length}, скорость ${mean.toFixed(2)} кл/с, разброс ${(sd / Math.max(0.01, mean) * 100).toFixed(0)}%, «замираний» посреди хода ${stalls}`;
};
console.log("свой  :", stats(1));
console.log("бот   :", stats(2));
const fps = tr.length / ((tr[tr.length - 1][0] - tr[0][0]) / 1000);
console.log("fps ~", fps.toFixed(0));
await browser.close();
