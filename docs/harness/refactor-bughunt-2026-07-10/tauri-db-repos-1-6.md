> Context: tauri:db/repos [1/6]
> Total: 10
> Critical: 0  High: 0  Medium: 8  Low: 2

## 1. Event search silently never matches encrypted payloads
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src-tauri/src/db/repos/communication/events.rs:1079-1095 (search) vs :92-103 (encrypt_optional_payload) / :476-521 (backfill_slot_times_for_source)
- **Scenario**: A user filters the event stream with `filter.search = "src/main.rs"`. `search()` runs `qb.where_like_any(&["event_type","source_type","payload"], "%src/main.rs%")`. But `publish()` stores `payload` encrypted at rest (`encrypt_optional_payload` → ciphertext + `payload_iv`), and `row_to_event` only decrypts on read. The LIKE therefore matches against ciphertext and returns zero payload hits, even though the term is present. `backfill_slot_times_for_source` proves payloads are encrypted (it decrypts row-by-row precisely because `json_extract`/LIKE can't see into them).
- **Root cause**: `search` assumes `payload` is queryable plaintext; encryption was added to the write path without excluding `payload` from the text search (or adding a searchable plaintext projection).
- **Impact**: UX / success-theater — payload search looks like it works but silently omits the field's real content; users conclude "no matching events."
- **Fix sketch**: Drop `payload` from the `where_like_any` column set (search only `event_type`/`source_type`), or maintain a redacted/plaintext searchable column. At minimum document that payload text is not searchable.

## 2. Subscription dual-write stores trigger config as PLAINTEXT on encryption failure
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: trust-boundary
- **File**: src-tauri/src/db/repos/communication/events.rs:1352-1357 (create_subscription_with_trigger) and :1474-1480 (update_subscription)
- **Scenario**: `create_subscription_with_trigger` encrypts the trigger config with `crypto::encrypt_trigger_config(c).unwrap_or_else(|e| { warn!(...); c.to_string() })` — on any crypto error it silently persists the RAW config. The dedicated trigger path (`triggers.rs::encrypt_config`, :24-29) deliberately does the opposite: it returns `AppError::Internal` because "secrets must never be stored in plaintext." So the same logical write has two contradictory failure contracts; the subscription path is the unsafe one.
- **Root cause**: Copy of the encryption call that swapped a hard error for a best-effort fallback, diverging from the secret-safety contract enforced on the primary trigger path.
- **Impact**: security — a transient KMS/crypto failure writes trigger config in plaintext-at-rest with only a warn log; also produces a row that later `decrypt_trigger_config` will mishandle.
- **Fix sketch**: Route both sites through `triggers::encrypt_config` (propagate the error) instead of `unwrap_or_else(|_| plaintext)`.

## 3. `personas::duplicate` bypasses the name-uniqueness suffixing every other path enforces
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src-tauri/src/db/repos/core/personas.rs:1300-1329 (duplicate) vs :601-629 (create) / :970-998 (update_name)
- **Scenario**: `create` and `update_name` both run an IMMEDIATE-transaction collision loop that appends ` (2)`, ` (3)`… so names stay distinguishable within a project (added specifically because the build LLM emits colliding names). `duplicate` instead does a bare `SELECT ... name || ' (Copy)'`. Duplicating persona "X" twice yields two rows both named "X (Copy)"; duplicating when an "X (Copy)" already exists collides again. There is no DB unique constraint to catch it.
- **Root cause**: The dedup machinery lives in the CRUD helpers; `duplicate` writes via a raw `INSERT ... SELECT` and never calls it.
- **Impact**: UX / maintainability — indistinguishable personas in the sidebar/lists, defeating the very invariant the other two paths pay a transaction to hold.
- **Fix sketch**: After the `INSERT ... SELECT`, reuse the collision-suffix loop (or a shared `next_unique_name(tx, project_id, base)` helper) to rename the copy.

## 4. `update_status` (unguarded) can clobber a terminal/cancelled execution
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: race-condition
- **File**: src-tauri/src/db/repos/execution/executions.rs:673-740 (update_status), used by commands/infrastructure/cloud.rs:606,667 and prompt_lab.rs:244,270
- **Scenario**: The guarded siblings `update_status_if_running` (:748) and `update_status_if_not_final` (:874) exist expressly because "a completion/failure must NEVER overwrite a user cancel" and a late status write can "resurrect the row to running… as a permanent zombie." `update_status` has no `WHERE status = …` guard — it writes unconditionally by id. The cloud-poll loop (cloud.rs:606/667) and prompt-lab paths call this variant, so a result landing just after a user cancels (or after a terminal write) silently overwrites the terminal/cancelled row → lost-cancel / success-theater.
- **Root cause**: An unguarded escape-hatch left in the API alongside the CAS variants; callers on concurrent paths use it.
- **Impact**: data-integrity — a cancelled/failed run can flip back to completed; user Stop is lost.
- **Fix sketch**: Have the cloud-poll and prompt-lab finalize calls use `update_status_if_not_final`; or fold `update_status` into the guarded form with an explicit `force` flag reserved for create-time writes.

## 5. `portfolio_summary` flags goals due *today* as overdue and mixes timestamp shapes
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src-tauri/src/db/repos/dev_tools.rs:1227-1280 (portfolio_summary)
- **Scenario**: `overdue = g.target_date.as_deref().is_some_and(|d| d < now_s.as_str())` compares the goal's `target_date` string against `now_s = Utc::now().to_rfc3339()`. `target_date` is an opaque caller-supplied string (`create_goal` never normalizes it), commonly a date-only `"2026-07-10"` from a date picker. Lexicographically `"2026-07-10" < "2026-07-10T12:00:00+00:00"` is true, so a goal due at end of today is counted overdue from 00:00. A full-RFC3339 `target_date` avoids it, but the format isn't enforced.
- **Root cause**: String comparison across two different timestamp encodings (date-only vs RFC3339) with no normalization.
- **Impact**: UX — at-risk/overdue portfolio counts over-report by up to a day; noisy "trouble floats up" sort.
- **Fix sketch**: Compare on a normalized date (`DATE(target_date) < DATE('now')`) or parse both sides via chrono before comparing; normalize `target_date` on write.

## 6. Dead code in `get_retry_chains_batch` (unused SQL + params, with panicking `.unwrap()`)
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: dead-code
- **File**: src-tauri/src/db/repos/execution/executions.rs:1393-1428
- **Scenario**: `_chain_sql` (:1393) is built and never used. `root_params_boxed` (:1399) is built only to feed `all_params` (:1404-1410), which is also never used — and constructs values via `p.as_ref().to_sql().unwrap().to_owned()` (a latent panic path). The function then rebuilds the real query as `chain_sql` + `chain_params_boxed` (:1413-1428). Verified: neither `_chain_sql` nor `all_params` is referenced after construction.
- **Root cause**: Two aborted attempts at the "two IN clauses" param plumbing left in place next to the working third version.
- **Impact**: maintainability — ~18 lines of misleading dead code plus a stray `.unwrap()` that reads as a live hazard.
- **Fix sketch**: Delete `_chain_sql`, `root_params_boxed`, and the `all_params` block; keep only `chain_sql` + `chain_params_boxed`.

## 7. Triplicated 18-column execution-status UPDATE
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src-tauri/src/db/repos/execution/executions.rs:698-736, 775-813, 912-951
- **Scenario**: `update_status`, `update_status_if_running`, and `update_status_if_not_final` each hand-write the identical ~18-column `SET … = COALESCE(?, …)` statement and identical 17-element `params![…]` binding; only the trailing `WHERE` predicate differs. Any column added to the execution write must be edited in three places in perfect sync (already a bug magnet — see finding #4).
- **Root cause**: Guarded variants were forked by copy-paste rather than parameterizing the `WHERE`.
- **Impact**: maintainability — high drift risk; the three copies must never diverge.
- **Fix sketch**: Extract one `fn exec_status_update(conn, id, input, where_clause: &str)` that owns the shared SET+params; the three public fns supply only their predicate (as `update_status_if_not_final` already does with `format!`).

## 8. Repeated hand-rolled `IN (?1,?2,…)` placeholder boilerplate
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: triggers.rs:81-95 & :1484+, events.rs:1164-1178 & :1258-1274, core/personas.rs:497-512, execution/executions.rs:1345-1360 & :1386-1392
- **Scenario**: The same idiom — `let placeholders: Vec<String> = ids.iter().enumerate().map(|(i,_)| format!("?{}", i+1)).collect(); … join(", ") … params_ref: Vec<&dyn ToSql>` — is re-implemented ≥6 times. Meanwhile `QueryBuilder::where_in` (used in memories.rs, audit_incidents.rs, sla.rs) already does exactly this, so the codebase has two parallel implementations of one operation.
- **Root cause**: Bulk-fetch helpers predate/ignore `QueryBuilder::where_in` and each re-derive the placeholder plumbing.
- **Impact**: maintainability — inconsistent, easy to get the 1-based index off by one; each is a separate injection-surface to audit.
- **Fix sketch**: Route the bulk `IN` fetches through `QueryBuilder::where_in`, or add a small `bind_in(col, &[String]) -> (String, params)` helper and use it everywhere.

## 9. Duplicated DLQ retry/discard UPDATE between single and bulk paths
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src-tauri/src/db/repos/communication/events.rs:756-770 vs 872-886 (retry) and 811-816 vs 943-948 (discard)
- **Scenario**: `retry_dead_letter` and `bulk_retry_dead_letter` embed the byte-identical `UPDATE … SET status='pending', retry_count=retry_count+1, error_message = CASE … WHERE id=? AND status='dead_letter' AND retry_count < ?` statement; likewise `discard_dead_letter` vs `bulk_discard_dead_letter`. The retry-cap/error-message logic is the kind of thing that must stay identical (it's the TOCTOU guard) yet lives in two copies each.
- **Root cause**: Bulk variants were written by pasting the single-row SQL rather than looping the single-row op inside the transaction.
- **Impact**: maintainability — a future change to the retry-cap CASE has to be mirrored or the single/bulk paths silently diverge.
- **Fix sketch**: Extract the UPDATE string as a `const RETRY_DLQ_SQL` / `const DISCARD_DLQ_SQL` (or a `tx`-taking helper) shared by both single and bulk callers.

## 10. Stray `\n` escape embedded in continuation-candidate SQL
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src-tauri/src/db/repos/execution/audit_incidents.rs:529-534 (find_continuation_candidates)
- **Scenario**: The query string mixes line-continuation `\`-joined literals with one embedded `\n` escape mid-string: `"… status = 'resolved' \n             AND source_table IN …"`. It parses to valid SQL (the `\n` is just whitespace), but it's an accidental artifact — every other line uses `\`-continuation, so this one reads as a copy/format slip.
- **Root cause**: An editor/format artifact left in the SQL literal.
- **Impact**: maintainability — cosmetic inconsistency only; no runtime effect.
- **Fix sketch**: Replace the inline `\n` with the same trailing-`\` continuation style as the surrounding lines.
