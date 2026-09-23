import * as THREE from "three";
import { BOX_NAMES, ENEMIES, FACTIONS, ITEMS, LOC, PROFS, itemName, listSiteActions, mapPath, sortieOdds, squadPower, travelHours, type SiteAction } from "@bunker/shared";

const profName = (p: string) => PROFS[p]?.name ?? p;

/** One line that answers «what now?» inside a building. */
function siteHint(e: any, s: any, me: any): string {
  if (!s || !me) return "";
  const hunting = s.threats.some((t: any) => t.state === "alert" || t.detect > 40);
  if (hunting) return "⚠ Вас ищут: отойдите за дверь или приготовьтесь к бою";
  const room = s.rooms.find((r: any) => r.lv === me.lv && me.x >= r.x && me.x < r.x + r.w);
  if (room?.dark && !e.light?.[me.id]) return "Темно — включите фонарик (L), так видно ловушки";
  const open = s.conts.filter((c: any) => c.searched < 1);
  if (open.length) return `Щёлкните ◇ (${open.length}), чтобы обыскать`;
  if (s.rooms.some((r: any) => !r.revealed && !r.stairs)) return "Идите дальше: A/D по этажу, W/S по лестнице — комнаты открываются, когда войдёте";
  return "Здание обыскано — жмите «К выходу»";
}
import { audio } from "../audio/audio";
import { net } from "../net";
import { menuArrows } from "../input";
import { CharView } from "../render/chars";
import { box, glyphTex, mat } from "../render/palette";
import { SiteRenderer, buildEnemy } from "../render/site";
import { buildSiteProp } from "../render/scenery";
import type { WorldRenderer } from "../render/world";
import { add, bar, clear, closeModal, h, isModalOpen, modal, ui } from "./dom";
import "./expedition.css";

const GEAR = [
  "food_can",
  "water",
  "meds",
  "medkit",
  "flashlight",
  "batteries",
  "lockpick",
  "crowbar",
  "pistol",
  "rifle",
  "shotgun",
  "pipe",
  "knife",
  "ammo",
  "molotov",
  "armor",
  "gasmask",
  "radpills",
  "relay",
  "nvg",
  "geiger",
];

export class ExpeditionUI {
  site = new SiteRenderer();
  dyn = new THREE.Group();
  chars = new Map<string, CharView>();
  enemies = new Map<string, THREE.Object3D>();
  private props = new Map<string, { depleted: boolean; root: THREE.Group }>();
  private propSite = "";
  private scenery = new THREE.Group();
  private sceneryKey = "";
  private spriteMaterials = new Map<string, THREE.SpriteMaterial>();
  private coneMeshes = new Map<string, THREE.Mesh>();
  private beams = new Map<string, THREE.Mesh>();
  mapEl = h("div.exp-map.hidden");
  siteHud = h("div.panel.exp-hud.hidden");
  prompt = h("div.prompt.exp-context.hidden");
  dock = h("div.exp-dock.hidden");
  markers = h("div.exp-markers.hidden");
  onNavigate: ((x: number, lv: number) => void) | null = null;
  private selected: { id: string; name: string; x: number; lv: number } | null = null;
  private selectedNode = "";
  private markerNodes = new Map<string, HTMLElement>();
  banner = h("div.panel.exp-banner.hidden");
  mode: "none" | "map" | "site" = "none";
  actions: SiteAction[] = [];
  sel = 0;
  private mapKey = "";
  private hudKey = "";
  private promptKey = "";
  private bannerKey = "";
  private tradeGive: Record<string, number> = {};
  private tradeTake: Record<string, number> = {};

  constructor(private r: WorldRenderer) {
    this.site.scene.add(this.dyn);
    ui().append(this.mapEl, this.siteHud, this.prompt, this.banner, this.dock, this.markers, this.bubbleLayer);
    net.onFx.add((f) => {
      if (f.k !== "news" || (f.to && f.to !== net.priv?.pid)) return;
      if (f.id === "expedition") {
        // effects arrive before the state patch of the same tick
        setTimeout(() => {
          const e = net.pub?.mods?.expedition;
          if (e?.stage === "prep") this.openPrep();
          else if (e) this.openOperator();
        }, 200);
      } else if (f.id === "talk") this.openTalk(f.data);
    });
  }

  get e(): any {
    return net.pub?.mods?.expedition;
  }

  inSquad(): boolean {
    const e = this.e;
    const ch = net.priv?.char;
    return !!e && !!ch && e.squad.includes(ch) && e.stage !== "prep";
  }

  // ---------------------------------------------------------------- per patch
  update() {
    const e = this.e;
    const mine = this.inSquad();
    const combat = net.pub?.mods?.combat?.active;
    this.mode = mine && !combat ? (e.stage === "site" && e.site ? "site" : "map") : "none";
    this.mapEl.classList.toggle("hidden", this.mode !== "map");
    this.siteHud.classList.toggle("hidden", this.mode !== "site");
    this.dock.classList.toggle("hidden", this.mode !== "site");
    this.markers.classList.toggle("hidden", this.mode !== "site");
    this.bubbleLayer.classList.toggle("hidden", this.mode !== "site");
    if (this.mode !== "site") {
      this.prompt.classList.add("hidden");
      this.selected = null;
    }
    if (this.mode === "map") this.renderMap();
    if (this.mode === "site") this.renderHud();
    this.renderBanner();
  }

  private sendNode = "";

  /** «Отправить без меня»: residents go alone; odds come from squad strength vs the place's danger. */
  sendWithoutMe(v: any, e: any) {
    const bots = e.squad.filter((id: string) => v.chars[id] && !v.chars[id].ctrl);
    if (!bots.length) return null;
    const nodes = Object.values((v.mods.wmap?.nodes ?? {}) as Record<string, any>)
      .filter((n) => n.id !== "home" && LOC.types[n.type] && n.type !== "ark")
      .sort((a, b) => a.danger - b.danger || (a.looted ?? 0) - (b.looted ?? 0));
    if (!nodes.length) return null;
    if (!nodes.some((n) => n.id === this.sendNode)) this.sendNode = nodes[0].id;
    const power = squadPower(v, { supplies: e.gear } as any, bots.map((id: string) => v.chars[id]));
    const odds = (n: any) => sortieOdds(power, n.danger, n.looted ?? 0);
    const cur = nodes.find((n) => n.id === this.sendNode)!;
    const o = odds(cur);
    const names = bots.map((id: string) => v.chars[id].card.name.split(" ")[0]).join(", ");
    return h(
      "div.exp-sendbots",
      null,
      h("div.exp-eyebrow", null, "ИЛИ ОТПРАВИТЬ ЖИЛЬЦОВ БЕЗ МЕНЯ"),
      h("p.dim", null, `${names} пойдут сами. Без вас они не выбирают бои и не прячутся — в опасных местах велик шанс вернуться ни с чем и ранеными.`),
      h(
        "div.row",
        null,
        h(
          "select",
          { onchange: (ev: Event) => ((this.sendNode = (ev.target as HTMLSelectElement).value), this.openPrep()) },
          nodes.map((n) => {
            const k = odds(n);
            return h("option", { value: n.id, selected: n.id === this.sendNode }, `${n.name} · ${"◆".repeat(n.danger)} · успех ${k.clean + k.rough}%`);
          }),
        ),
        h(
          "button",
          {
            onclick: () => {
              net.send({ k: "expSendBots", node: this.sendNode });
              closeModal();
            },
          },
          "Отправить без меня →",
        ),
      ),
      h(
        "div.exp-odds",
        null,
        h("span.good", null, `чисто ${o.clean}%`),
        h("span.warn", null, `тяжело ${o.rough}%`),
        h("span.bad", null, `провал ${o.rout}%`),
      ),
    );
  }

