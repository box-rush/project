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
// web: client components get only CLIENT_NAMESPACES (apps/web/i18n/client-namespaces.ts); a namespace used in a
// "use client" file but not listed there would throw MISSING_MESSAGE in the browser
{
  const nsFile = join(root, "apps/web/i18n/client-namespaces.ts");
  const allowed = new Set([...readFileSync(nsFile, "utf8").matchAll(/"([A-Za-z]+)",/g)].map((m) => m[1]));
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.name === "node_modules" || e.name === ".next" ? [] : e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith(".tsx") ? [join(d, e.name)] : []));
  for (const f of [...walk(join(root, "apps/web/app")), ...walk(join(root, "apps/web/components"))]) {
    const src = readFileSync(f, "utf8");
    if (!/^["']use client["']/m.test(src)) continue;
    const used = new Set([
      ...[...src.matchAll(/useTranslations\(["']([A-Za-z]+)/g)].map((m) => m[1]),
      ...(/useTranslations\(\)/.test(src) ? [...src.matchAll(/\bt\(["'`]([A-Za-z]+)\./g)].map((m) => m[1]) : []),
    ]);
    const missing = [...used].filter((n) => !allowed.has(n));
    if (missing.length) (failed = true), console.error(`${f.slice(root.length)}: client namespaces not passed to the browser: ${missing.join(", ")} (add to apps/web/i18n/client-namespaces.ts)`);
  }
}
process.exit(failed ? 1 : 0);
