import { defineConfig } from "@playwright/test";

/**
 * Main-flow E2E smoke (§10.12 CI). Runs against a production build of apps/web on a freshly seeded DB:
 *   pnpm db:reset && pnpm --filter @boxrush/web build && pnpm e2e
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100", locale: "ja-JP", timezoneId: "Asia/Tokyo" },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          command: "pnpm --filter @boxrush/web exec next start -p 3100",
          url: "http://localhost:3100",
          reuseExistingServer: true,
          timeout: 120_000,
          env: { PAYMENT_PROVIDER: "mock", BETTER_AUTH_URL: "http://localhost:3100", WEB_BASE_URL: "http://localhost:3100", RNG_SEED_KEY: "00".repeat(32) },
        },
        {
          command: "pnpm --filter @boxrush/admin exec next start -p 3101",
          url: "http://localhost:3101/login",
          reuseExistingServer: true,
          timeout: 120_000,
          // approval commits the seed (T11): the admin app reaches the seed vault through the rng login, as in infra/stack.ts
          env: { RNG_SEED_KEY: "00".repeat(32), RNG_DATABASE_URL: process.env.RNG_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgres://boxrush:boxrush@localhost:5432/boxrush" },
        },
      ],
});
