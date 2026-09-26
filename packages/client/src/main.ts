import "./style.css";
import { axis, onKeyDown } from "./input";
import { net } from "./net";
import { WorldRenderer } from "./render/world";
import { toast } from "./ui/dom";
import { Hud } from "./ui/hud";
import { LobbyUI } from "./ui/lobby";
import { showJoinByLink, showMenu } from "./ui/menu";
import { GameUI } from "./ui/game";
import { installExtras } from "./ui/extras";
import "./polish.css";
import "./theme.css";
import "./mobile.css";
import { installPwa } from "./pwa";
import { isTelegram, startTelegram } from "./telegram";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const renderer = new WorldRenderer(canvas);
(window as any).__r = renderer;
(window as any).__net = net;
Object.defineProperty(window, "__game", { get: () => game });

let lobby: LobbyUI | null = null;
let hud: Hud | null = null;
let game: GameUI | null = null;
let lobbyKey = "";

function route() {
  const v = net.pub;
  if (!v) return;
  if (v.phase === "lobby") {
    if (!lobby) lobby = new LobbyUI();
    const key = JSON.stringify([v.players, v.settings, net.priv?.cards, net.priv?.pick]);
    if (key !== lobbyKey) {
      lobbyKey = key;
      lobby.render();
    }
  } else {
    if (lobby) {
      lobby.destroy();
      lobby = null;
    }
    if (!hud) hud = new Hud(renderer);
    if (!game) {
      game = new GameUI(renderer, hud);
      installExtras(game);
    }
  }
}

net.onChange.add(() => {
  route();
  if (net.pub) renderer.sync(net.pub, net.priv?.char ?? null);
  game?.onPatch();
});
// a phone locks, the train goes into a tunnel: come back to the same bunker on our own
let rejoining = false;
net.onLeave.add(async (code) => {
  if (code === 4001) return toast("Вы зашли в этот бункер из другой вкладки");
  if (code === 1000 || rejoining || net.leaving) return; // left on purpose
  const room = net.code;
  if (!room) return;
  rejoining = true;
  toast("Связь пропала — переподключаемся…");
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, Math.min(15000, 1000 * 2 ** i)));
    try {
      await net.join(room, net.lastName || localStorage.getItem("bunker.name") || "");
      toast("Снова на связи");
      rejoining = false;
      return;
    } catch {
      /* try again */
    }
  }
  rejoining = false;
  toast("Не удалось вернуться. Обновите страницу.");
});

// input + prediction: fixed 50 ms steps pumped from both the render loop and a timer. A slow frame or a
// starved timer no longer loses walking time (#41): the steps it missed are caught up, up to a quarter second.
const INPUT_STEP = 0.05;
let lastInput = performance.now();
let inputAcc = 0;
function pumpInput(now: number) {
  inputAcc = Math.min(0.25, inputAcc + Math.max(0, (now - lastInput) / 1000));
  lastInput = now;
  while (inputAcc >= INPUT_STEP) {
    inputAcc -= INPUT_STEP;
    if (!net.pub || net.pub.phase === "lobby") continue;
    if (game?.inputBlocked()) game.navigation.cancel();
    const a = game?.inputBlocked() ? { mx: 0, my: 0, run: false } : game?.navigation.input(axis(), INPUT_STEP) ?? axis();
    if (a.mx || a.my) game?.resumeCameraFollow();
    net.sendInput(a.mx, a.my, a.run, INPUT_STEP);
  }
}
setInterval(() => pumpInput(performance.now()), 25);

// render loop
let last = performance.now();
let fpsAcc = 60;
function loop(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  pumpInput(now);
  if (net.pred) net.pred.stepT += dt;
  let pred: { x: number; y: number } | null = null;
  if (net.pred) {
    const f = Math.min(1, net.pred.stepT / 0.05);
    pred = { x: net.pred.prevX + (net.pred.x - net.pred.prevX) * f, y: net.pred.prevY + (net.pred.y - net.pred.prevY) * f };
  }
  game?.frame(dt);
  fpsAcc = fpsAcc * 0.95 + (dt > 0 ? 1 / dt : 60) * 0.05;
  (window as any).__fps = fpsAcc;
  const atSite = game?.pro?.frame(dt) || game?.combat?.frame(dt) || game?.exp?.frame(dt);
  const atTable = atSite || game?.table?.frame(dt);
  if (!atTable) renderer.frame(dt, net.pub, net.priv?.char ?? null, pred);
  hud?.labels.classList.toggle("hidden", !!atTable);
  if (!atTable) hud?.updateLabels(net.priv?.char ?? null, game?.hoverChar ?? null);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

onKeyDown((e) => {
  if (e.code === "KeyF" && !e.ctrlKey) {
    renderer.follow = true;
    return true;
  }
});

// Telegram: straight into the chat's bunker; otherwise the menu (or a rejoin after a reload)
// a reload (or a phone waking the tab up) goes back into the bunker this tab was playing in
// a shared link asks the name first (#39); a reload of this tab rejoins silently
const linkCode = new URLSearchParams(location.search).get("code");
let auto: string | null = null;
try {
  auto = sessionStorage.getItem("bunker.session");
} catch {}
if (new URLSearchParams(location.search).has("code")) {
  const u = new URL(location.href);
  u.searchParams.delete("code");
  history.replaceState(null, "", u.toString());
}
if (isTelegram()) {
  startTelegram(route)
    .then((ok) => ok || showMenu(route))
    .catch((e) => {
      toast(String(e?.message ?? e));
      showMenu(route);
    });
} else if (linkCode && linkCode.toUpperCase() !== auto?.toUpperCase()) {
  showJoinByLink(linkCode, route);
} else if (auto || linkCode) {
  auto ||= linkCode!;
  net
    .join(auto, localStorage.getItem("bunker.name") ?? "")
    .then(route)
    .catch(() => showMenu(route));
} else showMenu(route);

installPwa();
