import { and, asc, eq, isNull, lte, notifications, or, sql, users, type DbOrTx } from "@boxrush/db";
import type { Ctx } from "./context";

/**
 * M11. Fulfilment notices (F11.1–F11.4, F11.7) cannot be disabled and always go by email; LINE in addition
 * when linked. Marketing notices are off by default (F1.5). Web Push is P1.
 */
export const NOTIFICATION_KINDS = {
  SOLD_OUT: true, // F11.1
  FAILED_REFUNDED: true, // F11.1
  DRAW_PUBLISHED: true, // F11.2
  OPENING_STARTED: true, // F11.3
  RESULT_PUBLISHED: true, // F11.3
  OPENING_DELAYED: true, // F11.7 / X6
  OPENING_OVERDUE_REFUND_AVAILABLE: true, // X6
  ABORTED_REFUNDED: true, // F11.7
  REFUND_COMPLETED: true,
  SHIPPED: true, // F11.4
  DELIVERED: true, // F11.4
  STORAGE_EXPIRING: true, // F11.4
  FORCED_SHIPMENT: true, // X13
  PAYMENT_METHOD_REQUIRED: true, // X13
  ADDRESS_REQUIRED: true, // X13
  COUPON_GRANTED: true,
  COUPON_EXPIRING: true, // CP3 (once)
  TICKET_REPLY: true,
  ARBITRATION_DECIDED: true, // F11.7
  LATE_PAYMENT_REFUNDED: true,
  SHIPMENT_INCIDENT: true, // X12
} as const;
export type NotificationKind = keyof typeof NOTIFICATION_KINDS;

type Params = Record<string, string | number>;

