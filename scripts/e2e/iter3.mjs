// Iteration 3 features through the UI: `node scripts/e2e/iter3.mjs` (needs `pnpm dev`).
// Prologue sky (radio, strikes) → storage tab (weapons, games) → pump minigame → talk →
// intercom visitor → sortie: map picture, always-on context menu, E-hold rush search,
// room search with companions on their own spots and speech bubbles.
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
const goDo = (kind, action) =>
  ev(
    ([kind, action]) =>
      new Promise((res) => {
        const o = Object.values(window.__net.pub.objs).find((o) => o.kind === kind);
        if (!o) return res(false);
        window.__game.navigation.go(o.x + 0.5, o.lv, () => {
          window.__net.send({ k: "do", a: action, tt: "obj", t: o.id });
          res(true);
        });
      }),
    [kind, action],
  );

try {
  await page.goto("http://localhost:5173");
  await page.getByPlaceholder("Ваше имя").fill("Третий");
  await page.getByRole("button", { name: "Создать бункер", exact: true }).click();
  await page.locator(".card").first().click();
  await page.getByRole("button", { name: /Начать/ }).first().click();
  // ------------------------------------------------ the prologue: the end of the world
  await page.waitForFunction(() => window.__net?.pub?.phase === "prologue", null, { timeout: 20000 });
  const radio0 = await page.locator(".raid-radio").innerText().catch(() => "");
  step("prologue: civil-defence radio is on", /тревога/i.test(radio0), { radio0 });
  await page.waitForFunction(() => (window.__net.pub.mods.prologue?.t ?? 0) >= 26, null, { timeout: 60000 });
  await shot("i3-01-prologue-strikes");
  const radio1 = await page.locator(".raid-radio").innerText().catch(() => "");
  step("prologue: strikes on the horizon, the radio follows them", radio1 !== radio0, { radio1 });
  await ev(() => window.__game.pro.returnHome());
  await page.waitForFunction(() => window.__net.pub.phase === "day", null, { timeout: 90000 });
  await wait(1500);
  const chars = await ev(() => Object.values(window.__net.pub.chars).length);
  step("start: me + at most 3 residents", chars <= 4, { chars });

  // ------------------------------------------------ storage shows weapons
  await page.getByRole("button", { name: /Инвентарь/ }).click();
  await wait(400);
  const store = await page.locator(".store-grid").innerText();
  step("storage tab lists weapons and board games", /Оружие/.test(store) && /Нож|Труба/.test(store) && /Настольные/.test(store));
  await shot("i3-02-store");
  await page.keyboard.press("Escape");

  // ------------------------------------------------ pump minigame
  await goDo("hand_pump", "pump");
  const mini = await page.waitForSelector(".mini-modal", { timeout: 20000 }).then(() => true).catch(() => false);
  step("pumping opens the pump minigame", mini);
  const box = await page.locator(".mini-canvas").boundingBox().catch(() => null);
  const dirty0 = await ev(() => window.__net.pub.res.water_dirty ?? 0);
  if (box) {
    for (let i = 0; i < 7; i++) {
      await page.mouse.move(box.x + 100, box.y + 45);
      await page.mouse.down();
      await page.mouse.move(box.x + 100, box.y + 235, { steps: 6 });
      await wait(200);
      await page.mouse.move(box.x + 100, box.y + 40, { steps: 6 });
      await page.mouse.up();
      await wait(200);
    }
  }
  await shot("i3-03-minigame");
  await page.waitForFunction((d) => (window.__net.pub.res.water_dirty ?? 0) > d, dirty0, { timeout: 8000 }).catch(() => {});
  const dirty1 = await ev(() => window.__net.pub.res.water_dirty ?? 0);
  step("hand strokes fill the bucket (task done by the minigame)", dirty1 > dirty0, { dirty0, dirty1 });
  if (await page.locator(".mini-modal").count()) await page.keyboard.press("Escape");

  // ------------------------------------------------ talk to a resident
  const other = await ev(() => {
    const me = window.__net.myChar();
    const o = Object.values(window.__net.pub.chars).find((c) => c.id !== me.id && c.status === "ok");
    return o ? { id: o.id, x: o.x, lv: o.lv } : null;
  });
  await ev((t) => window.__game.navigation.go(t.x, t.lv, () => window.__net.send({ k: "do", a: "talk", tt: "char", t: t.id })), other);
  const talk = await page.waitForSelector(".talk-modal", { timeout: 20000 }).then(() => true).catch(() => false);
  const story = talk ? await page.locator(".talk-text").innerText() : "";
  step("talking to a resident shows today's story", talk && story.length > 20, { story: story.slice(0, 80) });
  await shot("i3-04-talk");
  if (talk) await page.locator(".talk-modal .intercom-opts button").first().click();
  await wait(500);
  if (await page.locator(".talk-modal").count()) await page.keyboard.press("Escape");

  // ------------------------------------------------ the intercom rings
  await ev(() => window.__net.send({ k: "debug", op: "intercom" }));
  await page.waitForFunction(() => !!window.__net.pub.mods.intercom, null, { timeout: 10000 }).catch(() => {});
  await goDo("intercom", "intercom");
  const icOpen = await page.waitForSelector(".intercom-modal", { timeout: 20000 }).then(() => true).catch(() => false);
  step("the intercom rings and opens a dialog with the visitor", icOpen);
  await shot("i3-05-intercom");
  if (icOpen) await page.keyboard.press("Escape");

  // ------------------------------------------------ sortie: map, context menu, rush, room search
  await ev(() => window.__net.send({ k: "debug", op: "sortie" }));
  await page.waitForFunction(() => window.__game.exp.mode === "site", null, { timeout: 20000 });
  await wait(1500);
  const menu = await ev(() => ({ visible: !document.querySelector(".exp-context")?.classList.contains("hidden"), sel: document.querySelectorAll(".exp-action.sel").length, n: window.__game.exp.actions.length }));
  step("context menu shows by itself near things, first option highlighted", menu.visible && menu.sel === 1, menu);
  await shot("i3-06-site-menu");
  // the entrance hall is empty: walk into the next room, then find a container
  await page.keyboard.down("KeyD");
  await wait(2600);
  await page.keyboard.up("KeyD");
  await wait(600);
  // walk to a container, press and hold E: a fast, loud search
  const ct = await ev(() => {
    const s = window.__net.pub.mods.expedition.site, c = window.__net.myChar();
    return s.conts.filter((o) => o.searched < 1 && !o.locked && !o.coop && o.lv === c.lv).sort((a, b) => Math.abs(a.x - c.x) - Math.abs(b.x - c.x))[0] ?? null;
  });
  if (ct) {
    await ev((ct) => new Promise((res) => window.__game.navigation.go(ct.x + 0.5, ct.lv, res)), ct);
    await wait(400);
    const idx = await ev((id) => window.__game.exp.actions.findIndex((a) => a.id === id && a.a === "search"), ct.id);
    await ev((i) => (window.__game.exp.sel = Math.max(0, i)), idx);
    await page.keyboard.down("KeyE");
    await wait(900);
    const rush = await ev(() => window.__net.pub.mods.expedition.tasks[window.__net.priv.char]?.rush ?? null);
    const noise = await ev(() => window.__net.pub.mods.expedition.site.noise);
    await shot("i3-07-rush");
    await page.waitForFunction((id) => (window.__net.pub.mods.expedition?.site?.conts.find((c) => c.id === id)?.searched ?? 1) >= 1, ct.id, { timeout: 15000 }).catch(() => {});
    await page.keyboard.up("KeyE");
    step("holding E turns the search into a loud rush", rush === true, { rush, noise });
  } else step("a container to search", false);
  // room search
  const room = await ev(() => window.__game.exp.actions.find((a) => a.a === "searchRoom") ?? null);
  if (room) {
    await ev((r) => window.__net.send({ k: "sdo", a: r.a, id: r.id }), room);
    await wait(1500);
    const busy = await ev(() => { const e = window.__net.pub.mods.expedition; return e.squad.filter((id) => id !== window.__net.priv.char && e.tasks[id]).length; });
    step("«обыскать комнату» sends the companions to containers", busy >= 1, { busy });
    await shot("i3-08-room-search");
  } else console.log("  (no room with 2+ containers here — skipped room search)");
  await wait(2500);
  const spread = await ev(() => {
    const e = window.__net.pub.mods.expedition;
    const xs = e.squad.map((id) => window.__net.pub.chars[id].x).sort((a, b) => a - b);
    let minGap = 99;
    for (let i = 1; i < xs.length; i++) minGap = Math.min(minGap, xs[i] - xs[i - 1]);
    return { xs, minGap, bubbles: document.querySelectorAll(".exp-bubble").length };
  });
  step("companions stand apart", spread.minGap > 0.25, spread);
  // the map
  await ev(() => window.__net.send({ k: "debug", op: "leaveSite" }));
  await page.waitForFunction(() => window.__game.exp.mode === "map", null, { timeout: 15000 }).catch(() => {});
  await wait(800);
  const mapImg = await ev(() => !!document.querySelector(".wmap image"));
  step("the map shows the drawn city of Новоград", mapImg);
  await shot("i3-09-map");
} catch (err) {
  step("script error", false, { error: String(err).slice(0, 400) });
  await shot("zz-i3-failure").catch(() => {});
}
report.errors = [...new Set(report.errors)].slice(0, 20);
step("no page errors", report.errors.length === 0, { errors: report.errors });
writeFileSync(`${OUT}/iter3.json`, JSON.stringify(report, null, 2));
await browser.close();
process.exit(report.ok ? 0 : 1);
