import { SERVER, net } from "../net";
import { h, ui } from "./dom";

export function showMenu(onJoined: () => void) {
  const name = h("input", { placeholder: "Ваше имя", maxLength: 16, value: localStorage.getItem("bunker.name") ?? "" }) as HTMLInputElement;
  const code = h("input", { placeholder: "КОД", maxLength: 5, style: { width: "110px", textTransform: "uppercase", letterSpacing: "4px" } }) as HTMLInputElement;
  const priv = h("input", { type: "checkbox" }) as HTMLInputElement;
  const err = h("div.bad", { style: { minHeight: "18px" } });
  const rooms = h("div.rooms", null, h("div.dim", null, "Загрузка…"));
  const last = localStorage.getItem("bunker.lastCode");

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

  const root = h(
    "div.menu",
    null,
    h(
      "div.panel.box",
      null,
      h("h1", null, "ГЛУБЖЕ"),
      h("div.sub", null, "Кооперативное выживание в бункере на 1–6 человек. Копайте вглубь. Держитесь вместе."),
      h("div.col", null, name),
      h("div", { style: { height: "12px" } }),
      h(
        "div.row",
        null,
        h("button.primary", { onclick: () => go(() => net.create(name.value, { private: priv.checked })) }, "Создать бункер"),
        h("label.row.dim", null, priv, "приватный"),
      ),
      h("div", { style: { height: "12px" } }),
      h("div.row", null, code, h("button", { onclick: () => go(() => net.join(code.value, name.value)) }, "Войти по коду"), last ? h("button", { onclick: () => go(() => net.join(last, name.value)) }, `Вернуться в ${last}`) : null),
      h("div", { style: { height: "12px" } }),
      h("div.dim", null, "Открытые бункеры:"),
      rooms,
      err,
      h("div.dim", { style: { fontSize: "11px", marginTop: "8px" } }, "A/D — ходьба · W/S — лестницы · E — действие · Q — бросить · B — стройка · H — «Аквариум» · F — камера к себе"),
    ),
  );
  code.addEventListener("keydown", (e) => {
    if (e.key === "Enter") go(() => net.join(code.value, name.value));
  });
  ui().appendChild(root);
  name.focus();

  const refresh = async () => {
    try {
      const [list, saves] = await Promise.all([fetch(`${SERVER}/api/rooms`).then((r) => r.json()), fetch(`${SERVER}/api/saves`).then((r) => r.json())]);
      rooms.innerHTML = "";
      if (!list.length && !saves.length) rooms.appendChild(h("div.dim", null, "Пока никого. Создайте свой!"));
      for (const r of list) {
        rooms.appendChild(
          h(
            "div.roomrow",
            { onclick: () => go(() => net.join(r.code, name.value)) },
            h("span", null, `${r.code} · ${phaseName(r.meta?.phase)} ${r.meta?.day ? "· день " + r.meta.day : ""}`),
            h("span.dim", null, (r.meta?.players ?? []).join(", ") || "пусто"),
          ),
        );
      }
      const live = new Set(list.map((r: any) => r.code));
      for (const s of saves) {
        if (live.has(s.code)) continue;
        rooms.appendChild(
          h(
            "div.roomrow",
            { onclick: () => go(() => net.join(s.code, name.value)) },
            h("span", null, `💾 ${s.code} · день ${s.day}`),
            h("span.dim", null, JSON.parse(s.players).join(", ")),
          ),
        );
      }
    } catch {
      rooms.innerHTML = "";
      rooms.appendChild(h("div.bad", null, "Сервер недоступен"));
    }
  };
  refresh();
  const iv = setInterval(() => (document.body.contains(root) ? refresh() : clearInterval(iv)), 4000);
}

export function phaseName(p: string) {
  return ({ lobby: "лобби", prologue: "пролог", day: "день", night: "ночь", ending: "финал" } as any)[p] ?? p ?? "";
}
