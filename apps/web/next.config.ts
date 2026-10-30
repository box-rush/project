import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  transpilePackages: ["@boxrush/core", "@boxrush/db", "@boxrush/services"],
  serverExternalPackages: ["pg", "stripe"],
  poweredByHeader: false,
};

export default withNextIntl(nextConfig);
