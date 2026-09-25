// Phones and tablets: no keyboard hints, a thumb stick on the left and a few big buttons on the right
// that change with what you are doing (the same keys the keyboard presses, so every screen keeps
// working exactly as on a computer). Pinch zooms the bunker, two fingers pan it.
import { net } from "./net";
import { isModalOpen } from "./ui/dom";

/** Force with ?mobile=1 / ?mobile=0 (remembered), otherwise a touch screen without a mouse. */
export function isMobile(): boolean {
  const q = new URLSearchParams(location.search).get("mobile");
  try {
    if (q === "1" || q === "0") localStorage.setItem("bunker.mobile", q);
    const saved = localStorage.getItem("bunker.mobile");
    if (saved === "1") return true;
    if (saved === "0") return false;
  } catch {
    if (q) return q === "1";
  }
  const coarse = matchMedia("(pointer: coarse)").matches && !matchMedia("(any-pointer: fine)").matches;
  return coarse || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

export const mobile = isMobile();
if (mobile) document.documentElement.classList.add("mobile");

let swallowUntil = 0;

/** The stick's direction, read together with the keyboard in input.ts. */
export const touchAxis = { mx: 0, my: 0, run: false, active: false };

function key(type: "keydown" | "keyup", code: string) {
  window.dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true }));
}

interface Btn {
  id: string;
  icon: string;
  label: string;
  code: string;
  big?: boolean;
}

interface GameLike {
  r: { renderer: { domElement: HTMLCanvasElement }; viewH: number; camX: number; camY: number; follow: boolean; updateCamera(): void };
  prompt: { list: unknown[] };
  exp?: { mode?: string; actions?: unknown[] } | null;
}

