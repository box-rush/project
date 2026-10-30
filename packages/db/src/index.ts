import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export * as schema from "./schema";
export * from "./schema";
export { sql, eq, and, or, not, inArray, isNull, isNotNull, desc, asc, gt, gte, lt, lte, ne, count, sum } from "drizzle-orm";

export type Db = NodePgDatabase<typeof schema>;
/** Transaction handle has the same query API. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

export function createDb(url = process.env.DATABASE_URL ?? "postgres://boxrush:boxrush@localhost:5432/boxrush", opts: { max?: number } = {}) {
  const pool = new pg.Pool({ connectionString: url, max: opts.max ?? 10 });
  const db = drizzle(pool, { schema });
  return { db, pool };
}
