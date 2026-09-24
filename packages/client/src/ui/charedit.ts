// Редактор персонажа: create your own survivor or rework a dealt card — name, profession, stats
// (a fixed pool of points), traits, phobia and baggage, and the looks (clothes, headwear, skin, hair)
// with a live 3D preview of the same blocky figure used in the game.
import * as THREE from "three";
import { BAGGAGE, COLORS, CUSTOM_STAT_POINTS, PHOBIAS, PROFS, STAT_NAMES, TRAITS_MINUS, TRAITS_PLUS, type Card } from "@bunker/shared";
import { net } from "../net";
import { CharView, HAIR, HATS } from "../render/chars";
import { clear, closeModal, h, modal, toast } from "./dom";

const SKINS = [0xe0b48f, 0xc99873, 0xa8764f, 0xf0c9a5, 0x8d5e3c];
const hex = (n: number) => "#" + n.toString(16).padStart(6, "0");

export function openCharEditor(base?: Card) {
  const profs = Object.keys(PROFS).filter((k) => !PROFS[k].npcOnly);
  const card: any = base
    ? { ...base, stats: { ...base.stats }, skin: base.skin ?? 0, hair: base.hair ?? 0 }
    : { name: "", prof: profs[0], plus: Object.keys(TRAITS_PLUS)[0], minus: Object.keys(TRAITS_MINUS)[0], stats: { sil: 3, lov: 3, int: 3, vyn: 3, har: 3 }, color: COLORS[0], hat: PROFS[profs[0]].hat, gender: 0, age: 30, phobia: PHOBIAS[0], baggage: BAGGAGE[0], skin: 0, hair: 0 };
  // premade cards may carry more points than the editor allows: trim the highest stats
  const sum = () => Object.values(card.stats as Record<string, number>).reduce((a, b) => a + b, 0);
  while (sum() > CUSTOM_STAT_POINTS) {
    const k = Object.keys(card.stats).sort((a, b) => card.stats[b] - card.stats[a])[0];
    card.stats[k]--;
  }

  // ---- the preview
  const canvas = h("canvas.charedit-preview", { width: 240, height: 320 }) as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xd8c8b0, 1.3));
  const sun = new THREE.DirectionalLight(0xffe2b8, 1.6);
  sun.position.set(2, 4, 5);
  scene.add(sun);
  const cam = new THREE.PerspectiveCamera(30, 240 / 320, 0.1, 50);
  cam.position.set(0, 1.05, 4.2);
  cam.lookAt(0, 0.75, 0);
  let view: CharView | null = null;
  const rebuild = () => {
    if (view) scene.remove(view.root);
    view = new CharView("edit", card.color, card.hat, card.skin, card.hair);
    scene.add(view.root);
  };
  let raf = 0;
  let spin = 0.4;
  let last = performance.now();
  const loop = () => {
    const now = performance.now();
    const dt = (now - last) / 1000;
    last = now;
    if (view) {
      spin += dt * 0.6;
      view.update(dt, "idle", 0); // facing the camera
      view.root.rotation.y = Math.sin(spin) * 0.7;
    }
    renderer.render(scene, cam);
    raf = requestAnimationFrame(loop);
  };

  // ---- the form
  const form = h("div.charedit-form");
  const row = (label: string, ...els: any[]) => h("label.charedit-row", null, h("span", null, label), ...els);
  const select = (val: string, opts: [string, string][], on: (v: string) => void) =>
    h("select", { onchange: (e: Event) => on((e.target as HTMLSelectElement).value) }, opts.map(([v, l]) => h("option", { value: v, selected: v === val }, l)));
  const swatches = (list: number[], cur: number, on: (i: number) => void) =>
    h("div.swatches", null, list.map((c, i) => h("button.swatch" + (i === cur ? ".on" : ""), { style: { background: hex(c) }, onclick: (e: Event) => (e.preventDefault(), on(i)) })));
  const render = () => {
    clear(form);
    const left = CUSTOM_STAT_POINTS - sum();
    const nameIn = h("input", { value: card.name, maxLength: 24, placeholder: "Имя Фамилия" }) as HTMLInputElement;
    nameIn.addEventListener("input", () => (card.name = nameIn.value));
    const ageIn = h("input", { type: "number", min: 18, max: 80, value: card.age, style: { width: "64px" } }) as HTMLInputElement;
    ageIn.addEventListener("input", () => (card.age = Number(ageIn.value)));
    // two columns so the whole editor fits one screen: who you are and stats | character and looks
    const colA = h("div.charedit-col");
    const colB = h("div.charedit-col");
    form.append(colA, colB);
    colA.append(
      h("h4", null, "Кто вы"),
      row("Имя", nameIn),
      row("Пол", select(String(card.gender), [["0", "Мужской"], ["1", "Женский"]], (v) => ((card.gender = Number(v)), render())), h("span", null, " возраст "), ageIn),
      row(
        "Профессия",
        select(card.prof, profs.map((k) => [k, `${PROFS[k].icon} ${PROFS[k].name}`]), (v) => {
          card.prof = v;
          card.hat = PROFS[v].hat;
          rebuild();
          render();
        }),
      ),
      h("div.dim.charedit-hint", null, PROFS[card.prof]?.desc ?? ""),
      h("h4", null, `Характеристики · осталось очков: `, h("b", { class: left < 0 ? "bad" : "good" }, String(left))),
      ...Object.keys(STAT_NAMES).map((k) =>
        h(
          "div.charedit-stat",
          null,
          h("span", null, STAT_NAMES[k as keyof typeof STAT_NAMES]),
          h("button.small", { disabled: card.stats[k] <= 1, onclick: () => (card.stats[k]--, render()) }, "−"),
          h("b", null, "●".repeat(card.stats[k]) + "○".repeat(5 - card.stats[k])),
          h("button.small", { disabled: card.stats[k] >= 5 || left <= 0, onclick: () => (card.stats[k]++, render()) }, "+"),
        ),
      ),
    );
    colB.append(
      h("h4", null, "Характер"),
      row("Сильная черта", select(card.plus, Object.keys(TRAITS_PLUS).map((k) => [k, TRAITS_PLUS[k].name]), (v) => ((card.plus = v), render()))),
      h("div.dim.charedit-hint", null, TRAITS_PLUS[card.plus]?.desc),
      row("Слабость", select(card.minus, Object.keys(TRAITS_MINUS).map((k) => [k, TRAITS_MINUS[k].name]), (v) => ((card.minus = v), render()))),
      h("div.dim.charedit-hint", null, TRAITS_MINUS[card.minus]?.desc),
      row("Фобия", select(card.phobia, PHOBIAS.map((p) => [p, p]), (v) => (card.phobia = v))),
      row("Багаж", select(card.baggage, BAGGAGE.map((p) => [p, p]), (v) => (card.baggage = v))),
      h("h4", null, "Внешность"),
      row("Одежда", swatches(COLORS, COLORS.indexOf(card.color), (i) => ((card.color = COLORS[i]), rebuild(), render()))),
      row("Кожа", swatches(SKINS, card.skin, (i) => ((card.skin = i), rebuild(), render()))),
      row("Волосы", swatches(HAIR, card.hair, (i) => ((card.hair = i), rebuild(), render()))),
      row("Голова", select(String(card.hat), HATS.map((n, i) => [String(i), n]), (v) => ((card.hat = Number(v)), rebuild()))),
    );
  };
  rebuild();
  render();
  const body = h(
    "div.charedit",
    null,
    h("div.charedit-left", null, canvas, h("div.dim", null, "Скрытая личная цель выпадет случайно — как у всех.")),
    form,
  );
  const foot = h(
    "div.row",
    { style: { marginTop: "10px" } },
    h("div.grow"),
    h("button", { onclick: () => closeModal() }, "Отмена"),
    h(
      "button.primary",
      {
        onclick: () => {
          if ((card.name ?? "").trim().length < 2) return toast("Введите имя");
          if (sum() > CUSTOM_STAT_POINTS) return toast("Слишком много очков характеристик");
          net.send({ k: "customCard", card });
          closeModal();
        },
      },
      "✔ Играть этим персонажем",
    ),
  );
  modal(base ? "Изменить персонажа" : "Новый персонаж", [body, foot], {
    cls: "charedit-modal",
    onClose: () => {
      cancelAnimationFrame(raf);
      renderer.dispose();
    },
  });
  raf = requestAnimationFrame(loop);
}
