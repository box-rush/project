import { describe, expect, it } from "vitest";
import { scrubEvent, sentryOptions } from "../src/observability";

describe("T17 error tracking never carries personal data", () => {
  it("drops user, cookies, headers, query and body; masks e-mail, phone and card-like numbers", () => {
    const e = scrubEvent({
      type: undefined,
      user: { id: "u_1", email: "taro@example.com", ip_address: "203.0.113.5" },
      server_name: "ip-10-0-0-1",
      request: { method: "POST", url: "https://boxrush.jp/checkout/o_1?utm_source=x&email=a@b.jp", cookies: { br_staff: "secret" }, headers: { cookie: "x", authorization: "Bearer t" }, data: { phone: "09012345678" }, query_string: "a=b" },
      message: "failed for taro@example.com / 090-1234-5678 card 4242424242424242",
      exception: { values: [{ type: "Error", value: "user hanako@example.jp +819012345678" }] },
      breadcrumbs: [{ message: "login taro@example.com", data: { token: "x" } }],
      extra: { address: "東京都千代田区1-1" },
    });
    expect(e.user).toBeUndefined();
    expect(e.server_name).toBeUndefined();
    expect(e.request).toEqual({ method: "POST", url: "https://boxrush.jp/checkout/o_1" });
    expect(e.message).toBe("failed for [email] / [phone] card [number]");
    expect(e.exception!.values![0]!.value).toBe("user [email] [phone]");
    expect(e.breadcrumbs![0]).toEqual({ message: "login [email]", data: undefined });
    expect(e.extra).toBeUndefined();
  });

  it("is off unless a DSN is configured", () => {
    const prev = process.env.SENTRY_DSN;
    process.env.SENTRY_DSN = "unset";
    expect(sentryOptions("web")).toMatchObject({ enabled: false, sendDefaultPii: false, tracesSampleRate: 0 });
    process.env.SENTRY_DSN = "https://k@o1.ingest.sentry.io/1";
    expect(sentryOptions("web").enabled).toBe(true);
    if (prev === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = prev;
  });
});
