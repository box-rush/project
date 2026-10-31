import { z } from "zod";
import { asc, eq, faqs } from "@boxrush/db";
import { audit } from "./audit";
import type { Ctx } from "./context";
import { fail } from "./errors";
import { requireRole, staffActor, type StaffPrincipal } from "./principals";

/** F23.4: FAQ / how-to content maintained by CS (F12.1 shows only published entries). Every change is audited. */
export const FAQ_SECTIONS = ["GUIDE", "FAIRNESS", "PAYMENT", "SHIPPING", "ACCOUNT"] as const;

const faqInput = z.object({
  section: z.enum(FAQ_SECTIONS),
  locale: z.enum(["ja", "zh-Hans", "en"]).default("ja"),
  question: z.string().trim().min(1).max(200),
  answer: z.string().trim().min(1).max(4000),
  sort: z.coerce.number().int().min(0).max(999).default(0),
  published: z.boolean().default(true),
});
export type FaqInput = z.input<typeof faqInput>;

export async function listFaqsForStaff(ctx: Ctx, p: StaffPrincipal) {
  requireRole(p, "CS");
  return ctx.db.select().from(faqs).orderBy(asc(faqs.locale), asc(faqs.section), asc(faqs.sort));
}

export async function saveFaq(ctx: Ctx, p: StaffPrincipal, input: FaqInput, id?: string) {
  requireRole(p, "CS");
  const parsed = faqInput.safeParse(input);
  if (!parsed.success) fail("INVALID_FAQ", { field: parsed.error.issues[0]?.path.join(".") });
  const v = parsed.data;
  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    let rowId = id;
    if (id) {
      const [row] = await tx.update(faqs).set({ ...v, updatedBy: p.id, updatedAt: now }).where(eq(faqs.id, id)).returning();
      if (!row) fail("NOT_FOUND");
    } else {
      const [row] = await tx.insert(faqs).values({ ...v, updatedBy: p.id, updatedAt: now }).returning();
      rowId = row!.id;
    }
    await audit(tx, staffActor(p), id ? "faq.update" : "faq.create", "faq", rowId!, { section: v.section, question: v.question, published: v.published }, now);
    return { id: rowId! };
  });
}
