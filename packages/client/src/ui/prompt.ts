import { ACTIONS, CROPS, listActions, seedItem, type AvailableAction } from "@bunker/shared";
import { net } from "../net";
import type { WorldRenderer } from "../render/world";
import { clear, h, modal, closeModal, ui } from "./dom";

/** Actions that open a client-side screen instead of (or before) a server action. */
export const CLIENT_SCREENS: Record<string, (a: AvailableAction) => boolean> = {};

export class Prompt {
  el = h("div.prompt.hidden");
  list: AvailableAction[] = [];
  sel = 0;
  holding: string | null = null;
  private key = "";

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
      return listActions(v as any, me as any).slice(0, 7);
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
      return;
    }
    this.list = this.compute();
    if (this.sel >= this.list.length) this.sel = 0;
    const cv = this.r.chars.get(c.id);
    const [sx, sy] = this.r.toScreen(cv ? cv.x : c.x, -(cv ? cv.y : c.y) + 2.25);
    this.el.style.left = sx + "px";
    this.el.style.top = sy + "px";
    const taskLine = c.task ? `${ACTIONS[c.task.action] ? "" : ""}Занят: ${taskLabel(c.task.action)} — E или шаг, чтобы прекратить` : "";
    const key = JSON.stringify([this.list.map((a) => a.label + (a.reason ?? "")), this.sel, taskLine]);
    if (key === this.key) {
      this.el.classList.toggle("hidden", !this.list.length && !taskLine);
      return;
    }
    this.key = key;
    clear(this.el);
    if (taskLine) this.el.appendChild(h("div.dim", null, taskLine));
    this.list.forEach((a, i) => {
      this.el.appendChild(
        h(
          "div.opt" + (i === this.sel ? ".sel" : "") + (a.reason ? ".dis" : ""),
          {
            onmousedown: (e: MouseEvent) => {
              e.preventDefault();
              this.sel = i;
              this.trigger(i);
            },
            onmouseup: () => this.release(),
          },
          h("span.key", null, i === this.sel ? "E" : String(i + 1)),
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
