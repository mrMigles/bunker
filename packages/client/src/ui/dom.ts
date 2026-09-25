// Tiny DOM helper: h("div.cls#id", {attrs|on*}, ...children)
import { icon } from "./icons";

type Child = Node | string | number | null | undefined | false | Child[];

export function h<K extends keyof HTMLElementTagNameMap>(sel: K | string, attrs?: Record<string, any> | null, ...children: Child[]): HTMLElement {
  const m = /^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i.exec(sel);
  const tag = m?.[1] || "div";
  const el = document.createElement(tag);
  const rest = m?.[2] ?? "";
  for (const part of rest.match(/[.#][\w-]+/g) ?? []) {
    if (part[0] === ".") el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  if (attrs) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else if (k === "class") el.className += " " + v;
      else if (k === "html") el.innerHTML = v;
      else if (k in el && k !== "list") (el as any)[k] = v;
      else el.setAttribute(k, v === true ? "" : String(v));
    }
  }
  append(el, children);
  return el;
}

/** Appends children, skipping null/false. */
export function add(el: HTMLElement, ...children: Child[]) {
  append(el, children);
  return el;
}

function append(el: HTMLElement, children: Child[]) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export function clear(el: HTMLElement) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

export const ui = () => document.getElementById("ui")!;

export function toast(text: string) {
  const t = h("div.toast", null, text);
  ui().appendChild(t);
  setTimeout(() => t.remove(), 3300);
}

export function floatText(x: number, y: number, text: string, color = "#ffe08a") {
  const t = h("div.float", { style: { left: x + "px", top: y + "px", color } }, text);
  ui().appendChild(t);
  setTimeout(() => t.remove(), 1700);
}

let modalEl: HTMLElement | null = null;
/** Window titles written with a leading emoji get a line icon instead (same meaning, the game's style). */
const TITLE_IC: [string, string][] = [
  ["⚙", "gear"],
  ["🍲", "pot"],
  ["🔨", "hammer"],
  ["📦", "box"],
  ["📻", "radio"],
  ["📖", "book"],
  ["📚", "book"],
  ["📰", "news"],
  ["🗺", "map"],
  ["🎒", "backpack"],
  ["⭐", "star"],
  ["🔭", "eye"],
  ["🎨", "sparkles"],
  ["💬", "chat"],
  ["🔔", "bell"],
  ["📞", "bell"],
  ["🧪", "sparkles"],
  ["🏆", "trophy"],
];

export function modal(title: string, body: Node | Node[], opts: { onClose?: () => void; wide?: boolean; cls?: string; icon?: string } = {}): HTMLElement {
  closeModal();
  let ic = opts.icon;
  let text = title;
  for (const [emoji, name] of TITLE_IC)
    if (text.startsWith(emoji)) {
      ic ??= name;
      text = text.slice(emoji.length).replace(/^️/, "").trim();
      break;
    }
  const box = h(
    "div.panel.modal" + (opts.cls ? "." + opts.cls : ""),
    { style: opts.wide ? { width: "min(1180px, calc(100vw - 24px))" } : {} },
    h("button.small.close", { onclick: () => closeModal(), "aria-label": "Закрыть" }, icon("x")),
    h("h2", null, ic ? icon(ic) : null, text),
    body,
  );
  const back = h("div.modal-back", { onmousedown: (e: MouseEvent) => e.target === back && closeModal() }, box);
  (back as any)._onClose = opts.onClose;
  ui().appendChild(back);
  modalEl = back;
  return box;
}

export function closeModal() {
  if (modalEl) {
    const cb = (modalEl as any)._onClose;
    modalEl.remove();
    modalEl = null;
    cb?.();
  }
}

export function isModalOpen() {
  return !!modalEl;
}

export function bar(v: number, color?: string, max = 100) {
  const pct = Math.max(0, Math.min(100, (v / max) * 100));
  return h("div.bar", null, h("i", { style: { width: pct + "%", background: color ?? needColor(pct) } }));
}

export function needColor(pct: number) {
  return pct > 60 ? "#8fcf6a" : pct > 30 ? "#e8c14a" : "#e0503a";
}
