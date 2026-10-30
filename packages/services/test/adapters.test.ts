import { describe, expect, it, vi } from "vitest";
import { FailoverSmsSender, LineMessagingSender, SesEmailSender, TwilioSmsSender } from "../src";

const ok = () => new Response("{}", { status: 200 });

describe("messaging adapters (T5, T10)", () => {
  it("SES sends UTF-8 text mail from the configured sender", async () => {
    const send = vi.fn().mockResolvedValue({});
    await new SesEmailSender("no-reply@example.jp", { send } as never, "cfg").send("a@example.com", "【BOXラッシュ】件名", "本文");
    const input = send.mock.calls[0]![0].input;
    expect(input).toMatchObject({ FromEmailAddress: "no-reply@example.jp", Destination: { ToAddresses: ["a@example.com"] }, ConfigurationSetName: "cfg" });
    expect(input.Content.Simple.Subject).toEqual({ Data: "【BOXラッシュ】件名", Charset: "UTF-8" });
  });

  it("LINE push uses the channel token and truncates to 5,000 chars", async () => {
    const f = vi.fn().mockResolvedValue(ok());
    await new LineMessagingSender("tok", f).push("U123", "x".repeat(6000));
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("https://api.line.me/v2/bot/message/push");
    expect(init.headers.authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body).messages[0].text).toHaveLength(5000);
  });

  it("LINE errors surface (the outbox retries; email is the guaranteed channel)", async () => {
    const f = vi.fn().mockResolvedValue(new Response("bad", { status: 400 }));
    await expect(new LineMessagingSender("tok", f).push("U1", "hi")).rejects.toThrow(/400/);
  });

  it("Twilio posts form data with basic auth", async () => {
    const f = vi.fn().mockResolvedValue(ok());
    await new TwilioSmsSender("AC1", "secret", "+15550000000", f).send("+819012345678", "認証コード 123456");
    const [url, init] = f.mock.calls[0]!;
    expect(url).toContain("/Accounts/AC1/Messages.json");
    expect(init.headers.authorization).toBe(`Basic ${Buffer.from("AC1:secret").toString("base64")}`);
    expect(new URLSearchParams(init.body).get("To")).toBe("+819012345678");
  });

  it("SMS fails over to the backup provider", async () => {
    const primary = { send: vi.fn().mockRejectedValue(new Error("down")) };
    const fallback = { send: vi.fn().mockResolvedValue(undefined) };
    const onFailover = vi.fn();
    await new FailoverSmsSender(primary, fallback, onFailover).send("+81", "t");
    expect(fallback.send).toHaveBeenCalledWith("+81", "t");
    expect(onFailover).toHaveBeenCalled();
  });
});
