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

/** Was the page opened inside Telegram? */
export function isTelegram() {
  return !!initDataFromUrl() || !!(window as any).Telegram?.WebApp?.initData;
}

function loadScript(src: string) {
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
  await loadScript("https://telegram.org/js/telegram-web-app.js");
  const app = tg();
  try {
    app?.ready?.();
    app?.expand?.();
    app?.disableVerticalSwipes?.();
    app?.setHeaderColor?.("#121719");
    app?.setBackgroundColor?.("#121719");
    // a game wants the whole screen on phones (Bot API 8+)
    if (/Android|iPhone|iPad/i.test(navigator.userAgent)) app?.requestFullscreen?.();
  } catch {
    /* older clients */
  }
  document.body.classList.add("tg");
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
