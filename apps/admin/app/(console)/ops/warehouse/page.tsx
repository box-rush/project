import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { isSrOrAbove } from "@boxrush/core/params";
import { pickList, warehouseOverview } from "@boxrush/services";
import { ActionForm } from "@/components/ActionForm";
import { Empty, Jst, LotCode, PageHeader, fix } from "@/components/ui";
import { ctx, requirePageRole } from "@/lib/session";
import { deliveredAction, putAwayAction, shipAction, startPickingAction } from "../actions";
import { PackStation } from "./PackStation";

const TABS = ["in", "req", "pack", "out"] as const;

export default async function Warehouse({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const staff = await requirePageRole("WAREHOUSE");
  const t = await getTranslations("warehouse");
  const sp = await searchParams;
  const tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as (typeof TABS)[number]) : "in";
  const [o, picks] = await Promise.all([warehouseOverview(ctx(), staff), pickList(ctx())]);
  const requested = picks.filter((p) => p.shipment.status === "REQUESTED");
  const picking = picks.filter((p) => p.shipment.status === "PICKING");
  const packed = picks.filter((p) => p.shipment.status === "PACKED");
  return (
    <>
      <PageHeader title={t("title")} code="O13">
        <span className="badge badge-primary mono">{t("kChip", { k: fix(o.k, 1), n: o.kShipments })}</span>
      </PageHeader>
      <nav className="mb-4 flex gap-1">
        {TABS.map((k) => (
          <Link key={k} href={`?tab=${k}`} className={`btn !min-h-8 text-xs ${tab === k ? "btn-primary" : ""}`}>
            {t(`tabs.${k}`)}
            <span className="mono">{k === "in" ? o.toPutAway.length : k === "req" ? requested.length : k === "pack" ? picking.length + packed.length : o.shipped.length}</span>
          </Link>
        ))}
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
                          <input name="trackingNumber" className="input mono !w-48 text-xs" placeholder={t("tracking")} required />
                          <input name="carrier" className="input !w-36 text-xs" placeholder={t("carrier")} />
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
