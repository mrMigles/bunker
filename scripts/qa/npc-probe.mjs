// NPC crowds on the real server: one day at ×10 in «Наблюдать», screenshot every crowd of 3+ idle residents.
// node npc-probe.mjs <run>
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
const RUN = process.argv[2] ?? "1";
const OUT = "artifacts/qa-smoke/npc";
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
p.setDefaultTimeout(60000);
await p.addInitScript(() => localStorage.setItem("bunker.tipsOff", "1"));
await p.goto("http://localhost:5173", { timeout: 90000 });
await p.getByPlaceholder("Ваше имя").fill("NPC" + RUN);
await p.getByRole("button", { name: "Создать бункер", exact: true }).click();
await p.locator(".card").first().click();
await p.getByLabel("Без пролога").check();
await p.getByRole("button", { name: /Начать/ }).first().click();
await p.waitForFunction(() => window.__net?.pub?.phase === "day" && window.__net.myChar?.(), null, { timeout: 60000 });
await p.keyboard.press("KeyH"); // aquarium: my resident is a bot too
await p.evaluate(() => window.__net.send({ k: "debug", op: "speed", arg: 10 }));
const crowds = [];
let shots = 0, samples = 0, crowdSamples = 0;
const t0 = Date.now();
while (Date.now() - t0 < 150000) {
  const s = await p.evaluate(() => {
    const v = window.__net.pub;
    if (v.phase !== "day") return { phase: v.phase };
    const rooms = Object.values(v.rooms ?? {});
    const roomAt = (x, lv) => rooms.find((r) => r.lv === lv && x >= r.x && x < r.x + r.w)?.type ?? "—";
    const loose = Object.values(v.chars).filter((c) => c.status === "ok" && c.lv >= 0 && !c.task).sort((a, b) => a.lv - b.lv || a.x - b.x);
    let run = [], best = [];
    for (const c of loose) { const pr = run[run.length - 1]; if (pr && pr.lv === c.lv && c.x - pr.x <= 0.8) run.push(c); else run = [c]; if (run.length > best.length) best = [...run]; }
    return { phase: v.phase, hour: Math.round(v.hour * 10) / 10, n: best.length, where: best[0] ? roomAt(best[0].x, best[0].lv) : null, who: best.map((c) => `${c.card.name.split(" ")[0]}: ${c.mind?.plan ?? "?"} · ${c.mind?.thought ?? ""}`), x: best[0]?.x, lv: best[0]?.lv };
  });
  if (s.phase !== "day") break;
  samples++;
  if (s.n >= 3) {
    crowdSamples++;
    crowds.push(s);
    if (shots < 3) {
      await p.evaluate(({ x, lv }) => { const g = window.__game; g.r.camX = x; g.r.camY = lv * 2 + 1; }, s).catch(() => {});
      await p.waitForTimeout(300);
      await p.screenshot({ path: `${OUT}/crowd-${RUN}-${shots}.png` });
      shots++;
    }
  }
  await p.waitForTimeout(1500);
}
const by = {};
for (const c of crowds) for (const w of c.who) { const k = `${c.where}: ${w.replace(/^[^:]+: /, "")}`; by[k] = (by[k] ?? 0) + 1; }
console.log(JSON.stringify({ run: RUN, samples, crowdSamples, crowdShare: Math.round((crowdSamples / Math.max(1, samples)) * 100), maxCrowd: Math.max(0, ...crowds.map((c) => c.n)), top: Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 8), firstHours: crowds.slice(0, 5).map((c) => c.hour) }));
await b.close();
