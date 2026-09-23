// Мини-игры в бункере: a small hands-on window for the work my character is doing.
// Each mechanic reports pulses to the server (`mg`), which turn into task progress.
import { miniFor, type MiniDef } from "@bunker/shared";
import { audio } from "../audio/audio";
import { net } from "../net";
import { closeModal, h, isModalOpen, modal } from "./dom";

type Game = {
  draw(g: CanvasRenderingContext2D, dt: number): void;
  down?(x: number, y: number): void;
  move?(x: number, y: number, pressed: boolean): void;
  up?(): void;
  key?(code: string, down: boolean): void;
};

const W = 460,
  H = 250;

export class MinigameUI {
  private taskKey = "";
  private declined = "";
  private open = false;
  private raf = 0;
  private queue = 0;
  private lastSent = 0;
  private status!: HTMLElement;
  private progress!: HTMLElement;
  private done = 0;

  /** Called every frame: opens the window when my character starts work that has a minigame. */
  update() {
    const v = net.pub;
    const c = net.myChar();
    const task = c?.task;
    const key = task ? `${task.action}|${task.obj ?? ""}|${task.cell ?? ""}` : "";
    if (key !== this.taskKey) {
      const was = this.taskKey;
      this.taskKey = key;
      if (this.open && was) this.finish(!key);
      // a declined minigame comes back the next time the work is started
      if (!key) this.declined = "";
      if (key && v && c && key !== this.declined && !isModalOpen()) {
        const mg = miniFor(v as any, c as any);
        if (mg) this.show(mg);
      }
    }
    if (this.open && task && task.p >= 0 && this.progress) this.progress.style.width = Math.round(task.p * 100) + "%";
    // pulses leave at human speed (the server ignores faster ones)
    if (this.queue > 0 && performance.now() - this.lastSent > 150) {
      this.queue--;
      this.lastSent = performance.now();
      net.send({ k: "mg", q: 1 });
    }
  }

  private pulse(q = 1, text?: string) {
    if (q >= 0.99) this.queue++;
    else {
      this.lastSent = performance.now();
      net.send({ k: "mg", q });
    }
    this.done++;
    if (text) this.say(text);
  }

  private say(text: string) {
    if (this.status && this.status.textContent !== text) this.status.textContent = text;
  }

  private finish(completed: boolean) {
    cancelAnimationFrame(this.raf);
    if (!this.open) return;
    this.open = false;
    if (completed) {
      this.say("Готово ✓");
      audio.sfx("find", 0.5);
      setTimeout(() => !this.open && isModalOpen() && document.querySelector(".mini-modal") && closeModal(), 700);
    } else if (document.querySelector(".mini-modal")) closeModal();
  }

