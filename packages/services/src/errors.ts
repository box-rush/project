/** Domain errors carry a stable code; UIs map codes to i18n messages (never raw text). */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    public readonly params: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = "DomainError";
  }
}

export function fail(code: string, params?: Record<string, unknown>): never {
  throw new DomainError(code, params);
}

/**
 * An unexpected error as ONE log line: messages can carry user input, and a newline in it would start a forged log
 * line (CloudWatch metric filters count lines such as "[alert]").
 */
export function errorForLog(e: unknown): string {
  const s = e instanceof Error ? (e.stack ?? `${e.name}: ${e.message}`) : String(e);
  return JSON.stringify(s.slice(0, 4000));
}
