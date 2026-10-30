/** T5 email (SES) and LINE Messaging API; T10 SMS (KDDI Message Cast, Twilio fallback). Console in dev. */
export interface EmailSender {
  send(to: string, subject: string, body: string): Promise<void>;
}
export interface LineSender {
  push(lineUserId: string, text: string): Promise<void>;
}
export interface SmsSender {
  send(phoneNumber: string, text: string): Promise<void>;
}

export class ConsoleMessaging implements EmailSender, LineSender, SmsSender {
  readonly outbox: { channel: "email" | "line" | "sms"; to: string; text: string }[] = [];
  constructor(private readonly quiet = false) {}
  async send(to: string, a: string, b?: string) {
    const text = b === undefined ? a : `${a}\n${b}`;
    const channel = b === undefined ? "sms" : "email";
    this.outbox.push({ channel, to, text });
    if (!this.quiet) console.log(`[${channel}] → ${to}: ${text.split("\n")[0]}`);
  }
  async push(to: string, text: string) {
    this.outbox.push({ channel: "line", to, text });
    if (!this.quiet) console.log(`[line] → ${to}: ${text.split("\n")[0]}`);
  }
}
