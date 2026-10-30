import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import { createDb } from "./index";

export async function runMigrations(url?: string) {
  const { db, pool } = createDb(url, { max: 1 });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)) });
  await pool.end();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations().then(
    () => console.log("migrations applied"),
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}
