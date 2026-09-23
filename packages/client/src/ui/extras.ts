import type { Fx } from "@bunker/shared";
import { audio } from "../audio/audio";
import { net } from "../net";
import { GameUI } from "./game";
import { CLIENT_SCREENS } from "./prompt";
import { DayVoteUI, InstrumentUI, RadioUI } from "./radio";
import { TableUI } from "./tableui";
import { CombatUI } from "./combat";
import { openDebug } from "./debug";
import { ExpeditionUI } from "./expedition";
import { openBoard, openBooks, openCanvas, openCharacter, openClipping, openCook, openCraft, openPeriscope, openSettings } from "./screens";

/** Hooks the 5b screens (radio, instruments, board, papers…) into the game UI. */
export function installExtras(game: GameUI) {
  const table = new TableUI(game.r);
  game.table = table;
  const combat = new CombatUI(game.r);
  game.combat = combat;
  const exp = new ExpeditionUI(game.r);
  game.exp = exp;
  const radio = new RadioUI();
  const instr = new InstrumentUI();
  const dayVote = new DayVoteUI();

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
  });

  // click a character to inspect
  game.r.renderer.domElement.addEventListener("click", (e) => {
    if (game.build.active || e.button !== 0) return;
    if (game.hoverChar) openCharacter(game.hoverChar);
  });

  const saved = localStorage.getItem("bunker.shadows");
  if (saved !== null) game.r.shadows = saved === "1";
}
