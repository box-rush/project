import Link from "next/link";
import { useTranslations } from "next-intl";
import { Jst } from "@/components/ui";

type Row = { id: string; code: number; kind: string; subject: string; status: string; updatedAt: Date; lotteryId: string | null; slotNumber: number | null };

const TONE: Record<string, string> = { OPEN: "badge-primary", IN_PROGRESS: "badge-warning", ARBITRATION: "badge-warning", RESOLVED: "badge-trust", CLOSED: "" };

export function TicketTable({ rows, base }: { rows: Row[]; base: string }) {
  const t = useTranslations("tickets");
  return (
    <table className="tbl">
      <thead>
        <tr>
          <th>{t("code")}</th>
          <th>{t("kind")}</th>
          <th>{t("subject")}</th>
          <th>{t("status")}</th>
          <th>{t("updatedAt")}</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td className="mono">T{String(r.code).padStart(5, "0")}</td>
            <td>{t(`kinds.${r.kind}`)}</td>
            <td className="font-semibold">{r.subject}</td>
            <td>
              <span className={`badge ${TONE[r.status] ?? ""}`}>{t(`statuses.${r.status}`)}</span>
            </td>
            <td>
              <Jst d={r.updatedAt} />
            </td>
            <td>
              <Link className="btn !min-h-7 text-xs" href={`${base}/${r.id}`}>
                {t("open")}
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
