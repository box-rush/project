import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { drawCardNumbers, finalSeed, participantsHash, seedCommit, verifyCardDraw } from "../src";

/** §10.4.2b test vector (first release: card-number random, no beacon). Any implementation MUST pass. */
describe("bx-shuffle-v1 — §10.4.2b vector L016", () => {
  const serverSeed = "boxrush-mock-L016";
  const text = ["user_a1b2#01", "user_a1b2#02", "user_c3d4#03", "user_e5f6#04"].join("\n");
  const checklist = Array.from({ length: 20 }, (_, i) => `${String(i + 1).padStart(3, "0")}/020`);

  it("commit / participants_hash / final", () => {
    expect(seedCommit(serverSeed)).toBe("2bac4e62f1f1bd8afafe2fe1aef26db51da3ab1bafc4962b72fdccc399641727");
    expect(participantsHash(text)).toBe("3f00bad133e82371f5db0a960a8bd8bbd7290bab2550ecc19880eee347d339da");
    expect(finalSeed(serverSeed, participantsHash(text), "")).toBe("725f49e1da8916743065aacc1df2417b5251a09ff7bf35dbcda5d3df3eded9bd");
  });

  it("assignment per slot, in draw order", () => {
    const r = drawCardNumbers({ serverSeed, participantsText: text, checklist });
    expect(r.assignment).toEqual([
      ["016/020", "004/020", "008/020", "014/020", "013/020"],
      ["007/020", "011/020", "017/020", "002/020", "001/020"],
      ["018/020", "003/020", "006/020", "019/020", "010/020"],
      ["012/020", "015/020", "009/020", "005/020", "020/020"],
    ]);
  });
});

/** Prototype UI-09 data (L009 / L011), produced by the in-browser implementation. */
describe("bx-shuffle-v1 — prototype UI-09 vectors", () => {
  const data = JSON.parse(readFileSync(new URL("./fixtures/prototype-ui09-vectors.json", import.meta.url), "utf8")) as Record<
    string,
    { serverSeed: string; commit: string; participantsText: string; participantsHash: string; checklist: string[]; slots: Record<string, string[]> }
  >;
  for (const [id, v] of Object.entries(data)) {
    it(`${id} recomputes and verifies`, () => {
      const lines = v.participantsText.split("\n");
      const res = verifyCardDraw({
        serverSeed: v.serverSeed,
        participantsText: v.participantsText,
        checklist: v.checklist,
        publishedCommit: v.commit,
        publishedParticipantsHash: v.participantsHash,
        publishedAssignment: lines.map((l) => v.slots[l]!),
      });
      expect(res.checks).toEqual([
        { id: "commit", ok: true },
        { id: "participants", ok: true },
        { id: "assignment", ok: true, detail: undefined },
      ]);
    });

    it(`${id} detects a tampered assignment`, () => {
      const lines = v.participantsText.split("\n");
      const published = lines.map((l) => [...v.slots[l]!]);
      const a = published[0]![0]!;
      published[0]![0] = published[1]![0]!;
      published[1]![0] = a;
      const res = verifyCardDraw({
        serverSeed: v.serverSeed,
        participantsText: v.participantsText,
        checklist: v.checklist,
        publishedCommit: v.commit,
        publishedParticipantsHash: v.participantsHash,
        publishedAssignment: published,
      });
      expect(res.ok).toBe(false);
      expect(res.checks.find((c) => c.id === "assignment")!.ok).toBe(false);
    });
  }
});
