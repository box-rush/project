#!/usr/bin/env node
/** T19: every app ships ja / zh-Hans / en with identical key sets; values must be non-empty. */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const LOCALES = ["ja", "zh-Hans", "en"];
let failed = false;
const flat = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? flat(v, `${p}${k}.`) : [[`${p}${k}`, v]]));

for (const app of readdirSync(join(root, "apps"))) {
  const dir = join(root, "apps", app, "messages");
  if (!existsSync(dir) || !LOCALES.every((l) => existsSync(join(dir, `${l}.json`)))) { if (existsSync(dir)) (failed = true), console.error(`${app}: missing locale files`); continue; }
  let appFailed = false;
  const maps = Object.fromEntries(LOCALES.map((l) => [l, new Map(flat(JSON.parse(readFileSync(join(dir, `${l}.json`), "utf8"))))]));
  const all = new Set(LOCALES.flatMap((l) => [...maps[l].keys()]));
  for (const l of LOCALES) {
    const missing = [...all].filter((k) => !maps[l].has(k));
    const empty = [...maps[l]].filter(([, v]) => v === "" || v === null).map(([k]) => k);
    if (missing.length) (failed = appFailed = true), console.error(`${app}/${l}: missing ${missing.length} keys: ${missing.slice(0, 10).join(", ")}`);
    if (empty.length) (failed = appFailed = true), console.error(`${app}/${l}: empty values: ${empty.slice(0, 10).join(", ")}`);
  }
  if (!appFailed) console.log(`${app}: ${all.size} keys × ${LOCALES.length} locales ok`);
}
process.exit(failed ? 1 : 0);
