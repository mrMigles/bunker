// Building like a player: `node scripts/e2e/build.mjs`
// B → pick a room in the palette → hover a valid spot → click → the room is planned, dug, framed, finished.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
mkdirSync("artifacts/e2e", { recursive: true });
const report = [];
const step = (name, ok, data = {}) => {
  report.push({ name, ok });
  console.log(`${ok ? "✔" : "✘"} ${name}`, JSON.stringify(data));
};
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const ev = (fn, arg) => page.evaluate(fn, arg);
await page.goto("http://localhost:5173");
// tutorial cards would cover the spot under test
await page.evaluate(() => localStorage.setItem("bunker.tipsOff", "1"));
await page.getByPlaceholder("Ваше имя").fill("Строитель");
await page.getByRole("button", { name: "Создать бункер", exact: true }).click();
await page.locator(".card").first().click();
await page.getByText("Без пролога", { exact: true }).click();
await page.getByRole("button", { name: "Готов", exact: true }).click();
await page.getByRole("button", { name: /Начать/ }).first().click();
await page.waitForFunction(() => window.__net?.pub?.phase === "day");
await page.waitForTimeout(1000);
const roomsBefore = await ev(() => Object.keys(window.__net.pub.rooms).length);
await page.keyboard.press("KeyB");
await page.waitForTimeout(300);
step("B opens the build palette", await ev(() => window.__game.build.active));
// pick a room from the palette like a player (click its row)
await page.locator(".panel b", { hasText: /^Гидропоника$/ }).first().click();
const type = await ev(() => window.__game.build.type);
step("palette click selects the room", type === "hydro", { type });
// find a valid spot by hovering over cells and reading the ghost's verdict
let spot = null;
for (let lv = 0; lv < 5 && !spot; lv++)
  for (let x = 2; x < 46 && !spot; x++) {
    const [sx, sy] = await ev(([x, lv]) => window.__game.r.toScreen(x + 0.5, -(lv * 2) - 1), [x, lv]);
    if (sx < 330 || sx > 1400 || sy < 90 || sy > 860) continue;
    await page.mouse.move(sx, sy);
    await page.waitForTimeout(40);
    const ok = await ev(() => /ЛКМ — разметить/.test(window.__game.build.info.textContent));
    if (ok) spot = { x, lv, sx, sy };
  }
step("a valid spot exists on screen", !!spot, spot ?? {});
if (spot) {
  await page.screenshot({ path: "artifacts/e2e/build-ghost.png" });
  await page.mouse.click(spot.sx, spot.sy);
  await page.waitForTimeout(800);
  const planned = await ev(() => Object.values(window.__net.pub.rooms).filter((r) => r.state !== "done").map((r) => `${r.type}:${r.state}@${r.x},${r.lv}`));
  step("click plans the room", planned.length > 0, { planned, roomsBefore, log: await ev(() => window.__net.pub.log.slice(-3).map((l) => l.text)) });
  await page.keyboard.press("KeyB");
  // hand my character to its bot («аквариум», H): an idle player body would only starve the colony
  await page.keyboard.press("KeyH");
  // let the residents work (fast-forward)
  await ev(() => window.__net.send({ k: "debug", op: "speed", arg: 10 }));
  let last = "";
  for (let i = 0; i < 60; i++) { // 3 residents build slower than 5 did: allow up to ~2.5 game days
    await page.waitForTimeout(5000);
    // a solo council waits for the player: say «ready» like a player would
    await ev(() => { const v = window.__net.pub; if (v.phase === "night" && v.council && !v.council.ready[window.__net.priv.pid]) window.__net.send({ k: "ready", v: true }); });
    const st = await ev(() => {
      const r = Object.values(window.__net.pub.rooms).find((r) => r.type === "hydro" && r.state !== "done") ?? Object.values(window.__net.pub.rooms).filter((r) => r.type === "hydro").pop();
      const chores = Object.values(window.__net.pub.chores ?? {}).map((c) => c.kind);
      const bots = Object.values(window.__net.pub.chars).map((c) => `${c.card.prof}:${c.task?.action ?? "-"}/${c.mind?.thought ?? ""}@${c.x.toFixed(0)},${c.lv}`).join(" ");
      return { bots, marks: Object.keys(window.__net.pub.marks ?? {}).length, state: r?.state, hour: window.__net.pub.hour.toFixed(1), day: window.__net.pub.day, chores: [...new Set(chores)].join(","), items: Object.values(window.__net.pub.items).length, res: `scrap ${window.__net.pub.res.scrap} parts ${window.__net.pub.res.parts} chem ${window.__net.pub.res.chem}` };
    });
    const line = JSON.stringify(st);
    if (line !== last) console.log("   ", line);
    last = line;
    if (st.state === "done") break;
  }
  const done = await ev(() => Object.values(window.__net.pub.rooms).filter((r) => r.type === "hydro" && r.state === "done").length);
  step("the planned room gets built", done >= 2, { hydroDone: done });
}
await page.screenshot({ path: "artifacts/e2e/build-end.png" });
step("no page errors", !errors.length, { errors: errors.slice(0, 3) });
await browser.close();
process.exit(report.every((r) => r.ok) ? 0 : 1);
