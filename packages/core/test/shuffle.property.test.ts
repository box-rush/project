import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { drawCardNumbers, permutation } from "../src";

describe("bx-shuffle-v1 properties", () => {
  it("permutation is a bijection of 0..n-1 and deterministic", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 64 }), fc.integer({ min: 0, max: 300 }), (final, n) => {
        const p = permutation(final, n);
        expect([...p].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i));
        expect(permutation(final, n)).toEqual(p);
      }),
      { numRuns: 200 },
    );
  });

  it("card draw partitions the checklist: exhaustive, exclusive, balanced (sizes differ by ≤ 1, earlier lines get the remainder)", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.integer({ min: 1, max: 40 }), fc.integer({ min: 1, max: 250 }), (seed, n, m) => {
        const lines = Array.from({ length: n }, (_, i) => `user_${i}#${String(i + 1).padStart(2, "0")}`);
        const checklist = Array.from({ length: m }, (_, i) => `${i + 1}/${m}`);
        const r = drawCardNumbers({ serverSeed: seed, participantsText: lines.join("\n"), checklist });
        const flat = r.assignment.flat();
        expect(flat.length).toBe(m);
        expect(new Set(flat).size).toBe(m);
        const sizes = r.assignment.map((a) => a.length);
        expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
        for (let i = 1; i < sizes.length; i++) expect(sizes[i]!).toBeLessThanOrEqual(sizes[i - 1]!);
      }),
      { numRuns: 150 },
    );
  });

  it("any change of the participant list changes the result (entropy from participants)", () => {
    const checklist = Array.from({ length: 50 }, (_, i) => String(i));
    const a = drawCardNumbers({ serverSeed: "s", participantsText: "user_aaaa#01\nuser_bbbb#02", checklist });
    const b = drawCardNumbers({ serverSeed: "s", participantsText: "user_aaaa#01\nuser_bbbc#02", checklist });
    expect(a.final).not.toBe(b.final);
  });
});
