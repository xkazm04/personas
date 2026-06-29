# Combined-Scan Fix Wave 15 — Final High tail (the last 7 Highs)

> 7 atomic fix-commits, 7 findings closed (all High) — **this empties the High queue: 81/81 closed.**
> Mixed stack (3 Rust, 3 FE, 1 cross-cutting). Dispatched as 6 parallel edit-only subagents (the two tauri-ipc items shared one owner). Baseline preserved/improved: **tsc 0; vitest 1990 pass / 7 pre-existing fail (no regressions, +2 new sync-test cases); cargo recipe_matcher 16/0, twin 20/0 + full lib compile; no ts-rs binding drift**.

## Commits

| # | Commit | Finding | Stack |
|---|---|---|---|
| 1 | `bbc4abdf9` | capabilities #1 (budget UI vs server predicate) | Rust |
| 2 | `289cb546c` | google-drive #1 (local sandbox mislabel) | Rust + FE |
| 3 | `a333689f2` | i18n #1 (Arabic RTL never applied) | FE |
| 4 | `be008d7a8` | recipes #1 (suggestion threshold unreachable) | Rust |
| 5 | `b36de9030` | state-management #2 (design-context selector ref-stability) | FE |
| 6 | `8b8ed74b7` | tauri-ipc #1 (TwinChannelKind enum drift) | FE + Rust |
| 7 | `82aabc4e8` | tauri-ipc #2 (orphaned mutation on timeout) | FE |

## What was fixed

1. **Budget UI showed a number the server didn't enforce.** The frontend pause-gate/badge read `get_all_monthly_spend` (summed `('completed','failed')`, included ops-chat, local-timezone month) while the actual blocking gate `get_monthly_spend` summed `('completed','failed','incomplete','cancelled')`, excluded ops-chat, and used the UTC month — so the UI could block a run the server allowed, or show green while the server rejected. Both now build their WHERE from one shared `MONTHLY_SPEND_PREDICATE` const; per-persona grouping + command signatures unchanged. (Behavior: the UI total is now the UTC calendar month, matching the gate.)
2. **"Google Drive" is a local sandbox, relabeled honestly.** `drive.rs` is a managed local filesystem (`app_data_dir/drive`), no Drive API/OAuth/token/sync, and `google_oauth.rs` is never called by any `drive_*` command — so users risked assuming cloud backup. Reworded the three existing user-facing strings (no new i18n keys) + strengthened the `drive.rs`/`drive.ts` docs to disclaim cloud semantics. Wiring a real Drive backend or removing the unused OAuth helper is **deferred** (product decision).
3. **Arabic now renders RTL.** `applyLangAttributes` set `lang`/`data-lang`/font but never `document.documentElement.dir`, so the manifest's `dir:'rtl'` was dead metadata and Arabic rendered LTR app-wide. It now reads `getLocaleDescriptor(lang).dir` and sets the root `dir` (covered on rehydrate too). A layout-CSS logical-properties mirroring pass is a **noted follow-up**.
4. **Recipe typeahead can actually fire.** Raw set-Jaccard (so "emails"≠"email") gated at 0.90 meant only near-verbatim copies of all three fields cleared the bar, so no chip ever rendered. Added deterministic token normalization (lowercase + light plural stemming, applied to intent + recipe tokens) and recalibrated the threshold to 0.40; +test that a *paraphrased* strong intent fires while an unrelated one stays below.
5. **Design-context selectors have real ref-stability.** The selectors' documented `Object.is` guarantee was backed by a single-slot cache that any sibling parsing a different persona evicted, re-rendering the Design panel on contended `agentStore` ticks. Replaced with a bounded Map LRU keyed by the raw string (cap 32) + a shared frozen empty reference; verified no caller mutates the result; corrected the over-strong doc.
6. **TwinChannelKind enum drift resolved.** TS declared 11 channels but Rust `VALID_CHANNELS` allowed 6, so 6 TS-valid channels were runtime-rejected and `generic` was unusable. Since `telegram`/`teams`/`whatsapp`/`training` are real, actively-called channels and Rust treats `channel` as an opaque label (no branching, no CHECK), **extended Rust** to the full set and trimmed the two dead TS members (`signal`,`other`), adding `generic` — both sides now hold the identical set. +sync test (`enums.test.ts`) so they can't drift again.
7. **Blocking mutations no longer orphan on timeout.** `invokeWithTimeout` rejects on timeout while the backend keeps running, so a long blocking mutation (`system_ops_run_now`, `remote_command_approve`) completes server-side while the user sees a timeout and retries → double-execute. Added a `BLOCKING_MUTATION_TIMEOUTS` allowlist (consulted only when the caller passed no explicit timeout) giving those a 30-min ceiling so the IPC waits for the real result; documented the at-least-once hazard + added a `backendMayStillBeRunning` flag on the timeout error. Full server-side idempotency dedup is the **durable follow-up**.

## Verification

| Gate | Result |
|---|---|
| `tsc --noEmit` | 0 |
| `vitest run` | 1990 pass / 7 pre-existing fail (5 baseline files; +2 new enum sync cases; no regressions) |
| cargo (recipe_matcher / twin) | 16/0 · 20/0 + full lib compile |
| ts-rs bindings | no drift |

## Pattern catalogue (items 44–46)

44. **A displayed metric computed by a different predicate than the gate it mirrors** — when a UI number and the enforcement it represents derive from independently-written SQL (status set, filters, timezone basis), they drift and the control becomes untrustworthy in both directions. Share one predicate fragment between the display query and the gate query.
45. **A compile-time enum union that is a superset of the runtime validator** — when the TS union admits values the Rust handler rejects (and omits one it accepts), passing the type-checker no longer implies the call succeeds, defeating the union's purpose. Make the two sets identical (ideally generate from one source) and pin them with a sync test.
46. **A timeout that rejects but does not cancel the backend** — for a blocking *mutating* command, the reject leaves the mutation running and tempts the user into a double-executing retry. Wait for the real result (long per-command timeout) or make it fire-and-poll; never silently auto-retry a mutation, and signal "may still be running" on the error.

## Cumulative status (Waves 1–15) — Criticals + Highs COMPLETE

| Wave | Theme | Closed/addressed |
|---|---|---:|
| 1–14 | security → plugins/FE tail | 80 (6C/68H, 2C mitigated) |
| 15 | Final High tail | 7 (7H) |

**Total: 87 findings addressed across ~104 commits, 0 regressions** (+1 pre-existing Rust test fixed in W13).
**6/6 scan Criticals fixed-or-mitigated · 81/81 Highs closed.** The Criticals+Highs fix plan the user selected is fully worked.
**Remaining (untouched unless requested):** the Medium/Low tail (~173 findings: 152 Medium + 21 Low) + the deferred-with-recipe items in `followups-2026-06-26.md` (BYOM enforcement, template codegen, cloud-sync resync migration, self-healing heal-versioning, and now: Drive OAuth wire-or-remove, i18n RTL layout-CSS mirroring, tauri-ipc server-side idempotency).
