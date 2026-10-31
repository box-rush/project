import { mkdir, writeFile } from "node:fs/promises";
import { awsClientConfig } from "./adapters/aws";
import { dirname, join } from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { H } from "@boxrush/core";
import { asc, auditArchives, auditLog, desc, gt, sql } from "@boxrush/db";
import type { Ctx } from "./context";

/**
 * T7: hourly export of new audit rows to storage nobody can delete or rewrite. Tampering would then require changing
 * the database, the hash chain and the locked archive. Production: S3 Object Lock (compliance mode) in the
 * isolated randomness account; local: a directory.
 */
export interface ArchiveStore {
  put(key: string, body: string, sha256: string): Promise<void>;
}

export class S3ObjectLockStore implements ArchiveStore {
  constructor(
    private readonly bucket: string,
    private readonly retainYears = 10,
    private readonly client: Pick<S3Client, "send"> = new S3Client(awsClientConfig()),
  ) {}
  async put(key: string, body: string, sha256: string) {
    const until = new Date();
    until.setUTCFullYear(until.getUTCFullYear() + this.retainYears);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: "application/x-ndjson",
        ChecksumSHA256: Buffer.from(sha256, "hex").toString("base64"),
        ObjectLockMode: "COMPLIANCE",
        ObjectLockRetainUntilDate: until,
      }),
    );
  }
}

export class LocalDirStore implements ArchiveStore {
  constructor(private readonly dir: string) {}
  async put(key: string, body: string) {
    const p = join(this.dir, key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body, { flag: "wx" }); // never overwrite
  }
}

export async function archiveAuditBatch(ctx: Ctx, store: ArchiveStore, maxRows = 50_000) {
  const [last] = await ctx.db.select().from(auditArchives).orderBy(desc(auditArchives.seqTo)).limit(1);
  const from = last?.seqTo ?? 0;
  const rows = await ctx.db
    .select({ seq: auditLog.seq, at: auditLog.at, actorType: auditLog.actorType, actorId: auditLog.actorId, action: auditLog.action, entity: auditLog.entity, entityId: auditLog.entityId, data: sql<string>`${auditLog.data}::text`, prevHash: auditLog.prevHash, hash: auditLog.hash })
    .from(auditLog)
    .where(gt(auditLog.seq, from))
    .orderBy(asc(auditLog.seq))
    .limit(maxRows);
  if (rows.length === 0) return null;
  if (last && rows[0]!.prevHash !== last.headHash) throw new Error(`audit chain discontinuity after seq ${from}`);
  const body = rows.map((r) => JSON.stringify({ ...r, at: r.at.toISOString() })).join("\n") + "\n";
  const sha256 = H(body);
  const seqTo = rows[rows.length - 1]!.seq;
  const key = `audit/${ctx.now().toISOString().slice(0, 10)}/${String(from + 1).padStart(12, "0")}-${String(seqTo).padStart(12, "0")}.ndjson`;
  await store.put(key, body, sha256);
  const headHash = rows[rows.length - 1]!.hash;
  await ctx.db.insert(auditArchives).values({ seqFrom: from + 1, seqTo, headHash, objectKey: key, sha256, createdAt: ctx.now() });
  return { key, seqFrom: from + 1, seqTo, headHash, sha256, rows: rows.length };
}
