import { STATIONS, clarity, stationAt, type Fx } from "@bunker/shared";
import { audio } from "../audio/audio";
import { net } from "../net";
import { add, clear, h, ui } from "./dom";

/** Radio tuner (when sitting at the radio) + teletype subtitles + audio mix. */
export class RadioUI {
  el = h("div.panel.radio-panel.hidden");
  dial = h("input", { type: "range", min: 70, max: 110, step: 0.1, style: { width: "100%" } }) as HTMLInputElement;
  label = h("div.radio-name");
  tele = h("div.teletype");
  lines: { text: string; who: string; t: number }[] = [];
  private typing: { text: string; shown: number } | null = null;
  private lastSend = 0;
  private dragging = false;

  constructor() {
    this.el.append(h("div.row", null, h("span", null, "📻"), this.label), h("div.radio-scale", null, this.scaleMarks()), this.dial, this.tele);
    ui().appendChild(this.el);
    this.dial.addEventListener("input", () => {
      this.dragging = true;
      const f = Number(this.dial.value);
      this.showStation(f);
      const now = performance.now();
      if (now - this.lastSend > 120) {
        this.lastSend = now;
        net.send({ k: "tune", f });
      }
    });
    this.dial.addEventListener("change", () => {
      this.dragging = false;
      net.send({ k: "tune", f: Number(this.dial.value) });
    });
    net.onFx.add((f) => this.onFx(f));
  }

  scaleMarks() {
    const el = h("div.radio-marks");
    for (const s of STATIONS) {
      el.appendChild(h("span", { style: { left: `${((s.freq - 70) / 40) * 100}%` }, title: s.name }, "▾"));
    }
    return el;
  }

  showStation(f: number) {
    const st = stationAt(f);
    clear(this.label);
    add(this.label, `${f.toFixed(1)} МГц — `, st ? h("b", null, st.name) : h("span.dim", null, "шипение…"), st ? h("span.dim", null, " " + st.desc) : null);
  }

  onFx(f: Fx) {
    if (f.k !== "radio" || !f.text) return;
    if (!this.audible()) return;
    this.lines.push({ text: f.text, who: f.who ?? "", t: performance.now() });
    if (this.lines.length > 4) this.lines.shift();
    this.typing = { text: f.text, shown: 0 };
    audio.say(f.text);
  }

  audible(): number {
    const v = net.pub;
    if (!v || !v.radio?.on) return 0;
    const radio = Object.values(v.objs).find((o: any) => o.kind === "radio") as any;
    if ((window as any).__game?.aquarium) return 0.55;
    const c = net.myChar();
    if (!c || !radio) return 0;
    if (c.lv !== radio.lv) return Math.abs(c.lv - radio.lv) === 1 && Math.abs(c.x - radio.x) < 6 ? 0.15 : 0;
    const d = Math.abs(c.x - (radio.x + 0.5));
    return d < 2 ? 1 : d < 10 ? 1 - (d - 2) / 9 : 0;
  }

  frame() {
    const v = net.pub;
    const me = net.myChar();
    const listening = me?.task?.action === "listen_radio";
    this.el.classList.toggle("hidden", !listening);
    if (listening && !this.dragging) {
      if (Math.abs(Number(this.dial.value) - v!.radio.freq) > 0.05) this.dial.value = String(v!.radio.freq);
      this.showStation(v!.radio.freq);
    }
    // teletype
    if (this.typing) {
      this.typing.shown = Math.min(this.typing.text.length, this.typing.shown + 2);
      clear(this.tele);
      const prev = this.lines.slice(0, -1).slice(-2);
      for (const l of prev) this.tele.append(h("div.dim", null, l.text));
      this.tele.append(h("div", null, this.typing.text.slice(0, this.typing.shown), this.typing.shown < this.typing.text.length ? "▌" : ""));
      if (this.typing.shown >= this.typing.text.length) this.typing = null;
    }
    // audio mix
    const aud = this.audible();
    const f = v?.radio?.freq ?? 90;
    const st = stationAt(f);
    audio.setRadio(aud * 0.9, clarity(f), st?.kind ?? null, (v?.day ?? 1) + STATIONS.indexOf(st ?? STATIONS[0]) * 3);
  }
}

