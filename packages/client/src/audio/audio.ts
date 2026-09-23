// WebAudio synthesis: SFX, ambient, radio static, procedural music and instruments. No external files.

type Cat = "sfx" | "music" | "radio" | "ambient";

class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  cats = {} as Record<Cat, GainNode>;
  volumes: Record<Cat | "master", number> = { master: 0.8, sfx: 0.8, music: 0.6, radio: 0.7, ambient: 0.5 };
  noiseBuf!: AudioBuffer;
  // radio
  radioNoise: AudioBufferSourceNode | null = null;
  radioNoiseGain!: GainNode;
  radioMusicGain!: GainNode;
  radioFilter!: BiquadFilterNode;
  radioOut!: GainNode;
  // ambient hum
  hum: OscillatorNode | null = null;
  humGain!: GainNode;
  music: MusicGen | null = null;
  speech = false;

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem("bunker.volumes") ?? "null");
      if (saved) Object.assign(this.volumes, saved);
      this.speech = localStorage.getItem("bunker.speech") === "1";
    } catch {}
    const unlock = () => {
      this.init();
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
  }

  init() {
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
    } catch {
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    for (const c of ["sfx", "music", "radio", "ambient"] as Cat[]) {
      const g = ctx.createGain();
      g.connect(this.master);
      this.cats[c] = g;
    }
    this.applyVolumes();
    // white noise buffer
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // radio chain: (noise + music) → bandpass → out
    this.radioFilter = ctx.createBiquadFilter();
    this.radioFilter.type = "bandpass";
    this.radioFilter.frequency.value = 1400;
    this.radioFilter.Q.value = 0.7;
    this.radioOut = ctx.createGain();
    this.radioOut.gain.value = 0;
    this.radioFilter.connect(this.radioOut);
    this.radioOut.connect(this.cats.radio);
    this.radioNoiseGain = ctx.createGain();
    this.radioNoiseGain.gain.value = 0;
    this.radioNoiseGain.connect(this.radioFilter);
    this.radioMusicGain = ctx.createGain();
    this.radioMusicGain.gain.value = 0;
    this.radioMusicGain.connect(this.radioFilter);
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    n.loop = true;
    n.connect(this.radioNoiseGain);
    n.start();
    this.radioNoise = n;
    // generator hum
    this.hum = ctx.createOscillator();
    this.hum.type = "sawtooth";
    this.hum.frequency.value = 50;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 180;
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0;
    this.hum.connect(lp).connect(this.humGain).connect(this.cats.ambient);
    this.hum.start();
    this.music = new MusicGen(this);
  }

  applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = this.volumes.master;
    for (const c of ["sfx", "music", "radio", "ambient"] as Cat[]) this.cats[c].gain.value = this.volumes[c];
  }

  setVolume(cat: Cat | "master", v: number) {
    this.volumes[cat] = v;
    localStorage.setItem("bunker.volumes", JSON.stringify(this.volumes));
    this.applyVolumes();
  }

  /** Continuous ambience: generator load 0..1, radio audibility 0..1, clarity 0..1, station kind. */
  setAmbient(load: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.humGain.gain.setTargetAtTime(0.04 + load * 0.08, t, 0.5);
    this.hum!.frequency.setTargetAtTime(45 + load * 20, t, 0.5);
  }

  setRadio(audible: number, clarity: number, kind: string | null, genreSeed: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.radioOut.gain.setTargetAtTime(audible, t, 0.2);
    this.radioNoiseGain.gain.setTargetAtTime(audible > 0 ? 0.08 + (1 - clarity) * 0.5 : 0, t, 0.1);
    const musicOn = audible > 0 && kind === "music" && clarity > 0.2;
    this.radioMusicGain.gain.setTargetAtTime(musicOn ? clarity * 0.9 : 0, t, 0.3);
    if (musicOn) this.music?.play(genreSeed, this.radioMusicGain);
    else this.music?.stop();
  }

  noise(dur: number, freq: number, q: number, gain: number, dest?: AudioNode, at = 0) {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    const t0 = ctx.currentTime + at;
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    s.connect(f).connect(g).connect(dest ?? this.cats.sfx);
    s.start(t0);
    s.stop(t0 + dur + 0.05);
  }

  tone(freq: number, dur: number, type: OscillatorType, gain: number, dest?: AudioNode, at = 0, slideTo?: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    const t0 = ctx.currentTime + at;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(dest ?? this.cats.sfx);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  sfx(id: string, vol = 1) {
    if (!this.ctx) return;
    switch (id) {
      case "alarm":
        for (let i = 0; i < 3; i++) this.tone(600, 0.35, "square", 0.08 * vol, undefined, i * 0.4, 900);
        break;
      case "siren":
        for (let i = 0; i < 4; i++) this.tone(300, 1.2, "sawtooth", 0.07 * vol, undefined, i * 1.2, 800);
        break;
      case "break":
        this.noise(0.4, 900, 1, 0.5 * vol);
        this.tone(90, 0.3, "sine", 0.4 * vol, undefined, 0, 40);
        break;
      case "crack":
        for (let i = 0; i < 6; i++) this.noise(0.05, 2500 + Math.random() * 2000, 4, 0.3 * vol, undefined, i * 0.07 + Math.random() * 0.05);
        break;
      case "find":
        [0, 4, 7, 12].forEach((n, i) => this.tone(523 * 2 ** (n / 12), 0.25, "triangle", 0.12 * vol, undefined, i * 0.08));
        break;
      case "boom":
        this.noise(1.8, 120, 0.6, 1 * vol);
        this.tone(60, 1.5, "sine", 0.8 * vol, undefined, 0, 25);
        break;
      case "dig":
        this.noise(0.12, 300, 1.5, 0.3 * vol);
        break;
      case "click":
        this.tone(1200, 0.04, "square", 0.05 * vol);
        break;
      case "blip":
        this.tone(880, 0.08, "sine", 0.06 * vol);
        break;
      case "shot":
        this.noise(0.25, 1800, 0.8, 0.7 * vol);
        this.tone(140, 0.15, "square", 0.2 * vol, undefined, 0, 60);
        break;
      case "hit":
        this.noise(0.12, 600, 1.2, 0.5 * vol);
        break;
      case "step":
        this.noise(0.05, 400 + Math.random() * 200, 3, 0.06 * vol);
        break;
      case "card":
        this.noise(0.06, 3000, 2, 0.15 * vol);
        break;
      case "dice":
        for (let i = 0; i < 5; i++) this.noise(0.03, 2000 + i * 300, 5, 0.2 * vol, undefined, i * 0.06);
        break;
      case "door":
        this.tone(120, 0.6, "sawtooth", 0.08 * vol, undefined, 0, 60);
        this.noise(0.4, 400, 1, 0.2 * vol, undefined, 0.3);
        break;
      case "ring":
        // old intercom buzzer: two short rasps, twice
        for (let i = 0; i < 4; i++) this.tone(i % 2 ? 660 : 520, 0.22, "square", 0.06 * vol, undefined, i * 0.28 + (i > 1 ? 0.5 : 0));
        break;
      case "clang":
        this.tone(740, 0.5, "triangle", 0.2 * vol, undefined, 0, 520);
        this.noise(0.35, 2600, 2, 0.45 * vol);
        this.noise(0.25, 900, 1.5, 0.35 * vol, undefined, 0.12);
        break;
      case "wind":
        // a long howl in the vent shaft
        for (let i = 0; i < 3; i++) this.noise(2.2, 500 + i * 180, 6, 0.12 * vol, undefined, i * 0.7);
        this.tone(220, 3, "sine", 0.03 * vol, undefined, 0, 180);
        break;
      case "rumble":
        this.noise(2.6, 70, 0.5, 0.5 * vol);
        this.tone(38, 2.4, "sine", 0.35 * vol, undefined, 0, 28);
        break;
      case "nuke":
        // the flash: a pressure wave, then a long roll of thunder
        this.tone(30, 5, "sine", 1 * vol, undefined, 0, 18);
        this.noise(5.5, 90, 0.4, 1.2 * vol);
        this.noise(3, 400, 0.6, 0.5 * vol, undefined, 0.2);
        for (let i = 0; i < 6; i++) this.noise(1.2, 60 + i * 20, 0.5, 0.35 * vol, undefined, 1.5 + i * 0.6);
        break;
    }
  }

  /** Instrument note relative to A3 in semitones. */
  note(n: number, inst: string, vol = 0.8) {
    if (!this.ctx) return;
    const f = 220 * 2 ** (n / 12);
    const dest = this.cats.music;
    if (inst === "piano") {
      this.tone(f, 1.6, "sine", 0.18 * vol, dest);
      this.tone(f * 2, 0.8, "sine", 0.05 * vol, dest);
      this.tone(f * 3, 0.4, "triangle", 0.02 * vol, dest);
    } else if (inst === "harmonica") {
      this.tone(f * 2, 0.5, "square", 0.04 * vol, dest);
      this.tone(f * 2.005, 0.5, "sawtooth", 0.03 * vol, dest);
    } else {
      // guitar: bright pluck
      this.tone(f, 1.1, "triangle", 0.2 * vol, dest);
      this.tone(f * 2, 0.3, "sawtooth", 0.03 * vol, dest);
      this.noise(0.03, f * 4, 2, 0.08 * vol, dest);
    }
  }

  say(text: string) {
    if (!this.speech || !("speechSynthesis" in window)) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "ru-RU";
      u.rate = 1.05;
      u.pitch = 0.9;
      u.volume = Math.min(1, this.volumes.radio * this.volumes.master * 1.2);
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch {}
  }
}

