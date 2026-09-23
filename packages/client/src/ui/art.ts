import { h } from "./dom";

/** 4×4 authored atlas: fixed tiles keep all HUD illustrations in one request. */
export function art(tile: number, cls = "") {
  return h("span.atlas-art" + (cls ? "." + cls : ""), {
    "aria-hidden": "true",
    style: { backgroundPosition: `${(tile % 4) * 100 / 3}% ${Math.floor(tile / 4) * 100 / 3}%` },
  });
}

export function portraitTile(prof: string) {
  if (/engineer|mechanic|miner|builder/.test(prof)) return 9;
  if (/medic|doctor|nurse/.test(prof)) return 10;
  if (/soldier|guard|hunter/.test(prof)) return 11;
  return 8;
}
