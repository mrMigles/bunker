// Telegram Mini App mode. Opened from a chat, the game goes straight into that chat's bunker:
// no menu, no other bunkers, the player is their Telegram account and carries their real name.
// Telegram's own script (loaded only here) gives the theme, the back button and haptics.
import { SERVER, net, setPlayerId } from "./net";
import { closeModal, isModalOpen, toast } from "./ui/dom";

export interface TgInfo {
  code: string;
  name: string;
  chatTitle?: string;
  verified: boolean;
}

export let tgInfo: TgInfo | null = null;

function initDataFromUrl(): string {
  const hash = new URLSearchParams(location.hash.slice(1));
  return hash.get("tgWebAppData") ?? "";
}

/** A Telegram Games link (?tg=token from the «Играть» button); kept for reloads of this tab. */
function gameToken(): string {
  const q = new URLSearchParams(location.search).get("tg");
  try {
    if (q) sessionStorage.setItem("bunker.tg", q);
    return q ?? sessionStorage.getItem("bunker.tg") ?? "";
  } catch {
    return q ?? "";
  }
}

/** Was the page opened from Telegram (a Mini App or the game button)? */
export function isTelegram() {
  return !!initDataFromUrl() || !!(window as any).Telegram?.WebApp?.initData || !!gameToken();
}

function loadScript(src: string) {
  if ((window as any).Telegram?.WebApp) return Promise.resolve();
  return new Promise<void>((res) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => res();
    s.onerror = () => res(); // the game works without it (no haptics, no back button)
    document.head.appendChild(s);
    setTimeout(res, 4000);
  });
}

export function tg(): any {
  return (window as any).Telegram?.WebApp;
}

let viewportBound = false;

/** Ask Telegram for the largest usable game surface and mirror its safe area into our HUD. */
async function prepareTelegramViewport() {
  await loadScript("https://telegram.org/js/telegram-web-app.js");
  const app = tg();
  const root = document.documentElement;
  const platform = String(app?.platform ?? "").toLowerCase();
  const phone = /iphone|ipod|android.*mobile/i.test(navigator.userAgent) ||
    ((platform === "ios" || platform === "android") && Math.min(screen.width, screen.height) <= 600);
  root.classList.add("tg", phone ? "tg-phone" : "tg-desktop");
  root.classList.remove(phone ? "tg-desktop" : "tg-phone");
  document.body.classList.add("tg");

  const syncViewport = () => {
    const area = app?.contentSafeAreaInset ?? app?.safeAreaInset ?? {};
    for (const side of ["top", "right", "bottom", "left"] as const)
      root.style.setProperty(`--tg-safe-${side}`, `${Math.max(0, Number(area[side]) || 0)}px`);
    const visibleHeight = Number(visualViewport?.height || innerHeight);
    const reportedHeight = Number(app?.viewportStableHeight || app?.viewportHeight || visibleHeight);
    const height = Math.min(reportedHeight, visibleHeight);
    root.style.setProperty("--app-height", `${Math.max(1, Math.round(height))}px`);
  };
  syncViewport();
  if (!viewportBound) {
    viewportBound = true;
    app?.onEvent?.("viewportChanged", syncViewport);
    app?.onEvent?.("safeAreaChanged", syncViewport);
    app?.onEvent?.("contentSafeAreaChanged", syncViewport);
    app?.onEvent?.("fullscreenChanged", syncViewport);
    visualViewport?.addEventListener("resize", syncViewport);
    window.addEventListener("resize", syncViewport);
  }

  try {
    app?.ready?.();
    app?.expand?.();
    app?.disableVerticalSwipes?.();
    app?.setHeaderColor?.("#121719");
    app?.setBackgroundColor?.("#121719");
    app?.requestFullscreen?.();
  } catch {
    /* Older clients still get the responsive layout and maximum available height. */
  }

  if (phone) {
    // Telegram can only lock the current orientation. The browser API can request
    // portrait explicitly where supported; otherwise lock after a portrait launch.
    try {
      const portraitLock = (screen.orientation as any)?.lock?.("portrait-primary");
      portraitLock?.catch?.(() => {});
    } catch {}

    const lockTelegramPortrait = () => {
      if (!matchMedia("(orientation: portrait)").matches) return;
      try { app?.lockOrientation?.(); } catch {}
    };
    lockTelegramPortrait();
    screen.orientation?.addEventListener?.("change", lockTelegramPortrait, { once: true });
  } else {
    try { app?.unlockOrientation?.(); } catch {}
  }
  return app;
}

/** Light haptic feedback when Telegram offers it. */
export function haptic(kind: "light" | "medium" | "heavy" | "success" | "error" = "light") {
  const hf = tg()?.HapticFeedback;
  if (!hf) return;
  if (kind === "success" || kind === "error") hf.notificationOccurred?.(kind);
  else hf.impactOccurred?.(kind);
}

/** Joins the chat's bunker. Returns false when not in Telegram (the normal menu then shows). */
export async function startTelegram(onJoined: () => void): Promise<boolean> {
  if (!isTelegram()) return false;
  const app = await prepareTelegramViewport();
  const token = gameToken();
  if (token && !initDataFromUrl()) {
    // Telegram Games: the page runs in Telegram's browser, the chat and the player come signed in the link
    const u = new URL(location.href);
    u.searchParams.delete("tg");
    history.replaceState(null, "", u.toString());
    const r = await fetch(`${SERVER}/api/tg/game`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
    const s = await r.json().catch(() => ({}));
    if (!r.ok || !s.code) {
      toast(s.error ?? "Не удалось войти через Telegram");
      try {
        sessionStorage.removeItem("bunker.tg");
      } catch {}
      return false;
    }
    tgInfo = { code: s.code, name: s.name, chatTitle: s.chatTitle, verified: s.verified };
    setPlayerId(s.pid);
    net.joinExtra = { sig: s.sig };
    localStorage.setItem("bunker.name", s.name);
    await net.join(s.code, s.name);
    onJoined();
    return true;
  }
  const initData = app?.initData || initDataFromUrl();
  const r = await fetch(`${SERVER}/api/tg/session`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ initData }) });
  const s = await r.json().catch(() => ({}));
  if (!r.ok || !s.code) {
    toast(s.error ?? "Не удалось войти через Telegram");
    return false;
  }
  tgInfo = { code: s.code, name: s.name, chatTitle: s.chatTitle, verified: s.verified };
  setPlayerId(s.pid);
  net.joinExtra = { sig: s.sig };
  localStorage.setItem("bunker.name", s.name);
  await net.join(s.code, s.name);
  // Telegram's back button closes windows first
  const back = app?.BackButton;
  if (back) {
    back.onClick?.(() => {
      if (isModalOpen()) closeModal();
    });
    setInterval(() => (isModalOpen() ? back.show?.() : back.hide?.()), 300);
  }
  onJoined();
  return true;
}