// ---------------------------------------------------------------- procedural music

const SCALES: Record<string, number[]> = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  harmonic: [0, 2, 3, 5, 7, 8, 11],
  pentatonic: [0, 3, 5, 7, 10],
};

interface Genre {
  name: string;
  bpm: number;
  scale: string;
  prog: number[]; // scale degrees of chord roots
  lead: OscillatorType;
  swing: number;
  waltz?: boolean;
  drums: boolean;
}

export const GENRES: Genre[] = [
  { name: "lo-fi", bpm: 78, scale: "dorian", prog: [0, 3, 4, 3], lead: "triangle", swing: 0.12, drums: true },
  { name: "джаз", bpm: 96, scale: "dorian", prog: [1, 4, 0, 5], lead: "sine", swing: 0.2, drums: true },
  { name: "шансон", bpm: 88, scale: "harmonic", prog: [0, 3, 4, 0], lead: "sawtooth", swing: 0.05, drums: false },
  { name: "вальс", bpm: 120, scale: "minor", prog: [0, 3, 4, 0], lead: "triangle", swing: 0, waltz: true, drums: false },
  { name: "марш", bpm: 110, scale: "major", prog: [0, 4, 0, 3], lead: "square", swing: 0, drums: true },
  { name: "эмбиент", bpm: 60, scale: "pentatonic", prog: [0, 2, 3, 1], lead: "sine", swing: 0, drums: false },
];

