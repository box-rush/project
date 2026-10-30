import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { auditPage, staffList } from "@boxrush/services";
import { ActionForm } from "@/components/ActionForm";
import { Hash, JstFull, PageHeader } from "@/components/ui";
import { ctx, requirePageRole } from "@/lib/session";
import { verifyChainAction } from "../actions";

/** O17 / T7: append-only audit log with hash chain; read-only here. */
export default async function Audit({ searchParams }: { searchParams: Promise<{ entity?: string; entityId?: string; before?: string }> }) {
  const staff = await requirePageRole("ADMIN");
  const t = await getTranslations("audit");
  const tr = await getTranslations("roles");
  const sp = await searchParams;
  const before = sp.before && /^\d+$/.test(sp.before) ? Number(sp.before) : undefined;
  const [page, people] = await Promise.all([auditPage(ctx(), staff, { entity: sp.entity || undefined, entityId: sp.entityId || undefined, before }), staffList(ctx(), staff)]);
  const names = new Map(people.map((p) => [p.id, p.name]));
  const qs = (b: number) => `?${new URLSearchParams({ ...(sp.entity ? { entity: sp.entity } : {}), ...(sp.entityId ? { entityId: sp.entityId } : {}), before: String(b) })}`;
  return (
    <>
      <PageHeader title={t("title")} code="O17">
        <ActionForm action={verifyChainAction} submitLabel={t("verify")} submitClass="btn btn-trust" inline />
      </PageHeader>
      <form method="get" className="mb-3 flex gap-2">
        <select name="entity" defaultValue={sp.entity ?? ""} className="input !w-56">
          <option value="">{t("allEntities")}</option>
          {page.entities.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
        <input name="entityId" defaultValue={sp.entityId ?? ""} className="input mono !w-80" placeholder={t("entityId")} />
        <button className="btn">{t("filter")}</button>
      </form>
      <div className="card overflow-x-auto p-0">
        <table className="tbl">
          <thead>
            <tr>
              <th>{t("seq")}</th>
              <th>{t("at")}</th>
              <th>{t("actor")}</th>
              <th>{t("action")}</th>
              <th>{t("entity")}</th>
              <th>{t("data")}</th>
              <th>{t("hash")}</th>
            </tr>
          </thead>
          <tbody>
            {page.rows.map((r) => (
              <tr key={r.seq}>
                <td className="mono">{r.seq}</td>
                <td className="text-xs">
                  <JstFull d={r.at} />
                </td>
                <td className="text-xs">
                  <span className="badge">{r.actorType}</span> {r.actorType === "STAFF" && r.actorId ? (names.get(r.actorId) ?? r.actorId.slice(0, 8)) : (r.actorId?.slice(0, 16) ?? "")}
                </td>
                <td className="mono text-xs">{r.action}</td>
                <td className="mono text-xs">
                  {r.entity}
                  <div className="text-ink2">{r.entityId?.slice(0, 12)}</div>
                </td>
                <td className="mono max-w-[320px] truncate text-[11px]" title={JSON.stringify(r.data)}>
                  {JSON.stringify(r.data)}
                </td>
                <td className="text-[11px]">
                  <Hash h={r.hash} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex gap-2">
        {before ? (
          <Link className="btn" href={`?${new URLSearchParams({ ...(sp.entity ? { entity: sp.entity } : {}), ...(sp.entityId ? { entityId: sp.entityId } : {}) })}`}>
            {t("latest")}
          </Link>
        ) : null}
        {page.hasMore && page.rows.length ? (
          <Link className="btn" href={qs(page.rows[page.rows.length - 1]!.seq)}>
            {t("older")}
          </Link>
        ) : null}
      </div>

      <section className="card mt-6 overflow-x-auto p-0">
        <h2 className="h2 px-4 pt-3">{t("staff")}</h2>
        <table className="tbl">
          <thead>
            <tr>
              <th>{t("name")}</th>
              <th>{t("email")}</th>
              <th>{t("roles")}</th>
              <th>{t("mfa")}</th>
              <th>{t("state")}</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td className="mono text-xs">{p.email}</td>
                <td>
                  {p.roles.map((r) => (
                    <span key={r} className="badge mr-1 text-[11px]">
                      {tr(r)}
                    </span>
                  ))}
                </td>
                <td>{p.totpEnrolledAt ? <span className="badge badge-trust">{t("enrolled")}</span> : <span className="badge badge-warning">{t("notEnrolled")}</span>}</td>
                <td>{p.disabledAt ? <span className="badge">{t("disabled")}</span> : <span className="badge badge-trust">{t("active")}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
