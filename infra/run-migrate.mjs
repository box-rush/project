// Runs the Migrate task (DB migrations as the RDS owner) and waits for it to finish.
//   npx sst shell --stage <stage> -- node infra/run-migrate.mjs
import { Resource } from "sst";
import { task } from "sst/aws/task";

const run = await task.run(Resource.Migrate);
console.log(`migrate task started: ${run.arn}`);
for (;;) {
  await new Promise((r) => setTimeout(r, 5000));
  const d = await task.describe(Resource.Migrate, run.arn);
  if (d.status === "STOPPED") {
    const code = d.response?.containers?.[0]?.exitCode;
    console.log(`migrate task stopped, exit code ${code}`);
    process.exit(code === 0 ? 0 : 1);
  }
}
