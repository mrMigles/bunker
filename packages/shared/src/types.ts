import type { RngState } from "./rng";

export type Phase = "lobby" | "prologue" | "day" | "night" | "ending";
export type Storyteller = "haven" | "classic" | "scorched";

export interface Settings {
  dayLength: number; // real seconds for 06:00→22:00
  nightLength: number; // max real seconds for council
  residents: number; // total residents (players + bots), 1..6
  storyteller: Storyteller;
  short: boolean; // 10-day mode
  traitor: boolean; // "Засланец"
  combatTurnTime: number; // seconds
  tableTurnTime: number; // seconds
  tableLeave: "bot" | "pause";
  skipPrologue: boolean;
  /** residents plan rooms and send scavenging runs themselves when players don't */
  botInitiative: boolean;
}

export type StatId = "sil" | "lov" | "int" | "vyn" | "har";
export type SkillId = "repair" | "medicine" | "cooking" | "shooting" | "melee" | "digging" | "radio" | "stealth";
export type NeedId = "food" | "water" | "energy" | "sanity" | "health" | "rad";

export type Stats = Record<StatId, number>;
export type Needs = Record<NeedId, number>;

export interface Card {
  name: string;
  prof: string;
  plus: string;
  minus: string;
  goal: string;
  stats: Stats;
  color: number;
  hat: number;
  gender: 0 | 1;
  age: number;
  phobia: string;
  baggage: string;
  birthday: number; // day number of birthday within the game
  /** looks: skin tone 0..4, hair colour 0..5 (clothes = color, headwear = hat) */
  skin?: number;
  hair?: number;
  /** made in the character editor */
  custom?: boolean;
  /** a Telegram player's resident: carries their Telegram name (and avatar on screen) */
  tg?: boolean;
}

export interface HandItem {
  item: string;
  n: number;
}

export interface Task {
  obj?: string; // object id
  item?: string; // floor item id
  cell?: number; // grid cell index for digging
  room?: string;
  action: string;
  t: number; // progress seconds
  dur: number; // seconds needed (0 = continuous)
  hold: boolean; // cancelled when player releases E
  helper?: boolean;
  /** seat index at a shared table; standing = no seat was free */
  seat?: number;
  standing?: boolean;
}

export interface Bark {
  text: string;
  t: number; // seconds left
  to?: string; // talking to char id
}

export interface BotMind {
  plan: string; // current intention id
  target?: string; // obj id / item id / char id
  cell?: number;
  chore?: string; // reserved chore id
  path?: number[]; // cached waypoints (packed node ids)
  thought: string; // human readable reason
  barkCd: number;
  idleT: number;
  stuckT: number;
  lastX?: number;
  talkCd: number;
  wanderX?: number;
  act?: { a: string; tt: string; t: string; param?: any };
  dest?: { x: number; lv: number };
  stage?: number;
  until?: number; // phaseT at which the current leisure ends
  thinkT?: number;
  cdir?: number; // climbing direction while following a path
  lastBark?: string;
  /** game hour (day*24+hour) until which this bot does not take the bike again */
  pedalRest?: number;
  /** day of the last morning coffee */
  coffeeDay?: number;
}

export type CharStatus = "ok" | "down" | "dead" | "away" | "breakdown";