const T: Record<string, Record<NotificationKind, (p: Params) => [string, string]>> = {
  ja: {
    SOLD_OUT: (p) => [`【BOXラッシュ】${p.title} が満員になりました`, `抽選結果（あなたの枠のカード番号）は開封前に公開されます。`],
    FAILED_REFUNDED: (p) => [`【BOXラッシュ】${p.title} は不成立となりました`, `満員にならなかったため、${p.amount} を元のお支払い方法へ返金します。`],
    DRAW_PUBLISHED: (p) => [`【BOXラッシュ】${p.title} の割り当てを公開しました`, `あなたの枠のカード番号を確認できます。開封予定：${p.openingAt}`],
    OPENING_STARTED: (p) => [`【BOXラッシュ】${p.title} の開封を開始しました`, `開封の様子は録画され、いつでも確認できます。`],
    RESULT_PUBLISHED: (p) => [`【BOXラッシュ】${p.title} の結果が確定しました`, `カードはコレクションに保管されています。各カードの録画位置から確認できます。`],
    OPENING_DELAYED: (p) => [`【BOXラッシュ】${p.title} の開封が延期になりました`, `理由：${p.reason}\n新しい開封予定：${p.openingAt}`],
    OPENING_OVERDUE_REFUND_AVAILABLE: (p) => [`【BOXラッシュ】${p.title} の返金を選択できます`, `開封予定時刻から24時間を過ぎたため、ご希望の方は返金を選択できます。`],
    ABORTED_REFUNDED: (p) => [`【BOXラッシュ】${p.title} は中止となりました`, `理由：${p.reason}\n${p.amount} を元のお支払い方法へ全額返金します。`],
    REFUND_COMPLETED: (p) => [`【BOXラッシュ】返金が完了しました`, `${p.amount} を元のお支払い方法へ返金しました。`],
    SHIPPED: (p) => [`【BOXラッシュ】発送しました`, `${p.carrier} 伝票番号 ${p.trackingNumber}`],
    DELIVERED: () => [`【BOXラッシュ】お届けが完了しました`, `ご利用ありがとうございました。`],
    STORAGE_EXPIRING: (p) => [`【BOXラッシュ】無料保管期限のお知らせ`, `${p.count} 点のカードの無料保管期限は ${p.until} です。期限を過ぎると登録住所へ発送します（送料はお客様負担）。`],
    FORCED_SHIPMENT: (p) => [`【BOXラッシュ】保管期限切れのカードを発送します`, `${p.count} 点を登録住所へ発送します。送料 ${p.fee}。`],
    PAYMENT_METHOD_REQUIRED: () => [`【BOXラッシュ】お支払い方法の更新をお願いします`, `送料の決済ができませんでした。お支払い方法を更新するまで枠の購入を停止しています。`],
    ADDRESS_REQUIRED: () => [`【BOXラッシュ】お届け先の登録をお願いします`, `保管期限を過ぎたカードがあります。住所を登録するまで枠の購入を停止しています（保管は無料で継続します）。`],
    COUPON_GRANTED: (p) => [`【BOXラッシュ】送料無料クーポンが付与されました`, `有効期限：${p.expiresAt}`],
    COUPON_EXPIRING: (p) => [`【BOXラッシュ】クーポンの有効期限のお知らせ`, `有効期限：${p.expiresAt}`],
    TICKET_REPLY: (p) => [`【BOXラッシュ】お問い合わせ #${p.code} に返信がありました`, `マイページから確認できます。`],
    ARBITRATION_DECIDED: (p) => [`【BOXラッシュ】申し立て #${p.code} の結果`, `${p.resolution}`],
    LATE_PAYMENT_REFUNDED: (p) => [`【BOXラッシュ】お支払いを返金しました`, `お支払いの確認が確保時間（10分）を過ぎ、枠が確保できなかったため ${p.amount} を返金します。`],
    SHIPMENT_INCIDENT: (p) => [`【BOXラッシュ】発送 #${p.code} の配送事故のお知らせ`, `${p.kind === "LOST" ? "配送中に紛失しました" : "配送中に破損しました"}。運送会社へ補償を請求します（補償上限 ${p.cap}）。進捗はマイページでお知らせします。`],
  },
  "zh-Hans": {
    SOLD_OUT: (p) => [`【BOXラッシュ】${p.title} 已满员`, `抽选结果将在开盒前公示。`],
    FAILED_REFUNDED: (p) => [`【BOXラッシュ】${p.title} 未成团`, `未满员，${p.amount} 将原路退回。`],
    DRAW_PUBLISHED: (p) => [`【BOXラッシュ】${p.title} 分配已公示`, `开盒时间：${p.openingAt}`],
    OPENING_STARTED: (p) => [`【BOXラッシュ】${p.title} 开盒开始`, `全程录像，可随时查看。`],
    RESULT_PUBLISHED: (p) => [`【BOXラッシュ】${p.title} 结果已确定`, `卡片已存入仓库。`],
    OPENING_DELAYED: (p) => [`【BOXラッシュ】${p.title} 开盒延期`, `原因：${p.reason}\n新时间：${p.openingAt}`],
    OPENING_OVERDUE_REFUND_AVAILABLE: (p) => [`【BOXラッシュ】${p.title} 可选择退款`, `已超过承诺开盒时间 24 小时。`],
    ABORTED_REFUNDED: (p) => [`【BOXラッシュ】${p.title} 已中止`, `原因：${p.reason}\n${p.amount} 将原路全额退回。`],
    REFUND_COMPLETED: (p) => [`【BOXラッシュ】退款完成`, `${p.amount} 已原路退回。`],
    SHIPPED: (p) => [`【BOXラッシュ】已发货`, `${p.carrier} ${p.trackingNumber}`],
    DELIVERED: () => [`【BOXラッシュ】已签收`, ``],
    STORAGE_EXPIRING: (p) => [`【BOXラッシュ】免费保管即将到期`, `${p.count} 件，到期日 ${p.until}`],
    FORCED_SHIPMENT: (p) => [`【BOXラッシュ】保管期满发货`, `${p.count} 件，运费 ${p.fee}`],
    PAYMENT_METHOD_REQUIRED: () => [`【BOXラッシュ】请更新支付方式`, `运费扣款失败，购位已暂停。`],
    ADDRESS_REQUIRED: () => [`【BOXラッシュ】请登记收货地址`, `购位已暂停，保管继续免费。`],
    COUPON_GRANTED: (p) => [`【BOXラッシュ】获得包邮券`, `有效期：${p.expiresAt}`],
    COUPON_EXPIRING: (p) => [`【BOXラッシュ】券即将到期`, `有效期：${p.expiresAt}`],
    TICKET_REPLY: (p) => [`【BOXラッシュ】工单 #${p.code} 有新回复`, ``],
    ARBITRATION_DECIDED: (p) => [`【BOXラッシュ】申诉 #${p.code} 结果`, `${p.resolution}`],
    LATE_PAYMENT_REFUNDED: (p) => [`【BOXラッシュ】支付已退回`, `${p.amount}`],
    SHIPMENT_INCIDENT: (p) => [`【BOXラッシュ】发货 #${p.code} 物流事故通知`, `${p.kind === "LOST" ? "运输途中丢失" : "运输途中破损"}。我们将向运输公司申请赔偿（赔偿上限 ${p.cap}），进展会在我的页面通知。`],
  },
  en: {
    SOLD_OUT: (p) => [`[Box Rush] ${p.title} is full`, `The draw will be published before opening.`],
    FAILED_REFUNDED: (p) => [`[Box Rush] ${p.title} did not fill`, `${p.amount} will be refunded to your original payment method.`],
    DRAW_PUBLISHED: (p) => [`[Box Rush] ${p.title}: assignment published`, `Opening: ${p.openingAt}`],
    OPENING_STARTED: (p) => [`[Box Rush] ${p.title}: opening started`, `The opening is recorded in full.`],
    RESULT_PUBLISHED: (p) => [`[Box Rush] ${p.title}: results confirmed`, `Your cards are stored in your collection.`],
    OPENING_DELAYED: (p) => [`[Box Rush] ${p.title}: opening delayed`, `Reason: ${p.reason}\nNew time: ${p.openingAt}`],
    OPENING_OVERDUE_REFUND_AVAILABLE: (p) => [`[Box Rush] ${p.title}: refund available`, `More than 24 hours past the promised time.`],
    ABORTED_REFUNDED: (p) => [`[Box Rush] ${p.title} was aborted`, `Reason: ${p.reason}\n${p.amount} will be refunded in full.`],
    REFUND_COMPLETED: (p) => [`[Box Rush] Refund completed`, `${p.amount} refunded to your original payment method.`],
    SHIPPED: (p) => [`[Box Rush] Shipped`, `${p.carrier} ${p.trackingNumber}`],
    DELIVERED: () => [`[Box Rush] Delivered`, ``],
    STORAGE_EXPIRING: (p) => [`[Box Rush] Free storage ending`, `${p.count} items, until ${p.until}`],
    FORCED_SHIPMENT: (p) => [`[Box Rush] Shipping expired storage`, `${p.count} items, fee ${p.fee}`],
    PAYMENT_METHOD_REQUIRED: () => [`[Box Rush] Update your payment method`, `Slot purchases are paused.`],
    ADDRESS_REQUIRED: () => [`[Box Rush] Add a shipping address`, `Slot purchases are paused; storage stays free.`],
    COUPON_GRANTED: (p) => [`[Box Rush] Free-shipping coupon`, `Valid until ${p.expiresAt}`],
    COUPON_EXPIRING: (p) => [`[Box Rush] Coupon expiring`, `Valid until ${p.expiresAt}`],
    TICKET_REPLY: (p) => [`[Box Rush] Reply on #${p.code}`, ``],
    ARBITRATION_DECIDED: (p) => [`[Box Rush] Appeal #${p.code} decided`, `${p.resolution}`],
    LATE_PAYMENT_REFUNDED: (p) => [`[Box Rush] Payment refunded`, `${p.amount}`],
    SHIPMENT_INCIDENT: (p) => [`[Box Rush] Shipping incident on parcel #${p.code}`, `${p.kind === "LOST" ? "The parcel was lost in transit" : "The parcel was damaged in transit"}. We are claiming compensation from the carrier (cap ${p.cap}) and will keep you posted.`],
  },
};

