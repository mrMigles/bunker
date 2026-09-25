import { defineRoom, defineServer, matchMaker } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GameRoom } from "./GameRoom";
import { addLegacy, getLegacy, hasSave, listSaves } from "./persistence";
import { tgSession } from "./telegram";
import { gameSession, makeGameToken, startTelegramBot } from "./tgbot";

const BUILD_ID = process.env.BUILD_ID ?? "dev";

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(here, "../../client/dist");
// SERVER_PORT wins; PORT is honoured only in production (dev tooling often sets PORT for the Vite client).
const port = Number(process.env.SERVER_PORT || (process.env.NODE_ENV === "production" ? process.env.PORT : "") || 2567);

const server = defineServer({
  transport: new WebSocketTransport({ maxPayload: 64 * 1024, pingInterval: 5000, pingMaxRetries: 3 }),
  greet: false,
  rooms: { game: defineRoom(GameRoom) },
  express: (app) => {
    app.use(express.json({ limit: "32kb" }));

    // health and version: the client compares BUILD_ID to know a new release is out
    app.get("/healthz", (_req, res) => res.send("ok"));
    app.get("/version", (_req, res) => {
      res.set("Cache-Control", "no-store");
      res.json({ build: BUILD_ID });
    });

    // Telegram Mini App: the bunker of this chat (created on first open, restored from its save later)
    app.post("/api/tg/session", async (req, res) => {
      const s = tgSession(String(req.body?.initData ?? ""));
      if ("error" in s) return res.status(403).json(s);
      try {
        const found = await matchMaker.query({ roomId: s.code } as any);
        if (!found.length) await matchMaker.createRoom("game", { code: s.code, restore: hasSave(s.code), private: true });
      } catch (e) {
        console.error(e);
        return res.status(500).json({ error: "Не удалось поднять бункер чата" });
      }
      res.json(s);
    });

    // Telegram Games: «Играть» in a chat → a signed link with ?tg=token → the same chat bunker
    app.post("/api/tg/game", async (req, res) => {
      const s = gameSession(String(req.body?.token ?? ""));
      if ("error" in s) return res.status(403).json(s);
      try {
        const found = await matchMaker.query({ roomId: s.code } as any);
        if (!found.length) await matchMaker.createRoom("game", { code: s.code, restore: hasSave(s.code), private: true });
      } catch (e) {
        console.error(e);
        return res.status(500).json({ error: "Не удалось поднять бункер чата" });
      }
      res.json(s);
    });

    // development only: a game link as the bot would hand out (for e2e and trying without Telegram)
    if (process.env.NODE_ENV !== "production")
      app.get("/api/tg/dev-token", (req, res) => {
        const q = req.query as Record<string, string>;
        res.json({ token: makeGameToken({ c: String(q.chat ?? "dev-chat"), u: Number(q.user ?? 1), n: String(q.name ?? "Тестер"), t: Math.floor(Date.now() / 1000), title: q.title }) });
      });

    // Ensure a room with this code is running (restoring it from SQLite if needed).
    app.get("/api/room/:code", async (req, res) => {
      const code = String(req.params.code || "").toUpperCase();
      if (!/^[A-Z0-9]{5}$/.test(code)) return res.status(400).json({ error: "Неверный код" });
      const found = await matchMaker.query({ roomId: code } as any);
      if (found.length) return res.json({ ok: true, code, meta: found[0].metadata });
      if (hasSave(code)) {
        try {
          await matchMaker.createRoom("game", { code, restore: true });
          return res.json({ ok: true, code, restored: true });
        } catch (e) {
          console.error(e);
          return res.status(500).json({ error: "Не удалось поднять сохранение" });
        }
      }
      return res.status(404).json({ error: "Комната не найдена" });
    });

    app.get("/api/rooms", async (_req, res) => {
      const rooms = await matchMaker.query({ name: "game", private: false } as any);
      res.json(rooms.map((r) => ({ code: r.roomId, clients: r.clients, meta: r.metadata })));
    });

    app.get("/api/saves", (_req, res) => res.json(listSaves(20)));

    app.get("/api/legacy/:name", (req, res) => res.json(getLegacy(String(req.params.name).slice(0, 16))));
    app.post("/api/legacy/:name", (req, res) => {
      const pts = Math.max(0, Math.min(50, Number(req.body?.points) || 0));
      addLegacy(String(req.params.name).slice(0, 16), pts);
      res.json(getLegacy(String(req.params.name).slice(0, 16)));
    });

    if (fs.existsSync(clientDist)) {
      // caching that lets updates through: hashed bundles are immutable, the page, the service worker
      // and the manifest are always revalidated, plain assets for an hour
      app.use(
        express.static(clientDist, {
          index: "index.html",
          setHeaders: (res, file) => {
            const f = file.replace(/\\/g, "/");
            if (/\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(js|css)$/.test(f)) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
            else if (/(index\.html|sw\.js|manifest\.webmanifest)$/.test(f)) res.setHeader("Cache-Control", "no-cache");
            else res.setHeader("Cache-Control", "public, max-age=3600");
          },
        }),
      );
      // client-side routes fall back to the page
      app.get(/^\/(?!api|healthz|version|matchmake)[^.]*$/, (_req, res) => {
        res.setHeader("Cache-Control", "no-cache");
        res.sendFile(path.join(clientDist, "index.html"));
      });
    } else {
      app.get("/", (_req, res) => res.send("Клиент не собран: запустите `pnpm build` или `pnpm dev`."));
    }
  },
});

server.listen(port).then(() => {
  startTelegramBot();
  console.log(`[ГЛУБЖЕ] server listening on http://localhost:${port}`);
});
