import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { totp } from "../../packages/services/src/staffAuth";

/**
 * Functional test of the whole first-release chain through the real UIs (§8.4.1), no service calls:
 * intake → merchant wizard → review → consumers buy every slot → draw (worker) → station opening with
 * device-posted recording segments → two-person attribution → put-away → shipping request → pack → ship →
 * delivered → COMPLETED, then the public verification page recomputes the draw.
 */
const WEB = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const ADMIN = process.env.E2E_ADMIN_URL ?? "http://localhost:3101";
const DB = process.env.DATABASE_URL ?? "postgres://boxrush:boxrush@localhost:5432/boxrush";
const RUN = Date.now().toString(36).toUpperCase();

let db: pg.Client;
let worker: ChildProcess | undefined;
const q = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows as T[];

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);
test.use({ actionTimeout: 15_000 });

test.beforeAll(async () => {
  db = new pg.Client({ connectionString: DB });
  await db.connect();
  // T13: the draw and every timed step run in the worker, exactly as in production
  worker = spawn("pnpm", ["--filter", "@boxrush/services", "worker"], { stdio: "ignore", env: { ...process.env, RNG_SEED_KEY: process.env.RNG_SEED_KEY ?? "00".repeat(32), RNG_DATABASE_URL: process.env.RNG_DATABASE_URL ?? DB }, detached: true });
});

test.afterAll(async () => {
  if (worker?.pid) process.kill(-worker.pid, "SIGTERM");
  await db?.end();
});