  private show(mg: MiniDef & { action: string }) {
    const canvas = h("canvas.mini-canvas", { width: W, height: H }) as HTMLCanvasElement;
    this.status = h("div.mini-status", null, mg.hint);
    this.progress = h("i");
    this.done = 0;
    const key = this.taskKey;
    const game = makeGame(mg, (q, text) => this.pulse(q, text), (t) => this.say(t));
    const body = h(
      "div.mini",
      null,
      canvas,
      h("div.bar.mini-progress", null, this.progress),
      this.status,
      h(
        "div.row",
        { style: { marginTop: "8px" } },
        h("span.dim", { style: { fontSize: "12px" } }, "Руками — быстрее и лучше. Закройте окно — персонаж доделает сам, медленнее."),
        h("div.grow"),
        h("button", { onclick: () => closeModal() }, "Пусть делает сам"),
      ),
    );
    this.open = true;
    net.send({ k: "mgOpen", on: true });
    modal(mg.title, body, {
      cls: "mini-modal",
      onClose: () => {
        cancelAnimationFrame(this.raf);
        if (this.open) {
          // closed by hand: the character keeps working at the automatic pace
          this.open = false;
          this.declined = key;
          net.send({ k: "mgOpen", on: false });
        }
        window.removeEventListener("keydown", onKey, true);
        window.removeEventListener("keyup", onKeyUp, true);
      },
    });
    const g = canvas.getContext("2d")!;
    const pos = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H] as const;
    };
    let pressed = false;
    canvas.addEventListener("pointerdown", (e) => {
      pressed = true;
      canvas.setPointerCapture(e.pointerId);
      game.down?.(...pos(e));
    });
    canvas.addEventListener("pointermove", (e) => game.move?.(...pos(e), pressed));
    canvas.addEventListener("pointerup", () => {
      pressed = false;
      game.up?.();
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape" || e.repeat) return;
      if (["Space", "KeyA", "KeyD", "KeyW", "KeyS", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.code)) {
        e.preventDefault();
        e.stopPropagation();
        game.key?.(e.code, true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => game.key?.(e.code, false);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKeyUp, true);
    let last = performance.now();
    const loop = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      g.clearRect(0, 0, W, H);
      g.fillStyle = "#12171b";
      g.fillRect(0, 0, W, H);
      game.draw(g, dt);
      if (this.open) this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
}

// ---------------------------------------------------------------- mechanics

function makeGame(mg: MiniDef, pulse: (q: number, text?: string) => void, say: (t: string) => void): Game {
  switch (mg.kind) {
    case "pump":
      return pumpGame(pulse);
    case "pedal":
      return pedalGame(pulse, say);
    case "scrub":
      return scrubGame(mg, pulse);
    case "turn":
      return turnGame(mg, pulse, say);
    case "timing":
      return timingGame(mg, pulse, say);
    case "pour":
      return pourGame(pulse, say);
    case "ph":
      return phGame(pulse, say);
    default:
      return clicksGame(mg, pulse);
  }
}

/** Hand pump: drag the lever down and up; each full stroke pours water. */
function pumpGame(pulse: (q: number, t?: string) => void): Game {
  let p = 0; // 0 = handle up, 1 = down
  let phase: "down" | "up" = "down";
  let strokeT = 0;
  let strokes = 0;
  const drops: { x: number; y: number; v: number }[] = [];
  const keys = { up: false, down: false };
  return {
    down: (_x, y) => (p = Math.max(0, Math.min(1, (y - 40) / 150))),
    move: (_x, y, pr) => pr && (p = Math.max(0, Math.min(1, (y - 40) / 150))),
    key: (c, d) => {
      if (c === "KeyW" || c === "ArrowUp") keys.up = d;
      if (c === "KeyS" || c === "ArrowDown") keys.down = d;
    },
    draw(g, dt) {
      if (keys.down) p = Math.min(1, p + dt * 2.2);
      if (keys.up) p = Math.max(0, p - dt * 2.2);
      strokeT += dt;
      if (phase === "down" && p > 0.9) phase = "up";
      else if (phase === "up" && p < 0.12) {
        phase = "down";
        strokes++;
        const q = strokeT < 0.35 ? 0.7 : 1;
        strokeT = 0;
        pulse(q, q < 1 ? "Помедленнее — рвёте рукоять" : `Качок ${strokes}!`);
        for (let i = 0; i < 6; i++) drops.push({ x: 300 + Math.random() * 8, y: 118, v: 60 + Math.random() * 40 });
        audio.sfx("dig", 0.6);
      }
      // pump body
      g.fillStyle = "#5d6a70";
      g.fillRect(250, 90, 40, 140);
      g.fillStyle = "#3b4449";
      g.fillRect(286, 108, 34, 12);
      // lever
      const ang = -0.5 + p * 1.0;
      g.save();
      g.translate(270, 95);
      g.rotate(ang);
      g.fillStyle = "#b8452f";
      g.fillRect(-150, -6, 150, 12);
      g.fillStyle = "#d9c9a0";
      g.fillRect(-165, -9, 22, 18);
      g.restore();
      // bucket
      const fill = Math.min(1, strokes / 6);
      g.fillStyle = "#6f7b80";
      g.fillRect(285, 180, 50, 50);
      g.fillStyle = "#6b5b3a";
      g.fillRect(288, 227 - 44 * fill, 44, 44 * fill);
      for (const d of drops) {
        d.y += d.v * dt;
        g.fillStyle = "#7d6a44";
        g.fillRect(d.x, d.y, 3, 5);
      }
      while (drops.length && drops[0].y > 230) drops.shift();
      g.fillStyle = "#cfd6cf";
      g.font = "13px sans-serif";
      g.fillText(phase === "down" ? "↓ Вниз" : "↑ Вверх", 40, 30);
    },
  };
}

/** Bike generator: alternate A / D at a steady rhythm. */
function pedalGame(pulse: (q: number, t?: string) => void, say: (t: string) => void): Game {
  let lastKey = "";
  let lastT = 0;
  const hits: { t: number; q: number }[] = [];
  let crank = 0;
  let sendT = 0;
  let q = 0;
  const press = (side: string) => {
    const now = performance.now() / 1000;
    if (side === lastKey) {
      say("По очереди: A, D, A, D…");
      return;
    }
    const gap = now - lastT;
    lastKey = side;
    lastT = now;
    const good = gap >= 0.22 && gap <= 0.6 ? 1 : gap < 0.22 ? 0.5 : 0.4;
    hits.push({ t: now, q: good });
    crank += Math.PI / 2;
  };
  return {
    key: (c, d) => {
      if (!d) return;
      if (c === "KeyA" || c === "ArrowLeft") press("L");
      if (c === "KeyD" || c === "ArrowRight") press("R");
    },
    down: (x) => press(x < W / 2 ? "L" : "R"),
    draw(g, dt) {
      const now = performance.now() / 1000;
      while (hits.length && now - hits[0].t > 1.6) hits.shift();
      const target = hits.length ? (hits.reduce((a, b) => a + b.q, 0) / hits.length) * Math.min(1, hits.length / 4) : 0;
      q += (target - q) * Math.min(1, dt * 4);
      sendT += dt;
      if (sendT > 0.5) {
        sendT = 0;
        pulse(Math.max(0.01, q));
        say(q > 0.8 ? "Отличный ритм — лампы горят ярко!" : q > 0.4 ? "Ровнее, ровнее…" : "A и D по очереди, в ритм");
      }
      // crank wheel
      g.save();
      g.translate(150, 140);
      g.rotate(crank * 0.5);
      g.strokeStyle = "#9aa4a8";
      g.lineWidth = 6;
      g.beginPath();
      g.arc(0, 0, 60, 0, Math.PI * 2);
      g.stroke();
      for (let i = 0; i < 6; i++) {
        g.rotate(Math.PI / 3);
        g.fillStyle = "#6f7b80";
        g.fillRect(0, -2, 60, 4);
      }
      g.restore();
      // output gauge
      g.fillStyle = "#2a3238";
      g.fillRect(270, 60, 160, 22);
      g.fillStyle = q > 0.8 ? "#9fd67a" : q > 0.4 ? "#e8c14a" : "#d9674a";
      g.fillRect(272, 62, 156 * Math.min(1, q), 18);
      g.fillStyle = "#e6e2d4";
      g.font = "13px sans-serif";
      g.fillText(`Ток: ×${(0.6 + q * 1.2).toFixed(1)}`, 272, 105);
      // bulb brightness
      g.fillStyle = `rgba(255,220,120,${0.15 + q * 0.85})`;
      g.beginPath();
      g.arc(350, 170, 26, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#cfd6cf";
      g.fillText("[A]     [D]", 110, 235);
    },
  };
}

/** Scrubbing: wipe dirt patches off with the mouse held down. */
function scrubGame(mg: MiniDef, pulse: (q: number, t?: string) => void): Game {
  const cols = 24,
    rows = 12;
  const cw = 360 / cols,
    ch = 180 / rows;
  const ox = 50,
    oy = 35;
  const dirt: number[] = [];
  const dish = mg.skin === "dish";
  for (let i = 0; i < cols * rows; i++) {
    const x = (i % cols) - cols / 2 + 0.5,
      y = Math.floor(i / cols) - rows / 2 + 0.5;
    const inside = !dish || (x * x) / 144 + (y * y) / 36 < 1;
    dirt.push(inside ? 0.6 + Math.random() * 0.4 : 0);
  }
  const total = dirt.reduce((a, b) => a + b, 0);
  let reported = 0;
  const wipe = (x: number, y: number) => {
    for (let i = 0; i < dirt.length; i++) {
      const cx = ox + (i % cols) * cw + cw / 2,
        cy = oy + Math.floor(i / cols) * ch + ch / 2;
      if (Math.hypot(cx - x, cy - y) < 24 && dirt[i] > 0) dirt[i] = Math.max(0, dirt[i] - 0.12);
    }
    const clean = 1 - dirt.reduce((a, b) => a + b, 0) / total;
    const steps = Math.floor(clean * mg.pulses * 1.02);
    while (reported < steps) {
      reported++;
      pulse(1, reported >= mg.pulses ? "Чисто!" : `Чисто на ${Math.round(clean * 100)}%`);
    }
  };
  let mx = -99,
    my = -99;
  return {
    down: (x, y) => wipe(x, y),
    move: (x, y, pr) => {
      mx = x;
      my = y;
      if (pr) wipe(x, y);
    },
    draw(g) {
      // the surface
      if (dish) {
        g.fillStyle = "#e9e4d6";
        g.beginPath();
        g.ellipse(ox + 180, oy + 90, 180, 90, 0, 0, Math.PI * 2);
        g.fill();
      } else {
        g.fillStyle = mg.skin === "filter" ? "#c9c2a4" : "#7c705e";
        g.fillRect(ox, oy, 360, 180);
        if (mg.skin === "filter") {
          g.strokeStyle = "#a79f82";
          for (let x = ox; x < ox + 360; x += 10) {
            g.beginPath();
            g.moveTo(x, oy);
            g.lineTo(x, oy + 180);
            g.stroke();
          }
        }
      }
      for (let i = 0; i < dirt.length; i++) {
        if (dirt[i] <= 0) continue;
        g.fillStyle = `rgba(52,42,30,${dirt[i]})`;
        g.fillRect(ox + (i % cols) * cw, oy + Math.floor(i / cols) * ch, cw + 0.5, ch + 0.5);
      }
      // sponge
      g.fillStyle = "#e8c14a";
      g.fillRect(mx - 14, my - 10, 28, 20);
    },
  };
}

/** Turning: valve, light bulb or ladle — circle the mouse (clockwise) around the centre. */
function turnGame(mg: MiniDef, pulse: (q: number, t?: string) => void, say: (t: string) => void): Game {
  const cx = 230,
    cy = 125;
  let prev: number | null = null;
  let acc = 0;
  let turns = 0;
  let spin = 0;
  let lastT = performance.now();
  return {
    down: (x, y) => (prev = Math.atan2(y - cy, x - cx)),
    up: () => (prev = null),
    move(x, y, pressed) {
      if (!pressed) return;
      const a = Math.atan2(y - cy, x - cx);
      if (prev === null) {
        prev = a;
        return;
      }
      let d = a - prev;
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      prev = a;
      const now = performance.now();
      const speed = Math.abs(d) / Math.max(0.001, (now - lastT) / 1000);
      lastT = now;
      if (mg.skin === "ladle" && speed > 14) {
        say("Расплескали! Помедленнее.");
        return;
      }
      if (d < 0 && mg.skin !== "ladle") {
        say("По часовой стрелке!");
        return;
      }
      acc += Math.abs(d);
      spin += d;
      if (acc >= Math.PI * 2) {
        acc -= Math.PI * 2;
        turns++;
        pulse(1, turns >= mg.pulses ? (mg.skin === "bulb" ? "Горит!" : "Готово!") : `Оборот ${turns} из ${mg.pulses}`);
        audio.sfx("click", 0.6);
      }
    },
    draw(g) {
      const k = Math.min(1, turns / mg.pulses);
      g.save();
      g.translate(cx, cy);
      if (mg.skin === "bulb") {
        // socket from above, the bulb screws upward and lights at the end
        g.fillStyle = "#555";
        g.fillRect(-30, -100, 60, 30);
        g.translate(0, 20 - k * 40);
        g.rotate(spin);
        g.fillStyle = k >= 1 ? "#ffe890" : "#e6e6dc";
        g.beginPath();
        g.arc(0, 20, 34, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#9aa0a0";
        g.fillRect(-16, -30, 32, 22);
        g.strokeStyle = "#777";
        g.beginPath();
        g.moveTo(-16, -22);
        g.lineTo(16, -26);
        g.stroke();
      } else if (mg.skin === "ladle") {
        g.fillStyle = "#3d4247";
        g.beginPath();
        g.ellipse(0, 20, 110, 60, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#a8743c";
        g.beginPath();
        g.ellipse(0, 20, 96, 50, 0, 0, Math.PI * 2);
        g.fill();
        g.rotate(spin);
        g.fillStyle = "#c9ccd0";
        g.fillRect(40, -6, 60, 10);
        g.beginPath();
        g.arc(40, 0, 12, 0, Math.PI * 2);
        g.fill();
      } else {
        g.rotate(spin);
        g.strokeStyle = "#c0392b";
        g.lineWidth = 12;
        g.beginPath();
        g.arc(0, 0, 70, 0, Math.PI * 2);
        g.stroke();
        g.fillStyle = "#a33025";
        for (let i = 0; i < 4; i++) {
          g.rotate(Math.PI / 2);
          g.fillRect(0, -5, 70, 10);
        }
        g.fillStyle = "#7a2219";
        g.beginPath();
        g.arc(0, 0, 14, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
      g.fillStyle = "#cfd6cf";
      g.font = "13px sans-serif";
      g.fillText(mg.skin === "ladle" ? "Мешайте по кругу" : "↻ По часовой стрелке", 16, 24);
    },
  };
}

/** Timing: a marker runs along the scale; hit SPACE / click in the green zone. */
function timingGame(mg: MiniDef, pulse: (q: number, t?: string) => void, say: (t: string) => void): Game {
  let m = 0,
    dir = 1,
    speed = 0.9;
  let zone = 0.4 + Math.random() * 0.3;
  const zw = 0.16;
  let hits = 0;
  let shake = 0;
  let flash = 0;
  const hit = () => {
    const d = Math.abs(m - (zone + zw / 2));
    if (d <= zw / 2) {
      hits++;
      const q = d < zw / 6 ? 1 : 0.85;
      pulse(q, hits >= mg.pulses ? "Готово!" : q === 1 ? "Точно в цель!" : "Есть!");
      zone = 0.1 + Math.random() * 0.74;
      speed = Math.min(1.8, speed + 0.08);
      flash = 1;
      audio.sfx(mg.skin === "pick" ? "dig" : "hit", 0.6);
    } else {
      shake = 1;
      say("Мимо! Ловите зелёную зону.");
      audio.sfx("click", 0.4);
    }
  };
  return {
    down: () => hit(),
    key: (c, d) => d && c === "Space" && hit(),
    draw(g, dt) {
      m += dir * speed * dt;
      if (m > 1) {
        m = 1;
        dir = -1;
      }
      if (m < 0) {
        m = 0;
        dir = 1;
      }
      shake = Math.max(0, shake - dt * 4);
      flash = Math.max(0, flash - dt * 3);
      const sx = Math.sin(performance.now() / 20) * shake * 6;
      const bx = 40 + sx,
        by = 150,
        bw = 380;
      g.fillStyle = "#2a3238";
      g.fillRect(bx, by, bw, 26);
      g.fillStyle = "#58a04a";
      g.fillRect(bx + zone * bw, by, zw * bw, 26);
      g.fillStyle = "#9fd67a";
      g.fillRect(bx + (zone + zw / 3) * bw, by, (zw / 3) * bw, 26);
      g.fillStyle = "#f3ecd9";
      g.fillRect(bx + m * bw - 3, by - 8, 6, 42);
      // the thing being worked on
      const icon = mg.skin === "hammer" ? "🔨" : mg.skin === "pick" ? "⛏" : "🔧";
      g.font = "46px serif";
      g.fillText(icon, 200, 110 - flash * 14);
      g.font = "14px sans-serif";
      g.fillStyle = "#cfd6cf";
      g.fillText(`${mg.skin === "hammer" ? "Гвозди" : mg.skin === "pick" ? "Удары" : "Болты"}: ${hits} / ${mg.pulses}   ·   ПРОБЕЛ или клик`, 40, 220);
      for (let i = 0; i < mg.pulses; i++) {
        g.fillStyle = i < hits ? "#9fd67a" : "#4a555c";
        g.fillRect(40 + i * 22, 30, 16, 16);
      }
    },
  };
}

/** Watering: hold to pour, release on the line. */
function pourGame(pulse: (q: number, t?: string) => void, say: (t: string) => void): Game {
  let level = 0;
  let pouring = false;
  let plant = 0;
  const band = [0.66, 0.82];
  const release = () => {
    if (!pouring) return;
    pouring = false;
    const q = level >= band[0] && level <= band[1] ? 1 : level > 0.95 ? 0.3 : level > band[1] ? 0.6 : 0.4;
    plant++;
    pulse(q, q === 1 ? "В самый раз!" : level > band[1] ? "Перелили — корни загниют" : "Маловато воды");
    level = 0;
  };
  return {
    down: () => (pouring = true),
    up: release,
    key: (c, d) => {
      if (c !== "Space") return;
      if (d) pouring = true;
      else release();
    },
    draw(g, dt) {
      if (pouring) level = Math.min(1, level + dt * 0.45);
      if (level >= 1 && pouring) say("Льётся через край!");
      // pot
      g.fillStyle = "#8a5a3a";
      g.fillRect(180, 60, 100, 160);
      g.fillStyle = "#3a6ea0";
      g.fillRect(184, 216 - 152 * level, 92, 152 * level);
      g.fillStyle = "#9fd67a";
      g.fillRect(170, 216 - 152 * band[1], 120, 152 * (band[1] - band[0]));
      g.globalAlpha = 0.35;
      g.fillRect(184, 216 - 152 * band[1], 92, 152 * (band[1] - band[0]));
      g.globalAlpha = 1;
      if (pouring) {
        g.fillStyle = "#6fb0e0";
        g.fillRect(226, 20, 8, 216 - 152 * level - 20);
      }
      g.fillStyle = "#cfd6cf";
      g.font = "13px sans-serif";
      g.fillText(`Грядка ${Math.min(plant + 1, 3)} из 3 · держите мышь или ПРОБЕЛ`, 16, 24);
    },
  };
}

/** Nutrient solution: steer the pH needle into the band and hold it there. */
function phGame(pulse: (q: number, t?: string) => void, say: (t: string) => void): Game {
  let ph = 7.6,
    vel = 0;
  let target = 6.0;
  let hold = 0;
  let good = 0;
  const btns = [
    { x: 40, label: "+ Кислота  [A]", d: -1 },
    { x: 280, label: "+ Щёлочь  [D]", d: 1 },
  ];
  const add = (d: number) => (vel += d * 0.9);
  return {
    down: (x, y) => {
      if (y > 180) for (const b of btns) if (x >= b.x && x <= b.x + 140) add(b.d);
    },
    key: (c, d) => {
      if (!d) return;
      if (c === "KeyA" || c === "ArrowLeft") add(-1);
      if (c === "KeyD" || c === "ArrowRight") add(1);
    },
    draw(g, dt) {
      ph += vel * dt;
      vel *= Math.exp(-dt * 2.2);
      ph += Math.sin(performance.now() / 700) * 0.15 * dt; // the mix drifts
      ph = Math.max(4, Math.min(9, ph));
      const inBand = Math.abs(ph - target) < 0.3;
      hold = inBand ? hold + dt : 0;
      if (hold > 1.2) {
        hold = 0;
        good++;
        pulse(1, good >= 3 ? "Раствор готов!" : "Отлично! Следующая порция…");
        target = 5.6 + Math.random() * 1.2;
      }
      const x = (v: number) => 40 + ((v - 4) / 5) * 380;
      g.fillStyle = "#2a3238";
      g.fillRect(40, 90, 380, 30);
      g.fillStyle = "#58a04a";
      g.fillRect(x(target - 0.3), 90, x(target + 0.3) - x(target - 0.3), 30);
      g.fillStyle = "#f3ecd9";
      g.fillRect(x(ph) - 3, 80, 6, 50);
      g.fillStyle = "#cfd6cf";
      g.font = "13px sans-serif";
      g.fillText(`pH ${ph.toFixed(1)} → нужно ${target.toFixed(1)}   ·   держите в зелёном ${inBand ? "✓" : ""}`, 40, 60);
      for (const b of btns) {
        g.fillStyle = "#3b4a52";
        g.fillRect(b.x, 190, 140, 36);
        g.fillStyle = "#eae6d8";
        g.fillText(b.label, b.x + 16, 213);
      }
      say(inBand ? "Держите…" : "Добавьте реактив");
    },
  };
}

/** Clicking targets: ripe fruit, bugs, flowers, dry leaves. */
function clicksGame(mg: MiniDef, pulse: (q: number, t?: string) => void): Game {
  const targets: { x: number; y: number; life: number; vx: number; vy: number }[] = [];
  let spawnT = 0;
  let got = 0;
  const color = mg.skin === "bug" ? "#2a2a22" : mg.skin === "flower" ? "#f0d040" : mg.skin === "leaf" ? "#9a6a2a" : "#d9502a";
  return {
    down(x, y) {
      const i = targets.findIndex((t) => Math.hypot(t.x - x, t.y - y) < 22);
      if (i < 0) return;
      targets.splice(i, 1);
      got++;
      pulse(1, got >= mg.pulses ? "Готово!" : `${got} / ${mg.pulses}`);
      audio.sfx("click", 0.5);
    },
    draw(g, dt) {
      // the bush
      g.fillStyle = "#3f6a34";
      for (let i = 0; i < 9; i++) {
        g.beginPath();
        g.arc(90 + i * 36, 140 + Math.sin(i * 1.7) * 30, 44, 0, Math.PI * 2);
        g.fill();
      }
      spawnT -= dt;
      if (spawnT <= 0 && targets.length < 3) {
        spawnT = 0.7;
        targets.push({ x: 70 + Math.random() * 320, y: 60 + Math.random() * 150, life: 3.2, vx: mg.skin === "bug" ? (Math.random() - 0.5) * 60 : 0, vy: mg.skin === "bug" ? (Math.random() - 0.5) * 40 : 0 });
      }
      for (const t of targets) {
        t.life -= dt;
        t.x += t.vx * dt;
        t.y += t.vy * dt;
        g.globalAlpha = Math.min(1, t.life);
        g.fillStyle = color;
        g.beginPath();
        if (mg.skin === "bug") g.ellipse(t.x, t.y, 12, 8, Math.atan2(t.vy, t.vx), 0, Math.PI * 2);
        else g.arc(t.x, t.y, 14, 0, Math.PI * 2);
        g.fill();
        g.globalAlpha = 1;
      }
      for (let i = targets.length - 1; i >= 0; i--) if (targets[i].life <= 0) targets.splice(i, 1);
      g.fillStyle = "#cfd6cf";
      g.font = "13px sans-serif";
      g.fillText(`${got} / ${mg.pulses} — кликайте`, 16, 24);
    },
  };
}