  /** What a place promises and threatens, and how far it is — the reasons to pick it. */
  nodeIntel(v: any, e: any, n: any) {
    const t = LOC.types[n.type];
    const map = v.mods.wmap;
    let hours = 0;
    const path = map && e.node !== n.id ? mapPath(map, e.node, n.id, false) : null;
    if (path) for (let i = 1; i < path.length; i++) hours += travelHours(map.nodes[path[i - 1]], map.nodes[path[i]], v.weather?.today) / 2;
    const loot: [string, number, number[]][] = t ? (LOC.loot[t.loot] ?? []) : [];
    const top = [...loot].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const threats = t ? [...new Set<string>(t.threats ?? [])] : [];
    return h(
      "div.exp-intel",
      null,
      top.length
        ? h("div", null, h("div.exp-eyebrow", null, "ВОЗМОЖНАЯ ДОБЫЧА"), h("div.exp-intel-row", null, ...top.map(([k]) => h("span.exp-intel-item", { title: itemName(k) }, `${ITEMS[k]?.icon ?? "◇"} ${itemName(k)}`))))
        : null,
      threats.length
        ? h("div", null, h("div.exp-eyebrow", null, "РИСКИ"), h("div.exp-intel-row", null, ...threats.map((k) => h("span.exp-intel-risk", null, `☠ ${ENEMIES[k]?.name ?? k}`))))
        : null,
      h(
        "div.exp-intel-facts",
        null,
        path ? h("span", null, `⏱ В пути ~${hours < 1 ? Math.max(1, Math.round(hours * 60)) + " мин" : hours.toFixed(1) + " ч"}`) : null,
        n.looted ? h("span", null, `Обыскано ${Math.round(n.looted * 100)}%`) : n.visited ? null : h("span", null, "Ещё не обыскано"),
      ),
    );
  }

  // ---------------------------------------------------------------- prep
  openPrep() {
    const render = () => {
      const e = this.e;
      const v = net.pub!;
      if (!e || e.stage !== "prep") return closeModal();
      const me = net.priv?.char;
      const joined = me && e.squad.includes(me);
      const body = h("div.exp-prep");
      const rerender = () => setTimeout(render, 250);
      body.append(
        h("div.exp-eyebrow", null, "ПОДГОТОВКА К ВЫХОДУ / УБЕЖИЩЕ 01"),
        h("p.dim", null, "Соберите отряд и возьмите припасы. Всё найденное вернётся на склад вместе с вами."),
      );
      const squad = h(
        "div.exp-squad",
        null,
        h(
          "div",
          null,
          h("b", null, `Отряд ${e.squad.length} / 3`),
          h("div.dim", null, "Остальные жители остаются в убежище"),
        ),
        h("div.grow"),
        me
          ? h(
              "button" + (joined ? "" : ".primary"),
              {
                onclick: () => {
                  net.send({ k: "expJoin", v: !joined });
                  rerender();
                },
              },
              joined ? "✓ Вы в отряде" : "Присоединиться",
            )
          : null,
      );
      const member = (id: string) => {
        const c = v.chars[id];
        if (!c) return null;
        const hp = Math.round(c.needs?.health ?? 100);
        return h(
          "div.exp-member",
          null,
          h("b", null, c.card.name.split(" ")[0]),
          h("span.dim", null, profName(c.card.prof)),
          h("span.exp-member-hp", { style: { color: hp < 50 ? "#e07a5f" : "#8fcf6a" } }, `♥ ${hp}`),
          id === me
            ? null
            : h(
                "button.small.exp-member-x",
                {
                  title: "Оставить в убежище",
                  onclick: () => {
                    net.send({ k: "expRemove", char: id });
                    rerender();
                  },
                },
                "×",
              ),
        );
      };
      const candidates = Object.values(v.chars as Record<string, any>).filter(
        (c) => c.status === "ok" && !e.squad.includes(c.id) && !c.ctrl && (c.needs?.health ?? 100) > 40,
      );
      add(
        body,
        squad,
        h("div.exp-squad-members", null, ...e.squad.map(member)),
        e.squad.length < 3 && candidates.length
          ? h(
              "div.exp-candidates",
              null,
              h("span.dim", null, "Взять с собой: "),
              ...candidates.slice(0, 5).map((c: any) =>
                h(
                  "button.small",
                  {
                    title: `${c.card.name} · ${profName(c.card.prof)} · здоровье ${Math.round(c.needs?.health ?? 100)}`,
                    onclick: () => {
                      net.send({ k: "expAdd", char: c.id });
                      rerender();
                    },
                  },
                  `+ ${c.card.name.split(" ")[0]} (${profName(c.card.prof)})`,
                ),
              ),
              h(
                "button.small.primary",
                {
                  onclick: () => {
                    net.send({ k: "expAuto" });
                    rerender();
                  },
                },
                "Автоподбор",
              ),
            )
          : null,
        e.squad.length === 1
          ? h("p.exp-warn", null, "⚠ В одиночку опасно: любая стычка может закончиться ранением. Возьмите 1–2 жильцов.")
          : null,
        this.sendWithoutMe(v, e),
      );
      const capacity = h(
        "div.exp-capacity",
        null,
        h(
          "div.row",
          null,
          h("b", null, "Рюкзак отряда"),
          h("div.grow"),
          h("b", null, `${Number(e.gearWeight ?? 0).toFixed(1)} / ${e.cap} кг`),
        ),
        bar(e.gearWeight ?? 0, "#dda66c", Math.max(1, e.cap)),
      );
      body.append(capacity);
      const categories = [
        { title: "Припасы и медицина", ids: GEAR.filter((k) => ["food", "water", "med"].includes(ITEMS[k]?.cat)) },
        {
          title: "Инструменты и защита",
          ids: GEAR.filter((k) => !["food", "water", "med", "weapon"].includes(ITEMS[k]?.cat)),
        },
        { title: "Оружие", ids: GEAR.filter((k) => ITEMS[k]?.cat === "weapon") },
      ];
      const grid = h("div.exp-gear-grid");
      for (const cat of categories) {
        const group = h("section.exp-gear-group", null, h("h3", null, cat.title));
        for (const k of cat.ids) {
          const have = Math.floor(v.res[k] ?? 0),
            n = e.gear[k] ?? 0;
          if (!have && !n) continue;
          group.append(
            h(
              "div.exp-gear-row" + (n ? ".packed" : ""),
              null,
              h("span.exp-item-icon", null, ITEMS[k]?.icon ?? "◇"),
              h(
                "div.exp-item-name",
                null,
                h("b", null, itemName(k)),
                h("span.dim", null, `На складе ${have} · ${ITEMS[k]?.weight ?? 0} кг`),
              ),
              h(
                "button.small",
                {
                  disabled: !n,
                  "aria-label": `Убрать ${itemName(k)}`,
                  onclick: () => {
                    net.send({ k: "expGear", item: k, n: n - 1 });
                    rerender();
                  },
                },
                "−",
              ),
              h("b.exp-item-count", null, n),
              h(
                "button.small",
                {
                  disabled: n >= have || !e.squad.length || Number(e.gearWeight ?? 0) + (ITEMS[k]?.weight ?? 0) > e.cap,
                  "aria-label": `Взять ${itemName(k)}`,
                  onclick: () => {
                    net.send({ k: "expGear", item: k, n: n + 1 });
                    rerender();
                  },
                },
                "+",
              ),
            ),
          );
        }
        if (group.children.length === 1) group.append(h("p.dim", null, "На складе пока пусто"));
        grid.append(group);
      }
      body.append(
        grid,
        h(
          "div.exp-prep-foot",
          null,
          h(
            "button",
            {
              disabled: !e.squad.length,
              onclick: () => {
                net.send({ k: "expKit" });
                rerender();
              },
            },
            "Собрать базовый набор",
          ),
          h(
            "button",
            {
              onclick: () => {
                net.send({ k: "expRepeat" });
                rerender();
              },
              disabled: !v.mods.lastGear,
            },
            "Прошлый набор",
          ),
          h("div.grow"),
          h(
            "button.primary",
            {
              disabled: !e.squad.length || e.gearWeight > e.cap,
              onclick: () => {
                net.send({ k: "expStart" });
                closeModal();
              },
            },
            "Выйти на поверхность →",
          ),
        ),
      );
      modal("Снаряжение вылазки", body, { wide: true, cls: "exp-prep-modal" });
    };
    render();
  }

