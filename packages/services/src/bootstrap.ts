/**
 * First run of a fresh stage: the platform's own (self-operated) merchant and the first ADMIN account. Refuses to run
 * when an ADMIN already exists. Every other staff account is created by that admin on O17 (監査ログ → スタッフ).
 *
 *   BOOTSTRAP_ADMIN_EMAIL=ops@example.jp BOOTSTRAP_ADMIN_PASSWORD='<long random>' \
 *   BOOTSTRAP_MERCHANT_NAME='BOXラッシュ公式' BOOTSTRAP_LEGAL_NAME='株式会社…' \
 *   DATABASE_URL=… pnpm --filter @boxrush/services bootstrap
 *
 * The admin registers TOTP (二段階認証) at the first login. The merchant's legal details shown on the 特定商取引法
 * page can be completed later (legal items are on hold).
 */
import { arrayContains, createDb, eq, merchants, staff } from "@boxrush/db";
import { audit } from "./audit";
import { hashPassword, generateTotpSecret } from "./staffAuth";

const need = (k: string) => {
  const v = process.env[k]?.trim();
  if (!v) throw new Error(`${k} is required`);
  return v;
};

async function main() {
  const email = need("BOOTSTRAP_ADMIN_EMAIL").toLowerCase();
  const password = need("BOOTSTRAP_ADMIN_PASSWORD");
  if (password.length < 16) throw new Error("BOOTSTRAP_ADMIN_PASSWORD must be at least 16 characters");
  const { db, pool } = createDb(process.env.DATABASE_URL, { max: 1, applicationName: "boxrush-bootstrap" });
  try {
    if ((await db.select({ id: staff.id }).from(staff).where(arrayContains(staff.roles, ["ADMIN"]))).length) throw new Error("an ADMIN already exists; create further staff on O17");
    let [m] = await db.select().from(merchants).where(eq(merchants.selfOperated, true)).limit(1);
    if (!m)
      [m] = await db
        .insert(merchants)
        .values({
          name: process.env.BOOTSTRAP_MERCHANT_NAME?.trim() || "BOXラッシュ公式",
          selfOperated: true,
          legalName: process.env.BOOTSTRAP_LEGAL_NAME?.trim() || "（未設定）",
          address: process.env.BOOTSTRAP_ADDRESS?.trim() || "（未設定）",
          phone: process.env.BOOTSTRAP_PHONE?.trim() || "（未設定）",
        })
        .returning();
    const [s] = await db
      .insert(staff)
      .values({ email, name: process.env.BOOTSTRAP_ADMIN_NAME?.trim() || "管理者", passwordHash: hashPassword(password), totpSecret: generateTotpSecret(), roles: ["ADMIN"], merchantId: m!.id })
      .returning();
    await audit(db, { type: "SYSTEM", id: "bootstrap" }, "staff.bootstrap_admin", "staff", s!.id, { email });
    console.log(`ADMIN ${email} created (merchant: ${m!.name}). Log in to the back office and register 二段階認証.`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
