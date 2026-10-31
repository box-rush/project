import { NextResponse } from "next/server";
import { MAX_DOCUMENT_BYTES, documentStore, uploadIntakeDocument } from "@boxrush/services";
import { ctx, currentStaff } from "@/lib/session";

/**
 * F16.3 upload. A route handler rather than a server action so the session is checked and the declared size enforced
 * before a byte of the body is read (server actions keep the default 1 MB limit everywhere else).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await currentStaff();
  if (!staff) return NextResponse.json({ error: "SESSION_EXPIRED" }, { status: 401 });
  const length = Number(req.headers.get("content-length") ?? NaN);
  if (!Number.isFinite(length)) return NextResponse.json({ error: "DOCUMENT_REQUIRED" }, { status: 411 });
  if (length > MAX_DOCUMENT_BYTES + 64 * 1024) return NextResponse.json({ error: "DOCUMENT_TOO_LARGE", params: { max: "10MB" } }, { status: 413 });
  const { id } = await params;
  try {
    const f = (await req.formData()).get("file");
    if (!(f instanceof File) || f.size === 0) return NextResponse.json({ error: "DOCUMENT_REQUIRED" }, { status: 400 });
    const r = await uploadIntakeDocument(ctx(), documentStore(), staff, id, { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
    return NextResponse.json({ ok: true, id: r.id }, { status: 201 });
  } catch (e) {
    const err = e as { name?: string; code?: string; params?: Record<string, unknown> };
    if (err?.name === "DomainError") return NextResponse.json({ error: err.code, params: err.params }, { status: err.code === "FORBIDDEN" ? 403 : err.code === "NOT_FOUND" ? 404 : 400 });
    console.error("[intake documents]", e);
    return NextResponse.json({ error: "UNEXPECTED" }, { status: 500 });
  }
}
