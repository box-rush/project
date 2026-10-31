import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createDb, eq, merchants, staff } from "@boxrush/db";
import { verifyPassword } from "../src/staffAuth";

/** The bootstrap script against a fresh database: first ADMIN + self-operated merchant, and only once. */
describe("bootstrap of a fresh stage", () => {
  it("creates the first admin and the platform merchant, then refuses to run again", async () => {
    const url = process.env.TEST_DATABASE_URL!;
    const { db, pool } = createDb(url, { max: 1 });
    try {
      // the shared test database may already hold staff from other files; start from no ADMIN
      await db.execute(`UPDATE staff SET roles = array_remove(roles, 'ADMIN') WHERE 'ADMIN' = ANY(roles)` as never);
      const run = (env: Record<string, string>) =>
        execFileSync("npx", ["tsx", "src/bootstrap.ts"], { env: { ...process.env, DATABASE_URL: url, ...env }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      const email = `boot-${Date.now()}@example.jp`;
      expect(() => run({ BOOTSTRAP_ADMIN_EMAIL: email, BOOTSTRAP_ADMIN_PASSWORD: "short" })).toThrow();
      const out = run({ BOOTSTRAP_ADMIN_EMAIL: email, BOOTSTRAP_ADMIN_PASSWORD: "a-long-enough-password-1" });
      expect(out).toContain("created");
      const [s] = await db.select().from(staff).where(eq(staff.email, email));
      expect(s!.roles).toEqual(["ADMIN"]);
      expect(s!.totpEnrolledAt).toBeNull(); // registered at first login
      expect(verifyPassword("a-long-enough-password-1", s!.passwordHash)).toBe(true);
      expect((await db.select().from(merchants).where(eq(merchants.selfOperated, true))).length).toBeGreaterThan(0);
      expect(() => run({ BOOTSTRAP_ADMIN_EMAIL: `x-${email}`, BOOTSTRAP_ADMIN_PASSWORD: "a-long-enough-password-1" })).toThrow();
    } finally {
      await pool.end();
    }
  });
});