class MusicGen {
  playing = false;
  genre = 0;
  timer: number | null = null;
  nextT = 0;
  step = 0;
  seed = 1;
  dest: AudioNode | null = null;
  constructor(private a: AudioEngine) {}

  rand() {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  play(genreSeed: number, dest: AudioNode) {
    const g = Math.abs(genreSeed) % GENRES.length;
    if (this.playing && g === this.genre) return;
    this.stop();
    this.genre = g;
    this.seed = genreSeed * 7919 + 13;
    this.dest = dest;
    this.playing = true;
    this.nextT = this.a.ctx!.currentTime + 0.1;
    this.step = 0;
    this.timer = window.setInterval(() => this.schedule(), 100);
  }

  stop() {
    this.playing = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  schedule() {
    const ctx = this.a.ctx!;
    const g = GENRES[this.genre];
    const beat = 60 / g.bpm;
    const perBar = g.waltz ? 3 : 4;
    const scale = SCALES[g.scale];
    while (this.nextT < ctx.currentTime + 0.4) {
      const bar = Math.floor(this.step / (perBar * 2));
      const sub = this.step % (perBar * 2); // eighth notes
      const root = g.prog[bar % g.prog.length];
      const at = this.nextT - ctx.currentTime + (sub % 2 ? g.swing * beat : 0);
      const deg = (d: number) => {
        const oct = Math.floor(d / scale.length);
        return scale[((d % scale.length) + scale.length) % scale.length] + oct * 12;
      };
      const base = 110; // A2
      const hz = (semi: number) => base * 2 ** (semi / 12);
      const d = this.dest!;
      // bass on beats
      if (sub === 0 || (!g.waltz && sub === 4)) this.a.tone(hz(deg(root)), beat * 1.6, "sine", 0.22, d, at);
      // chords
      if (g.waltz ? sub === 2 || sub === 4 : sub === 2 || sub === 6) {
        for (const k of [0, 2, 4]) this.a.tone(hz(deg(root + k) + 12), beat * 0.9, "triangle", 0.05, d, at);
      }
      // melody
      if (this.rand() < (g.name === "эмбиент" ? 0.2 : 0.55)) {
        const d2 = root + Math.floor(this.rand() * 7) - 1;
        this.a.tone(hz(deg(d2) + 24), beat * (this.rand() < 0.3 ? 1.4 : 0.6), g.lead, g.lead === "sawtooth" || g.lead === "square" ? 0.025 : 0.07, d, at);
      }
      // drums
      if (g.drums) {
        if (sub === 0 || sub === 4) this.a.tone(90, 0.18, "sine", 0.25, d, at, 40);
        if (sub % 2 === 1 || g.name === "марш") this.a.noise(0.05, 7000, 3, 0.04, d, at);
        if (sub === 4 && g.name !== "lo-fi") this.a.noise(0.12, 1800, 1, 0.08, d, at);
      }
      this.nextT += beat / 2;
      this.step++;
    }
  }
}

export const audio = new AudioEngine();
