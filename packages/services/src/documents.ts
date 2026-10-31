import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { asc, documents, eq, inArray, intakeBookings } from "@boxrush/db";
import { audit } from "./audit";
import type { Ctx } from "./context";
import { fail } from "./errors";
import { requireRole, staffActor, type StaffPrincipal } from "./principals";

/**
 * F16.3 purchase proofs (invoice, receipt, delivery note) for an intake booking — the evidence behind §6.2.1 货源凭证
 * and the 古物台帳. Files are private: only the merchant who uploaded them and back-office staff who inspect or
 * account for stock can read them. Records are append-only (DB trigger); a wrong file is superseded, never deleted.
 */
export interface DocumentStore {
  put(key: string, body: Uint8Array, contentType: string, sha256: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
}

export class S3DocumentStore implements DocumentStore {
  constructor(
    private readonly bucket: string,
    private readonly client: Pick<S3Client, "send"> = new S3Client({ region: process.env.AWS_REGION ?? "ap-northeast-1" }),
  ) {}
  async put(key: string, body: Uint8Array, contentType: string, sha256: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ChecksumSHA256: Buffer.from(sha256, "hex").toString("base64"),
        ServerSideEncryption: "AES256",
        IfNoneMatch: "*", // never overwrite
      }),
    );
  }
  async get(key: string) {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return new Uint8Array(await r.Body!.transformToByteArray());
  }
}

/** Local development: files under DOCUMENTS_DIR (default .data/documents). */
export class LocalDocumentStore implements DocumentStore {
  constructor(private readonly dir = resolve(process.env.DOCUMENTS_DIR ?? ".data/documents")) {}
  private path(key: string) {
    const p = resolve(this.dir, key);
    if (!p.startsWith(this.dir + sep)) fail("NOT_FOUND");
    return p;
  }
  async put(key: string, body: Uint8Array) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body, { flag: "wx" });
  }
  async get(key: string) {
    return new Uint8Array(await readFile(this.path(key)));
  }
}

export function documentStore(): DocumentStore {
  if (process.env.DOCUMENTS_BUCKET) return new S3DocumentStore(process.env.DOCUMENTS_BUCKET);
  if (process.env.NODE_ENV === "production" && !process.env.DOCUMENTS_DIR) throw new Error("DOCUMENTS_BUCKET is required in production");
  return new LocalDocumentStore();
}

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** The type comes from the file's own bytes, never from the browser's claim. */
function sniff(b: Uint8Array): string | null {
  const s = (i: number, n: number) => String.fromCharCode(...b.slice(i, i + n));
  if (s(0, 5) === "%PDF-") return "application/pdf";
  if (b[0] === 0x89 && s(1, 3) === "PNG") return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (s(0, 4) === "RIFF" && s(8, 4) === "WEBP") return "image/webp";
  return null;
}

export async function uploadIntakeDocument(ctx: Ctx, store: DocumentStore, p: StaffPrincipal, bookingId: string, file: { name: string; bytes: Uint8Array }) {
  requireRole(p, "MERCHANT");
  const [booking] = await ctx.db.select().from(intakeBookings).where(eq(intakeBookings.id, bookingId));
  if (!booking || booking.merchantId !== p.merchantId) fail("NOT_FOUND");
  if (file.bytes.length === 0 || file.bytes.length > MAX_DOCUMENT_BYTES) fail("DOCUMENT_TOO_LARGE", { max: "10MB" });
  const contentType = sniff(file.bytes);
  if (!contentType) fail("DOCUMENT_TYPE");
  const sha256 = createHash("sha256").update(file.bytes).digest("hex");
  const id = randomUUID();
  const storageKey = join("intake", bookingId, id);
  const fileName = file.name.replace(/[\\/\r\n"]/g, "_").slice(0, 120) || "document";
  await store.put(storageKey, file.bytes, contentType, sha256);
  const now = ctx.now();
  await ctx.db.transaction(async (tx) => {
    await tx.insert(documents).values({ id, intakeBookingId: bookingId, merchantId: booking.merchantId, fileName, contentType, size: file.bytes.length, sha256, storageKey, uploadedBy: p.id, uploadedAt: now });
    await audit(tx, staffActor(p), "intake.document", "intake_booking", bookingId, { documentId: id, fileName, sha256, size: file.bytes.length }, now);
  });
  return { id, sha256 };
}

export async function documentsForBookings(ctx: Ctx, bookingIds: string[]) {
  if (!bookingIds.length) return [];
  return ctx.db
    .select({ id: documents.id, intakeBookingId: documents.intakeBookingId, fileName: documents.fileName, size: documents.size, sha256: documents.sha256, uploadedAt: documents.uploadedAt })
    .from(documents)
    .where(inArray(documents.intakeBookingId, bookingIds))
    .orderBy(asc(documents.uploadedAt));
}

/** The merchant's own files; warehouse (inspection), reviewer (listing review) and finance (古物台帳) read any. */
export async function readDocument(ctx: Ctx, store: DocumentStore, p: StaffPrincipal, documentId: string) {
  const [d] = await ctx.db.select().from(documents).where(eq(documents.id, documentId));
  if (!d) fail("NOT_FOUND");
  const backOffice = ["WAREHOUSE", "REVIEWER", "FINANCE", "ADMIN"].some((r) => p.roles.includes(r as never));
  if (!backOffice && !(p.roles.includes("MERCHANT") && p.merchantId === d.merchantId)) fail("FORBIDDEN");
  const body = await store.get(d.storageKey);
  if (createHash("sha256").update(body).digest("hex") !== d.sha256) fail("DOCUMENT_TAMPERED");
  await audit(ctx.db, staffActor(p), "intake.document_read", "intake_booking", d.intakeBookingId, { documentId: d.id });
  return { body, fileName: d.fileName, contentType: d.contentType };
}
