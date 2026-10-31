import * as Sentry from "@sentry/node";
import type { ErrorEvent, EventHint } from "@sentry/node";
import { setErrorSink } from "./errorReporter";

/**
 * T17 error tracking (Sentry) with personal data removed before anything leaves the process: no user, no cookies,
 * no headers, no query strings or bodies, and e-mail addresses / phone numbers / card-like numbers masked in
 * messages and stack values. Off unless SENTRY_DSN is set (the SST secret defaults to "unset").
 */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /(?:\+81|0)\d{1,4}[- ]?\d{1,4}[- ]?\d{3,4}/g;
const LONG_DIGITS = /\b\d{12,19}\b/g;
const mask = (s: string) => s.replace(EMAIL, "[email]").replace(PHONE, "[phone]").replace(LONG_DIGITS, "[number]");

export function scrubEvent<E extends ErrorEvent>(event: E): E {
  delete event.user;
  delete event.server_name;
  if (event.request) event.request = { method: event.request.method, url: event.request.url?.split("?")[0] };
  if (event.message) event.message = mask(event.message);
  for (const ex of event.exception?.values ?? []) if (ex.value) ex.value = mask(ex.value);
  event.breadcrumbs = event.breadcrumbs?.map((b) => ({ ...b, message: b.message ? mask(b.message) : b.message, data: undefined }));
  delete event.extra;
  return event;
}

export function sentryOptions(service: string) {
  const dsn = process.env.SENTRY_DSN;
  return {
    enabled: !!dsn && dsn !== "unset",
    dsn: dsn && dsn !== "unset" ? dsn : undefined,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    initialScope: { tags: { service } },
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: (event: ErrorEvent, _hint: EventHint) => scrubEvent(event),
    beforeBreadcrumb: (b: Sentry.Breadcrumb) => (b.category === "http" || b.category === "fetch" ? null : b),
  };
}

let started = false;
/** Worker / scripts: start once. The Next.js apps start Sentry from their own instrumentation.ts. */
export function initErrorTracking(service: string) {
  if (started) return;
  started = true;
  const opts = sentryOptions(service);
  if (!opts.enabled) return;
  Sentry.init(opts);
  // job and worker failures (errorReporter.ts) go to Sentry with non-personal tags (job kind, step)
  setErrorSink((e, context) =>
    Sentry.withScope((scope) => {
      for (const [k, v] of Object.entries(context)) scope.setTag(k, String(v));
      Sentry.captureException(e);
    }),
  );
}

export async function flushErrorTracking(ms = 2_000) {
  if (Sentry.isEnabled()) await Sentry.flush(ms);
}
