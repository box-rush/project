/**
 * Box Rush data model (§6.2, §10.3). Conventions:
 * - timestamps are UTC (timestamptz); display is JST
 * - amounts are integer yen, tax included
 * - there is NO balance / points / wallet column anywhere (I3, UR1). `tools/lint-ur.mjs` enforces it.
 */
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgSchema,
  pgTable,
  primaryKey,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const createdAt = () => ts("created_at").notNull().defaultNow();

// ───────────────────────── enums (§10.3) ─────────────────────────
export const lotteryStatus = pgEnum("lottery_status", [
  "DRAFT",
  "PENDING_REVIEW",
  "REJECTED",
  "ON_SALE",
  "FAILED",
  "LOCKED",
  "READY",
  "OPENING",
  "ATTRIBUTING",
  "ATTRIBUTED",
  "FULFILLING",
  "COMPLETED",
  "ABORTED",
  "REFUNDED",
]);
export const slotState = pgEnum("slot_state", ["AVAILABLE", "HELD", "SOLD"]);
export const orderStatus = pgEnum("order_status", ["PENDING", "PAID", "EXPIRED", "REFUND_PENDING", "REFUNDED", "LATE_PAYMENT_REFUNDED"]);
export const collectionState = pgEnum("collection_state", ["STORED", "SHIPPING", "RECEIVED", "LOST"]);
export const attributionMethod = pgEnum("attribution_method", ["AUTO", "MANUAL", "FALLBACK"]);
export const staffRole = pgEnum("staff_role", ["ADMIN", "MERCHANT", "REVIEWER", "STATION", "ATTRIBUTION", "WAREHOUSE", "CS", "FINANCE", "ANALYST"]);
export const shipmentStatus = pgEnum("shipment_status", [
  "AWAITING_PAYMENT",
  "REQUESTED",
  "PICKING",
  "PACKED",
  "SHIPPED",
  "DELIVERED",
  "RETURNED",
  "CANCELLED",
  "LOST", // X12: carrier lost the parcel
]);
export const inventoryKind = pgEnum("inventory_kind", ["SEALED", "GUARANTEE_CARD"]);
export const inventoryStatus = pgEnum("inventory_status", ["RECEIVED", "IN_STOCK", "REJECTED", "ALLOCATED", "OPENED", "AWARDED", "RETURNED"]);

// ───────────────────────── users & auth (T10, Better Auth) ─────────────────────────
export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    /** F1.1: one phone number ↔ one account. Unique constraint is the enforcement point. */
    phoneNumber: text("phone_number").unique(),
    phoneNumberVerified: boolean("phone_number_verified").notNull().default(false),
    locale: text("locale").notNull().default("ja"),
    onboardedAt: ts("onboarded_at"),
    /** X13 / payment failure: purchase suspended until resolved */
    purchaseSuspendedReason: text("purchase_suspended_reason"),
    /** F26.6 first-party acquisition source; first touch is immutable once set */
    firstTouch: jsonb("first_touch").$type<Record<string, string>>(),
    lastTouch: jsonb("last_touch").$type<Record<string, string>>(),
    lineUserId: text("line_user_id"),
    /** PSP customer reference (Stripe customer id). Card data itself never touches our DB (F1.4). */
    pspCustomerRef: text("psp_customer_ref"),
    notifyMarketing: boolean("notify_marketing").notNull().default(false),
    notifyLine: boolean("notify_line").notNull().default(true),
    deletedAt: ts("deleted_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
);

