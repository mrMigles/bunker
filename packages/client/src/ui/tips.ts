// Обучение: short cards that explain the game when it matters — the first minute of the prologue,
// the first day, the first sortie, fight, council, visitor, level… Each shows once (remembered in
// the browser); the player can turn them off. They never block the game.
import { threatLevel } from "@bunker/shared";
import { net } from "../net";
import { mobile } from "../touch";
import { clear, h, isModalOpen, ui } from "./dom";
import { guideDone, introSeen } from "./onboarding";

interface Tip {
  id: string;
  icon: string;
  title: string;
  lines: string[];
  /** the same card for phones (no keys, fingers instead of the mouse) */
  touch?: string[];
  /** when it becomes relevant */
  when: (x: Ctx) => boolean;
  /** shown even right after another card */
  urgent?: boolean;
}

interface Ctx {
  v: any;
  me: any;
  mode: string;
  t: number; // seconds in the current phase on this client
}

const TIPS: Tip[] = [
  {
    id: "prologue",
    icon: "☢",
    title: "Последняя минута",
    lines: ["Сейчас по городу ударят. Соберите всё, что успеете: щёлкните по вещи или подойдите и нажмите <b>E</b>.", "В руках — до трёх вещей. Несите их к люку: <b>Пробел</b> или кнопка «Отнести в убежище».", "Лучшее — в дальних домах и на вторых этажах. Не опоздайте к вспышке!"],
    touch: ["Сейчас по городу ударят. Соберите всё, что успеете: коснитесь вещи или подойдите и нажмите <b>✋</b>.", "В руках — до трёх вещей. Несите их к люку: кнопка «Отнести в убежище».", "Лучшее — в дальних домах и на вторых этажах. Не опоздайте к вспышке!"],
    // the story is told by the intro cards and the steps sit in the timer panel (#43): this card is for
    // those who skipped the intro, and only once the first supply is in their hands
    when: (x) => x.v.phase === "prologue" && !introSeen() && (x.me?.hands?.length ?? 0) > 0,
    urgent: true,
  },
  {
    id: "prologue_full",
    icon: "✋",
    title: "Руки заняты",
    lines: ["Больше не унести. Бегом к люку — или бросьте вещь соседу (<b>Q</b>), он донесёт."],
    touch: ["Больше не унести. Бегом к люку — или бросьте вещь соседу (<b>⤴</b>), он донесёт."],
    when: (x) => x.v.phase === "prologue" && (x.me?.hands?.length ?? 0) >= 3,
    urgent: true,
  },
  {
    id: "bunker",
    icon: "🏠",
    title: "Добро пожаловать в убежище",
    lines: ["Ходите мышью или <b>WASD</b>, по лестницам — <b>W/S</b>, <b>Shift</b> — бег.", "Подойдите к любой вещи: справа внизу появится меню «Рядом с вами». <b>E</b> — выделенное действие, <b>↑↓</b> — выбрать другое.", "Слева — «Задачи»: что сейчас важнее всего. Щёлкните задачу — персонаж сам пойдёт туда."],
    touch: ["Коснитесь места — персонаж пойдёт туда. Или ведите джойстиком слева; по лестницам — вверх/вниз, до упора — бег.", "Подойдите к любой вещи: справа появится меню «Рядом с вами». Коснитесь действия или жмите <b>✋</b>.", "Два пальца — сдвинуть и приблизить бункер. Слева — «Задачи»: коснитесь задачи, и персонаж сам пойдёт туда."],
    when: (x) => x.v.phase === "day" && x.mode === "bunker" && x.t > 3 && guideDone(),
  },
  {
    id: "needs",
    icon: "❤",
    title: "Потребности",
    lines: ["Карточка слева внизу: сытость, вода, бодрость, рассудок, здоровье.", "Жильцы-боты едят, пьют и спят сами. Главный приём пищи — ночью на совете, там же раздают пайки.", "Рассудок поднимают разговоры, музыка, настолки и уют."],
    when: (x) => x.v.phase === "day" && x.mode === "bunker" && x.t > 45 && guideDone(),
  },
  {
    id: "menus",
    icon: "▣",
    title: "Убежище и персонаж",
    lines: ["<b>Tab</b> — «Убежище»: склад, доска дел, газета, рецепты.", "<b>I</b> — «Персонаж»: снаряжение (оружие, защита, инструмент), вещи спутников и прокачка."],
    touch: ["<b>▣</b> — «Убежище»: склад, доска дел, газета, рецепты.", "<b>☻</b> — «Персонаж»: снаряжение (оружие, защита, инструмент), вещи спутников и прокачка."],
    when: (x) => x.v.phase === "day" && x.mode === "bunker" && x.t > 90,
  },
  {
    id: "minigame",
    icon: "🛠",
    title: "Работа руками",
    lines: ["Многие дела — маленькая мини-игра: качайте насос, крутите педали в ритм, оттирайте фильтр.", "Руками быстрее и лучше. «Пусть делает сам» — персонаж доделает в обычном темпе."],
    when: () => !!document.querySelector(".mini-modal"),
    urgent: true,
  },
  {
    id: "build",
    icon: "⚒",
    title: "Стройка",
    lines: ["Выберите комнату в палитре — подходящие места подсветятся зелёным. Щелчок — разметка.", "Жильцы выкопают грунт и соберут каркас из материалов склада. Комнаты можно ставить друг над другом — лестница появится сама.", "Камень копают киркой, гранит — буром."],
    when: (x) => x.mode === "build",
    urgent: true,
  },
  {
    id: "carry",
    icon: "📥",
    title: "Вещи в руках",
    lines: ["Добычу с вылазки и находки нужно разнести по складу. В меню «Рядом с вами» есть «📥 Отнести на склад» — персонаж сам дойдёт до стеллажа."],
    when: (x) => x.v.phase === "day" && x.mode === "bunker" && (x.me?.hands?.length ?? 0) > 0,
  },
  {
    id: "sortie_prep",
    icon: "🎒",
    title: "Сборы на вылазку",
    lines: ["В отряде до трёх человек: вдвоём-втроём почти безопасно, в одиночку — риск.", "Возьмите воду, еду, аптечку, фонарь и оружие — вес ограничен силой отряда.", "Можно «Отправить без меня»: жильцы пойдут сами, шансы показаны заранее."],
    when: (x) => x.v.mods.expedition?.stage === "prep",
    urgent: true,
  },
  {
    id: "map",
    icon: "🗺",
    title: "Карта Новограда",
    lines: ["Щёлкните место — справа будут опасность, возможная добыча и угрозы. «Проложить маршрут» — отряд пойдёт по дорогам.", "«?» — неразведанное: откроется, когда пройдёте рядом. Ночью отряд встаёт лагерем."],
    when: (x) => x.mode === "map",
    urgent: true,
  },
  {
    id: "site",
    icon: "🏚",
    title: "Внутри здания",
    lines: ["Меню «Рядом с вами» появляется само. <b>E</b> — обыскать тихо, <b>держать E</b> — вдвое быстрее, но шумно.", "Шкала «Шум» справа: громко — сбегутся враги. <b>Shift</b> — красться, <b>L</b> — фонарь в тёмных комнатах, <b>G</b> — бросить камень.", "«Обыскать комнату всем отрядом» — быстро, но шумно. Выход — на первом этаже слева."],
    touch: ["Меню «Рядом с вами» появляется само. Коснитесь «Обыскать» — тихо, <b>держите</b> — вдвое быстрее, но шумно.", "Шкала «Шум» справа: громко — сбегутся враги. Лёгкий наклон джойстика — красться, <b>🔦</b> — фонарь, <b>🪨</b> — бросить камень.", "«Обыскать комнату всем отрядом» — быстро, но шумно. Выход — на первом этаже слева."],
    when: (x) => x.mode === "site",
    urgent: true,
  },
  {
    id: "noise",
    icon: "🔊",
    title: "Слишком шумно",
    lines: ["Враги слышат вас. Замрите, закройте дверь или отойдите — шум спадает сам. Спящих можно обойти или напасть исподтишка."],
    when: (x) => x.mode === "site" && (x.v.mods.expedition?.site?.noise ?? 0) > 45,
    urgent: true,
  },
  {
    id: "combat",
    icon: "⚔",
    title: "Бой",
    lines: ["Ход за ходом, как в XCOM. Синие клетки — дойти и ещё выстрелить, жёлтые — рывок.", "Щелчок по врагу — атака (виден шанс попадания). Укрытия режут шанс врага.", "<b>Enter</b> — конец хода. Над врагами подписано, что они сделают."],
    touch: ["Ход за ходом, как в XCOM. Синие клетки — дойти и ещё выстрелить, жёлтые — рывок.", "Коснитесь врага — атака (виден шанс попадания). Укрытия режут шанс врага.", "«Конец хода» — враги ходят. Над ними подписано, что они сделают."],
    when: (x) => x.mode === "combat",
    urgent: true,
  },
  {
    id: "night",
    icon: "🌙",
    title: "Ночной совет",
    lines: ["Время на паузе. Три шага: пайки, событие ночи, план на завтра.", "Нажмите «Готов», когда закончите, — или совет пойдёт дальше по таймеру."],
    when: (x) => x.v.phase === "night",
    urgent: true,
  },
  {
    id: "intercom",
    icon: "📞",
    title: "Кто-то у двери",
    lines: ["Звонит интерком у гермодвери (мигает лампа). Подойдите и нажмите <b>E</b>.", "Беженца можно впустить — это новый жилец. Сначала расспросите: бывают разведчики налётчиков."],
    touch: ["Звонит интерком у гермодвери (мигает лампа). Подойдите и коснитесь «Ответить».", "Беженца можно впустить — это новый жилец. Сначала расспросите: бывают разведчики налётчиков."],
    when: (x) => !!x.v.mods.intercom && !x.v.mods.intercom.done,
    urgent: true,
  },
  {
    id: "talk",
    icon: "💬",
    title: "Поговорите с жильцами",
    lines: ["Подойдите к жильцу — в меню будет «💬 Поговорить». Каждый день у каждого своя история, анекдот или просьба.", "Выполненные просьбы дают опыт и дружбу."],
    when: (x) => x.v.phase === "day" && x.mode === "bunker" && x.v.day >= 2 && x.t > 20,
  },
  {
    id: "level",
    icon: "⭐",
    title: "Новый уровень",
    lines: ["Выберите одно из трёх умений. Опыт дают дела в бункере, обыски, бои, вылазки и просьбы жильцов.", "Вся прокачка — в «Персонаж» (<b>I</b>) → «Прокачка»."],
    touch: ["Выберите одно из трёх умений. Опыт дают дела в бункере, обыски, бои, вылазки и просьбы жильцов.", "Вся прокачка — в «Персонаж» (<b>☻</b>) → «Прокачка»."],
    when: (x) => !!x.me?.perkOffer?.length,
    urgent: true,
  },
  {
    id: "food",
    icon: "🥫",
    title: "Кончается еда",
    lines: ["Сажайте грядки и ходите на вылазки: магазины и фермы — самые безопасные места с едой.", "Некогда самому — «Отправить без меня» у терминала вылазок."],
    when: (x) => (x.v.mods.objectives ?? []).some((o: any) => o.id === "food"),
  },
  {
    id: "threat",
    icon: "☢",
    title: "Угроза растёт",
    lines: ["Чем опытнее вы и чем дольше живёт бункер, тем опаснее пустошь: враги крепче и метче, в зданиях их больше.", "Уровень угрозы — в верхней плашке. Держите снаряжение в порядке."],
    when: (x) => threatLevel(x.v) >= 2,
  },
  {
    id: "raid",
    icon: "🚨",
    title: "Налёт!",
    lines: ["К бункеру идут налётчики. Раздайте оружие («Персонаж» → снаряжение), заложите гермодверь, займите позиции у шлюза."],
    when: (x) => (x.v.mods.objectives ?? []).some((o: any) => o.id === "raid"),
    urgent: true,
  },
];

