// Telegram viewport contract: fullscreen request everywhere, portrait lock on phones,
// responsive landscape use on desktop, and Telegram safe-area propagation.
import { chromium } from '@playwright/test';

const base = process.env.MOBILE_URL || 'http://localhost:5180';
const tokenResponse = await fetch('http://localhost:2567/api/tg/dev-token?chat=viewport-test&user=901&name=TelegramQA');
const { token } = await tokenResponse.json();
if (!token) throw new Error('Development Telegram token is unavailable');
const browser = await chromium.launch({ headless: true });

async function run(name, viewport, platform, userAgent, expectedClass) {
  const ctx = await browser.newContext({ viewport, userAgent, hasTouch: expectedClass === 'tg-phone', isMobile: expectedClass === 'tg-phone' });
  await ctx.addInitScript(({ platform }) => {
    window.__tgCalls = [];
    const call = name => (...args) => window.__tgCalls.push([name, ...args]);
    window.Telegram = { WebApp: {
      initData: '', platform, viewportHeight: innerHeight, viewportStableHeight: innerHeight,
      contentSafeAreaInset: { top: 18, right: 7, bottom: 13, left: 5 },
      ready: call('ready'), expand: call('expand'), disableVerticalSwipes: call('disableVerticalSwipes'),
      setHeaderColor: call('setHeaderColor'), setBackgroundColor: call('setBackgroundColor'),
      requestFullscreen: call('requestFullscreen'), lockOrientation: call('lockOrientation'), unlockOrientation: call('unlockOrientation'),
      onEvent: call('onEvent'), BackButton: { onClick: call('back.onClick'), show: call('back.show'), hide: call('back.hide') },
    } };
  }, { platform });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}/?mobile=1&tg=${encodeURIComponent(token)}`);
  await page.waitForFunction(() => !!window.__net?.pub, null, { timeout: 20000 });
  const state = await page.evaluate(expectedClass => ({
    expectedClass: document.documentElement.classList.contains(expectedClass),
    otherClass: document.documentElement.classList.contains(expectedClass === 'tg-phone' ? 'tg-desktop' : 'tg-phone'),
    calls: window.__tgCalls.map(x => x[0]),
    safe: getComputedStyle(document.documentElement).getPropertyValue('--tg-safe-top').trim(),
    body: document.body.getBoundingClientRect().toJSON(),
    viewport: { width: innerWidth, height: innerHeight },
  }), expectedClass);
  const required = ['ready', 'expand', 'disableVerticalSwipes', 'requestFullscreen'];
  const ok = state.expectedClass && !state.otherClass && required.every(x => state.calls.includes(x)) &&
    state.safe === '18px' && !errors.length && state.body.width <= viewport.width + 1 && state.body.height <= viewport.height + 1;
  console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify({ ...state, errors }));
  await page.screenshot({ path: `artifacts/mobile-layout-verified/telegram-${name}.png` });
  await ctx.close();
  return ok;
}

const phone = await run('phone-portrait', { width: 390, height: 844 }, 'android', 'Mozilla/5.0 (Linux; Android 14; Mobile)', 'tg-phone');
const desktop = await run('desktop-landscape', { width: 1280, height: 720 }, 'tdesktop', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'tg-desktop');
await browser.close();
process.exitCode = phone && desktop ? 0 : 1;
