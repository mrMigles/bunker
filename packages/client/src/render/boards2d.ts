import { KEG_NAMES, MAFIA_ROLE_NAMES, cardLabel, rankLabel } from "@bunker/shared";

/** Size of the board texture drawn on the table surface. */
export const BOARD_PX = 1024;

export interface BoardCtx {
  me: string | null;
  names: Record<string, string>;
  colors: Record<string, string>;
  sel: number | null;
  hints: number[];
  keep: boolean[];
}

const INK = "#2a211a";
const PAPER = "#e9dcc0";
const WARM = "#e8a23a";

function bg(g: CanvasRenderingContext2D, color = "rgba(0,0,0,0)") {
  g.clearRect(0, 0, BOARD_PX, BOARD_PX);
  g.fillStyle = color;
  g.fillRect(0, 0, BOARD_PX, BOARD_PX);
}

function text(g: CanvasRenderingContext2D, s: string, x: number, y: number, size = 28, color = PAPER, align: CanvasTextAlign = "center", bold = false) {
  g.font = `${bold ? "bold " : ""}${size}px 'PT Serif', Georgia, serif`;
  g.fillStyle = color;
  g.textAlign = align;
  g.textBaseline = "middle";
  g.fillText(s, x, y);
}

function rrect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// ---------------------------------------------------------------- 8×8 boards

const SQ = 112,
  OFF = (BOARD_PX - SQ * 8) / 2;

export function boardFlipped(view: any, me: string | null) {
  return !!me && view.players?.[1] === me;
}

function sqXY(i: number, flip: boolean) {
  let r = Math.floor(i / 8),
    c = i % 8;
  if (flip) (r = 7 - r), (c = 7 - c);
  return [OFF + c * SQ, OFF + r * SQ];
}

const GLYPH: Record<string, string> = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };

function drawGrid(g: CanvasRenderingContext2D, view: any, ctx: BoardCtx) {
  const flip = boardFlipped(view, ctx.me);
  g.fillStyle = "#3b2414";
  g.fillRect(OFF - 24, OFF - 24, SQ * 8 + 48, SQ * 8 + 48);
  for (let i = 0; i < 64; i++) {
    const [x, y] = sqXY(i, flip);
    const dark = (Math.floor(i / 8) + (i % 8)) % 2 === 1;
    g.fillStyle = dark ? "#6e4a2a" : "#d9bf91";
    g.fillRect(x, y, SQ, SQ);
    const last: number[] = view.last ?? [];
    if (last.includes(i)) {
      g.fillStyle = "rgba(232,162,58,0.35)";
      g.fillRect(x, y, SQ, SQ);
    }
    if (ctx.sel === i) {
      g.strokeStyle = "#ffd070";
      g.lineWidth = 8;
      g.strokeRect(x + 4, y + 4, SQ - 8, SQ - 8);
    }
    if (ctx.hints.includes(i)) {
      g.fillStyle = "rgba(120,220,120,0.55)";
      g.beginPath();
      g.arc(x + SQ / 2, y + SQ / 2, 16, 0, Math.PI * 2);
      g.fill();
    }
  }
  // coordinates
  for (let k = 0; k < 8; k++) {
    const file = "abcdefgh"[flip ? 7 - k : k];
    const rank = String(flip ? k + 1 : 8 - k);
    text(g, file, OFF + k * SQ + SQ / 2, OFF + SQ * 8 + 12, 18, "#d9bf91");
    text(g, rank, OFF - 12, OFF + k * SQ + SQ / 2, 18, "#d9bf91");
  }
  return flip;
}

function drawChess(g: CanvasRenderingContext2D, view: any, ctx: BoardCtx) {
  const flip = drawGrid(g, view, ctx);
  const kingInCheck = view.check ? view.board.indexOf(view.turn === view.players[0] ? "K" : "k") : -1;
  for (let i = 0; i < 64; i++) {
    const x = view.board[i];
    if (x === ".") continue;
    const [px, py] = sqXY(i, flip);
    if (i === kingInCheck) {
      g.fillStyle = "rgba(220,40,30,0.5)";
      g.fillRect(px, py, SQ, SQ);
    }
    const white = x === x.toUpperCase();
    g.font = "92px 'Segoe UI Symbol','DejaVu Sans',serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 5;
    g.strokeStyle = white ? "#2a1a10" : "#e9dcc0";
    g.strokeText(GLYPH[x.toLowerCase()], px + SQ / 2, py + SQ / 2 + 6);
    g.fillStyle = white ? "#f6efe0" : "#1c1410";
    g.fillText(GLYPH[x.toLowerCase()], px + SQ / 2, py + SQ / 2 + 6);
  }
}

