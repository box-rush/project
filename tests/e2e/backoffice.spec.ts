import type { ChildProcess } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { consumerPage, database, readyLottery, staffPage, startWorker, stopWorker } from "./helpers";

/**
 * Back-office functions through the UI: catalog (F18.1 / F18.2 two-person checklist), banners (F20.4 → F3.9),
 * codes (F20.6 → F9.10), FAQ maintenance (F23.4 → F12.1), purchase proofs (F16.3), X4 same-lot replacement,
 * X9 maker-defect note, X12 lost parcel and carrier claim.
 */
const { q, lotteryStatus, end } = database();
const RUN = Date.now().toString(36).toUpperCase();
let worker: ChildProcess | undefined;

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);
test.use({ actionTimeout: 15_000 });
test.beforeAll(() => {
  worker = startWorker();
});
test.afterAll(async () => {
  stopWorker(worker);
  await end();
});

const ok = async (page: Page) => {
  await expect(page.locator("p[role=status], p[role=alert]").first()).toBeVisible();
  expect(await page.locator("p[role=alert]").allInnerTexts(), page.url()).toEqual([]);
};

test("F18.1 / F18.2: a new product and its checklist — drafted by one person, verified by another", async ({ browser }) => {
  const adm = await staffPage(browser, "admin@boxrush.local");
  await adm.goto("/ops/products");
  const series = `E2E弾 ${RUN}`;
  await adm.locator("input[name=maker]").fill("テストメーカー");
  await adm.locator("input[name=series]").fill(series);
  await adm.locator("input[name=setCode]").fill(`E2E-${RUN}`);
  await adm.locator("input[name=packsPerUnit]").fill("10");
  await adm.locator("input[name=retailPrice]").fill("5000");
  await adm.locator("input[name=cardNumberHint]").fill("/003");
  await adm.getByRole("button", { name: "追加する" }).click();
  await ok(adm);
  const product = (await q<{ id: string }>("SELECT id FROM products WHERE series = $1", [series]))[0]!;

  await adm.goto("/ops/checklists");
  await adm.locator("select[name=productId]").selectOption(product.id);
  await adm.locator("textarea[name=entries]").fill("number,name,rarity\n001/003,テストA,C\n002/003,テストB,R\n003/003,テストC,SR");
  await adm.getByRole("button", { name: "下書き保存" }).click();
  await ok(adm);
  // the drafter sees their own draft but cannot verify it
  const row = (p: Page) => p.getByRole("row", { name: new RegExp(series) });
  await expect(row(adm).getByText("自分の下書き（別の人が検証）")).toBeVisible();

  const rev = await staffPage(browser, "reviewer@boxrush.local");
  await rev.goto("/ops/checklists");
  await row(rev).getByRole("button", { name: "検証済みにする" }).click();
  await expect.poll(async () => (await q<{ s: string }>("SELECT status AS s FROM checklist_templates WHERE product_id = $1", [product.id]))[0]?.s).toBe("VERIFIED");
});

test("F20.4 → F3.9: a banner created in the back office appears on the consumer home page", async ({ browser }) => {
  const rev = await staffPage(browser, "reviewer@boxrush.local");
  await rev.goto("/ops/banners");
  const title = `E2Eバナー ${RUN}`;
  const form = rev.locator("form").filter({ has: rev.getByRole("button", { name: "追加する" }) });
  await form.locator("input[name=title]").fill(title);
  await form.locator("input[name=href]").fill("/help");
  const jst = (h: number) => new Date(Date.now() + h * 3600_000 + 9 * 3600_000).toISOString().slice(0, 16);
  await form.locator("input[name=activeFrom]").fill(jst(-1));
  await form.locator("input[name=activeUntil]").fill(jst(24));
  await form.getByRole("button", { name: "追加する" }).click();
  await ok(rev);
  const home = await (await browser.newContext({ locale: "ja-JP" })).newPage();
  await home.goto("/");
  await expect(home.getByText(title)).toBeVisible();
});

