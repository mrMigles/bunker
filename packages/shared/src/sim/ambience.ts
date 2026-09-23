// Жизнь бункера: small things that happen on their own so the place never feels frozen —
// the ground shakes from distant blasts, rats dart along a corridor, lamps flicker, pipes clang,
// the wind howls in the vent shaft. Residents react out loud. Mostly harmless flavour,
// with a light touch on the simulation (dust, a little stress).
import type { Char, World } from "../types";
import { bark } from "./bots";
import { onTick } from "./tick";
import { clamp, fx, log, rng } from "./util";

const REACT: Record<string, string[]> = {
  quake: ["Опять бомбят?!", "Держитесь!", "Стены выдержат… да?", "С потолка сыплется…", "Господи, пронеси."],
  rats: ["Крысы!", "Кыш! Кыш отсюда!", "Надо ставить ловушки.", "Они за нашими запасами."],
  flicker: ["Свет мигает…", "Не пугай так, лампочка.", "Проводку бы проверить."],
  pipes: ["Трубы опять стонут.", "Это вода или кто-то стучит?", "Бум… бум… Жутко."],
  wind: ["Слышите ветер наверху?", "Воет, как живой.", "Хорошо, что мы здесь, а не там."],
};

function home(w: World): Char[] {
  return Object.values(w.chars).filter((c) => c.status === "ok");
}

function react(w: World, kind: string, near?: (c: Char) => boolean) {
  const R = rng(w);
  const who = home(w).filter((c) => !c.ctrl && !c.bark && (!near || near(c)));
  if (!who.length) return;
  const c = R.pick(who);
  c.bark = { text: R.pick(REACT[kind]), t: 4 };
  if (R.chance(0.4)) {
    const other = who.find((o) => o !== c && o.lv === c.lv && Math.abs(o.x - c.x) < 5);
    if (other) bark(w, other, "talk_reply");
  }
}

onTick("ambience", "day", (w, dt) => {
  w.flags._ambT = (w.flags._ambT ?? 45) - dt;
  if (w.flags._ambT > 0 || w.mods.combat?.active) return;
  const R = rng(w);
  w.flags._ambT = R.range(55, 120);
  const rooms = Object.values(w.rooms).filter((r) => r.state === "done" && r.type !== "shaft" && r.type !== "support");
  const kind = R.weighted(
    [
      ["quake", w.day >= 2 ? 2 : 1],
      ["rats", 3],
      ["flicker", w.power.battery < w.power.cap * 0.4 ? 3 : 1.5],
      ["pipes", 2.5],
      ["wind", w.weather.today === "storm" ? 4 : 1.5],
    ] as [string, number][],
    (k) => k[1],
  )![0];
  switch (kind) {
    case "quake": {
      // a distant strike or a collapsing building somewhere in the city
      fx(w, { k: "shake", data: 1.1 });
      fx(w, { k: "sound", id: "rumble" });
      fx(w, { k: "dust" });
      for (const r of rooms) r.dirt = clamp(r.dirt + 3);
      for (const c of home(w)) c.needs.sanity = clamp(c.needs.sanity - 1);
      log(w, R.pick(["💥 Далёкий взрыв. С потолка сыплется пыль.", "💥 Земля дрогнула. Где-то наверху рухнул дом.", "💥 Глухой удар. Лампы качаются."]), "info");
      react(w, "quake");
      break;
    }
    case "rats": {
      const r = R.pick(rooms);
      if (!r) break;
      fx(w, { k: "rats", x: r.x, lv: r.lv, data: { w: r.w, n: R.int(2, 4), dir: R.chance(0.5) ? 1 : -1 } });
      react(w, "rats", (c) => c.lv === r.lv && Math.abs(c.x - (r.x + r.w / 2)) < 6);
      break;
    }
    case "flicker":
      fx(w, { k: "flicker", data: 1.6 });
      react(w, "flicker");
      break;
    case "pipes":
      fx(w, { k: "sound", id: "clang", data: 0.35 });
      react(w, "pipes");
      break;
    case "wind":
      fx(w, { k: "sound", id: "wind" });
      react(w, "wind");
      break;
  }
});
