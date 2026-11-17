# syntax=docker/dockerfile:1
FROM node:24-alpine AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/docs/package.json apps/docs/
# The docs site is a workspace member; its dependencies don't belong in the image.
RUN pnpm install --frozen-lockfile --filter buzz-dashboard

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# Only the standalone server and static assets ship. No pnpm, no source, no dev deps.
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
# History store migrations, applied on start when DATABASE_URL is set.
COPY --from=build --chown=node:node /app/drizzle ./drizzle
# Config volume (#73): a named volume copies this ownership on first use.
RUN mkdir /data && chown node:node /data
ENV BUZZ_CONFIG_DIR=/data
USER node
EXPOSE 3000
CMD ["node", "server.js"]
