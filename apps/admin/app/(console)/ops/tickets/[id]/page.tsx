import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ticketDetail } from "@boxrush/services";
import { ActionForm } from "@/components/ActionForm";
import { JstFull, PageHeader } from "@/components/ui";
import { ctx, requirePageRole } from "@/lib/session";
import { replyTicketAction } from "../../actions";

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const staff = await requirePageRole("CS");
  const t = await getTranslations("tickets");
  const { ticket, messages } = await ticketDetail(ctx(), id, { staff });
  return (
    <>
      <PageHeader title={ticket.subject} code="O14">
        <span className="badge">{t(`statuses.${ticket.status}`)}</span>
        {ticket.kind === "APPEAL" ? (
          <Link href={`/ops/arbitration/${ticket.id}`} className="btn !min-h-8 text-xs">
            {t("toArbitration")}
          </Link>
        ) : null}
      </PageHeader>
      <div className="grid grid-cols-[1fr_360px] gap-5">
        <ol className="flex flex-col gap-2">
          {messages.map((m) => (
            <li key={m.id} className={`card ${m.authorType === "STAFF" ? "ml-12 border-primary" : "mr-12"}`}>
              <div className="mb-1 flex gap-2 text-xs text-ink2">
                <span className="badge">{t(`author.${m.authorType}`)}</span>
                <JstFull d={m.createdAt} />
              </div>
              <p className="whitespace-pre-wrap text-sm">{m.body}</p>
            </li>
          ))}
        </ol>
        <div className="card h-fit">
          <h2 className="h2 mb-2">{t("reply")}</h2>
          <ActionForm action={replyTicketAction.bind(null, id)} submitLabel={t("send")}>
            <textarea name="body" className="input" rows={6} required aria-label={t("reply")} />
          </ActionForm>
        </div>
      </div>
    </>
  );
}
