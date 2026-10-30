# One Dockerfile for the three runtime images (T1):
#   docker build -f infra/Dockerfile --target web    .
#   docker build -f infra/Dockerfile --target admin  .
#   docker build -f infra/Dockerfile --target worker .   (also runs migrations: `migrate` command)
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY apps/admin/package.json apps/admin/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/services/package.json packages/services/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @boxrush/web build && pnpm --filter @boxrush/admin build

FROM node:22-slim AS next-runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0
WORKDIR /app

FROM next-runtime AS web
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
ENV PORT=3000
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

FROM next-runtime AS admin
COPY --from=build --chown=node:node /repo/apps/admin/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/admin/.next/static ./apps/admin/.next/static
USER node
ENV PORT=3001
EXPOSE 3001
CMD ["node", "apps/admin/server.js"]

# Worker: job queue, reconcile, daily sweeps, hourly audit archive. `migrate` runs the DB migrations (as the
# migration owner; the services themselves never connect as the owner).
FROM deps AS worker
COPY packages packages
COPY tsconfig.base.json ./
ENV NODE_ENV=production
USER node
CMD ["packages/services/node_modules/.bin/tsx", "packages/services/src/worker.ts"]