  renderBanner() {
    const e = this.e;
    const show = !!e && e.stage === "prep" && !e.squad.includes(net.priv?.char ?? "");
    this.banner.classList.toggle("hidden", !show);
    if (!show) return;
    const me = net.priv?.char;
    const key = JSON.stringify([e.squad, e.prepT > 0]);
    if (key === this.bannerKey) return;
    this.bannerKey = key;
    clear(this.banner);
    add(
      this.banner,
      h("span", null, `🎒 Собирается вылазка (${e.squad.length}/3). `),
      me && !e.squad.includes(me)
        ? h("button.small.primary", { onclick: () => net.send({ k: "expJoin" }) }, "Иду!")
        : null,
      h("button.small", { onclick: () => this.openPrep() }, "Снаряжение"),
    );
  }

  // ---------------------------------------------------------------- map
  svgMap(onClick?: (id: string) => void): SVGSVGElement {
    const e = this.e;
    const m = net.pub?.mods?.wmap;
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 100 80");
    svg.classList.add("wmap");
    if (!m) return svg;
    const el = (tag: string, attrs: Record<string, any>, text?: string) => {
      const x = document.createElementNS(NS, tag);
      for (const k in attrs) x.setAttribute(k, String(attrs[k]));
      if (text) x.textContent = text;
      svg.appendChild(x);
      return x;
    };
    // the hand-laid map of Новоград (scripts/gen-map.mjs); places sit on its fixed slots
    el("rect", { x: 0, y: 0, width: 100, height: 80, fill: "#172020" });
    el("image", { href: `${import.meta.env.BASE_URL}assets/wasteland-map.svg`, x: 0, y: 0, width: 100, height: 80, preserveAspectRatio: "none" });
    const nodes = m.nodes as Record<string, any>;
    const seen = (n: any) => n && !n.unknown;
    // roads you know are lit up over the drawn ones
    for (const id in nodes)
      for (const l of nodes[id].links)
        if (id < l && seen(nodes[id]) && seen(nodes[l]))
          el("line", { x1: nodes[id].x, y1: nodes[id].y, x2: nodes[l].x, y2: nodes[l].y, stroke: "#e8d6a4", "stroke-width": 0.28, "stroke-opacity": 0.55, "stroke-dasharray": "0.8 0.6" });
    // route
    if (e?.route?.length) {
      let prev = nodes[e.node];
      for (const id of e.route) {
        const n = nodes[id];
        if (prev && n) el("line", { x1: prev.x, y1: prev.y, x2: n.x, y2: n.y, stroke: "#e0704f", "stroke-width": 0.7 });
        prev = n;
      }
    }
    for (const id in nodes) {
      const n = nodes[id];
      if (!seen(n)) {
        // not scouted yet: a question mark on the drawn plot
        el("text", { x: n.x, y: n.y + 0.9, "font-size": 2.4, "text-anchor": "middle", fill: "#c9bb96", "fill-opacity": 0.5 }, "?");
        continue;
      }
      const icon =
        n.type === "home"
          ? "🏠"
          : n.type === "trader"
            ? "🛒"
            : n.type === "camp"
              ? (FACTIONS[n.faction]?.icon ?? "⛺")
              : (LOC.types[n.type]?.icon ?? "•");
      const g = el("g", { style: "cursor:pointer", tabindex: onClick ? 0 : -1, role: "button", "aria-label": n.name });
      const c = document.createElementNS(NS, "circle");
      c.setAttribute("cx", n.x);
      c.setAttribute("cy", n.y);
      c.setAttribute("r", "2.6");
      c.setAttribute("fill", n.visited ? "#3a2f27" : "#2a221c");
      c.setAttribute(
        "stroke",
        id === this.selectedNode ? "#ffffff" : id === e?.node ? "#ffc58a" : n.danger >= 3 ? "#d66a57" : "#8ba79a",
      );
      c.setAttribute("stroke-width", id === e?.node ? "0.8" : "0.35");
      g.appendChild(c);
      const t = document.createElementNS(NS, "text");
      t.setAttribute("x", n.x);
      t.setAttribute("y", String(n.y + 1.1));
      t.setAttribute("font-size", "3");
      t.setAttribute("text-anchor", "middle");
      t.textContent = icon;
      g.appendChild(t);
      const title = document.createElementNS(NS, "title");
      title.textContent = `${n.name}${n.theme ? " — " + n.theme : ""}\nОпасность: ${"☠".repeat(n.danger || 0) || "—"}${n.looted ? `\nОбыскано: ${Math.round(n.looted * 100)}%` : ""}`;
      g.appendChild(title);
      if (onClick) {
        g.addEventListener("click", () => onClick(id));
        g.addEventListener("keydown", (ev) => {
          if ((ev as KeyboardEvent).key === "Enter" || (ev as KeyboardEvent).key === " ") {
            ev.preventDefault();
            onClick(id);
          }
        });
      }
      const label = document.createElementNS(NS, "text");
      label.setAttribute("x", n.x);
      label.setAttribute("y", String(n.y + 5.5));
      label.setAttribute("font-size", "1.65");
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("fill", "#d7ddd1");
      label.setAttribute("paint-order", "stroke");
      label.setAttribute("stroke", "#172020");
      label.setAttribute("stroke-width", "0.6");
      label.textContent = n.name;
      g.appendChild(label);
      svg.appendChild(g);
    }
    // squad marker
    if (e) {
      const a = nodes[e.from ?? e.node];
      const b = e.stage === "travel" && e.route?.length ? nodes[e.route[0]] : null;
      const p = a && b ? { x: a.x + (b.x - a.x) * e.progress, y: a.y + (b.y - a.y) * e.progress } : nodes[e.node];
      if (p) el("circle", { cx: p.x, cy: p.y, r: 1.3, fill: "#ffc58a", stroke: "#000", "stroke-width": 0.3 });
    }
    return svg;
  }

