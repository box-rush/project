import { getTranslations } from "next-intl/server";
import { ticketQueue } from "@boxrush/services";
import { Empty, PageHeader } from "@/components/ui";
import { ctx, requirePageRole } from "@/lib/session";
import { TicketTable } from "../tickets/TicketTable";

export default async function Arbitration() {
  const staff = await requirePageRole("CS");
  const t = await getTranslations("arbitration");
  const rows = (await ticketQueue(ctx(), staff)).filter((r) => r.kind === "APPEAL");
  return (
    <>
      <PageHeader title={t("title")} code="O15" />
      <p className="mb-3 text-xs text-ink2">{t("help")}</p>
      <div className="card p-0">{rows.length === 0 ? <Empty>{t("empty")}</Empty> : <TicketTable rows={rows} base="/ops/arbitration" />}</div>
    </>
  );
}
