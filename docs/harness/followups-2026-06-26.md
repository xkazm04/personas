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
