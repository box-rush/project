import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale } from "./config";

/** T19: locale comes from a cookie (no locale in the URL). Japanese is the source language. */
export default getRequestConfig(async () => {
  const v = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(v) ? v : DEFAULT_LOCALE;
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
    // Times are rendered with formatJst / formatJstFull, never with the viewer's zone.
    timeZone: "Asia/Tokyo",
  };
});
