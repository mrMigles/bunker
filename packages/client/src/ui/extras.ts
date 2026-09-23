import type { Fx } from "@bunker/shared";
import { audio } from "../audio/audio";
import { net } from "../net";
import { GameUI } from "./game";
import { CLIENT_SCREENS } from "./prompt";
import { DayVoteUI, InstrumentUI, RadioUI } from "./radio";
import { TableUI } from "./tableui";
import { ObjectivesUI } from "./objectives";
import { CombatUI } from "./combat";
import { openDebug } from "./debug";
import { ExpeditionUI } from "./expedition";
import { PrologueUI } from "./prologue";
import { EndingUI, openCraftItem, openResearch } from "./tech";
import { openBoard, openBooks, openCanvas, openCharacter, openClipping, openCook, openCraft, openPeriscope, openSettings } from "./screens";
import { h, ui, modal, toast } from "./dom";

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
  const crew = () => modal("Жильцы убежища", h("div.crew-list", null, Object.values(net.pub?.chars ?? {}).map((c: any) =>
    h("button.crew-entry", { onclick: () => openCharacter(c.id) }, h("span", null, c.card.name), h("small.dim", null, c.status === "away" ? "В вылазке" : c.status === "dead" ? "Погиб" : `Здоровье ${Math.round(c.needs.health)} · Бодрость ${Math.round(c.needs.energy)}`)))));
  const toolbar = h("nav.game-toolbar", { "aria-label": "Меню игры" },
    h("button", { onclick: travel, title: "Карта и подготовка вылазки" }, "◫", h("small", null, "Карта")),
    h("button", { onclick: crew, title: "Жильцы убежища" }, "♟", h("small", null, "Отряд")),
    h("button", { onclick: () => openSettings(game.r), title: "Настройки" }, "⚙", h("small", null, "Меню")));
  const dock = h("nav.game-dock", { "aria-label": "Действия в бункере" },
    h("button", { onclick: () => openBoard() }, "▣", h("span", null, "Инвентарь")),
    h("button", { onclick: () => { game.navigation.cancel(); game.build.toggle(); } }, "⚒", h("span", null, "Строить")),
    h("button", { onclick: travel }, "↗", h("span", null, "Вылазка")),
    h("button", { onclick: () => game.setAquarium(!game.aquarium) }, "◉", h("span", null, "Наблюдать")),
    h("button", { onclick: () => { game.chatWrap.classList.remove("hidden"); game.chatBox.focus(); } }, "…", h("span", null, "Чат")));
  ui().append(toolbar, dock);
  GameUI.extraKeysUp.push((e) => pro.handleKey(e, false));
  const radio = new RadioUI();
  const instr = new InstrumentUI();
  const dayVote = new DayVoteUI();

  const ending = new EndingUI();
  const objectives = new ObjectivesUI(game);
  CLIENT_SCREENS.research = (a) => (openResearch(a), true);
  CLIENT_SCREENS.craft_item = (a) => (openCraftItem(a), true);
  CLIENT_SCREENS.cook = (a) => (openCook(a), true);
  CLIENT_SCREENS.craft = (a) => (openCraft(a), true);
  CLIENT_SCREENS.board = () => (openBoard(), true);
  CLIENT_SCREENS.draw = (a) => {
    net.send({ k: "do", a: a.a, tt: a.t.type, t: a.t.id });
    openCanvas();
    return true;
  };

  net.onFx.add((f: Fx) => {
    if (f.k === "news" && (!f.to || f.to === net.priv?.pid)) {
      if (f.id === "books") openBooks();
      else if (f.id === "periscope") openPeriscope(f.data);
      else if (f.id) openClipping(f.id);
    } else if (f.k === "sound" && f.id) {
      const me = net.myChar();
      let vol = 1;
      if (f.x !== undefined && f.lv !== undefined && me) {
        const d = Math.abs(me.x - f.x) + Math.abs(me.lv - f.lv) * 5;
        vol = Math.max(0.15, 1 - d / 30);
      }
      audio.sfx(f.id, vol);
    } else if (f.k === "toast") audio.sfx("blip", 0.6);
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
    radio.frame();
    instr.frame();
    const v = net.pub;
    if (v) audio.setAmbient(Math.min(1, v.power.gen / 1.5));
  });
  GameUI.extraPatch.push(() => {
    dayVote.update();
    table.update();
    combat.update();
    exp.update();
    pro.update();
    ending.update();
    objectives.update();
  });

  // click a character to inspect
  game.r.renderer.domElement.addEventListener("click", (e) => {
    if (game.build.active || e.button !== 0 || pro.active || exp.mode !== "none" || combat.active || table.active) return;
    if (game.hoverChar) openCharacter(game.hoverChar);
  });

  const saved = localStorage.getItem("bunker.shadows");
  if (saved !== null) game.r.shadows = saved === "1";
}
