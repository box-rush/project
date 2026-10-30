/** Serializable outcome of a server action. Errors carry a stable code that the UI translates. */
export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string; params?: Record<string, string | number> }
  | { ok: false; code: string; params?: Record<string, string | number> };

export const idle: ActionResult<never> | null = null;
