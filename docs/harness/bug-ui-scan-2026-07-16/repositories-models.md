# Repositories & Models — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 0, High: 1, Medium: 3, Low: 1)

## 1. Re-queued executions keep their original `started_at`, so the zombie sweep kills legitimately re-claimed live runs
- **Severity**: High
- **Category**: bug
- **File**: src-tauri/src/db/repos/execution/executions.rs:862 (claim_for_instance), :706-723 (update_status), :1726 (sweep_zombie_executions)
- **Scenario**: An execution is claimed and starts running at T0 (`started_at = T0`). The engine re-queues it (quota cooldown / crash-recovery re-queue, exactly the path `test_claim_expired_is_reclaimable` exercises) via `update_status(Queued)`. 25+ minutes later a driver re-claims it — `claim_for_instance` sets `started_at = COALESCE(started_at, ?4)`, which keeps the stale T0. Six minutes into the fresh run, `sweep_zombie_executions` sees `status='running'` with `started_at` >30 min old and CAS-flips it to `incomplete` ("Execution stalled … marked as zombie") while the CLI process is alive and healthy.
- **Root cause**: `started_at` is treated as write-once (`COALESCE` everywhere, and the Queued transition writes NULL through `COALESCE(?10, started_at)` so it can never be cleared), but the zombie sweep interprets it as "when the *current* run attempt began". The two assumptions are incompatible for any row that transitions running → queued → running.
- **Impact**: State corruption on a live run: the sweep marks it `incomplete`; when the real run finishes, `update_status_if_running` finds status ≠ 'running', returns `false`, and the result (output, tokens, cost) is silently dropped — success theater in reverse, plus a misleading "stalled" notification and possible duplicate re-work.
- **Fix sketch**: In `claim_for_instance`, stamp `started_at = ?now` unconditionally (a claim IS a run start). Additionally, when `update_status` transitions to `Queued`, explicitly NULL `started_at` and the claim columns instead of COALESCE-preserving them.

## 2. Ops-chat exclusion filter uses an unescaped `LIKE '%"_ops"%'` substring on user-controlled input — hides real executions and under-counts the enforced monthly budget
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/db/repos/execution/executions.rs:124, :168, :207, :285, :349, :1685 (MONTHLY_SPEND_PREDICATE)
- **Scenario**: A trigger/webhook payload (stored verbatim in `input_data`) contains any quoted token of the shape `"Xops"` — e.g. the JSON value `"oops"`, `"tops"`, or an escaped nested string `\"oops\"` inside a message body. Because `_` is a single-char wildcard in SQLite `LIKE` (the pattern is not escaped and has no `ESCAPE` clause), `%"_ops"%` matches it. The execution runs and bills normally.
- **Root cause**: The `_ops` marker is matched as a raw substring over free-form, user-controlled JSON with an unescaped `LIKE` wildcard, instead of checking the actual JSON key (`json_extract(input_data, '$._ops')`) or a dedicated boolean column.
- **Impact**: Matching executions silently vanish from every list, search, and count (`get_by_persona_id`, `get_all_global`, `count_all_global`) — the run happened, cost money, but the user cannot see it. Worse, `MONTHLY_SPEND_PREDICATE` (the predicate that BLOCKS runs at the budget cap) excludes its `cost_usd`, so real billable spend leaks past the per-persona monthly budget gate.
- **Fix sketch**: Replace the LIKE heuristic with `json_extract(e.input_data, '$._ops') IS NULL` (or better, an `is_ops_chat` column stamped at creation). At minimum escape the underscore: `LIKE '%"\_ops"%' ESCAPE '\'`.

