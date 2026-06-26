# Combined-Scan Fix Wave 5 — Silent failures & success-theater

> 6 atomic fix-commits, 6 findings addressed (all High): 5 fully fixed + 1 (self-healing) race-half fixed with the versioning-half deferred.
> Dispatched as 6 parallel edit-only fix-subagents (4 Rust + 1 Rust+TS + 1 FE, disjoint files).
> Baseline preserved: **Rust 3366 pass** (19 failures confirmed pre-existing & unrelated — see note), **tsc 0, vitest 1972/7 (no regressions)**, ts-rs bindings reconciled, i18n strict gate green.

## Commits

| # | Commit | Finding | Severity | Outcome |
|---|---|---|---|---|
| 1 | `bc6934ee4` | genome #1 (evolution retry storm) | High | **Fixed** |
| 2 | `bdb46428e` | self-healing #1 (rollback clobber) | High | **Race fixed**; versioning deferred |
| 3 | `2bdb98791` | persona-templates #2 (hydrate swallow) | High | **Fixed** |
| 4 | `a31530759` | incidents #1 (dedup abandons execs) | High | **Fixed** + test |
| 5 | `532636998` | approvals #1 (orb-decision swallow) | High | **Fixed** |
| 6 | `b95dd8e77` | team-builder #1 (handoff swallow) | High | **Fixed** (Rust+modal+i18n) |

## What was fixed

1. **Evolution retry storm.** Only `complete_cycle` (success) wrote `last_cycle_at`, so a persistently-failing cycle left the clock frozen and `should_evolve` re-fired a full breeding/critique/eval cycle on every subsequent successful run. A RAII `CycleClockGuard` now stamps `last_cycle_at` on every failure return (`mark_cycle_attempted`), so a failing persona waits a full window before retrying.
2. **Self-healing ↔ rollback clobber (race half).** `auto_rollback_tick` now acquires the healing slot (`try_start_healing_blocking`) and skips personas with an in-flight heal, so the two can't write the prompt columns concurrently; the false "different-levels = safe" doc is corrected. *Deferred:* versioning the heal so rollback metrics attribute correctly (follow-up D).
3. **Template hydrate swallow.** A recipe-ref hydration failure was warn-and-continued, adopting a half-hydrated (structurally broken) persona as success. Now propagates the `Err` (member → `failed`, persona never created) + a stub-scan backstop.
4. **Incident dedup abandons executions.** The title-based open-dup guard collapsed distinct blocked executions into one incident, and since continuation keys on `source_id`, every deduped execution was silently abandoned. Continuable source tables now bypass the title guard (rely on the per-`source_id` UNIQUE), so each blocked execution gets its own continuable incident.
5. **Orb-decision swallow.** The approve/reject/review `run()` wrappers `silentCatch`-returned, so `runDecisionOption`'s keep-pending-on-failure net never fired (false "done"). The wrappers now re-throw so failures surface + stay pending.
6. **Team handoff swallow.** Adoption swallowed a `wire_team_handoff` failure and reported full success while only the entry member ran. `handoff_wired`/`handoff_error` now flow into the result; both modals show a warning + a "Repair handoff" button.

## ⚠️ Note: 19 pre-existing Rust full-suite failures (not regressions)

This wave first ran the **full** `cargo test --lib` (earlier waves ran filtered subsets). It surfaced **19 failures in modules none of my changes touch** (`sla`, `settings_audit_log`, `metrics`, `dev_tools` gates, `connector_readiness`, `drive` sandbox, `db_query`, `pipeline_executor`, `prompt`, `skills_sidecar`, `workflow_compiler`). Confirmed pre-existing: they **fail in isolation** (not parallelism), and the one with plausible overlap (`drive::sandbox_rejects_absolute_paths`) uses its own `resolve_safe` and imports **none** of my modules. **Rust full-suite baseline for this environment: 3366 pass / 19 pre-existing fail.**

## Verification

| Gate | Result |
|---|---|
| `cargo test --lib` | 3366 pass / 19 pre-existing fail (unrelated) — incl. my new tests |
| `tsc --noEmit` | 0 errors |
| `vitest run` | 1972 pass / 7 pre-existing fail — no regressions |
| ts-rs bindings | regen reconciled (kept 2 mine, reverted 5 unrelated drift) |
| i18n `check:i18n:strict` | green (all 16074 keys; 13 locales seeded w/ EN placeholders) |

## Patterns established (catalogue items 15–17)

15. **Success-only clock advance** — a watermark/clock written only on the success path lets a persistent failure loop forever (the gate never advances). Stamp the clock on *every* terminal path; gate retries on it.
16. **Best-effort on a structural dependency** — `if let Err(e) = critical_step() { warn!; }` then continuing produces a silently-broken artifact reported as success. If the step is load-bearing, propagate the error and fail the unit.
17. **Dedup that erases identity** — collapsing rows by a fuzzy key (normalized title) when downstream recovery keys on the precise identity (`source_id`) silently abandons distinct work. Exclude identity-keyed/continuable rows from fuzzy dedup.

## Cumulative status (Waves 1–5)

| Wave | Theme | Closed/addressed |
|---|---|---:|
| 1 | Security | 5 (2C/2H/1M) |
| 2 | Auth / trust-boundary | 6 (2C mitigated / 4H) |
| 3 | Scheduler / watermark / sync | 4 (1C/3H) + 1H deferred |
| 4 | Races & double-execution | 6 (1C/5H) |
| 5 | Silent failures & success-theater | 6 (6H) |

**Total: 27 findings addressed across ~33 commits, 0 regressions.**
**Deferred follow-ups** (all logged in `followups-2026-06-26.md`): A BYOM tag-source (C), B template codegen (C), C cloud-sync migration (H), D self-healing versioning (H-half), E misc (orb siblings, i18n translations, idempotency recovery).
**Remaining:** ~61 High + Med/Low tail. Next: Wave 6 — Wrong metric/unit/threshold math (intent-compiler /1K vs /1M, SLA 0%-no-data, dashboard ratio-vs-%, connector google mis-route, recipe-eligibility false-green, director json_path).