function drawCheckers(g: CanvasRenderingContext2D, view: any, ctx: BoardCtx) {
  const flip = drawGrid(g, view, ctx);
  for (let i = 0; i < 64; i++) {
    const x = view.board[i];
    if (x === ".") continue;
    const [px, py] = sqXY(i, flip);
    const white = x === "w" || x === "W";
    for (let k = 0; k < (x === "W" || x === "B" ? 2 : 1); k++) {
      g.fillStyle = "rgba(0,0,0,0.4)";
      g.beginPath();
      g.arc(px + SQ / 2 + 3, py + SQ / 2 + 5 - k * 10, 40, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = white ? "#efe4cc" : "#3a2418";
      g.beginPath();
      g.arc(px + SQ / 2, py + SQ / 2 - k * 10, 40, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = white ? "#b8a07a" : "#7a4a2a";
      g.lineWidth = 4;
      g.beginPath();
      g.arc(px + SQ / 2, py + SQ / 2 - k * 10, 28, 0, Math.PI * 2);
      g.stroke();
    }
    if (x === "W" || x === "B") text(g, "♛", px + SQ / 2, py + SQ / 2 - 10, 36, WARM);
  }
}

export function hitSquare(view: any, ctx: BoardCtx, px: number, py: number): number | null {
  const c = Math.floor((px - OFF) / SQ),
    r = Math.floor((py - OFF) / SQ);
  if (c < 0 || c > 7 || r < 0 || r > 7) return null;
  const flip = boardFlipped(view, ctx.me);
  return flip ? (7 - r) * 8 + (7 - c) : r * 8 + c;
}

// ---------------------------------------------------------------- nardy

const NW = 70,
  NX0 = 72;

/** screen rect of an absolute point: 0..11 bottom right→left, 12..23 top left→right */
function pointRect(i: number) {
  const bottom = i < 12;
  const k = bottom ? 11 - i : i - 12;
  const x = NX0 + k * NW + (k >= 6 ? 40 : 0);
  return { x, bottom, y0: bottom ? 930 : 94, dir: bottom ? -1 : 1 };
}

function drawNardy(g: CanvasRenderingContext2D, view: any, ctx: BoardCtx) {
  g.fillStyle = "#4a2c16";
  rrect(g, 40, 60, 944, 904, 20);
  g.fill();
  g.fillStyle = "#c9a36a";
  g.fillRect(64, 84, 434, 856);
  g.fillRect(526, 84, 434, 856);
  for (let i = 0; i < 24; i++) {
    const r = pointRect(i);
    g.fillStyle = ctx.hints.includes(i) ? "#5aa05a" : i % 2 ? "#7a3a22" : "#2e3a2a";
    g.beginPath();
    g.moveTo(r.x + 4, r.y0);
    g.lineTo(r.x + NW - 4, r.y0);
    g.lineTo(r.x + NW / 2, r.y0 + r.dir * 360);
    g.closePath();
    g.fill();
    if (ctx.sel === i) {
      g.strokeStyle = "#ffd070";
      g.lineWidth = 6;
      g.stroke();
    }
    text(g, String(i + 1), r.x + NW / 2, r.bottom ? 950 : 74, 16, "#e9dcc0");
    const n = view.board[i];
    const cnt = Math.abs(n);
    for (let k = 0; k < cnt; k++) {
      const stackK = Math.min(k, 7);
      const cy = r.y0 + r.dir * (32 + stackK * 44);
      g.fillStyle = n > 0 ? "#f1e6cf" : "#221812";
      g.strokeStyle = n > 0 ? "#8a7050" : "#8a6040";
      g.lineWidth = 3;
      g.beginPath();
      g.arc(r.x + NW / 2, cy, 30, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      if (k === 7 && cnt > 8) text(g, String(cnt), r.x + NW / 2, cy, 26, n > 0 ? INK : PAPER, "center", true);
      if (k >= 7) break;
    }
  }
  // dice & off
  const dice: number[] = view.dice ?? [];
  dice.forEach((d, i) => drawDie(g, 430 + i * 90, 470, 76, d, false));
  const [w, b] = view.players;
  text(g, `⚪ ${ctx.names[w] ?? w}: выброшено ${view.off[w]}`, 70, 30, 26, PAPER, "left");
  text(g, `⚫ ${ctx.names[b] ?? b}: выброшено ${view.off[b]}`, 960, 30, 26, PAPER, "right");
}

export function hitPoint(px: number, py: number): number | null {
  for (let i = 0; i < 24; i++) {
    const r = pointRect(i);
    if (px < r.x || px > r.x + NW) continue;
    if (r.bottom ? py > 540 && py < 960 : py > 64 && py < 480) return i;
  }
  return null;
}

// ---------------------------------------------------------------- dice

const PIPS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [
    [0.25, 0.25],
    [0.75, 0.75],
  ],
  3: [
    [0.25, 0.25],
    [0.5, 0.5],
    [0.75, 0.75],
  ],
  4: [
    [0.25, 0.25],
    [0.75, 0.25],
    [0.25, 0.75],
    [0.75, 0.75],
  ],
  5: [
    [0.25, 0.25],
    [0.75, 0.25],
    [0.5, 0.5],
    [0.25, 0.75],
    [0.75, 0.75],
  ],
  6: [
    [0.25, 0.22],
    [0.75, 0.22],
    [0.25, 0.5],
    [0.75, 0.5],
    [0.25, 0.78],
    [0.75, 0.78],
  ],
};

function drawDie(g: CanvasRenderingContext2D, x: number, y: number, s: number, v: number, held: boolean) {
  g.fillStyle = "rgba(0,0,0,0.35)";
  rrect(g, x + 5, y + 7, s, s, s * 0.16);
  g.fill();
  g.fillStyle = held ? "#f3d27a" : "#f4ecd8";
  rrect(g, x, y, s, s, s * 0.16);
  g.fill();
  g.strokeStyle = held ? WARM : "#9a8a6a";
  g.lineWidth = held ? 6 : 3;
  g.stroke();
  g.fillStyle = "#2a1a12";
  for (const [px, py] of PIPS[v] ?? []) {
    g.beginPath();
    g.arc(x + px * s, y + py * s, s * 0.09, 0, Math.PI * 2);
    g.fill();
  }
}

const GDIE = { x0: 222, y: 170, s: 110, gap: 20 };

function drawGenerala(g: CanvasRenderingContext2D, view: any, ctx: BoardCtx) {
  view.dice.forEach((d: number, i: number) => {
    if (d) drawDie(g, GDIE.x0 + i * (GDIE.s + GDIE.gap), GDIE.y, GDIE.s, d, !!ctx.keep[i]);
  });
  text(g, view.rolls ? `Бросок ${view.rolls}/3${view.rolls < 3 ? " — щёлкните кубики, которые оставить" : ""}` : `Ход: ${ctx.names[view.turn] ?? ""}`, 512, 120, 28, PAPER);
  // score sheet
  const ps: string[] = view.players;
  const x0 = 180,
    y0 = 340,
    cw = Math.min(120, 660 / ps.length),
    rh = 46;
  g.fillStyle = "rgba(233,220,192,0.92)";
  g.fillRect(x0 - 150, y0 - 40, 150 + cw * ps.length + 20, rh * (view.cats.length + 1) + 50);
  ps.forEach((p, j) => text(g, (ctx.names[p] ?? p).slice(0, 7), x0 + j * cw + cw / 2, y0 - 12, 22, p === view.turn ? "#a0521a" : INK, "center", true));
  view.cats.forEach(([c, name]: [string, string], i: number) => {
    const y = y0 + 20 + i * rh;
    text(g, name, x0 - 140, y, 24, INK, "left");
    ps.forEach((p, j) => {
      const v = view.sheet[p][c];
      text(g, v === undefined ? "·" : String(v), x0 + j * cw + cw / 2, y, 24, v === 0 ? "#8a2a1a" : INK);
    });
  });
  const y = y0 + 20 + view.cats.length * rh;
  text(g, "Итого", x0 - 140, y, 24, INK, "left", true);
  ps.forEach((p, j) => text(g, String(view.totals[p]), x0 + j * cw + cw / 2, y, 26, INK, "center", true));
}

export function hitDie(px: number, py: number): number | null {
  if (py < GDIE.y || py > GDIE.y + GDIE.s) return null;
  for (let i = 0; i < 5; i++) {
    const x = GDIE.x0 + i * (GDIE.s + GDIE.gap);
    if (px >= x && px <= x + GDIE.s) return i;
  }
  return null;
}

// ---------------------------------------------------------------- domino

function drawTile(g: CanvasRenderingContext2D, x: number, y: number, a: number, b: number, s: number, vertical: boolean) {
  const w = vertical ? s : s * 2,
    h = vertical ? s * 2 : s;
  g.fillStyle = "rgba(0,0,0,0.35)";
  rrect(g, x + 3, y + 4, w, h, 8);
  g.fill();
  g.fillStyle = "#f4ecd8";
  rrect(g, x, y, w, h, 8);
  g.fill();
  g.strokeStyle = "#8a7a5a";
  g.lineWidth = 2;
  g.stroke();
  g.beginPath();
  if (vertical) g.moveTo(x + 6, y + s), g.lineTo(x + w - 6, y + s);
  else g.moveTo(x + s, y + 6), g.lineTo(x + s, y + h - 6);
  g.stroke();
  const half = (v: number, hx: number, hy: number) => {
    g.fillStyle = "#1c1410";
    const pts = v === 0 ? [] : v === 6 ? PIPS[6] : PIPS[v];
    for (const [px, py] of pts) {
      g.beginPath();
      g.arc(hx + px * s, hy + py * s, s * 0.08, 0, Math.PI * 2);
      g.fill();
    }
  };
  half(a, x, y);
  if (vertical) half(b, x, y + s);
  else half(b, x + s, y);
}

function drawDomino(g: CanvasRenderingContext2D, view: any, ctx: BoardCtx) {
  const line: [number, number][] = view.line;
  const s = 44;
  // snake the line through rows
  const perRow = 9;
  line.forEach((t, i) => {
    const row = Math.floor(i / perRow);
    let k = i % perRow;
    if (row % 2) k = perRow - 1 - k;
    const x = 110 + k * (s * 2 + 4);
    const y = 180 + row * (s + 30);
    if (row % 2) drawTile(g, x, y, t[1], t[0], s, false);
    else drawTile(g, x, y, t[0], t[1], s, false);
  });
  text(g, `Базар: ${view.bazaar} · ходит ${ctx.names[view.turn] ?? ""}`, 512, 110, 28, PAPER);
  const mine = ctx.me ? view.hands[ctx.me] : null;
  if (Array.isArray(mine)) {
    mine.forEach((t: [number, number], i: number) => drawTile(g, 512 - (mine.length * 58) / 2 + i * 58, 760, t[0], t[1], 48, true));
  }
  // opponents' tile counts
  view.players
    .filter((p: string) => p !== ctx.me)
    .forEach((p: string, i: number) => {
      const h = view.hands[p];
      text(g, `${ctx.names[p] ?? p}: ${Array.isArray(h) ? h.map((t: number[]) => t.join("|")).join(" ") : h + " костей"}`, 512, 620 + i * 36, 24, PAPER);
    });
}

// ---------------------------------------------------------------- lotto

function drawLotto(g: CanvasRenderingContext2D, view: any, ctx: BoardCtx) {
  const drawn = new Set<number>(view.drawn);
  const ps: string[] = view.players;
  const cw = 460,
    ch = 170;
  ps.forEach((p, i) => {
    const x = 40 + (i % 2) * (cw + 24),
      y = 250 + Math.floor(i / 2) * (ch + 40);
    g.fillStyle = p === ctx.me ? "#f1e4c4" : "#d9c9a4";
    g.fillRect(x, y, cw, ch);
    g.strokeStyle = ctx.colors[p] ?? "#8a7a5a";
    g.lineWidth = 5;
    g.strokeRect(x, y, cw, ch);
    text(g, ctx.names[p] ?? p, x + 8, y - 16, 22, PAPER, "left", true);
    const rows: number[][] = view.cards[p];
    rows.forEach((row, r) => {
      for (const n of row) {
        const col = n === 90 ? 8 : Math.floor(n / 10);
        const cx = x + 8 + col * 49 + 22,
          cy = y + 12 + r * 52 + 24;
        text(g, String(n), cx, cy, 26, INK, "center", true);
        if (drawn.has(n)) {
          g.fillStyle = "rgba(160,40,30,0.55)";
          g.beginPath();
          g.arc(cx, cy, 22, 0, Math.PI * 2);
          g.fill();
        }
      }
    });
  });
  if (view.last) {
    g.fillStyle = "#7a4a22";
    g.beginPath();
    g.ellipse(512, 120, 70, 84, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#e9d2a0";
    g.beginPath();
    g.ellipse(512, 120, 54, 54, 0, 0, Math.PI * 2);
    g.fill();
    text(g, String(view.last), 512, 122, 56, INK, "center", true);
    if (view.lastName) text(g, `«${view.lastName}»`, 512, 222, 30, WARM);
  }
  text(g, `Бочонков: ${view.drawn.length}/90`, 60, 60, 24, PAPER, "left");
}

// ---------------------------------------------------------------- magnate

function magnateCell(i: number) {
  // 6×6 perimeter = 20 cells, clockwise from bottom-right corner
  const S = 150,
    x0 = 62,
    y0 = 62;
  let c: number, r: number;
  if (i <= 5) (c = 5 - i), (r = 5);
  else if (i <= 10) (c = 0), (r = 5 - (i - 5));
  else if (i <= 15) (c = i - 10), (r = 0);
  else (c = 5), (r = i - 15);
  return { x: x0 + c * S, y: y0 + r * S, s: S };
}

function drawMagnate(g: CanvasRenderingContext2D, view: any, ctx: BoardCtx) {
  const board = view.board as { name: string; kind: string; price?: number; group?: number }[];
  const GROUPS = ["#8a5a3a", "#6a8ab0", "#7aa05a", "#c08a3a", "#b04a3a", "#8a4ab0"];
  board.forEach((c, i) => {
    const r = magnateCell(i);
    g.fillStyle = "#e9dcc0";
    g.fillRect(r.x + 2, r.y + 2, r.s - 4, r.s - 4);
    if (c.group !== undefined) {
      g.fillStyle = GROUPS[c.group];
      g.fillRect(r.x + 2, r.y + 2, r.s - 4, 26);
    }
    const own = view.owner[i];
    if (own) {
      g.strokeStyle = ctx.colors[own] ?? "#000";
      g.lineWidth = 8;
      g.strokeRect(r.x + 6, r.y + 6, r.s - 12, r.s - 12);
    }
    const words = c.name.split(" ");
    words.forEach((w, k) => text(g, w, r.x + r.s / 2, r.y + 50 + k * 24, 20, INK, "center", true));
    if (c.price) text(g, `${c.price}`, r.x + r.s / 2, r.y + r.s - 22, 20, "#5a4a3a");
    for (let k = 0; k < (view.level[i] ?? 0); k++) text(g, "▲", r.x + 20 + k * 22, r.y + r.s - 44, 20, "#a0521a");
  });
  view.players.forEach((p: string, k: number) => {
    if (view.bankrupt.includes(p)) return;
    const r = magnateCell(view.pos[p]);
    g.fillStyle = ctx.colors[p] ?? "#fff";
    g.beginPath();
    g.arc(r.x + 30 + (k % 3) * 44, r.y + 100 + Math.floor(k / 3) * 30, 16, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#000";
    g.lineWidth = 2;
    g.stroke();
  });
  // centre: money
  text(g, `«Бункер-Магнат» · круг ${Math.min(view.round, view.maxRounds)}/${view.maxRounds}`, 512, 270, 30, PAPER, "center", true);
  view.players.forEach((p: string, k: number) => {
    const bank = view.bankrupt.includes(p);
    g.fillStyle = ctx.colors[p] ?? PAPER;
    g.beginPath();
    g.arc(300, 340 + k * 44, 13, 0, Math.PI * 2);
    g.fill();
    text(g, `${p === view.turn ? "▶ " : ""}${ctx.names[p] ?? p}: ${bank ? "банкрот" : view.money[p] + " монет"}${view.jail[p] ? " (карцер)" : ""}`, 326, 340 + k * 44, 30, bank ? "#8a7a6a" : p === view.turn ? WARM : PAPER, "left", p === view.turn);
  });
  (view.dice ?? []).forEach((d: number, i: number) => drawDie(g, 430 + i * 90, 640, 70, d, false));
}

// ---------------------------------------------------------------- wasteland

function track(g: CanvasRenderingContext2D, label: string, x: number, y: number, n: number, max: number, color: string) {
  text(g, label, x, y - 30, 26, PAPER, "left", true);
  for (let i = 0; i < max; i++) {
    g.fillStyle = i < n ? color : "rgba(233,220,192,0.2)";
    g.fillRect(x + i * 76, y, 68, 40);
  }
}

function drawWasteland(g: CanvasRenderingContext2D, view: any, ctx: BoardCtx) {
  track(g, `Рок: ${view.doom}/10`, 110, 150, view.doom, 10, "#b8322a");
  track(g, `Убежище: ${view.shelter}/8`, 110, 270, view.shelter, 8, "#7aa05a");
  text(g, `Припасы: ${view.supplies} · Раунд ${view.round}`, 110, 360, 30, PAPER, "left");
  if (view.threat) {
    g.fillStyle = "#3a1a14";
    rrect(g, 330, 420, 364, 220, 16);
    g.fill();
    g.strokeStyle = "#b8322a";
    g.lineWidth = 5;
    g.stroke();
    text(g, view.threat.name, 512, 480, 34, "#f0c0a0", "center", true);
    text(g, `Сила ${view.threat.str} · урон ${view.threat.dmg} · рок +${view.threat.doom}`, 512, 550, 24, PAPER);
  } else text(g, "Пока тихо", 512, 530, 34, "#a0c090");
  view.players.forEach((p: string, i: number) => {
    const x = 110 + (i % 3) * 280,
      y = 720 + Math.floor(i / 3) * 90;
    text(g, `${p === view.turn ? "▶ " : ""}${ctx.names[p] ?? p}`, x, y, 26, ctx.colors[p] ?? PAPER, "left", true);
    text(g, "♥".repeat(view.hp[p]) + "♡".repeat(3 - view.hp[p]), x, y + 36, 30, "#d04030", "left");
  });
  if (view.last) text(g, view.last, 512, 960, 24, WARM);
}

// ---------------------------------------------------------------- mafia

function drawMafia(g: CanvasRenderingContext2D, view: any, ctx: BoardCtx) {
  g.fillStyle = view.phase === "night" ? "rgba(10,14,30,0.75)" : "rgba(120,90,50,0.25)";
  g.beginPath();
  g.arc(512, 512, 470, 0, Math.PI * 2);
  g.fill();
  text(g, view.phase === "night" ? `🌙 Ночь ${view.day}` : `☀ День ${view.day}`, 512, 420, 44, PAPER, "center", true);
  text(g, view.me ? `Вы — ${MAFIA_ROLE_NAMES[view.me as keyof typeof MAFIA_ROLE_NAMES]}` : "Вы наблюдаете", 512, 480, 30, WARM);
  const lines = String(view.news ?? "").match(/.{1,34}(\s|$)/g) ?? [];
  lines.forEach((l, i) => text(g, l.trim(), 512, 550 + i * 34, 24, PAPER));
  const ps: string[] = view.players;
  const tally: Record<string, number> = {};
  for (const v of Object.values(view.votes ?? {})) if (v) tally[v as string] = (tally[v as string] ?? 0) + 1;
  ps.forEach((p, i) => {
    const a = Math.PI / 2 + (i / ps.length) * Math.PI * 2;
    const x = 512 + Math.cos(a) * 360,
      y = 512 + Math.sin(a) * 360;
    const dead = !view.alive.includes(p);
    g.fillStyle = dead ? "#3a3030" : ctx.colors[p] ?? "#8a7a6a";
    g.beginPath();
    g.arc(x, y, 58, 0, Math.PI * 2);
    g.fill();
    text(g, (ctx.names[p] ?? p).slice(0, 8), x, y - 10, 24, dead ? "#8a7a6a" : "#fff", "center", true);
    const role = view.known?.[p];
    if (role) text(g, MAFIA_ROLE_NAMES[role as keyof typeof MAFIA_ROLE_NAMES], x, y + 20, 18, role === "mafia" ? "#ff8a7a" : "#e9dcc0");
    if (view.checks?.[p] !== undefined) text(g, view.checks[p] ? "🔎 мафия!" : "🔎 чист", x, y + 76, 20, view.checks[p] ? "#ff8a7a" : "#a0e0a0");
    if (tally[p]) text(g, `🗳×${tally[p]}`, x, y - 76, 24, WARM, "center", true);
    if (view.claims?.[p]) text(g, `☝ ${ctx.names[view.claims[p]] ?? ""}`, x, y + 100, 18, "#ffd070");
    if (dead) {
      g.strokeStyle = "#b8322a";
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(x - 40, y - 40);
      g.lineTo(x + 40, y + 40);
      g.stroke();
    }
  });
}

// ---------------------------------------------------------------- card games: only info around the cards

function drawPoker(g: CanvasRenderingContext2D, view: any, ctx: BoardCtx) {
  text(g, `Банк: ${view.pot} · раздача ${view.hand}/${view.maxHands === 99 ? "∞" : view.maxHands}`, 512, 360, 32, WARM, "center", true);
  if (view.best) text(g, `У вас: ${view.best}`, 512, 700, 28, PAPER);
  if (view.lastWin) {
    const [who, amt, hand] = String(view.lastWin).split("|");
    text(g, `Прошлый банк: ${ctx.names[who] ?? who} +${amt}${hand ? " — " + hand : ""}`, 512, 300, 24, PAPER);
  }
}

function drawCheat(g: CanvasRenderingContext2D, view: any, ctx: BoardCtx) {
  text(g, view.rank ? `Кладём: «${rankLabel(view.rank)}»` : "Новый круг — объявите ранг", 512, 320, 32, WARM, "center", true);
  if (view.last) text(g, `${ctx.names[view.last.by] ?? ""} положил ${view.last.n} карт(ы) · в стопке ${view.pile}`, 512, 700, 26, PAPER);
  if (view.reveal) text(g, `Вскрыли: ${view.reveal.cards.map(cardLabel).join(" ")} — ${view.reveal.lie ? "враньё!" : "правда"}`, 512, 740, 26, view.reveal.lie ? "#ff8a7a" : "#a0e0a0");
}

function drawDrunkard(g: CanvasRenderingContext2D, view: any, ctx: BoardCtx) {
  text(g, view.war ? "СПОР!" : `Раунд ${view.rounds}/${view.maxRounds}`, 512, 320, 36, view.war ? "#ff8a7a" : WARM, "center", true);
  view.players.forEach((p: string, i: number) => text(g, `${ctx.names[p] ?? p}: ${view.counts[p]}`, 180 + (i % 2) * 660, 760 + Math.floor(i / 2) * 40, 26, ctx.colors[p] ?? PAPER));
}

export const DRAW: Record<string, (g: CanvasRenderingContext2D, view: any, ctx: BoardCtx) => void> = {
  chess: drawChess,
  checkers: drawCheckers,
  backgammon: drawNardy,
  generala: drawGenerala,
  domino: drawDomino,
  lotto: drawLotto,
  magnate: drawMagnate,
  wasteland: drawWasteland,
  mafia: drawMafia,
  poker: drawPoker,
  cheat: drawCheat,
  drunkard: drawDrunkard,
};

export function drawBoard(g: CanvasRenderingContext2D, game: string, view: any, ctx: BoardCtx) {
  bg(g);
  DRAW[game]?.(g, view, ctx);
}

export { KEG_NAMES };
