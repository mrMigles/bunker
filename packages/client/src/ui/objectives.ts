import { OBJECTS } from "@bunker/shared";
import { net } from "../net";
import { add, clear, h, ui } from "./dom";
import type { GameUI } from "./game";

const ICON: Record<string, string> = { urgent: "⚠", need: "●", quest: "💬", tutorial: "☐" };

/** «Задачи» panel: the colony's current priorities and the first-days tutorial. Click = go there. */
export class ObjectivesUI {
  el = h("div.objectives.hidden");
  private key = "";
  private collapsed = false;

  constructor(private game: GameUI) {
    ui().appendChild(this.el);
    try {
      this.collapsed = localStorage.getItem("bunker.objectives.collapsed") === "1";
    } catch {
      /* private mode */
    }
  }

  private busy() {
    const g = this.game;
    return !!(g.table?.active || g.combat?.active || (g.exp && g.exp.mode !== "none") || g.pro?.active);
  }

  update() {
    const v = net.pub;
    const list: any[] = v?.mods?.objectives ?? [];
    const show = !!v && v.phase === "day" && net.myChar()?.status !== "away" && !this.busy() && list.length > 0;
    this.el.classList.toggle("hidden", !show);
    if (!show) return;
    const key = JSON.stringify([list, this.collapsed]);
    if (key === this.key) return;
    this.key = key;
    clear(this.el);
    const urgent = list.filter((o) => o.kind === "urgent").length;
    add(
      this.el,
      h(
        "button.objectives-head",
        {
          onclick: () => {
            this.collapsed = !this.collapsed;
            try {
              localStorage.setItem("bunker.objectives.collapsed", this.collapsed ? "1" : "0");
            } catch {
              /* ignore */
            }
            this.key = "";
            this.update();
          },
        },
        h("b", null, "Задачи"),
        urgent ? h("span.objectives-badge", null, String(urgent)) : null,
        h("span.dim", null, this.collapsed ? "▸" : "▾"),
      ),
    );
    if (this.collapsed) return;
    for (const o of list) {
      const target = o.obj || o.char;
      add(
        this.el,
        h(
          "div.objective." + o.kind + (o.done ? ".done" : "") + (target ? ".go" : ""),
          { title: o.hint ?? "", onclick: () => target && this.go(o) },
          h("span.objective-icon", null, o.done ? "☑" : ICON[o.kind] ?? "●"),
          h("div", null, h("div.objective-text", null, o.text), o.hint && !o.done ? h("div.objective-hint", null, o.hint) : null),
          target && !o.done ? h("span.objective-go", null, "→") : null,
        ),
      );
    }
  }

  private go(o: any) {
    const v = net.pub!;
    if (o.obj) {
      const obj = v.objs[o.obj];
      if (!obj) return;
      this.game.navigation.go(obj.x + 0.5, obj.lv, () => this.game.prompt.focus(obj.id, OBJECTS[obj.kind]?.name ?? "Действия"));
    } else if (o.char) {
      const c = v.chars[o.char];
      if (c) this.game.navigation.go(c.x + (c.x > 1 ? -0.6 : 0.6), c.lv);
    }
  }
}
