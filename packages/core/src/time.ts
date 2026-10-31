/** All storage is UTC; all display and calendar logic is JST (UTC+9, no DST). */
const JST_OFFSET_MS = 9 * 3600_000;

export interface JstParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = Sunday
}

export function jstParts(d: Date): JstParts {
  const t = new Date(d.getTime() + JST_OFFSET_MS);
  return {
    year: t.getUTCFullYear(),
    month: t.getUTCMonth() + 1,
    day: t.getUTCDate(),
    hour: t.getUTCHours(),
    minute: t.getUTCMinutes(),
    second: t.getUTCSeconds(),
    weekday: t.getUTCDay(),
  };
}

/** Build a UTC Date from JST wall-clock components. */
export function fromJst(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second) - JST_OFFSET_MS);
}

/** "YYYY-MM" (JST) → [from, to) instants, so month filters can use an index instead of to_char() on every row. */
export function jstMonthRange(month: string): { from: Date; to: Date } {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) throw new Error(`invalid month ${month}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  return { from: fromJst(y, mo, 1), to: mo === 12 ? fromJst(y + 1, 1, 1) : fromJst(y, mo + 1, 1) };
}

export function startOfJstMonth(d: Date): Date {
  const p = jstParts(d);
  return fromJst(p.year, p.month, 1);
}

export function startOfJstDay(d: Date): Date {
  const p = jstParts(d);
  return fromJst(p.year, p.month, p.day);
}

export function addHours(d: Date, h: number): Date {
  return new Date(d.getTime() + h * 3600_000);
}
export function addMinutes(d: Date, m: number): Date {
  return new Date(d.getTime() + m * 60_000);
}
export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}
