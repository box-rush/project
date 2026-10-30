import { randomBytes } from "node:crypto";
import { ALGORITHM_V1, drawCardNumbers, seedCommit } from "@boxrush/core";
import { auditLog, eq, lotteries, seedVault, type Db } from "@boxrush/db";
import type { SeedKeyProvider } from "./adapters/keys";

/**
 * SV3 — verifiable randomness service (T11, I4, G5).
 * Deployed separately with its own DB role (`boxrush_rng`); the application role cannot read `rng.seed_vault`.
 * Nobody — merchant, self-operated team or ops — can trigger, re-run or choose a draw: `draw()` only
 * executes when the lottery is LOCKED with its participant list fixed, and the result is deterministic.
 */
export class RandomnessService {
  constructor(
    private readonly db: Db,
    private readonly keys: SeedKeyProvider,
  ) {}

  /** ① Generate a 256-bit CSPRNG seed, store it encrypted, return only the commitment. Idempotent per lottery. */
  async commit(lotteryId: string, now: Date): Promise<{ commit: string; committedAt: Date }> {
    const existing = await this.db.select().from(seedVault).where(eq(seedVault.lotteryId, lotteryId));
    if (existing[0]) return { commit: existing[0].commit, committedAt: existing[0].createdAt };
    const seed = randomBytes(32).toString("hex");
    const commit = seedCommit(seed);
    const encryptedSeed = await this.keys.encrypt(seed);
    await this.db.transaction(async (tx) => {
      await tx.insert(seedVault).values({ lotteryId, commit, encryptedSeed, keyId: this.keys.keyId, createdAt: now });
      await tx.insert(auditLog).values({ actorType: "RNG", actorId: "rng", action: "seed.commit", entity: "lottery", entityId: lotteryId, data: { commit }, at: now });
    });
    return { commit, committedAt: now };
  }

  /**
   * ③④⑤ Run bx-shuffle-v1 over the frozen checklist and reveal the seed.
   * Preconditions are read from the lottery row (not from the caller): status LOCKED, participants hash fixed.
   */
  async draw(lotteryId: string, now: Date) {
    const [lot] = await this.db.select().from(lotteries).where(eq(lotteries.id, lotteryId));
    if (!lot) throw new Error("lottery not found");
    if (lot.status !== "LOCKED" || !lot.participantsText || !lot.participantsHash) throw new Error("draw precondition: LOCKED with fixed participants");
    const [vault] = await this.db.select().from(seedVault).where(eq(seedVault.lotteryId, lotteryId));
    if (!vault) throw new Error("no seed commitment");
    if (vault.commit !== lot.seedCommit) throw new Error("commitment mismatch");
    const serverSeed = await this.keys.decrypt(vault.encryptedSeed);
    const snapshot = lot.snapshot as { checklist: { number: string }[] };
    const result = drawCardNumbers({ serverSeed, participantsText: lot.participantsText, checklist: snapshot.checklist.map((c) => c.number), beacon: "" });
    if (result.commit !== lot.seedCommit || result.participantsHash !== lot.participantsHash) throw new Error("integrity check failed");
    await this.db.transaction(async (tx) => {
      await tx.update(seedVault).set({ revealedAt: now }).where(eq(seedVault.lotteryId, lotteryId));
      await tx.insert(auditLog).values({ actorType: "RNG", actorId: "rng", action: "seed.reveal", entity: "lottery", entityId: lotteryId, data: { final: result.final, algorithm: ALGORITHM_V1 }, at: now });
    });
    return { serverSeed, ...result };
  }
}