  renderMap() {
    const e = this.e,
      v = net.pub!;
    const key = JSON.stringify([
      e.node,
      e.route,
      Math.round(e.progress * 50),
      e.stage,
      e.log,
      e.loot,
      e.supplies,
      e.bodies,
      v.mods.wmap,
      e.stock,
      this.tradeGive,
      this.tradeTake,
      v.hour > 21.5,
      this.selectedNode,
    ]);
    if (key === this.mapKey) return;
    this.mapKey = key;
    clear(this.mapEl);
    const nodes = v.mods.wmap?.nodes ?? {},
      here = nodes[e.node];
    const selected = nodes[this.selectedNode] ?? here;
    const side = h("div.exp-side.panel");
    add(
      side,
      h("div.exp-eyebrow", null, "ЭКСПЕДИЦИЯ / КАРТА РАЙОНА"),
      h("h2", null, e.stage === "travel" ? "В пути" : "Выберите маршрут"),
      h(
        "div.exp-current",
        null,
        h("span.dim", null, e.stage === "travel" ? "Направляемся в" : "Отряд находится"),
        h("b", null, e.stage === "travel" ? (nodes[e.route[0]]?.name ?? "Пустоши") : (here?.name ?? "Убежище")),
      ),
      e.stage === "travel"
        ? h(
            "div",
            null,
            bar(e.progress * 100, "#dda66c"),
            h(
              "p.dim",
              null,
              `${Math.round(e.progress * 100)}% пути${v.hour > 21.5 ? " · скоро привал на ночь" : " · время и припасы расходуются"}`,
            ),
          )
        : null,
      h(
        "div.exp-destination",
        null,
        h("div.exp-eyebrow", null, "ТОЧКА НАЗНАЧЕНИЯ"),
        h("h3", null, selected?.name ?? "Выберите место на карте"),
        selected?.theme ? h("p.dim", null, selected.theme) : null,
        h(
          "p",
          { class: selected?.danger >= 3 ? "bad" : "dim" },
          `Опасность: ${selected?.danger >= 3 ? "высокая" : selected?.danger > 0 ? "умеренная" : "низкая"} ${"◆".repeat(selected?.danger ?? 0)}`,
        ),
        selected ? this.nodeIntel(v, e, selected) : null,
        e.stage === "map" && selected?.id !== e.node && this.selectedNode && this.selectedNode !== e.node
          ? h(
              "button.primary",
              {
                onclick: () => {
                  net.send({ k: "expGo", node: this.selectedNode });
                  this.selectedNode = "";
                },
              },
              "Проложить маршрут →",
            )
          : null,
        e.stage === "map" && here && LOC.types[here.type] && (!this.selectedNode || this.selectedNode === e.node)
          ? h("button.primary", { onclick: () => net.send({ k: "expEnter" }) }, "Войти и исследовать →")
          : null,
      ),
      h(
        "div.exp-map-load",
        null,
        h("span", null, "Рюкзак отряда"),
        h("b", null, `${Number(e.weight).toFixed(1)} / ${e.cap} кг`),
      ),
      bar(e.weight, "#dda66c", e.cap),
      e.bodies
        ? h(
            "div.exp-bodies",
            null,
            h("b", null, "💀 Тела после боя"),
            h("p.dim", null, `У них было: ${Object.entries(e.bodies as Record<string, number>).map(([k, n]) => `${ITEMS[k]?.icon ?? ""}${itemName(k)}×${n}`).join(", ")}`),
            h("button.primary", { onclick: () => net.send({ k: "expBodies" }) }, "Обыскать тела"),
          )
        : null,
      h("button", { onclick: () => this.openInventory() }, "Открыть снаряжение и добычу"),
      e.stage === "map" && e.node !== "home"
        ? h("button", { onclick: () => net.send({ k: "expHome" }) }, "↙ Вернуться в убежище")
        : null,
      h(
        "details.exp-journal",
        null,
        h("summary", null, "Журнал вылазки"),
        h(
          "div.exp-log",
          null,
          (e.log ?? []).slice(-8).map((l: string) => h("div", null, l)),
        ),
      ),
    );
    if (e.stage === "map" && (here?.type === "trader" || here?.type === "camp") && e.stock)
      side.append(this.tradePanel(e));
    const chart = h(
      "div.exp-chart",
      null,
      h(
        "div.exp-chart-title",
        null,
        h("span", null, "ПУСТОШЬ"),
        h("small", null, "Щёлкните место, чтобы изучить маршрут"),
      ),
      this.svgMap((id) => {
        this.selectedNode = id;
        this.mapKey = "";
        this.renderMap();
      }),
      h("div.exp-map-legend", null, "● Отряд   ─ Известные дороги   ◆ Опасная зона"),
    );
    this.mapEl.append(h("div.exp-map-inner", null, chart, side));
  }

  tradePanel(e: any) {
    const val = (o: Record<string, number>) =>
      Object.entries(o).reduce((s, [k, n]) => s + (ITEMS[k]?.value ?? 1) * n, 0);
    const mine: Record<string, number> = {};
    for (const src of [e.supplies, e.loot])
      for (const k in src) if (src[k] >= 1 && ITEMS[k]) mine[k] = (mine[k] ?? 0) + Math.floor(src[k]);
    const give = val(this.tradeGive),
      take = val(this.tradeTake) * e.priceMult;
    const row = (k: string, max: number, o: Record<string, number>) =>
      h(
        "div.row",
        { style: { gap: "3px" } },
        h("span", { style: { flex: "1" } }, `${ITEMS[k]?.icon ?? ""}${itemName(k)} (${max}) ·${ITEMS[k]?.value ?? 1}`),
        h("button.small", { onclick: () => ((o[k] = Math.max(0, (o[k] ?? 0) - 1)), (this.mapKey = "")) }, "−"),
        h("b", null, String(o[k] ?? 0)),
        h("button.small", { onclick: () => ((o[k] = Math.min(max, (o[k] ?? 0) + 1)), (this.mapKey = "")) }, "+"),
      );
    return h(
      "div.panel",
      { style: { padding: "6px", marginTop: "6px" } },
      h("b", null, "🤝 Торговля"),
      h("div.dim", null, `Цены ×${e.priceMult.toFixed(2)} (зависят от отношений с фракцией)`),
      h(
        "div.row",
        { style: { alignItems: "flex-start" } },
        h(
          "div.col",
          { style: { flex: "1", gap: "2px" } },
          h("span.dim", null, "Отдаём"),
          Object.keys(mine).map((k) => row(k, mine[k], this.tradeGive)),
        ),
        h(
          "div.col",
          { style: { flex: "1", gap: "2px" } },
          h("span.dim", null, "Берём"),
          Object.keys(e.stock)
            .filter((k) => e.stock[k] > 0)
            .map((k) => row(k, e.stock[k], this.tradeTake)),
        ),
      ),
      h(
        "div",
        null,
        `Ценность: ${give} против ${take.toFixed(1)} `,
        h(
          "button.small.primary",
          {
            disabled: give < take || !take,
            onclick: () => (
              net.send({ k: "trade", give: this.tradeGive, take: this.tradeTake }),
              (this.tradeGive = {}),
              (this.tradeTake = {})
            ),
          },
          "Обменять",
        ),
      ),
    );
  }

  // ---------------------------------------------------------------- site
  siteField(s: any) {
    const floors = s.H / 2;
    const walk: boolean[] = [];
    for (let lv = 0; lv < floors; lv++) for (let x = 0; x < s.W; x++) walk.push(s.grid[lv * 2 * s.W + x] !== 7);
    return {
      cols: s.W,
      floors,
      walk,
      ladders: Object.keys(s.ladders),
      covers: [],
      doors: s.doors.map((d: any) => ({ col: d.x, floor: d.lv, closed: d.state === "closed" || d.state === "locked" })),
      exits: [{ col: s.exitX, floor: s.exitLv }],
    };
  }

