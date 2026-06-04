FROM node:24-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/rpc-router/package.json apps/rpc-router/package.json
RUN pnpm install --filter @fx-trader-profiles/rpc-router... --prod=false --frozen-lockfile

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/rpc-router/node_modules ./apps/rpc-router/node_modules
COPY apps/rpc-router ./apps/rpc-router
COPY package.json pnpm-workspace.yaml ./
RUN pnpm --filter @fx-trader-profiles/rpc-router build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8545
ENV RPC_ROUTER_HOST=0.0.0.0
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 rpcrouter
COPY --from=builder --chown=rpcrouter:nodejs /app/apps/rpc-router/dist ./dist
USER rpcrouter
EXPOSE 8545
CMD ["node", "dist/server.js"]
