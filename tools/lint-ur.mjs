#!/usr/bin/env node
/**
 * §10.12 / §9.7 guard rails, run in CI:
 *  1. UR1 / UR2 / I3: no points, balance, top-up, cash-out, sell-back, expected value, gacha wording in UI copy.
 *  2. T19: no hard-coded CJK UI strings in app components (use message keys). Comments are ignored.
 *  3. I3: no balance/points/wallet columns in the schema.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const errors = [];

const walk = (dir, exts, out = []) => {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    if (["node_modules", ".next", "test-results"].includes(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, exts, out);
    else if (exts.some((x) => p.endsWith(x))) out.push(p);
  }
  return out;
};

// 1. forbidden UI wording (ja / zh-Hans / en)
const FORBIDDEN = [
  /ポイント/, /残高/, /チャージ/, /キャッシュアウト/, /出金/, /買取/, /買い取/, /期待値/, /還元率/, /ガチャ/, /当たり確率/, /大当たり/,
  /积分/, /余额/, /充值/, /提现/, /回收/, /期望值/,
  /\bpoints?\b/i, /\bbalance\b/i, /\btop-?up\b/i, /\bcash[ -]?out\b/i, /\bwallet\b/i, /\bsell[ -]?back\b/i, /\bexpected value\b/i, /\bjackpot\b/i,
];
const keepLines = (m) => m.replace(/[^\n]/g, "");
const strip = (s) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, keepLines).replace(/\/\*[\s\S]*?\*\//g, keepLines).replace(/(^|[^:])\/\/.*$/gm, "$1");
const uiFiles = [...walk(join(root, "apps"), [".json"]).filter((p) => p.includes("/messages/")), ...walk(join(root, "apps"), [".tsx"])];
for (const f of uiFiles) {
  const text = f.endsWith(".json") ? readFileSync(f, "utf8") : strip(readFileSync(f, "utf8"));
  for (const re of FORBIDDEN) {
    const m = text.match(re);
    if (m) errors.push(`${relative(root, f)}: forbidden UI wording "${m[0]}" (UR1/UR2/I3)`);
  }
}

// 2. hard-coded CJK in TSX (UI must come from messages)
const CJK = /[぀-ヿ㐀-鿿]/;
for (const f of walk(join(root, "apps"), [".tsx"])) {
  const original = readFileSync(f, "utf8").split("\n");
  const lines = strip(readFileSync(f, "utf8")).split("\n");
  lines.forEach((line, i) => {
    if (CJK.test(line) && !original[i]?.includes("lint-ur:allow")) errors.push(`${relative(root, f)}:${i + 1}: hard-coded UI text, use a message key (T19)`);
  });
}

// 3. schema
const schema = readFileSync(join(root, "packages/db/src/schema.ts"), "utf8");
for (const m of schema.matchAll(/(\w+):\s*(?:text|integer|bigint|numeric|boolean|jsonb)\("([a-z_]+)"/g)) {
  if (/balance|point|wallet|credit|top_?up|cash_?out|withdraw/i.test(m[2])) errors.push(`schema column ${m[2]}: balances/points are forbidden (I3)`);
}

if (errors.length) {
  console.error(errors.join("\n"));
  console.error(`\n${errors.length} UR lint error(s)`);
  process.exit(1);
}
console.log("UR lint ok");