export function installTouch(game: GameLike) {
  if (!mobile) return;
  const root = document.getElementById("ui")!;
  // ---------------------------------------------------------------- stick
  const stick = document.createElement("div");
  stick.className = "touch-stick";
  const knob = document.createElement("div");
  knob.className = "touch-knob";
  stick.appendChild(knob);
  const pad = document.createElement("div");
  pad.className = "touch-pad";
  root.append(stick, pad);
  let R = 52;
  let stickId: number | null = null;
  let cx = 0,
    cy = 0;
  const setKnob = (dx: number, dy: number) => (knob.style.transform = `translate(${dx}px, ${dy}px)`);
  const stickMove = (x: number, y: number) => {
    let dx = x - cx,
      dy = y - cy;
    const d = Math.hypot(dx, dy);
    if (d > R) {
      dx *= R / d;
      dy *= R / d;
    }
    setKnob(dx, dy);
    const m = Math.min(1, d / R);
    const nx = dx / R,
      ny = dy / R;
    touchAxis.mx = Math.abs(nx) > 0.3 ? Math.sign(nx) : 0;
    // ladders need a clear up/down push, so a sideways walk does not climb by accident
    touchAxis.my = Math.abs(ny) > 0.55 && Math.abs(ny) > Math.abs(nx) * 0.8 ? Math.sign(ny) : 0;
    // in a building a gentle push sneaks (the «Shift» of the site); elsewhere a full push runs
    const site = document.body.classList.contains("mode-site");
    touchAxis.run = site ? m > 0.15 && m < 0.6 : m > 0.92;
    stick.classList.toggle("sneak", site && touchAxis.run);
  };
  const stickEnd = () => {
    stickId = null;
    touchAxis.mx = touchAxis.my = 0;
    touchAxis.run = touchAxis.active = false;
    setKnob(0, 0);
    stick.classList.remove("on", "sneak");
  };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stickEnd();
  });
  stick.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    stickId = e.pointerId;
    stick.setPointerCapture(e.pointerId);
    const r = stick.getBoundingClientRect();
    R = (r.width - knob.offsetWidth) / 2;
    cx = r.left + r.width / 2;
    cy = r.top + r.height / 2;
    touchAxis.active = true;
    stick.classList.add("on");
    stickMove(e.clientX, e.clientY);
  });
  stick.addEventListener("pointermove", (e) => e.pointerId === stickId && stickMove(e.clientX, e.clientY));
  stick.addEventListener("pointerup", stickEnd);
  stick.addEventListener("pointercancel", stickEnd);
  stick.addEventListener("lostpointercapture", stickEnd);
  window.addEventListener("blur", stickEnd);

  // ---------------------------------------------------------------- context buttons
  let padKey = "";
  const held = new Set<string>();
  const button = (b: Btn) => {
    const el = document.createElement("button");
    el.className = "touch-btn" + (b.big ? " big" : "");
    el.dataset.code = b.code;
    el.innerHTML = `<span>${b.icon}</span><small>${b.label}</small>`;
    const up = () => {
      if (!held.delete(b.code)) return;
      el.classList.remove("down");
      key("keyup", b.code);
    };
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      held.add(b.code);
      el.classList.add("down");
      navigator.vibrate?.(8);
      // the button may vanish under the finger (the mode changed): its click must not fall through
      swallowUntil = performance.now() + 600;
      key("keydown", b.code);
    });
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    return el;
  };

  const buttons = (): Btn[] => {
    const b = document.body.classList;
    const c = net.myChar() as any;
    const hands = !!c?.hands?.length;
    if (isModalOpen() || b.contains("mode-combat") || b.contains("mode-map") || b.contains("mode-table")) return [];
    if (b.contains("mode-build"))
      return [
        { id: "narrow", icon: "−", label: "Уже", code: "BracketLeft" },
        { id: "wide", icon: "+", label: "Шире", code: "BracketRight" },
        { id: "erase", icon: "🗑", label: "Снести", code: "Delete" },
        { id: "done", icon: "✕", label: "Готово", code: "Escape" },
      ];
    if (b.contains("mode-site"))
      return [
        // the flashlight, the backpack and the exit are on the site's own bar
        { id: "stone", icon: "🪨", label: "Камень", code: "KeyG" },
        { id: "act", icon: "✋", label: "Обыск", code: "KeyE", big: true },
      ];
    if (b.contains("mode-prologue"))
      return [...(hands ? [{ id: "throw", icon: "⤴", label: "Бросить", code: "KeyQ" }] : []), { id: "act", icon: "✋", label: "Взять", code: "KeyE", big: true }];
    const act = game.prompt.list.length > 0 || !!c?.task;
    return [
      ...(hands ? [{ id: "drop", icon: "⤓", label: "Положить", code: "KeyQ" }] : []),
      ...(act ? [{ id: "act", icon: "✋", label: c?.task && !game.prompt.list.length ? "Стоп" : "Действие", code: "KeyE", big: true }] : []),
    ];
  };

  const frame = () => {
    requestAnimationFrame(frame);
    const inGame = !!net.pub && net.pub.phase !== "lobby" && !!document.querySelector(".hud-top");
    const b = document.body.classList;
    const walk = inGame && net.pub!.phase !== "night" && net.pub!.phase !== "ending" && !isModalOpen() && !b.contains("mode-combat") && !b.contains("mode-map") && !b.contains("mode-table") && !b.contains("mode-build") && !!net.myChar();
    stick.classList.toggle("hidden", !walk);
    if (!walk && stickId !== null) stickEnd();
    const list = inGame && net.pub!.phase !== "night" && net.pub!.phase !== "ending" ? buttons() : [];
    const k = list.map((x) => x.id + x.label).join("|");
    if (k === padKey) return;
    padKey = k;
    // let go of anything held before the buttons change under the finger
    for (const code of held) key("keyup", code);
    held.clear();
    pad.replaceChildren(...list.map(button));
  };
  requestAnimationFrame(frame);

  // ---------------------------------------------------------------- pinch and pan
  const canvas = game.r.renderer.domElement;
  canvas.style.touchAction = "none";
  const pts = new Map<number, { x: number; y: number }>();
  let suppressClick = 0;
  let pinch: { d: number; viewH: number; mx: number; my: number; camX: number; camY: number } | null = null;
  const mid = () => {
    const [a, b] = [...pts.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  };
  // fingers on the scene (the canvas or the name tags over it), not on panels and buttons
  const onScene = (e: PointerEvent) =>
    e.pointerType === "touch" && !(e.target as Element | null)?.closest?.("button, input, textarea, select, .modal, .touch-stick, .touch-pad, .action-dock, .prologue-actions, .hud-me, .hud-top, .objectives, .tip-card, .game-dock, .game-toolbar, .chat, .council-panel, .exp-map, .exp-hud, .exp-dock, .exp-context, .combat-panel, .combat-intel");
  // every finger on the screen, wherever it is: two at once is a gesture, never a tap
  const fingers = new Set<number>();
  window.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType !== "touch") return;
      fingers.add(e.pointerId);
      if (fingers.size > 1) suppressClick = Infinity;
    },
    true,
  );
  const fingerUp = (e: PointerEvent) => {
    if (!fingers.delete(e.pointerId)) return;
    if (!fingers.size && suppressClick === Infinity) suppressClick = performance.now() + 400;
  };
  window.addEventListener("pointerup", fingerUp, true);
  window.addEventListener("pointercancel", fingerUp, true);
  window.addEventListener("pointerdown", (e) => {
    // the second finger of a pinch may land anywhere but the stick, the buttons and windows
    const second = e.pointerType === "touch" && pts.size === 1 && !(e.target as Element | null)?.closest?.(".touch-pad, .touch-stick, input, textarea, select, .modal");
    if (!onScene(e) && !second) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      const m = mid();
      pinch = { d: m.d, viewH: game.r.viewH, mx: m.mx, my: m.my, camX: game.r.camX, camY: game.r.camY };
      game.r.follow = false;
    }
  });
  window.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!pinch || pts.size !== 2 || document.body.classList.contains("mode-site")) return;
    const m = mid();
    game.r.viewH = Math.max(6, Math.min(40, (pinch.viewH * pinch.d) / Math.max(20, m.d)));
    const k = game.r.viewH / window.innerHeight;
    game.r.camX = pinch.camX - (m.mx - pinch.mx) * k;
    game.r.camY = pinch.camY + (m.my - pinch.my) * k;
    game.r.updateCamera();
  });
  const lift = (e: PointerEvent) => {
    pts.delete(e.pointerId);
    if (pts.size < 2 && pinch) {
      pinch = null;
    }
  };
  window.addEventListener("pointerup", lift);
  window.addEventListener("pointercancel", lift);
  // a pinch must not end as a tap on whatever was under a finger (a name tag, a room)
  window.addEventListener(
    "click",
    (e) => {
      const now = performance.now();
      if (now < suppressClick || pts.size > 1 || (now < swallowUntil && !(e.target as Element | null)?.closest?.(".touch-pad"))) {
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    },
    true,
  );
}

