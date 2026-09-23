import { Rng, type RngState } from "../rng";
import { registerGame, type BoardGame } from "./framework";

const nextOf = (players: string[], p: string, ok: (q: string) => boolean = () => true) => {
  const n = players.length;
  let i = players.indexOf(p);
  for (let k = 0; k < n; k++) {
    i = (i + 1) % n;
    if (ok(players[i])) return players[i];
  }
  return p;
};

// ================================================================ «Пустошь» — co-op against the deck
// The table travels through the wasteland. Each round a threat card is revealed; on their turn
// every survivor fights, scavenges, builds the shelter, or patches someone up. When everyone has
// acted, the unresolved threat strikes. Win: shelter 8 before the doom track reaches 10.

export const WASTE_THREATS: { name: string; str: number; dmg: number; doom: number }[] = [
  { name: "Стая крыс", str: 4, dmg: 1, doom: 1 },
  { name: "Кислотный дождь", str: 5, dmg: 1, doom: 2 },
  { name: "Мародёры", str: 7, dmg: 2, doom: 1 },
  { name: "Песчаная буря", str: 6, dmg: 1, doom: 2 },
  { name: "Мутант", str: 8, dmg: 2, doom: 1 },
  { name: "Радиационный фронт", str: 6, dmg: 1, doom: 3 },
  { name: "Дикие псы", str: 5, dmg: 1, doom: 1 },
  { name: "Обвал", str: 7, dmg: 1, doom: 2 },
  { name: "Тишина", str: 0, dmg: 0, doom: 0 },
  { name: "Караван", str: 0, dmg: 0, doom: -1 },
];

interface WasteState {
  players: string[];
  hp: Record<string, number>;
  supplies: number;
  shelter: number;
  doom: number;
  threat: { name: string; str: number; dmg: number; doom: number } | null;
  deck: number[];
  turn: string;
  acted: string[];
  round: number;
  rng: RngState;
  last: string;
}

type WasteMove = { t: "fight" } | { t: "scavenge" } | { t: "build" } | { t: "heal"; who: string } | { t: "rest" };

function wsAlive(s: WasteState) {
  return s.players.filter((p) => s.hp[p] > 0);
}

function wsDraw(s: WasteState, rng: Rng) {
  if (!s.deck.length) s.deck = rng.shuffle(WASTE_THREATS.map((_, i) => i));
  const t = WASTE_THREATS[s.deck.pop()!];
  s.threat = t.str > 0 ? { ...t } : null;
  if (!s.threat) {
    s.doom = Math.max(0, s.doom + t.doom);
    s.last = `Карта: ${t.name}`;
  } else s.last = `Угроза: ${t.name} (сила ${t.str})`;
}

function wsEndRound(s: WasteState, rng: Rng) {
  if (s.threat) {
    s.doom += s.threat.doom;
    const alive = wsAlive(s);
    const victim = rng.pick(alive);
    s.hp[victim] = Math.max(0, s.hp[victim] - s.threat.dmg);
    s.last = `${s.threat.name} бьёт по ${victim}`;
  }
  s.supplies = Math.max(0, s.supplies - 1); // the road eats
  s.round++;
  s.acted = [];
  wsDraw(s, rng);
}

