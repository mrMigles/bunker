// Фоновая музыка: generated live with WebAudio, one layer per mood, crossfaded by what is on screen.
//  bunker — warm pads and a slow plucked arpeggio (calm, a little homely);
//  night  — the same, slower and sparser (council, sleep);
//  sortie — a low drone, a heartbeat pulse and far, lonely notes (tense, quiet);
//  combat — drums, a driving minor bass ostinato and stabs.
// The radio ducks the soundtrack while it plays music.

export type Mood = "bunker" | "night" | "sortie" | "combat" | "silent";

interface Engine {
  ctx: AudioContext | null;
  noiseBuf: AudioBuffer;
}

const A2 = 110;
const hz = (semi: number) => A2 * 2 ** (semi / 12);

export class Soundtrack {
  mood: Mood = "silent";
  private layers = new Map<Mood, GainNode>();
  private out: GainNode | null = null;
  private duck = 1;
  private nextT = 0;
  private step = 0;
  private timer = 0;
  private seed = 7;

  constructor(private a: Engine) {}

  /** Connects to the music bus once the audio context exists. */
  attach(dest: AudioNode) {
    const ctx = this.a.ctx!;
    this.out = ctx.createGain();
    this.out.gain.value = 1;
    this.out.connect(dest);
    for (const m of ["bunker", "night", "sortie", "combat"] as Mood[]) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(this.out);
      this.layers.set(m, g);
    }
    this.nextT = ctx.currentTime + 0.2;
    this.timer = window.setInterval(() => this.schedule(), 120);
  }

  setMood(m: Mood) {
    const ctx = this.a.ctx;
    if (!ctx || !this.out || m === this.mood) return;
    const t = ctx.currentTime;
    // combat cuts in fast, everything else drifts in
    const fade = m === "combat" ? 0.6 : 3;
    for (const [k, g] of this.layers) g.gain.setTargetAtTime(k === m ? 1 : 0, t, fade / 3);
    if (this.mood === "silent" || m === "combat") this.step = 0;
    this.mood = m;
  }

  /** 1 = full, 0.25 = under the radio. */
  setDuck(v: number) {
    if (!this.a.ctx || !this.out || Math.abs(v - this.duck) < 0.02) return;
    this.duck = v;
    this.out.gain.setTargetAtTime(v, this.a.ctx.currentTime, 0.4);
  }

  private rand() {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  /** A note with an adjustable attack (pads swell, plucks snap). */
  private note(dest: AudioNode, freq: number, at: number, dur: number, type: OscillatorType, gain: number, attack = 0.01, detune = 0) {
    const ctx = this.a.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    const g = ctx.createGain();
    const t0 = ctx.currentTime + Math.max(0, at);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.setTargetAtTime(0.0001, t0 + Math.max(attack, dur * 0.6), dur * 0.35);
    o.connect(g).connect(dest);
    o.start(t0);
    o.stop(t0 + dur * 2 + attack);
  }

  private hit(dest: AudioNode, at: number, kind: "kick" | "snare" | "hat") {
    const ctx = this.a.ctx!;
    const t0 = ctx.currentTime + Math.max(0, at);
    if (kind === "kick") {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(110, t0);
      o.frequency.exponentialRampToValueAtTime(38, t0 + 0.18);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.5, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.28);
      o.connect(g).connect(dest);
      o.start(t0);
      o.stop(t0 + 0.3);
      return;
    }
    const s = ctx.createBufferSource();
    s.buffer = this.a.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = kind === "hat" ? "highpass" : "bandpass";
    f.frequency.value = kind === "hat" ? 7000 : 1600;
    const g = ctx.createGain();
    const len = kind === "hat" ? 0.05 : 0.16;
    g.gain.setValueAtTime(kind === "hat" ? 0.08 : 0.22, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + len);
    s.connect(f).connect(g).connect(dest);
    s.start(t0);
    s.stop(t0 + len + 0.02);
  }

  private schedule() {
    const ctx = this.a.ctx;
    if (!ctx || this.mood === "silent") return;
    const m = this.mood;
    const d = this.layers.get(m)!;
    const bpm = m === "combat" ? 132 : m === "sortie" ? 58 : m === "night" ? 54 : 68;
    const beat = 60 / bpm;
    const e8 = beat / 2;
    // after a silence or a throttled background tab: pick up from now instead of a burst of late notes
    if (this.nextT < ctx.currentTime - 0.1) this.nextT = ctx.currentTime + 0.05;
    while (this.nextT < ctx.currentTime + 0.5) {
      const at = this.nextT - ctx.currentTime;
      const s = this.step;
      if (m === "bunker" || m === "night") this.calm(d, at, s, beat, m === "night");
      else if (m === "sortie") this.tense(d, at, s, beat);
      else this.fight(d, at, s, beat);
      this.nextT += e8;
      this.step++;
    }
  }

  /** D-dorian-ish progression: Dm7 – G – Bbmaj7 – Am, warm pads and a plucked arpeggio. */
  private calm(d: AudioNode, at: number, s: number, beat: number, night: boolean) {
    const bar = Math.floor(s / 8);
    const sub = s % 8;
    const prog = [
      [5, 8, 12, 15], // Dm7
      [10, 14, 17, 21], // G
      [1, 5, 8, 12], // Bbmaj7
      [0, 3, 7, 12], // Am
    ][bar % 4];
    if (sub === 0) {
      // pad: two slightly detuned voices swelling over the bar
      for (const n of prog.slice(0, 3)) {
        this.note(d, hz(n + 12), at, beat * 4.2, "triangle", night ? 0.028 : 0.035, beat * 1.2, -6);
        this.note(d, hz(n + 12), at, beat * 4.2, "sine", night ? 0.03 : 0.04, beat * 1.2, 6);
      }
      this.note(d, hz(prog[0]), at, beat * 3.6, "sine", 0.09, 0.05);
    }
    // the arpeggio (a guitar or a music box somewhere in the next room)
    const play = night ? sub % 4 === 0 && this.rand() < 0.7 : sub % 2 === 0 || this.rand() < 0.25;
    if (play && !(bar % 8 === 7 && sub > 3)) {
      const n = prog[(sub / 2 + bar) % prog.length | 0] + 24 + (this.rand() < 0.15 ? 12 : 0);
      this.note(d, hz(n), at, beat * 1.4, "triangle", 0.05, 0.004);
      this.note(d, hz(n) * 2, at, beat * 0.5, "sine", 0.012, 0.004);
    }
  }

  /** A-minor drone, heartbeat, distant pentatonic calls. */
  private tense(d: AudioNode, at: number, s: number, beat: number) {
    const bar = Math.floor(s / 8);
    const sub = s % 8;
    if (sub === 0 && bar % 2 === 0) {
      this.note(d, hz(-12), at, beat * 8.5, "sine", 0.12, beat * 2);
      this.note(d, hz(-5), at, beat * 8.5, "triangle", 0.03, beat * 3, 4);
      if (bar % 4 === 2) this.note(d, hz(1), at, beat * 6, "sine", 0.025, beat * 3); // the uneasy minor second
    }
    // heartbeat
    if (sub === 0 || sub === 1) this.note(d, hz(-24 + 12), at, 0.18, "sine", sub === 0 ? 0.16 : 0.1, 0.005);
    // far away calls
    if (sub === 4 && this.rand() < 0.35) {
      const pent = [0, 3, 5, 7, 10, 12, 15];
      const n = pent[Math.floor(this.rand() * pent.length)] + 24;
      this.note(d, hz(n), at, beat * 3, "sine", 0.03, beat * 0.4);
    }
  }

  /** E-minor ostinato with drums. */
  private fight(d: AudioNode, at: number, s: number, beat: number) {
    const bar = Math.floor(s / 8);
    const sub = s % 8;
    const root = [7, 7, 3, 5][bar % 4] - 12; // E, E, C, D
    const bassLine = [0, 0, 12, 0, 7, 0, 12, 10];
    this.note(d, hz(root + bassLine[sub]), at, beat * 0.45, "sawtooth", 0.05, 0.005);
    this.note(d, hz(root + bassLine[sub] - 12), at, beat * 0.45, "sine", 0.1, 0.005);
    if (sub === 0 || sub === 4 || sub === 5) this.hit(d, at, "kick");
    if (sub === 2 || sub === 6) this.hit(d, at, "snare");
    this.hit(d, at, "hat");
    if (sub === 0 && bar % 2 === 1) for (const k of [0, 3, 7]) this.note(d, hz(root + 24 + k), at, beat * 1.5, "square", 0.018, 0.01);
  }
}