export const authSessions = pgTable("auth_sessions", {
  id: text("id").primaryKey(),
  expiresAt: ts("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
}, (t) => [index("auth_sessions_user_idx").on(t.userId)]);

export const authAccounts = pgTable("auth_accounts", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: ts("access_token_expires_at"),
  refreshTokenExpiresAt: ts("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [index("auth_accounts_user_idx").on(t.userId), index("auth_accounts_provider_idx").on(t.providerId, t.accountId)]);

export const authVerifications = pgTable("auth_verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [index("auth_verifications_identifier_idx").on(t.identifier)]);

/** T10: when a number moves to a new account, the old binding is retained 90 days for manual review. */
export const retiredPhoneNumbers = pgTable("retired_phone_numbers", {
  id: id(),
  phoneNumber: text("phone_number").notNull(),
  userId: text("user_id").notNull(),
  retiredAt: ts("retired_at").notNull().defaultNow(),
  holdUntil: ts("hold_until").notNull(),
});

export const addresses = pgTable("addresses", {
  id: id(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull(),
  postalCode: text("postal_code").notNull(),
  prefecture: text("prefecture").notNull(),
  city: text("city").notNull(),
  line1: text("line1").notNull(),
  line2: text("line2"),
  phone: text("phone").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  deletedAt: ts("deleted_at"),
  createdAt: createdAt(),
});

/** F1.4: card data stays at the PSP; we only keep the PSP reference and display hints. */
export const paymentMethods = pgTable("payment_methods", {
  id: id(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  provider: text("provider").notNull(),
  providerRef: text("provider_ref").notNull(),
  brand: text("brand").notNull(),
  last4: text("last4").notNull(),
  expMonth: integer("exp_month").notNull(),
  expYear: integer("exp_year").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  deletedAt: ts("deleted_at"),
  createdAt: createdAt(),
});

/** M2 consumer protection (F2.1). Rows created lazily; absence = defaults (PD11). */
export const spendingLimits = pgTable("spending_limits", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id),
  monthlyLimit: integer("monthly_limit").notNull(),
  perOrderLimit: integer("per_order_limit").notNull(),
  pendingMonthlyLimit: integer("pending_monthly_limit"),
  pendingPerOrderLimit: integer("pending_per_order_limit"),
  pendingEffectiveAt: ts("pending_effective_at"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

// ───────────────────────── staff (separate login, mandatory MFA; T10) ─────────────────────────
export const merchants = pgTable("merchants", {
  id: id(),
  name: text("name").notNull(),
  selfOperated: boolean("self_operated").notNull().default(false),
  /** 特商法 disclosure shown on lottery pages */
  legalName: text("legal_name").notNull(),
  address: text("address").notNull(),
  phone: text("phone").notNull(),
  kobutsuLicense: text("kobutsu_license"),
  createdAt: createdAt(),
});

export const staff = pgTable("staff", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  totpSecret: text("totp_secret").notNull(),
  totpEnrolledAt: ts("totp_enrolled_at"),
  roles: staffRole("roles").array().notNull(),
  merchantId: text("merchant_id").references(() => merchants.id),
  /** personal phone, used to detect linked consumer accounts (I8, F24.1) */
  phoneNumber: text("phone_number"),
  /** TOTP attempts counted per person (not per session); locked for 15 min after 5 failures */
  mfaFailures: integer("mfa_failures").notNull().default(0),
  mfaLockedUntil: ts("mfa_locked_until"),
  disabledAt: ts("disabled_at"),
  createdAt: createdAt(),
});

export const staffSessions = pgTable("staff_sessions", {
  token: text("token").primaryKey(),
  staffId: text("staff_id")
    .notNull()
    .references(() => staff.id),
  mfaVerified: boolean("mfa_verified").notNull().default(false),
  /** wrong TOTP codes on this session; the session is destroyed at 5 */
  mfaFailures: integer("mfa_failures").notNull().default(0),
  expiresAt: ts("expires_at").notNull(),
  createdAt: createdAt(),
});

/** Password-step throttle (per address + client), kept out of the audit log so failures cannot flood it. */
export const staffLoginFailures = pgTable(
  "staff_login_failures",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    key: text("key").notNull(),
    at: ts("at").notNull().defaultNow(),
  },
  (t) => [index("staff_login_failures_key_at").on(t.key, t.at)],
);

/**
 * F24.1: consumer accounts linked to a merchant (or to platform staff, merchantId = null → all lotteries).
 * Purchase interception (I8) reads this table inside the hold transaction.
 */
export const accountLinks = pgTable(
  "account_links",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    merchantId: text("merchant_id").references(() => merchants.id),
    reason: text("reason").notNull(), // STAFF_PHONE | DEVICE | PAYMENT | ADDRESS | MANUAL
    evidence: jsonb("evidence"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [index("account_links_user_idx").on(t.userId)],
);

// ───────────────────────── master data (M18) ─────────────────────────
export const products = pgTable("products", {
  id: id(),
  category: text("category").notNull(), // POKEMON | ONEPIECE | YUGIOH
  maker: text("maker").notNull(),
  series: text("series").notNull(),
  setCode: text("set_code").notNull(),
  sealedUnit: text("sealed_unit").notNull(),
  packsPerUnit: integer("packs_per_unit").notNull().default(1),
  jan: text("jan"),
  retailPrice: integer("retail_price").notNull(),
  /** T4 keypad: fixed prefix/suffix shown at the station, e.g. "/159" or "OP09-" */
  cardNumberHint: text("card_number_hint"),
  imageUrl: text("image_url"),
  createdAt: createdAt(),
});

/** F18.2 / F18.3: checklist templates, AI-drafted + human-verified, versioned. */
export const checklistTemplates = pgTable("checklist_templates", {
  id: id(),
  productId: text("product_id")
    .notNull()
    .references(() => products.id),
  version: integer("version").notNull(),
  entries: jsonb("entries").notNull().$type<{ number: string; name: string; rarity: string; character?: string }[]>(),
  status: text("status").notNull().default("DRAFT"), // DRAFT | VERIFIED
  draftedBy: text("drafted_by"),
  verifiedBy: text("verified_by"),
  verifiedAt: ts("verified_at"),
  createdAt: createdAt(),
});

// ───────────────────────── sourcing & inventory (M19) ─────────────────────────
/** F19.1 purchase + F19.2 古物台帳 fields (⚠️ exact record items to be confirmed by counsel) */
export const procurements = pgTable("procurements", {
  id: id(),
  productId: text("product_id")
    .notNull()
    .references(() => products.id),
  supplierName: text("supplier_name").notNull(),
  supplierAddress: text("supplier_address"),
  supplierIdentity: text("supplier_identity"),
  acquiredAt: ts("acquired_at").notNull(),
  unitCost: integer("unit_cost").notNull(),
  quantity: integer("quantity").notNull(),
  voucherUrl: text("voucher_url"),
  isUsedGoods: boolean("is_used_goods").notNull().default(false),
  recordedBy: text("recorded_by").notNull(),
  createdAt: createdAt(),
});

/** F16.1 intake booking (merchant) → F19.3 inspection (warehouse). */
export const intakeBookings = pgTable("intake_bookings", {
  id: id(),
  merchantId: text("merchant_id")
    .notNull()
    .references(() => merchants.id),
  productId: text("product_id")
    .notNull()
    .references(() => products.id),
  expectedQuantity: integer("expected_quantity").notNull(),
  expectedAt: ts("expected_at").notNull(),
  voucherUrl: text("voucher_url"),
  status: text("status").notNull().default("BOOKED"), // BOOKED | INSPECTING | PASSED | FAILED
  failReason: text("fail_reason"),
  createdAt: createdAt(),
});

export const inventoryUnits = pgTable(
  "inventory_units",
  {
    id: id(),
    /** T8 barcode label, printed at intake */
    label: text("label").notNull().unique(),
    kind: inventoryKind("kind").notNull(),
    productId: text("product_id").references(() => products.id),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    /** guarantee cards: what it is */
    cardName: text("card_name"),
    cardRarity: text("card_rarity"),
    referencePrice: integer("reference_price"),
    procurementId: text("procurement_id").references(() => procurements.id),
    intakeBookingId: text("intake_booking_id").references(() => intakeBookings.id),
    lot: text("lot"),
    status: inventoryStatus("status").notNull().default("RECEIVED"),
    sealPhotoUrls: jsonb("seal_photo_urls").$type<string[]>().notNull().default([]),
    inspectedBy: text("inspected_by"),
    inspectedAt: ts("inspected_at"),
    rejectReason: text("reject_reason"),
    lotteryId: text("lottery_id"),
    locationCode: text("location_code"),
    createdAt: createdAt(),
  },
  (t) => [index("inventory_lottery_idx").on(t.lotteryId)],
);

// ───────────────────────── lotteries (§6.2.1) ─────────────────────────
export const lotteries = pgTable(
  "lotteries",
  {
    id: id(),
    /** human code shown in UI, e.g. L0012 */
    code: serial("code").notNull().unique(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    status: lotteryStatus("status").notNull().default("DRAFT"),
    /** full submitted config (LotteryConfig); editable only in DRAFT */
    config: jsonb("config").notNull(),
    title: text("title").notNull(),
    category: text("category").notNull(),
    totalSlots: integer("total_slots").notNull(),
    slotPrice: integer("slot_price").notNull(),
    perUserLimit: integer("per_user_limit").notNull(),
    saleStartsAt: ts("sale_starts_at").notNull(),
    saleEndsAt: ts("sale_ends_at").notNull(),
    openingAt: ts("opening_at").notNull(),
    /** F20.3 pricing experiment arm label, e.g. "+20%" */
    experimentArm: text("experiment_arm"),
    /** F20.4 / F3.5 entry-level placement */
    featured: boolean("featured").notNull().default(false),
    /** §6.6.3 ③ frozen at approval; immutable afterwards (trigger) */
    snapshot: jsonb("snapshot"),
    snapshotHash: text("snapshot_hash"),
    /** I6: commitment exists before ON_SALE (CHECK constraint) */
    seedCommit: text("seed_commit"),
    seedCommittedAt: ts("seed_committed_at"),
    algorithmVersion: text("algorithm_version"),
    entropy: text("entropy"),
    participantsText: text("participants_text"),
    participantsHash: text("participants_hash"),
    beacon: text("beacon"),
    finalHash: text("final_hash"),
    /** revealed only after the draw (§6.6.1 ⑤) */
    serverSeed: text("server_seed"),
    drawnAt: ts("drawn_at"),
    soldOutAt: ts("sold_out_at"),
    openingStartedAt: ts("opening_started_at"),
    openingEndedAt: ts("opening_ended_at"),
    attributedAt: ts("attributed_at"),
    /** X6: public notice of delay */
    delayNotice: text("delay_notice"),
    abortReason: text("abort_reason"),
    rejectReason: text("reject_reason"),
    submittedBy: text("submitted_by"),
    reviewedBy: text("reviewed_by"),
    version: integer("version").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("lotteries_status_idx").on(t.status), index("lotteries_merchant_idx").on(t.merchantId, t.createdAt), index("lotteries_opening_idx").on(t.openingAt)],
);

/** §6.2.2 Slot + Holding. One row per slot; holding fields are filled when sold. */
export const slots = pgTable(
  "slots",
  {
    id: id(),
    lotteryId: text("lottery_id")
      .notNull()
      .references(() => lotteries.id),
    number: integer("number").notNull(),
    state: slotState("state").notNull().default("AVAILABLE"),
    heldBy: text("held_by"),
    heldUntil: ts("held_until"),
    orderId: text("order_id"),
    ownerUserId: text("owner_user_id").references(() => users.id),
    paidAt: ts("paid_at"),
    /** RANDOM participant list order = payment confirmation order (§10.4.1) */
    purchaseSeq: integer("purchase_seq"),
    publicId: text("public_id"),
    assignedNumbers: jsonb("assigned_numbers").$type<string[]>(),
    guaranteeAwarded: boolean("guarantee_awarded").notNull().default(false),
    /** X10: fulfilment frozen during arbitration */
    frozen: boolean("frozen").notNull().default(false),
  },
  (t) => [uniqueIndex("slots_lottery_number_uq").on(t.lotteryId, t.number), index("slots_owner_idx").on(t.ownerUserId), index("slots_order_idx").on(t.orderId)],
);

export const orders = pgTable(
  "orders",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    lotteryId: text("lottery_id")
      .notNull()
      .references(() => lotteries.id),
    slotCount: integer("slot_count").notNull(),
    unitPrice: integer("unit_price").notNull(),
    amount: integer("amount").notNull(),
    status: orderStatus("status").notNull().default("PENDING"),
    heldUntil: ts("held_until").notNull(),
    paymentProvider: text("payment_provider").notNull(),
    paymentRef: text("payment_ref"),
    paidAt: ts("paid_at"),
    refundedAt: ts("refunded_at"),
    refundReason: text("refund_reason"),
    nightConfirmed: boolean("night_confirmed").notNull().default(false),
    /** F26.5 arm the user saw at purchase */
    experimentArms: jsonb("experiment_arms"),
    createdAt: createdAt(),
  },
  (t) => [index("orders_user_idx").on(t.userId), index("orders_lottery_idx").on(t.lotteryId), index("orders_payment_ref_idx").on(t.paymentRef), index("orders_pending_hold_idx").on(t.heldUntil).where(sql`status = 'PENDING'`)],
);

/** Idempotency for PSP webhooks (T12: "幂等键"). */
export const paymentEvents = pgTable("payment_events", {
  eventId: text("event_id").primaryKey(),
  provider: text("provider").notNull(),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull(),
  processedAt: ts("processed_at").notNull().defaultNow(),
});

/** F5.3 / F25.2: refunds only to the original payment path. */
export const refunds = pgTable("refunds", {
  id: id(),
  orderId: text("order_id").references(() => orders.id),
  shipmentId: text("shipment_id"),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  amount: integer("amount").notNull(),
  reason: text("reason").notNull(), // FAILED | ABORTED | LATE_PAYMENT | OVERDUE_OPTOUT | ARBITRATION | SHIPMENT
  status: text("status").notNull().default("PENDING"), // PENDING | SUCCEEDED | FAILED
  providerRef: text("provider_ref"),
  lastError: text("last_error"),
  createdAt: createdAt(),
  completedAt: ts("completed_at"),
}, (t) => [index("refunds_order_idx").on(t.orderId), index("refunds_pending_idx").on(t.createdAt).where(sql`status = 'PENDING'`)]);

// ───────────────────────── opening & recording (M21, SV4) ─────────────────────────
export const openingSessions = pgTable("opening_sessions", {
  id: id(),
  lotteryId: text("lottery_id")
    .notNull()
    .references(() => lotteries.id)
    .unique(),
  stationId: text("station_id").notNull(),
  operatorId: text("operator_id").notNull(),
  startedAt: ts("started_at").notNull(),
  sealCloseupAt: ts("seal_closeup_at"),
  endedAt: ts("ended_at"),
  /** CLOUD_OK | CLOUD_DOWN (local only, continue) | BOTH_DOWN_PENDING (station frozen, abort awaits a 2nd person) */
  recordingState: text("recording_state").notNull().default("CLOUD_OK"),
  abortRequestedBy: text("abort_requested_by"),
  abortRequestedAt: ts("abort_requested_at"),
  playbackUrl: text("playback_url"),
  laborSeconds: integer("labor_seconds"),
});

/** SV4: segment checksums are public; only the platform station pipeline writes here (no upload API). */
export const videoSegments = pgTable(
  "video_segments",
  {
    id: id(),
    lotteryId: text("lottery_id")
      .notNull()
      .references(() => lotteries.id),
    source: text("source").notNull(), // CLOUD | LOCAL
    seq: integer("seq").notNull(),
    startedAt: ts("started_at").notNull(),
    endedAt: ts("ended_at").notNull(),
    sha256: text("sha256").notNull(),
    uri: text("uri").notNull(),
    backfilled: boolean("backfilled").notNull().default(false),
  },
  (t) => [uniqueIndex("video_segments_uq").on(t.lotteryId, t.source, t.seq)],
);

export const openingMarkers = pgTable("opening_markers", {
  id: id(),
  lotteryId: text("lottery_id")
    .notNull()
    .references(() => lotteries.id),
  kind: text("kind").notNull(), // SEAL_CLOSEUP | PACK_OPEN | NOTE
  label: text("label").notNull(),
  videoTsSec: integer("video_ts_sec").notNull(),
  createdAt: createdAt(),
});

/** §6.6.2 attribution detail: every card → slot, method, who, video timestamp. */
export const openedCards = pgTable(
  "opened_cards",
  {
    id: id(),
    lotteryId: text("lottery_id")
      .notNull()
      .references(() => lotteries.id),
    seq: integer("seq").notNull(),
    cardNumber: text("card_number").notNull(),
    name: text("name").notNull(),
    rarity: text("rarity").notNull(),
    slotNumber: integer("slot_number"),
    method: attributionMethod("method"),
    /** CONFIRMED | NEEDS_REVIEW (off-list, correction) | VOID (input error, replaced) */
    status: text("status").notNull(),
    offList: boolean("off_list").notNull().default(false),
    videoTsSec: integer("video_ts_sec").notNull(),
    photoUrl: text("photo_url"),
    enteredBy: text("entered_by").notNull(),
    proposedBy: text("proposed_by"),
    confirmedBy: text("confirmed_by"),
    note: text("note"),
    /** X9 / PD6: manufacturer defect seen on the recording; the card is attributed as-is, the note is shown to the owner */
    defectNote: text("defect_note"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("opened_cards_seq_uq").on(t.lotteryId, t.seq)],
);

/** Immutable record (SV6). Written once at ATTRIBUTED; append-only via trigger. */
export const openingRecords = pgTable("opening_records", {
  lotteryId: text("lottery_id")
    .primaryKey()
    .references(() => lotteries.id),
  record: jsonb("record").notNull(),
  recordHash: text("record_hash").notNull(),
  createdAt: createdAt(),
});

// ───────────────────────── collection & fulfilment (M9, M22) ─────────────────────────
export const collectionItems = pgTable(
  "collection_items",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    lotteryId: text("lottery_id")
      .notNull()
      .references(() => lotteries.id),
    slotNumber: integer("slot_number").notNull(),
    openedCardId: text("opened_card_id").references(() => openedCards.id),
    guaranteeUnitId: text("guarantee_unit_id").references(() => inventoryUnits.id),
    cardNumber: text("card_number"),
    name: text("name").notNull(),
    rarity: text("rarity").notNull(),
    photoUrl: text("photo_url"),
    videoTsSec: integer("video_ts_sec"),
    state: collectionState("state").notNull().default("STORED"),
    storedSince: ts("stored_since").notNull(),
    freeStorageUntil: ts("free_storage_until").notNull(),
    /** F22.1 per-user warehouse location */
    locationCode: text("location_code"),
    shipmentId: text("shipment_id"),
    frozen: boolean("frozen").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("collection_user_idx").on(t.userId, t.state), index("collection_shipment_idx").on(t.shipmentId), index("collection_lottery_slot_idx").on(t.lotteryId, t.slotNumber), index("collection_storage_due_idx").on(t.freeStorageUntil).where(sql`state = 'STORED' AND shipment_id IS NULL`)],
);

export const shipments = pgTable("shipments", {
  id: id(),
  code: serial("code").notNull().unique(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  addressSnapshot: jsonb("address_snapshot").notNull(),
  itemCount: integer("item_count").notNull(),
  /** number of distinct slots consolidated — the k numerator (§8.10) */
  slotCount: integer("slot_count").notNull(),
  insured: boolean("insured").notNull(),
  fee: integer("fee").notNull(),
  payable: integer("payable").notNull(),
  couponId: text("coupon_id"),
  forced: boolean("forced").notNull().default(false),
  status: shipmentStatus("status").notNull(),
  paymentRef: text("payment_ref"),
  /** X13: platform advanced the fee after failed charges */
  platformAdvanced: boolean("platform_advanced").notNull().default(false),
  chargeAttempts: integer("charge_attempts").notNull().default(0),
  carrier: text("carrier"),
  trackingNumber: text("tracking_number"),
  requestedAt: ts("requested_at").notNull().defaultNow(),
  shippedAt: ts("shipped_at"),
  deliveredAt: ts("delivered_at"),
}, (t) => [index("shipments_status_idx").on(t.status, t.requestedAt), index("shipments_user_idx").on(t.userId, t.requestedAt)]);

/** CP1–CP7. Coupons are free grants only; no purchase, transfer or cash value. */
export const voucherCodes = pgTable("voucher_codes", {
  code: text("code").primaryKey(),
  reason: text("reason").notNull(), // COMPENSATION | ACQUISITION | FIRST_SHIPMENT | CAMPAIGN
  maxRedemptions: integer("max_redemptions").notNull(),
  redemptions: integer("redemptions").notNull().default(0),
  validUntil: ts("valid_until").notNull(),
  disabledAt: ts("disabled_at"),
  createdBy: text("created_by").notNull(),
  createdAt: createdAt(),
});

export const coupons = pgTable(
  "coupons",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind").notNull().default("FREE_SHIPPING"),
    reason: text("reason").notNull(),
    voucherCode: text("voucher_code").references(() => voucherCodes.code),
    issuedAt: ts("issued_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    usedShipmentId: text("used_shipment_id"),
    voidedAt: ts("voided_at"),
    issuedBy: text("issued_by"),
  },
  // CP6: one redemption per account per code
  (t) => [uniqueIndex("coupons_user_code_uq").on(t.userId, t.voucherCode), index("coupons_issued_idx").on(t.issuedAt), index("coupons_expiry_idx").on(t.expiresAt).where(sql`used_at IS NULL AND voided_at IS NULL`)],
);

// ───────────────────────── notifications (M11) ─────────────────────────
export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind").notNull(),
    /** fulfilment notices cannot be disabled (F1.5) */
    fulfilment: boolean("fulfilment").notNull(),
    params: jsonb("params").notNull().default({}),
    readAt: ts("read_at"),
    emailSentAt: ts("email_sent_at"),
    lineSentAt: ts("line_sent_at"),
    /** delivery retries: a failing address or provider outage backs off instead of blocking the outbox */
    sendAttempts: smallint("send_attempts").notNull().default(0),
    nextSendAt: ts("next_send_at"),
    lastSendError: text("last_send_error"),
    dedupeKey: text("dedupe_key").unique(),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.createdAt), index("notifications_unsent_idx").on(t.createdAt).where(sql`email_sent_at IS NULL`)],
);

// ───────────────────────── support & arbitration (M12, M23) ─────────────────────────
export const tickets = pgTable("tickets", {
  id: id(),
  code: serial("code").notNull().unique(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  kind: text("kind").notNull(), // INQUIRY | APPEAL
  subject: text("subject").notNull(),
  lotteryId: text("lottery_id").references(() => lotteries.id),
  orderId: text("order_id"),
  openedCardId: text("opened_card_id"),
  slotNumber: integer("slot_number"),
  videoTsSec: integer("video_ts_sec"),
  status: text("status").notNull().default("OPEN"), // OPEN | IN_PROGRESS | ARBITRATION | RESOLVED | CLOSED
  resolution: text("resolution"),
  assigneeId: text("assignee_id"),
  createdAt: createdAt(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [index("tickets_user_idx").on(t.userId, t.createdAt)]);

export const ticketMessages = pgTable("ticket_messages", {
  id: id(),
  ticketId: text("ticket_id")
    .notNull()
    .references(() => tickets.id),
  authorType: text("author_type").notNull(), // USER | STAFF
  authorId: text("author_id").notNull(),
  body: text("body").notNull(),
  createdAt: createdAt(),
});

// ───────────────────────── ops content (M20, M23) ─────────────────────────
export const banners = pgTable("banners", {
  id: id(),
  title: text("title").notNull(),
  imageUrl: text("image_url"),
  href: text("href").notNull(),
  sort: integer("sort").notNull().default(0),
  activeFrom: ts("active_from").notNull(),
  activeUntil: ts("active_until").notNull(),
  createdAt: createdAt(),
});

export const faqs = pgTable("faqs", {
  id: id(),
  section: text("section").notNull(), // GUIDE | FAIRNESS | PAYMENT | SHIPPING | ACCOUNT
  locale: text("locale").notNull().default("ja"),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  sort: integer("sort").notNull().default(0),
  published: boolean("published").notNull().default(true),
  updatedBy: text("updated_by"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** F26.5 A/B (minimal): deterministic hash-based assignment, config here. */
export const experiments = pgTable("experiments", {
  key: text("key").primaryKey(),
  arms: jsonb("arms").notNull().$type<string[]>(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

// ───────────────────────── platform services ─────────────────────────
/** T7 append-only audit log with hash chain (UPDATE / DELETE rejected by trigger, chain computed in trigger). */
export const auditLog = pgTable(
  "audit_log",
  {
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    at: ts("at").notNull().defaultNow(),
    actorType: text("actor_type").notNull(), // USER | STAFF | SYSTEM | RNG
    actorId: text("actor_id"),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    data: jsonb("data").notNull().default({}),
    prevHash: text("prev_hash").notNull().default(""),
    hash: text("hash").notNull().default(""),
  },
  (t) => [index("audit_entity_idx").on(t.entity, t.entityId), index("audit_action_at_idx").on(t.action, t.at)],
);

/** T7: each hourly batch of the audit log exported to immutable storage (S3 Object Lock in production). */
export const auditArchives = pgTable("audit_archives", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  seqFrom: integer("seq_from").notNull(),
  seqTo: integer("seq_to").notNull().unique(),
  headHash: text("head_hash").notNull(),
  objectKey: text("object_key").notNull(),
  sha256: text("sha256").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** Platform settings chosen by an ADMIN (audited). */
export const platformSettings = pgTable("platform_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: text("updated_by").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** F16.3 purchase proofs (invoices, receipts) a merchant uploads for an intake booking; the file lives in the document store. */
export const documents = pgTable("documents", {
  id: id(),
  intakeBookingId: text("intake_booking_id")
    .notNull()
    .references(() => intakeBookings.id),
  merchantId: text("merchant_id").notNull(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  sha256: text("sha256").notNull(),
  storageKey: text("storage_key").notNull().unique(),
  uploadedBy: text("uploaded_by").notNull(),
  uploadedAt: ts("uploaded_at").notNull().defaultNow(),
});

/** X12: a lost or damaged parcel and the carrier claim (cap ¥3,000 standard, ¥30,000 insured — F9.5). */
export const shipmentIncidents = pgTable("shipment_incidents", {
  id: id(),
  shipmentId: text("shipment_id").notNull().unique(),
  kind: text("kind").notNull(), // LOST | DAMAGED
  note: text("note").notNull(),
  reportedBy: text("reported_by").notNull(),
  reportedAt: ts("reported_at").notNull(),
  claimStatus: text("claim_status").notNull().default("OPEN"), // OPEN | SUBMITTED | PAID | REJECTED
  claimRef: text("claim_ref"),
  claimAmount: integer("claim_amount"),
  updatedAt: ts("updated_at").notNull(),
});

/** X4: a sealed box replaced before opening by another box of the same product and lot; public and append-only. */
export const subjectReplacements = pgTable("subject_replacements", {
  id: id(),
  lotteryId: text("lottery_id")
    .notNull()
    .references(() => lotteries.id),
  fromUnitId: text("from_unit_id").notNull(),
  toUnitId: text("to_unit_id").notNull(),
  fromLabel: text("from_label").notNull(),
  toLabel: text("to_label").notNull(),
  lot: text("lot").notNull(),
  reason: text("reason").notNull(),
  photoUrls: jsonb("photo_urls").$type<string[]>().notNull().default([]),
  replacedBy: text("replaced_by").notNull(),
  replacedAt: ts("replaced_at").notNull(),
});

/** SV4 capture devices: a station camera posts recording segments with its own token (stored hashed; ADMIN issues / revokes). */
export const stationDevices = pgTable("station_devices", {
  id: id(),
  stationId: text("station_id").notNull(),
  label: text("label").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  createdBy: text("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastSeenAt: ts("last_seen_at"),
  revokedAt: ts("revoked_at"),
});

/** T13 job queue: state change and its next job are written in the same transaction. */
export const jobs = pgTable(
  "jobs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    kind: text("kind").notNull(),
    /** idempotency key, e.g. "lottery:<id>:close-sale" */
    key: text("key").notNull().unique(),
    payload: jsonb("payload").notNull().default({}),
    runAt: ts("run_at").notNull(),
    /** 0 = time-critical (draw, sale close, hold expiry) … 5 = background; claimed in (priority, run_at) order */
    priority: smallint("priority").notNull().default(5),
    status: text("status").notNull().default("PENDING"), // PENDING | RUNNING | DONE | FAILED
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    lockedAt: ts("locked_at"),
    finishedAt: ts("finished_at"),
  },
  (t) => [index("jobs_due_idx").on(t.priority, t.runAt).where(sql`status = 'PENDING'`)],
);

/** T16 first-party events (no ad pixels). */
export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: ts("at").notNull().defaultNow(),
    name: text("name").notNull(),
    userId: text("user_id"),
    anonId: text("anon_id"),
    props: jsonb("props").notNull().default({}),
  },
  (t) => [index("events_name_at_idx").on(t.name, t.at)],
);

/** F26.7 manual channel spend input (CSV). */
export const channelSpend = pgTable(
  "channel_spend",
  {
    month: text("month").notNull(), // YYYY-MM
    source: text("source").notNull(),
    amount: integer("amount").notNull(),
  },
  (t) => [primaryKey({ columns: [t.month, t.source] })],
);

// ───────────────────────── randomness service (T11) — separate schema & role ─────────────────────────
export const rng = pgSchema("rng");
/** server seeds, stored only encrypted; only the rng role can read this table */
export const seedVault = rng.table("seed_vault", {
  lotteryId: text("lottery_id").primaryKey(),
  commit: text("commit").notNull(),
  encryptedSeed: text("encrypted_seed").notNull(),
  keyId: text("key_id").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  revealedAt: ts("revealed_at"),
});

export const _sql = sql;
