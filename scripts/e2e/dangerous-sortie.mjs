// Survival check in the real client/server loop: `node scripts/e2e/dangerous-sortie.mjs [runs=3]`
// A default squad (auto-picked + base kit) goes to the most dangerous known place, walks every floor,
// searches everything it sees and fights whatever it meets (the player's unit is planned by the bot
// when the turn timer runs out — like an idle newcomer). Reports deaths, fights, health and loot.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const RUNS = Number(process.argv[2] ?? 3);
const TYPE = process.argv[3] ?? ""; // optional: only this location type (e.g. gas)
const mark = (m) => console.log("  ·", new Date().toISOString().slice(11, 19), m);
mkdirSync("artifacts/e2e", { recursive: true });
const results = [];
const browser = await chromium.launch({ headless: true });

for (let run = 0; run < RUNS; run++) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const res = { run, errors };
  try {
    await page.goto("http://localhost:5173");
    await page.getByPlaceholder("Ваше имя").fill("Разведчик" + run);
    await page.getByRole("button", { name: "Создать бункер", exact: true }).click();
    await page.locator(".card").first().click();
    await page.getByText("Без пролога", { exact: true }).click();
    await page.getByRole("button", { name: "Готов", exact: true }).click();
    await page.getByRole("button", { name: /Начать/ }).first().click();
    await page.waitForFunction(() => window.__net?.pub?.phase === "day");
    await ev(() => window.__net.send({ k: "settings", s: { combatTurnTime: 5 } }));
    await ev(() => {
      const o = Object.values(window.__net.pub.objs).find((o) => o.kind === "sortie_terminal");
      window.__game.navigation.go(o.x + 0.5, o.lv, () => window.__net.send({ k: "do", a: "sortie", tt: "obj", t: o.id }));
    });
    await page.waitForFunction(() => window.__net.pub.mods.expedition?.stage === "prep", null, { timeout: 30000 });
    await page.waitForTimeout(400);
    res.squad = await ev(() => window.__net.pub.mods.expedition.squad.map((id) => window.__net.pub.chars[id].card.prof));
    await page.getByRole("button", { name: "Выйти на поверхность →", exact: true }).click();
    await page.waitForFunction(() => window.__net.pub.mods.expedition?.stage === "map");
    const dest = await ev((type) => Object.values(window.__net.pub.mods.wmap.nodes).filter((n) => n.id !== "home" && !["trader", "camp", "ark"].includes(n.type) && (!type || n.type === type)).sort((a, b) => b.danger - a.danger)[0], TYPE);
    if (!dest) throw new Error("no such place known: " + TYPE);
    mark("dest " + dest.name);
    res.dest = `${dest.name} (опасность ${dest.danger})`;
    await ev(() => window.__net.send({ k: "debug", op: "speed", arg: 8 }));
    await ev((id) => window.__net.send({ k: "expGo", node: id }), dest.id);
    await page.waitForFunction((id) => { const e = window.__net.pub.mods.expedition; return !e || (e.stage === "map" && e.node === id); }, dest.id, { timeout: 120000 });
    await page.waitForFunction(() => !window.__net.pub.mods.battle, null, { timeout: 180000 }).catch(() => {});
    await ev(() => window.__net.send({ k: "debug", op: "speed", arg: 1 }));
    res.roadFights = await ev(() => (window.__net.pub.mods.expedition?.log ?? []).filter((l) => /Засада|стая|Стычка/.test(l)).length);
    mark("arrived; road fights " + res.roadFights);
    await ev(() => window.__net.send({ k: "expEnter" }));
    await page.waitForFunction(() => window.__game.exp.mode === "site", null, { timeout: 15000 });
    let fights = 0;
    const waitBattle = async () => {
      if (!(await ev(() => !!window.__net.pub.mods.battle))) return;
      fights++;
      mark("fight " + fights);
      await page.waitForFunction(() => !window.__net.pub.mods.battle, null, { timeout: 240000 }).catch(() => {});
      await page.waitForTimeout(800);
    };
    const goTo = (x, lv, then) => ev(([x, lv, then]) => new Promise((ok) => {
      window.__game.navigation.go(x, lv, () => { if (then) window.__net.send(then); ok(true); });
      setTimeout(() => ok(false), 25000);
    }), [x, lv, then]);
    // visit every room (floor by floor), searching what is visible
    for (let pass = 0; pass < 12; pass++) {
      await waitBattle();
      const st = await ev(() => {
        const e = window.__net.pub.mods.expedition, s = e?.site, c = window.__net.myChar();
        if (!s || c.status !== "away") return null;
        const cont = s.conts.filter((o) => o.searched < 1 && !o.locked && !o.coop).sort((a, b) => Math.abs(a.lv - c.lv) * 20 + Math.abs(a.x - c.x) - (Math.abs(b.lv - c.lv) * 20 + Math.abs(b.x - c.x)))[0];
        const room = s.rooms.filter((r) => !r.revealed && !r.stairs).sort((a, b) => Math.abs(a.lv - c.lv) * 20 + Math.abs(a.x - c.x) - (Math.abs(b.lv - c.lv) * 20 + Math.abs(b.x - c.x)))[0];
        return { cont, room };
      });
      if (!st) break;
      mark(`pass ${pass}: ${st.cont ? "search " + st.cont.name : st.room ? "room " + st.room.name : "done"}`);
      if (st.cont) {
        await goTo(st.cont.x + 0.5, st.cont.lv, { k: "sdo", a: "search", id: st.cont.id });
        await page.waitForFunction((id) => { const s = window.__net.pub.mods.expedition?.site; return !s || window.__net.pub.mods.battle || (s.conts.find((c) => c.id === id)?.searched ?? 1) >= 1; }, st.cont.id, { timeout: 30000 }).catch(() => {});
      } else if (st.room) await goTo(st.room.x + st.room.w / 2, st.room.lv);
      else break;
    }
    await waitBattle();
    res.fights = fights;
    const out = await ev(() => {
      const e = window.__net.pub.mods.expedition;
      return { loot: e?.loot ?? {}, squad: (e?.squad ?? []).map((id) => { const c = window.__net.pub.chars[id]; return { hp: Math.round(c.needs.health), status: c.status, inj: c.injury }; }), log: (e?.log ?? []).slice(-6) };
    });
    Object.assign(res, out);
    res.deaths = out.squad.filter((s) => s.status === "dead").length;
    await page.screenshot({ path: `artifacts/e2e/danger-${run}.png` });
  } catch (err) {
    res.error = String(err).slice(0, 300);
  }
  results.push(res);
  console.log(JSON.stringify({ run, dest: res.dest, squad: res.squad, road: res.roadFights, fights: res.fights, deaths: res.deaths, squadHp: res.squad && res.squad.map?.((s) => s.hp ?? s), lootKinds: Object.keys(res.loot ?? {}).length, error: res.error, errors: errors.slice(0, 3) }));
  await page.close();
}
await browser.close();
writeFileSync("artifacts/e2e/dangerous-sortie.json", JSON.stringify(results, null, 2));
const deaths = results.reduce((a, r) => a + (r.deaths ?? 0), 0);
console.log(`ИТОГО: смертей ${deaths} за ${RUNS} вылазок, боёв ${results.reduce((a, r) => a + (r.fights ?? 0), 0)}`);
