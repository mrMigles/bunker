import { h } from "./dom";

/** 4×4 authored atlas: fixed tiles keep all HUD illustrations in one request. */
export function art(tile: number, cls = "") {
  return h("span.atlas-art" + (cls ? "." + cls : ""), {
    "aria-hidden": "true",
    style: { backgroundPosition: `${(tile % 4) * 100 / 3}% ${Math.floor(tile / 4) * 100 / 3}%` },
  });
}

/** Atlas portraits: 8 scout (woman), 9 engineer (man), 10 medic (woman), 11 soldier (man). Gender wins over profession. */
export function portraitTile(prof: string, gender?: number) {
  const tech = /engineer|mechanic|miner|builder|electrician/.test(prof);
  const med = /medic|doctor|nurse/.test(prof);
  if (gender === 1) return med ? 10 : 8;
  if (gender === 0) return tech ? 9 : 11;
  if (tech) return 9;
  if (med) return 10;
  if (/soldier|guard|hunter/.test(prof)) return 11;
  return 8;
}
