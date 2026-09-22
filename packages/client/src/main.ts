import "./style.css";
import { axis, onKeyDown } from "./input";
import { net } from "./net";
import { WorldRenderer } from "./render/world";
import { toast } from "./ui/dom";
import { Hud } from "./ui/hud";
import { LobbyUI } from "./ui/lobby";
import { showMenu } from "./ui/menu";
import { GameUI } from "./ui/game";
import { installExtras } from "./ui/extras";

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
net.onLeave.add((code) => {
  if (code === 4001) toast("Вы зашли в этот бункер из другой вкладки");
  else toast("Соединение потеряно. Обновите страницу, чтобы вернуться.");
});

// input + prediction run at 20 Hz independently of rendering
let lastInput = performance.now();
setInterval(() => {
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastInput) / 1000);
  lastInput = now;
  if (net.pub && net.pub.phase !== "lobby") {
    const a = game?.inputBlocked() ? { mx: 0, my: 0, run: false } : axis();
    net.sendInput(a.mx, a.my, a.run, dt);
  }
}, 50);

// render loop
let last = performance.now();
function loop(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (net.pred) net.pred.stepT += dt;
  let pred: { x: number; y: number } | null = null;
  if (net.pred) {
    const f = Math.min(1, net.pred.stepT / 0.05);
    pred = { x: net.pred.prevX + (net.pred.x - net.pred.prevX) * f, y: net.pred.prevY + (net.pred.y - net.pred.prevY) * f };
  }
  game?.frame(dt);
  const atTable = game?.table?.frame(dt);
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

// auto-rejoin after reload
const auto = new URLSearchParams(location.search).get("code");
if (auto) {
  net
    .join(auto, localStorage.getItem("bunker.name") ?? "")
    .then(route)
    .catch(() => showMenu(route));
} else showMenu(route);
