"use server";
import { bookIntake, saveDraft, submitForReview, validateDraft, withdrawToDraft, fail, requireRole } from "@boxrush/services";
import { act, num, str } from "@/lib/action";
import { parseJstLocal } from "@/lib/jst";
import { ctx } from "@/lib/session";
import type { ActionResult } from "@/lib/result";
import type { Issue } from "@boxrush/core";

const paths = ["/merchant/lotteries"];

/** F15.2 live validation (SV1). Read-only: nothing is stored. */
export async function validateWizardAction(raw: unknown, lotteryId?: string) {
  return act(async (s) => {
    requireRole(s, "MERCHANT");
    if (!s.merchantId) fail("FORBIDDEN");
    const { issues } = await validateDraft(ctx(), s.merchantId, raw, lotteryId);
    return issues as Issue[];
  });
}

export async function saveDraftAction(raw: unknown, lotteryId?: string) {
  return act(async (s) => saveDraft(ctx(), s, raw, lotteryId), { revalidate: paths, message: "draftSaved" });
}

/** Save the current form, then submit. A config with any error never reaches review (SV1). */
export async function submitAction(raw: unknown, lotteryId?: string) {
  return act(
    async (s) => {
      const saved = await saveDraft(ctx(), s, raw, lotteryId);
      if (!saved.id) fail("INVARIANT_VIOLATION", { issues: saved.issues });
      await submitForReview(ctx(), s, saved.id);
      return { id: saved.id };
    },
    { revalidate: paths, message: "submitted" },
  );
}

export async function withdrawAction(lotteryId: string) {
  return act(async (s) => withdrawToDraft(ctx(), s, lotteryId), { revalidate: paths, message: "withdrawn" });
}

export async function bookIntakeAction(_: ActionResult<unknown> | null, fd: FormData) {
  return act(
    async (s) => {
      const expectedAt = parseJstLocal(str(fd, "expectedAt"));
      if (!expectedAt) fail("INVALID_DATE");
      await bookIntake(ctx(), s, { productId: str(fd, "productId"), expectedQuantity: num(fd, "expectedQuantity"), expectedAt, voucherUrl: str(fd, "voucherUrl") || undefined });
    },
    { revalidate: ["/merchant/intake"], message: "booked" },
  );
}

