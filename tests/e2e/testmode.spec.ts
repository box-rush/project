import { expect, test } from "@playwright/test";

/**
 * Staging test mode (BOXRUSH_TEST_MODE=1): the main purchase flow with no external account — the SMS code is read
 * from the screen, the payment is the built-in test payment. Runs only against a test-mode server:
 *   E2E_TEST_MODE=1 E2E_BASE_URL=https://<staging> npx playwright test tests/e2e/testmode.spec.ts
 */
test.skip(process.env.E2E_TEST_MODE !== "1", "needs a server started with BOXRUSH_TEST_MODE=1");

test("test mode: banner, SMS code on screen, test payment", async ({ page }) => {
  const id = Date.now().toString().slice(-8);
  await page.goto("/login?mode=signup");
  await expect(page.getByTestId("test-mode-banner")).toBeVisible();
  await page.getByLabel("ニックネーム").fill(`tm${id}`);
  await page.getByLabel("メールアドレス").fill(`tm${id}@example.com`);
  await page.getByLabel("パスワード").fill("e2e-password-1");
  await page.getByRole("button", { name: "新規登録" }).click();

  await expect(page.getByRole("heading", { name: "SMS認証" })).toBeVisible();
  await page.getByLabel("携帯電話番号").fill(`070${id}`);
  await page.getByRole("button", { name: "認証コードを送る" }).click();
  const shown = page.getByTestId("test-sms-code");
  await expect(shown).toBeVisible();
  const code = (await shown.innerText()).match(/\d{6}/)![0];
  await page.getByLabel("認証コード（6桁）").fill(code);
  await page.getByRole("button", { name: "認証する" }).click();
  await expect(page.getByRole("heading", { name: "はじめての方へ" })).toBeVisible();
  await page.getByRole("button", { name: "はじめる" }).click();

  await page.goto("/");
  await page.getByRole("link", { name: /1BOX（\d+枠）/ }).first().click();
  await page.getByRole("button", { name: "枠を購入する" }).click();
  await expect(page.getByRole("heading", { name: "購入内容の確認" })).toBeVisible();
  await page.getByRole("button", { name: /テスト決済で支払う/ }).click();
  await expect(page.getByRole("heading", { name: "購入が完了しました" })).toBeVisible();
});
