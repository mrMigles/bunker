// One-off generator for the PWA icons: `node scripts/gen-icons.mjs`
// Draws the hatch emblem as SVG and renders PNGs (192, 512, maskable 512, apple-touch 180) with Playwright.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "packages/client/public/icons";
mkdirSync(OUT, { recursive: true });

/** The emblem: a round blast hatch with a wheel, warm glow under it, on dark concrete. */
function svg(size, pad) {
  const c = size / 2,
    r = size / 2 - pad;
  const spokes = [0, 45, 90, 135].map((a) => `<rect x="${c - r * 0.06}" y="${c - r * 0.62}" width="${r * 0.12}" height="${r * 1.24}" rx="${r * 0.05}" fill="#d9c49a" transform="rotate(${a} ${c} ${c})"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <defs>
    <radialGradient id="glow" cx="50%" cy="58%" r="60%"><stop offset="0" stop-color="#ffb35c"/><stop offset="0.55" stop-color="#c8553d"/><stop offset="1" stop-color="#3a1d14"/></radialGradient>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#26302e"/><stop offset="1" stop-color="#121719"/></linearGradient>
  </defs>
  <rect width="${size}" height="${size}" fill="url(#bg)"/>
  <circle cx="${c}" cy="${c}" r="${r}" fill="url(#glow)"/>
  <circle cx="${c}" cy="${c}" r="${r * 0.86}" fill="#3b4447" stroke="#1a1f20" stroke-width="${r * 0.05}"/>
  <circle cx="${c}" cy="${c}" r="${r * 0.66}" fill="none" stroke="#d9c49a" stroke-width="${r * 0.1}"/>
  ${spokes}
  <circle cx="${c}" cy="${c}" r="${r * 0.14}" fill="#c8553d" stroke="#d9c49a" stroke-width="${r * 0.05}"/>
  ${[0, 60, 120, 180, 240, 300].map((a) => `<circle cx="${c + Math.cos((a * Math.PI) / 180) * r * 0.76}" cy="${c + Math.sin((a * Math.PI) / 180) * r * 0.76}" r="${r * 0.035}" fill="#1a1f20"/>`).join("")}
</svg>`;
}

const b = await chromium.launch();
const p = await b.newPage();
for (const [name, size, pad] of [
  ["icon-192.png", 192, 10],
  ["icon-512.png", 512, 24],
  ["maskable-512.png", 512, 90], // safe zone for Android adaptive icons
  ["apple-touch-icon.png", 180, 12],
]) {
  await p.setViewportSize({ width: size, height: size });
  await p.setContent(`<html><body style="margin:0">${svg(size, pad)}</body></html>`);
  await p.screenshot({ path: `${OUT}/${name}`, clip: { x: 0, y: 0, width: size, height: size } });
}
writeFileSync(`${OUT}/icon.svg`, svg(512, 24));
await b.close();
console.log("icons written to", OUT);
