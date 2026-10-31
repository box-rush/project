import { expect, test } from "@playwright/test";
import { FORBIDDEN, THROTTLED, consumerPage, database, readyLottery, staffPage } from "./helpers";

/**
 * Consumer-side P0 functions through the UI that the main-flow tests do not reach (§8.13):
 * consumer protection (F2.1), voucher codes (F9.10 / CP), appeals and CS (F8.6 / F12.3 / F23.1 / X10),
 * account deletion guards (F1.6 / X15), notification settings (F1.5), discovery and trust pages
 * (F3.1 / F3.2 / F3.5 / F3.9 / F4.3 / F8.4 / F12.1 / F12.2 / F1.8 / F1.9).
 */
const { q, end } = database();
test.afterAll(async () => end());
test.use({ actionTimeout: 15_000 });

test("F2.1: lowering a limit applies at once and blocks an order above it; raising waits 72h", async ({ browser }) => {
  const { code } = readyLottery([], { stage: "ON_SALE", slots: 6, slotPrice: 2000 });
  const u = await consumerPage(browser, "user8@boxrush.local");
  await u.goto("/limits");
  await u.getByRole("group", { name: "1回の上限" }).getByRole("button", { name: "¥5,000" }).click();
  await u.getByRole("button", { name: "保存" }).click();
  await expect(u.getByText("保存しました")).toBeVisible();
  await expect(u.getByRole("group", { name: "1回の上限" }).getByRole("button", { name: "¥5,000" })).toHaveAttribute("aria-pressed", "true");

  await u.goto(`/l/${code}`);
  await u.getByRole("radio", { name: "3枠" }).click(); // ¥6,000 > ¥5,000
  await u.getByRole("button", { name: "枠を購入する" }).click();
  await expect(u.getByText("1回の利用上限（¥5,000）を超えます")).toBeVisible();
  expect((await q("SELECT 1 FROM orders o JOIN users us ON us.id = o.user_id JOIN lotteries l ON l.id = o.lottery_id WHERE us.email = 'user8@boxrush.local' AND l.code = $1", [Number(code.slice(1))])).length).toBe(0);

  await u.goto("/limits");
  await u.getByRole("group", { name: "月の上限" }).getByRole("button", { name: "¥100,000" }).click();
  await u.getByRole("button", { name: "保存" }).click();
  await expect(u.getByText(/に ¥100,000 へ引き上げ予定/)).toBeVisible(); // PD11: raise takes effect after 72h
});

test("F9.10 / CP: a voucher code is redeemed once per account; coupons only cover shipping", async ({ browser }) => {
  const u = await consumerPage(browser, "user7@boxrush.local");
  await u.goto("/coupons");
  await expect(u.getByText("クーポンは送料にのみ使えます。購入・譲渡・換金はできません。", { exact: false })).toBeVisible();
  const before = await u.getByText("送料無料クーポン").count();
  await u.getByLabel("コードを入力").fill("welcome2026");
  await u.getByRole("button", { name: "登録" }).click();
  await expect(u.getByText("クーポンを登録しました")).toBeVisible();
  await expect(u.getByText("送料無料クーポン")).toHaveCount(before + 1);
  await u.getByLabel("コードを入力").fill("WELCOME2026");
  await u.getByRole("button", { name: "登録" }).click();
  await expect(u.getByText("このコードは登録済みです")).toBeVisible();
  await u.getByLabel("コードを入力").fill("NO-SUCH-CODE");
  await u.getByRole("button", { name: "登録" }).click();
  await expect(u.getByText("コードが無効です")).toBeVisible();
  expect(await u.locator("body").innerText()).not.toMatch(FORBIDDEN);
});

test("F8.6 / X10: an appeal from the result page freezes that slot's cards; CS sees and answers it", async ({ browser }) => {
  const u = await consumerPage(browser, "user1@boxrush.local");
  await u.goto("/l/L0001/result");
  await u.getByRole("link", { name: "申し立てる" }).click();
  await expect(u.getByRole("heading", { name: "振り分けへの申し立て" })).toBeVisible();
  await expect(u.getByText("申し立て中は、その枠のカードの発送を一時停止します。")).toBeVisible();
  const subject = `振り分けの確認 ${Date.now().toString(36)}`;
  await u.getByLabel("件名").fill(subject);
  await u.getByLabel("内容").fill("録画 00:01:10 のカードが自分の枠に入っていないように見えます。");
  await u.getByRole("button", { name: "送信する" }).click();
  await u.waitForURL(/\/support\/[^/]+$/);
  await expect(u.getByText(subject)).toBeVisible();
  await u.goto("/collection");
  await expect(u.getByText("申し立て中").first()).toBeVisible();

  // CS / arbitration (F23.2 / F23.3): the evidence is side by side; the ruling unfreezes and compensates
  const cs = await staffPage(browser, "cs@boxrush.local");
  await cs.goto("/ops/arbitration");
  await cs.getByRole("row", { name: new RegExp(subject) }).getByRole("link").first().click();
  await expect(cs.getByRole("heading", { name: "この枠のカード" })).toBeVisible();
  await expect(cs.getByText("振り分けの修正はこの画面ではできません。")).toBeVisible();
  await cs.getByLabel("維持し、お詫びの送料無料クーポンを付与").check();
  await cs.getByLabel("ユーザーへの説明").fill("録画を確認し、振り分けは正しいことを確認しました。お詫びのクーポンをお送りします。");
  await cs.getByRole("button", { name: "裁定する" }).click();
  await expect.poll(async () => (await q<{ s: string }>("SELECT status AS s FROM tickets WHERE subject = $1", [subject]))[0]!.s).toBe("RESOLVED");
  await u.goto("/collection");
  await expect(u.getByText("申し立て中")).toHaveCount(0);
  await u.goto("/coupons");
  await expect(u.getByText("送料無料クーポン").first()).toBeVisible();
});

