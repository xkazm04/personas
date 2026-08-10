# Triage run triage-2026-08-10-a — final rollup

First live run of the idea-triage funnel (docs/concepts/idea-triage-funnel.md).
Corpus: 58 pending `dev_ideas`. Operator approved the stage-1 split in full.

## Funnel arithmetic

| Stage | Count |
| --- | --- |
| Pending at start | 58 |
| Stage-1: rejected at gate | 24 |
| Stage-1: rerouted (practice door, operator swipes) | 7 |
| Stage-1: needs-info (HMAC cron feasibility) | 1 |
| Stage-1: accepted | 26 |
| → KPI-calibration lane (not a code dispatch) | 1 (b5a83f56) |
| → Dispatched to idea-run | 25 |
| Stage-2: implemented | **20** |
| Stage-2: analysis-declined (stale/unbuildable, evidenced) | 4 |
| Stage-2: blocked (foreign dirty files) | 1 |

Every analysis-decline carries file:line + superseding-commit evidence in its
result.json. Zero implementations proceeded on a false premise.

## Implemented (20) — 25 commits across 6 repos, NOTHING pushed

**apprenticeship-placement** (main): `6a7c866` login value-prop · `a5bb3de` reportBoundaryError seam (no SDK, no DSN) · `c741442` LLM transient retry (choke-point decorator, 3s cap) · `83a8eae` welcome/grant banner (economy.ts SSoT) · `f887ff5` insufficient-balance explainer — **5/5 items implemented**

**grant-writing-nonprofits** (⚠ branch `chore/decommission-datahub`): `2216388`+`bdbf7c3` server-action entity-id validation — upgraded to a CROSS-TENANT fix (Firestore `<orgId>_<grantId>` keying + unguarded `_`) · `3f1a4ab` Content-Type 415 gate · `e2222c0` illegal-transition tests (no production defect found) — **3/3 implemented**

**local-seo-agency** (main): `2566c47` 429 handling (apiClient isRateLimited) · `8419b6c`/`970f9d3`/`43a3160` offline detection · `5734dab` setup-complete note — **3/3 implemented**

**medical-bill-negotiator** (main): `78eca02` savings estimator (labeled 15–35% band, no fabricated precision) · `6e32a3b` staged analysis narration · `67b0d39` case-close summary (reuses printPlainText; fee honestly $0) · `00d2eb0` call-in-progress panel (honest minimum, no fake stages) — **4/6 implemented, 2 declined**

**ai-paralegal** (main): `515f154` callAI post-processing extraction (pure move, baselined) · `bb3bf4a`+`abce56a` min-citation hard gate (KPI-sim L2 defect #1) · `4092bd9` preamble/commentary hybrid strip+block gate (KPI-sim L2 defect #2) — **3/4 code items implemented** (+1 KPI-lane parked)

**auto-invoicer** (main): `cbb6eca` dead CSS + Arial-over-Geist fix · `eb5084a` honest drift checkpoint · `9d37bf3` theme-token completion (~70 tokens, pixel-parity proven, absorbed InvoiceForm's arbitrary-value interpolations) — **2 implemented, 1 blocked**

## Analysis-declined (4) — all correct catches

- `0059fa0c` ai-bookkeeper export logging — already fixed via `withMeteredRoute`→`withRouteLogging` indirection (commit `37333ce`); implementing = duplicate log lines.
- `1dbe0e0d` Immigration error taxonomy — data source is static fixtures; claimed error classes cannot occur; real gap fixed in `e255dc8`.
- `dc6fca5d` Medical Bill mobile entry — grid already stacks <640px since `9cc60f7` (carries the original UAT finding tag).
- `5e76592e` Medical Bill OCR confidence — backend is Gemini vision with NO confidence field; only path = LLM self-rating (invented scores, refused).

## Blocked (1)

- `12a642ba` auto-invoicer arbitrary-value interpolation — InvoiceForm portion absorbed by `9d37bf3`; stragglers in 6 files ALL dirty with ~757 lines of another session's uncommitted work. Re-wave after that tree cleans up.

## Operator actions

1. **8 approval cards in Approvals** — apply the verdict batches. Before applying, flip accept→reject on: ai-bookkeeper `0059fa0c`, Immigration `1dbe0e0d`, Medical Bill `dc6fca5d` + `5e76592e` (all four stage-2-declined with evidence).
2. **Push decisions** per repo (25 local commits). Grant Writing needs branch routing: its 4 commits sit on `chore/decommission-datahub`.
3. **7 personas practice items** — swipe manually in the deck (knowledge judgments).
4. **needs-info**: Grant Writing HMAC cron — Vercel managed cron likely can't sign; answer or drop.
5. `b5a83f56` ESLint-KPI measure-config — apply via KPI calibration in the app.
6. Re-wave `12a642ba` once auto-invoicer's dirty files are committed by their owner.

## Funnel lessons (for the next run)

- Staleness dominates: 13/24 gate declines + 4/4 stage-2 declines were already-fixed tickets. June scans, August triage. Cheap `created_at` vs `git log` check now baked into the skill; consider baking into stage 1.
- Symbol-grep validation is defeated by wrapper indirection and fixture-backed data — only the deep check catches these.
- Stage 2 upgrades as well as kills: the hygiene-framed entity-id ticket became a cross-tenant security fix.
- Foreign-drift discipline held everywhere: HEAD-blob staging, honest checkpoints, blocked-not-swept.