/** Instrument keyboard: A S D F G H J K L ; → notes of a pentatonic scale (you can't play a wrong note). */
export class InstrumentUI {
  el = h("div.panel.instr-panel.hidden");
  keys = ["KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK", "KeyL", "Semicolon"];
  scale = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22];
  active = false;
  constructor() {
    this.el.append(h("div", null, "🎶 Играйте клавишами ", h("b", null, "A S D F G H J K L ;"), h("span.dim", null, " — ноты подстроены под лад. Шаг — перестать.")));
    const row = h("div.row", { style: { marginTop: "6px" } });
    this.keys.forEach((k, i) => row.appendChild(h("div.instr-key", { onmousedown: () => this.play(i) }, k.replace("Key", "").replace("Semicolon", ";"))));
    this.el.appendChild(row);
    ui().appendChild(this.el);
    net.onFx.add((f) => {
      if (f.k !== "music") return;
      const v = net.pub;
      const me = net.myChar();
      const d = f.data ?? {};
      if (d.who === me?.id) return; // already played locally
      const aq = (window as any).__game?.aquarium;
      if (!aq && (!me || me.lv !== f.lv || Math.abs(me.x - (f.x ?? 0)) > 10)) return;
      audio.note(d.n, d.inst, (d.v ?? 0.8) * (aq ? 0.6 : 1));
      void v;
    });
  }

  handleKey(e: KeyboardEvent): boolean {
    if (!this.active) return false;
    const i = this.keys.indexOf(e.code);
    if (i < 0) return false;
    this.play(i);
    return true;
  }

  play(i: number) {
    const me = net.myChar();
    const inst = me?.task?.action === "play_piano" ? "piano" : me?.task?.action === "play_harmonica" ? "harmonica" : "guitar";
    const n = this.scale[i];
    audio.note(n, inst, 0.9);
    net.send({ k: "note", n, v: 0.9 });
    const el = this.el.querySelectorAll(".instr-key")[i] as HTMLElement;
    el?.classList.add("on");
    setTimeout(() => el?.classList.remove("on"), 150);
  }

  frame() {
    const me = net.myChar();
    this.active = !!me?.task && ["play_guitar", "play_guitar_stand", "play_piano", "play_harmonica"].includes(me.task.action);
    this.el.classList.toggle("hidden", !this.active);
  }
}

/** Daytime vote (stranger at the door etc.). */
export class DayVoteUI {
  el = h("div.panel.dayvote.hidden");
  private key = "";
  constructor() {
    ui().appendChild(this.el);
  }
  update() {
    const v = net.pub;
    const vote = v?.vote;
    if (!v || !vote || v.phase !== "day") {
      this.el.classList.add("hidden");
      this.key = "";
      return;
    }
    this.el.classList.remove("hidden");
    const me = net.priv!.pid;
    const left = Math.max(0, Math.ceil(vote.ends - v.phaseT));
    const key = JSON.stringify([vote, left]);
    if (key === this.key) return;
    this.key = key;
    clear(this.el);
    const tallies = vote.options.map(() => 0);
    for (const pid in vote.votes) tallies[vote.votes[pid]] += 1;
    this.el.append(
      h("div.row", null, h("b", { style: { color: "var(--warm)" } }, "🗳 " + vote.title), h("div.grow"), vote.result === undefined ? h("span", null, `⏱ ${left}с`) : null),
      h("div", { style: { fontFamily: "var(--serif)", margin: "6px 0" } }, vote.text),
      vote.result === undefined
        ? h(
            "div.col",
            { style: { gap: "4px" } },
            vote.options.map((o: any, i: number) => h("button.small" + (vote.votes[me] === i ? ".primary" : ""), { disabled: o.disabled, style: { textAlign: "left" }, onclick: () => net.send({ k: "vote", day: 1, i }) }, `${o.label} `, o.desc ? h("span.dim", null, o.desc) : null, h("span", { style: { float: "right" } }, "🗳" + tallies[i]))),
          )
        : h("div.good", null, `Решено: «${vote.options[vote.result]?.label}». ${vote.resultText ?? ""}`),
    );
  }
}