const wasteland: BoardGame<WasteState, WasteMove> = {
  id: "wasteland",
  name: "«Пустошь» (кооператив)",
  minPlayers: 1,
  maxPlayers: 6,
  setup(players, seed) {
    const rng = Rng.from(seed);
    const s: WasteState = {
      players: [...players],
      hp: Object.fromEntries(players.map((p) => [p, 3])),
      supplies: 3,
      shelter: 0,
      doom: 0,
      threat: null,
      deck: [],
      turn: players[0],
      acted: [],
      round: 1,
      rng: rng.s,
      last: "",
    };
    wsDraw(s, rng);
    return s;
  },
  toAct(s) {
    return this.isOver(s) ? [] : [s.turn];
  },
  legalMoves(s, p) {
    if (p !== s.turn || this.isOver(s)) return [];
    const out: WasteMove[] = [{ t: "scavenge" }];
    if (s.threat) out.unshift({ t: "fight" });
    if (s.supplies >= 2) out.push({ t: "build" });
    if (s.supplies >= 1) for (const q of wsAlive(s)) if (s.hp[q] < 3) out.push({ t: "heal", who: q });
    out.push({ t: "rest" });
    return out;
  },
  applyMove(s, p, m) {
    const rng = new Rng(s.rng);
    if (m.t === "fight" && s.threat) {
      const helpers = s.acted.length;
      const roll = rng.int(1, 6) + rng.int(1, 6) + (helpers ? 1 : 0);
      if (roll >= s.threat.str) {
        s.last = `отбивает «${s.threat.name}» (${roll})`;
        s.threat = null;
        s.supplies += 1;
      } else {
        s.hp[p] = Math.max(0, s.hp[p] - 1);
        s.threat.str = Math.max(1, s.threat.str - 1);
        s.last = `не справляется (${roll}), ранен`;
      }
    } else if (m.t === "scavenge") {
      const g = rng.int(1, 3);
      s.supplies += g;
      s.last = `находит припасы: +${g}`;
      if (s.threat && rng.chance(0.4)) {
        s.hp[p] = Math.max(0, s.hp[p] - 1);
        s.last += ", но попадает под удар";
      }
    } else if (m.t === "build") {
      s.supplies -= 2;
      s.shelter++;
      s.last = `укрепляет убежище (${s.shelter}/8)`;
    } else if (m.t === "heal") {
      s.supplies--;
      s.hp[m.who] = Math.min(3, s.hp[m.who] + 1);
      s.last = `латает ${m.who}`;
    } else {
      s.hp[p] = Math.min(3, s.hp[p] + 1);
      s.last = "отдыхает";
    }
    s.acted.push(p);
    const left = wsAlive(s).filter((q) => !s.acted.includes(q));
    if (!left.length) {
      wsEndRound(s, rng);
      s.turn = wsAlive(s)[0] ?? p;
    } else s.turn = nextOf(s.players, p, (q) => left.includes(q));
  },
  viewFor(s) {
    return { players: s.players, hp: s.hp, supplies: s.supplies, shelter: s.shelter, doom: s.doom, threat: s.threat, turn: s.turn, round: s.round, last: s.last };
  },
  isOver(s) {
    return s.shelter >= 8 || s.doom >= 10 || !wsAlive(s).length;
  },
  result(s) {
    const win = s.shelter >= 8;
    return win
      ? { winners: [...s.players], losers: [], text: "Убежище построено! Пустошь отступила." }
      : { winners: [], losers: [...s.players], text: "Пустошь забрала всех." };
  },
  botMove(s, p, skill, rng) {
    const hurt = wsAlive(s).filter((q) => s.hp[q] === 1);
    if (hurt.length && s.supplies >= 1 && rng.chance(0.5 + skill * 0.4)) return { t: "heal", who: hurt[0] };
    if (s.threat && s.threat.str <= 7 && s.hp[p] > 1) return { t: "fight" };
    if (s.supplies >= 3 || (s.supplies >= 2 && s.doom < 6)) return { t: "build" };
    if (s.hp[p] === 1 && rng.chance(0.5)) return { t: "rest" };
    return { t: "scavenge" };
  },
  describe(s) {
    return s.last;
  },
  label(m) {
    if (m.t === "fight") return "⚔ Драться с угрозой";
    if (m.t === "scavenge") return "🎒 Искать припасы";
    if (m.t === "build") return "🏗 Строить убежище (−2)";
    if (m.t === "heal") return `✚ Лечить (−1)`;
    return "💤 Отдых";
  },
};
registerGame(wasteland);

// ================================================================ Мафия (hidden roles)

export type MafiaRole = "mafia" | "doctor" | "sheriff" | "civ";
export const MAFIA_ROLE_NAMES: Record<MafiaRole, string> = { mafia: "Мафия", doctor: "Доктор", sheriff: "Комиссар", civ: "Мирный житель" };

interface MafiaState {
  players: string[];
  roles: Record<string, MafiaRole>;
  alive: string[];
  phase: "night" | "day";
  night: Record<string, string | null>; // pending night choices
  votes: Record<string, string | null>;
  checks: Record<string, Record<string, boolean>>; // sheriff → target → is mafia
  claims: Record<string, string>; // public accusations ("I checked X — mafia")
  day: number;
  news: string;
  rng: RngState;
}

type MafiaMove = { t: "night"; target: string | null } | { t: "vote"; target: string | null } | { t: "accuse"; target: string };

