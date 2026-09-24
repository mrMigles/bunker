// Screenshots of the main windows at a laptop size to hunt scrollbars: `node scripts/e2e/screens.mjs [outDir] [w] [h]`
import { chromium } from "@playwright/test";
const OUT = process.argv[2] ?? "artifacts/e2e";
const W = Number(process.argv[3] ?? 1366),
  H = Number(process.argv[4] ?? 768);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: W, height: H } });
const ev = (f, a) => p.evaluate(f, a);
await p.goto("http://localhost:5173");
await p.evaluate(() => localStorage.setItem("bunker.tipsOff", "1"));
await p.getByPlaceholder("Ваше имя").fill("Экран");
await p.getByRole("button", { name: "Создать бункер", exact: true }).click();
await p.locator(".card").first().click();
await p.screenshot({ path: `${OUT}/s-lobby.png` });
await p.getByText("Без пролога").click().catch(() => {});
await p.getByRole("button", { name: /Начать/ }).first().click();
await p.waitForFunction(() => window.__net?.pub?.phase === "day", null, { timeout: 30000 });
await p.waitForTimeout(1200);
const scrolls = async (name) => {
  const r = await ev(() => [...document.querySelectorAll(".modal, .modal *, .panel, .panel *")].filter((e) => e.scrollHeight > e.clientHeight + 4 && getComputedStyle(e).overflowY !== "visible").map((e) => `${e.className}`.slice(0, 40) + ` ${e.scrollHeight}/${e.clientHeight}`));
  console.log(name, JSON.stringify(r));
};
await ev(() => {
  const o = Object.values(window.__net.pub.objs).find((o) => o.kind === "sortie_terminal");
  window.__game.navigation.go(o.x + 0.5, o.lv, () => window.__net.send({ k: "do", a: "sortie", tt: "obj", t: o.id }));
});
await p.waitForSelector(".modal", { timeout: 20000 }).catch(() => {});
await p.waitForTimeout(800);
await p.screenshot({ path: `${OUT}/s-prep.png` });
await scrolls("prep");
await p.keyboard.press("Escape");
for (const [btn, name] of [["Убежище", "base"], ["Персонаж", "char"]]) {
  await p.getByRole("button", { name: new RegExp(btn) }).first().click();
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${OUT}/s-${name}.png` });
  await scrolls(name);
  await p.keyboard.press("Escape");
}
await ev(() => window.__net.send({ k: "debug", op: "sortie" }));
await p.waitForTimeout(2500);
await p.screenshot({ path: `${OUT}/s-site.png` });
await ev(() => window.__net.send({ k: "debug", op: "leaveSite" }));
await p.waitForTimeout(1500);
await p.screenshot({ path: `${OUT}/s-map.png` });
const sideScroll = await ev(() => { const e = document.querySelector(".exp-side"); return e ? [e.scrollHeight, e.clientHeight] : null; });
console.log("map side", JSON.stringify(sideScroll));
await ev(() => window.__net.send({ k: "expHome" }));
await ev(() => window.__net.send({ k: "debug", op: "speed", arg: 20 }));
await p.waitForFunction(() => !window.__net.pub.mods.expedition, null, { timeout: 60000 }).catch(() => {});
await ev(() => window.__net.send({ k: "debug", op: "speed", arg: 1 }));
await ev(() => window.__net.send({ k: "debug", op: "night" }));
await p.waitForTimeout(2500);
await p.screenshot({ path: `${OUT}/s-council.png` });
const cs = await ev(() => { const e = [...document.querySelectorAll(".panel")].find((x) => /Совет/.test(x.textContent)); return e ? [e.scrollHeight, e.clientHeight] : null; });
console.log("council", JSON.stringify(cs));
await b.close();
