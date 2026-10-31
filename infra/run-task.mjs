// Runs one of the stack's one-off ECS tasks and waits for it (exit code = the task's exit code).
//   npx sst shell --stage <stage> -- node infra/run-task.mjs Migrate | DbRoles | Seed
// Its output is in CloudWatch Logs: /boxrush/<stage>/task-<name> (the deploy workflow prints it).
import { Resource } from "sst";
import { task } from "sst/aws/task";

const name = process.argv[2];
let resource;
try {
  resource = name && Resource[name]; // throws for a name the app does not have
} catch {}
if (!resource) {
  console.error(`usage: node infra/run-task.mjs <Migrate|DbRoles|Seed>  (unknown or not deployed: ${name ?? "-"})`);
  process.exit(2);
}
const run = await task.run(resource);
console.log(`${name}: started ${run.arn}`);
const deadline = Date.now() + 30 * 60_000;
for (;;) {
  await new Promise((r) => setTimeout(r, 5000));
  const d = await task.describe(resource, run.arn);
  if (d.status === "STOPPED") {
    const c = d.response?.containers?.[0];
    console.log(`${name}: stopped, exit code ${c?.exitCode ?? "-"}${c?.reason ? ` (${c.reason})` : ""}${d.response?.stoppedReason ? ` — ${d.response.stoppedReason}` : ""}`);
    process.exit(c?.exitCode === 0 ? 0 : 1);
  }
  if (Date.now() > deadline) {
    console.error(`${name}: still running after 30 minutes`);
    process.exit(1);
  }
}
