import { defineRouting } from "next-intl/routing";
import { createNavigation } from "next-intl/navigation";

/**
 * T19: ja (source, default, no prefix) / zh-Hans / en. PD16: at launch only ja is public —
 * production sets NEXT_PUBLIC_LOCALES=ja; zh-Hans and en stay available for development.
 */
const ALL = ["ja", "zh-Hans", "en"] as const;
const enabled = (process.env.NEXT_PUBLIC_LOCALES ?? ALL.join(",")).split(",").filter((l): l is (typeof ALL)[number] => (ALL as readonly string[]).includes(l));

export const routing = defineRouting({
  locales: enabled.length ? enabled : ["ja"],
  defaultLocale: "ja",
  localePrefix: "as-needed",
});

export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
