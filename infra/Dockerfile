# One Dockerfile for the three runtime images (T1):
#   docker build -f infra/Dockerfile --target web    .
#   docker build -f infra/Dockerfile --target admin  .
#   docker build -f infra/Dockerfile --target worker .   (also runs migrations: `migrate` command)
FROM node:25-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

# Amazon RDS CA bundle: DB connections verify the server certificate (sslmode=verify-full)
FROM base AS rds-ca
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/rds-global-bundle.pem

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY apps/admin/package.json apps/admin/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/services/package.json packages/services/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
# PD16: production images are built with NEXT_PUBLIC_LOCALES=ja (inlined into the bundles at build time)
ARG NEXT_PUBLIC_LOCALES=ja,zh-Hans,en
ENV NEXT_PUBLIC_LOCALES=$NEXT_PUBLIC_LOCALES
COPY . .
RUN pnpm --filter @boxrush/web build && pnpm --filter @boxrush/admin build

FROM node:25-slim AS next-runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0
COPY --from=rds-ca /etc/ssl/rds-global-bundle.pem /etc/ssl/rds-global-bundle.pem
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
COPY --from=rds-ca /etc/ssl/rds-global-bundle.pem /etc/ssl/rds-global-bundle.pem
COPY packages packages
COPY tsconfig.base.json ./
ENV NODE_ENV=production
USER node
CMD ["packages/services/node_modules/.bin/tsx", "packages/services/src/worker.ts"]
