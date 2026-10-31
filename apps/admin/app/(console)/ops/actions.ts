"use server";
import {
  registerDevice,
  revokeDevice,
  advanceShipment,
  approveLottery,
  confirmAttribution,
  correctOrAddCard,
  createBanner,
  createProduct,
  createVoucherCode,
  decideArbitration,
  deleteBanner,
  disableVoucherCode,
  fail,
  finalizeAttribution,
  findUserIdByEmail,
  grantCoupon,
  linkAccount,
  markDeliveredByStaff,
  postDelay,
  proposeAttribution,
  putAway,
  receiveUnit,
  recordProcurement,
  rejectLottery,
  replyTicket,
  runReconcileNow,
  setSetting,
  saveChecklistDraft,
  updateBanner,
  verifyAuditChainForStaff,
  verifyChecklist,
  voidCoupon,
} from "@boxrush/services";
import { act, bool, num, str } from "@/lib/action";
import { parseJstLocal } from "@/lib/jst";
import { ctx } from "@/lib/session";
import type { ActionResult } from "@/lib/result";

type Prev = ActionResult<unknown> | null;

const date = (fd: FormData, k: string) => parseJstLocal(str(fd, k)) ?? fail("INVALID_DATE", { field: k });

// ───── O07 review ─────
/** F20.1 / F20.3: the reviewer picks the pricing-experiment arm and the featured flag at approval. */
export async function approveAction(lotteryId: string, _: Prev, fd: FormData) {
  return act((s) => approveLottery(ctx(), s, lotteryId, { experimentArm: str(fd, "arm") || undefined, featured: bool(fd, "featured") }), {
    revalidate: ["/ops/review", "/ops/schedule"],
    message: "approved",
  });
}
export async function rejectAction(lotteryId: string, _: Prev, fd: FormData) {
  return act(
    async (s) => {
      const reason = str(fd, "reason");
      if (reason.length < 2) fail("REASON_REQUIRED");
      await rejectLottery(ctx(), s, lotteryId, reason);
    },
    { revalidate: ["/ops/review"], message: "rejected" },
  );
}

// ───── O08 schedule ─────
export async function postDelayAction(lotteryId: string, _: Prev, fd: FormData) {
  return act(
    async (s) => {
      const reason = str(fd, "reason");
      if (reason.length < 2) fail("REASON_REQUIRED");
      await postDelay(ctx(), s, lotteryId, reason, date(fd, "newOpeningAt"));
    },
    { revalidate: ["/ops/schedule"], message: "delayPosted" },
  );
}

// ───── O02 / O03 master data ─────
export async function createProductAction(_: Prev, fd: FormData) {
  return act(
    (s) =>
      createProduct(ctx(), s, {
        category: str(fd, "category"),
        maker: str(fd, "maker"),
        series: str(fd, "series"),
        setCode: str(fd, "setCode"),
        sealedUnit: str(fd, "sealedUnit"),
        packsPerUnit: num(fd, "packsPerUnit") || 1,
        jan: str(fd, "jan") || null,
        retailPrice: num(fd, "retailPrice"),
        cardNumberHint: str(fd, "cardNumberHint") || null,
      }),
    { revalidate: ["/ops/products"], message: "created" },
  );
}

/** Accepts a JSON array or CSV lines "number,name,rarity[,character]" (input format only; rules live in the service). */
function parseEntries(text: string) {
  const t = text.trim();
  if (!t) fail("ENTRIES_EMPTY");
  if (t.startsWith("[")) {
    let arr: unknown;
    try {
      arr = JSON.parse(t);
    } catch {
      fail("ENTRIES_PARSE");
    }
    if (!Array.isArray(arr)) fail("ENTRIES_PARSE");
    return arr.map((e) => {
      const o = e as Record<string, unknown>;
      if (!o.number || !o.name || !o.rarity) fail("ENTRIES_PARSE");
      return { number: String(o.number), name: String(o.name), rarity: String(o.rarity), ...(o.character ? { character: String(o.character) } : {}) };
    });
  }
  return t
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^number\s*,/i.test(l))
    .map((l) => {
      const [number, name, rarity, character] = l.split(",").map((x) => x.trim());
      if (!number || !name || !rarity) fail("ENTRIES_PARSE");
      return { number, name, rarity, ...(character ? { character } : {}) };
    });
}

export async function saveChecklistDraftAction(_: Prev, fd: FormData) {
  return act((s) => saveChecklistDraft(ctx(), s, str(fd, "productId"), parseEntries(str(fd, "entries"))), { revalidate: ["/ops/checklists"], message: "draftSaved" });
}
export async function verifyChecklistAction(templateId: string, _: Prev) {
  return act((s) => verifyChecklist(ctx(), s, templateId), { revalidate: ["/ops/checklists"], message: "verified" });
}

