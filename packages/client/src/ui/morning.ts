// «Утренняя сводка» (#30, #18): the first time you look at a new day, one card says what changed while you
// were away, what hurts most, what today's goal is and that a fresh «Вестник» is out. Then the day is yours.
import { net } from "../net";
import { closeModal, h, isModalOpen, modal } from "./dom";
import { foodTotal } from "./hud";
import { openBoard } from "./screens";

interface Snap {
  code: string;
  day: number;
  alive: string[];
  food: number;
  water: number;
  rooms: number;
}

const KEY = "bunker.morning";

function load(): Snap | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "null");
  } catch {
    return null;
  }
}

function save(s: Snap) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode */
  }
}

export class MorningUI {
  private shownDay = -1;

  constructor(private openObjectives: () => void) {}

  private snap(v: any): Snap {
    return {
      code: net.code ?? "",
      day: v.day,
      alive: Object.values(v.chars)
        .filter((c: any) => c.status !== "dead")
        .map((c: any) => c.card.name),
      food: Math.round(foodTotal(v.res) * 10) / 10,
      water: Math.floor(v.res.water ?? 0),
      rooms: Object.values(v.rooms).filter((r: any) => r.state === "done").length,
    };
  }

  /** busy = a fight, a sortie, a table: the morning can wait until the player is back in the bunker. */
  update(busy: boolean) {
    const v = net.pub;
    if (!v || v.phase !== "day" || busy || isModalOpen()) return;
    const me = net.myChar();
    if (!me || me.status === "away") return;
    const now = this.snap(v);
    const prev = load();
    if (this.shownDay === v.day) return;
    // the first visit of this bunker, or the very first day: nothing to compare — just remember
    if (!prev || prev.code !== now.code || v.day <= 1) {
      this.shownDay = v.day;
      save(now);
      return;
    }
    if (prev.day >= v.day) {
      this.shownDay = v.day;
      return;
    }
    this.shownDay = v.day;
    save(now);
    this.show(v, prev, now);
  }

  private show(v: any, prev: Snap, now: Snap) {
    const days = now.day - prev.day;
    const lost = prev.alive.filter((n) => !now.alive.includes(n));
    const came = now.alive.filter((n) => !prev.alive.includes(n));
    const changes: string[] = [];
    if (days > 1) changes.push(`прошло ${days} дн.`);
    changes.push(`еда ${prev.food} → ${now.food}`, `вода ${prev.water} → ${now.water} л`);
    if (now.rooms !== prev.rooms) changes.push(`комнат ${prev.rooms} → ${now.rooms}`);
    if (came.length) changes.push(`новые жильцы: ${came.map((n) => n.split(" ")[0]).join(", ")}`);
    const objectives: any[] = v.mods?.objectives ?? [];
    const worst = objectives.find((o) => o.kind === "urgent") ?? objectives.find((o) => o.kind === "need");
    const goal = v.mods?.dayGoal;
    const g = v.gazette?.[v.gazette.length - 1];
    const body = h(
      "div.morning",
      null,
      h("p.morning-away", null, h("b", null, "Пока вас не было: "), changes.join(" · ") + "."),
      lost.length ? h("p.morning-loss", null, `🕯 Не стало: ${lost.join(", ")}.`) : null,
      worst ? h("p.morning-worst", null, h("b", null, "Главная беда: "), worst.text, worst.hint ? h("small.dim", null, " — " + worst.hint) : null) : h("p.dim", null, "Бункер держится: срочного ничего нет."),
      goal && goal.day === v.day ? h("p.morning-goal", null, h("b", null, "🎯 Цель дня: "), goal.text, h("small.dim", null, " — " + goal.hint)) : null,
      g
        ? h(
            "div.morning-paper",
            null,
            h("b", null, `📰 Вышел «Вестник Бункера» №${v.gazetteCount ?? v.gazette.length}: ${g.headline}`),
            g.lines?.[0] ? h("div.dim", null, g.lines[0]) : null,
          )
        : null,
      h(
        "div.row",
        { style: { marginTop: "12px", gap: "8px", flexWrap: "wrap" } },
        g ? h("button", { onclick: () => (closeModal(), openBoard("gazette")) }, "📰 Читать") : null,
        h("div.grow"),
        h("button.primary", { onclick: () => (closeModal(), this.openObjectives()) }, "Что делать?"),
      ),
    );
    modal(`☀ Утро, день ${v.day}`, body, { cls: "morning-modal" });
  }
}
