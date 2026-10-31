import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const config: NextConfig = {
  // container image (infra/Dockerfile): self-contained server with the monorepo traced in
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  transpilePackages: ["@boxrush/core", "@boxrush/db", "@boxrush/services"],
  serverExternalPackages: ["pg", "stripe", "@sentry/node"],
  poweredByHeader: false,
};

export default withNextIntl(config);
