# Two images are produced from this single multi-stage build:
#   --target runtime-app      → the CUSTOMER image (panel-api + SPA + worker).
#                               NEVER contains the license server or its admin panel.
#   --target runtime-license  → the VENDOR image (license-server + admin panel).
#                               You host this; it is never shipped to customers.
# ───────────────────────── builder ─────────────────────────
FROM node:20-bookworm-slim AS builder
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

# Dummy URLs so `prisma generate` can resolve the datasource env at build time
# (no DB connection is made during generate).
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
ENV LICENSE_DATABASE_URL=postgresql://build:build@localhost:5432/build

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @wootrico/db run generate
RUN pnpm --filter @wootrico/license-server run generate
RUN pnpm --filter @wootrico/panel-web run build
RUN pnpm --filter @wootrico/panel-api run build
RUN pnpm --filter @wootrico/worker run build
RUN pnpm --filter @wootrico/license-server run build
RUN pnpm --filter @wootrico/license-admin-web run build

# Slim: wipe node_modules and reinstall PRODUCTION-only deps (drops
# vite/esbuild/typescript/tsup and the SPA build libs — runtime libs are already
# bundled into the dist), then regenerate the Prisma clients. dist is preserved.
RUN find . -name node_modules -type d -prune -exec rm -rf '{}' + \
 && pnpm install --prod --frozen-lockfile \
 && pnpm --filter @wootrico/db run generate \
 && pnpm --filter @wootrico/license-server run generate

# ───────────────────────── runtime-app (CUSTOMER) ─────────────────────────
FROM node:20-bookworm-slim AS runtime-app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

# License server URL baked into the CUSTOMER image so clients never configure it
# (validation is online — the instance must know where the vendor server lives).
# Override per build if needed: docker buildx build --build-arg LICENSE_SERVER_URL=https://...
ARG LICENSE_SERVER_URL=https://licenca-wootrico.ericorenatoautomacao.com.br
ENV LICENSE_SERVER_URL=${LICENSE_SERVER_URL}

COPY --from=builder /app /app

# Strip the vendor-only license system so it can never run from the customer image.
RUN rm -rf apps/license-server apps/license-admin-web

EXPOSE 3000
# default command is the API; the worker overrides it in compose.
CMD ["node", "apps/panel-api/dist/server.cjs"]

# ───────────────────────── runtime-license (VENDOR) ─────────────────────────
FROM node:20-bookworm-slim AS runtime-license
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

COPY --from=builder /app /app

# Keep only the license system; drop the customer-facing apps.
RUN rm -rf apps/panel-api apps/panel-web apps/worker

EXPOSE 4000
CMD ["node", "apps/license-server/dist/server.cjs"]