export interface Char {
  id: string;
  card: Card;
  needs: Needs;
  skills: Record<SkillId, number>; // xp; level = floor(sqrt(xp/10))+1
  x: number; // horizontal position in cells (center of body)
  y: number; // feet position in cells (y grows downward)
  lv: number; // current level (floor index), -1 = surface
  dir: -1 | 1;
  mx: number; // movement input -1..1
  my: number; // ladder input -1..1
  run: boolean;
  climbing: boolean;
  task: Task | null;
  hands: HandItem[];
  stash: Record<string, number>; // personal hidden stash
  ctrl: string | null; // player id controlling, null → bot
  mind: BotMind;
  status: CharStatus;
  downT: number;
  /** what put them down: «жажда», «голод», «ранение в бою»… (#22) */
  downCause?: string;
  breakT: number;
  anim: string; // idle, walk, work, sleep, sit, climb, dance...
  bark: Bark | null;
  rel: Record<string, number>;
  slept: boolean; // slept in a bed today
  meal: number; // meals eaten today
  seq: number; // last processed input seq (for prediction)
  emote: { id: string; t: number } | null;
  drunk: number;
  sick: number; // illness severity 0..100
  injury: string | null;
  legacy: number;
  seat?: string; // seat object id when sitting (table)
  npc: boolean; // joined during game
  pinned?: string; // chore pinned by player
  deathCause?: string;
  /** progression */
  xp?: number;
  level?: number;
  perks?: string[];
  perkOffer?: string[];
  perkPending?: number;
  /** own gear, taken out of the common storage */
  equip?: { weapon?: string; armor?: string; tool?: string };
}

export type TerrainId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
// 0 air/dug, 1 soil, 2 clay, 3 stone, 4 granite, 5 water pocket, 6 old concrete, 7 bedrock

export type RoomState = "plan" | "dig" | "frame" | "done";

export interface RoomInst {
  id: string;
  type: string;
  x: number;
  lv: number;
  w: number;
  state: RoomState;
  work: number; // frame work progress seconds
  level: number; // upgrade level 1..3
  dirt: number; // 0..100
  fire: number; // 0..100 fire intensity
  flood: number; // 0..100 water level
  dmg: number; // 0..100 structural damage
  comfort: number; // computed 0..100
  lit: boolean; // has light power
  name?: string;
  sturdy?: boolean; // pre-war concrete: never collapses and supports neighbours
  paid?: boolean; // construction materials already paid
  /** where a ladder appears once dug: rooms placed directly above/below another room get their own stairs */
  stair?: { x: number; lv: number };
}

export interface Obj {
  id: string;
  kind: string;
  x: number; // cell x (left)
  lv: number;
  room?: string;
  wear: number; // 0..100 (100 = fresh)
  broken: boolean;
  on: boolean;
  st: Record<string, any>; // kind-specific state
}

export interface FloorItem {
  id: string;
  item: string;
  n: number;
  x: number;
  lv: number;
}

export interface Chore {
  id: string;
  kind: string;
  obj?: string;
  room?: string;
  item?: string;
  cell?: number;
  char?: string;
  urgency: number; // 0..1
  by?: string; // reserved by char id
  pinnedBy?: string;
  prio?: boolean;
  created: number;
  /** nobody could find a way to it: no bot takes it again before this game hour (day*24+hour) */
  noPath?: number;
}

export interface Power {
  battery: number; // kWh stored
  cap: number; // kWh capacity
  gen: number; // kW current generation
  use: number; // kW current demand satisfied
  demand: number; // kW demanded
  prio: string[]; // consumer group priority order
  off: string[]; // groups shut down due to shortage
}

export interface LogEntry {
  t: number; // day*1000+hour-ish ordering key
  day: number;
  text: string;
  kind: "info" | "good" | "bad" | "event" | "chat" | "radio" | "system";
  who?: string;
}

export interface VoteOption {
  label: string;
  desc?: string;
  disabled?: boolean;
}

export interface Vote {
  id: string;
  kind: "event" | "ration" | "elder" | "custom" | "admit";
  title: string;
  text: string;
  options: VoteOption[];
  votes: Record<string, number>; // player id → option index
  ends: number; // phaseT at which it ends
  result?: number;
  resultText?: string;
  eventId?: string;
  data?: any;
}

export interface Council {
  step: "rations" | "event" | "plan" | "done";
  stepEnds: number;
  ready: Record<string, boolean>;
  rations: Record<string, number>; // char id → multiplier (0, 0.5, 1, 2)
  proposals: { id: string; by: string; char: string; mult: number; votes: Record<string, boolean>; done?: boolean }[];
  notes: { by: string; text: string }[];
  vote: Vote | null;
  sleepers: Record<string, string>; // char → bed obj
}

