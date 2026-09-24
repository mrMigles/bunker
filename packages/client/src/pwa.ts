// PWA and updates. The service worker caches the game for fast starts and offline menus; every release
// has its own cache (BUILD_ID), and the page makes sure a new release really reaches the player:
//  - it checks for a new worker on start, every few minutes and whenever the tab comes back;
//  - in the menu or lobby it switches at once; in a running game it offers «Обновить» (and rejoins the
//    same bunker after the reload) instead of cutting a fight in half;
//  - without a service worker (plain browser tab, some webviews) /version is polled for the same banner.
import { h, ui } from "./ui/dom";

declare const __BUILD_ID__: string;
export const BUILD_ID: string = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev";
(window as any).__build = BUILD_ID;

let banner: HTMLElement | null = null;
let waiting: ServiceWorker | null = null;
let reloading = false;

/** Is a game in progress (switching would drop the player out of it)? */
function inGame() {
  const net = (window as any).__net;
  const phase = net?.pub?.phase;
  return !!net?.room && phase && phase !== "lobby";
}

function reloadIntoSameBunker() {
  if (reloading) return;
  reloading = true;
  const code = (window as any).__net?.code;
  const url = new URL(location.href);
  if (code) url.searchParams.set("code", code);
  location.replace(url.toString());
}

function applyUpdate() {
  if (waiting) waiting.postMessage("skipWaiting");
  else reloadIntoSameBunker();
}

function offerUpdate() {
  if (!inGame()) return applyUpdate();
  if (banner) return;
  banner = h(
    "div.update-banner",
    null,
    h("span", null, "Вышло обновление игры"),
    h("button.small.primary", { onclick: () => applyUpdate() }, "Обновить"),
    h("button.small", { onclick: () => (banner?.remove(), (banner = null)) }, "Позже"),
  );
  ui().appendChild(banner);
}

export function installPwa() {
  if (import.meta.env.DEV) return;
  // the manifest and icons are linked in index.html; here: the worker and the update checks
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("controllerchange", () => reloadIntoSameBunker());
    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((reg) => {
        const track = (w: ServiceWorker | null) => {
          if (!w) return;
          w.addEventListener("statechange", () => {
            // a new version installed while an old one controls the page
            if (w.state === "installed" && navigator.serviceWorker.controller) {
              waiting = w;
              offerUpdate();
            }
          });
        };
        if (reg.waiting && navigator.serviceWorker.controller) {
          waiting = reg.waiting;
          offerUpdate();
        }
        reg.addEventListener("updatefound", () => track(reg.installing));
        const check = () => reg.update().catch(() => {});
        setInterval(check, 5 * 60 * 1000);
        document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && check());
      })
      .catch(() => {});
  }
  // the version probe works with or without a service worker
  const probe = () =>
    fetch("/version", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (j?.build && j.build !== "dev" && BUILD_ID !== "dev" && j.build !== BUILD_ID) offerUpdate();
      })
      .catch(() => {});
  setTimeout(probe, 15000);
  setInterval(probe, 5 * 60 * 1000);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && probe());
}
