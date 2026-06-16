# Bug Hunter Fix Wave 6 — Next highest-blast-radius criticals

> 5 criticals closed across 5 commits, 0 regressions.
> Data corruption / autonomous-cost / consent: a wrong-target credential write,
> a wrong-memory delete, a consent success-theater, a duplicate-autonomous-turn
> cost loop, and a persona-row clobber.
> Baseline preserved: `tsc --noEmit` 0 → 0, `cargo check --features desktop` 0 → 0.
> The 5 pre-existing vitest failures are unrelated and unchanged.

## Commits

| # | Commit | Finding closed | File |
|---|---|---|---|
| 1 | `11b470d20` | agent-lab-versions #1 — activateVersion wrong-target write | `src/stores/slices/agents/labSlice.ts` |
| 2 | `d4b4f0a3f` | knowledge-base-memories #1 — conflict deletes wrong memory | `src/features/overview/sub_memories/components/MemoryConflictReview.tsx` |
| 3 | `a708ed2ad` | approvals-decisions #1 — orb consent success-theater | `src/features/plugins/companion/decision/resolveDecision.ts` |
| 4 | `cca14c950` | companion-brain-proactivity #1 — wake-gate re-entry | `src-tauri/src/companion/proactive/execution_review.rs` |
| 5 | `e6da73ac9` | build-sessions-personamatrix #1 — simulate clobbers design_context | `src-tauri/src/commands/design/build_simulate.rs` |

## What was fixed

1. **`activateVersion` wrong-target write.** It rolled the prompt onto `personaId` but merged the new model into `get().selectedPersona?.model_profile` — whatever the UI had selected, not necessarily `personaId`. When they differ (deep-link, multi-tab, concurrent `selectPersona`, a ratings row whose persona ≠ selection), the target persona was written with *another* persona's `base_url`/`auth_token`/cache policy — silent credential/endpoint cross-contamination. Now sources the profile from `get().personas` by id; starts clean if the target isn't loaded rather than inheriting the wrong one.
2. **Memory conflict deletes the wrong memory.** `keep_a`/`keep_b` mapped to a positional `deleteMemory`, while the `superseded` kind deliberately swaps memoryA/memoryB — so any reorder silently flips every user's outcome, with no assertion that the deleted id ≠ the kept id, no undo (hard delete), and core (pinned) memories deletable. Now resolves to explicit keep/remove, asserts `keep.id !== remove.id`, and refuses to delete a core-tier memory.
3. **Orb consent success-theater.** `runDecisionOption` fired the approve/reject fire-and-forget, then synchronously cleared the decision and recorded "resolved" — swallowing rejections. A failed consent action left the user believing they approved/denied while the system did neither, and the decision vanished (no retry). Now awaits `run()`, clears/records only on success, and on failure keeps the decision pending + surfaces an error.
4. **Wake-gate re-entry (autonomous cost loop).** `review_recent_executions` gates on `MAX(created_at)` of `athena_wake_log`, but `log_wake` is written only after the multi-minute triage CLI turn — so a turn longer than the 5-min tick let the next tick re-pass the gate and spawn a second concurrent triage (double $/token, racing cursor advances). Now holds a per-surface `InflightGuard` lease for the whole pass; overlapping calls early-return.
5. **Simulate clobbers `design_context`.** The dry-run wrote a stripped snapshot onto the shared persistent persona column and relied on a later promote to overwrite it; abandoning the draft left the persona pointing at the throwaway (losing live triggers/channels/policies), and concurrent same-persona sims raced on the column. Now a `DesignContextRestore` RAII guard restores the prior context on every exit path, and a per-persona async lock serializes same-persona sims.

## Verification (before / after)

| Gate | Baseline | After Wave 6 | Notes |
|---|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors | 3 frontend fixes. |
| `cargo check --features desktop` | 0 errors | 0 errors | 2 Rust fixes verified together. |
| `vitest run` | 5 pre-existing failing | 5 (same) | Unchanged. |

No regressions introduced.

## Cumulative status (across all waves)

| Wave | Theme | Criticals closed | Commits |
|---|---|---:|---|
| 1 | Concurrency / missing-CAS double-execution | 5 | `c3ab4aa7f` `6e960f1b5` `fa326eb14` `9d1de3d78` `0ff899369` |
| 2 | Security & trust-boundary | 5 | `b8f759842` `a3eebc13c` `a02e21210` `34a3fc3f3` `a0b13eaec` |
| 3 | Data-loss: watermark/cursor | 3 | `906645e6d` `d39a6f503` |
| 4 | Recovery/healing & execution-runtime | 4 | `141fab909` `6acedb8f1` `965e3449e` |
| 5 | Highest-blast-radius remaining | 5 | `0cc857b18` `8a7c10d7a` `c6ff22739` `4ed373a17` `1383a2ff6` |
| 6 | Next highest-blast-radius | 5 | `11b470d20` `d4b4f0a3f` `a708ed2ad` `cca14c950` `e6da73ac9` |

Criticals closed: **27 / 42**. Findings closed overall: **27 / 260**.

## Patterns established (catalogue additions, items 19–20)

19. **A function taking an id must source related state from that id, not ambient selection.** `f(targetId)` that reads `selectedX`/current-UI state assumes selection == target; when they diverge it operates on the wrong entity (here, writing one persona's credentials onto another). Load the related state *by the explicit id*, or assert selection == id and bail.
20. **Restore shared mutable state you borrowed — on every exit path (RAII).** Writing a throwaway value onto a shared, persistent column for the duration of an operation must be undone on success, error, AND early-`?`-return; use a Drop guard, and serialize concurrent users of that column so the borrow/restore can't interleave.

## What remains

15 criticals across the other themes (see `INDEX.md`): genome fitness-scale mismatch, mcp JSON-RPC id desync, connector stale-readiness, credential-design negotiator stub clobber, design-reviews missing-nodes crash, recipes curation-never-fires, persona-templates checksum-dead, fleet broadcast success-theater, companion stale-session retry wrong-text, cockpit TTS overlap, google-drive copy-overwrite, research-lab cross-project leak, personas-twin shared-slice overwrite, onboarding skip-marks-complete. Plus the full High/Medium tail. All resumable from `INDEX.md`.
