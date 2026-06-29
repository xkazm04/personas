# Combined-scan follow-ups — escalated, deferred with user approval (2026-06-26)

These two Critical findings have honest **interim mitigations committed** (Wave 2) but full
**enforcement is deferred** because each needs work beyond a code-only wave. User chose
"defer both, continue" at the Wave 2 gate. Revisit after the C+H working set.

## A. BYOM compliance enforcement — needs a persona "workflow tag" source (PRODUCT DECISION)
- **Finding:** `settings-and-byom.md` #1 (Critical). `byom.rs::evaluate` is called with `persona_tags = &[]` (runner/mod.rs:1271), so compliance rules with `workflow_tags` never match → fail open.
- **Interim mitigation (done, commit `86c383ec3`):** `validate()` emits a *blocking* `Error` PolicyWarning for any enabled compliance rule with `workflow_tags`, so an admin can no longer silently save a no-op control.
- **To enforce for real:** decide what feeds `persona_tags` (candidates: persona `template_category`, a new explicit `tags` field, or the bound use-case), thread it into `runner/mod.rs:1271`'s `evaluate(...)` call, then the existing rule-matching enforces. **Needs the user to define the tag source.**
- **Also pending (cosmetic):** mirror the two new `validate()` checks into the TS helper `src/features/settings/sub_byom/libs/byomHelpers.ts::validateByomPolicy` for inline per-rule UI parity (~2 lines each).

## B. Template-integrity enforcement — needs a codegen change (AUTONOMOUS BUT MULTI-STEP)
- **Finding:** `persona-templates.md` #1 (Critical). `check_template_integrity` is inert: `CHECKSUM_MANIFEST` is keyed by full file path + whole-file hash, but callers pass a bare id + payload-only JSON, so `is_known_template` is always false and the tamper-reject is unreachable.
- **Interim mitigation (done, commit `8e97617e3`):** corrected the false "this catches tampered templates" comment to state the check is advisory.
- **To enforce for real (do NOT naive-rekey — it re-bricks Presets):**
  1. In `scripts/generate-template-checksums.mjs`, emit a *second* map keyed by template `id` over `computeContentHashSync(JSON.stringify(parsed.payload))` (payload, not whole file).
  2. Run `node scripts/generate-template-checksums.mjs` to regenerate both `templateChecksums.ts` and `src-tauri/src/engine/template_checksums.rs` (111 payload hashes — cannot be hand-faked).
  3. Add `verify_template_payload(id, payload_json)` in Rust using the id-keyed map; point `check_template_integrity` at it.
  4. Re-enable the `is_known_template && !valid` hard reject. Unknown/dynamic ids (e.g. "Dev Clone") keep warn-and-allow → no brick.
  - Gotcha: JS `JSON.stringify` insertion-order vs Rust serde key ordering must agree end-to-end, and the hashed bytes must be the same payload the caller passes. Verify a known template round-trips before enabling the reject.

## C. Cloud-sync in-place-mutation resync — needs a migration (Wave 3 deferral, High)
- **Finding:** `cloud-sync-and-deployment.md` #1 (High). The 5 in-place-mutating sync tables (`persona_executions`, `persona_events`, `persona_messages`, `persona_metrics_snapshots`, `persona_healing_issues`) key BOTH the watermark and the resync filter off the immutable `created_at`, so any mutation (status running→done, `is_read` flip, issue resolve) landing >24h after creation never re-pulls to the cloud → the dashboard is permanently, silently stale. Local SQLite is authoritative, so this is staleness, not data loss.
- **Why deferred:** confirmed NONE of the 5 tables has an `updated_at`/version column, and many in-place UPDATEs touch no timestamp at all. A correct fix needs a migration.
- **To fix:** (1) add `updated_at` to the 5 tables (incremental migration); (2) bump `updated_at` in EVERY in-place UPDATE in their repos (`executions.rs` model_used/claude_session_id/cache_*/director_score/traceparent; `messages.rs` read_at + metadata; `events.rs` processed_at; `healing.rs` resolved_at; metrics); (3) in `cloud/sync/rows.rs`/`mod.rs`, switch these tables' resync floor clause from `OR created_at > floor` to `OR updated_at > floor` (keep the forward cursor on `updated_at` MAX). A quiet table then returns 0 rows once the cursor passes its max, so no full-table re-push — and this also cures the separate continuous-re-push waste (cloud-sync #2).

