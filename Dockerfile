# «ГЛУБЖЕ»: one image with the game server and the built client.
# docker build -t glubzhe . && docker run -p 8080:8080 -v glubzhe-data:/data glubzhe

FROM node:24-bookworm-slim AS build
# better-sqlite3 falls back to a source build when no prebuilt binary matches
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@11.17.0
WORKDIR /app
# dependencies first: this layer is cached while only the sources change
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN pnpm install --frozen-lockfile
COPY packages packages
RUN pnpm build

FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data
WORKDIR /app
# the server runs its TypeScript through tsx and consumes @bunker/shared as source
COPY --from=build /app /app
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
WORKDIR /app/packages/server
CMD ["node", "--import", "tsx", "src/index.ts"]
