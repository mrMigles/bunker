// Keyboard/mouse state. Game code subscribes to key presses and reads held keys.

export const held = new Set<string>();
/** keys released before the input loop saw them: a quick tap still counts for one sample */
const tapped = new Set<string>();
type KeyHandler = (e: KeyboardEvent) => boolean | void;
const downHandlers: KeyHandler[] = [];
const upHandlers: KeyHandler[] = [];

export function onKeyDown(h: KeyHandler) {
  downHandlers.unshift(h);
  return () => downHandlers.splice(downHandlers.indexOf(h), 1);
}
export function onKeyUp(h: KeyHandler) {
  upHandlers.unshift(h);
  return () => upHandlers.splice(upHandlers.indexOf(h), 1);
}

export function typing() {
  const a = document.activeElement;
  return !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT");
}

window.addEventListener("keydown", (e) => {
  if (typing()) {
    if (e.key === "Escape") (document.activeElement as HTMLElement).blur();
    return;
  }
  if (e.code === "Tab" || e.code.startsWith("F") && e.code.length <= 3 && e.code !== "KeyF") e.preventDefault();
  const first = !held.has(e.code);
  held.add(e.code);
  if (!first) return;
  for (const h of [...downHandlers]) if (h(e) === true) break;
});

window.addEventListener("keyup", (e) => {
  held.delete(e.code);
  tapped.add(e.code);
  if (typing()) return;
  for (const h of [...upHandlers]) if (h(e) === true) break;
});

window.addEventListener("blur", () => {
  for (const code of [...held]) {
    held.delete(code);
    const ev = new KeyboardEvent("keyup", { code });
    for (const h of [...upHandlers]) if (h(ev) === true) break;
  }
});

/** While a context menu with a choice is on screen, ↑/↓ pick an option instead of climbing (W/S still climb). */
export const menuArrows = { on: false };

export function axis(): { mx: number; my: number; run: boolean } {
  if (typing()) {
    tapped.clear();
    return { mx: 0, my: 0, run: false };
  }
  const on = (c: string) => held.has(c) || tapped.has(c);
  const mx = (on("KeyD") || on("ArrowRight") ? 1 : 0) - (on("KeyA") || on("ArrowLeft") ? 1 : 0);
  const arrows = !menuArrows.on;
  const my = (on("KeyS") || (arrows && on("ArrowDown")) ? 1 : 0) - (on("KeyW") || (arrows && on("ArrowUp")) ? 1 : 0);
  tapped.clear();
  return { mx, my, run: held.has("ShiftLeft") || held.has("ShiftRight") };
}