## D. Self-healing: version the heal so rollback metrics attribute correctly (Wave 5 partial, High)
- **Finding:** `self-healing-and-auto-rollback.md` #1. **Done now (commit `bdb46428e`):** auto-rollback acquires the healing slot and skips personas with an in-flight heal — the race-clobber is prevented; the false orchestrator doc is corrected.
- **Deferred half:** `apply_db_fixes` UPDATEs the live prompt columns WITHOUT inserting a `persona_prompt_versions` snapshot, so auto-rollback's version-error-rate metrics still attribute history to the *pre-heal* version and can roll the prompt back, silently discarding a heal. To fix: have `apply_db_fixes` snapshot a new production version (demoting the pre-heal one) + record a deployment instant for attribution, atomic with the prompt UPDATE. `create_prompt_version`/`promote_to_production` exist (no migration), but the version-tagging/metric semantics are a decision, not a guess. Documented inline as a known gap.

## F. Drive: wire a real Google Drive backend or remove the unused OAuth helper (Wave 15 deferral, High)
- **Finding:** `google-drive.md` #1. **Done now (commit `289cb546c`):** the three user-facing strings + the `drive.rs`/`drive.ts` docs now state plainly the plugin is a managed *local* sandbox (`app_data_dir/drive`), not a cloud Google Drive account, with no remote sync/backup — so the durability/security-model confusion is closed for users and reviewers.
- **Deferred half (PRODUCT DECISION):** `src-tauri/src/engine/google_oauth.rs` resolves a client_id/secret but is never called by any `drive_*` command — its presence implies auth-scoped remote access the plugin doesn't have. Either (a) wire `google_oauth.rs` into a genuine Drive API backend (real scopes/tokens/sync), or (b) remove it from this context bundle so it stops implying remote access. Do NOT touch the `gdrive_*` MCP tools or the `google_drive` connector — those are the *real* Drive integration and are correct. The full context identifier rename ("Local Drive (managed sandbox)") was also left out to avoid id/routing ripple.

## G. i18n RTL layout-CSS mirroring (Wave 15 deferral, follow-on to a closed High)
- **Finding:** `internationalization-i18n.md` #1. **Done now (commit `a333689f2`):** `applyLangAttributes` sets `document.documentElement.dir` from the locale manifest, so Arabic gets the browser's intrinsic RTL flow (bidi, default text-align, caret, form-control direction) and the manifest `dir` field is finally live.
- **Deferred half:** there is no global `[dir="rtl"]` mirroring CSS and layouts use physical properties (`margin-left/right`, `left/right`, paddings), so directional spacing/positioning won't auto-mirror under RTL. To finish: migrate layout spacing to CSS logical properties (`margin-inline-start`/`-end`, `inset-inline-*`) or add `[dir="rtl"]` override rules; sweep the sidebar/drawer/icon-margin offenders. Mechanical but broad — its own pass.

## H. tauri-ipc: server-side idempotency for blocking mutations (Wave 15 deferral, follow-on to a closed High)
- **Finding:** `tauri-ipc-bridge-and-api.md` #2. **Done now (commit `82aabc4e8`):** long blocking mutations (`system_ops_run_now`, `remote_command_approve`, `project_tracking_run_now`) get a 30-min timeout ceiling so the IPC waits for the real result instead of orphaning at 90s; the at-least-once hazard is documented and `InvokeTimeoutError.backendMayStillBeRunning` lets callers avoid a blind retry.
- **Deferred half:** the durable fix is a backend idempotency contract — have the Rust side dedupe mutating commands on `(command, client-supplied key)` across retries (or convert long mutations to return-id-then-poll so the IPC call itself is short). `execute_persona` already does key-dedup and was deliberately left off the timeout allowlist (its retry-reuse window in `executionSlice.ts` is delicate) — model the general contract on it. Until then, retrying a timed-out mutation that isn't on the allowlist remains unsafe.

## E. Misc small follow-ups (low priority)
- **Orb decision sibling wrappers** (`useDecisionQueue.ts`): the incident `dismiss` and `messageAttentionToDecision` `engage`/`mark_read`/`dismiss` wrappers still `silentCatch`-and-return — same false-"done" pattern fixed for approve/reject/review in `532636998`. Apply the same re-throw.
- **Team-handoff i18n**: the 5 new `templates.presets.*` keys are seeded into the 13 non-English locales as **English placeholders** (commit `b95dd8e77`); real translations via the `translate-extract`→`translate-merge` workflow. Runtime falls back to English, so no break.
- **Idempotency timeout-recovery** (executionSlice): the stable-key fix recovers the orphan on retry; active no-retry polling/recovery of a running execution (reattach listeners, disambiguate concurrent) is deferred.