async function staffPage(browser: Browser, email: string) {
  const page = await (await browser.newContext({ baseURL: ADMIN, locale: "ja-JP", timezoneId: "Asia/Tokyo" })).newPage();
  page.on("dialog", (d) => d.accept());
  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("パスワード").fill("boxrush-dev");
  await page.getByRole("button", { name: "次へ" }).click();
  await page.getByLabel("認証コード（6桁）").fill(totp("JBSWY3DPEHPK3PXP", new Date()));
  await page.getByRole("button", { name: "ログイン" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  return page;
}

async function consumerPage(browser: Browser, email: string) {
  const page = await (await browser.newContext({ baseURL: WEB, locale: "ja-JP", timezoneId: "Asia/Tokyo" })).newPage();
  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("パスワード").fill("boxrush-demo");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  return page;
}

/** datetime-local value in JST, `minutes` from now. */
function jstLocal(minutes: number) {
  const d = new Date(Date.now() + minutes * 60_000 + 9 * 3600_000);
  return d.toISOString().slice(0, 16);
}

const saved = async (page: Page) => {
  await expect(page.locator("p[role=status], p[role=alert]").first()).toBeVisible();
  const errs = await page.locator("p[role=alert]").allInnerTexts();
  expect(errs, page.url()).toEqual([]);
};

test("full chain through the UI: intake → listing → sale → draw → opening → attribution → shipping → completed", async ({ browser }) => {
  const product = (await q<{ id: string; series: string }>("SELECT id, series FROM products WHERE series LIKE '%星海のきらめき%' LIMIT 1"))[0]!;
  const boxLabel = `BX-E2E-${RUN}`;

  // 1. Warehouse intake (O05): one sealed box + 3 guarantee cards, all passing inspection
  const wh = await staffPage(browser, "warehouse@boxrush.local");
  await wh.goto("/ops/intake");
  const receive = async (kind: "未開封商品" | "保証カード", label: string) => {
    await wh.getByText(kind, { exact: true }).click();
    if (kind === "未開封商品") await wh.locator("select[name=productId]").selectOption(product.id);
    else {
      await wh.getByLabel("カード名").fill(`E2E保証カード ${RUN}`);
      await wh.getByLabel("レアリティ").fill("PR");
      await wh.getByLabel("参考価格").fill("300");
    }
    await wh.getByLabel("ラベル（バーコード）").fill(label);
    await wh.getByRole("textbox", { name: /写真URL/ }).fill("https://example.com/seal.jpg");
    await wh.getByText("合格", { exact: true }).click();
    await wh.getByRole("button", { name: "記録する" }).click();
    await expect.poll(async () => (await q("SELECT 1 FROM inventory_units WHERE label = $1 AND inspected_at IS NOT NULL AND reject_reason IS NULL", [label])).length).toBe(1);
  };
  await receive("未開封商品", boxLabel);
  for (let i = 1; i <= 3; i++) await receive("保証カード", `GC-E2E-${RUN}-${i}`);

  // 2. Merchant wizard (B04 / UI-13): live SV1 validation must pass before submit
  const mer = await staffPage(browser, "merchant@boxrush.local");
  await mer.goto("/merchant/lotteries/new");
  const title = `E2E 全工程 ${RUN}`;
  await mer.getByLabel("タイトル").fill(title);
  await mer.getByLabel("対象商品").selectOption(product.id);
  await mer.getByLabel(new RegExp(boxLabel)).check();
  await mer.getByRole("button", { name: /カードリスト/ }).click();
  await mer.getByLabel("リスト外カードの扱い").fill("収録リストにないカードは、直前に開封されたカードと同じ枠に振り分けます。");
  await mer.getByRole("button", { name: /保証カード/ }).first().click();
  for (let i = 1; i <= 3; i++) await mer.getByLabel(new RegExp(`GC-E2E-${RUN}-${i}`)).check();
  await mer.getByRole("button", { name: /販売設定/ }).click();
  await mer.getByLabel("枠数").fill("4");
  await mer.getByLabel("1枠価格（税込）").fill("1700");
  await mer.getByLabel("1人あたりの上限").fill("2");
  await mer.getByLabel("販売開始").fill(jstLocal(-1));
  await mer.getByLabel("販売終了").fill(jstLocal(5));
  await mer.getByRole("button", { name: /開封日時/ }).first().click();
  await mer.getByLabel("開封日時").fill(jstLocal(10));
  await mer.getByRole("button", { name: /確認/ }).first().click();
  await expect(mer.getByText("すべてOK")).toBeVisible();
  await mer.getByTestId("submit-review").click();
  await mer.waitForURL((u) => /^\/merchant\/lotteries\/(?!new$)[^/]+$/.test(u.pathname));
  const lotteryId = mer.url().split("/").pop()!;
  expect((await q<{ status: string }>("SELECT status FROM lotteries WHERE id = $1", [lotteryId]))[0]!.status).toBe("PENDING_REVIEW");
  // the merchant console never offers a draw trigger, a video upload or post-listing edits (I4 / I5)
  await expect(mer.locator("body")).not.toContainText(/抽選を実行|動画をアップロード/);

  // 3. Review (O07): a different person approves; the snapshot and the seed commitment are frozen
  const rev = await staffPage(browser, "reviewer@boxrush.local");
  await rev.goto(`/ops/review/${lotteryId}`);
  await expect(rev.getByText("すべての制約を満たしています")).toBeVisible();
  await rev.getByRole("button", { name: "承認して販売開始" }).click();
  await expect.poll(async () => (await q<{ status: string }>("SELECT status FROM lotteries WHERE id = $1", [lotteryId]))[0]!.status).toBe("ON_SALE");
  const { code, seed_commit } = (await q<{ code: string; seed_commit: string }>("SELECT code, seed_commit FROM lotteries WHERE id = $1", [lotteryId]))[0]!;
  expect(seed_commit).toMatch(/^[0-9a-f]{64}$/);

  // 4. Two consumers buy all 4 slots (2 each, the per-user limit); the 4th slot locks the lottery
  for (const email of ["user12@boxrush.local", "user13@boxrush.local"]) {
    const c = await consumerPage(browser, email);
    await c.goto(`/l/${code}`);
    await expect(c.getByRole("button", { name: `${seed_commit.slice(0, 6)}…${seed_commit.slice(-6)}` })).toBeVisible(); // UR5: commitment before buying
    await expect(c.getByText("入庫済み 3 枚（必要数 3 枚）")).toBeVisible(); // I1 guarantee stock shown
    await c.getByRole("radio", { name: "2枠" }).click();
    await c.getByRole("button", { name: "枠を購入する" }).click();
    await expect(c.getByRole("heading", { name: "購入内容の確認" })).toBeVisible();
    await c.getByRole("button", { name: "テスト決済で支払う（開発環境）" }).click();
    await expect(c.getByRole("heading", { name: "購入が完了しました" })).toBeVisible();
    await c.context().close();
  }

  // 5. Draw (worker): LOCKED → READY with the seed revealed and slots assigned
  await expect
    .poll(async () => (await q<{ status: string }>("SELECT status FROM lotteries WHERE id = $1", [lotteryId]))[0]!.status, { timeout: 90_000, intervals: [1000] })
    .toBe("READY");
  const slotRows = await q<{ purchase_seq: number; assigned_numbers: string[] }>(
    "SELECT purchase_seq, assigned_numbers FROM slots WHERE lottery_id = $1 ORDER BY purchase_seq",
    [lotteryId],
  );
  expect(slotRows).toHaveLength(4);

  // 6. Admin registers the station camera (SV4); the token is shown once
  const adm = await staffPage(browser, "admin@boxrush.local");
  await adm.goto("/ops/monitoring");
  await adm.getByLabel("ステーションID").fill("ST-01");
  await adm.getByLabel("名称").fill(`IVS ${RUN}`);
  await adm.getByRole("button", { name: "デバイスを登録" }).click();
  const token = (await adm.getByTestId("device-token").innerText()).trim();
  expect(token).toMatch(/^bxd_/);

  // 7. Station opening (O11 / UI-14)
  const st = await staffPage(browser, "station@boxrush.local");
  await st.goto(`/station/${lotteryId}`);
  await st.getByTestId("start-opening").click();
  await expect(st.getByRole("button", { name: "封印クローズアップ" })).toBeVisible();
  // the capture device posts segments (cloud + local backfill); a forged token is rejected
  const seg = (source: "CLOUD" | "LOCAL", seq: number) => ({
    lotteryId, source, seq, startedAt: new Date().toISOString(), endedAt: new Date(Date.now() + 60_000).toISOString(),
    sha256: createHash("sha256").update(`${RUN}-${source}-${seq}`).digest("hex"), uri: `s3://boxrush-recordings/${lotteryId}/${source}-${seq}.ts`,
  });
  const post = (body: unknown, tok = token) => st.request.post(`${ADMIN}/api/devices/segments`, { data: body, headers: { authorization: `Bearer ${tok}` } });
  expect((await post(seg("CLOUD", 1))).status()).toBe(201);
  expect((await post(seg("CLOUD", 1))).status()).toBe(201); // retry is idempotent
  expect((await post(seg("LOCAL", 1))).status()).toBe(201);
  expect((await post(seg("CLOUD", 2), "bxd_forged")).status()).toBe(401);
  expect((await post({ ...seg("CLOUD", 1), sha256: "f".repeat(64) })).status()).toBe(409);

  await st.getByRole("button", { name: "封印クローズアップ" }).click();
  await expect(st.getByText("封印クローズアップ済み")).toBeVisible();
  await st.getByRole("button", { name: "次のパック" }).click();
  const enter = async (raw: string) => {
    await st.getByLabel("カード番号").fill(raw);
    await st.getByTestId("enter-card").click();
  };
  // cards for slot 1 and slot 2 only → slots 3 and 4 get guarantee cards (PD18)
  const s1 = slotRows[0]!.assigned_numbers[0]!;
  const s2 = slotRows[1]!.assigned_numbers[0]!;
  await enter(s1);
  await expect(st.getByText("枠 1").first()).toBeVisible();
  await enter(s2);
  await expect(st.getByText("枠 2").first()).toBeVisible();
  // an off-list card goes to two-person attribution
  await enter("PROMO-E2E");
  await expect(st.getByText("収録リストにありません", { exact: false })).toBeVisible();
  await st.getByLabel("カード名", { exact: true }).fill("エラーカード");
  await st.getByLabel("レアリティ").fill("C");
  await st.getByRole("button", { name: "リスト外として登録" }).click();
  await expect(st.getByText("リスト外カードとして登録しました", { exact: false })).toBeVisible();
  await st.getByRole("button", { name: "開封完了" }).click();
  await expect(st.getByText("開封が完了しました")).toBeVisible();
  expect((await q<{ status: string }>("SELECT status FROM lotteries WHERE id = $1", [lotteryId]))[0]!.status).toBe("ATTRIBUTING");

  // 8. Attribution (O12): one person proposes, another confirms; then finalize writes the opening record
  const a1 = await staffPage(browser, "attr1@boxrush.local");
  await a1.goto(`/ops/attribution/${lotteryId}`);
  const offRow = a1.getByRole("row", { name: /PROMO-E2E/ });
  await offRow.getByText("枠を割り当てる").click();
  await offRow.getByLabel("枠", { exact: true }).selectOption("2");
  await offRow.getByLabel("根拠（録画で確認した内容）").fill("フォールバック規則により直前のカードと同じ枠");
  await offRow.getByRole("button", { name: "この枠に割り当て" }).click();
  await saved(a1);
  await expect(a1.getByRole("button", { name: "承認する" })).toHaveCount(1); // shown, but self-approval is refused
  await a1.getByRole("button", { name: "承認する" }).click();
  await expect(a1.locator("p[role=alert]")).toHaveText("自分の提案・下書きを自分で承認することはできません。別の担当者が承認してください");

  const a2 = await staffPage(browser, "attr2@boxrush.local");
  await a2.goto(`/ops/attribution/${lotteryId}`);
  await a2.getByRole("button", { name: "承認する" }).click();
  await expect
    .poll(async () => (await q<{ status: string; slot: number; by: string }>("SELECT status, slot_number AS slot, confirmed_by AS by FROM opened_cards WHERE lottery_id = $1 AND off_list", [lotteryId]))[0])
    .toMatchObject({ status: "CONFIRMED", slot: 2 });
  await a2.getByRole("button", { name: "すべて確定して記録を生成" }).click();
  await expect.poll(async () => (await q<{ status: string }>("SELECT status FROM lotteries WHERE id = $1", [lotteryId]))[0]!.status).toBe("ATTRIBUTED");
  const awarded = await q<{ g: boolean }>("SELECT guarantee_awarded AS g FROM slots WHERE lottery_id = $1 ORDER BY purchase_seq", [lotteryId]);
  expect(awarded.map((r) => r.g)).toEqual([false, false, true, true]);

  // 9. Put-away (O13) → FULFILLING
  await wh.goto("/ops/warehouse");
  await wh.getByRole("row", { name: new RegExp(code) }).getByRole("button", { name: "棚入れ" }).click();
  await expect.poll(async () => (await q<{ status: string }>("SELECT status FROM lotteries WHERE id = $1", [lotteryId]))[0]!.status).toBe("FULFILLING");

  // 10–11. Each buyer sees the result, adds an address, requests one consolidated parcel and pays the fee (PD13);
  // the warehouse picks → scans every item → packs → ships with tracking → delivered; the buyer sees the tracking number
  const shipStatus = async (id: string) => (await q<{ status: string }>("SELECT status FROM shipments WHERE id = $1", [id]))[0]!.status;
  for (const [i, email] of ["user12@boxrush.local", "user13@boxrush.local"].entries()) {
    const u = await consumerPage(browser, email);
    await u.goto(`/l/${code}/result`);
    await expect(u.getByText("保証カード進呈").first()).toBeVisible();
    await u.goto("/addresses");
    await u.getByLabel("お名前").fill(`佐藤 ${RUN}${i}`);
    await u.getByLabel("郵便番号").fill("530-0001");
    await u.getByLabel("都道府県").fill("大阪府");
    await u.getByLabel("市区町村").fill("大阪市北区梅田");
    await u.getByLabel("番地").fill("1-1-1");
    await u.getByLabel("電話番号").fill("0612345678");
    await u.getByRole("button", { name: "追加する" }).click();
    await expect(u.getByText(`佐藤 ${RUN}${i}`)).toBeVisible();
    await u.goto("/collection");
    const boxes = u.getByRole("checkbox", { name: "選択" });
    await expect(boxes.first()).toBeVisible();
    const n = await boxes.count();
    for (let k = 0; k < n; k++) await boxes.nth(k).check();
    await u.getByRole("button", { name: "まとめて発送" }).click();
    await expect(u.getByRole("heading", { name: "発送申請" })).toBeVisible();
    await u.getByRole("button", { name: "発送を申請する" }).click();
    const pay = u.getByRole("button", { name: "テスト決済で支払う（開発環境）" });
    await pay.or(u.getByRole("heading", { name: /発送詳細/ })).first().waitFor();
    if (await pay.isVisible()) await pay.click();
    await expect(u.getByRole("heading", { name: /発送詳細/ })).toBeVisible();

    const shipment = (await q<{ id: string; code: string }>("SELECT id, code FROM shipments WHERE user_id = (SELECT id FROM users WHERE email = $1) ORDER BY requested_at DESC LIMIT 1", [email]))[0]!;
    await expect.poll(() => shipStatus(shipment.id)).toBe("REQUESTED");
    await wh.goto("/ops/warehouse?tab=req");
    await wh.getByRole("row", { name: new RegExp(shipment.code) }).getByRole("button", { name: "ピッキング開始" }).click();
    await expect.poll(() => shipStatus(shipment.id)).toBe("PICKING");
    await wh.goto("/ops/warehouse?tab=pack");
    const scan = wh.getByLabel("スキャン（Enterで1件）");
    await scan.fill("NOT-IN-PARCEL");
    await scan.press("Enter");
    await expect(wh.getByText("NOT-IN-PARCEL はこの荷物に含まれていません")).toBeVisible();
    for (const c of await q<{ id: string }>("SELECT id FROM collection_items WHERE shipment_id = $1", [shipment.id])) {
      await scan.fill(c.id);
      await scan.press("Enter");
    }
    await wh.getByRole("button", { name: "梱包完了" }).click();
    await expect.poll(() => shipStatus(shipment.id)).toBe("PACKED");
    await wh.goto("/ops/warehouse?tab=pack");
    const tracking = `1234-5678-90${i}${i}`;
    await wh.getByLabel("追跡番号").fill(tracking);
    await wh.getByRole("button", { name: "出荷する" }).click();
    await expect.poll(() => shipStatus(shipment.id)).toBe("SHIPPED");
    await u.goto(`/shipments/${shipment.id}`);
    await expect(u.getByText(tracking)).toBeVisible(); // F9.4
    await wh.goto("/ops/warehouse?tab=out");
    await wh.getByRole("row", { name: new RegExp(shipment.code) }).getByRole("button", { name: "配達完了にする" }).click();
    await expect.poll(() => shipStatus(shipment.id)).toBe("DELIVERED");
    await u.context().close();
  }
  // every card delivered → the lottery is COMPLETED
  await expect.poll(async () => (await q<{ status: string }>("SELECT status FROM lotteries WHERE id = $1", [lotteryId]))[0]!.status).toBe("COMPLETED");

  // 12. Anyone can recompute the draw on the public page; the record is pseudonymous
  const pub = await (await browser.newContext({ baseURL: WEB, locale: "ja-JP" })).newPage();
  await pub.goto(`/verify/${code}`);
  await pub.getByRole("button", { name: "ブラウザで再計算する" }).click();
  await expect(pub.getByText("✓ シードのハッシュがコミットと一致")).toBeVisible();
  await expect(pub.getByText("✓ 全枠のカード番号が一致")).toBeVisible();
  const record = await pub.request.get(`/api/records/${code}`);
  expect(JSON.stringify(await record.json())).not.toMatch(/@boxrush\.local/);

  // the audit chain is still intact after the whole run (T7)
  const broken = await q("SELECT a.seq FROM audit_log a JOIN audit_log p ON p.seq = a.seq - 1 WHERE a.prev_hash <> p.hash LIMIT 1");
  expect(broken).toEqual([]);
});