function mfTeams(s: MafiaState) {
  const maf = s.alive.filter((p) => s.roles[p] === "mafia").length;
  return { maf, town: s.alive.length - maf };
}

function mfResolveNight(s: MafiaState, rng: Rng) {
  const mafiaVotes = s.alive.filter((p) => s.roles[p] === "mafia").map((p) => s.night[p]).filter((x): x is string => !!x);
  const kill = mafiaVotes.length ? rng.pick(mafiaVotes) : null;
  const doc = s.alive.find((p) => s.roles[p] === "doctor");
  const heal = doc ? s.night[doc] : null;
  const sher = s.alive.find((p) => s.roles[p] === "sheriff");
  if (sher && s.night[sher]) (s.checks[sher] ??= {})[s.night[sher]!] = s.roles[s.night[sher]!] === "mafia";
  if (kill && kill !== heal) {
    s.alive = s.alive.filter((p) => p !== kill);
    s.news = `Утром нашли ${kill}. Роль: ${MAFIA_ROLE_NAMES[s.roles[kill]]}.`;
  } else s.news = kill ? "Ночью было неспокойно, но доктор успел." : "Ночь прошла тихо.";
  s.night = {};
  s.phase = "day";
  s.votes = {};
}

function mfResolveDay(s: MafiaState) {
  const tally: Record<string, number> = {};
  for (const v of Object.values(s.votes)) if (v) tally[v] = (tally[v] ?? 0) + 1;
  const top = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  if (top.length && top[0][1] > s.alive.length / 2 - 0.01 && (top.length === 1 || top[1][1] < top[0][1])) {
    const out = top[0][0];
    s.alive = s.alive.filter((p) => p !== out);
    s.news = `Собрание изгнало ${out}. Роль: ${MAFIA_ROLE_NAMES[s.roles[out]]}.`;
  } else s.news = "Собрание не пришло к согласию.";
  s.votes = {};
  s.phase = "night";
  s.night = {};
  s.day++;
}

