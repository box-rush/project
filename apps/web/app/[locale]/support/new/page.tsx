import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireUser } from "@/lib/guard";
import { PageTitle } from "@/components/ui";
import { TicketForm } from "./TicketForm";

export const dynamic = "force-dynamic";

export default async function NewTicket({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ kind?: string; lottery?: string; slot?: string; t?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireUser("/support/new");
  const t = await getTranslations("support");
  const sp = await searchParams;
  const appeal = sp.kind === "APPEAL" && !!sp.lottery;
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageTitle>{appeal ? t("appeal") : t("new")}</PageTitle>
      <TicketForm appeal={appeal} lotteryId={sp.lottery} slot={sp.slot ? Number(sp.slot) : undefined} ts={sp.t ? Number(sp.t) : undefined} />
    </div>
  );
}
