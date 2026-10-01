# syntax=docker/dockerfile:1

# ---------- Stage 1: build do painel (vite) ----------
FROM oven/bun:1 AS web-builder
WORKDIR /app

COPY web/package.json web/bun.lock web/
WORKDIR /app/web
RUN bun install --frozen-lockfile

WORKDIR /app
COPY web/tsconfig.json web/vite.config.ts web/index.html web/
COPY web/public web/public
COPY web/src web/src
COPY src/shared/contract.ts src/shared/
RUN bun run --cwd web build

# ---------- Stage 2: bundle standalone do servidor ----------
# Embute elysia + zod em um único arquivo JS (bun:sqlite é nativo do runtime).
# Nenhum node_modules é necessário em runtime.
FROM oven/bun:1 AS server-builder
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY tsconfig.json ./
COPY src src
RUN bun build src/index.ts --target=bun --outdir=dist-server --minify

# ---------- Stage 3: runtime mínimo ----------
FROM oven/bun:1-slim AS runtime
WORKDIR /app

ENV TZ=America/Sao_Paulo \
    NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    WEB_DIST_DIR=/app/web/dist

RUN useradd --system --uid 10001 --create-home --home-dir /home/app --shell /usr/sbin/nologin app \
  && mkdir -p /data \
  && chown app:app /data

COPY --chown=app:app --from=server-builder /app/dist-server/index.js dist-server/index.js
COPY --chown=app:app --from=web-builder /app/web/dist web/dist

USER app

VOLUME /data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD bun -e "const r = await fetch('http://localhost:' + (process.env.PORT || 3000) + '/healthz', { signal: AbortSignal.timeout(5000) }); if (!r.ok) process.exit(1)" || exit 1

CMD ["bun", "dist-server/index.js"]
