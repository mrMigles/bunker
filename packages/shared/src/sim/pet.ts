import type { World } from "../types";
import { walkable } from "../world/grid";
import { objsOfKind, roomAt } from "../world/rooms";
import { defAction, emitWork } from "./actions";
import { extraChoreHooks } from "./chores";
import { takeFood, foodUnits } from "./items";
import { onTick } from "./tick";
import { timeMult } from "./time";
import { clamp, hoursPerSec, rng } from "./util";

function nearPet(w: World, c: { x: number; lv: number }) {
  return !!w.pet && w.pet.lv === c.lv && Math.abs(w.pet.x - c.x) < 1.2;
}

defAction({
  id: "pet_pet",
  type: "self",
  prio: 30,
  avail: ({ w, c }) => (nearPet(w, c) ? `🐾 Погладить: ${w.pet!.name}` : null),
  dur: () => 5,
  anim: "pet",
  done: ({ w, c }) => {
    c.needs.sanity = clamp(c.needs.sanity + 6);
    w.pet!.mood = clamp(w.pet!.mood + 10);
    emitWork(w, c, w.pet!.kind === "roach" ? "Валерий шевелит усами ❤" : "❤", "#ff9ab0");
  },
});

defAction({
  id: "feed_pet",
  type: "self",
  prio: 31,
  avail: ({ w, c }) => {
    if (!nearPet(w, c) || w.pet!.fed > 70) return null;
    if (foodUnits(w) < 0.3) return { label: "🦴 Покормить питомца", reason: "Нет еды" };
    return `🦴 Покормить: ${w.pet!.name}`;
  },
  dur: () => 4,
  anim: "pet",
  chore: "feed_pet",
  done: ({ w, c }) => {
    takeFood(w, 0.3, false);
    w.pet!.fed = 100;
    w.pet!.mood = clamp(w.pet!.mood + 15);
    c.needs.sanity = clamp(c.needs.sanity + 3);
  },
});

defAction({
  id: "play_ball",
  type: "self",
  prio: 32,
  avail: ({ w, c }) => (nearPet(w, c) && w.pet!.kind === "dog" ? "⚽ Поиграть с мячиком" : null),
  dur: () => 10,
  anim: "work",
  done: ({ w, c }) => {
    c.needs.sanity = clamp(c.needs.sanity + 9);
    c.needs.energy = clamp(c.needs.energy - 3);
    w.pet!.mood = 100;
  },
});

extraChoreHooks.push((w, add) => {
  if (!w.pet || w.pet.fed > 35) return;
  // feeding happens near the pet: target the nearest object to it
  const near = Object.values(w.objs).filter((o) => o.lv === w.pet!.lv).sort((a, b) => Math.abs(a.x - w.pet!.x) - Math.abs(b.x - w.pet!.x))[0];
  if (near) add({ kind: "feed_pet", obj: near.id, urgency: 0.5 });
});

onTick("pet", "day", (w, dt) => {
  const p = w.pet;
  if (!p) return;
  const hours = dt * hoursPerSec(w) * timeMult(w);
  p.fed = clamp(p.fed - 30 * (hours / 24) * 24 / 16);
  p.mood = clamp(p.mood - (p.fed < 20 ? 8 : 2) * hours);
  const R = rng(w);
  // pick a new target sometimes: a person, the generator (warm!), or a random spot
  if (p.tx === undefined || Math.abs(p.tx - p.x) < 0.1) {
    if (R.chance(0.02)) {
      const roll = R.next();
      const people = Object.values(w.chars).filter((c) => c.status === "ok" && !c.climbing);
      if (roll < 0.45 && people.length) {
        const c = R.pick(people);
        p.tx = c.x + (R.chance(0.5) ? 0.6 : -0.6);
        p.tlv = c.lv;
      } else if (roll < 0.7) {
        const gen = objsOfKind(w, "bike_gen")[0];
        if (gen) {
          p.tx = gen.x + 0.2;
          p.tlv = gen.lv;
        }
      } else {
        const r = roomAt(w, Math.floor(p.x), p.lv);
        if (r) {
          p.tx = r.x + 0.3 + R.next() * (r.w - 0.6);
          p.tlv = r.lv;
        }
      }
      p.anim = "walk";
    } else p.anim = p.fed < 20 ? "whine" : R.chance(0.001) ? "sleep" : p.anim === "walk" ? "idle" : p.anim;
  }
  // pets teleport between levels via ladders (they are small and quick)
  if (p.tlv !== undefined && p.tlv !== p.lv) {
    p.lv = p.tlv;
  }
  if (p.tx !== undefined) {
    const dx = p.tx - p.x;
    const step = 2.2 * dt;
    const nx = Math.abs(dx) < step ? p.tx : p.x + Math.sign(dx) * step;
    if (walkable(w, Math.floor(nx), p.lv)) p.x = nx;
    else p.tx = p.x;
  }
  // a happy pet nearby lifts spirits
  if (p.mood > 50) {
    for (const id in w.chars) {
      const c = w.chars[id];
      if (c.status === "ok" && c.lv === p.lv && Math.abs(c.x - p.x) < 2.5) c.needs.sanity = clamp(c.needs.sanity + 1.2 * hours);
    }
  }
});