// ---------------------------------------------------------------- words
// Screens are written for the mouse and keyboard; on a phone the same text speaks of touches and
// loses the key names, so every window (present and future) reads right without a second copy.
const WORDS: [RegExp, string][] = [
  [/Щёлкните/g, "Коснитесь"],
  [/щёлкните/g, "коснитесь"],
  [/Щелчок/g, "Касание"],
  [/щелчок/g, "касание"],
  [/Щёлкнуть/g, "Коснуться"],
  [/щёлкнуть/g, "коснуться"],
  [/\s*\((?:Esc|E|I|Tab|B|Q|L|G|H|O|Enter|Пробел|держите E|[A-Z] — [^)]*)\)/g, ""],
  [/\s*·\s*(?:Esc|Enter|Пробел|[A-Z])$/g, ""],
];
function rewrite(node: Node) {
  if (node.nodeType === Node.TEXT_NODE) {
    const t = node.nodeValue ?? "";
    if (!/лкн|елч|\(|·/.test(t)) return;
    let s = t;
    for (const [re, to] of WORDS) s = s.replace(re, to);
    if (s !== t) node.nodeValue = s;
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;
  if (el.tagName === "SCRIPT" || el.tagName === "STYLE" || el.tagName === "CANVAS") return;
  for (const c of Array.from(el.childNodes)) rewrite(c);
}
if (mobile) {
  const start = () => {
    rewrite(document.body);
    new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === "characterData") rewrite(m.target);
        else m.addedNodes.forEach(rewrite);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  };
  if (document.body) start();
  else addEventListener("DOMContentLoaded", start);
}
