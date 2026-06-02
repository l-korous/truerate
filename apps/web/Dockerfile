# Built from the repo root:  docker build -f apps/web/Dockerfile .
FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-workspace.yaml package.json tsconfig.base.json turbo.json ./
# Copy ALL workspace packages so pnpm can resolve every workspace dep
# (core, harness, future ones) — selective copies broke when new packages landed.
COPY packages packages
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile=false
COPY apps/web apps/web
# Build workspace deps before web: `next build` typechecks apps/web/e2e/*,
# which import types from @truerate/harness (and @truerate/core), and those
# packages expose their types from dist/. Without this the build fails with
# "Cannot find module '@truerate/harness'". Mirrors the CI `build` job.
# (Follow-up: decouple the web production build from the e2e harness.)
RUN pnpm --filter @truerate/core build && pnpm --filter @truerate/harness build
# NEXT_PUBLIC_* is inlined at build time; pass it as a build arg in CI.
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:8787
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
RUN pnpm --filter @truerate/web build

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Next standalone output bundles only what's needed to run.
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
