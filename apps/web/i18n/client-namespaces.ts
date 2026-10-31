/**
 * Message namespaces client components read. Only these are serialized into every page (the whole catalog would
 * add ~25 KB of JSON to each response and to each server render). `pnpm lint:i18n` fails when a client component
 * uses a namespace that is missing here.
 */
export const CLIENT_NAMESPACES = [
  "address",
  "auth",
  "checkout",
  "collection",
  "common",
  "coupons",
  "deleteAccount",
  "errorPage",
  "errors",
  "limits",
  "lottery",
  "notifications",
  "paymentMethods",
  "ship",
  "support",
  "verify",
  "video",
  "welcome",
] as const;
