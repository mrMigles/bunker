// Message types between client and server. Clients only send inputs/intents; the server simulates everything.

export const MSG = {
  // client → server
  input: "i", // movement input {seq, mx, my, run, dt}
  act: "a", // generic command {k: kind, ...}
  chat: "chat",
  // server → client
  snap: "s", // full view {p, m}
  patch: "p", // delta {p?, m?}
  fx: "fx", // transient effects
  err: "err",
} as const;

export interface InputMsg {
  seq: number;
  mx: number;
  my: number;
  run: boolean;
  dt: number;
}

/** Transient effect (sound, floating text, toast...). `to` limits delivery to one player. */
export interface Fx {
  k: "sound" | "float" | "shake" | "toast" | "loot" | "chat" | "flash" | "emote" | "bark" | "radio" | "music" | "news" | "tabletalk" | "rats" | "flicker" | "dust";
  x?: number;
  lv?: number;
  text?: string;
  id?: string;
  to?: string;
  color?: string;
  who?: string;
  data?: any;
}

export interface Cmd {
  k: string;
  [key: string]: any;
}
