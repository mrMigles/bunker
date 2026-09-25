// Telegram Mini App: a bunker belongs to the chat it was opened from.
// The client sends Telegram's initData; we check its signature with the bot token (when one is
// configured), take the user's real name and derive the room code from the chat. The player id is
// signed so nobody can pretend to be another Telegram user by editing localStorage.
import crypto from "node:crypto";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const SECRET = process.env.SESSION_SECRET || BOT_TOKEN || crypto.randomBytes(16).toString("hex");

export interface TgSession {
  code: string;
  pid: string;
  sig: string;
  name: string;
  chat: string;
  chatTitle?: string;
  verified: boolean;
  photo?: string;
  /** opened without a chat: the user's own bunker */
  personal?: boolean;
  /** opened without a chat and sent to the group bunker the user last played in */
  fromLast?: boolean;
}

/** Telegram's check: HMAC-SHA256 over the sorted fields with a key derived from the bot token. */
export function checkInitData(initData: string): URLSearchParams | null {
  const params = new URLSearchParams(initData);
  if (!BOT_TOKEN) return params; // development without a bot: trust the data, mark unverified
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const data = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const key = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const calc = crypto.createHmac("sha256", key).update(data).digest("hex");
  if (calc.length !== hash.length || !crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(hash))) return null;
  // stale data is refused (a day)
  const age = Date.now() / 1000 - Number(params.get("auth_date") ?? 0);
  if (age > 86400) return null;
  params.set("hash", hash);
  return params;
}

const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Five-letter room code from a chat id: the same chat always lands in the same bunker. */
export function codeForChat(chat: string) {
  const h = crypto.createHash("sha256").update("glubzhe:" + chat).digest();
  let s = "";
  for (let i = 0; i < 5; i++) s += ALPHA[h[i] % ALPHA.length];
  return "T" + s.slice(1); // Telegram bunkers start with T
}

/** The signature binds the Telegram player to their chat's bunker. */
export function signPid(pid: string, code: string) {
  return crypto.createHmac("sha256", SECRET).update(pid + ":" + code).digest("hex").slice(0, 24);
}

export function verifyPid(pid: string, code: string, sig: unknown) {
  return typeof sig === "string" && sig === signPid(pid, code);
}

export function tgSession(initData: string, lastGroup?: (user: string) => { chat: string; title?: string } | null): TgSession | { error: string } {
  const p = checkInitData(initData);
  if (!p) return { error: "Подпись Telegram не сошлась" };
  let user: any;
  let chat: any;
  try {
    user = JSON.parse(p.get("user") ?? "{}");
    chat = p.get("chat") ? JSON.parse(p.get("chat")!) : null;
  } catch {
    return { error: "Неверные данные Telegram" };
  }
  if (!user.id) return { error: "Нет пользователя Telegram" };
  // the chat the app was opened in (its chat_instance — the same key the game button uses), else the chat
  // id, else a start parameter, else the user's own bunker
  const ci = p.get("chat_instance");
  let chatKey = (ci ? "ci" + ci : "") || (chat?.id ? String(chat.id) : "") || p.get("start_param") || "";
  let chatTitle: string | undefined = chat?.title;
  let personal = false,
    fromLast = false;
  if (!chatKey) {
    // opened from the bot's private chat or its menu button: rejoin the group the user last played with (#33)
    const last = lastGroup?.(String(user.id));
    if (last) ((chatKey = last.chat), (chatTitle = last.title), (fromLast = true));
    else ((chatKey = "u" + user.id), (personal = true));
  }
  const pid = "tg_" + user.id;
  const name = [user.first_name, user.last_name ? user.last_name[0] + "." : ""].filter(Boolean).join(" ").slice(0, 16) || user.username || "Выживший";
  return { code: codeForChat(chatKey), pid, sig: signPid(pid, codeForChat(chatKey)), name, chat: chatKey, chatTitle, verified: !!BOT_TOKEN, photo: user.photo_url, personal, fromLast };
}
