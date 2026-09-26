// Понятный старт (#43).
// 1. «Как играть»: three cards with real frames of the game, shown once before the first game starts
//    (in the lobby, while no clock runs) and any time later from the menu.
// 2. «Сегодня: обеспечьте жильцов»: the first days in the bunker, one current step at a time. A step
//    closes when the player has done it, not when a button is pressed; real stock numbers, no pauses.
import { BAL, OBJECTS } from "@bunker/shared";
import { net } from "../net";
import { clear, closeModal, h, isModalOpen, modal, ui } from "./dom";
import type { GameUI } from "./game";
import { foodTotal } from "./hud";

const INTRO_KEY = "bunker.introSeen";
const GUIDE_KEY = "bunker.guide";

function store(k: string, v?: string): string | null {
  try {
    if (v === undefined) return localStorage.getItem(k);
    localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
  return null;
}

const CARDS = [
  {
    img: "bunker",
    q: "Что я делаю?",
    text: "Это ваш бункер. Вместе с другими жильцами вы переживаете дни под землёй: держите свет, воду и еду.",
    example: "Сверху — запасы: еда, вода, энергия. Внизу — ваши люди и их дела.",
  },
  {
    img: "sortie",
    q: "Где взять недостающее?",
    text: "Выходите отрядом на вылазки. В магазине — еда и вода, в аптеке — лекарства и химикаты. Снаружи опасно: идите вдвоём-втроём.",
    example: "Еды на 1 день → вылазка в магазин → +6 консервов на складе.",
  },
  {
    img: "grow",
    q: "Как не погибнуть позже?",
    text: "Постройте гидропонику — еда будет расти сама. Насос качает грязную воду, фильтр делает её питьевой. Им нужны энергия и уход.",
    example: "Источник → склад → жильцы. Кончились еда или вода — жильцы слабеют и могут погибнуть.",
  },
];

export function introSeen() {
  return store(INTRO_KEY) === "1";
}

/** The three cards. On a wide screen all at once, on a phone one by one with «1/3». */
export function openIntro(opts: { skipPrologue?: boolean; onClose?: () => void } = {}) {
  const wide = window.innerWidth >= 900 && window.innerHeight >= 560;
  let i = 0;
  // the others in the lobby see that someone is still reading
  net.send({ k: "reading", v: true });
  const finish = () => {
    store(INTRO_KEY, "1");
    net.send({ k: "reading", v: false });
    closeModal();
    opts.onClose?.();
  };
  const last = opts.skipPrologue ? "Понятно — к первому дню" : "Понятно — к сбору припасов";
  const card = (c: (typeof CARDS)[number], n: number) =>
    h(
      "div.intro-card",
      null,
      h("img.intro-img", { src: `${import.meta.env.BASE_URL}assets/intro/${c.img}.jpg`, alt: "", loading: "eager" }),
      h("div.intro-q", null, h("span.intro-n", null, String(n + 1)), c.q),
      h("p.intro-text", null, c.text),
      h("p.intro-example", null, c.example),
    );
  const body = h("div.intro");
  const render = () => {
    clear(body);
    if (wide) {
      body.append(
        h("div.intro-row", null, ...CARDS.map(card)),
        h("div.row.intro-foot", null, h("button", { onclick: finish }, "Пропустить"), h("div.grow"), h("button.primary", { onclick: finish }, last)),
      );
      return;
    }
    body.append(
      card(CARDS[i], i),
      h(
        "div.row.intro-foot",
        null,
        h("button", { onclick: finish }, "Пропустить"),
        h("span.intro-dots", null, `${i + 1} / ${CARDS.length}`),
        h("div.grow"),
        i < CARDS.length - 1 ? h("button.primary", { onclick: () => (i++, render()) }, "Дальше →") : h("button.primary", { onclick: finish }, last),
      ),
    );
  };
  render();
  modal("☢ Как играть", body, { wide: true, cls: "intro-modal", onClose: () => (store(INTRO_KEY, "1"), net.send({ k: "reading", v: false })) });
}

// ---------------------------------------------------------------- the first days

type Step = "power" | "food" | "water";
interface GuideState {
  power?: boolean;
  food?: boolean;
  water?: boolean;
  done?: boolean;
}

function loadGuide(): GuideState {
  try {
    return JSON.parse(store(GUIDE_KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

export function guideDone() {
  return !!loadGuide().done;
}

export class FirstDayGuide {
  el = h("div.first-day.hidden");
  private st = loadGuide();
  private key = "";
  private waterAck = false;

  constructor(private game: GameUI) {
    ui().appendChild(this.el);
  }

  private save() {
    store(GUIDE_KEY, JSON.stringify(this.st));
  }

  private finish() {
    this.st.done = true;
    this.save();
    this.el.classList.add("hidden");
  }

  /** Walk to an object of this kind and open its actions: the same as a click on a task. */
  private showWhere(kind: string) {
    const v = net.pub;
    if (!v) return;
    const me = net.myChar();
    const o = (Object.values(v.objs) as any[]).filter((x) => x.kind === kind && !x.broken).sort((a, b) => Math.abs(a.x - (me?.x ?? 0)) + Math.abs(a.lv - (me?.lv ?? 0)) * 6 - (Math.abs(b.x - (me?.x ?? 0)) + Math.abs(b.lv - (me?.lv ?? 0)) * 6))[0];
    if (!o) return;
    this.game.navigation.go(o.x + 0.5, o.lv, () => this.game.prompt.focus(o.id, OBJECTS[o.kind]?.name ?? "Действия"));
  }

  /** busy: a fight, a sortie, a table — the guide waits in the bunker. */
  update(busy: boolean) {
    const v = net.pub;
    const me = net.myChar();
    const b = document.body.classList;
    const inBunker = !!v && v.phase === "day" && !busy && !!me && me.status !== "away" && !b.contains("mode-build") && !b.contains("mode-map");
    // progress counts whatever the player does, visible or not
    if (v && me && !this.st.done) {
      let changed = false;
      if (!this.st.power && me.task?.action === "pedal") changed = this.st.power = true;
      if (!this.st.food && (b.contains("mode-build") || b.contains("mode-map") || !!v.mods?.expedition)) changed = this.st.food = true;
      if (!this.st.water && ["pump", "flush_water_filter", "clean_water_filter"].includes(me.task?.action)) changed = this.st.water = true;
      if (changed) this.save();
      if (this.st.power && this.st.food && this.st.water) this.finish();
    }
    const objs: any[] = v?.mods?.objectives ?? [];
    // people in danger (down, fire, raid) come before the lesson; a shortage of food, water or power is
    // exactly what the lesson is about, so it jumps to that step instead of hiding
    const emergency = objs.some((o) => o.kind === "urgent" && !["intercom", "food", "water", "power"].includes(o.id));
    const short = (id: string) => objs.some((o) => o.id === id && o.kind === "urgent");
    const show = inBunker && !this.st.done && v.day <= 3 && !emergency && !isModalOpen();
    this.el.classList.toggle("hidden", !show);
    if (!show) return;
    const people = Math.max(1, (Object.values(v.chars) as any[]).filter((c) => c.status !== "dead" && c.status !== "away").length);
    const foodDays = foodTotal(v.res) / (people * BAL.rationFood);
    const waterDays = (v.res.water ?? 0) / (people * BAL.rationWater);
    const pending = (["power", "food", "water"] as Step[]).filter((s) => !this.st[s]);
    const step: Step | null = pending.find((s) => short(s)) ?? pending[0] ?? null;
    if (!step) return this.finish();
    const n = (["power", "food", "water"] as Step[]).indexOf(step) + 1;
    const key = JSON.stringify([step, foodDays.toFixed(1), waterDays.toFixed(1), this.waterAck]);
    if (key === this.key) return;
    this.key = key;
    clear(this.el);
    const stock = h(
      "div.fd-stock",
      null,
      h("span" + (foodDays < 2 ? ".bad" : ""), null, `🥫 еды ~${foodDays.toFixed(1)} дн.`),
      h("span" + (waterDays < 2 ? ".bad" : ""), null, `💧 воды ~${waterDays.toFixed(1)} дн.`),
      h("small.dim", null, "Кончатся — жильцы начнут терять здоровье и могут погибнуть."),
    );
    const head = h("div.fd-head", null, h("b", null, "Сегодня: обеспечьте жильцов"), h("span.dim", null, `шаг ${n} из 3`), h("button.fd-skip", { title: "Пропустить обучение", onclick: () => this.finish() }, "✕"));
    let body: HTMLElement;
    if (step === "power") {
      body = h(
        "div.fd-step",
        null,
        h("div", null, h("b", null, "Дайте ток фильтрам и грядкам. "), "Покрутите велогенератор: без энергии не чистятся вода и воздух, не растёт еда."),
        h("div.row.fd-actions", null, h("button.primary", { onclick: () => this.showWhere("bike_gen") }, "Показать где")),
      );
    } else if (step === "food") {
      body = h(
        "div.fd-step",
        null,
        h("div", null, h("b", null, "Пополните еду — выберите путь. "), "Вылазка приносит припасы сейчас, гидропоника даёт еду со временем."),
        h(
          "div.row.fd-actions",
          null,
          h("button.primary", { onclick: () => this.showWhere("sortie_terminal") }, "🎒 Вылазка — сейчас"),
          h("button", { onclick: () => this.game.build.toggle(true) }, "🌱 Гидропоника — потом"),
        ),
      );
    } else {
      const low = waterDays < 2;
      body = h(
        "div.fd-step",
        null,
        h("div", null, h("b", null, low ? "Проверьте воду. " : "Памятка о воде. "), "Насос качает грязную воду, рабочий фильтр под током делает её питьевой — нужна пара."),
        h(
          "div.row.fd-actions",
          null,
          h("button" + (low ? ".primary" : ""), { onclick: () => this.showWhere("hand_pump") }, "Показать насос"),
          low ? null : h("button.primary", { onclick: () => ((this.st.water = true), this.save(), this.finish()) }, "Понятно"),
        ),
      );
    }
    this.el.append(head, stock, body);
  }
}
