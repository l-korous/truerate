# Built from the repo root:  docker build -f apps/mcp/Dockerfile .
FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-workspace.yaml package.json tsconfig.base.json turbo.json ./
COPY packages/core/package.json packages/core/
COPY apps/mcp/package.json apps/mcp/
RUN pnpm install --frozen-lockfile=false
COPY packages/core packages/core
COPY apps/mcp apps/mcp
RUN pnpm --filter @truerate/core build && pnpm --filter @truerate/mcp build
RUN pnpm --filter @truerate/mcp --prod deploy /export

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /export/node_modules ./node_modules
COPY --from=build /export/dist ./dist
COPY --from=build /repo/packages/core/dist ./node_modules/@truerate/core/dist
EXPOSE 8788
CMD ["node", "dist/index.js"]