## 3. Failure-classification substring heuristics misclassify real failures as environmental — circuit breaker can be permanently disarmed
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/db/repos/execution/executions.rs:1020-1027 (count_consecutive_real_failures), :1067-1079 (count_environmental_failures_in_window)
- **Scenario**: (a) A persona genuinely fails 10 times in a row, but its failure output happens to discuss quotas — `output_data LIKE '%usage limit%'` matches LLM-authored text like "check your usage limit settings" — so every failure is excluded and the breaker never trips. (b) A real failure's error message contains "took 1500ms" or "exit code 5002"; `'%500%'` classifies it as an environmental 5xx, inflating the storm-guard count and folding legitimate auto-retries into manual issues.
- **Root cause**: Classification runs unanchored `LIKE` substrings over two free-text fields, one of which (`output_data`) is entirely LLM-generated prose; bare numeric patterns (`%500%`, `%429%`) match token counts, durations, and IDs. The two functions also use different pattern sets, so the same failure can be simultaneously "real" (breaker) and "environmental" (storm guard).
- **Impact**: A persona that should be circuit-broken keeps burning money on retries (breaker disarmed by its own output text); conversely, healthy retries get folded into manual issues during false "storms". Cost and reliability guardrails silently stop matching reality.
- **Fix sketch**: Classify the failure ONCE at write time (the engine already has `error_taxonomy`) into a dedicated `failure_class` column, and have both counters filter on that column; never re-derive class from `output_data` prose.

## 4. Repo layer does not enforce the documented legacy-blob invariant; update path can desync `encrypted_data`/`iv`
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/db/repos/resources/credentials.rs:269-282, :387-395; src-tauri/src/db/models/credential.rs:13-26, :87-92
- **Scenario**: `PersonaCredential`'s docs state the invariant "for every credential with field rows, `encrypted_data == '' AND iv == ''`" and that creates "always set both blob columns to the empty string". But `insert_credential_and_fields_tx` writes caller-supplied `input.encrypted_data`/`input.iv` verbatim while ALSO inserting `credential_fields` rows (the repo test at :1689 even asserts a non-empty blob round-trips). On update, `UpdateCredentialInput.iv` is `skip_deserializing` (always None from IPC) while `encrypted_data` is settable, so an IPC update can rewrite the blob without its nonce — an undecryptable ciphertext/nonce pair.
- **Root cause**: The invariant is enforced only by convention in the command layer plus a startup `tracing::error!` audit; the repo — the actual persistence trust boundary — accepts any combination, and the update input's field asymmetry (settable ciphertext, unsettable nonce) makes a desynced write representable.
- **Impact**: A future caller (or any command-layer regression) silently reintroduces the dual-source-of-truth bug the migration eliminated: readers that still consult the blob get stale/undecryptable secrets, and the only symptom is a startup log line nobody watches.
- **Fix sketch**: Have `insert_credential_and_fields_tx` hard-code `''` for both blob columns whenever `fields` is non-empty (or always), and reject/ignore `encrypted_data` in `update_with_fields` unless `iv` is provided by the command layer in the same call.

## 5. `ExecutionCounts` has no bucket for `cancelled`/`incomplete` — Activity filter badges never sum to Total and zombie-reaped runs are unfilterable
- **Severity**: Low
- **Category**: ui
- **File**: src-tauri/src/db/repos/execution/executions.rs:305-313; src-tauri/src/db/models/execution.rs:191-203
- **Scenario**: A user cancels a run (status `cancelled`) or the zombie sweep reaps a stalled one (status `incomplete`). In the Activity filter bar, `total` includes these rows but the `running`/`completed`/`failed` badges don't (the `match` silently drops them via `_ => {}`), so the badges add up to less than Total, and no filter chip ever surfaces those runs.
- **Root cause**: The status→bucket mapping was designed around three visible buckets, but the schema has five terminal/live statuses (`MONTHLY_SPEND_PREDICATE` itself enumerates `incomplete` and `cancelled`); the mismatch is swallowed by the catch-all arm.
- **Impact**: Visible arithmetic inconsistency in the filter badges (erodes trust in the numbers), and stalled/cancelled executions — precisely the ones a user needs to investigate — are invisible to every status filter.
- **Fix sketch**: Add `cancelled` and `incomplete` counts to `ExecutionCounts` (folding `incomplete` into `failed` is acceptable if the UI treats it that way) and render a badge for them, so buckets partition `total` exactly.
