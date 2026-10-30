import { jstParts } from "./time";

const WEEKDAYS_JA = ["日", "月", "火", "水", "木", "金", "土"];

/** ¥12,800 — yen, thousands separator, no decimals (§9.2). Amounts never change with locale (T19). */
export function formatYen(amount: number): string {
  return `¥${Math.round(amount).toLocaleString("en-US")}`;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 9/28(月) 20:00 in JST. */
export function formatJst(d: Date | string): string {
  const p = jstParts(typeof d === "string" ? new Date(d) : d);
  return `${p.month}/${p.day}(${WEEKDAYS_JA[p.weekday]}) ${pad(p.hour)}:${pad(p.minute)}`;
}

/** 2026/09/28 20:00:05 JST — for records and audit views. */
export function formatJstFull(d: Date | string): string {
  const p = jstParts(typeof d === "string" ? new Date(d) : d);
  return `${p.year}/${pad(p.month)}/${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)} JST`;
}

/** 2日 03:14:05 */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return "0:00:00";
  const s = Math.floor(ms / 1000);
  const days = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${days > 0 ? `${days}日 ` : ""}${pad(h)}:${pad(m)}:${pad(sec)}`;
}

/** 3f9a…c21e */
export function truncateHash(h: string, head = 4, tail = 4): string {
  return h.length <= head + tail + 1 ? h : `${h.slice(0, head)}…${h.slice(-tail)}`;
}

/** 01:23:45 for video timestamps */
export function formatVideoTs(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
