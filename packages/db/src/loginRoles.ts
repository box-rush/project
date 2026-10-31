/**
 * The restricted database logins the services use (packages/db/sql/login-roles.sql), created or re-passworded by the
 * RDS master user. Run after migrations; idempotent.
 *
 *   DATABASE_URL=<owner url> APP_DB_PASSWORD=… RNG_DB_PASSWORD=… tsx packages/db/src/loginRoles.ts
 *
 * In AWS this is the DbRoles task (infra/stack.ts): the passwords come from Secrets Manager, never from a shell.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

const literal = (v: string) => `'${v.replace(/'/g, "''")}'`;

export function loginRolesSql(appPassword: string, rngPassword: string) {
  if (!appPassword || !rngPassword) throw new Error("both login passwords are required");
  const script = readFileSync(new URL("../sql/login-roles.sql", import.meta.url), "utf8");
  return script.replace(":app_password", literal(appPassword)).replace(":rng_password", literal(rngPassword));
}

async function main() {
  const need = (k: string) => {
    const v = process.env[k];
    if (!v || v === "unset") throw new Error(`${k} is required`);
    return v;
  };
  const client = new pg.Client({ connectionString: need("DATABASE_URL") });
  await client.connect();
  try {
    await client.query(loginRolesSql(need("APP_DB_PASSWORD"), need("RNG_DB_PASSWORD")));
    console.log("login roles ready: boxrush_app_login, boxrush_rng_login");
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
