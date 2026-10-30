import { revalidatePath } from "next/cache";
import { currentStaff, type Staff } from "./session";
import type { ActionResult } from "./result";

function flatParams(params: Record<string, unknown> | undefined): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(params ?? {})) {
    if (typeof v === "number" || typeof v === "string") out[k] = v;
    else if (v instanceof Date) out[k] = v.toISOString();
    else if (Array.isArray(v)) out[k] = v.length;
  }
  return out;
}

/**
 * Wraps every server action: resolves the staff principal from the br_staff cookie, runs the service,
 * maps DomainError codes (never raw messages) and revalidates the given paths.
 */
export async function act<T>(fn: (staff: Staff) => Promise<T>, opts: { revalidate?: string[]; message?: string } = {}): Promise<ActionResult<T>> {
  const staff = await currentStaff();
  if (!staff) return { ok: false, code: "SESSION_EXPIRED" };
  try {
    const data = await fn(staff);
    for (const p of opts.revalidate ?? []) revalidatePath(p);
    return { ok: true, data, message: opts.message ?? "saved" };
  } catch (e) {
    // Name checks, not instanceof: a production build may load @boxrush/services more than once.
    const err = e as { name?: string; code?: string; params?: Record<string, unknown>; from?: string; to?: string };
    if (err?.name === "DomainError" && typeof err.code === "string") {
      const params = flatParams(err.params);
      if (err.code === "INVARIANT_VIOLATION" && Array.isArray(err.params?.issues)) params.count = (err.params.issues as unknown[]).length;
      return { ok: false, code: err.code, params };
    }
    if (err?.name === "IllegalTransitionError" || e?.constructor?.name === "IllegalTransitionError") return { ok: false, code: "ILLEGAL_TRANSITION" };
    const pg = (e as { code?: string; cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code;
    if (pg === "23505") return { ok: false, code: "DUPLICATE" };
    console.error("[admin action]", e);
    return { ok: false, code: "UNEXPECTED" };
  }
}

export const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
export const num = (fd: FormData, k: string) => Number(str(fd, k));
export const bool = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "true";
