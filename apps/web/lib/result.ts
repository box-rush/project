import { DomainError, errorForLog } from "@boxrush/services";

/** Server action result. Errors carry a stable code that the UI translates (errors.<CODE>). */
export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; code: string; params?: Record<string, unknown> };

export async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    // name check, not instanceof: bundling can load the services module more than once
    if (e instanceof DomainError || (e instanceof Error && e.name === "DomainError")) {
      const d = e as DomainError;
      return { ok: false, code: d.code, params: JSON.parse(JSON.stringify(d.params ?? {})) };
    }
    console.error("[web action]", errorForLog(e));
    return { ok: false, code: "UNEXPECTED" };
  }
}
