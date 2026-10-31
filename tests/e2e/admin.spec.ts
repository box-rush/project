import { expect, test } from "@playwright/test";
import { totp } from "../../packages/services/src/staffAuth";

const ADMIN = process.env.E2E_ADMIN_URL ?? "http://localhost:3101";
const PAGES = [
  "/merchant/lotteries", "/merchant/lotteries/new", "/merchant/intake", "/ops/dashboard", "/ops/review", "/ops/schedule", "/ops/pricing",
  "/ops/products", "/ops/checklists", "/ops/banners", "/ops/coupons", "/station", "/ops/attribution", "/ops/warehouse", "/ops/intake",
  "/ops/inventory", "/ops/procurement", "/ops/tickets", "/ops/arbitration", "/ops/finance", "/ops/risk", "/ops/audit", "/ops/monitoring", "/ops/incidents", "/ops/tickets/faqs",
];

test("staff login requires TOTP; every back-office page renders for admin, none offers a draw trigger or video upload", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${ADMIN}/ops/dashboard`);
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("メールアドレス").fill("admin@boxrush.local");
  await page.getByLabel("パスワード").fill("boxrush-dev");
  await page.getByRole("button", { name: "次へ" }).click();
  await page.getByLabel("認証コード（6桁）").fill(totp("JBSWY3DPEHPK3PXP", new Date()));
  await page.getByRole("button", { name: "ログイン" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  for (const p of PAGES) {
    const res = await page.goto(`${ADMIN}${p}`);
    expect(res?.status(), p).toBe(200);
    await expect(page.locator("body")).not.toContainText("Application error");
    // I4 / I5: no staff UI to run or re-run a draw, and no video upload
    expect(await page.locator('input[type="file"][accept*="video"]').count(), p).toBe(0);
    await expect(page.locator("body"), p).not.toContainText(/再抽選|抽選を実行|動画をアップロード/);
  }
  expect(errors).toEqual([]);

  // P8: evidence pack for a seeded paid order
  const pg = await import("pg");
  const c = new pg.default.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://boxrush:boxrush@localhost:5432/boxrush" });
  await c.connect();
  const { rows } = await c.query("SELECT payment_ref FROM orders WHERE status = 'PAID' AND payment_ref IS NOT NULL LIMIT 1");
  await c.end();
  const res = await page.request.get(`${ADMIN}/api/disputes/${rows[0].payment_ref}`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.packHash).toMatch(/^[0-9a-f]{64}$/);
  expect(body.pack.auditTrail.length).toBeGreaterThan(0);
});

test("X7: admin switches the unconfirmed-report policy on the monitoring page; the change is stored and audited", async ({ page }) => {
  await page.goto(`${ADMIN}/ops/monitoring`);
  if (new URL(page.url()).pathname.startsWith("/login")) {
    await page.getByLabel("メールアドレス").fill("admin@boxrush.local");
    await page.getByLabel("パスワード").fill("boxrush-dev");
    await page.getByRole("button", { name: "次へ" }).click();
    await page.getByLabel("認証コード（6桁）").fill(totp("JBSWY3DPEHPK3PXP", new Date()));
    await page.getByRole("button", { name: "ログイン" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"));
    await page.goto(`${ADMIN}/ops/monitoring`);
  }
  const pg = await import("pg");
  const c = new pg.default.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://boxrush:boxrush@localhost:5432/boxrush" });
  await c.connect();
  const setting = async () => (await c.query("SELECT value FROM platform_settings WHERE key = 'recordingLossUnconfirmed'")).rows[0]?.value;
  const save = async (label: string) => {
    await page.getByLabel(label).check();
    await page.getByRole("button", { name: "保存" }).click();
    await expect(page.getByText("保存しました")).toBeVisible();
  };
  try {
    await expect(page.getByLabel("24時間後に自動で中止・全額返金")).toBeChecked(); // default
    await save("警告のみ（自動では中止しない）");
    expect(await setting()).toBe("ALERT_ONLY");
    await page.reload();
    await expect(page.getByLabel("警告のみ（自動では中止しない）")).toBeChecked();
    const { rows } = await c.query("SELECT actor_type, entity_id, data FROM audit_log WHERE action = 'settings.update' ORDER BY seq DESC LIMIT 1");
    expect(rows[0]).toMatchObject({ actor_type: "STAFF", entity_id: "recordingLossUnconfirmed", data: { from: "AUTO_ABORT_24H", to: "ALERT_ONLY" } });
  } finally {
    await save("24時間後に自動で中止・全額返金").catch(() => {});
    expect(await setting()).toBe("AUTO_ABORT_24H");
    await c.end();
  }
});

test("T18 staff management: admin adds a station operator (one-time password, TOTP at first login), then disables them", async ({ browser, page }) => {
  const pg = await import("pg");
  const c = new pg.default.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://boxrush:boxrush@localhost:5432/boxrush" });
  await c.connect();
  try {
    await page.goto(`${ADMIN}/ops/audit`);
    if (new URL(page.url()).pathname.startsWith("/login")) {
      await page.getByLabel("メールアドレス").fill("admin@boxrush.local");
      await page.getByLabel("パスワード").fill("boxrush-dev");
      await page.getByRole("button", { name: "次へ" }).click();
      await page.getByLabel("認証コード（6桁）").fill(totp("JBSWY3DPEHPK3PXP", new Date()));
      await page.getByRole("button", { name: "ログイン" }).click();
      await page.waitForURL((u) => !u.pathname.startsWith("/login"));
      await page.goto(`${ADMIN}/ops/audit`);
    }
    page.on("dialog", (d) => d.accept());
    const email = `station-${Date.now().toString(36)}@boxrush.local`;
    const form = page.locator("form").filter({ has: page.getByRole("button", { name: "追加して一時パスワードを発行" }) });
    await form.getByLabel("氏名").fill("開封担当（E2E）");
    await form.getByLabel("メールアドレス").fill(email);
    await form.getByLabel("開封", { exact: true }).check();
    await form.getByRole("button", { name: "追加して一時パスワードを発行" }).click();
    const password = (await page.getByTestId("temp-password").innerText()).trim();
    expect(password).toHaveLength(20);
    expect((await c.query("SELECT password_hash FROM staff WHERE email = $1", [email])).rows[0].password_hash).not.toContain(password);

    // first login: password, then register TOTP from the shown secret
    const p2 = await (await browser.newContext({ baseURL: ADMIN })).newPage();
    await p2.goto("/login");
    await p2.getByLabel("メールアドレス").fill(email);
    await p2.getByLabel("パスワード").fill(password);
    await p2.getByRole("button", { name: "次へ" }).click();
    await expect(p2.getByText("認証アプリを登録してください")).toBeVisible();
    const secret = (await c.query("SELECT totp_secret FROM staff WHERE email = $1", [email])).rows[0].totp_secret as string;
    await p2.getByLabel("認証コード（6桁）").fill(totp(secret, new Date()));
    await p2.getByRole("button", { name: "ログイン" }).click();
    await p2.waitForURL((u) => !u.pathname.startsWith("/login"));
    await p2.goto("/station");
    await expect(p2.getByRole("heading", { name: "開封ステーション" })).toBeVisible();

    // disabled → signed out at once
    await page.reload();
    await page.getByRole("row", { name: new RegExp(email) }).getByRole("button", { name: "無効にする" }).click();
    await expect.poll(async () => (await c.query("SELECT disabled_at FROM staff WHERE email = $1", [email])).rows[0].disabled_at).not.toBeNull();
    await p2.goto("/station");
    await expect(p2).toHaveURL(/\/login/);
  } finally {
    await c.end();
  }
});
