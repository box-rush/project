import { z } from "zod";

export const CATEGORIES = ["POKEMON", "ONEPIECE", "YUGIOH"] as const;
export const SEALED_UNITS = ["PACK", "BOX", "CASE"] as const;
export const PARTITION_TYPES = ["ENUMERATED", "POSITIONAL", "ATTRIBUTE", "WHOLE", "DRAFT"] as const;
export const SELECTION_MODES = ["PICK", "RANDOM"] as const;
export const PARTITION_BASES = ["CARD_NUMBER", "CHARACTER", "PACK_POSITION", "NUMBER_RANGE", "RARITY"] as const;

export const ChecklistEntry = z.object({
  number: z.string().min(1),
  name: z.string().min(1),
  rarity: z.string().min(1),
  character: z.string().optional(),
});
export type ChecklistEntry = z.infer<typeof ChecklistEntry>;

export const SubjectItem = z.object({
  productId: z.string().min(1),
  maker: z.string().min(1),
  series: z.string().min(1),
  sealedUnit: z.enum(SEALED_UNITS),
  quantity: z.number().int().positive(),
  /** I7: only manufacturer-sealed goods; true = repack / re-sealed / mixed by a third party */
  repack: z.boolean().default(false),
  retailPrice: z.number().int().nonnegative(),
});

export const GuaranteeCardSpec = z.object({
  name: z.string().min(1),
  photoUrl: z.string().min(1),
  referencePrice: z.number().int().nonnegative(),
  /** inventory unit ids already received and inspected in the warehouse (F15.10) */
  inventoryUnitIds: z.array(z.string()),
});

/** Merchant-submitted lottery configuration (F15.1). Everything here is frozen into the snapshot at listing. */
export const LotteryConfig = z.object({
  title: z.string().min(1).max(120),
  category: z.enum(CATEGORIES),
  subject: z.array(SubjectItem).min(1),
  partitionType: z.enum(PARTITION_TYPES),
  partitionBasis: z.enum(PARTITION_BASES),
  selectionMode: z.enum(SELECTION_MODES),
  totalSlots: z.number().int().min(1).max(500),
  slotPrice: z.number().int().positive(),
  perUserLimit: z.number().int().min(1),
  /** I2: always 1.0 (100%). Kept as a field so a submission trying anything else is rejected, not silently fixed. */
  fillThreshold: z.number(),
  /** I2: slots the merchant / platform keep for itself. Must be 0. */
  merchantReservedSlots: z.number().int().min(0),
  saleStartsAt: z.coerce.date(),
  saleEndsAt: z.coerce.date(),
  openingAt: z.coerce.date(),
  checklist: z.array(ChecklistEntry),
  checklistSource: z.enum(["TEMPLATE", "MERCHANT"]),
  checklistTemplateId: z.string().optional(),
  fallbackRule: z.string(),
  guaranteeCard: GuaranteeCardSpec.nullable(),
  entropy: z.enum(["PARTICIPANTS", "PUBLIC_BEACON"]),
  /** sealed inventory units (inspected, in stock) backing the subject — intake precedes sale (§8.4.1) */
  subjectUnitIds: z.array(z.string()).default([]),
});
export type LotteryConfig = z.infer<typeof LotteryConfig>;