test("F20.6 → F9.10: CS creates a code; a user redeems it; disabling stops further redemption", async ({ browser }) => {
  const cs = await staffPage(browser, "cs@boxrush.local");
  await cs.goto("/ops/coupons");
  const code = `E2E-${RUN}`;
  await cs.locator("input[name=code]").fill(code);
  await cs.locator("input[name=maxRedemptions]").fill("5");
  await cs.locator("input[name=validUntil]").fill(new Date(Date.now() + 7 * 86_400_000 + 9 * 3600_000).toISOString().slice(0, 16));
  const reason = cs.locator("form").filter({ has: cs.locator("input[name=code]") }).locator("[name=reason]");
  if (await reason.count()) {
    if ((await reason.evaluate((e) => e.tagName)) === "SELECT") await reason.selectOption({ index: 0 });
    else await reason.fill("E2E");
  }
  await cs.getByRole("button", { name: "作成する" }).click();
  await ok(cs);

  const u = await consumerPage(browser, "user6@boxrush.local");
  await u.goto("/coupons");
  await u.getByLabel("コードを入力").fill(code);
  await u.getByRole("button", { name: "登録" }).click();
  await expect(u.getByText("クーポンを登録しました")).toBeVisible();

  await cs.reload();
  await cs.getByRole("row", { name: new RegExp(code) }).getByRole("button", { name: "無効にする" }).click();
  await expect.poll(async () => (await q<{ d: Date | null }>("SELECT disabled_at AS d FROM voucher_codes WHERE code = $1", [code]))[0]?.d).not.toBeNull();
  const u2 = await consumerPage(browser, "user5@boxrush.local");
  await u2.goto("/coupons");
  await u2.getByLabel("コードを入力").fill(code);
  await u2.getByRole("button", { name: "登録" }).click();
  await expect(u2.getByText("コードが無効です")).toBeVisible();
});

test("F23.4 → F12.1: CS adds an FAQ entry, it shows on the help page; hiding it removes it", async ({ browser }) => {
  const cs = await staffPage(browser, "cs@boxrush.local");
  await cs.goto("/ops/tickets");
  await cs.getByRole("link", { name: "FAQ・遊び方の管理" }).click();
  const question = `E2E 質問 ${RUN}？`;
  const add = cs.locator("form").filter({ has: cs.getByRole("button", { name: "追加する" }) });
  await add.locator("select[name=section]").selectOption("SHIPPING");
  await add.locator("input[name=question]").fill(question);
  await add.locator("textarea[name=answer]").fill("E2E の回答です。");
  await add.getByRole("button", { name: "追加する" }).click();
  await ok(cs);
  const help = await (await browser.newContext({ locale: "ja-JP" })).newPage();
  await help.goto("/help");
  await expect(help.getByText(question)).toBeVisible();

  await cs.reload();
  const item = cs.getByTestId("faq-row").filter({ hasText: question });
  await item.locator("summary").click();
  await item.locator("input[name=published]").uncheck();
  await item.getByRole("button", { name: "保存" }).click();
  await expect.poll(async () => (await q<{ p: boolean }>("SELECT published AS p FROM faqs WHERE question = $1", [question]))[0]?.p).toBe(false);
  await help.reload();
  await expect(help.getByText(question)).toHaveCount(0);
});

test("F16.3: the merchant attaches a purchase proof to an intake booking; the warehouse can open it", async ({ browser }) => {
  const mer = await staffPage(browser, "merchant@boxrush.local");
  await mer.goto("/merchant/intake");
  await mer.locator("input[name=expectedQuantity]").fill("2");
  await mer.locator("input[name=expectedAt]").fill(new Date(Date.now() + 2 * 86_400_000 + 9 * 3600_000).toISOString().slice(0, 16));
  await mer.getByRole("button", { name: "予約する" }).click();
  await ok(mer);
  const name = `invoice-${RUN}.pdf`;
  const pdf = Buffer.from(`%PDF-1.4\n% ${RUN}\ntrailer<<>>\n%%EOF`);
  await mer.getByLabel("証憑ファイル（PDF・画像、10MBまで）").first().setInputFiles({ name, mimeType: "application/pdf", buffer: pdf });
  await mer.getByRole("button", { name: "アップロード" }).first().click();
  await expect(mer.getByRole("link", { name })).toBeVisible();
  // a file that only claims to be a PDF is refused (type is read from the bytes)
  await mer.getByLabel("証憑ファイル（PDF・画像、10MBまで）").first().setInputFiles({ name: "fake.pdf", mimeType: "application/pdf", buffer: Buffer.from("<html>not a pdf</html>") });
  await mer.getByRole("button", { name: "アップロード" }).first().click();
  await expect(mer.getByText("PDF・JPEG・PNG・WebPのみアップロードできます")).toBeVisible();

  const wh = await staffPage(browser, "warehouse@boxrush.local");
  await wh.goto("/ops/intake");
  const href = await wh.getByRole("link", { name }).getAttribute("href");
  const res = await wh.request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("application/pdf");
  expect(Buffer.from(await res.body()).equals(pdf)).toBe(true);
  // the station role has no access
  const st = await staffPage(browser, "station@boxrush.local");
  expect((await st.request.get(href!)).status()).toBe(403);
});

