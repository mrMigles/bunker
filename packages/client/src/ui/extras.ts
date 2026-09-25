import { updateRestartBanner } from "./restart";
import { avatar, ownerOf } from "./avatar";
import { portrait } from "../render/portrait";
import { PROFS } from "@bunker/shared";
import type { Fx } from "@bunker/shared";
import { audio } from "../audio/audio";
import { net } from "../net";
import { GameUI } from "./game";
import { CLIENT_SCREENS } from "./prompt";
import { openIntercom } from "./intercom";
import { openTalk } from "./talk";
import { openCharacterScreen } from "./character";
import { MinigameUI } from "./minigame";
import { TipsUI } from "./tips";
import { DayVoteUI, InstrumentUI, RadioUI } from "./radio";
import { TableUI } from "./tableui";
import { ObjectivesUI } from "./objectives";
import { maybeOpenPerkChoice } from "./hud";
import { CombatUI } from "./combat";
import { openDebug } from "./debug";
import { ExpeditionUI } from "./expedition";
import { PrologueUI } from "./prologue";
import { EndingUI, openCraftItem, openResearch } from "./tech";
import { openBoard, openBooks, openCanvas, openCharacter, openClipping, openCook, openCraft, openPeriscope, openSettings } from "./screens";
import { bar, h, ui, modal, toast } from "./dom";
import { installTouch } from "../touch";
import { postfx } from "../render/postfx";
import { NEED_IC, cic, icon } from "./icons";
import { art, portraitTile } from "./art";

