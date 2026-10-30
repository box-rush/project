import { hmacSha256Hex } from "./hash";

/**
 * T9: per-lottery pseudonym `user_` + first 4 hex of HMAC-SHA256(key, userId ‖ lotteryId).
 * On an in-lottery collision, every colliding user extends to 6 hex. Not linkable across lotteries.
 */
export function pseudonymsFor(keyHex: string, lotteryId: string, userIds: readonly string[]): Map<string, string> {
  const unique = [...new Set(userIds)];
  const full = new Map(unique.map((u) => [u, hmacSha256Hex(keyHex, `${u}‖${lotteryId}`)]));
  const result = new Map<string, string>();
  const byShort = new Map<string, string[]>();
  for (const [u, h] of full) {
    const s = h.slice(0, 4);
    byShort.set(s, [...(byShort.get(s) ?? []), u]);
  }
  for (const [short, users] of byShort) {
    if (users.length === 1) result.set(users[0]!, `user_${short}`);
    else for (const u of users) result.set(u, `user_${full.get(u)!.slice(0, 6)}`);
  }
  const values = [...result.values()];
  if (new Set(values).size !== values.length) throw new Error("pseudonym collision after extension");
  return result;
}