  renderHud() {
    const e = this.e,
      s = e.site,
      me = net.priv?.char;
    const key = JSON.stringify([s.noise, e.light, e.log, e.loot, e.weight, e.tasks[me ?? ""]?.t > 0, e.radio?.ok, siteHint(e, s, net.myChar())]);
    if (key === this.hudKey) return;
    this.hudKey = key;
    clear(this.siteHud);
    clear(this.dock);
    const noiseCol = s.noise > 55 ? "#e0503a" : s.noise > 30 ? "#e8c14a" : "#8fcf6a";
    add(
      this.siteHud,
      h("div.exp-eyebrow", null, "ВЫЛАЗКА / " + (e.radio?.ok ? "СВЯЗЬ УСТОЙЧИВА" : "НЕТ СВЯЗИ")),
      h("h3", null, net.pub!.mods.wmap?.nodes[s.node]?.name ?? "Руины"),
      h(
        "div.exp-noise",
        null,
        h("span", null, "Шум"),
        bar(s.noise, noiseCol),
        h("b", { style: { color: noiseCol } }, s.noise > 55 ? "Опасно" : s.noise > 30 ? "Слышно" : "Тихо"),
      ),
      h(
        "details.exp-journal",
        { open: true },
        h("summary", null, "Журнал вылазки"),
        h(
          "div.exp-log",
          null,
          (e.log ?? []).slice(-4).map((l: string) => h("div", null, l)),
        ),
      ),
    );
    add(
      this.dock,
      h("span.exp-dock-hint", null, siteHint(e, s, net.myChar())),
      h(
        "button",
        {
          onclick: () => {
            this.selected = { id: "near", name: "Рядом с вами", x: net.myChar()?.x ?? 0, lv: net.myChar()?.lv ?? 0 };
            this.promptKey = "";
          },
        },
        "✋ Действия",
      ),
      h(
        "button" + (me && e.light[me] ? ".active" : ""),
        { onclick: () => net.send({ k: "expLight" }), title: "Фонарик · L" },
        me && e.light[me] ? "🔦 Свет включён" : "🔦 Фонарик",
      ),
      h("button", { onclick: () => this.openInventory() }, `🎒 ${Number(e.weight).toFixed(1)} / ${e.cap} кг`),
      h(
        "button",
        {
          onclick: () => {
            this.selected = { id: "exit", name: "Выход на поверхность", x: s.exitX, lv: s.exitLv };
            this.onNavigate?.(s.exitX + 0.5, s.exitLv);
            this.promptKey = "";
          },
        },
        "↗ К выходу",
      ),
    );
  }

  openInventory() {
    const e = this.e;
    if (!e) return;
    const group = (name: string, items: Record<string, number>) =>
        h(
          "section.exp-inventory-group",
          null,
          h("h3", null, name),
          Object.entries(items)
            .filter(([, n]) => n >= 1)
            .map(([k, n]) =>
              h(
                "div.exp-inventory-row",
                null,
                h("span.exp-item-icon", null, ITEMS[k]?.icon ?? "◇"),
                h("span", null, itemName(k)),
                h("b", null, Math.floor(n)),
              ),
            ),
        ),
      body = h(
        "div.exp-inventory",
        null,
        h(
          "p.dim",
          null,
          `Общий груз отряда: ${Number(e.weight).toFixed(1)} / ${e.cap} кг. Добыча отправится на склад после возвращения.`,
        ),
        group("Добыча", e.loot),
        group("Снаряжение и припасы", e.supplies),
      );
    modal("Рюкзак отряда", body, { cls: "exp-inventory-modal" });
  }

  private objects(): { id: string; name: string; x: number; lv: number; icon: string }[] {
    const s = this.e?.site;
    if (!s) return [];
    const visible = (o: any) => s.rooms.some((r: any) => r.revealed && r.lv === o.lv && o.x >= r.x && o.x < r.x + r.w);
    return [
      ...s.conts
        .filter((o: any) => o.searched < 1 && visible(o))
        .map((o: any) => ({ ...o, icon: o.locked ? "⌑" : "◇" })),
      ...s.doors
        .filter(visible)
        .map((o: any) => ({ ...o, name: o.state === "open" ? "Дверь открыта" : "Дверь", icon: "▥" })),
      ...s.people.filter((o: any) => !o.gone && visible(o)).map((o: any) => ({ ...o, icon: "•••" })),
      ...s.details
        .filter((o: any) => o.found && !o.taken && visible(o))
        .map((o: any) => ({ ...o, name: o.kind === "note" ? "Записка" : "Находка", icon: "✦" })),
      { id: "exit", name: "Выход на поверхность", x: s.exitX, lv: s.exitLv, icon: "↗" },
    ];
  }

  private selectObject(o: { id: string; name: string; x: number; lv: number }) {
    this.selected = o;
    this.promptKey = "";
    const c = net.myChar();
    if (c && (c.lv !== o.lv || Math.abs(c.x - (o.x + 0.5)) > 1)) {
      const door = this.e?.site?.doors.find(
        (d: any) => d.id === o.id && (d.state === "closed" || d.state === "locked"),
      );
      const targetX = door ? o.x + 0.5 + (c.x < o.x + 0.5 ? -1 : 1) : o.x + 0.5;
      this.onNavigate?.(targetX, o.lv);
    }
    audio.sfx("click", 0.4);
  }

  handleClick(sx: number, sy: number): boolean {
    if (this.mode !== "site" || isModalOpen()) return false;
    let best: ReturnType<ExpeditionUI["objects"]>[number] | undefined;
    let distance = 54;
    for (const o of this.objects()) {
      const [x, y] = this.site.pos(o.x, o.lv),
        [px, py] = this.site.toScreen(x, y + 0.65);
      const d = Math.hypot(px - sx, py - sy);
      if (d < distance) {
        distance = d;
        best = o;
      }
    }
    if (best) {
      this.selectObject(best);
      return true;
    }
    this.selected = null;
    this.promptKey = "";
    return false;
  }

  private updateMarkers() {
    const present = new Set<string>();
    for (const o of this.objects()) {
      const [x, y] = this.site.pos(o.x, o.lv),
        [sx, sy] = this.site.toScreen(x, y + 1.3);
      if (sx < 35 || sx > innerWidth - 35 || sy < 115 || sy > innerHeight - 95) continue;
      present.add(o.id);
      let node = this.markerNodes.get(o.id);
      if (!node) {
        node = h(
          "button.exp-world-marker",
          { title: o.name, "aria-label": o.name, onclick: () => this.selectObject(o) },
          o.icon,
          h("span", null, o.name),
        );
        this.markerNodes.set(o.id, node);
        this.markers.append(node);
      }
      node.style.left = sx + "px";
      node.style.top = sy + "px";
      node.classList.toggle("selected", this.selected?.id === o.id);
    }
    for (const [id, node] of this.markerNodes)
      if (!present.has(id)) {
        node.remove();
        this.markerNodes.delete(id);
      }
  }

