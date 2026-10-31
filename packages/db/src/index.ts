import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export * as schema from "./schema";
export * from "./schema";
export { sql, eq, and, or, not, inArray, isNull, isNotNull, desc, asc, gt, gte, lt, lte, ne, count, sum, arrayContains } from "drizzle-orm";

export type Db = NodePgDatabase<typeof schema>;
/** Transaction handle has the same query API. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

export interface DbOptions {
  max?: number;
  /** per-statement cap; 0 disables (migrations). A runaway query must not hold locks or a pool slot for minutes. */
  statementTimeoutMs?: number;
  applicationName?: string;
}

export function createDb(url = process.env.DATABASE_URL ?? "postgres://boxrush:boxrush@localhost:5432/boxrush", opts: DbOptions = {}) {
  const pool = new pg.Pool({
    connectionString: url,
    max: opts.max ?? Number(process.env.DB_POOL_MAX ?? 10),
    // fail fast instead of hanging a request when the database is unreachable or the pool is exhausted
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: opts.statementTimeoutMs ?? Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 30_000),
    // a transaction left open by a crashed request would block every writer of the rows it locked
    idle_in_transaction_session_timeout: 60_000,
    application_name: opts.applicationName ?? process.env.DB_APPLICATION_NAME ?? "boxrush",
  });
  // An idle client that loses its connection (RDS failover, network blip) emits "error" on the pool. Without a
  // listener Node treats it as unhandled and the whole process exits; the pool already drops the broken client.
  pool.on("error", (e) => console.error("[db] idle client error", e.message));
  const db = drizzle(pool, { schema });
  return { db, pool };
}
