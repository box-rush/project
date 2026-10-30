import { expect, test } from "@playwright/test";
import { totp } from "../../packages/services/src/staffAuth";

const ADMIN = process.env.E2E_ADMIN_URL ?? "http://localhost:3101";
const PAGES = [
  "/merchant/lotteries", "/merchant/lotteries/new", "/merchant/intake", "/ops/dashboard", "/ops/review", "/ops/schedule", "/ops/pricing",
  "/ops/products", "/ops/checklists", "/ops/banners", "/ops/coupons", "/station", "/ops/attribution", "/ops/warehouse", "/ops/intake",
  "/ops/inventory", "/ops/procurement", "/ops/tickets", "/ops/arbitration", "/ops/finance", "/ops/risk", "/ops/audit", "/ops/monitoring",
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
});