// ───── O04 procurement, O05 intake inspection ─────
export async function recordProcurementAction(_: Prev, fd: FormData) {
  return act(
    (s) =>
      recordProcurement(ctx(), s, {
        productId: str(fd, "productId"),
        supplierName: str(fd, "supplierName"),
        supplierAddress: str(fd, "supplierAddress") || null,
        supplierIdentity: str(fd, "supplierIdentity") || null,
        acquiredAt: date(fd, "acquiredAt"),
        unitCost: num(fd, "unitCost"),
        quantity: num(fd, "quantity"),
        voucherUrl: str(fd, "voucherUrl") || null,
        isUsedGoods: bool(fd, "isUsedGoods"),
      }),
    { revalidate: ["/ops/procurement"], message: "recorded" },
  );
}

export async function receiveUnitAction(_: Prev, fd: FormData) {
  return act(
    async (s) => {
      const kind = str(fd, "kind") === "GUARANTEE_CARD" ? "GUARANTEE_CARD" : "SEALED";
      const passed = str(fd, "result") === "pass";
      await receiveUnit(ctx(), s, {
        kind,
        merchantId: str(fd, "merchantId"),
        productId: kind === "SEALED" ? str(fd, "productId") || undefined : undefined,
        label: str(fd, "label"),
        sealPhotoUrls: str(fd, "photoUrls").split(/\s+/).filter(Boolean),
        passed,
        rejectReason: passed ? undefined : str(fd, "rejectReason") || undefined,
        cardName: kind === "GUARANTEE_CARD" ? str(fd, "cardName") || undefined : undefined,
        cardRarity: kind === "GUARANTEE_CARD" ? str(fd, "cardRarity") || undefined : undefined,
        referencePrice: kind === "GUARANTEE_CARD" && str(fd, "referencePrice") ? num(fd, "referencePrice") : undefined,
        intakeBookingId: str(fd, "intakeBookingId") || undefined,
        lot: str(fd, "lot") || undefined,
      });
    },
    { revalidate: ["/ops/intake", "/ops/inventory"], message: "received" },
  );
}

// ───── O10 banners ─────
const bannerInput = (fd: FormData) => ({
  title: str(fd, "title"),
  href: str(fd, "href"),
  imageUrl: str(fd, "imageUrl") || null,
  sort: num(fd, "sort") || 0,
  activeFrom: date(fd, "activeFrom"),
  activeUntil: date(fd, "activeUntil"),
});
export async function createBannerAction(_: Prev, fd: FormData) {
  return act((s) => createBanner(ctx(), s, bannerInput(fd)), { revalidate: ["/ops/banners"], message: "created" });
}
export async function updateBannerAction(id: string, _: Prev, fd: FormData) {
  return act((s) => updateBanner(ctx(), s, id, bannerInput(fd)), { revalidate: ["/ops/banners"], message: "saved" });
}
export async function deleteBannerAction(id: string, _: Prev) {
  return act((s) => deleteBanner(ctx(), s, id), { revalidate: ["/ops/banners"], message: "deleted" });
}

// ───── O21 coupons & codes (CP1–CP7) ─────
export async function createVoucherAction(_: Prev, fd: FormData) {
  return act(
    (s) => createVoucherCode(ctx(), s, { code: str(fd, "code"), reason: str(fd, "reason"), maxRedemptions: num(fd, "maxRedemptions"), validUntil: date(fd, "validUntil") }),
    { revalidate: ["/ops/coupons"], message: "created" },
  );
}
export async function disableVoucherAction(code: string, _: Prev) {
  return act((s) => disableVoucherCode(ctx(), s, code), { revalidate: ["/ops/coupons"], message: "disabled" });
}
export async function grantCouponAction(_: Prev, fd: FormData) {
  return act(
    async (s) => {
      const userId = await findUserIdByEmail(ctx(), s, str(fd, "email"));
      await grantCoupon(ctx(), s, userId, str(fd, "reason"));
    },
    { revalidate: ["/ops/coupons"], message: "granted" },
  );
}
export async function voidCouponAction(id: string, _: Prev, fd: FormData) {
  return act((s) => voidCoupon(ctx(), s, id, str(fd, "reason") || "-"), { revalidate: ["/ops/coupons"], message: "voided" });
}

// ───── O12 attribution ─────
export async function proposeAction(lotteryId: string, cardId: string, _: Prev, fd: FormData) {
  return act((s) => proposeAttribution(ctx(), s, cardId, num(fd, "slot"), str(fd, "note")), { revalidate: [`/ops/attribution/${lotteryId}`], message: "proposed" });
}
export async function confirmAction(lotteryId: string, cardId: string, _: Prev) {
  return act((s) => confirmAttribution(ctx(), s, cardId), { revalidate: [`/ops/attribution/${lotteryId}`], message: "confirmed" });
}
export async function correctAction(lotteryId: string, _: Prev, fd: FormData) {
  return act(
    (s) =>
      correctOrAddCard(ctx(), s, lotteryId, {
        raw: str(fd, "raw"),
        videoTsSec: num(fd, "videoTsSec"),
        replacesCardId: str(fd, "replacesCardId") || undefined,
        note: str(fd, "note"),
      }).then(() => undefined),
    { revalidate: [`/ops/attribution/${lotteryId}`], message: "recorded" },
  );
}
export async function finalizeAction(lotteryId: string, _: Prev) {
  return act((s) => finalizeAttribution(ctx(), s, lotteryId), { revalidate: [`/ops/attribution/${lotteryId}`, "/ops/attribution"], message: "finalized" });
}

