# Multi-stage build for the API. Built from the repo root so the workspace
# (packages/core) is available:  docker build -f apps/api/Dockerfile .
FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-workspace.yaml package.json tsconfig.base.json turbo.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile=false
COPY packages/core packages/core
COPY apps/api apps/api
RUN pnpm --filter @truerate/core build && pnpm --filter @truerate/api build
RUN pnpm --filter @truerate/api --prod deploy /export

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /export/node_modules ./node_modules
COPY --from=build /export/dist ./dist
COPY --from=build /repo/packages/core/dist ./node_modules/@truerate/core/dist
# The /demo + /stats endpoints load the hotel directory at runtime, so ship the
# data file (mirrors the MCP image). Without it the loader fail-softs to empty.
COPY --from=build /repo/packages/core/data ./node_modules/@truerate/core/data
EXPOSE 8787
CMD ["node", "dist/index.js"]
