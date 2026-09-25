// Telegram Games: the bunker lives in a chat. Someone writes /play (or /start) in the chat, the bot answers
// with the game message «ГЛУБЖЕ — Играть»; everyone in the chat who presses «Играть» lands in that chat's
// one bunker under their Telegram name. Telegram tells the bot who pressed and in which chat; the bot hands
// back a signed link (game URL + ?tg=token) — the page trusts only that signature, never the URL alone.
//
// Needs TELEGRAM_BOT_TOKEN, TELEGRAM_GAME (the game's short name from @BotFather /newgame) and PUBLIC_URL
// (the https address of the game). Long polling: no webhook and no open port are needed.
import crypto from "node:crypto";
import { codeForChat, signPid } from "./telegram";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const GAME = process.env.TELEGRAM_GAME ?? "glubzhe";
const PUBLIC_URL = (process.env.PUBLIC_URL ?? "").replace(/\/$/, "");
const SECRET = process.env.SESSION_SECRET || TOKEN || crypto.randomBytes(16).toString("hex");
const API = `https://api.telegram.org/bot${TOKEN}`;

interface GameClaim {
  c: string; // chat key
  u: number; // Telegram user id
  n: string; // display name
  t: number; // issued at (s)
  title?: string;
}

const b64 = (s: string) => Buffer.from(s).toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url").toString();
const mac = (s: string) => crypto.createHmac("sha256", SECRET + ":game").update(s).digest("base64url").slice(0, 32);

export function makeGameToken(claim: GameClaim) {
  const body = b64(JSON.stringify(claim));
  return body + "." + mac(body);
}

/** The session behind a game link, or an error (bad signature, older than a day). */
export function gameSession(token: string) {
  const [body, sig] = String(token).split(".");
  if (!body || !sig || mac(body) !== sig) return { error: "Ссылка на игру не подписана — откройте игру кнопкой «Играть» в чате" };
  let c: GameClaim;
  try {
    c = JSON.parse(unb64(body));
  } catch {
    return { error: "Повреждённая ссылка" };
  }
  if (Date.now() / 1000 - c.t > 86400) return { error: "Ссылка устарела — нажмите «Играть» в чате ещё раз" };
  const code = codeForChat(c.c);
  const pid = "tg_" + c.u;
  return { code, pid, sig: signPid(pid, code), name: c.n, chat: c.c, chatTitle: c.title, verified: true };
}

const nameOf = (u: any) => [u?.first_name, u?.last_name ? u.last_name[0] + "." : ""].filter(Boolean).join(" ").slice(0, 16) || u?.username || "Выживший";

async function call(method: string, body: Record<string, unknown>) {
  const r = await fetch(`${API}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j: any = await r.json().catch(() => ({}));
  if (!j.ok) console.warn(`[tg] ${method}:`, j.description ?? r.status);
  return j;
}

async function onUpdate(u: any) {
  const m = u.message;
  if (m?.text && /^\/(play|start|game|bunker)(@\w+)?(\s|$)/i.test(m.text)) {
    await call("sendGame", { chat_id: m.chat.id, game_short_name: GAME });
    return;
  }
  const q = u.callback_query;
  if (q?.game_short_name) {
    if (!PUBLIC_URL) {
      await call("answerCallbackQuery", { callback_query_id: q.id, text: "Сервер игры не знает свой адрес (PUBLIC_URL)", show_alert: true });
      return;
    }
    // chat_instance identifies the chat for everyone in it — and it is the same value a Mini App opened
    // from that chat gets, so the game button and a t.me/bot/app link lead to the same bunker
    const chat = q.message?.chat;
    const key = q.chat_instance ? "ci" + q.chat_instance : String(chat?.id ?? "u" + q.from.id);
    const token = makeGameToken({ c: key, u: q.from.id, n: nameOf(q.from), t: Math.floor(Date.now() / 1000), title: chat?.title });
    await call("answerCallbackQuery", { callback_query_id: q.id, url: `${PUBLIC_URL}/?tg=${token}` });
    return;
  }
  // @bot in any chat → the game card, so it can be sent to a chat the bot is not in
  const iq = u.inline_query;
  if (iq) await call("answerInlineQuery", { inline_query_id: iq.id, results: [{ type: "game", id: "g", game_short_name: GAME }], cache_time: 300 });
}

/** Starts long polling when a bot token is configured. */
export function startTelegramBot() {
  if (!TOKEN || process.env.TELEGRAM_POLL === "0") return;
  let offset = 0;
  let stopped = false;
  const loop = async () => {
    while (!stopped) {
      try {
        const r = await fetch(`${API}/getUpdates?timeout=30&offset=${offset}&allowed_updates=${encodeURIComponent(JSON.stringify(["message", "callback_query", "inline_query"]))}`);
        const j: any = await r.json();
        if (!j.ok) throw new Error(j.description ?? "getUpdates failed");
        for (const u of j.result) {
          offset = u.update_id + 1;
          onUpdate(u).catch((e) => console.warn("[tg] update", e));
        }
      } catch (e) {
        console.warn("[tg] polling:", (e as Error).message);
        await new Promise((res) => setTimeout(res, 5000));
      }
    }
  };
  loop();
  console.log(`[tg] bot polling (game «${GAME}», url ${PUBLIC_URL || "— PUBLIC_URL not set"})`);
  process.once("SIGTERM", () => (stopped = true));
}
