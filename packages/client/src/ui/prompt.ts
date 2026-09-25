import { ACTIONS, CROPS, listActions, seedItem, type AvailableAction } from "@bunker/shared";
import { net } from "../net";
import { menuArrows } from "../input";
import type { WorldRenderer } from "../render/world";
import { clear, h, modal, closeModal, ui } from "./dom";
import { icon } from "./icons";

/** Actions that open a client-side screen instead of (or before) a server action. */
export const CLIENT_SCREENS: Record<string, (a: AvailableAction) => boolean> = {};

export class Prompt {
  el = h("div.prompt.hidden");
  list: AvailableAction[] = [];
  sel = 0;
  holding: string | null = null;
  private key = "";
  private listKey = "";
  private focused: string | null = null;
  private title = "Рядом с вами";
  private mobileExpanded = false;

  focus(id: string, title: string) { this.focused = id; this.title = title; this.key = ""; }

  constructor(private r: WorldRenderer) {
    ui().appendChild(this.el);
  }

  compute(): AvailableAction[] {
    const v = net.pub;
    const c = net.myChar();
    if (!v || !c || v.phase !== "day" || c.status !== "ok") return [];
    const p = net.pred;
    const me = { ...c, x: p ? p.x : c.x, lv: p ? p.lv : c.lv, climbing: p ? p.climbing : c.climbing };
    try {
      // identical labels (e.g. the same action offered by two neighbouring objects) show once
      const seen = new Set<string>();
      const all = listActions(v as any, me as any).filter((a) => {
        const k = a.a + "|" + a.label;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      if (this.focused && all.some(a => a.t.id === this.focused)) return all.filter(a => a.t.id === this.focused).slice(0, 7);
      this.focused = null;
      this.title = "Рядом с вами";
      return all.slice(0, 7);
    } catch {
      return [];
    }
  }

  update(hidden: boolean) {
    const v = net.pub;
    const c = net.myChar();
    if (!v || !c || hidden || v.phase !== "day" || c.status !== "ok") {
      this.el.classList.add("hidden");
      this.list = [];
      menuArrows.on = false;
      return;
    }
    this.list = this.compute();
    // a new set of options (walked up to something else) starts from the first, most important one
    const lk = this.list.map((a) => a.a + a.t.id).join("|");
    if (lk !== this.listKey) {
      this.listKey = lk;
      this.sel = 0;
      this.mobileExpanded = false;
    }
    if (this.sel >= this.list.length) this.sel = 0;
    menuArrows.on = this.list.length >= 2;
    this.el.classList.add("action-dock");
    const taskLine = c.task ? `${ACTIONS[c.task.action] ? "" : ""}Занят: ${taskLabel(c.task.action)} — E или шаг, чтобы прекратить` : "";
    const key = JSON.stringify([this.list.map((a) => a.label + (a.reason ?? "")), this.sel, taskLine, this.title]);
    if (key === this.key) {
      this.el.classList.toggle("hidden", !this.list.length && !taskLine);
      return;
    }
    this.key = key;
    clear(this.el);
    const focusedHere = this.title !== "Рядом с вами";
    this.el.classList.toggle("mobile-expanded", this.mobileExpanded);
    this.el.append(
      h(
        "div.dock-heading",
        null,
        h("span", null, icon(focusedHere ? "target" : "hand"), " ", this.title),
        focusedHere ? h("button.small.dock-all", { onclick: () => { this.focused = null; this.title = "Рядом с вами"; this.key = ""; } }, "всё рядом") : null,
        this.list.length > 1
          ? h(
              "button.small.mobile-action-toggle",
              {
                "aria-expanded": String(this.mobileExpanded),
                onclick: () => {
                  this.mobileExpanded = !this.mobileExpanded;
                  this.key = "";
                  this.update(false);
                },
              },
              this.mobileExpanded ? "Свернуть" : `Ещё ${this.list.length - 1}`,
              icon(this.mobileExpanded ? "chevronDown" : "chevronRight"),
            )
          : null,
        this.list.length > 1 ? h("span.dock-keys", null, "↑↓ выбор · E действие") : this.list.length ? h("span.dock-keys", null, "E действие") : null,
      ),
    );
    if (taskLine) this.el.appendChild(h("div.dim", null, taskLine));
    this.list.forEach((a, i) => {
      this.el.appendChild(
        h(
          "button.opt" + (i === this.sel ? ".sel" : "") + (a.reason ? ".dis" : "") + (i > 0 ? ".mobile-extra-action" : ""),
          {
            disabled: !!a.reason,
            // «hold» actions (pedalling, digging…) last while the finger or the mouse button is down
            onpointerdown: ACTIONS[a.a]?.hold
              ? () => {
                  this.sel = i;
                  this.key = "";
                  this.trigger(i);
                  window.addEventListener("pointerup", () => this.release(), { once: true });
                }
              : undefined,
            onclick: ACTIONS[a.a]?.hold
              ? undefined
              : () => {
                  this.sel = i;
                  this.key = "";
                  this.trigger(i);
                },
          },
          h("span.key", null, i === this.sel ? "E" : String(i + 1)),
          ACTIONS[a.a]?.hold ? h("span.hold-hint", null, "держать") : null,
          a.label,
          a.reason ? h("span.bad", null, ` — ${a.reason}`) : null,
        ),
      );
    });
    this.el.classList.toggle("hidden", !this.list.length && !taskLine);
  }

  /** E pressed. Returns true if handled. */
  trigger(i = this.sel): boolean {
    const c = net.myChar();
    if (!c) return false;
    const fresh = this.compute();
    if (fresh.length !== this.list.length || fresh.some((a, k) => a.a !== this.list[k]?.a || a.t.id !== this.list[k]?.t.id)) {
      this.list = fresh;
      if (i >= fresh.length) i = 0;
    }
    if (c.task && i === this.sel && !this.list.length) {
      net.send({ k: "stop" });
      return true;
    }
    if (c.task && i === this.sel && this.list[i]?.a === c.task.action) {
      net.send({ k: "stop" });
      return true;
    }
    const a = this.list[i];
    if (!a) {
      if (c.task) net.send({ k: "stop" });
      return !!c.task;
    }
    if (a.reason) return true;
    if (CLIENT_SCREENS[a.a]?.(a)) return true;
    if (a.a === "plant") {
      choosePlant(a);
      return true;
    }
    net.send({ k: "do", a: a.a, tt: a.t.type, t: a.t.id });
    if (ACTIONS[a.a]?.hold) this.holding = a.a;
    return true;
  }

  release() {
    if (this.holding) {
      net.send({ k: "stop", holdOnly: true });
      this.holding = null;
    }
  }

  cycle(d: number) {
    if (!this.list.length) return;
    this.sel = (this.sel + d + this.list.length) % this.list.length;
    this.key = "";
  }
}

function taskLabel(a: string) {
  const map: Record<string, string> = { pedal: "кручу педали", sleep: "сплю", dig: "копаю", build_frame: "строю", extinguish: "тушу пожар", listen_radio: "слушаю радио", read_book: "читаю", sit: "отдыхаю", chat_table: "болтаю за столом" };
  return map[a] ?? "работаю";
}

function choosePlant(a: AvailableAction) {
  const v = net.pub!;
  const opts = Object.keys(CROPS).filter((k) => (v.res[seedItem(k)] ?? 0) >= 1);
  modal(
    "Что посадить?",
    h(
      "div.col",
      null,
      opts.map((k) =>
        h(
          "button",
          {
            onclick: () => {
              net.send({ k: "do", a: a.a, tt: a.t.type, t: a.t.id, x: k });
              closeModal();
            },
            style: { textAlign: "left" },
          },
          `🌱 ${CROPS[k].name} — семян: ${Math.floor(v.res[seedItem(k)] ?? 0)}. `,
          h("span.dim", null, `${CROPS[k].days} дн. ${CROPS[k].desc}`),
        ),
      ),
    ),
  );
}
