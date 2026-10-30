import { ALGORITHM_V1, finalSeed, seedCommit, shuffle } from "./shuffle";
import { participantsHash } from "./participants";

/**
 * J7 card-number random draw (§6.4.5, §10.4.1 "first release differences").
 * The frozen checklist (official order) is shuffled; the k-th shuffled number goes to
 * participant line (k mod n). Lines earlier in the list therefore get the remainder.
 */
export interface CardDrawInput {
  serverSeed: string;
  participantsText: string; // lines joined with "\n"
  checklist: readonly string[]; // official order, frozen at listing
  beacon?: string; // "" in the first release
}

export interface CardDrawResult {
  algorithm: typeof ALGORITHM_V1;
  commit: string;
  participantsHash: string;
  final: string;
  shuffled: string[];
  /** index = participant line index; value = card numbers in draw order */
  assignment: string[][];
}

export function drawCardNumbers(input: CardDrawInput): CardDrawResult {
  const lines = input.participantsText.split("\n");
  if (input.participantsText.length === 0 || lines.length === 0) throw new Error("no participants");
  const pHash = participantsHash(input.participantsText);
  const final = finalSeed(input.serverSeed, pHash, input.beacon ?? "");
  const shuffled = shuffle(final, input.checklist);
  const n = lines.length;
  const assignment: string[][] = lines.map(() => []);
  shuffled.forEach((num, k) => assignment[k % n]!.push(num));
  return { algorithm: ALGORITHM_V1, commit: seedCommit(input.serverSeed), participantsHash: pHash, final, shuffled, assignment };
}

export interface VerifyInput extends CardDrawInput {
  publishedCommit: string;
  publishedParticipantsHash: string;
  publishedAssignment: readonly (readonly string[])[];
}

export type VerifyCheck = { id: "commit" | "participants" | "assignment"; ok: boolean; detail?: string };

/** Independent recomputation used by the verify page (F8.3), public verifier (V02) and tests. */
export function verifyCardDraw(input: VerifyInput): { ok: boolean; checks: VerifyCheck[]; result: CardDrawResult } {
  const result = drawCardNumbers(input);
  const checks: VerifyCheck[] = [];
  checks.push({ id: "commit", ok: result.commit === input.publishedCommit });
  checks.push({ id: "participants", ok: result.participantsHash === input.publishedParticipantsHash });
  const norm = (a: readonly string[]) => [...a].sort().join(",");
  const badIndex = result.assignment.findIndex((a, i) => norm(a) !== norm(input.publishedAssignment[i] ?? []));
  const lengthsMatch = result.assignment.length === input.publishedAssignment.length;
  checks.push({
    id: "assignment",
    ok: badIndex < 0 && lengthsMatch,
    detail: badIndex >= 0 ? `line ${badIndex + 1}` : lengthsMatch ? undefined : "line count",
  });
  return { ok: checks.every((c) => c.ok), checks, result };
}
