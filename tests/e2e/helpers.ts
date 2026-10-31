import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { expect, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { totp } from "../../packages/services/src/staffAuth";

export const WEB = process.env.E2E_BASE_URL ?? "http://localhost:3100";
export const ADMIN = process.env.E2E_ADMIN_URL ?? "http://localhost:3101";
export const DB = process.env.DATABASE_URL ?? "postgres://boxrush:boxrush@localhost:5432/boxrush";
const SERVICE_ENV = { PAYMENT_PROVIDER: "mock", RNG_SEED_KEY: process.env.RNG_SEED_KEY ?? "00".repeat(32), RNG_DATABASE_URL: process.env.RNG_DATABASE_URL ?? DB };

/** A small query helper over one shared connection. */
export function database() {
  const client = new pg.Client({ connectionString: DB });
  const ready = client.connect();
  const q = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) => {
    await ready;
    return (await client.query(sql, args)).rows as T[];
  };
  const lotteryStatus = async (id: string) => (await q<{ status: string }>("SELECT status FROM lotteries WHERE id = $1", [id]))[0]!.status;
  return { q, lotteryStatus, end: () => client.end() };
}

/** T13: draws, refunds and timed steps run in the worker, exactly as in production. */
export function startWorker(): ChildProcess {
  return spawn("pnpm", ["--filter", "@boxrush/services", "worker"], { stdio: "ignore", env: { ...process.env, ...SERVICE_ENV }, detached: true });
}
export function stopWorker(w: ChildProcess | undefined) {
  if (w?.pid) process.kill(-w.pid, "SIGTERM");
}

/** A sold-out, drawn (READY) lottery opening in a few minutes — see packages/services/src/e2eFixture.ts. */
export function readyLottery(buyers: { email: string; count: number }[], opts: { openInMinutes?: number; stage?: "PENDING_REVIEW" | "ON_SALE"; slots?: number; slotPrice?: number } = {}): { lotteryId: string; code: string } {
  const out = execFileSync("pnpm", ["--silent", "--filter", "@boxrush/services", "exec", "tsx", "src/e2eFixture.ts", JSON.stringify({ buyers, ...opts })], {
    env: { ...process.env, ...SERVICE_ENV },
    encoding: "utf8",
  });
  return JSON.parse(out.trim().split("\n").filter((l) => l.startsWith("{")).pop()!);
}

export async function staffPage(browser: Browser, email: string) {
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

export async function consumerPage(browser: Browser, email: string, password = "boxrush-demo") {
  const page = await (await browser.newContext({ baseURL: WEB, locale: "ja-JP", timezoneId: "Asia/Tokyo" })).newPage();
  page.on("dialog", (d) => d.accept());
  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("パスワード").fill(password);
  // sign-in is throttled per IP (3 per 10 s); every test logs in from 127.0.0.1, so wait out the window when it bites
  for (let attempt = 0; ; attempt++) {
    await page.getByRole("button", { name: "ログイン", exact: true }).click();
    const throttled = page.getByText(THROTTLED);
    await Promise.race([page.waitForURL((u) => !u.pathname.startsWith("/login")), throttled.waitFor()]);
    if (!(await throttled.isVisible()) || attempt >= 3) break;
    await page.waitForTimeout(10_500);
  }
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  return page;
}

export const THROTTLED = "試行回数が多すぎます。しばらく待ってからもう一度お試しください";

/** The translated action outcome under a form; fails with the message if the action returned an error. */
export async function expectSaved(page: Page) {
  await expect(page.locator("p[role=status], p[role=alert]").first()).toBeVisible();
  expect(await page.locator("p[role=alert]").allInnerTexts(), page.url()).toEqual([]);
}

/** UR1 / UR2: wording that must never appear on a consumer page. */
export const FORBIDDEN = /ポイント|残高|チャージ|期待値|還元率|ガチャ/;
