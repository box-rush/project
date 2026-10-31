import { awsClientConfig } from "./aws";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import type { EmailSender, LineSender, SmsSender } from "./messaging";

/** T5: Amazon SES (Tokyo). SPF / DKIM / DMARC are configured on the sending domain, not here. */
export class SesEmailSender implements EmailSender {
  constructor(
    private readonly from: string,
    private readonly client: Pick<SESv2Client, "send"> = new SESv2Client(awsClientConfig()),
    private readonly configurationSet?: string,
  ) {}
  async send(to: string, subject: string, body: string) {
    await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: this.from,
        Destination: { ToAddresses: [to] },
        ConfigurationSetName: this.configurationSet,
        Content: { Simple: { Subject: { Data: subject, Charset: "UTF-8" }, Body: { Text: { Data: body, Charset: "UTF-8" } } } },
      }),
    );
  }
}

type Fetch = typeof fetch;

/** A provider that hangs must not hold a worker lane or a request: fail, and let the caller's retry/backoff run. */
const HTTP_TIMEOUT_MS = 10_000;

async function ensureOk(res: Response, what: string) {
  if (!res.ok) throw new Error(`${what} failed: ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
}

/** T5: LINE Messaging API push (公式アカウント). Only key fulfilment nodes are pushed; email is the guaranteed channel. */
export class LineMessagingSender implements LineSender {
  constructor(
    private readonly channelAccessToken: string,
    private readonly fetchImpl: Fetch = fetch,
  ) {}
  async push(lineUserId: string, text: string) {
    const res = await this.fetchImpl("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.channelAccessToken}` },
      // LINE limits a text message to 5,000 characters
      body: JSON.stringify({ to: lineUserId, messages: [{ type: "text", text: text.slice(0, 5000) }] }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    await ensureOk(res, "LINE push");
  }
}

/** T10 fallback / development SMS: Twilio Messages API. */
export class TwilioSmsSender implements SmsSender {
  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly from: string,
    private readonly fetchImpl: Fetch = fetch,
  ) {}
  async send(phoneNumber: string, text: string) {
    const res = await this.fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64")}` },
      body: new URLSearchParams({ To: phoneNumber, From: this.from, Body: text }).toString(),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    await ensureOk(res, "Twilio SMS");
  }
}

/**
 * T10: the SMS layer is replaceable; production uses KDDI Message Cast with Twilio as the failover.
 * The KDDI adapter is plugged in here as `primary` once its API contract and spec are available.
 */
export class FailoverSmsSender implements SmsSender {
  constructor(
    private readonly primary: SmsSender,
    private readonly fallback: SmsSender,
    private readonly onFailover: (e: unknown) => void = (e) => console.warn("[sms] primary failed, using fallback", e),
  ) {}
  async send(phoneNumber: string, text: string) {
    try {
      await this.primary.send(phoneNumber, text);
    } catch (e) {
      this.onFailover(e);
      await this.fallback.send(phoneNumber, text);
    }
  }
}