// ───── O13 warehouse ─────
export async function putAwayAction(lotteryId: string, _: Prev) {
  return act((s) => putAway(ctx(), s, lotteryId), { revalidate: ["/ops/warehouse"], message: "putAway" });
}
export async function startPickingAction(shipmentId: string, _: Prev) {
  return act((s) => advanceShipment(ctx(), s, shipmentId, "PICKING"), { revalidate: ["/ops/warehouse"], message: "saved" });
}
export async function packAction(shipmentId: string, scannedItemIds: string[]) {
  return act((s) => advanceShipment(ctx(), s, shipmentId, "PACKED", { scannedItemIds }), { revalidate: ["/ops/warehouse"], message: "packed" });
}
export async function shipAction(shipmentId: string, _: Prev, fd: FormData) {
  return act((s) => advanceShipment(ctx(), s, shipmentId, "SHIPPED", { trackingNumber: str(fd, "trackingNumber"), carrier: str(fd, "carrier") || undefined }), {
    revalidate: ["/ops/warehouse"],
    message: "shipped",
  });
}
export async function deliveredAction(shipmentId: string, _: Prev) {
  return act((s) => markDeliveredByStaff(ctx(), s, shipmentId), { revalidate: ["/ops/warehouse"], message: "delivered" });
}

// ───── O14 / O15 support & arbitration ─────
export async function replyTicketAction(ticketId: string, _: Prev, fd: FormData) {
  return act(
    async (s) => {
      const body = str(fd, "body");
      if (body.length < 2) fail("TICKET_TOO_SHORT");
      await replyTicket(ctx(), ticketId, { staff: s }, body);
    },
    { revalidate: [`/ops/tickets/${ticketId}`, "/ops/tickets"], message: "replied" },
  );
}
export async function decideArbitrationAction(ticketId: string, _: Prev, fd: FormData) {
  return act(
    async (s) => {
      const outcome = str(fd, "outcome") === "COMPENSATED" ? "COMPENSATED" : "UPHELD";
      const resolution = str(fd, "resolution");
      if (resolution.length < 5) fail("RESOLUTION_REQUIRED");
      await decideArbitration(ctx(), s, ticketId, { outcome, resolution });
    },
    { revalidate: [`/ops/arbitration/${ticketId}`, "/ops/arbitration"], message: "decided" },
  );
}

// ───── O16 risk ─────
export async function linkAccountAction(_: Prev, fd: FormData) {
  return act(
    async (s) => {
      const userId = await findUserIdByEmail(ctx(), s, str(fd, "email"));
      const reason = str(fd, "reason") || "MANUAL";
      await linkAccount(ctx(), s, userId, str(fd, "merchantId") || null, reason, { note: str(fd, "note") });
    },
    { revalidate: ["/ops/risk"], message: "linked" },
  );
}

// ───── O17 / O20 system ─────
export async function verifyChainAction(_: Prev): Promise<ActionResult<unknown>> {
  const r = await act((s) => verifyAuditChainForStaff(ctx(), s));
  if (!r.ok) return r;
  const v = r.data!;
  return v.ok
    ? { ok: true, message: "chainOk", params: { count: v.count } }
    : { ok: false, code: "CHAIN_BROKEN", params: { seq: v.brokenAt ?? 0, count: v.count } };
}
export async function reconcileAction(_: Prev): Promise<ActionResult<unknown>> {
  const r = await act((s) => runReconcileNow(ctx(), s), { revalidate: ["/ops/monitoring"] });
  if (!r.ok) return r;
  return { ok: true, message: "reconciled", params: { fixes: r.data!.fixes.length, failed: r.data!.failedJobs } };
}

// ───── O20 platform settings (ADMIN) ─────
export async function recordingLossPolicyAction(_: Prev, fd: FormData) {
  return act((s) => setSetting(ctx(), s, "recordingLossUnconfirmed", str(fd, "value")), { revalidate: ["/ops/monitoring"], message: "saved" });
}

export async function registerDeviceAction(_: Prev, fd: FormData) {
  return act((s) => registerDevice(ctx(), s, { stationId: str(fd, "stationId"), label: str(fd, "label") }), { revalidate: ["/ops/monitoring"], message: "deviceRegistered" });
}

export async function revokeDeviceAction(deviceId: string, _: Prev) {
  return act((s) => revokeDevice(ctx(), s, deviceId), { revalidate: ["/ops/monitoring"], message: "saved" });
}