test("F1.6 / X15: leaving is blocked while cards are stored (never cashed out) or a lottery is in progress", async ({ browser }) => {
  const u = await consumerPage(browser, "user2@boxrush.local");
  await u.goto("/delete-account");
  await expect(u.getByText(/保管中のカードが \d+ 点あります。発送するか、放棄してから退会してください（換金はできません）。/)).toBeVisible();
  await expect(u.getByRole("button", { name: "退会する" })).toBeDisabled(); // stored cards: ship or explicitly abandon first
  await u.getByLabel("保管中のカードを放棄して退会する").check();
  await u.getByRole("button", { name: "退会する" }).click();
  await expect(u.getByText("進行中の回があるため退会できません")).toBeVisible(); // user2 also holds a slot in an on-sale lottery
  expect((await q("SELECT 1 FROM users WHERE email = 'user2@boxrush.local'")).length).toBe(1);
});

test("F1.5: fulfilment notices cannot be turned off; marketing can", async ({ browser }) => {
  const u = await consumerPage(browser, "user3@boxrush.local");
  await u.goto("/notifications");
  await expect(u.getByLabel("購入・開封・発送のお知らせ（オフにできません）")).toBeDisabled();
  await expect(u.getByLabel("購入・開封・発送のお知らせ（オフにできません）")).toBeChecked();
  const marketing = u.getByLabel("おすすめ・キャンペーン");
  const was = await marketing.isChecked();
  await marketing.setChecked(!was);
  await expect.poll(async () => (await q<{ m: boolean }>("SELECT notify_marketing AS m FROM users WHERE email = 'user3@boxrush.local'"))[0]!.m).toBe(!was);
});

test("discovery and trust pages: tabs, sort, entry zone, banners, rules, algorithm script, help, legal", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("はじめての方へ：満員になってから開封します")).toBeVisible(); // F3.9 banner
  await expect(page.getByText("入門（低単価）")).toBeVisible(); // F3.5
  await expect(page.getByText("蒼き航路 1BOX 入門30枠").first()).toBeVisible();
  expect(await page.locator("body").innerText()).not.toMatch(FORBIDDEN);
  // F3.1 category tab narrows the list; F3.2 sort keeps it
  await page.getByRole("tab", { name: "ワンピース" }).click();
  await expect(page.getByRole("tab", { name: "ワンピース" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("蒼き航路").first()).toBeVisible();
  await expect(page.getByRole("link", { name: /星海のきらめき 2BOX/ })).toHaveCount(0); // on-sale list is filtered (recent results are not)
  await page.getByRole("link", { name: "単価" }).first().click();
  await expect(page).toHaveURL(/sort=price/);
  await expect(page.getByText("蒼き航路").first()).toBeVisible();

  // F4.3 / F4.12 rules page: full checklist and the frozen fallback rule
  await page.goto("/l/L0001/rules");
  await expect(page.getByText("001/066").first()).toBeVisible();
  await expect(page.getByText("収録リストにないカード", { exact: false }).first()).toBeVisible();

  // F8.4 algorithm page offers the reference script
  await page.goto("/verify/algorithm");
  const script = await page.request.get("/bx_shuffle_v1.py");
  expect(script.ok()).toBe(true);
  expect(await script.text()).toContain("def ");

  // F12.1 / F12.2 help, F1.8 / F1.9 legal
  await page.goto("/help");
  await expect(page.getByText("満員にならなかったらどうなりますか？")).toBeVisible();
  await expect(page.getByText("販売開始前に抽選シードのハッシュを公開します（後から変えられません）。")).toBeVisible();
  await page.goto("/legal");
  await expect(page.getByText("未成年の方は、法定代理人の同意を得てからご利用ください。")).toBeVisible();
  await expect(page.getByText("※ 文面は確定前のドラフトです（法務確認中）。").first()).toBeVisible();
});

test("F1.1: repeated sign-ins are throttled with an honest message (not \"wrong password\")", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill("user5@boxrush.local");
  await page.getByLabel("パスワード").fill("wrong-password-1");
  for (let i = 0; i < 5; i++) {
    await page.getByRole("button", { name: "ログイン", exact: true }).click();
    await expect(page.getByRole("button", { name: "ログイン", exact: true })).toBeEnabled();
  }
  await expect(page.getByText(THROTTLED)).toBeVisible();
  await expect(page.getByText("メールアドレスまたはパスワードが違います")).toHaveCount(0);
  await page.waitForTimeout(10_500); // let the window pass for the next tests
});