export class TipsUI {
  el = h("div.tip-card.hidden");
  private seen: Set<string>;
  private off: boolean;
  private shown: Tip | null = null;
  private lastShown = -99;
  private phase = "";
  private phaseStart = 0;
  private lastCheck = 0;

  constructor() {
    let s: string[] = [];
    try {
      s = JSON.parse(localStorage.getItem("bunker.tips") ?? "[]");
      this.off = localStorage.getItem("bunker.tipsOff") === "1";
    } catch {
      this.off = false;
    }
    this.seen = new Set(s);
    ui().appendChild(this.el);
  }

  private save() {
    try {
      localStorage.setItem("bunker.tips", JSON.stringify([...this.seen]));
      localStorage.setItem("bunker.tipsOff", this.off ? "1" : "0");
    } catch {}
  }

  /** Brings the tutorial back (from the settings). */
  reset() {
    this.seen.clear();
    this.off = false;
    this.save();
  }

  update() {
    const now = performance.now() / 1000;
    if (now - this.lastCheck < 0.5) return;
    this.lastCheck = now;
    const v = net.pub;
    if (!v || this.off) return this.hide();
    const b = document.body.classList;
    const mode = v.phase === "prologue" ? "prologue" : b.contains("mode-site") ? "site" : b.contains("mode-map") ? "map" : b.contains("mode-combat") ? "combat" : b.contains("mode-build") ? "build" : b.contains("mode-table") ? "table" : "bunker";
    const ph = v.phase + mode;
    if (ph !== this.phase) {
      this.phase = ph;
      this.phaseStart = now;
    }
    const x: Ctx = { v, me: net.myChar(), mode, t: now - this.phaseStart };
    if (this.shown) {
      // a card leaves by itself once its moment has passed (or after a good while)
      const age = now - this.lastShown;
      if (age > 40 || (age > 8 && !safe(() => this.shown!.when(x)))) this.hide();
      return;
    }
    const tip = TIPS.find((t) => !this.seen.has(t.id) && safe(() => t.when(x)));
    if (!tip) return;
    // one card at a time, and not right after another unless it matters now
    if (!tip.urgent && now - this.lastShown < 25) return;
    if (isModalOpen() && !tip.urgent) return;
    this.show(tip);
  }

  private show(t: Tip) {
    this.shown = t;
    this.lastShown = performance.now() / 1000;
    this.seen.add(t.id);
    this.save();
    clear(this.el);
    this.el.append(
      h("div.tip-head", null, h("span.tip-icon", null, t.icon), h("b", null, t.title), h("span.tip-count", null, `подсказка ${this.seen.size} из ${TIPS.length}`)),
      ...(mobile && t.touch ? t.touch : t.lines).map((l) => h("p", { html: l })),
      h(
        "div.tip-foot",
        null,
        h("button.small", { onclick: () => ((this.off = true), this.save(), this.hide()) }, "Выключить подсказки"),
        h("button.small.primary", { onclick: () => this.hide() }, "Понятно"),
      ),
    );
    this.el.classList.remove("hidden");
    this.el.classList.remove("in");
    void this.el.offsetWidth;
    this.el.classList.add("in");
  }

  private hide() {
    this.shown = null;
    this.el.classList.add("hidden");
  }
}

function safe(f: () => boolean) {
  try {
    return f();
  } catch {
    return false;
  }
}