  /** Per frame; returns true when this view renders the frame. */
  frame(dt: number): boolean {
    if (this.mode !== "site") {
      if (this.mode === "map") {
        this.r.renderer.setClearColor(0x14100e);
        this.r.renderer.clear();
        return true;
      }
      return false;
    }
    const e = this.e;
    const s = e.site;
    const v = net.pub!;
    // lighting: revealed rooms are lit unless dark and nobody holds a light in them
    const floors = s.H / 2;
    const lit: boolean[] = [];
    const lightIn = new Set<string>();
    for (const id of e.squad) {
      const c = v.chars[id];
      if (!c || !e.light[id]) continue;
      const room = s.rooms.find((r: any) => r.lv === c.lv && c.x >= r.x && c.x < r.x + r.w);
      if (room) lightIn.add(room.id);
    }
    for (let lv = 0; lv < floors; lv++)
      for (let x = 0; x < s.W; x++) {
        const room = s.rooms.find((r: any) => r.lv === lv && x >= r.x && x < r.x + r.w);
        lit.push(!!room && room.revealed && (!room.dark || lightIn.has(room.id)));
      }
    this.site.build(this.siteField(s), { lit });
    this.syncEntities(s, e, dt);
    // camera follows me
    const me = net.myChar();
    const pred = net.pred;
    if (me) {
      const x = pred ? pred.x : me.x,
        y = pred ? pred.y : me.y;
      this.site.follow = false;
      this.site.viewH = 9;
      this.site.camX += (x - this.site.camX) * Math.min(1, dt * 4);
      this.site.camY += (-y + 1.5 - this.site.camY) * Math.min(1, dt * 4);
    }
    this.site.render(this.r.renderer);
    this.updatePrompt();
    this.updateMarkers();
    return true;
  }

