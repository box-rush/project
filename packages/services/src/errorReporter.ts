/**
 * Where unexpected errors go besides the log. Dependency-free on purpose: the job queue and the worker report through
 * here, and only the processes that start error tracking (observability.ts) register a sink, so client and edge
 * bundles that import @boxrush/services never pull in the Sentry SDK.
 */
type Sink = (e: unknown, context: Record<string, string | number>) => void;
let sink: Sink | null = null;

export function setErrorSink(s: Sink | null) {
  sink = s;
}

export function reportError(e: unknown, context: Record<string, string | number> = {}) {
  try {
    sink?.(e, context);
  } catch {
    /* reporting must never break the caller */
  }
}
