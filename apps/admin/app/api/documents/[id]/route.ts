import { NextResponse } from "next/server";
import { documentStore, readDocument } from "@boxrush/services";
import { ctx, currentStaff } from "@/lib/session";

/** F16.3: download a purchase proof (merchant: own files; warehouse / reviewer / finance: any). Every read is audited. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await currentStaff();
  if (!staff) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const d = await readDocument(ctx(), documentStore(), staff, id);
    return new NextResponse(Buffer.from(d.body), {
      headers: {
        "content-type": d.contentType,
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(d.fileName)}`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (e) {
    const code = (e as Error)?.name === "DomainError" ? (e as { code: string }).code : "UNEXPECTED";
    if (code === "UNEXPECTED") console.error("[documents]", e);
    return NextResponse.json({ error: code }, { status: code === "FORBIDDEN" ? 403 : code === "NOT_FOUND" ? 404 : 500 });
  }
}