  syncEntities(s: any, e: any, dt: number) {
    const v = net.pub!;
    this.dyn.clear();
    const pos = (x: number, lv: number): [number, number] => this.site.pos(x, lv);
    const sceneryKey = JSON.stringify([
      s.node,
      s.rooms.map((r: any) => [r.id, r.revealed]),
      s.conts.map((c: any) => [c.id, c.searched >= 1, c.locked]),
      s.details,
      s.hazards,
      s.people,
    ]);
    if (sceneryKey !== this.sceneryKey) {
      this.sceneryKey = sceneryKey;
      this.scenery.clear();
      // fog over unrevealed rooms
      for (const r of s.rooms) {
        if (r.revealed) continue;
        const [x, y] = pos(r.x, r.lv);
        this.scenery.add(box(r.w, 2, 0.1, 0x000000, x - 0.5 + r.w / 2, y - 0.16, 0.2, mat(0x0a1116, { opacity: 0.86 })));
      }
      if (this.propSite !== s.node) {
        for (const prop of this.props.values())
          prop.root.traverse((o) => {
            if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
          });
        this.props.clear();
        this.propSite = s.node;
      }
      for (const c of s.conts) {
        const [x, y] = pos(c.x, c.lv);
        const depleted = c.searched >= 1;
        let prop = this.props.get(c.id);
        if (!prop || prop.depleted !== depleted) {
          prop?.root.traverse((o) => {
            if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
          });
          prop = { depleted, root: buildSiteProp(c.kind, depleted) };
          this.props.set(c.id, prop);
        }
        prop.root.position.set(x, y, -0.9);
        this.scenery.add(prop.root);
      }
      for (const d of s.details) {
        if (d.taken || !d.found) continue;
        const [x, y] = pos(d.x, d.lv);
        this.scenery.add(
          this.icon(
            d.kind === "note" ? "📝" : d.kind === "loose_step" ? "✨" : d.kind === "stash" ? "✨" : "👁",
            x,
            y + 0.35,
            0.35,
          ),
        );
      }
      for (const hz of s.hazards) {
        if (!hz.known || (!hz.armed && hz.kind !== "rad")) continue;
        const [x, y] = pos(hz.x, hz.lv);
        this.scenery.add(
          this.icon(
            { rad: "☢", weak_floor: "🕳", tripwire: "⚠", glass: "✳", gas: "💨" }[hz.kind as string] ?? "⚠",
            x,
            y + 0.2,
            0.35,
          ),
        );
      }
      for (const p of s.people) {
        if (
          p.gone ||
          !s.rooms.some((room: any) => room.revealed && room.lv === p.lv && p.x >= room.x && p.x < room.x + room.w)
        )
          continue;
        const [x, y] = pos(p.x, p.lv);
        const g = buildEnemy("marauder", p.kind === "patrol" ? 0x4b5a3a : 0x8a7a5a);
        g.position.set(x, y, -0.5);
        this.scenery.add(g, this.icon("💬", x, y + 1.6, 0.35));
      }
    }
    this.dyn.add(this.scenery);
    // threats with vision cones
    const seen = new Set<string>();
    for (const t of s.threats) {
      seen.add(t.id);
      let g = this.enemies.get(t.id);
      if (!g) {
        g = buildEnemy(t.etype, 0x666666);
        this.enemies.set(t.id, g);
      }
      const [x, y] = pos(t.x - 0.5, t.lv);
      g.position.set(x, y, -0.45);
      g.rotation.set(0, t.dir > 0 ? 0.6 : Math.PI - 0.6, t.state === "asleep" ? Math.PI / 2 : 0);
      this.dyn.add(g);
      if (t.state === "asleep") this.dyn.add(this.icon("💤", x, y + 0.9, 0.35));
      else {
        let cone = this.coneMeshes.get(t.id);
        if (!cone) {
          cone = new THREE.Mesh(coneGeo(t.dir), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
          this.coneMeshes.set(t.id, cone);
        }
        cone.geometry = coneGeo(t.dir);
        (cone.material as THREE.MeshBasicMaterial).color.setHex(
          t.detect > 50 ? 0xff3020 : t.state === "alert" ? 0xff9020 : 0xffe060,
        );
        (cone.material as THREE.MeshBasicMaterial).opacity = 0.12 + t.detect / 400;
        cone.position.set(x, y + 0.9, 0.05);
        this.dyn.add(cone);
        if (t.detect > 5) this.dyn.add(this.icon(t.detect > 60 ? "❗" : "❓", x, y + 1.7, 0.4));
      }
    }
    for (const id of [...this.enemies.keys()]) if (!seen.has(id)) this.enemies.delete(id);
    // squad: the best weapons in the packs go to the first members (as in a fight)
    const pool: Record<string, number> = {};
    for (const k of ["rifle", "shotgun", "pistol", "pipe", "knife"]) pool[k] = (e.supplies[k] ?? 0) + (e.loot[k] ?? 0);
    const bubbles = new Set<string>();
    for (const id of e.squad) {
      const c = v.chars[id];
      if (!c || c.status === "dead") continue;
      const weapon = ["rifle", "shotgun", "pistol", "pipe", "knife"].find((k) => pool[k] >= 1);
      if (weapon) pool[weapon]--;
      let cv = this.chars.get(id);
      if (!cv) {
        cv = new CharView(id, c.card.color, c.card.hat, 1);
        this.chars.set(id, cv);
      }
      const mine = id === net.priv?.char && net.pred;
      const tx = mine ? net.pred!.x : c.x,
        ty = mine ? net.pred!.y : c.y;
      cv.glide(tx, ty, performance.now() / 1000, !!mine);
      const moving = Math.abs(tx - cv.userPrevX) > 0.002;
      cv.userPrevX = tx;
      const anim = e.tasks[id] ? "work" : c.climbing ? "climb" : moving ? "walk" : "idle";
      cv.update(dt, anim, c.dir ?? 1);
      cv.root.position.set(cv.x, -cv.y + 0.16, -0.45);
      cv.setMine(id === net.priv?.char);
      cv.setWeapon(e.tasks[id] ? null : weapon);
      this.dyn.add(cv.root);
      if (c.bark?.text) {
        bubbles.add(id);
        let b = this.bubbleEls.get(id);
        if (!b) {
          b = h("div.exp-bubble" + (id === net.priv?.char ? ".mine" : ""));
          this.bubbleEls.set(id, b);
          this.bubbleLayer.append(b);
        }
        if (b.textContent !== c.bark.text) b.textContent = c.bark.text;
        const [sx, sy] = this.site.toScreen(cv.x, -cv.y + 1.75);
        b.style.left = sx + "px";
        b.style.top = sy + "px";
      }
      if (e.light[id]) {
        let beam = this.beams.get(id);
        if (!beam) {
          beam = new THREE.Mesh(BEAM_GEO, BEAM_MAT);
          this.beams.set(id, beam);
        }
        beam.rotation.z = (c.dir ?? 1) > 0 ? Math.PI / 2 : -Math.PI / 2;
        beam.position.set(cv.x + 2 * (c.dir ?? 1), -cv.y + 1.1, -0.3);
        this.dyn.add(beam);
      }
    }
    for (const [id, b] of this.bubbleEls)
      if (!bubbles.has(id)) {
        b.remove();
        this.bubbleEls.delete(id);
      }
  }

  private bubbleEls = new Map<string, HTMLElement>();
  bubbleLayer = h("div.exp-bubbles");

  icon(glyph: string, x: number, y: number, size: number) {
    let material = this.spriteMaterials.get(glyph);
    if (!material) {
      material = new THREE.SpriteMaterial({ map: glyphTex(glyph), transparent: true, depthWrite: false });
      this.spriteMaterials.set(glyph, material);
    }
    const sp = new THREE.Sprite(material);
    sp.scale.setScalar(size);
    sp.position.set(x, y, 0.3);
    return sp;
  }

  /** holding E (or the mouse button) on a search: fast and loud */
  private holdStart = 0;
  private holding = false;
  private rushSent = false;

  updatePrompt() {
    const e = this.e,
      c = net.myChar();
    if (!c || !e?.site) return;
    const p = net.pred;
    const me = { ...c, x: p ? p.x : c.x, lv: p ? p.lv : c.lv, climbing: p ? p.climbing : c.climbing };
    let all: SiteAction[];
    try {
      all = listSiteActions(e, e.site, me as any, net.pub!.flags as any);
    } catch {
      all = [];
    }
    // the stone is a fallback, not something to offer at every step
    const useful = all.filter((a) => a.a !== "stone");
    this.actions = this.selected && this.selected.id !== "near" ? all.filter((a) => a.id === this.selected!.id) : useful.length ? useful : [];
    const lk = this.actions.map((a) => a.a + a.id).join("|");
    if (lk !== this.actionsKey) {
      this.actionsKey = lk;
      this.sel = 0;
    }
    if (this.sel >= this.actions.length) this.sel = 0;
    const task = e.tasks[c.id];
    menuArrows.on = !task && this.actions.length >= 2;
    const near =
      !this.selected ||
      this.selected.id === "near" ||
      (me.lv === this.selected.lv && Math.abs(me.x - (this.selected.x + 0.5)) <= 1.3);
    // holding past a short press turns a search into a rush
    if (this.holding && task?.a === "search") {
      if (performance.now() - this.holdStart > 300 && !this.rushSent) {
        this.rushSent = true;
        net.send({ k: "srush", on: true });
      }
    }
    const key = JSON.stringify([this.selected?.id, near, this.actions, this.sel, task ? [Math.round((task.t / task.dur) * 30), task.rush] : -1]);
    const show = (!!this.selected || !!task || this.actions.length > 0) && !isModalOpen();
    this.prompt.classList.toggle("hidden", !show);
    if (key === this.promptKey) return;
    this.promptKey = key;
    clear(this.prompt);
    this.prompt.append(
      h(
        "div.exp-context-title",
        null,
        h("b", null, task ? "Действие" : this.selected && this.selected.id !== "near" ? this.selected.name : "Рядом с вами"),
        !task && this.actions.length ? h("span.dock-keys", null, this.actions.length > 1 ? "↑↓ выбор · E" : "E") : null,
        this.selected
          ? h(
              "button.small",
              {
                "aria-label": "Закрыть действия",
                onclick: () => {
                  this.selected = null;
                  this.promptKey = "";
                },
              },
              "×",
            )
          : null,
      ),
    );
    if (task) {
      const search = task.a === "search";
      this.prompt.append(
        h(
          "div.exp-task" + (task.rush ? ".rush" : ""),
          null,
          h("span", null, search ? (task.rush ? "⚡ Быстрый обыск — ШУМНО!" : task.room ? "🏚 Обыскиваем комнату…" : "🔍 Обыскиваем тихо…") : "Выполняем действие…"),
          bar((task.t / task.dur) * 100, task.rush ? "#e0603a" : "#dda66c"),
          search ? h("small.dim", null, task.rush ? "Отпустите E — снова тихо" : "Держите E — в 2,5 раза быстрее, но слышно на весь дом") : null,
          h("button.small", { onclick: () => net.send({ k: "sstop" }) }, "Остановиться"),
        ),
      );
      return;
    }
    if (!near) {
      this.prompt.append(h("p.dim", null, "Идём к предмету…"));
      return;
    }
    this.actions.forEach((a, i) => {
      const btn = h(
        "button.exp-action" + (i === this.sel ? ".sel" : ""),
        { disabled: !!a.reason, title: a.reason ?? "" },
        h("span.key", null, i === this.sel ? "E" : String(i + 1)),
        h("span", null, a.label),
        a.reason ? h("small", null, a.reason) : h("small", null, a.a === "search" ? `${Math.ceil(a.dur)} с · держать — быстрее` : a.dur ? `${Math.ceil(a.dur)} сек` : "сразу"),
      ) as HTMLButtonElement;
      // press = careful search, hold = fast and loud (same as the E key)
      btn.addEventListener("pointerdown", () => {
        this.sel = i;
        this.press();
      });
      btn.addEventListener("pointerup", () => this.release());
      btn.addEventListener("pointerleave", () => this.release());
      this.prompt.append(btn);
    });
    if (!this.actions.length) this.prompt.append(h("p.dim", null, "Здесь больше нечего искать."));
  }

  private actionsKey = "";

  /** E / mouse down on the selected option. */
  press(i = this.sel) {
    this.holding = true;
    this.holdStart = performance.now();
    this.rushSent = false;
    this.trigger(i);
  }

  release() {
    if (!this.holding) return;
    this.holding = false;
    if (this.rushSent) net.send({ k: "srush", on: false });
    this.rushSent = false;
  }

  trigger(i = this.sel) {
    const a = this.actions[i];
    if (!a || a.reason) return;
    if (this.e?.tasks[net.priv?.char ?? ""]) return;
    if (a.a === "exit") net.send({ k: "expLeaveSite" });
    else net.send({ k: "sdo", a: a.a, id: a.id });
    audio.sfx("click", 0.5);
  }

  handleKeyUp(ev: KeyboardEvent): boolean {
    if (this.mode !== "site") return false;
    if (ev.code === "KeyE") {
      this.release();
      return true;
    }
    return false;
  }

  handleKey(ev: KeyboardEvent): boolean {
    if (this.mode === "map") {
      if (ev.code === "KeyC" || ev.code === "Enter") return false;
      return true; // movement keys do nothing on the map
    }
    if (this.mode !== "site") return false;
    switch (ev.code) {
      case "KeyE":
        if (this.e?.tasks[net.priv?.char ?? ""]) {
          // E during a task: a second press stops a careful search, holding speeds it up
          this.holding = true;
          this.holdStart = performance.now();
          this.rushSent = false;
          return true;
        }
        this.press();
        return true;
      case "KeyL":
        net.send({ k: "expLight" });
        audio.sfx("click");
        return true;
      case "ArrowUp":
      case "KeyZ":
        if (this.actions.length < 2 && ev.code === "ArrowUp") return false;
        this.sel = (this.sel - 1 + this.actions.length) % Math.max(1, this.actions.length);
        this.promptKey = "";
        return true;
      case "ArrowDown":
      case "KeyX":
        if (this.actions.length < 2 && ev.code === "ArrowDown") return false;
        this.sel = (this.sel + 1) % Math.max(1, this.actions.length);
        this.promptKey = "";
        return true;
      case "KeyG": {
        // throw a stone to lure threats away
        const stone = listSiteActions(this.e, this.e.site, net.myChar() as any, net.pub!.flags as any).find((a) => a.a === "stone");
        if (stone) net.send({ k: "sdo", a: "stone", id: "stone" });
        return true;
      }
      case "KeyI":
      case "Tab":
        this.openInventory();
        return true;
      case "Escape":
        this.selected = null;
        this.promptKey = "";
        net.send({ k: "sstop" });
        return true;
    }
    if (/^Digit[1-7]$/.test(ev.code)) {
      this.sel = Number(ev.code.slice(5)) - 1;
      this.trigger();
      return true;
    }
    return ["KeyB", "KeyH", "KeyQ", "Tab"].includes(ev.code);
  }

  // ---------------------------------------------------------------- operator & dialogs
  openOperator() {
    const render = () => {
      const e = this.e;
      if (!e) return closeModal();
      const cvs = document.createElement("canvas");
      cvs.width = 480;
      cvs.height = 200;
      const g = cvs.getContext("2d")!;
      g.fillStyle = "#0c1a10";
      g.fillRect(0, 0, 480, 200);
      if (e.site) {
        const s = e.site;
        const cw = Math.min(28, 460 / s.W),
          ch = Math.min(40, 180 / (s.H / 2));
        for (const r of s.rooms) {
          if (!r.revealed) continue;
          g.strokeStyle = "#5fdc7a";
          g.fillStyle = r.dark ? "#10301a" : "#184a26";
          g.fillRect(10 + r.x * cw, 10 + r.lv * ch, r.w * cw, ch - 4);
          g.strokeRect(10 + r.x * cw, 10 + r.lv * ch, r.w * cw, ch - 4);
          g.fillStyle = "#8fe0a0";
          g.font = "10px monospace";
          g.fillText(r.name, 12 + r.x * cw, 22 + r.lv * ch);
        }
        for (const t of s.threats) {
          g.fillStyle = "#ff5040";
          g.beginPath();
          g.arc(10 + t.x * cw, 10 + t.lv * ch + ch * 0.6, 4, 0, 7);
          g.fill();
        }
        for (const id of e.squad) {
          const c = net.pub!.chars[id];
          if (!c) continue;
          g.fillStyle = "#ffe08a";
          g.fillRect(10 + c.x * cw - 3, 10 + c.lv * ch + ch * 0.55, 6, 6);
        }
      } else {
        g.fillStyle = "#8fe0a0";
        g.font = "14px monospace";
        g.fillText(e.stage === "travel" ? "Отряд в пути…" : "Отряд на местности.", 20, 100);
      }
      const say = h("input", {
        placeholder: "Передать отряду по радио…",
        maxLength: 120,
        style: { flex: "1" },
      }) as HTMLInputElement;
      const box = h(
        "div.row",
        { style: { alignItems: "flex-start", gap: "12px" } },
        h("div", { style: { width: "360px" } }, this.svgMap()),
        h(
          "div.col",
          { style: { gap: "6px", width: "480px" } },
          h(
            "div",
            { style: { color: e.radio?.ok ? "var(--green)" : "var(--bad)" } },
            e.radio?.ok ? "📡 Связь устойчива" : "📡 " + (e.radio?.why ?? "нет связи"),
          ),
          h("div.dim", null, "План этажа (по мере открытия):"),
          cvs,
          h(
            "div.row",
            { style: { flexWrap: "wrap" } },
            h(
              "button.small",
              { onclick: () => (net.send({ k: "opScan" }), setTimeout(render, 400)) },
              "🔍 Подсветить опасности (0.5 кВт·ч)",
            ),
            h(
              "button.small",
              { onclick: () => (net.send({ k: "opCoord" }), setTimeout(render, 400)) },
              `🎯 Координация (+1 ОД в бою)${e.coord ? " ✔" : ""}`,
            ),
          ),
          h(
            "div.row",
            null,
            say,
            h(
              "button.small",
              { onclick: () => (say.value && net.send({ k: "opCall", text: say.value }), (say.value = "")) },
              "Передать",
            ),
          ),
          h(
            "div.exp-log",
            null,
            (e.log ?? []).slice(-8).map((l: string) => h("div", null, l)),
          ),
        ),
      );
      modal("📡 Связь с отрядом", box, { wide: true });
    };
    render();
  }

  openTalk(data: any) {
    const p = data.person;
    modal(
      `💬 ${p.name}`,
      h(
        "div.col",
        { style: { minWidth: "360px" } },
        h("div", { style: { fontFamily: "var(--serif)" } }, TALK_TEXT[p.kind] ?? "…"),
        data.options.map((o: any) =>
          h(
            "button",
            {
              style: { textAlign: "left" },
              onclick: () => (net.send({ k: "stalk", person: p.id, opt: o.id }), closeModal()),
            },
            o.label,
          ),
        ),
      ),
    );
  }
}

const BEAM_GEO = new THREE.ConeGeometry(0.9, 4, 12, 1, true);
const BEAM_MAT = new THREE.MeshBasicMaterial({
  color: 0xfff2c0,
  transparent: true,
  opacity: 0.1,
  depthWrite: false,
  side: THREE.DoubleSide,
});
const CONES: Record<number, THREE.ShapeGeometry> = {};
function coneGeo(dir: number) {
  if (!CONES[dir]) {
    const len = 4.5;
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(len * dir, 0.9);
    shape.lineTo(len * dir, -0.6);
    shape.lineTo(0, 0);
    CONES[dir] = new THREE.ShapeGeometry(shape);
  }
  return CONES[dir];
}

const TALK_TEXT: Record<string, string> = {
  survivor: "Худой человек с ружьём без патронов. «Не стреляйте. Я просто ищу, где переночевать».",
  family: "За шкафом — мать и двое детей. Дети смотрят на вас огромными глазами.",
  trader: "«Тише, тише! Торговля — не война. Что у вас есть?»",
  wounded: "Раненый стонет у стены: «Воды… или хоть бинт…»",
  patrol: "Двое в форме «Порядка» поднимают стволы: «Стоять! Кто такие?»",
};

export { BOX_NAMES };
