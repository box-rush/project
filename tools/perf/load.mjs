#!/usr/bin/env node
/**
 * Minimal HTTP load generator for the public pages (no dependencies). Each virtual user requests the paths in turn
 * for the given duration; prints throughput, latency percentiles and errors per path.
 *   node tools/perf/load.mjs --base http://localhost:3100 --users 50 --seconds 30 / /l/L0005 /verify/L0001 /api/records/L0001
 */
const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args.splice(i, 2)[1] : d;
};
const base = opt("base", "http://localhost:3100");
const users = Number(opt("users", 20));
const seconds = Number(opt("seconds", 20));
const paths = args.length ? args : ["/"];
const stats = new Map(paths.map((p) => [p, { ms: [], errors: 0, codes: {} }]));
const until = Date.now() + seconds * 1000;

async function vu(i) {
  let n = i;
  while (Date.now() < until) {
    const p = paths[n++ % paths.length];
    const s = stats.get(p);
    const t = performance.now();
    try {
      const r = await fetch(base + p, { headers: { "accept-language": "ja" }, signal: AbortSignal.timeout(30_000) });
      await r.arrayBuffer();
      s.codes[r.status] = (s.codes[r.status] ?? 0) + 1;
      if (r.status >= 500) s.errors++;
    } catch {
      s.errors++;
    }
    s.ms.push(performance.now() - t);
  }
}

const q = (xs, p) => xs[Math.min(xs.length - 1, Math.floor((xs.length * p) / 100))]?.toFixed(0) ?? "-";
const started = Date.now();
await Promise.all(Array.from({ length: users }, (_, i) => vu(i)));
const secs = (Date.now() - started) / 1000;
let total = 0;
console.log(`${users} users × ${seconds}s against ${base}`);
console.log("path".padEnd(28), "req/s".padStart(7), "p50".padStart(6), "p95".padStart(6), "p99".padStart(6), "max".padStart(6), " errors codes");
for (const [p, s] of stats) {
  s.ms.sort((a, b) => a - b);
  total += s.ms.length;
  console.log(p.padEnd(28), (s.ms.length / secs).toFixed(1).padStart(7), q(s.ms, 50).padStart(6), q(s.ms, 95).padStart(6), q(s.ms, 99).padStart(6), q(s.ms, 100).padStart(6), ` ${s.errors} ${JSON.stringify(s.codes)}`);
}
console.log(`total ${(total / secs).toFixed(1)} req/s`);