const mafia: BoardGame<MafiaState, MafiaMove> = {
  id: "mafia",
  name: "Мафия",
  minPlayers: 4,
  maxPlayers: 8,
  setup(players, seed) {
    const rng = Rng.from(seed);
    const n = players.length;
    const deck: MafiaRole[] = [...Array(n >= 6 ? 2 : 1).fill("mafia"), "doctor", "sheriff"];
    while (deck.length < n) deck.push("civ");
    rng.shuffle(deck);
    const roles: Record<string, MafiaRole> = {};
    players.forEach((p, i) => (roles[p] = deck[i]));
    return { players: [...players], roles, alive: [...players], phase: "night", night: {}, votes: {}, checks: {}, claims: {}, day: 1, news: "Город засыпает. Просыпается мафия…", rng: rng.s };
  },
  toAct(s) {
    if (this.isOver(s)) return [];
    if (s.phase === "night") return s.alive.filter((p) => !(p in s.night));
    return s.alive.filter((p) => !(p in s.votes));
  },
  legalMoves(s, p) {
    if (!this.toAct(s).includes(p)) return [];
    const others = s.alive.filter((q) => q !== p);
    const role = s.roles[p];
    if (s.phase === "night") {
      if (role === "mafia") return others.filter((q) => s.roles[q] !== "mafia").map((q) => ({ t: "night", target: q }));
      if (role === "doctor") return s.alive.map((q) => ({ t: "night", target: q }));
      if (role === "sheriff") return others.filter((q) => s.checks[p]?.[q] === undefined).map((q) => ({ t: "night", target: q }));
      return [{ t: "night", target: null }];
    }
    const out: MafiaMove[] = [...others.map((q) => ({ t: "vote" as const, target: q })), { t: "vote", target: null }];
    if (!s.claims[p]) for (const q of others) out.push({ t: "accuse", target: q });
    return out;
  },
  applyMove(s, p, m) {
    if (m.t === "accuse") {
      s.claims[p] = m.target;
      return;
    }
    if (m.t === "night") s.night[p] = m.target;
    else s.votes[p] = m.target;
    if (this.toAct(s).length) return;
    const rng = new Rng(s.rng);
    if (s.phase === "night") mfResolveNight(s, rng);
    else {
      mfResolveDay(s);
      s.claims = {};
    }
  },
  viewFor(s, viewer) {
    const me = viewer && s.roles[viewer] ? s.roles[viewer] : null;
    const known: Record<string, MafiaRole> = {};
    for (const p of s.players) if (!s.alive.includes(p)) known[p] = s.roles[p];
    if (viewer && me) {
      known[viewer] = me;
      if (me === "mafia") for (const p of s.players) if (s.roles[p] === "mafia") known[p] = "mafia";
    }
    const over = this.isOver(s);
    if (over) Object.assign(known, s.roles);
    return {
      players: s.players,
      alive: s.alive,
      phase: s.phase,
      day: s.day,
      me,
      known,
      checks: viewer && me === "sheriff" ? s.checks[viewer] ?? {} : null,
      // votes are open during the day; night choices are secret
      votes: s.phase === "day" ? s.votes : {},
      waiting: this.toAct(s).length,
      claims: s.claims,
      news: s.news,
    };
  },
  isOver(s) {
    const { maf, town } = mfTeams(s);
    return maf === 0 || maf >= town;
  },
  result(s) {
    const { maf } = mfTeams(s);
    const mafiaWin = maf > 0;
    const winners = s.players.filter((p) => (s.roles[p] === "mafia") === mafiaWin);
    return { winners, losers: s.players.filter((p) => !winners.includes(p)), text: mafiaWin ? "Город пал: победила мафия" : "Мафия поймана: победил город" };
  },
  botMove(s, p, skill, rng) {
    const legal = this.legalMoves(s, p).filter((m) => m.t !== "accuse");
    const role = s.roles[p];
    const others = s.alive.filter((q) => q !== p);
    if (s.phase === "night") {
      if (role === "mafia") {
        // the loudest accuser is the most dangerous
        const accuser = Object.entries(s.claims).find(([a, t]) => s.alive.includes(a) && s.roles[t] === "mafia")?.[0];
        const town = others.filter((q) => s.roles[q] !== "mafia");
        return { t: "night", target: accuser && town.includes(accuser) ? accuser : rng.pick(town) };
      }
      if (role === "doctor") return { t: "night", target: rng.chance(0.3) ? p : rng.pick(s.alive) };
      return legal.length ? rng.pick(legal) : { t: "night", target: null };
    }
    // day
    if (role === "sheriff") {
      const found = Object.entries(s.checks[p] ?? {}).find(([q, isM]) => isM && s.alive.includes(q));
      if (found) {
        if (!s.claims[p]) return { t: "accuse", target: found[0] };
        return { t: "vote", target: found[0] };
      }
    }
    if (role === "mafia") {
      const town = others.filter((q) => s.roles[q] !== "mafia");
      const bandwagon = Object.values(s.votes).find((v) => v && town.includes(v));
      return { t: "vote", target: bandwagon ?? rng.pick(town) };
    }
    // town: trust accusations, else follow the crowd, else a hunch
    const acc = Object.entries(s.claims).filter(([a, t]) => s.alive.includes(a) && s.alive.includes(t) && t !== p);
    if (acc.length && rng.chance(0.5 + skill * 0.4)) return { t: "vote", target: acc[0][1] };
    const tally: Record<string, number> = {};
    for (const v of Object.values(s.votes)) if (v && v !== p) tally[v] = (tally[v] ?? 0) + 1;
    const lead = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
    if (lead && rng.chance(0.6)) return { t: "vote", target: lead[0] };
    return { t: "vote", target: rng.pick(others) };
  },
  describe(s, p, m) {
    if (m.t === "accuse") return `«Я уверен: ${m.target} — мафия!»`;
    if (m.t === "vote") return m.target ? `голосует против ${m.target}` : "воздерживается";
    return ""; // night choices stay secret
  },
  label(m, view) {
    const nm = (id: string | null) => (id ? view?.names?.[id] ?? id : "—");
    if (m.t === "accuse") return `☝ Обвинить ${nm(m.target)}`;
    if (m.t === "vote") return m.target ? `🗳 Против ${nm(m.target)}` : "🗳 Воздержаться";
    if (!m.target) return "😴 Спать";
    const role = view?.me;
    return role === "mafia" ? `🔪 ${nm(m.target)}` : role === "doctor" ? `✚ ${nm(m.target)}` : `🔎 ${nm(m.target)}`;
  },
};
registerGame(mafia);
