import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { formatJst } from "@boxrush/core/format";
import { DomainError, ticketDetail } from "@boxrush/services";
import { getCtx } from "@/lib/ctx";
import { requireUser } from "@/lib/guard";
import { PageTitle } from "@/components/ui";
import { ReplyForm } from "./ReplyForm";

export const dynamic = "force-dynamic";

export default async function TicketPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const user = await requireUser();
  const t = await getTranslations("support");
  let d;
  try {
    d = await ticketDetail(getCtx(), id, { userId: user.id });
  } catch (e) {
    if ((e as Error)?.name === "DomainError") notFound();
    throw e;
  }
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageTitle>
        #{d.ticket.code} {d.ticket.subject}
      </PageTitle>
      <span className="chip">{t(`status.${d.ticket.status}` as never)}</span>
      <ul className="space-y-2">
        {d.messages.map((m) => (
          <li key={m.id} className={`card p-3 text-sm ${m.authorType === "STAFF" ? "border-primary" : ""}`}>
            <div className="whitespace-pre-line">{m.body}</div>
            <div className="num mt-1 text-xs text-ink-2">{formatJst(m.createdAt)}</div>
          </li>
        ))}
      </ul>
      {!["RESOLVED", "CLOSED"].includes(d.ticket.status) && <ReplyForm ticketId={id} />}
    </div>
  );
}
