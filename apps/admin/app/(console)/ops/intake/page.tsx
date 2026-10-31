import { getTranslations } from "next-intl/server";
import { documentsForBookings, listIntakeBookings, listMerchants, listProducts } from "@boxrush/services";
import { Jst, PageHeader } from "@/components/ui";
import { ctx, requirePageRole } from "@/lib/session";
import { ReceiveForm } from "./ReceiveForm";

/** O05 / F19.3: every unit is photographed and seal-inspected; a failed seal can never back a lottery (I7, X3). */
export default async function Intake() {
  const staff = await requirePageRole("WAREHOUSE");
  const t = await getTranslations("inspection");
  const ti = await getTranslations("intake");
  const [bookings, merchants, products] = await Promise.all([listIntakeBookings(ctx(), staff), listMerchants(ctx(), staff), listProducts(ctx())]);
  const docs = await documentsForBookings(ctx(), bookings.map((b) => b.booking.id));
  return (
    <>
      <PageHeader title={t("title")} code="O05" />
      <div className="grid grid-cols-[1fr_400px] gap-5">
        <div className="card overflow-x-auto p-0">
          <h2 className="h2 px-4 pt-3">{t("bookings")}</h2>
          <table className="tbl">
            <thead>
              <tr>
                <th>{ti("expectedAt")}</th>
                <th>{t("merchant")}</th>
                <th>{ti("product")}</th>
                <th className="text-right">{ti("quantity")}</th>
                <th>{ti("status")}</th>
                <th>{ti("documents")}</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map(({ booking: b, merchantName, series }) => (
                <tr key={b.id}>
                  <td>
                    <Jst d={b.expectedAt} />
                  </td>
                  <td>{merchantName}</td>
                  <td>{series}</td>
                  <td className="mono text-right">{b.expectedQuantity}</td>
                  <td>
                    <span className="badge">{ti(`statuses.${b.status}`)}</span>
                  </td>
                  <td className="text-xs">
                    {docs
                      .filter((d) => d.intakeBookingId === b.id)
                      .map((d) => (
                        <a key={d.id} href={`/api/documents/${d.id}`} className="block text-primary underline">
                          {d.fileName}
                        </a>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2 className="h2 mb-3">{t("receive")}</h2>
          <ReceiveForm
            merchants={merchants.map((m) => ({ id: m.id, name: m.name }))}
            products={products.map((p) => ({ id: p.id, label: `${p.series} · ${p.sealedUnit}` }))}
            bookings={bookings.filter((b) => b.booking.status === "BOOKED").map((b) => ({ id: b.booking.id, label: `${b.merchantName} · ${b.series} × ${b.booking.expectedQuantity}` }))}
          />
        </div>
      </div>
    </>
  );
}