export interface Timer {
  at: number; // absolute day
  kind: string;
  data?: any;
}

export interface GazetteIssue {
  day: number;
  headline: string;
  lines: string[];
  joke: string;
  weather: string;
  best?: string;
  reader?: { by: string; text: string }[];
}

export interface Director {
  tension: number; // 0..100
  quiet: number; // guaranteed quiet days remaining
  lastRaidDay: number;
  raidWarn: number; // day at which raid is scheduled, 0 none
  raidKind?: string;
  raidEntry?: string;
}

export interface Pet {
  kind: "dog" | "cat" | "roach";
  name: string;
  x: number;
  lv: number;
  mood: number;
  fed: number;
  anim: string;
  tx?: number;
  tlv?: number;
}

export interface DayStats {
  dug: Record<string, number>;
  harvest: Record<string, number>;
  chores: Record<string, number>;
  cooked: Record<string, number>;
  events: string[];
  deaths: string[];
  wins: Record<string, number>;
  ate: Record<string, number>;
}

export interface Player {
  id: string; // stable player id (token)
  name: string;
  char: string | null; // controlled char id
  online: boolean;
  ready: boolean;
  host: boolean;
  color: number;
  cards?: Card[]; // offered cards in lobby (private)
  pick?: number;
  ghost: boolean; // dead, voice mode
  aquarium: boolean;
  table?: string;
  joinedDay: number;
}

/** «Начать заново» mid-game: one asks, anyone else (in the game or in the Telegram chat) agrees */
export interface RestartVote {
  by: string;
  name: string;
  /** game day it was asked on: it lapses with the next morning */
  day: number;
}

export interface World {
  v: number;
  code: string;
  seed: number;
  rng: RngState;
  settings: Settings;
  phase: Phase;
  phaseT: number;
  day: number;
  hour: number; // game hour 0..24
  speed: number; // time multiplier (1, 3 when skipping)
  paused: boolean;
  W: number;
  H: number;
  grid: number[];
  dig: Record<string, number>; // cell → progress 0..1
  marks: Record<string, string>; // cell → room id (planned digging)
  finds: Record<string, string>; // hidden: cell → find id
  found: Record<string, string>; // revealed finds: cell → find id
  ladders: Record<string, number>; // "x,lv" → 1 ladder connects lv-1 and lv at column x
  rooms: Record<string, RoomInst>;
  objs: Record<string, Obj>;
  items: Record<string, FloorItem>;
  chars: Record<string, Char>;
  players: Record<string, Player>;
  res: Record<string, number>;
  power: Power;
  air: { co2: number; filterOffT: number };
  chores: Record<string, Chore>;
  council: Council | null;
  vote: Vote | null; // daytime vote (e.g. admit stranger)
  flags: Record<string, number>;
  timers: Timer[];
  log: LogEntry[];
  gazette: GazetteIssue[];
  stats: DayStats;
  director: Director;
  notice: number; // Заметность 0..100
  pet: Pet | null;
  elder: string | null; // player id of the elder
  nextId: number;
  archive: string[]; // newspaper clipping ids found
  unread: string[]; // clippings found but not yet read
  tapes: string[];
  books: string[];
  films: string[];
  games: string[]; // board games on shelf
  recipes: string[]; // discovered recipes
  tech: string[];
  research: { id: string; progress: number } | null;
  factions: Record<string, number>;
  canvas: string; // wall drawing pixels (base64-ish palette indices)
  radio: { station: number; on: boolean; freq: number; by?: string };
  restart?: RestartVote | null;
  mods: Record<string, any>; // other subsystem state (expedition, combat, raid, tables, prologue)
  ending: { kind: string; text: string } | null;
  temp: number; // outside temperature factor
  weather: { today: string; forecast: string[] };
  history: { day: number; id: string; choice: number }[]; // resolved events, for chronicle & tests
  /** transient effects queue, drained by the server each tick; never saved or diffed */
  fx?: Fx[];
}

import type { Fx } from "./net/protocol";
