import * as Sentry from "@sentry/nextjs";

/**
 * T17: server-side error tracking only (nothing is sent from the browser). Personal data is removed by the shared
 * scrubber in @boxrush/services/observability; off unless SENTRY_DSN is set.
 */
export async function register() {
  // the Node-only import sits inside this branch so the edge bundle (middleware) never includes it
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { sentryOptions } = await import("@boxrush/services/observability");
    const opts = sentryOptions("admin");
    if (opts.enabled) Sentry.init(opts as Parameters<typeof Sentry.init>[0]);
  }
}

export const onRequestError = Sentry.captureRequestError;
