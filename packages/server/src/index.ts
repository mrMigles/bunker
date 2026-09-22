import { defineRoom, defineServer, matchMaker } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GameRoom } from "./GameRoom";
import { addLegacy, getLegacy, hasSave, listSaves } from "./persistence";

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
      app.use(express.static(clientDist, { maxAge: "1h", index: "index.html" }));
    } else {
      app.get("/", (_req, res) => res.send("Клиент не собран: запустите `pnpm build` или `pnpm dev`."));
    }
  },
});

server.listen(port).then(() => {
  console.log(`[ГЛУБЖЕ] server listening on http://localhost:${port}`);
});
