import pg from "pg";
import { runMigrations } from "@boxrush/db/migrate";

const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL ?? "postgres://boxrush:boxrush@localhost:5432/postgres";
export const TEST_URL = process.env.TEST_DATABASE_URL ?? "postgres://boxrush:boxrush@localhost:5432/boxrush_test";

export default async function setup() {
  const c = new pg.Client({ connectionString: ADMIN_URL });
  await c.connect();
  await c.query("DROP DATABASE IF EXISTS boxrush_test WITH (FORCE)");
  await c.query("CREATE DATABASE boxrush_test");
  await c.end();
  await runMigrations(TEST_URL);
  process.env.TEST_DATABASE_URL = TEST_URL;
}