/** Hooks the 5b screens (radio, instruments, board, papers…) into the game UI. */
export function installExtras(game: GameUI) {
  const table = new TableUI(game.r);
  game.table = table;
  const combat = new CombatUI(game.r);
  game.combat = combat;
  const exp = new ExpeditionUI(game.r);
  game.exp = exp;
  const pro = new PrologueUI(game.r);
  game.pro = pro;
  pro.onNavigate = (x, lv, done) => game.navigation.go(x, lv, done);
  exp.onNavigate = (x, lv) => game.navigation.go(x, lv);
  const travel = () => {
    if (exp.e?.stage === "prep") { exp.openPrep(); return; }
    if (exp.inSquad()) return;
    const terminal = Object.values(net.pub?.objs ?? {}).find((o: any) => o.kind === "sortie_terminal") as any;
    if (!terminal || net.pub?.phase !== "day") { toast("Вылазки доступны днём, из бункера."); return; }
    game.navigation.go(terminal.x + .5, terminal.lv, () => net.send({ k: "do", a: "sortie", tt: "obj", t: terminal.id }));
    toast("Идём к карте у шлюза…");
  };
  const crew = () =>
    modal(
      "Жильцы убежища",
      h(
        "div.crew-list",
        null,
        Object.values(net.pub?.chars ?? {}).map((c: any) => {
          const player = c.ctrl ? net.pub?.players[c.ctrl] : null;
          const owner = player ?? ownerOf(net.pub, c.id);
          const state = c.status === "away" ? "на вылазке" : c.status === "dead" ? "погиб" : c.status === "down" ? "без сознания" : c.task?.action ? "занят делом" : "свободен";
          const mini = (k: string) => h("span.crew-need", { title: k }, cic(NEED_IC, k), bar(c.needs[k]));
          return h(
            "button.crew-entry" + (c.status === "dead" ? ".dead" : ""),
            { onclick: () => openCharacter(c.id) },
            portrait(c.id, c.card, "crew-portrait", () => art(portraitTile(c.card.prof, c.card.gender))),
            h(
              "span.crew-main",
              null,
              h("b", null, owner ? avatar(owner.id, owner.name, owner.color, 16, !player) : null, c.card.name),
              h("small", null, `${PROFS[c.card.prof]?.name ?? ""} · ур. ${c.level ?? 1} · `, player ? h("span.warn", null, player.name === c.card.name ? "игрок" : player.name) : owner ? h("span.dim", null, `${owner.name} не в сети — играет бот`) : h("span.dim", null, "бот"), ` · ${state}`),
            ),
            h("span.crew-needs", null, mini("health"), mini("food"), mini("energy"), mini("sanity")),
            icon("chevronRight"),
          );
        }),
      ),
      { icon: "users" },
    );
  const toolbar = h("nav.game-toolbar", { "aria-label": "Меню игры" },
    h("button", { onclick: travel, title: "Карта и подготовка вылазки" }, icon("map"), h("small", null, "Карта")),
    h("button", { onclick: crew, title: "Жильцы убежища" }, icon("users"), h("small", null, "Отряд")),
    h("button", { onclick: () => openSettings(game.r), title: "Меню: настройки, выход" }, icon("menu"), h("small", null, "Меню")));
  const dock = h("nav.game-dock", { "aria-label": "Действия в бункере" },
    h("button", { onclick: () => openCharacterScreen(), title: "Персонаж: снаряжение, вещи спутников, прокачка (I)" }, icon("user"), h("span", null, "Персонаж")),
    h("button", { onclick: () => openBoard(), title: "Убежище: склад, дела, газета, рецепты (Tab)" }, icon("box"), h("span", null, "Убежище")),
    h("button.journal-dock-button", { onclick: () => game.hud.openJournal(), title: "Журнал событий" }, icon("journal"), h("span", null, "Журнал")),
    h("button", { onclick: () => { game.navigation.cancel(); game.build.toggle(); }, title: "Стройка (B)" }, icon("hammer"), h("span", null, "Строить")),
    h("button", { onclick: travel, title: "Вылазка" }, icon("backpack"), h("span", null, "Вылазка")),
    h("button", { onclick: () => game.setAquarium(!game.aquarium), title: "Отдать персонажа боту и смотреть (H)" }, icon("eye"), h("span", null, "Наблюдать")),
    h("button", { onclick: () => { game.chatWrap.classList.remove("hidden"); game.chatBox.focus(); }, title: "Чат (Enter)" }, icon("chat"), h("span", null, "Чат")));
  ui().append(toolbar, dock);
  (window as any).__openCharacter = () => openCharacterScreen();
  installTouch(game as any);
  GameUI.extraKeysUp.push((e) => pro.handleKey(e, false));
  GameUI.extraKeysUp.push((e) => exp.mode === "site" && exp.handleKeyUp(e));
  const radio = new RadioUI();
  const instr = new InstrumentUI();
  const dayVote = new DayVoteUI();

  const ending = new EndingUI();
  const objectives = new ObjectivesUI(game);
  const minigame = new MinigameUI();
  const tips = new TipsUI();
  (window as any).__tips = tips;
  (window as any).__mini = minigame;
  CLIENT_SCREENS.research = (a) => (openResearch(a), true);
  CLIENT_SCREENS.craft_item = (a) => (openCraftItem(a), true);
  CLIENT_SCREENS.cook = (a) => (openCook(a), true);
  CLIENT_SCREENS.craft = (a) => (openCraft(a), true);
  CLIENT_SCREENS.board = () => (openBoard(), true);
  CLIENT_SCREENS.carry_to_store = () => {
    // walk the armful to the nearest shelf and put it away
    const me = net.myChar();
    const v = net.pub;
    if (!me || !v) return true;
    const shelves = Object.values(v.objs as Record<string, any>).filter((o) => o.kind === "shelf");
    const best = shelves.sort((a, b) => Math.abs(a.lv - me.lv) * 20 + Math.abs(a.x - me.x) - (Math.abs(b.lv - me.lv) * 20 + Math.abs(b.x - me.x)))[0];
    if (!best) {
      toast("Нет стеллажа — постройте Кладовую");
      return true;
    }
    game.navigation.go(best.x + 0.5, best.lv, () => net.send({ k: "do", a: "deposit", tt: "obj", t: best.id }));
    return true;
  };
  CLIENT_SCREENS.draw = (a) => {
    net.send({ k: "do", a: a.a, tt: a.t.type, t: a.t.id });
    openCanvas();
    return true;
  };

  net.onFx.add((f: Fx) => {
    if (f.k === "news" && (!f.to || f.to === net.priv?.pid)) {
      if (f.id === "books") openBooks();
      else if (f.id === "intercom") openIntercom();
      else if (f.id === "talk_res") openTalk(String((f.data as any)?.char ?? ""));
      else if (f.id === "periscope") openPeriscope(f.data);
      else if (f.id) openClipping(f.id);
    } else if (f.k === "sound" && f.id) {
      const me = net.myChar();
      let vol = 1;
      if (f.x !== undefined && f.lv !== undefined && me) {
        const d = Math.abs(me.x - f.x) + Math.abs(me.lv - f.lv) * 5;
        vol = Math.max(0.15, 1 - d / 30);
      }
      audio.sfx(f.id, vol * (typeof f.data === "number" ? f.data : 1));
    } else if (f.k === "rats") game.r.rats(f.x ?? 0, f.lv ?? 0, (f.data as any)?.w ?? 4, (f.data as any)?.n ?? 3, (f.data as any)?.dir ?? 1);
    else if (f.k === "flicker") game.r.flicker = Number(f.data ?? 1.5);
    else if (f.k === "dust") game.r.dustFall();
    else if (f.k === "toast") audio.sfx("blip", 0.6);
    else if (f.k === "flash") audio.sfx("boom");
  });

  GameUI.extraKeys.push((e) => {
    if (e.code === "Backquote" && import.meta.env.DEV) {
      openDebug(() => (window as any).__fps ?? 0);
      return true;
    }
    if (combat.active) {
      if (e.code === "Enter" || e.code === "Space") {
        combat.sync(true);
        return true;
      }
      if (e.code === "Escape") {
        combat.mode = null;
        return true;
      }
      if (e.code === "Backspace") {
        combat.plan.pop();
        combat.sync(false);
        return true;
      }
      return e.code !== "KeyC";
    }
    if (pro.active) return pro.handleKey(e, true);
    if (exp.mode !== "none" && exp.handleKey(e)) return true;
    if (table.active && e.code === "Escape") {
      table.leave();
      return true;
    }
    if (e.code === "KeyG") {
      table.toggleSpectate();
      return true;
    }
    if (table.active) return e.code !== "KeyC" && e.code !== "Enter";
    if (instr.handleKey(e)) return true;
    if (e.code === "KeyO") {
      openSettings(game.r);
      return true;
    }
    if (e.code === "Tab") {
      openBoard();
      return true;
    }
    if (e.code === "KeyI") {
      openCharacterScreen();
      return true;
    }
    return false;
  });

  // one body class per full-screen mode, so bunker panels step aside instead of overlapping
  let lastMode = "";
  GameUI.extraFrame.push(() => {
    const mode = pro.active ? "prologue" : combat.active ? "combat" : exp.mode === "site" ? "site" : exp.mode === "map" ? "map" : table.active ? "table" : game.build.active ? "build" : "bunker";
    if (mode !== lastMode) {
      document.body.classList.remove("mode-" + lastMode);
      document.body.classList.add("mode-" + mode);
      lastMode = mode;
    }
  });
  GameUI.extraFrame.push(() => {
    // a red edge on the picture when it is bad: a fight, my survivor down or near the end
    const v0 = net.pub;
    const me = net.myChar();
    postfx(game.r.renderer).danger = !v0 ? 0 : Math.min(1, (v0.mods.combat?.active ? 0.3 : 0) + (me?.status === "down" ? 0.7 : me && me.needs.health < 25 ? 0.45 : 0));
    radio.frame();
    instr.frame();
    const v = net.pub;
    if (v) audio.setAmbient(Math.min(1, v.power.gen / 1.5));
    // background music follows what is on screen
    const act = document.body.dataset.activity;
    audio.soundtrack.setMood(!v || v.phase === "lobby" ? "bunker" : v.phase === "ending" ? "night" : act === "combat" ? "combat" : act === "expedition" || v.phase === "prologue" ? "sortie" : v.phase === "night" ? "night" : "bunker");
  });
  GameUI.extraPatch.push(() => {
    updateRestartBanner();
    dayVote.update();
    table.update();
    combat.update();
    exp.update();
    pro.update();
    ending.update();
    objectives.update();
    minigame.update();
    tips.update();
    maybeOpenPerkChoice();
  });

  // click a character to inspect
  game.r.renderer.domElement.addEventListener("click", (e) => {
    if (game.build.active || e.button !== 0 || pro.active || exp.mode !== "none" || combat.active || table.active) return;
    if (game.hoverChar) openCharacter(game.hoverChar);
  });

  const saved = localStorage.getItem("bunker.shadows");
  if (saved !== null) game.r.shadows = saved === "1";
}
