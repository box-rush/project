import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ticketQueue } from "@boxrush/services";
import { Empty, PageHeader } from "@/components/ui";
import { ctx, requirePageRole } from "@/lib/session";
import { TicketTable } from "./TicketTable";

export default async function Tickets() {
  const staff = await requirePageRole("CS");
  const t = await getTranslations("tickets");
  const rows = (await ticketQueue(ctx(), staff)).filter((r) => r.kind !== "APPEAL");
  return (
    <>
      <PageHeader title={t("title")} code="O14">
        <Link href="/ops/tickets/faqs" className="btn !min-h-8 text-xs">
          {t("faqs")}
        </Link>
      </PageHeader>
      <div className="card p-0">{rows.length === 0 ? <Empty>{t("empty")}</Empty> : <TicketTable rows={rows} base="/ops/tickets" />}</div>
    </>
  );
}
