import { BAL } from "../data/balance";
import { ITEMS } from "../data/items";
import type { Char, World } from "../types";
import { canClimb, feetY, walkable } from "../world/grid";

const HALF = 0.28; // half body width in cells

export function moveSpeed(c: Char) {
  let s = c.run ? BAL.runSpeed : BAL.walkSpeed;
  if (c.hands.some((h) => ITEMS[h.item]?.large) && c.card.plus !== "strongback") s *= BAL.carryLargeMult;
  if (c.needs.energy < 15) s *= 0.75;
  if (c.injury === "leg") s *= 0.7;
  return s;
}

/**
 * Deterministic character movement shared by server (authoritative) and client (prediction).
 * mx: -1..1 horizontal, my: -1 up / +1 down on ladders.
 * While climbing, c.lv is the ladder's level (the ladder spans feetY(lv-1)..feetY(lv)).
 */
export function stepMove(w: World, c: Char, mx: number, my: number, dt: number) {
  if (c.climbing) {
    const top = feetY(c.lv - 1);
    const bottom = feetY(c.lv);
    if (my !== 0) {
      c.y += Math.sign(my) * BAL.climbSpeed * dt;
      c.anim = "climb";
    }
    if (c.y >= bottom) {
      c.y = bottom;
      c.climbing = false;
    } else if (c.y <= top) {
      c.y = top;
      c.lv = c.lv - 1;
      c.climbing = false;
    }
    return;
  }

  // start climbing
  if (my !== 0) {
    const cx = Math.floor(c.x);
    const near = Math.abs(c.x - (cx + 0.5)) < 0.45;
    if (near && my > 0 && canClimb(w, cx, c.lv + 1)) {
      c.climbing = true;
      c.lv = c.lv + 1;
      c.x = cx + 0.5;
      c.y = feetY(c.lv - 1) + 0.001;
      return;
    }
    if (near && my < 0 && c.lv >= 0 && canClimb(w, cx, c.lv)) {
      c.climbing = true;
      c.x = cx + 0.5;
      c.y = feetY(c.lv) - 0.001;
      return;
    }
  }

  if (mx !== 0) {
    const sp = moveSpeed(c) * dt * Math.max(-1, Math.min(1, mx));
    let nx = c.x + sp;
    if (c.drunk > 0) nx += Math.sin(w.phaseT * 3 + c.x) * BAL.drunkWobble * dt * (c.drunk / 100);
    const edge = sp > 0 ? nx + HALF : nx - HALF;
    const cx = Math.floor(edge);
    if (!walkable(w, cx, c.lv)) {
      nx = sp > 0 ? cx - HALF - 0.001 : cx + 1 + HALF + 0.001;
    }
    c.x = nx;
    c.dir = mx > 0 ? 1 : -1;
    c.anim = c.run ? "run" : "walk";
  } else if (c.anim === "walk" || c.anim === "run" || c.anim === "climb") {
    c.anim = "idle";
  }
  c.y = feetY(c.lv);
}

/** Moves toward target x on the current level; returns true when arrived. */
export function moveToward(w: World, c: Char, tx: number, dt: number, tol = 0.15): boolean {
  const dx = tx - c.x;
  if (Math.abs(dx) <= tol) {
    if (c.anim === "walk" || c.anim === "run") c.anim = "idle";
    return true;
  }
  const step = moveSpeed(c) * dt;
  const mx = Math.abs(dx) < step ? dx / step : Math.sign(dx);
  const before = c.x;
  stepMove(w, c, mx, 0, dt);
  return Math.abs(c.x - before) < 1e-4 && Math.abs(dx) < 0.6;
}
