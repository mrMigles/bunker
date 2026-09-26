import { BAL } from "../data/balance";
import type { World } from "../types";
import { registerCmd } from "./commands";
import { REST_ACTIONS } from "./leisure";
import { onTick } from "./tick";
import { nightHooks } from "./time";
import { clamp, log, rng } from "./util";

export const WEATHER: Record<string, { name: string; icon: string; outside: string }> = {
  clear: { name: "Редкое солнце", icon: "🌤", outside: "можно выходить" },
  ash: { name: "Пепел", icon: "🌫", outside: "видимость хуже" },
  radrain: { name: "Радиоактивный дождь", icon: "☢🌧", outside: "радиация ×2" },
  storm: { name: "Пыльная буря", icon: "🌪", outside: "связь рвётся, выходить опасно" },
  cold: { name: "Ядерная зима", icon: "❄", outside: "холодно, нужна тёплая одежда" },
};

registerCmd("aquarium", (w, p, cmd) => {
  p.aquarium = !!cmd.v;
  const c = p.char ? w.chars[p.char] : undefined;
  if (c) {
    c.mind.plan = "idle";
    c.mind.idleT = 0.5;
  }
});

onTick("skip-time", "day", (w) => {
  // "Скоротать время": all living players resting → ×3. Aquarium watchers run at normal speed
  // (it is a "leave it on the second monitor" mode) but don't block the others from skipping.
  const active = Object.values(w.players).filter((p) => p.online && p.char && w.chars[p.char]?.status === "ok" && !p.aquarium);
  let resting = active.length > 0;
  let asleep = active.length > 0;
  for (const p of active) {
    const c = w.chars[p.char!];
    if (!c.task || !REST_ACTIONS.has(c.task.action)) resting = false;
    if (c.task?.action !== "sleep") asleep = false;
  }
  // a squad out on its own (no player online in it) is no reason to sit through the wait: only a
  // sortie someone is playing holds the clock
  const e = w.mods.expedition;
  const played = !!e?.active && (e.squad as string[]).some((id) => {
    const pl = w.players[w.chars[id]?.ctrl ?? ""];
    return !!pl?.online && !pl.aquarium;
  });
  if (w.mods.combat?.active || played || w.vote) resting = asleep = false;
  // everyone asleep: the hours fly; resting with a book or the radio: a bit faster
  w.speed = asleep ? BAL.sleepTimeMult : resting ? BAL.skipTimeMult : 1;
});

nightHooks.dayStart.push((w) => {
  const R = rng(w);
  // weather: consume forecast, roll a new day at the end
  w.weather.today = w.weather.forecast.shift() ?? "ash";
  const opts = w.day < 4 ? ["ash", "clear", "ash"] : ["ash", "clear", "radrain", "storm", "ash", "cold"];
  while (w.weather.forecast.length < 2) w.weather.forecast.push(R.pick(opts));
  // noticeability decays; quiet days tick down
  // …but a living colony is found sooner or later: smoke, light, noise grow with days lived and mouths (#29)
  const st = BAL.storyteller[w.settings.storyteller] ?? BAL.storyteller.classic;
  const people = Object.values(w.chars).filter((c) => c.status !== "dead" && c.status !== "away").length;
  const growth = (1.5 + people * 0.8 + Math.min(w.day, 20) * 0.25) * (st.noticeMult ?? 1);
  w.notice = clamp(w.notice - BAL.noticeDecayPerDay + growth);
  w.director.tension = clamp(w.director.tension - 12);
  if (w.director.quiet > 0) w.director.quiet--;
  if (w.weather.today !== "ash") log(w, `Погода: ${WEATHER[w.weather.today]?.icon} ${WEATHER[w.weather.today]?.name} — ${WEATHER[w.weather.today]?.outside}.`, "info");
  // trash & dirt accumulate day by day
  for (const id in w.objs) {
    const o = w.objs[id];
    if (o.kind === "trash_bin") o.st.fill = clamp((o.st.fill ?? 0) + 35);
  }
  for (const id in w.rooms) {
    const r = w.rooms[id];
    if (r.state !== "done") continue;
    let occ = 0;
    for (const cid in w.chars) if (w.chars[cid].status !== "dead" && w.chars[cid].lv === r.lv && w.chars[cid].x >= r.x && w.chars[cid].x < r.x + r.w) occ++;
    r.dirt = clamp(r.dirt + 6 + occ * 3 + (r.type === "kitchen" || r.type === "mess" ? 6 : 0));
  }
});