test("X4: a broken-seal box is replaced by a same-lot box at the station; buyers see the swap; the draw is unchanged", async ({ browser }) => {
  const { lotteryId, code } = readyLottery([{ email: "user4@boxrush.local", count: 2 }], { spareSameLot: true });
  const finalBefore = (await q<{ f: string }>("SELECT final_hash AS f FROM lotteries WHERE id = $1", [lotteryId]))[0]!.f;
  const st = await staffPage(browser, "station@boxrush.local");
  await st.goto(`/station/${lotteryId}`);
  const panel = st.getByTestId("replace-subject");
  await panel.locator("summary").click();
  await panel.getByLabel("理由（公開されます）").fill("シュリンクに破れ");
  await panel.getByLabel("異常の写真URL（スペース区切り）").fill("https://example.com/broken-seal.jpg");
  await panel.getByRole("button", { name: "差し替える" }).click();
  await expect(st.getByText(/-SPARE ·/)).toBeVisible(); // the station now lists the replacement box
  const u = await consumerPage(browser, "user4@boxrush.local");
  await u.goto(`/l/${code}`);
  await expect(u.getByText("封緘の異常により、開封前に同じロットの未開封BOXへ差し替えました")).toBeVisible();
  await expect(u.getByText("理由：シュリンクに破れ")).toBeVisible();
  expect((await q<{ f: string }>("SELECT final_hash AS f FROM lotteries WHERE id = $1", [lotteryId]))[0]!.f).toBe(finalBefore);
  expect(await lotteryStatus(lotteryId)).toBe("READY");
});

