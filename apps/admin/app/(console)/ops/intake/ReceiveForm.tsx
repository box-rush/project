"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { ActionForm } from "@/components/ActionForm";
import { receiveUnitAction } from "../actions";

export function ReceiveForm({ merchants, products, bookings }: { merchants: { id: string; name: string }[]; products: { id: string; label: string }[]; bookings: { id: string; label: string }[] }) {
  const t = useTranslations("inspection");
  const [kind, setKind] = useState<"SEALED" | "GUARANTEE_CARD">("SEALED");
  const [result, setResult] = useState<"pass" | "reject">("pass");
  return (
    <ActionForm action={receiveUnitAction} submitLabel={t("submit")}>
      <div className="flex gap-2">
        {(["SEALED", "GUARANTEE_CARD"] as const).map((k) => (
          <label key={k} className={`btn flex-1 ${kind === k ? "btn-primary" : ""}`}>
            <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="sr-only" />
            {t(`kinds.${k}`)}
          </label>
        ))}
      </div>
      <label>
        <span className="label">{t("merchant")}</span>
        <select name="merchantId" className="input">
          {merchants.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      {kind === "SEALED" ? (
        <label>
          <span className="label">{t("product")}</span>
          <select name="productId" className="input">
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <label className="col-span-2">
            <span className="label">{t("cardName")}</span>
            <input name="cardName" className="input" required />
          </label>
          <label>
            <span className="label">{t("cardRarity")}</span>
            <input name="cardRarity" className="input mono" />
          </label>
          <label>
            <span className="label">{t("referencePrice")}</span>
            <input name="referencePrice" type="number" min={0} className="input mono" />
          </label>
        </div>
      )}
      <label>
        <span className="label">{t("booking")}</span>
        <select name="intakeBookingId" className="input" defaultValue="">
          <option value="">{t("noBooking")}</option>
          {bookings.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label>
          <span className="label">{t("label")}</span>
          <input name="label" className="input mono" required placeholder="BX-000123" />
        </label>
        <label>
          <span className="label">{t("lot")}</span>
          <input name="lot" className="input mono" />
        </label>
      </div>
      <label>
        <span className="label">{t("photos")}</span>
        <textarea name="photoUrls" className="input mono text-xs" rows={2} required placeholder="https://… https://…" />
        <span className="text-xs text-ink2">{t("photosHelp")}</span>
      </label>
      <div className="flex gap-2">
        {(["pass", "reject"] as const).map((r) => (
          <label key={r} className={`btn flex-1 ${result === r ? (r === "pass" ? "btn-trust" : "btn-danger") : ""}`}>
            <input type="radio" name="result" value={r} checked={result === r} onChange={() => setResult(r)} className="sr-only" />
            {t(`results.${r}`)}
          </label>
        ))}
      </div>
      {result === "reject" ? (
        <label>
          <span className="label">{t("rejectReason")}</span>
          <input name="rejectReason" className="input" required />
        </label>
      ) : null}
    </ActionForm>
  );
}
