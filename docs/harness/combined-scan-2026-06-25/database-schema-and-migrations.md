# Database Schema & Migrations — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: database-schema-and-migrations | Group: Data & Persistence
> Total: 5 | Critical: 0 | High: 2 | Medium: 2 | Low: 1

## 1. chat_messages role-CHECK probe is contaminated by FK enforcement → destructive table rebuild on every startup
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: non-idempotent migration / runs every boot
- **File**: src-tauri/src/db/migrations/incremental.rs:2039-2070
- **Scenario**: The "does chat_messages support role='system'/'tool'?" probe does `INSERT INTO chat_messages (id, persona_id, session_id, role, content, created_at) VALUES ('__role_check__', '__probe__', '__probe__', 'system', …)` and treats `is_err()` as "migration needed". But `personas_id` is `NOT NULL REFERENCES personas(id)` (schema.rs:1422) and the pool sets `PRAGMA foreign_keys = ON` (mod.rs:136). `'__probe__'` is not a real persona, so the INSERT **always** fails on the FK — never on the role CHECK. `needs_role_migration` is therefore `true` on every launch, even on a fresh DB whose base schema already carries the widened `CHECK(role IN ('user','assistant','system','tool'))` (schema.rs:1424). The block then DROPs and recreates `chat_messages` and copies every row on **every** app start.
- **Root cause**: The idempotency probe conflates two independent constraints (role CHECK vs persona_id FK); FK enforcement makes the probe a permanent false-positive.
- **Impact**: Full O(n) copy of the entire chat history on every launch (scales badly with data). Worse, the copy runs under FK enforcement with no guard (see #2): a single orphaned chat row makes the rebuild abort `run_incremental`, which fails `init_db` — the app then crash-loops on startup, locking the user out of all data.
- **Fix sketch**: Detect support by parsing the stored DDL (`SELECT sql FROM sqlite_master WHERE name='chat_messages'` and check it `contains("'system'")`), exactly like the sibling trigger/executions migrations already do — never use a live INSERT against an FK-constrained table as a probe.
- **Value**: impact=7 effort=2

## 2. Non-atomic credential blob→field migration + unconditional blob clear → permanent secret loss on a mid-loop crash
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: non-transactional migration / data loss on upgrade
- **File**: src-tauri/src/db/migrations/incremental.rs:905-915 (helpers.rs:9-165)
- **Scenario**: `migrate_blob_credentials_to_fields` decrypts each credential's JSON blob and inserts its fields one-by-one in a plain loop with **no transaction** (helpers.rs:58-124). Its re-run guard is `WHERE NOT EXISTS (SELECT 1 FROM credential_fields WHERE credential_id = c.id)` (helpers.rs:15-17). Immediately after, `clear_legacy_credential_blobs` empties `encrypted_data`/`iv` on any credential that has **at least one** field row (helpers.rs:149-165). If the process is killed/crashes after field A is committed but before fields B/C for a multi-field credential: on the next boot the credential is SKIPPED (a field row already exists), so B/C are never extracted — then the blob is cleared, destroying B/C forever.
- **Root cause**: Per-credential extraction is not atomic, and the "already migrated" guard keys on *existence of any* field row rather than *completeness*; the blob-clear step trusts that guard.
- **Impact**: Permanent, unrecoverable loss of credential secrets (the user can no longer authenticate that connector; the encrypted source is gone). High-impact because these are the app's secrets store.
- **Fix sketch**: Wrap each credential's full field-set extraction in a single transaction (all fields commit or none), or gate `clear_legacy_credential_blobs` on a field-count == expected-key-count check, or run migrate+clear inside one `unchecked_transaction`.
- **Value**: impact=8 effort=3

## 3. QueryBuilder LIMIT/OFFSET rely on a positional param assumption that silently mis-binds
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: dynamic-SQL param indexing
- **File**: src-tauri/src/db/query_builder.rs:269-291 (limit/offset at 217-228)
- **Scenario**: `limit()`/`offset()` push a bound param but `build_clauses()` recomputes their `?N` indices from `self.params.len()` at build time, assuming they are the last 1–2 params. Two failure modes: (a) `offset()` without `limit()` emits **no** LIMIT/OFFSET clause yet still leaves the offset value in `params` — `params_ref()` then returns one more value than there are `?` placeholders, so rusqlite errors "wrong number of parameters" at query time. (b) If any `where_*`/`push_param` is added *after* `limit()/offset()` (the fluent API allows it), `total-1`/`total` point at the wrong params, binding a filter value as LIMIT/OFFSET (wrong page size / wrong row window).
- **Root cause**: LIMIT/OFFSET indices are derived from final param count instead of being captured when the value is pushed (as every other clause does).
- **Impact**: Silent runtime query failures or incorrect pagination depending on caller call-order; no compile-time or runtime guard signals the misuse.
- **Fix sketch**: Capture the placeholder index at `limit()`/`offset()` push time (store `Option<usize>` like other clauses); emit OFFSET only alongside LIMIT, or reject offset-without-limit explicitly.
- **Value**: impact=5 effort=3

## 4. QueryBuilder order_by interpolates column + direction directly — injection safety rests on an unenforced caller contract
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: SQL injection surface / undocumented invariant
- **File**: src-tauri/src/db/query_builder.rs:201-214
- **Scenario**: `order_by(col, dir)` and `order_by_multiple(...)` build `format!("ORDER BY {col} {dir}")` with no parameterisation, allowlist, or assertion. The module doc says callers "must validate" column names, but nothing in the builder enforces it. Any call site that forwards a user/agent-supplied sort column or direction (common for list endpoints with `?sort=` style params) yields direct SQL injection — e.g. `dir = "; DROP TABLE …"` or a correlated subquery in `col`.
- **Root cause**: A security-critical invariant (columns/directions are pre-validated) is documented but not structurally enforced, so it silently degrades the moment one caller forgets.
- **Impact**: Latent injection on the read path; in this Tauri app the same SQLite handle holds all persona/credential data, so a single unvalidated sort param is a full-DB compromise.
- **Fix sketch**: Have `order_by` accept a typed direction enum (Asc/Desc) and validate `col` against a per-call allowlist (or `debug_assert!` an identifier regex); reject anything else rather than interpolating.
- **Value**: impact=6 effort=4

## 5. retire_persona_groups never reports "applied" — its DDL body re-executes on every startup
- **Severity**: Low
- **Lens**: ambiguity-guardian
- **Category**: migration-versioning semantics / per-boot cost
- **File**: src-tauri/src/db/migrations/incremental.rs:3285-3322
- **Scenario**: This step sets `already_applied: |_conn| Ok(false)`, so `run_step` always runs the body. Every launch it re-issues `DROP INDEX IF EXISTS …` ×3, `has_column` probes, `UPDATE personas SET group_id = NULL`, `ALTER … DROP COLUMN`, and `DROP TABLE IF EXISTS persona_groups`. The inner `has_column` guards make it a no-op after the first run, but it is the only migration in the file that never short-circuits — a versioning-semantics smell that obscures "is this migration done?" and pays repeated catalog scans/DDL parses on the hot startup path.
- **Root cause**: The completion signal was hard-coded to `false` instead of a positive predicate (e.g. `Ok(!has_column(conn,"personas","group_id")? && !has_table(conn,"persona_groups")?)`).
- **Impact**: Minor per-boot overhead and reduced auditability; a future edit to the body would silently run on every user's DB rather than once.
- **Fix sketch**: Replace `Ok(false)` with a predicate that returns `true` once `personas.group_id` and the `persona_groups` table are gone, so the step is genuinely one-shot and self-documenting.
- **Value**: impact=3 effort=1
