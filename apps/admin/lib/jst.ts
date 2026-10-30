import { fromJst, jstParts } from "@boxrush/core/time";

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-11-01T20:00" (wall clock in JST, as typed into <input type=datetime-local>) → Date. */
export function parseJstLocal(v: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v);
  if (!m) return null;
  return fromJst(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]));
}

/** Date → "2026-11-01T20:00" in JST for datetime-local inputs. */
export function toJstLocal(d: Date | string): string {
  const p = jstParts(typeof d === "string" ? new Date(d) : d);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** "2026-10" for the current JST month. */
export function jstMonth(d: Date): string {
  const p = jstParts(d);
  return `${p.year}-${pad(p.month)}`;
}

export function monthRange(month: string): { from: Date; to: Date } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return { from: fromJst(y, m, 1), to: m === 12 ? fromJst(y + 1, 1, 1) : fromJst(y, m + 1, 1) };
}
