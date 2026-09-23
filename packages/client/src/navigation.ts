import { findPath, prologueWorld, siteWorld, unnode, type World } from "@bunker/shared";
import { net } from "./net";
import { toast } from "./ui/dom";

/** Mouse routes produce the same validated movement inputs as the keyboard. */
export class MouseNavigation {
  target: { x: number; lv: number; phase: string; site: string } | null = null;
  private route: number[] = [];
  private arrival?: () => void;
  private climb = 0;
  private lastX = 0;
  private lastY = 0;
  private stuck = 0;
  private queued: { x: number; lv: number; arrival?: () => void } | null = null;

  geometry(): World | null {
    const v = net.pub;
    if (!v) return null;
    if (v.phase === "prologue") return v.mods.prologue ? prologueWorld(v.mods.prologue) : null;
    if (net.myChar()?.status === "away") return v.mods.expedition?.site ? siteWorld(v.mods.expedition.site) : null;
    return v as unknown as World;
  }

  go(x: number, lv: number, arrival?: () => void) {
    const w = this.geometry(), c = net.myChar(), p = net.pred ?? c;
    if (!w || !c || !p) return;
    if (p.climbing) {
      this.cancel(); this.queued = { x, lv, arrival }; return;
    }
    const path = findPath(w, p.x, p.lv, x, lv);
    if (!path) { this.cancel(); toast("Нет прохода. Выберите открытый пол или лестницу."); return; }
    this.target = { x, lv, phase: net.pub!.phase, site: String(net.pub!.mods.expedition?.site?.id ?? "") };
    this.route = path;
    this.arrival = arrival;
    this.stuck = 0;
    this.lastX = p.x;
    this.lastY = p.y;
    if (c.task) net.send({ k: "stop" });
  }

  cancel() { this.target = null; this.route = []; this.arrival = undefined; this.queued = null; }

  input(manual: { mx: number; my: number; run: boolean }, dt: number) {
    if (manual.mx || manual.my) { this.cancel(); return manual; }
    const w = this.geometry(), c = net.myChar(), p = net.pred ?? c;
    // Cancelled routes still finish the current ladder segment after a menu closes.
    if (!this.target && p?.climbing) return { mx: 0, my: this.climb || 1, run: false };
    if (this.queued && p && !p.climbing) { const q = this.queued; this.queued = null; this.go(q.x, q.lv, q.arrival); }
    const target = this.target;
    if (!target || !w || !p || !c) return manual;
    if (net.pub!.phase !== target.phase || String(net.pub!.mods.expedition?.site?.id ?? "") !== target.site || net.pub!.mods.combat?.active) {
      this.cancel(); return manual;
    }
    this.stuck = Math.abs(p.x - this.lastX) + Math.abs(p.y - this.lastY) < 0.005 ? this.stuck + dt : 0;
    this.lastX = p.x; this.lastY = p.y;
    if (this.stuck > 2.5) { this.cancel(); toast("Проход занят. Попробуйте другой путь."); return manual; }
    const run = net.pub!.phase === "prologue";
    if (p.climbing) return { mx: 0, my: this.climb, run };
    while (this.route.length) {
      const [nx, nl] = unnode(w, this.route[0]);
      const dx = nx + 0.5 - p.x;
      if (nl === p.lv && Math.abs(dx) < 0.26) { this.route.shift(); continue; }
      if (nl !== p.lv && Math.abs(dx) < 0.36) {
        this.climb = Math.sign(nl - p.lv);
        return { mx: 0, my: this.climb, run };
      }
      return { mx: Math.sign(dx), my: 0, run };
    }
    const dx = target.x - p.x;
    if (p.lv === target.lv && Math.abs(dx) < 0.34) {
      // Wait for the authoritative position before sending the interaction.
      if (c.lv !== target.lv || c.climbing || Math.abs(c.x - target.x) > 0.8) return manual;
      const done = this.arrival;
      this.cancel();
      done?.();
      return manual;
    }
    return { mx: Math.sign(dx), my: 0, run };
  }
}
