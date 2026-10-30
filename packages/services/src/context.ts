import type { Db } from "@boxrush/db";
import type { PaymentProvider } from "./adapters/payments";
import type { EmailSender, LineSender, SmsSender } from "./adapters/messaging";
import type { RandomnessService } from "./rng";

export interface Ctx {
  db: Db;
  /** Business clock. Production: () => new Date(). Tests drive it explicitly. */
  now: () => Date;
  payments: PaymentProvider;
  rng: RandomnessService;
  email: EmailSender;
  line: LineSender;
  sms: SmsSender;
  /** T9 HMAC key (hex) */
  pseudonymKey: string;
  webBaseUrl: string;
}
