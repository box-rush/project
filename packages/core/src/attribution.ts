import type { AttributionMethod } from "./status";

/**
 * J7 attribution (§6.4.5, F21.4, F21.6, F21.10).
 * Every opened card whose number is on a slot's list goes to that slot automatically,
 * including duplicates. Off-list cards follow the fallback rule and need a human decision.
 */
export interface SlotDraw {
  slotNumber: number;
  numbers: readonly string[];
}

export function buildNumberIndex(draw: readonly SlotDraw[]): Map<string, number> {
  const idx = new Map<string, number>();
  for (const s of draw) for (const n of s.numbers) idx.set(n, s.slotNumber);
  return idx;
}

export function autoAttribute(index: Map<string, number>, cardNumber: string): { slotNumber: number; method: AttributionMethod } | null {
  const slot = index.get(cardNumber);
  return slot === undefined ? null : { slotNumber: slot, method: "AUTO" };
}

/** Slots that opened 0 cards and therefore receive one guarantee card (PD18). */
export function slotsNeedingGuarantee(slotNumbers: readonly number[], attributed: readonly { slotNumber: number | null }[]): number[] {
  const counts = new Map<number, number>(slotNumbers.map((n) => [n, 0]));
  for (const c of attributed) if (c.slotNumber !== null && counts.has(c.slotNumber)) counts.set(c.slotNumber, counts.get(c.slotNumber)! + 1);
  return [...counts].filter(([, c]) => c === 0).map(([n]) => n);
}

/** Normalize keypad input with the per-lottery prefix/suffix (T4): "25" with suffix "/159" → "025/159". */
export function normalizeCardInput(raw: string, checklist: readonly string[]): string | null {
  const t = raw.trim().toUpperCase();
  if (checklist.includes(t)) return t;
  const m = /^(\d+)$/.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  const hit = checklist.find((c) => {
    const head = /(\d+)/.exec(c.includes("/") ? c.split("/")[0]! : c.split("-").pop()!);
    return head !== null && Number(head[1]) === n;
  });
  return hit ?? null;
}
