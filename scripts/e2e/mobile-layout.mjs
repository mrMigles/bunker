// Stateful mobile layout audit. Run against the exact client under test:
// MOBILE_URL=http://localhost:5180 node scripts/e2e/mobile-layout.mjs
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const base = process.env.MOBILE_URL || 'http://localhost:5180';
const out = `artifacts/mobile-layout-${process.env.PASS || 'verified'}`;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
await ctx.addInitScript(() => localStorage.setItem('bunker.tipsOff', '1'));
const page = await ctx.newPage();
page.setDefaultTimeout(10000);
const report = { checks: [], errors: [] };
page.on('pageerror', e => report.errors.push(e.message));
const check = (name, ok, data) => { report.checks.push({ name, ok, data }); console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(data ?? '')); };
const sizes = process.env.PASS === 'before' ? [[390, 844]] : [[390, 844], [320, 640], [844, 390], [740, 320]];
const cdp = await ctx.newCDPSession(page);
async function touchScrollEnd(selector) {
  const metrics = () => page.evaluate(s => { const e = document.querySelector(s); const r = e.getBoundingClientRect(); return { top: e.scrollTop, max: e.scrollHeight - e.clientHeight, x: r.left + 24, y: Math.min(innerHeight - 105, r.bottom - 105), end: r.top + 70 }; }, selector);
  let m = await metrics();
  for (let n = 0; n < 20 && m.top < m.max - 2; n++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: m.x, y: m.y }] });
    for (let i = 1; i <= 8; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: m.x, y: m.y + (m.end - m.y) * i / 8 }] });
      await page.waitForTimeout(25);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(200);
    m = await metrics();
  }
  check(`${selector} ${page.viewportSize().width}: touch scroll reaches end`, m.top >= m.max - 2, m);
}
async function start(arena = false) {
  await page.goto(`${base}/?mobile=1`);
  await page.getByPlaceholder('Ваше имя').fill('Мобильный тест');
  await page.getByRole('button', { name: 'Создать бункер', exact: true }).tap();
  await page.locator('.card').first().tap();
  await page.getByLabel('Без пролога').check();
  await page.getByRole('button', { name: 'Готов', exact: true }).tap();
  if (arena) await page.getByRole('button', { name: 'Тестовая арена', exact: true }).tap();
  else await page.getByRole('button', { name: 'Начать', exact: true }).tap();
  await page.waitForFunction(() => !!window.__game);
  const disable = page.getByRole('button', { name: 'Выключить подсказки', exact: true });
  if (await disable.isVisible()) await disable.tap();
}
async function capture(state, selectors) {
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(350);
    if (state === 'bunker-actions' && await page.locator('.action-dock .mobile-action-toggle').getAttribute('aria-expanded') === 'false') {
      await page.locator('.action-dock .mobile-action-toggle').tap();
      await page.waitForTimeout(100);
    }
    const geometry = await page.evaluate(selectors => {
      const found = selectors.flatMap(s => [...document.querySelectorAll(s)].filter(e => e.getBoundingClientRect().width && e.getBoundingClientRect().height).map(e => {
        const r = e.getBoundingClientRect();
        return { selector: s, text: e.textContent.slice(0, 60), x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom, overflow: e.scrollWidth > e.clientWidth + 2 };
      }));
      const overlaps = [];
      for (let i = 0; i < found.length; i++) for (let j = i + 1; j < found.length; j++) {
        const a = found[i], b = found[j];
        if (a.x < b.right - 2 && b.x < a.right - 2 && a.y < b.bottom - 2 && b.y < a.bottom - 2) overlaps.push([a.selector, b.selector]);
      }
      return { found, overlaps, outside: found.filter(r => r.x < -1 || r.y < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) };
    }, selectors);
    check(`${state} ${width}x${height}: panels in bounds and separate`, !geometry.outside.length && !geometry.overlaps.length, geometry);
    if (state === 'bunker') {
      const resources = await page.evaluate(() => [...document.querySelectorAll('.resource-meter')].map(e => { const r = e.getBoundingClientRect(); return { title: e.title, visible: r.width > 0 && r.left >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight }; }));
      check(`${state} ${width}x${height}: all seven resource counters visible`, resources.length === 7 && resources.every(r => r.visible), resources);
    }
    if (state.startsWith('combat')) {
      const actions = await page.locator('.combat-action').evaluateAll(es => es.map(e => ({ text: e.textContent, w: e.clientWidth, clipped: e.scrollWidth > e.clientWidth + 2 })));
      check(`${state} ${width}x${height}: combat commands readable`, actions.length === 6 && actions.every(a => a.w >= 40 && !a.clipped), actions);
    }
    if (['prep', 'character', 'council'].includes(state)) await touchScrollEnd(state === 'council' ? '.council-panel' : '.modal');
    await page.screenshot({ path: `${out}/${state}-${width}x${height}.png` });
  }
}
async function combatResizeSweep() {
  const sweep = [[320, 568], [344, 640], [375, 667], [390, 844], [430, 932], [540, 720], [600, 1024], [640, 480], [740, 320], [844, 390], [1024, 600]];
  for (const [width, height] of sweep) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(120);
    const result = await page.evaluate(() => {
      const rect = e => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
      const visible = s => [...document.querySelectorAll(s)].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
      const panels = visible('.combat-top, .combat-panel, .combat-intel').map(rect);
      const labels = visible('.combat-unit-label').map(rect);
      const intersects = (a, b) => a.left < b.right - 2 && b.left < a.right - 2 && a.top < b.bottom - 2 && b.top < a.bottom - 2;
      const labelOverlaps = [];
      for (let i = 0; i < labels.length; i++) {
        for (let j = i + 1; j < labels.length; j++) if (intersects(labels[i], labels[j])) labelOverlaps.push([i, j]);
        panels.forEach((p, j) => { if (intersects(labels[i], p)) labelOverlaps.push([i, `panel-${j}`]); });
      }
      const panel = document.querySelector('.combat-panel').getBoundingClientRect();
      return {
        outside: [...panels, ...labels].filter(r => r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1).length,
        labelOverlaps,
        panelShare: panel.height / innerHeight,
      };
    });
    check(`combat resize ${width}x${height}`, !result.outside && !result.labelOverlaps.length && result.panelShare <= .36, result);
  }
}
try {
  await start();
  await page.waitForFunction(() => window.__net.pub.phase === 'day');
  await capture('bunker', ['.hud-top', '.game-toolbar', '.objectives:not(.hidden)', '.hud-me', '.game-dock', '.touch-stick:not(.hidden)', '.touch-pad', '.action-dock:not(.hidden)']);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.action-dock .mobile-action-toggle').tap();
  check('nearby actions expand', await page.locator('.action-dock .opt:visible').count() > 1);
  await capture('bunker-actions', ['.action-dock:not(.hidden)', '.hud-me', '.touch-stick', '.touch-pad']);
  if (await page.locator('.action-dock .mobile-action-toggle').getAttribute('aria-expanded') === 'true') await page.locator('.action-dock .mobile-action-toggle').tap();
  await page.locator('.hud-me-toggle').tap();
  await capture('bunker-stats', ['.hud-me', '.game-dock', '.touch-stick', '.touch-pad', '.action-dock:not(.hidden)']);
  await page.locator('.hud-me-toggle').tap();
  await page.locator('.game-dock button').first().tap();
  await capture('character', ['.modal']);
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__net.send({ k: 'debug', op: 'night' }));
  await page.locator('.council-panel:not(.hidden)').waitFor();
  await capture('council', ['.hud-top', '.council-panel']);
  await page.evaluate(async () => { await window.__net.room.leave(); sessionStorage.clear(); });
  await start();
  await page.waitForFunction(() => window.__net.pub.phase === 'day');
  await page.evaluate(() => {
    const o = Object.values(window.__net.pub.objs).find(o => o.kind === 'sortie_terminal');
    window.__game.navigation.go(o.x + .5, o.lv, () => window.__net.send({ k: 'do', a: 'sortie', tt: 'obj', t: o.id }));
  });
  await page.locator('.exp-prep-modal').waitFor({ timeout: 30000 });
  await capture('prep', ['.modal']);
  await page.getByRole('button', { name: 'Выйти на поверхность →', exact: true }).tap();
  await page.waitForFunction(() => window.__game.exp.mode === 'map');
  await capture('map', ['.hud-top', '.exp-map']);
  await page.evaluate(() => window.__net.send({ k: 'debug', op: 'sortie' }));
  await page.waitForFunction(() => window.__game.exp.mode === 'site', null, { timeout: 15000 });
  await page.evaluate(() => window.__net.send({ k: 'debug', op: 'quiet' }));
  await page.waitForTimeout(500);
  await capture('site', ['.hud-top', '.game-toolbar', '.exp-hud:not(.hidden)', '.exp-dock:not(.hidden)', '.touch-stick:not(.hidden)', '.touch-pad', '.exp-context:not(.hidden)']);
  await page.locator('.exp-dock button').nth(2).tap();
  await capture('backpack', ['.modal']);
  await page.keyboard.press('Escape');
  await page.evaluate(async () => { await window.__net.room.leave(); sessionStorage.clear(); });
  await start(true);
  await page.waitForFunction(() => window.__game.combat?.active && window.__game.combat.cs?.phase === 'plan', null, { timeout: 15000 });
  await combatResizeSweep();
  await capture('combat', ['.combat-top', '.game-toolbar', '.combat-panel', '.combat-intel']);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.combat-panel-toggle').tap();
  check('combat commands collapse to reveal the field', await page.locator('.combat-panel').evaluate(e => getComputedStyle(e).display === 'none'));
  await page.locator('.combat-panel-toggle').tap();
  await page.locator('.combat-action').last().tap();
  await capture('combat-more', ['.combat-top', '.game-toolbar', '.combat-panel', '.combat-intel']);
  await page.locator('.combat-action').last().tap();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.combat-unit-label').filter({ has: page.locator('.nm:not(.player)') }).first().tap();
  await capture('combat-target', ['.combat-top', '.combat-panel', '.combat-intel']);
  await page.locator('.combat-action').filter({ hasText: 'Укрыться' }).tap();
  await page.waitForFunction(() => window.__game.combat.myUnit().ap < 3 && window.__game.combat.cs.phase === 'plan', null, { timeout: 20000 });
  check('cover command executed through touch UI', true);
  await page.locator('.combat-ready').tap();
  await page.waitForFunction(() => window.__game.combat.cs.phase !== 'plan' || window.__game.combat.cs.ready?.[window.__net.priv.pid], null, { timeout: 10000 });
  check('end-turn command accepted', true);
} catch (e) { check('scenario completed', false, String(e)); await page.screenshot({ path: `${out}/error.png` }); }
check('no browser errors', !report.errors.length, report.errors);
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
await browser.close();
process.exitCode = report.checks.every(c => c.ok) ? 0 : 1;
