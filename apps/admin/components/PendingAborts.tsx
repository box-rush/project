import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { pendingRecordingAborts, type StaffPrincipal } from "@boxrush/services";
import { ctx } from "@/lib/session";
import { JstFull, LotCode } from "./ui";

/** X7: both-paths-down reports nobody has confirmed yet. The reporter cannot confirm; anyone else on STATION / REVIEWER can. */
export async function PendingAborts({ staff }: { staff: StaffPrincipal }) {
  const rows = await pendingRecordingAborts(ctx(), staff);
  if (!rows.length) return null;
  const t = await getTranslations("station");
  return (
    <div role="alert" className="card mb-4 space-y-2 border-error bg-error-soft text-sm" data-testid="pending-aborts">
      <div className="font-semibold text-error">⚠ {t("pendingAbortsTitle", { n: rows.length })}</div>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.lotteryId} className="flex flex-wrap items-center gap-2">
            <LotCode code={r.code} />
            <span>{r.title}</span>
            <span className="text-xs text-ink2">{r.requestedAt ? <JstFull d={r.requestedAt} /> : null}</span>
            {r.requestedBy === staff.id ? (
              <span className="text-xs text-ink2">{t("pendingAbortsMine")}</span>
            ) : (
              <Link href={`/station/${r.lotteryId}`} className="btn btn-danger !min-h-7 text-xs">
                {t("pendingAbortsOpen")}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
