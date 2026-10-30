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
