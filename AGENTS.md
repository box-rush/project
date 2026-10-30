# Working on Box Rush (instructions for AI agents and humans)

The product spec lives in the docs repo (`box-rush/docs`, `docs/breaking-platform.md`, Chinese). **The spec wins over the code** (§10.1):
invariants and state machine (§6.3, §6.5, §6.6, §10.4) > decided product decisions (§8.14) > features / pages (§8.5–§8.9) > UI rules (§9.2) > prototypes.
If you find a gap or conflict, fix the doc first (§10.10), then the code.

## Never do (each is a bug, not a trade-off)
- I2: sell beyond 100 % / lower the fill threshold / let a merchant or platform account hold slots. Holds go through `holdSlots` (one conditional UPDATE).
- I3 / UR1: add any balance, points, wallet, top-up, cash-out or sell-back concept — not in the schema, not in the UI. Refunds go to the original payment only.
- I4 / G5: give any staff role (including ADMIN) a way to trigger, re-run or choose a draw. Only `RandomnessService` (separate DB role `boxrush_rng`) touches seeds.
- I5: add a video upload path. Segments come only from the station pipeline (`ingestSegment`).
- I6: put a lottery on sale without a published commitment (DB CHECK enforces it).
- Change `bx-shuffle-v1`. A new algorithm is a new version id; the §10.4.2b vector and the prototype vectors must keep passing.
- Claim in user copy that the platform "cannot manipulate" the draw (PD20: first release has no public beacon).
- Hard-code UI text in components — use `messages/{ja,zh-Hans,en}.json` (T19). Amounts are always yen, times always JST.
- Write to a back-office table without `audit()` in the same transaction (F24.5). `audit_log` is append-only with a hash chain.

## Where things are
| Path | What |
|---|---|
| `packages/core` | Pure domain: bx-shuffle-v1, J7 card draw, state machine, SV1 invariant validator, consumer-protection maths, pseudonyms, shipping quotes, formatting. No I/O. |
| `packages/db` | Drizzle schema + SQL migrations. `0001_invariants.sql` holds the DB-enforced invariants, triggers and roles. |
| `packages/services` | All business logic (`ctx` + principal in, audited writes out), job queue + reconcile (T13), adapters (Stripe/mock payments, SES/LINE/SMS console stubs, KMS stand-in). |
| `apps/web` | Consumer app + public verification site (Next.js, next-intl, Better Auth). |
| `apps/admin` | Back office: merchant, review, station, attribution, warehouse, CS, finance, data. Staff login with mandatory TOTP. |
| `tools/` | `lint-ur.mjs` (UR wording, hard-coded strings, schema), `check-i18n.mjs` (key parity). |

## Checks before pushing
`pnpm check` (UR lint, i18n, typecheck, unit + integration tests on PostgreSQL) and, for UI changes, `pnpm e2e`.
Trust-core changes (randomness, holds, state machine, audit, payment webhook, permissions, auth) need: passing vectors/property tests,
a written risk note, and are in scope for the pre-launch external review (§10.12).
