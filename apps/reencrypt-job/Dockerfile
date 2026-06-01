# Built from the repo root: docker build -f apps/reencrypt-job/Dockerfile .
FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-workspace.yaml package.json tsconfig.base.json turbo.json ./
COPY packages/core/package.json packages/core/
COPY apps/reencrypt-job/package.json apps/reencrypt-job/
RUN pnpm install --frozen-lockfile=false
COPY packages/core packages/core
COPY apps/reencrypt-job apps/reencrypt-job
RUN pnpm --filter @truerate/core build && pnpm --filter @truerate/reencrypt-job build
RUN pnpm --filter @truerate/reencrypt-job --prod deploy /export

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /export/node_modules ./node_modules
COPY --from=build /export/dist ./dist
COPY --from=build /repo/packages/core/dist ./node_modules/@truerate/core/dist
CMD ["node", "dist/index.js"]
