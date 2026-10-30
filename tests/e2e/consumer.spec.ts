import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

const DB = process.env.DATABASE_URL ?? "postgres://boxrush:boxrush@localhost:5432/boxrush";
const FORBIDDEN = /ポイント|残高|チャージ|期待値|還元率|ガチャ/;

async function latestOtp(phoneE164: string) {
  const c = new pg.Client({ connectionString: DB });
  await c.connect();
  const r = await c.query("SELECT value FROM auth_verifications WHERE identifier = $1 ORDER BY created_at DESC LIMIT 1", [phoneE164]);
  await c.end();
  return String(r.rows[0]?.value ?? "").split(":")[0]!;
}

async function noForbiddenWording(page: Page) {
  expect(await page.locator("body").innerText()).not.toMatch(FORBIDDEN); // UR1 / UR2
}

test("sign up → SMS verification → buy a slot → see it in マイ枠", async ({ page }) => {
  const id = Date.now().toString().slice(-8);
  await page.goto("/login?mode=signup");
  await page.getByLabel("ニックネーム").fill(`e2e${id}`);
  await page.getByLabel("メールアドレス").fill(`e2e${id}@example.com`);
  await page.getByLabel("パスワード").fill("e2e-password-1");
  await page.getByRole("button", { name: "新規登録" }).click();

  await expect(page.getByRole("heading", { name: "SMS認証" })).toBeVisible();
  const local = `080${id}`;
  await page.getByLabel("携帯電話番号").fill(local);
  await page.getByRole("button", { name: "認証コードを送る" }).click();
  await expect(page.getByText("SMSを送信しました")).toBeVisible();
  const code = await latestOtp(`+81${local.slice(1)}`);
  await page.getByLabel("認証コード（6桁）").fill(code);
  await page.getByRole("button", { name: "認証する" }).click();

  await expect(page.getByRole("heading", { name: "はじめての方へ" })).toBeVisible();
  await page.getByRole("button", { name: "はじめる" }).click();

  // Home → an on-sale lottery
  await page.goto("/");
  await noForbiddenWording(page);
  await page.getByRole("link", { name: /星海のきらめき 1BOX（4枠）/ }).first().click();

  // UR5 seed commitment and UR4 refund promise are shown before the purchase button
  await expect(page.getByRole("heading", { name: "抽選シード（コミット）" })).toBeVisible();
  await expect(page.getByText("満員にならなければ全額返金")).toBeVisible();
  await expect(page.getByText("購入後のキャンセルはできません", { exact: false })).toBeVisible();
  await noForbiddenWording(page);
  await page.getByRole("button", { name: "枠を購入する" }).click();

  await expect(page.getByRole("heading", { name: "購入内容の確認" })).toBeVisible();
  await page.getByRole("button", { name: "テスト決済で支払う（開発環境）" }).click();
  await expect(page.getByRole("heading", { name: "購入が完了しました" })).toBeVisible();

  await page.getByRole("link", { name: "マイ枠を見る" }).click();
  await expect(page.getByText("星海のきらめき 1BOX（4枠）")).toBeVisible();
});

test("public verification recomputes the draw in the browser and detects tampering", async ({ page }) => {
  await page.goto("/verify/L0001");
  await expect(page.getByText("この版は外部ビーコンを使っていません", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "ブラウザで再計算する" }).click();
  await expect(page.getByText("✓ シードのハッシュがコミットと一致")).toBeVisible();
  await expect(page.getByText("✓ 参加者リストのハッシュが一致")).toBeVisible();
  await expect(page.getByText("✓ 全枠のカード番号が一致")).toBeVisible();
  await page.getByRole("button", { name: "改ざんテスト" }).click();
  await expect(page.getByText("✗ 全枠のカード番号が一致")).toBeVisible();
  const json = await page.request.get("/api/records/L0001");
  expect(json.ok()).toBe(true);
  expect(JSON.stringify(await json.json())).not.toMatch(/@boxrush\.local/); // pseudonymous
});

test("demo user ships stored cards in one parcel with a free-shipping coupon", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill("demo@boxrush.local");
  await page.getByLabel("パスワード").fill("boxrush-demo");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));

  await page.goto("/collection");
  await noForbiddenWording(page);
  const boxes = page.getByRole("checkbox", { name: "選択" });
  const n = await boxes.count();
  test.skip(n < 3, "seed did not give the demo user 3 stored cards");
  for (let i = 0; i < 3; i++) await boxes.nth(i).check();
  await page.getByRole("button", { name: "まとめて発送" }).click();
  await expect(page.getByRole("heading", { name: "発送申請" })).toBeVisible();
  await page.locator("select").selectOption({ index: 1 });
  await page.getByRole("button", { name: "発送を申請する" }).click();
  await expect(page.getByRole("heading", { name: /発送詳細/ })).toBeVisible();
});

test("result page links every card to its recording timestamp; video page lets overlays be turned off", async ({ page }) => {
  await page.goto("/l/L0001/result");
  const link = page.getByRole("link", { name: /▶ \d\d:\d\d:\d\d/ }).first();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page.getByLabel("元映像のみ表示")).toBeVisible(); // UR6
});
