import { auditLog, sql, type DbOrTx } from "@boxrush/db";
import { H } from "@boxrush/core";

export type Actor = { type: "USER" | "STAFF" | "SYSTEM" | "RNG"; id: string | null };
export const SYSTEM: Actor = { type: "SYSTEM", id: null };

/** F24.5 / T7: every back-office write appends here, in the same transaction as the change. */
export async function audit(
  tx: DbOrTx,
  actor: Actor,
  action: string,
  entity: string,
  entityId: string | null,
  data: Record<string, unknown> = {},
  at?: Date,
): Promise<void> {
  await tx.insert(auditLog).values({ actorType: actor.type, actorId: actor.id, action, entity, entityId, data, ...(at ? { at } : {}) });
}

/** Recomputes the chain; returns the first broken seq or null. Used by O17 and the hourly archiver. */
export async function verifyAuditChain(db: DbOrTx): Promise<{ ok: boolean; brokenAt: number | null; count: number; head: string }> {
  const rows = (
    await db.execute<{ seq: string; at_text: string; actor_type: string; actor_id: string | null; action: string; entity: string; entity_id: string | null; data_text: string; prev_hash: string; hash: string }>(
      sql`SELECT seq, to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS at_text, actor_type, actor_id, action, entity, entity_id, data::text AS data_text, prev_hash, hash FROM audit_log ORDER BY seq`,
    )
  ).rows;
  let prev = "";
  for (const r of rows) {
    const expect = H(`${prev}|${r.seq}|${r.at_text}|${r.actor_type}|${r.actor_id ?? ""}|${r.action}|${r.entity}|${r.entity_id ?? ""}|${r.data_text}`);
    if (r.prev_hash !== prev || r.hash !== expect) return { ok: false, brokenAt: Number(r.seq), count: rows.length, head: prev };
    prev = r.hash;
  }
  return { ok: true, brokenAt: null, count: rows.length, head: prev };
}
