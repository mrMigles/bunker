# «ГЛУБЖЕ»: one image with the game server and the built client.
# docker build -t glubzhe . && docker run -p 8080:8080 -v glubzhe-data:/data glubzhe
#
# Alpine (musl) on purpose: on glibc images Node starts its worker threads through clone3, which
# older Docker/runc seccomp profiles reject, and Node dies right at start with
# "Assertion failed: (0) == (uv_thread_create(...))". musl uses plain clone and runs everywhere.

FROM node:24-alpine AS build
# better-sqlite3 has no prebuilt musl binary for every Node version: build it from source
RUN apk add --no-cache python3 make g++
RUN npm install -g pnpm@11.17.0
WORKDIR /app
# dependencies first: this layer is cached while only the sources change
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN pnpm install --frozen-lockfile
COPY packages packages
# the build id goes into the service worker and the client, so every deploy invalidates old caches
ARG BUILD_ID=dev
ENV BUILD_ID=$BUILD_ID
RUN pnpm build

FROM node:24-alpine
ARG BUILD_ID=dev
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    BUILD_ID=$BUILD_ID
WORKDIR /app
# the server runs its TypeScript through tsx and consumes @bunker/shared as source
COPY --from=build /app /app
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080
# busybox wget: the health check needs no second Node process
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-8080}/healthz" || exit 1
WORKDIR /app/packages/server
CMD ["node", "--import", "tsx", "src/index.ts"]
