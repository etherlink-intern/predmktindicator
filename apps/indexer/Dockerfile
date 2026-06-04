FROM node:24-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@10.24.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/indexer/package.json apps/indexer/package.json

RUN pnpm install --frozen-lockfile --filter @fx-trader-profiles/indexer...

COPY apps/indexer apps/indexer

WORKDIR /repo/apps/indexer

# Envio validates/interpolates config.yaml during codegen at image build time.
# Runtime Compose overrides this too, but the build needs a non-secret default.
ENV ENVIO_RPC_URL=http://rpc-router:8545
RUN pnpm codegen

CMD ["pnpm", "start"]
