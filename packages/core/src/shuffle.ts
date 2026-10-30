import { H } from "./hash";

/**
 * bx-shuffle-v1 (§10.4). The algorithm version is written into each lottery snapshot;
 * changing anything here requires a NEW version id — never edit v1 in place.
 */
export const ALGORITHM_V1 = "bx-shuffle-v1" as const;
export type AlgorithmVersion = typeof ALGORITHM_V1;

export type Entropy = "PARTICIPANTS" | "PUBLIC_BEACON";

/** ① commit = H(server_seed) */
export function seedCommit(serverSeed: string): string {
  return H(serverSeed);
}

/** ③ final = H(server_seed + "|" + participants_hash + "|" + beacon). First release: beacon = "" (PD20). */
export function finalSeed(serverSeed: string, participantsHash: string, beacon = ""): string {
  return H(`${serverSeed}|${participantsHash}|${beacon}`);
}

/** ④ Fisher–Yates permutation of [0..n-1] driven by `final`. */
export function permutation(final: string, n: number): number[] {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i >= 1; i--) {
    const j = Number.parseInt(H(`${final}:${i}`).slice(0, 8), 16) % (i + 1);
    const t = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = t;
  }
  return arr;
}

export function shuffle<T>(final: string, units: readonly T[]): T[] {
  return permutation(final, units.length).map((k) => units[k]!);
}
