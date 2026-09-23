import { sanityGainMult } from "./needs";
import radioJson from "../data/radio.json";
import type { World } from "../types";
import { defAction } from "./actions";
import { registerCmd } from "./commands";
import { WEATHER } from "./director";
import { EVENT_BY_ID } from "./events";
import { company } from "./leisure";
import { onTick } from "./tick";
import { timeMult } from "./time";
import { clamp, fx, hoursPerSec, isBotDriven, rng } from "./util";

export interface Station {
  id: string;
  name: string;
  freq: number;
  kind: string;
  desc: string;
}

export const RADIO = radioJson as any;
export const STATIONS: Station[] = RADIO.stations;

export function stationAt(freq: number): Station | null {
  let best: Station | null = null;
  let bd = 0.35;
  for (const s of STATIONS) {
    const d = Math.abs(s.freq - freq);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

/** Signal clarity 0..1 at a frequency (for the client's noise mix). */
export function clarity(freq: number): number {
  let best = 0;
  for (const s of STATIONS) best = Math.max(best, 1 - Math.abs(s.freq - freq) / 0.35);
  return clamp(best, 0, 1);
}

function stationOnAir(w: World, s: Station) {
  if (s.kind === "tales") return w.hour >= 19 || w.phase === "night";
  if (s.kind === "numbers") return w.day >= 3;
  return true;
}

/** Produces the next broadcast line for a station. */
export function broadcastLine(w: World, s: Station): string | null {
  const R = rng(w);
  switch (s.kind) {
    case "dj": {
      const roll = R.next();
      if (w.notice > 40 && roll < 0.25) return R.pick(RADIO.borya.mention);
      if (roll < 0.55) return R.pick(RADIO.borya.jokes);
      return R.pick(RADIO.borya.letters);
    }
    case "news":
      if (w.director.raidWarn && R.chance(0.5)) return R.pick(RADIO.orderRaidHint);
      return R.pick(RADIO.order);
    case "tales": {
      const tales: string[][] = RADIO.tales;
      const i = (w.flags._taleIdx ?? 0) % tales.length;
      const j = w.flags._taleLine ?? 0;
      const line = tales[i][j];
      if (j + 1 >= tales[i].length) {
        w.flags._taleIdx = i + 1;
        w.flags._taleLine = 0;
      } else w.flags._taleLine = j + 1;
      return line;
    }
    case "weather": {
      const f = w.weather.forecast.map((k, i) => `${i === 0 ? "Завтра" : "Послезавтра"}: ${WEATHER[k]?.icon ?? ""} ${WEATHER[k]?.name ?? k} — ${WEATHER[k]?.outside ?? ""}`);
      return `Метеосводка. Сегодня: ${WEATHER[w.weather.today]?.name ?? w.weather.today}. ${f.join(". ")}.`;
    }
    case "numbers": {
      const seq = w.flags.ark_freq ? "семь… четыре… ноль… Ковчег ждёт… семь… четыре… ноль…" : "семь… четыре… ноль… Ковчег… семь… четыре… ноль…";
      return seq;
    }
    case "survivors":
      return R.pick(RADIO.survivors);
    case "music":
      return null;
  }
  return null;
}

// Radio listening: the tuned station matters for sanity; tales are best.
defAction({
  id: "listen_radio",
  type: "obj",
  kinds: ["radio"],
  prio: 44,
  bot: true,
  avail: ({ w, c, o }) => {
    for (const id in w.chars) {
      const x = w.chars[id];
      if (x.id !== c.id && x.task?.obj === o!.id && x.task.action === "listen_radio") return "📻 Послушать радио вместе";
    }
    if (!w.power || w.power.off.includes("radio")) return { label: "📻 Радио", reason: "Нет энергии" };
    return "📻 Сесть у радио, крутить ручку";
  },
  dur: () => 0,
  anim: "radio",
  start: ({ w, c }) => {
    w.radio.on = true;
    if (isBotDriven(w, c.id) && !Object.values(w.chars).some((x) => x.id !== c.id && x.task?.action === "listen_radio")) {
      // bots tune to something they like
      const fav = c.card.prof === "priest" || c.card.prof === "child" ? "tales" : c.card.prof === "radioman" ? "numbers" : rng(w).pick(["podzemka", "borya", "podzemka", "weather", "survivors"]);
      const st = STATIONS.find((s) => s.id === fav && stationOnAir(w, s)) ?? STATIONS[0];
      w.radio.freq = st.freq;
      w.radio.station = STATIONS.indexOf(st);
    }
  },
  tick: ({ w, c }, dt) => {
    const h = dt * hoursPerSec(w) * timeMult(w);
    const st = stationAt(w.radio.freq);
    let gain = st ? (st.kind === "tales" ? 12 : st.kind === "music" ? 9 : st.kind === "dj" ? 8 : 5) : 2;
    gain *= 1 + company(w, c) * 0.4;
    c.needs.sanity = clamp(c.needs.sanity + gain * sanityGainMult(c.needs.sanity) * h);
    if (st?.kind === "numbers" && c.card.goal === "radio") {
      const k = "_numday_" + c.id;
      if ((w.flags[k] ?? 0) < w.day) {
        w.flags[k] = w.day;
        w.flags["_numbers_" + c.id] = (w.flags["_numbers_" + c.id] ?? 0) + 1;
      }
    }
    if (st?.kind === "numbers" && !w.flags.numbers_heard && !w.timers.some((t) => t.data === "radio_numbers_again") && EVENT_BY_ID.radio_numbers_again) {
      w.timers.push({ at: w.day, kind: "event", data: "radio_numbers_again" });
    }
    if (isBotDriven(w, c.id) && (w.phaseT > (c.mind.until ?? 0) || c.needs.sanity >= 98)) return true;
  },
  stop: ({ w }) => {
    if (!Object.values(w.chars).some((x) => x.task?.action === "listen_radio")) w.radio.on = false;
  },
});

registerCmd("tune", (w, p, cmd) => {
  const c = p.char ? w.chars[p.char] : undefined;
  if (!c || c.task?.action !== "listen_radio") return "Сядьте у радио";
  const f = Number(cmd.f);
  if (!(f >= 70 && f <= 110)) return;
  w.radio.freq = Math.round(f * 10) / 10;
  const st = stationAt(w.radio.freq);
  w.radio.station = st ? STATIONS.indexOf(st) : -1;
  w.radio.by = p.id;
});

// Broadcast lines while someone listens (teletype subtitles for clients near the radio).
onTick("radio", "*", (w, dt) => {
  if (!w.radio.on || (w.phase !== "day" && w.phase !== "night")) return;
  w.flags._radioT = (w.flags._radioT ?? 0) + dt;
  if (w.flags._radioT < 9) return;
  w.flags._radioT = 0;
  const st = stationAt(w.radio.freq);
  if (!st || !stationOnAir(w, st)) return;
  const line = broadcastLine(w, st);
  if (!line) return;
  const radio = Object.values(w.objs).find((o) => o.kind === "radio");
  fx(w, { k: "radio", text: line, id: st.id, x: radio ? radio.x + 0.5 : undefined, lv: radio?.lv, who: st.name });
});
