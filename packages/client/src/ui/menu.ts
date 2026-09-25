import { SERVER, net } from "../net";
import { h, ui } from "./dom";
import { icon } from "./icons";

export function showMenu(onJoined: () => void) {
  document.querySelector(".menu")?.remove();
  const name = h("input", { placeholder: "Ваше имя", maxLength: 16, value: localStorage.getItem("bunker.name") ?? "", "aria-label": "Ваше имя" }) as HTMLInputElement;
  const code = h("input", { placeholder: "КОД", maxLength: 5, "aria-label": "Код бункера" }) as HTMLInputElement;
  const priv = h("input", { type: "checkbox" }) as HTMLInputElement;
  const err = h("div.menu-err");
  const rooms = h("div.rooms-list", null, h("div.dim", null, "Загрузка…"));
  // a chat bunker (T…) opens only from Telegram: no «Вернуться» to it from the web menu
  const last = localStorage.getItem("bunker.lastCode")?.replace(/^T.*/, "") || null;

  const go = async (fn: () => Promise<void>) => {
    err.textContent = "";
    localStorage.setItem("bunker.name", name.value.trim());
    try {
      await fn();
      root.remove();
      onJoined();
    } catch (e: any) {
      err.textContent = e?.message ?? String(e);
    }
  };
  const join = (c: string) => go(() => net.join(c, name.value));

  const root = h(
    "div.menu",
    null,
    h(
      "div.menu-col",
      null,
      h("div.logo", null, "ГЛУБЖЕ"),
      h("div.tagline", null, "Кооперативное выживание в бункере на 1–6 человек.", h("br"), "Копайте вглубь. Держитесь вместе."),
      h(
        "div.panel.menu-card",
        null,
        h("label.field", null, icon("user"), name),
        h(
          "div.menu-row",
          null,
          h("button.primary.big", { onclick: () => go(() => net.create(name.value, { private: priv.checked })) }, icon("hatch"), "Создать бункер"),
          h("label.check", { title: "Приватный бункер не видно в списке — вход только по коду" }, priv, "приватный"),
        ),
        h(
          "div.menu-row",
          null,
          h("label.field.code-field", null, icon("key"), code),
          h("button", { onclick: () => join(code.value) }, icon("enter"), "Войти по коду"),
          last ? h("button", { onclick: () => join(last) }, icon("users"), `Вернуться в ${last}`) : null,
        ),
        err,
      ),
      h(
        "div.panel.rooms-card",
        null,
        h("div.sect-h", null, h("span", null, icon("users"), " Открытые бункеры"), h("button.small.ghost.icon-btn", { title: "Обновить", onclick: () => refresh() }, icon("refresh"))),
        rooms,
      ),
      h("div.menu-foot", null, h("span", null, icon("users"), "до 6 игроков"), h("span", null, icon("bot"), "боты занимают пустые места"), h("span", null, icon("phone"), "играется и с телефона")),
    ),
  );
  code.addEventListener("keydown", (e) => {
    if (e.key === "Enter") join(code.value);
  });
  code.addEventListener("input", () => (code.value = code.value.toUpperCase()));
  ui().appendChild(root);
  if (!matchMedia("(pointer: coarse)").matches) name.focus();

  const row = (c: string, day: number | string, phase: string, who: string, n: string | null, saved = false) =>
    h(
      "div.room-row",
      { onclick: () => join(c), role: "button", tabindex: 0 },
      icon(saved ? "box" : "hatch"),
      h("b", null, c),
      h("span.dim", null, day ? `${phase} ${day}` : phase),
      h("span.who", null, who || "пусто"),
      n ? h("span.cnt", null, icon("user"), n) : h("span"),
    );

  async function refresh() {
    try {
      const [list, saves] = await Promise.all([fetch(`${SERVER}/api/rooms`).then((r) => r.json()), fetch(`${SERVER}/api/saves`).then((r) => r.json())]);
      rooms.innerHTML = "";
      if (!list.length && !saves.length) rooms.appendChild(h("div.dim", null, "Пока никого. Создайте свой!"));
      for (const r of list) {
        const players = r.meta?.players ?? [];
        rooms.appendChild(row(r.code, r.meta?.day ?? "", r.meta?.day ? "день" : phaseName(r.meta?.phase), players.join(", "), `${players.length}/6`));
      }
      const live = new Set(list.map((r: any) => r.code));
      for (const s of saves) {
        if (live.has(s.code)) continue;
        rooms.appendChild(row(s.code, s.day, "день", JSON.parse(s.players).join(", "), null, true));
      }
    } catch {
      rooms.innerHTML = "";
      rooms.appendChild(h("div.bad", null, "Сервер недоступен"));
    }
  }
  refresh();
  const iv = setInterval(() => (document.body.contains(root) ? refresh() : clearInterval(iv)), 4000);
}

export function phaseName(p: string) {
  return ({ lobby: "лобби", prologue: "пролог", day: "день", night: "ночь", ending: "финал" } as any)[p] ?? p ?? "";
}
