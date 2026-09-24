import { execSync } from "node:child_process";
import { defineConfig, type Plugin } from "vite";

/** One id per release: the service worker cache name and the client's own version carry it. */
function buildId() {
  if (process.env.BUILD_ID && process.env.BUILD_ID !== "dev") return process.env.BUILD_ID;
  let sha = "local";
  try {
    sha = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    /* not a git checkout */
  }
  return `${sha}-${Date.now().toString(36)}`;
}

const BUILD = buildId();

/**
 * Writes sw.js at build time with the release id and the list of built files, so a new deploy is a new
 * service worker (the browser notices the byte change), its install precaches the new bundles and
 * its activation deletes every older cache.
 */
function serviceWorker(): Plugin {
  return {
    name: "glubzhe-sw",
    apply: "build",
    generateBundle(_opts, bundle) {
      const files = Object.keys(bundle).filter((f) => /\.(js|css|png|svg|webmanifest)$/.test(f) && !f.endsWith("sw.js"));
      const precache = ["/", ...files.map((f) => "/" + f)];
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: SW_SOURCE.replace("__BUILD__", BUILD).replace("__PRECACHE__", JSON.stringify(precache)),
      });
    },
  };
}

const SW_SOURCE = `// generated at build time — do not edit (see vite.config.ts)
const VERSION = "__BUILD__";
const CACHE = "glubzhe-" + VERSION;
const PRECACHE = __PRECACHE__;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE).catch(() => {})));
});

// the page decides when to switch (not in the middle of a fight): it posts "skipWaiting"
self.addEventListener("message", (e) => {
  if (e.data === "skipWaiting") self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("glubzhe-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  // the game server, the version probe and websockets always go to the network
  if (/^\\/(api|version|healthz|matchmake)/.test(url.pathname)) return;
  // pages: network first (a new release shows up at once), the cached page only when offline
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((r) => {
          const copy = r.clone();
          caches.open(CACHE).then((c) => c.put("/", copy));
          return r;
        })
        .catch(() => caches.match("/")),
    );
    return;
  }
  // hashed bundles never change: cache first; everything else: cache, refreshed in the background
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req)
        .then((r) => {
          if (r.ok) caches.open(CACHE).then((c) => c.put(req, r.clone()));
          return r;
        })
        .catch(() => hit);
      return /-[A-Za-z0-9_-]{8,}\\.(js|css)$/.test(url.pathname) ? hit || net : hit || net;
    }),
  );
});
`;

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(BUILD),
  },
  plugins: [serviceWorker()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:2567",
      "/version": "http://localhost:2567",
    },
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1500,
  },
});