export function renderNotification(locale: string, kind: NotificationKind, params: Params): { subject: string; body: string } {
  const [subject, body] = (T[locale] ?? T.ja!)[kind](params);
  return { subject, body };
}

/** Insert inside the business transaction; delivery happens in `dispatchNotifications` (outbox). */
export async function notify(tx: DbOrTx, userId: string, kind: NotificationKind, params: Params = {}, dedupeKey?: string, at?: Date) {
  await tx
    .insert(notifications)
    .values({ userId, kind, fulfilment: NOTIFICATION_KINDS[kind], params, dedupeKey: dedupeKey ?? null, ...(at ? { createdAt: at } : {}) })
    .onConflictDoNothing({ target: notifications.dedupeKey });
}

/**
 * Outbox delivery. Each notification is handled on its own: a failing address or a provider outage backs off
 * (1 min doubling to 6 h) and never blocks the rest of the queue. Email is the guaranteed channel and is marked
 * sent the moment it goes out; LINE is best effort on top, so a LINE failure never re-sends the email.
 */
export async function dispatchNotifications(ctx: Ctx, limit = 100) {
  const now = ctx.now();
  const pending = await ctx.db
    .select({ n: notifications, email: users.email, locale: users.locale, line: users.lineUserId, notifyLine: users.notifyLine, deleted: users.deletedAt })
    .from(notifications)
    .innerJoin(users, eq(users.id, notifications.userId))
    .where(and(isNull(notifications.emailSentAt), or(isNull(notifications.nextSendAt), lte(notifications.nextSendAt, now))))
    .orderBy(asc(notifications.createdAt))
    .limit(limit);
  let failed = 0;
  for (const row of pending) {
    if (row.deleted) {
      await ctx.db.update(notifications).set({ emailSentAt: ctx.now() }).where(eq(notifications.id, row.n.id));
      continue;
    }
    const { subject, body } = renderNotification(row.locale, row.n.kind as NotificationKind, row.n.params as Params);
    try {
      await ctx.email.send(row.email, subject, `${body}\n\n${ctx.webBaseUrl}/notifications`);
    } catch (e) {
      failed++;
      const attempts = row.n.sendAttempts + 1;
      await ctx.db
        .update(notifications)
        .set({ sendAttempts: attempts, nextSendAt: new Date(ctx.now().getTime() + 60_000 * Math.min(360, 2 ** (attempts - 1))), lastSendError: e instanceof Error ? e.message.slice(0, 500) : String(e) })
        .where(eq(notifications.id, row.n.id));
      continue;
    }
    await ctx.db.update(notifications).set({ emailSentAt: ctx.now(), lastSendError: null }).where(and(eq(notifications.id, row.n.id), isNull(notifications.emailSentAt)));
    if (row.line && (row.n.fulfilment || row.notifyLine)) {
      try {
        await ctx.line.push(row.line, `${subject}\n${body}`);
        await ctx.db.update(notifications).set({ lineSentAt: ctx.now() }).where(eq(notifications.id, row.n.id));
      } catch (e) {
        console.warn("[notify] LINE push failed (email was delivered)", row.n.id, e instanceof Error ? e.message : e);
      }
    }
  }
  if (failed) console.warn(`[alert] ${failed} notification(s) failed to send; retrying with backoff`);
  return pending.length;
}

export async function unreadCount(db: DbOrTx, userId: string) {
  const r = await db.execute<{ c: string }>(sql`SELECT count(*)::text AS c FROM notifications WHERE user_id = ${userId} AND read_at IS NULL`);
  return Number(r.rows[0]?.c ?? 0);
}
