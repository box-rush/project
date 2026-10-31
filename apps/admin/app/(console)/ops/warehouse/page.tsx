import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { isSrOrAbove } from "@boxrush/core/params";
import { listIncidents, pickList, warehouseOverview } from "@boxrush/services";
import { ActionForm } from "@/components/ActionForm";
import { Empty, Jst, LotCode, PageHeader, fix } from "@/components/ui";
import { ctx, requirePageRole } from "@/lib/session";
import { deliveredAction, putAwayAction, reportIncidentAction, shipAction, startPickingAction } from "../actions";
import { PackStation } from "./PackStation";

const TABS = ["in", "req", "pack", "out"] as const;

export default async function Warehouse({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string }> }) {
  const staff = await requirePageRole("WAREHOUSE");
  const t = await getTranslations("warehouse");
  const sp = await searchParams;
  const tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as (typeof TABS)[number]) : "in";
  const q = (sp.q ?? "").replace(/^#/, "").trim();
  const code = /^\d+$/.test(q) ? Number(q) : undefined;
  const [o, pl, incidents] = await Promise.all([warehouseOverview(ctx(), staff, { code }), pickList(ctx(), { code }), listIncidents(ctx(), staff)]);
  const picks = pl.parcels;
  const hasIncident = new Set(incidents.map((i) => i.incident.shipmentId));
  const requested = picks.filter((p) => p.shipment.status === "REQUESTED");
  const picking = picks.filter((p) => p.shipment.status === "PICKING");
  const packed = picks.filter((p) => p.shipment.status === "PACKED");
  return (
    <>
      <PageHeader title={t("title")} code="O13">
        <span className="badge badge-primary mono">{t("kChip", { k: fix(o.k, 1), n: o.kShipments })}</span>
        <Link href="/ops/incidents" className="btn !min-h-8 text-xs">
          {t("tabs.inc")}
        </Link>
      </PageHeader>
      <nav className="mb-4 flex gap-1">
        {TABS.map((k) => (
          <Link key={k} href={`?tab=${k}`} className={`btn !min-h-8 text-xs ${tab === k ? "btn-primary" : ""}`}>
            {t(`tabs.${k}`)}
            <span className="mono">{k === "in" ? o.toPutAway.length : k === "req" ? pl.counts.REQUESTED : k === "pack" ? pl.counts.PICKING + pl.counts.PACKED : o.shipped.length}</span>
          </Link>
        ))}
              <form className="ml-auto flex items-center gap-1" role="search">
          <input type="hidden" name="tab" value={tab} />
          <input name="q" defaultValue={q} className="input mono !min-h-8 !w-36 text-xs" inputMode="numeric" aria-label={t("searchCode")} placeholder={t("searchCode")} />
          <button type="submit" className="btn !min-h-8 text-xs">
            {t("search")}
          </button>
        </form>
      </nav>

      {tab === "in" && (
        <div className="grid grid-cols-2 gap-5">
          <section className="card p-0">
            <h2 className="h2 px-4 pt-3">{t("putAwayTitle")}</h2>
            {o.toPutAway.length === 0 ? (
              <Empty>{t("empty")}</Empty>
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>{t("code")}</th>
                    <th>{t("lottery")}</th>
                    <th className="text-right">{t("items")}</th>
                    <th className="text-right">{t("guaranteeAwarded")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {o.toPutAway.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <LotCode code={l.code} />
                      </td>
                      <td>{l.title}</td>
                      <td className="mono text-right">{l.items}</td>
                      <td className="mono text-right">{l.guaranteeAwarded}</td>
                      <td>
                        <ActionForm action={putAwayAction.bind(null, l.id)} submitLabel={t("putAway")} submitClass="btn btn-primary !min-h-7 text-xs" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="px-4 pb-3 text-xs text-ink2">{t("binHelp")}</p>
          </section>
          <section className="card p-0">
            <h2 className="h2 px-4 pt-3">{t("reservedTitle")}</h2>
            {o.reservedGuarantees.length === 0 ? (
              <Empty>{t("empty")}</Empty>
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>{t("code")}</th>
                    <th>{t("lottery")}</th>
                    <th className="text-right">{t("reserved")}</th>
                  </tr>
                </thead>
                <tbody>
                  {o.reservedGuarantees.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <LotCode code={r.code} />
                      </td>
                      <td>{r.title}</td>
                      <td className="mono text-right">{r.reserved}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="px-4 pb-3 text-xs text-ink2">{t("reservedHelp")}</p>
          </section>
        </div>
      )}

      {tab === "req" && (
        <section className="card p-0">
          {requested.length === 0 ? (
            <Empty>{t("empty")}</Empty>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>{t("shipment")}</th>
                  <th>{t("requestedAt")}</th>
                  <th className="text-right">{t("items")}</th>
                  <th className="text-right">{t("slots")}</th>
                  <th>{t("bins")}</th>
                  <th>{t("type")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {requested.map(({ shipment: s, items }) => (
                  <tr key={s.id}>
                    <td className="mono">#{s.code}</td>
                    <td>
                      <Jst d={s.requestedAt} />
                    </td>
                    <td className="mono text-right">{s.itemCount}</td>
                    <td className="mono text-right">{s.slotCount}</td>
                    <td className="mono text-xs">{[...new Set(items.map((i) => i.locationCode ?? "—"))].join(" ")}</td>
                    <td>
                      {s.insured ? <span className="badge badge-gold">{t("insured")}</span> : <span className="badge">{t("standard")}</span>}
                      {s.forced ? <span className="badge ml-1">{t("forced")}</span> : null}
                    </td>
                    <td>
                      <ActionForm action={startPickingAction.bind(null, s.id)} submitLabel={t("startPicking")} submitClass="btn btn-primary !min-h-7 text-xs" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {tab === "pack" && (
        <div className="flex flex-col gap-5">
          {picking.length === 0 && packed.length === 0 ? <Empty>{t("empty")}</Empty> : null}
          <div className="grid grid-cols-2 gap-4">
            {picking.map(({ shipment: s, items }) => (
              <PackStation
                key={s.id}
                shipmentId={s.id}
                code={s.code}
                insured={s.insured}
                items={items.map((i) => ({ id: i.id, name: i.name, rarity: i.rarity, sr: isSrOrAbove(i.rarity), location: i.locationCode }))}
              />
            ))}
          </div>
          {packed.length ? (
            <section className="card p-0">
              <h2 className="h2 px-4 pt-3">{t("packedTitle")}</h2>
              <table className="tbl">
                <tbody>
                  {packed.map(({ shipment: s }) => (
                    <tr key={s.id}>
                      <td className="mono">#{s.code}</td>
                      <td className="mono text-right">{s.itemCount}</td>
                      <td>{s.insured ? <span className="badge badge-gold">{t("insured")}</span> : <span className="badge">{t("standard")}</span>}</td>
                      <td>
                        <ActionForm action={shipAction.bind(null, s.id)} submitLabel={t("ship")} submitClass="btn btn-primary !min-h-7 text-xs" inline>
                          <input name="trackingNumber" className="input mono !w-48 text-xs" aria-label={t("tracking")} placeholder={t("tracking")} required />
                          <input name="carrier" className="input !w-36 text-xs" aria-label={t("carrier")} placeholder={t("carrier")} />
                        </ActionForm>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}
        </div>
      )}

      {tab === "out" && (
        <section className="card p-0">
          {o.shipped.length === 0 ? (
            <Empty>{t("empty")}</Empty>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>{t("shipment")}</th>
                  <th>{t("shippedAt")}</th>
                  <th>{t("carrier")}</th>
                  <th>{t("tracking")}</th>
                  <th>{t("state")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {o.shipped.map((s) => (
                  <tr key={s.id}>
                    <td className="mono">#{s.code}</td>
                    <td>
                      <Jst d={s.shippedAt} />
                    </td>
                    <td>{s.carrier}</td>
                    <td className="mono">{s.trackingNumber}</td>
                    <td>{s.status === "DELIVERED" ? <span className="badge badge-trust">{t("delivered")}</span> : <span className="badge badge-primary">{t("inTransit")}</span>}</td>
                    <td>
                      {s.status === "SHIPPED" ? <ActionForm action={deliveredAction.bind(null, s.id)} submitLabel={t("markDelivered")} submitClass="btn !min-h-7 text-xs" /> : null}
                      {!hasIncident.has(s.id) ? (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-xs text-error">{t("reportIncident")}</summary>
                          <ActionForm action={reportIncidentAction.bind(null, s.id)} submitLabel={t("reportIncidentSubmit")} submitClass="btn btn-danger !min-h-7 text-xs" confirmText={t("reportIncidentConfirm")} className="mt-2">
                            <div className="flex gap-3 text-xs">
                              {s.status === "SHIPPED" ? (
                                <label className="flex items-center gap-1">
                                  <input type="radio" name="kind" value="LOST" defaultChecked /> {t("incident.LOST")}
                                </label>
                              ) : null}
                              <label className="flex items-center gap-1">
                                <input type="radio" name="kind" value="DAMAGED" defaultChecked={s.status === "DELIVERED"} /> {t("incident.DAMAGED")}
                              </label>
                            </div>
                            <input name="note" className="input text-xs" aria-label={t("incidentNote")} placeholder={t("incidentNote")} required />
                          </ActionForm>
                        </details>
                      ) : (
                        <span className="badge badge-error">{t("incidentReported")}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="px-4 pb-3 text-xs text-ink2">{t("deliveredHelp")}</p>
        </section>
      )}

    </>
  );
}
