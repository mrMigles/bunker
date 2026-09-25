// End-to-end «first session» of a newcomer: `node scripts/e2e/newcomer.mjs` (needs `pnpm dev` running).
// Menu → lobby → prologue (click loot, carry it to the hatch) → first day (objectives panel)
// → sortie (pre-filled squad and kit) → shop → search → home. Writes screenshots to artifacts/e2e/
// and a JSON report; exits non-zero if a step fails.
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
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });
const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);

try {
  // ------------------------------------------------ menu & lobby
  await page.goto("http://localhost:5173");
  await page.getByPlaceholder("Ваше имя").fill("Новичок");
  await page.getByRole("button", { name: "Создать бункер", exact: true }).click();
  await page.locator(".card").first().waitFor();
  const card = await ev(() => {
    const c = document.querySelector(".lobby .card");
    const h3 = c.querySelector("h3");
    const col = getComputedStyle(h3).color.match(/\d+/g).map(Number);
    return { text: c.innerText.slice(0, 80), lum: (col[0] + col[1] + col[2]) / 3 };
  });
  step("lobby cards readable (light text on dark card)", card.lum > 150, card);
  await shot("01-lobby");
  await page.locator(".card").first().click();
  await page.getByRole("button", { name: "Готов", exact: true }).click();
  await page.getByRole("button", { name: /Начать/ }).first().click();

  // ------------------------------------------------ prologue
  await page.waitForFunction(() => window.__net?.pub?.phase === "prologue" && window.__net.pub.mods.prologue, null, { timeout: 15000 });
  const pro = await ev(() => {
    const p = window.__net.pub.mods.prologue;
    return { dur: p.dur, W: p.W, houses: p.houses.length, items: p.items.length, hatch: p.hatchX };
  });
  step("prologue: 60 s, 6 houses, wide street", pro.dur === 60 && pro.houses === 6, pro);
  await wait(800);
  await shot("02-prologue");
  // click the nearest loot label on screen and see the character walk and pick it up
  const before = await ev(() => ({ x: window.__net.myChar().x, hands: window.__net.myChar().hands.length }));
  const target = await ev(() => {
    const p = window.__net.pub.mods.prologue, c = window.__net.myChar();
    const it = p.items.filter((i) => i.lv === 1 && !i.by).sort((a, b) => Math.abs(a.x - c.x) - Math.abs(b.x - c.x))[0];
    return it ? { id: it.id, x: it.x } : null;
  });
  await ev((id) => window.__game.pro.selectItem(id), target.id);
  await page.waitForFunction(() => window.__net.myChar().hands.length > 0, null, { timeout: 12000 }).catch(() => {});
  const after = await ev(() => ({ x: window.__net.myChar().x, hands: window.__net.myChar().hands.map((h) => h.item) }));
  step("prologue: selecting loot walks there and picks it up", after.hands.length > before.hands, { before, after, target });
  await ev(() => window.__game.pro.returnHome());
  await page.waitForFunction(() => window.__net.myChar().hands.length === 0, null, { timeout: 15000 }).catch(() => {});
  const delivered = await ev(() => Object.values(window.__net.pub.mods.prologue?.delivered ?? {}).reduce((a, b) => a + b, 0));
  step("prologue: carried loot drops into the hatch", delivered > 0, { delivered });
  // stay at the hatch until the flash
  const t0 = Date.now();
  await page.waitForFunction(() => window.__net.pub.phase === "day", null, { timeout: 90000 });
  const me = await ev(() => ({ rad: Math.round(window.__net.myChar().needs.rad), injury: window.__net.myChar().injury }));
  step("prologue ends; waiting at the hatch keeps you unhurt", me.rad < 20 && !me.injury, { ...me, waited: Math.round((Date.now() - t0) / 1000) });

  // ------------------------------------------------ first day
  await wait(2500);
  await shot("03-day1");
  const objectives = await ev(() => ({ list: (window.__net.pub.mods.objectives ?? []).map((o) => `${o.kind}:${o.text}`), panel: !document.querySelector(".objectives")?.classList.contains("hidden") }));
  step("day 1: «Задачи» panel shows priorities and the first tutorial step", objectives.panel && objectives.list.some((t) => t.startsWith("tutorial")), objectives);
  const clutter = await ev(() => document.querySelectorAll(".action-dock button, .action-dock .action").length);
  const floor = await ev(() => Object.values(window.__net.pub.items ?? {}).map((i) => i.item));
  step("day 1: no keepsake junk piled at the airlock", !floor.some((i) => ["album", "teddy", "gnome", "iron", "guitar", "plant_pot"].includes(i)), { floor, clutter });
  // click the tutorial objective (pedal) → the character walks to the bike
  const pedal = page.locator(".objective.tutorial.go").first();
  if (await pedal.count()) {
    await pedal.click();
    await page.waitForFunction(() => window.__game.prompt.focused, null, { timeout: 20000 }).catch(() => {});
    step("objective click walks to its target", !!(await ev(() => window.__game.prompt.focused)));
  }

  // ------------------------------------------------ sortie
  await ev(() => {
    const o = Object.values(window.__net.pub.objs).find((o) => o.kind === "sortie_terminal");
    window.__game.navigation.go(o.x + 0.5, o.lv, () => window.__net.send({ k: "do", a: "sortie", tt: "obj", t: o.id }));
  });
  await page.waitForFunction(() => window.__net.pub.mods.expedition?.stage === "prep", null, { timeout: 30000 });
  await wait(600);
  const prep = await ev(() => {
    const e = window.__net.pub.mods.expedition;
    return { squad: e.squad.length, weight: e.gearWeight, gear: e.gear };
  });
  step("sortie prep: squad pre-filled (me + residents) and a base kit packed", prep.squad >= 2 && prep.weight > 0, prep);
  await shot("04-prep");
  await page.getByRole("button", { name: "Выйти на поверхность →", exact: true }).click();
  await page.waitForFunction(() => window.__net.pub.mods.expedition?.stage === "map", null, { timeout: 10000 });
  await ev(() => window.__net.send({ k: "debug", op: "speed", arg: 8 }));
  const dest = await ev(() => Object.values(window.__net.pub.mods.wmap.nodes).find((n) => n.type === "shop") ?? Object.values(window.__net.pub.mods.wmap.nodes).find((n) => n.id !== "home"));
  await ev((id) => window.__net.send({ k: "expGo", node: id }), dest.id);
  const tTravel = Date.now();
  await page.waitForFunction((id) => window.__net.pub.mods.expedition?.stage === "map" && window.__net.pub.mods.expedition.node === id, dest.id, { timeout: 90000 });
  step("travel to the first location", true, { dest: dest.name, seconds: Math.round((Date.now() - tTravel) / 1000) });
  await ev(() => window.__net.send({ k: "debug", op: "speed", arg: 1 }));
  await ev(() => window.__net.send({ k: "expEnter" }));
  await page.waitForFunction(() => window.__game.exp.mode === "site", null, { timeout: 10000 });
  await wait(1200);
  await shot("05-site");
  // explore: walk the ground floor to the right for a while, log what happens
  const walk = async (ms) => {
    await page.keyboard.down("KeyD");
    await wait(ms);
    await page.keyboard.up("KeyD");
  };
  let fights = 0;
  // search what is visible: walk to each unsearched container and search it (like clicking ◇)
  const searchVisible = async () => {
    for (let k = 0; k < 4; k++) {
      if (await ev(() => !!window.__net.pub.mods.battle)) return;
      const ct = await ev(() => {
        const s = window.__net.pub.mods.expedition?.site, c = window.__net.myChar();
        if (!s) return null;
        return s.conts.filter((o) => o.searched < 1 && !o.locked && !o.coop && o.lv === c.lv).sort((a, b) => Math.abs(a.x - c.x) - Math.abs(b.x - c.x))[0] ?? null;
      });
      if (!ct) return;
      await ev((ct) => new Promise((res) => window.__game.navigation.go(ct.x + 0.5, ct.lv, () => { window.__net.send({ k: "sdo", a: "search", id: ct.id }); res(); })), ct);
      await page.waitForFunction((id) => { const s = window.__net.pub.mods.expedition?.site; return !s || window.__net.pub.mods.battle || (s.conts.find((c) => c.id === id)?.searched ?? 1) >= 1; }, ct.id, { timeout: 30000 }).catch(() => {});
    }
  };
  const trace = [];
  for (let i = 0; i < 6; i++) {
    await searchVisible();
    await walk(1500);
    trace.push(await ev(() => { const s = window.__net.pub.mods.expedition?.site, c = window.__net.myChar(); return s ? `x${c.x.toFixed(1)} lv${c.lv} conts${s.conts.length}/${s.conts.filter((o) => o.searched < 1).length} rooms${s.rooms.filter((r) => r.revealed).length}/${s.rooms.length}` : "no site"; }));
    if (await ev(() => !!window.__net.pub.mods.battle)) {
      fights++;
      // let the bots fight it out: plan automatically by ending turns
      await ev(() => window.__net.send({ k: "debug", op: "speed", arg: 4 }));
      await page.waitForFunction(() => !window.__net.pub.mods.battle, null, { timeout: 120000 }).catch(() => {});
      await ev(() => window.__net.send({ k: "debug", op: "speed", arg: 1 }));
    }
  }
  const site = await ev(() => {
    const e = window.__net.pub.mods.expedition;
    return { loot: e?.loot, log: e?.log?.slice(-8), squad: e?.squad.map((id) => ({ hp: Math.round(window.__net.pub.chars[id].needs.health), status: window.__net.pub.chars[id].status })) };
  });
  const alive = site.squad?.every((s) => s.status !== "dead");
  step("site: squad survives the first exploration", !!alive, { fights, ...site });
  step("site: searching finds loot", Object.keys(site.loot ?? {}).length > 0, { loot: site.loot, trace });
  await shot("06-site-explored");
  // go home
  await ev(() => window.__net.send({ k: "debug", op: "speed", arg: 8 }));
  await ev(() => {
    const e = window.__net.pub.mods.expedition;
    const s = e.site, c = window.__net.myChar();
    window.__game.navigation.go(s.exitX + 0.5, s.exitLv, () => window.__net.send({ k: "expLeaveSite" }));
  });
  await page.waitForFunction(() => window.__net.pub.mods.expedition?.stage === "map", null, { timeout: 60000 }).catch(() => {});
  await ev(() => window.__net.send({ k: "expHome" }));
  // the road home may cross a night: a solo council waits for the player's «Готов»
  for (let i = 0; i < 60 && (await ev(() => !!window.__net.pub.mods.expedition)); i++) {
    await ev(() => { const v = window.__net.pub; if (v.phase === "night" && v.council && !v.council.ready[window.__net.priv.pid]) window.__net.send({ k: "ready", v: true }); });
    await wait(2000);
  }
  await ev(() => window.__net.send({ k: "debug", op: "speed", arg: 1 }));
  const back = await ev(() => ({ home: !window.__net.pub.mods.expedition, me: window.__net.myChar().status, log: window.__net.pub.log.slice(-4).map((l) => l.text) }));
  step("squad returns home", back.home && back.me !== "dead", back);
  await shot("07-home");
} catch (err) {
  step("script error", false, { error: String(err).slice(0, 400) });
  await shot("zz-failure").catch(() => {});
}
report.errors = [...new Set(report.errors)].slice(0, 20);
step("no page errors", report.errors.length === 0, { errors: report.errors });
writeFileSync(`${OUT}/newcomer.json`, JSON.stringify(report, null, 2));
await browser.close();
process.exit(report.ok ? 0 : 1);
