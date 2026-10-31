import type { ChildProcess } from "node:child_process";
import { expect, test } from "@playwright/test";
import { consumerPage, database, readyLottery, staffPage, startWorker, stopWorker } from "./helpers";

/**
 * Exception paths through the UI (§8.4.4): X7 recording loss with the two-person abort, X4 seal anomaly,
 * X6 delay notice, and a review rejection round-trip. Lotteries start READY from the e2e fixture.
 */
const { q, lotteryStatus, end } = database();
let worker: ChildProcess | undefined;

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);
test.use({ actionTimeout: 15_000 });
test.beforeAll(() => {
  worker = startWorker(); // refunds are executed by the job queue
});
test.afterAll(async () => {
  stopWorker(worker);
  await end();
});

test("X7: cloud-only outage continues; both paths down freezes the station until a second person aborts; buyers are refunded", async ({ browser }) => {
  const { lotteryId, code } = readyLottery([
    { email: "user14@boxrush.local", count: 2 },
    { email: "user13@boxrush.local", count: 1 },
  ]);
  const slot1 = (await q<{ n: string[] }>("SELECT assigned_numbers AS n FROM slots WHERE lottery_id = $1 ORDER BY purchase_seq LIMIT 1", [lotteryId]))[0]!.n[0]!;

  const st = await staffPage(browser, "station@boxrush.local");
  await st.goto(`/station/${lotteryId}`);
  await st.getByTestId("start-opening").click();
  await expect(st.getByRole("button", { name: "封印クローズアップ" })).toBeVisible();

  // cloud down only → warning, entry continues (PD19)
  await st.getByRole("button", { name: "クラウド断" }).click();
  await expect(st.getByText("クラウド送信が中断しています（ローカル録画は継続中）", { exact: false })).toBeVisible();
  await st.getByLabel("カード番号").fill(slot1);
  await st.getByTestId("enter-card").click();
  await expect(st.getByText("枠 1").first()).toBeVisible();
  await st.getByRole("button", { name: "クラウド復旧" }).click();
  await expect(st.getByText("クラウド送信が中断しています", { exact: false })).toHaveCount(0);

  // both down → the station is frozen; the reporter cannot confirm their own report
  await st.getByRole("button", { name: "両系統断" }).click();
  await expect(st.getByText("録画が両系統とも途切れたと報告されました")).toBeVisible();
  await expect(st.getByTestId("enter-card")).toHaveCount(0);
  await st.getByRole("button", { name: "中止を確認する（別の担当者）" }).click();
  await expect(st.locator("p[role=alert]")).toContainText("自分の提案・下書きを自分で承認することはできません");
  expect(await lotteryStatus(lotteryId)).toBe("OPENING");

  // a reviewer confirms → ABORTED, full refunds
  // the reporter sees their own report as waiting; a reviewer finds it on the review queue and confirms
  await st.goto("/station");
  await expect(st.getByTestId("pending-aborts")).toContainText("あなたの報告（別の担当者の確認待ち）");
  const rev = await staffPage(browser, "reviewer@boxrush.local");
  await rev.goto("/ops/review");
  await rev.getByTestId("pending-aborts").getByRole("link", { name: "確認する" }).click();
  await rev.getByRole("button", { name: "中止を確認する（別の担当者）" }).click();
  await expect.poll(() => lotteryStatus(lotteryId)).toBe("ABORTED");
  await expect.poll(async () => (await q("SELECT 1 FROM refunds r JOIN orders o ON o.id = r.order_id WHERE o.lottery_id = $1 AND r.status = 'SUCCEEDED'", [lotteryId])).length, { timeout: 60_000 }).toBe(2);

  // the buyer sees the abort, the refund and a notification
  const u = await consumerPage(browser, "user14@boxrush.local");
  await u.goto(`/l/${code}`);
  await expect(u.getByText("この回は中止となりました（録画の中断）。お支払い額は全額返金します。")).toBeVisible();
  await u.goto("/orders");
  await expect(u.getByText(/返金 ¥[\d,]+（完了）/).first()).toBeVisible();
  await u.goto("/notifications");
  await expect(u.locator("main")).toContainText("中止");
});

