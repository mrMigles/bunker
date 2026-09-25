// Players' faces: a Telegram player shows their Telegram photo (served by our server), everyone else — and
// a Telegram player without a photo — a coloured circle with the first letter of their name.
import { SERVER } from "../net";
import { h } from "./dom";

/** The Telegram user id behind a player id (tg_123 → 123). */
export function tgUid(pid: string | null | undefined): string | null {
  return pid && pid.startsWith("tg_") ? pid.slice(3) : null;
}

const failed = new Set<string>();

/** A round face for a player; `off` greys it out (the player is away, a bot plays their resident). */
export function avatar(pid: string, name: string, color = 0xb8702c, size = 18, off = false): HTMLElement {
  const hex = "#" + (color >>> 0).toString(16).padStart(6, "0").slice(-6);
  const el = h(
    "span.ava" + (off ? ".off" : ""),
    { style: { width: size + "px", height: size + "px", fontSize: Math.round(size * 0.52) + "px", background: `radial-gradient(circle at 35% 30%, ${hex}, #1c1512 110%)` }, "aria-hidden": "true" },
    (name.trim()[0] ?? "?").toUpperCase(),
  );
  const uid = tgUid(pid);
  if (uid && !failed.has(uid)) {
    const img = h("img", { src: `${SERVER}/api/tg/avatar/${uid}`, alt: "", loading: "lazy", draggable: false }) as HTMLImageElement;
    img.onerror = () => {
      failed.add(uid);
      img.remove();
    };
    el.append(img);
  }
  return el;
}

/** The player who owns a resident: the one controlling it now, or a player who is away while a bot plays it. */
export function ownerOf(v: any, charId: string): any | null {
  const c = v?.chars?.[charId];
  if (c?.ctrl && v.players[c.ctrl]) return v.players[c.ctrl];
  for (const id in v?.players ?? {}) if (v.players[id].char === charId) return v.players[id];
  return null;
}