test("X9: attribution records a maker defect; the owner sees it on the card; X12: a lost parcel is recorded and claimed", async ({ browser }) => {
  const { lotteryId, code } = readyLottery([{ email: "user3@boxrush.local", count: 1 }, { email: "user2@boxrush.local", count: 1 }]);
  const numbers = await q<{ n: string[] }>("SELECT assigned_numbers AS n FROM slots WHERE lottery_id = $1 ORDER BY purchase_seq", [lotteryId]);
  const st = await staffPage(browser, "station@boxrush.local");
  await st.goto(`/station/${lotteryId}`);
  await st.getByTestId("start-opening").click();
  for (const n of [numbers[0]!.n[0]!, numbers[0]!.n[1]!, numbers[0]!.n[2]!, numbers[1]!.n[0]!]) {
    await st.getByLabel("カード番号").fill(n);
    await st.getByTestId("enter-card").click();
    await expect(st.getByText(`${n}`).first()).toBeVisible();
  }
  await st.getByRole("button", { name: "開封完了" }).click();
  await expect.poll(() => lotteryStatus(lotteryId)).toBe("ATTRIBUTING");

  const a1 = await staffPage(browser, "attr1@boxrush.local");
  await a1.goto(`/ops/attribution/${lotteryId}`);
  const row = a1.getByRole("row", { name: new RegExp(numbers[0]!.n[0]!.replace("/", "\\/")) });
  await row.getByText("メーカー出荷時の状態を記録（X9）").click();
  await row.getByLabel("出荷時の状態（例：印刷ズレ、角の白欠け）").fill("印刷ズレ（左上）");
  await row.getByRole("button", { name: "記録", exact: true }).click();
  await expect(a1.getByText("出荷時の状態：印刷ズレ（左上）")).toBeVisible();
  await a1.getByRole("button", { name: "すべて確定して記録を生成" }).click();
  await expect.poll(() => lotteryStatus(lotteryId)).toBe("ATTRIBUTED");
  const wh = await staffPage(browser, "warehouse@boxrush.local");
  await wh.goto("/ops/warehouse");
  await wh.getByRole("row", { name: new RegExp(code) }).getByRole("button", { name: "棚入れ" }).click();
  await expect.poll(() => lotteryStatus(lotteryId)).toBe("FULFILLING");

  // the owner sees the defect on the card and in the public result
  const u = await consumerPage(browser, "user3@boxrush.local");
  const item = (await q<{ id: string }>("SELECT ci.id FROM collection_items ci JOIN opened_cards oc ON oc.id = ci.opened_card_id WHERE oc.lottery_id = $1 AND oc.defect_note IS NOT NULL", [lotteryId]))[0]!;
  await u.goto(`/collection/${item.id}`);
  await expect(u.getByTestId("defect-note")).toContainText("メーカー出荷時の状態：印刷ズレ（左上）");
  await u.goto(`/l/${code}/result`);
  await expect(u.getByText("出荷時の状態：印刷ズレ（左上）")).toBeVisible();

  // X12: the owner ships the cards of this lottery; the carrier loses the parcel
  await u.goto("/addresses");
  if (!(await u.getByText(`X12 ${RUN}`).count())) {
    await u.getByLabel("お名前").fill(`X12 ${RUN}`);
    await u.getByLabel("郵便番号").fill("100-0001");
    await u.getByLabel("都道府県").fill("東京都");
    await u.getByLabel("市区町村").fill("千代田区");
    await u.getByLabel("番地").fill("1-1");
    await u.getByLabel("電話番号").fill("0300000000");
    await u.getByRole("button", { name: "追加する" }).click();
    await expect(u.getByText(`X12 ${RUN}`)).toBeVisible();
  }
  const mine = await q<{ id: string }>("SELECT id FROM collection_items WHERE lottery_id = $1 AND user_id = (SELECT id FROM users WHERE email = 'user3@boxrush.local')", [lotteryId]);
  await u.goto("/collection");
  for (const m of mine) await u.locator(`a[href$="/collection/${m.id}"]`).locator("xpath=..").getByRole("checkbox", { name: "選択" }).check();
  await u.getByRole("button", { name: "まとめて発送" }).click();
  await u.getByRole("button", { name: "発送を申請する" }).click();
  const pay = u.getByRole("button", { name: "テスト決済で支払う（開発環境）" });
  await pay.or(u.getByRole("heading", { name: /発送詳細/ })).first().waitFor();
  if (await pay.isVisible()) await pay.click();
  await expect(u.getByRole("heading", { name: /発送詳細/ })).toBeVisible();
  const shipment = (await q<{ id: string; code: number }>("SELECT id, code FROM shipments WHERE user_id = (SELECT id FROM users WHERE email = 'user3@boxrush.local') ORDER BY requested_at DESC LIMIT 1"))[0]!;
  const status = async () => (await q<{ s: string }>("SELECT status AS s FROM shipments WHERE id = $1", [shipment.id]))[0]!.s;
  await expect.poll(status).toBe("REQUESTED");
  const rowOf = (p: Page) => p.getByRole("row", { name: new RegExp(`#${shipment.code}(?!\\d)`) });
  await wh.goto(`/ops/warehouse?tab=req&q=${shipment.code}`);
  await rowOf(wh).getByRole("button", { name: "ピッキング開始" }).click();
  await expect.poll(status).toBe("PICKING");
  await wh.goto(`/ops/warehouse?tab=pack&q=${shipment.code}`);
  for (const c of await q<{ id: string }>("SELECT id FROM collection_items WHERE shipment_id = $1", [shipment.id])) {
    await wh.getByLabel("スキャン（Enterで1件）").fill(c.id);
    await wh.getByLabel("スキャン（Enterで1件）").press("Enter");
  }
  await wh.getByRole("button", { name: "梱包完了" }).click();
  await expect.poll(status).toBe("PACKED");
  await wh.goto(`/ops/warehouse?tab=pack&q=${shipment.code}`);
  await rowOf(wh).getByLabel("追跡番号").fill(`X12-${RUN}`);
  await rowOf(wh).getByRole("button", { name: "出荷する" }).click();
  await expect.poll(status).toBe("SHIPPED");

  await wh.goto(`/ops/warehouse?tab=out&q=${shipment.code}`);
  await rowOf(wh).getByText("配送事故を記録").click();
  await rowOf(wh).getByLabel("状況（運送会社の連絡内容など）").fill("ヤマトから紛失の連絡");
  await rowOf(wh).getByRole("button", { name: "記録する" }).click();
  await expect.poll(status).toBe("LOST");
  await u.goto(`/shipments/${shipment.id}`);
  await expect(u.getByTestId("shipment-incident")).toContainText("配送中に紛失しました");
  await expect(u.getByTestId("shipment-incident")).toContainText(/補償上限 ¥(3|30),000/);

  const cs = await staffPage(browser, "cs@boxrush.local");
  await cs.goto("/ops/incidents");
  const inc = cs.getByRole("row", { name: new RegExp(`#${shipment.code}(?!\\d)`) });
  await inc.getByLabel("請求番号").fill("YMT-CLAIM-1");
  await inc.getByRole("button", { name: "更新" }).click();
  await expect.poll(async () => (await q<{ s: string }>("SELECT claim_status AS s FROM shipment_incidents WHERE shipment_id = $1", [shipment.id]))[0]!.s).toBe("SUBMITTED");
  await u.reload();
  await expect(u.getByTestId("shipment-incident")).toContainText("運送会社に請求済み");
});