test("X4: a seal anomaly before opening aborts and refunds; the reason is public", async ({ browser }) => {
  const { lotteryId, code } = readyLottery([{ email: "user11@boxrush.local", count: 2 }]);
  const st = await staffPage(browser, "station@boxrush.local");
  await st.goto(`/station/${lotteryId}`);
  await st.getByRole("button", { name: "封印異常のため中止" }).click();
  await expect.poll(() => lotteryStatus(lotteryId)).toBe("ABORTED");
  expect((await q<{ r: string }>("SELECT abort_reason AS r FROM lotteries WHERE id = $1", [lotteryId]))[0]!.r).toBe("SEAL_ANOMALY");
  const pub = await (await browser.newContext({ locale: "ja-JP" })).newPage();
  await pub.goto(`/l/${code}`);
  await expect(pub.getByText("この回は中止となりました（封緘の異常）", { exact: false })).toBeVisible();
});

test("X6: ops posts a delay; buyers see the new time and reason; the refund grace still counts from the promise", async ({ browser }) => {
  const { lotteryId, code } = readyLottery([{ email: "user10@boxrush.local", count: 2 }], { openInMinutes: 60 });
  const ops = await staffPage(browser, "reviewer@boxrush.local");
  await ops.goto("/ops/schedule");
  await expect(ops.getByText("遅延を公開しても、返金を選べる猶予（約束時刻から24時間）は動きません。")).toBeVisible();
  const target = ops.getByRole("row").filter({ hasText: code });
  await target.getByText("遅延を公開").click();
  const at = new Date(Date.now() + 3 * 3600_000 + 9 * 3600_000).toISOString().slice(0, 16);
  await target.getByLabel("新しい開封日時").fill(at);
  await target.getByLabel("理由").fill("配送遅延のため");
  await target.getByRole("button", { name: "公開する" }).click();
  await expect.poll(async () => (await q<{ d: string | null }>("SELECT delay_notice AS d FROM lotteries WHERE id = $1", [lotteryId]))[0]!.d).not.toBeNull();
  const u = await consumerPage(browser, "user10@boxrush.local");
  await u.goto(`/l/${code}`);
  await expect(u.getByText("開封延期のお知らせ")).toBeVisible();
  await expect(u.getByText("理由：配送遅延のため")).toBeVisible();
});

test("F20.1 / F15.8: reviewer rejects with a reason; merchant sees it, fixes and resubmits; approval puts it on sale", async ({ browser }) => {
  const { lotteryId } = readyLottery([{ email: "user9@boxrush.local", count: 2 }], { stage: "PENDING_REVIEW" });
  const rev = await staffPage(browser, "reviewer@boxrush.local");
  await rev.goto(`/ops/review/${lotteryId}`);
  await rev.locator("textarea[name=reason]").fill("タイトルに BOX 数を明記してください");
  await rev.getByRole("button", { name: "差し戻す" }).click();
  await expect.poll(() => lotteryStatus(lotteryId)).toBe("REJECTED");

  const mer = await staffPage(browser, "merchant@boxrush.local");
  // the merchant has no access to the review screen (G1: no self-approval)
  await mer.goto(`/ops/review/${lotteryId}`);
  await expect(mer.getByRole("button", { name: "承認して販売開始" })).toHaveCount(0);
  await mer.goto(`/merchant/lotteries/${lotteryId}`);
  await expect(mer.getByText("差し戻し理由：タイトルに BOX 数を明記してください")).toBeVisible();
  await mer.getByLabel("タイトル").fill(`E2E 差し戻し後 1BOX ${Date.now().toString(36)}`);
  await mer.getByRole("button", { name: /確認/ }).first().click();
  await expect(mer.getByText("すべてOK")).toBeVisible();
  await mer.getByTestId("submit-review").click();
  await expect.poll(() => lotteryStatus(lotteryId)).toBe("PENDING_REVIEW");

  await rev.goto(`/ops/review/${lotteryId}`);
  await rev.getByRole("button", { name: "承認して販売開始" }).click();
  await expect.poll(() => lotteryStatus(lotteryId)).toBe("ON_SALE");
});
