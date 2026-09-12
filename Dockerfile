# syntax=docker/dockerfile:1

# ビルドコンテキストはリポジトリ直下（just image-build 参照）。
# `pnpm exec turbo prune @repo/api @repo/worker --docker` が書き出す ./out だけを使う。
# pnpm ワークスペースをそのまま COPY すると lockfile とワークスペースリンクが壊れるため。
FROM node:24.19.0-slim AS base
RUN corepack enable

FROM base AS installer
WORKDIR /app
COPY out/json/ .
COPY out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY out/pnpm-workspace.yaml ./pnpm-workspace.yaml
RUN pnpm install --frozen-lockfile

FROM installer AS builder
WORKDIR /app
COPY out/full/ .
RUN pnpm exec turbo run build

FROM base AS runner
WORKDIR /app
COPY --from=builder /app .
ENV NODE_ENV=production

# api と worker は同じイメージを使い、CMD で切り替える（意図的な簡略化）。
# 既定は api。ECS の worker タスク定義側で command を ["node", "apps/worker/src/main.ts"] に上書きする。
CMD ["node", "apps/api/src/main.ts"]
