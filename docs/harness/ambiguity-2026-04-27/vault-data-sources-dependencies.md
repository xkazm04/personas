# Ambiguity Audit — Vault Data Sources & Dependencies

> Total: 12 findings (2 critical, 5 high, 4 medium, 1 low)
> Files read: ~22
> Scope: Database connection management UI (sub_databases) and credential dependency / blast-radius graph (sub_dependencies)

## 1. `escapeSqlStringLiteral` strips a regex character class that was almost certainly meant to filter control characters

- **Severity**: critical
- **Category**: undocumented-decision
- **File**: src/features/vault/sub_databases/introspectionQueries.ts:51-58
- **Scenario**: Both `escapeSqlStringLiteral`, `escapePostgresIdent`, and `escapeMysqlIdent` open with `value.replace(/[ -]/g, '')`. The character class `[ -]` is a single-character range `' '..'-'` (i.e., it strips spaces, `!`, `"`, `#`, `$`, `%`, `&`, `'`, `(`, `)`, `*`, `+`, `,` and `-`). The header comment claims it disallows control characters, but no control character is in `[ -]`.
- **Root cause**: The class was almost certainly intended to be `[\x00-\x1F]` (or similar) and was corrupted at some point — possibly a Windows line-ending or copy/paste mishap. Nothing in the repo asserts what it is *supposed* to filter.
- **Impact**: Table names containing spaces, hyphens, or any printable ASCII below `.` are silently mutated before being sent to the catalog query, producing zero-row results that contradict the comment immediately above (which calls out the prior strip of `[^a-zA-Z0-9_]` as a bug). Worse, true control characters pass through untouched.
- **Fix sketch**:
  - Replace with the intended range: `value.replace(/[\x00-\x1F\x7F]/g, '')`.
  - Add a unit test asserting that `'My Table'` and `users-prod` round-trip unchanged.
  - Document in a comment what the regex is supposed to reject.

## 2. `getSelectAllQuery` Redis branch interpolates the table name without escaping

- **Severity**: critical
- **Category**: edge-case
- **File**: src/features/vault/sub_databases/introspectionQueries.ts:104-106
- **Scenario**: For `redis`, the function returns `` `SCAN 0 MATCH ${tableName}* COUNT 100` `` with no escaping of glob metacharacters or whitespace. The Postgres / MySQL / SQLite / Convex branches all defensively escape; Redis is the lone exception.
- **Root cause**: There is no documented contract for what `tableName` may contain when called for Redis (it is actually a key prefix). Whether `*`, `?`, `[`, spaces, or backslashes are allowed is undocumented.
- **Impact**: A user who right-clicks a Redis key called `users:42 ` (trailing space) or `cache[*]` and chooses "copy SELECT all" gets a malformed `SCAN ... MATCH cache[*]* ...` that errors at runtime — or, worse, silently matches the wrong glob. Trade-off between "key prefix" semantics and "exact key match" is not stated anywhere.
- **Fix sketch**:
  - Decide and document: is the Redis input a glob prefix (escape no metas) or a literal (escape `*?[]\`)?
  - Apply the chosen escaping symmetrically with the SQL families.

## 3. `WITH` mutation detection has no nesting limit and ignores parentheses

- **Severity**: high
- **Category**: edge-case
- **File**: src/features/vault/sub_databases/safeModeUtils.ts:60-65
- **Scenario**: When the leading keyword is `WITH`, the code strips literals and runs a flat regex for `DELETE|UPDATE|INSERT|MERGE|REPLACE|TRUNCATE|UPSERT` anywhere in the body. There is no awareness of nested CTEs, parenthesized read-only subqueries that mention these words inside identifier-like positions, or the `RETURNING` keyword.
- **Root cause**: The mirroring of the Rust backend rule is asserted in a comment but no test pins the boundary cases. "Looks like a mutation" is encoded as a regex but the boundary conditions for a false positive vs. false negative are not written down.
- **Impact**: False positives: a benign read-only `WITH x AS (SELECT * FROM updates_log) SELECT ...` triggers the confirmation dialog because of the table name. False negatives are still possible if the mutation verbs are split across stripped regions. Users will learn to dismiss the dialog reflexively, defeating the safe-mode UX.
- **Fix sketch**:
  - Add a fixture-driven test set covering: tables named `updates`, `inserts_audit`, `deletes_archive`; nested CTEs; CTEs with `RETURNING`.
  - Document explicitly that this is a UX hint and the backend is the source of truth.
  - Consider lifting just the mutation verbs that appear at the start of a parenthesized clause `\(\s*(DELETE|UPDATE|...)`.

## 4. `simulateRevocation` is invoked with an empty workflows array, hard-coding "no workflows ever break"

- **Severity**: high
- **Category**: implicit-assumption
- **File**: src/features/vault/sub_dependencies/CredentialRelationshipGraph.tsx:86
- **Scenario**: The hook calls `simulateRevocation(selectedNodeId, graph, [], healthSignals, credentials)` — the third argument (workflows) is hard-coded to `[]`. The function uses that array to detect broken workflows and to escalate the severity to `'critical'`. With `[]`, severity can never reach `'critical'` and `affectedWorkflows` is always empty.
- **Root cause**: The workflow store integration was never wired up. Nothing in the file or the type signatures documents that this is a TODO; the call site looks intentional. Future readers will not realise the simulator is half-implemented.
- **Impact**: The "Revocation Simulation" panel shows "0 workflows broken" and "Critical" never appears, even when the credential is critical to a workflow. Users get a falsely reassuring answer when running chaos checks against revocation.
- **Fix sketch**:
  - Either pull workflows from the workflows store and pass them through, or
  - Mark the parameter as `TODO`/`unsupported` and gate the workflow UI section behind a feature flag until it is wired.

## 5. Filtered edges include edges where only one endpoint matches the filter, dangling at half-resolved nodes

- **Severity**: high
- **Category**: requirements-unclear
- **File**: src/features/vault/sub_dependencies/CredentialRelationshipGraph.tsx:70-73 and src/features/vault/sub_dependencies/GraphCanvas.tsx:96-109
- **Scenario**: `filteredEdges` keeps any edge where `nodeIds.has(e.source) || nodeIds.has(e.target)`. When the filter is set to "agents only", an edge from a credential to an agent is kept, but the credential node is not in `filteredNodes`. `GraphCanvas` then renders edges by looking each endpoint up in the *unfiltered* `nodes` array, masking the inconsistency — the credential silently appears in the relationships list but not in the node list above it.
- **Root cause**: There is no recorded decision for what the filter is supposed to express. "Show only agents" can mean "agents and the things they connect to" or "only agent-to-agent edges", and the code does the former by accident.
- **Impact**: When a user filters to a single kind, the relationship list near the bottom right shows objects of other kinds that were filtered out, contradicting the filter pill. This is confusing and discourages trusting the filter.
- **Fix sketch**:
  - Either: filter edges to require BOTH endpoints in `filteredNodes`, OR
  - Promote endpoint-of-filtered-edge nodes to a "context" rendering in the node list with reduced opacity.
  - Document the chosen behaviour in a comment on `filteredEdges`.

## 6. `dailyBurnRate` is summed as if it were the daily revenue impact, but the unit is documented only as `$` — assumption is hidden

- **Severity**: high
- **Category**: implicit-assumption
- **File**: src/features/vault/sub_dependencies/credentialGraph.ts:218-220, 295-298
- **Scenario**: `estimatedDailyRevenueLost` is computed by summing `dailyBurnRate` across affected personas. The field `dailyBurnRate` comes from `PersonaHealthSignal`. Whether it is a daily cost (negative outflow), revenue produced (positive inflow), or aggregate burn is not stated where it is consumed.
- **Root cause**: The relabel from "burn rate" (cost) to "revenue lost" (a forecast of foregone income) happens only at the consuming site. No comment justifies the equivalence.
- **Impact**: The simulator panel shows "$X.XX daily cost impact" but the underlying number is the cost the agent currently incurs, not necessarily the revenue it produces. Stakeholders making rotation/revocation decisions on this number could conclude the wrong thing.
- **Fix sketch**:
  - Add a comment at line 220 stating exactly what `dailyBurnRate` represents and why summing it is the right proxy.
  - Rename `estimatedDailyRevenueLost` to `estimatedDailyBurnAtRisk` if the source is cost, not revenue.

## 7. Mutation confirmation dialog truncates to 200 chars with no warning

- **Severity**: medium
- **Category**: magic-number
- **File**: src/features/vault/sub_databases/tabs/ConsoleTab.tsx:147 and src/features/vault/sub_databases/tabs/QueryEditorPane.tsx:135
- **Scenario**: Both mutation confirmation dialogs render `pendingMutation.length > 200 ? pendingMutation.slice(0, 200) + '...' : pendingMutation`. The 200-char cap is duplicated, undocumented, and the user is not told they are seeing a truncated preview.
- **Root cause**: A magic number copy-pasted between sibling components with no shared source of truth. The intent (avoid huge dialogs) is reasonable but unstated.
- **Impact**: A 5,000-char `UPDATE ... SET ... CASE WHEN ...` is shown as the first 200 chars + `...`. The user clicks "Execute anyway" believing they verified the whole statement when they only saw the prefix. This is the exact scenario the safe-mode dialog was built to prevent.
- **Fix sketch**:
  - Extract a `MUTATION_PREVIEW_MAX_CHARS = 200` constant in `safeModeUtils.ts`.
  - Add a "(query truncated, N more chars)" hint when truncation occurs.
  - Consider scrolling the full statement instead of truncating.

## 8. NL-to-SQL chat polls the snapshot endpoint forever — no retry cap, no jitter, no failure surfacing

- **Severity**: medium
- **Category**: edge-case
- **File**: src/features/vault/sub_databases/tabs/ChatTab.tsx:74-103
- **Scenario**: After `startNlQuery`, a `setInterval(..., 800)` polls `getNlQuerySnapshot`. If the snapshot call throws, the catch block silently swallows the error and the polling continues. There is no maximum poll count, no escalating backoff, and no UI signal that the connection is unhealthy.
- **Root cause**: The poll loop was designed for a happy path where the backend always responds. The comment "Transient poll failure, keep trying" hides an undocumented assumption that *every* failure is transient.
- **Impact**: If the backend is permanently down (process crashed, IPC channel broken), the spinner stays "generating…" forever, holding `setGenerating(true)` and consuming a timer until the user closes the modal. There is also no upper bound on duration — a 10-minute LLM run cannot be distinguished from a hang.
- **Fix sketch**:
  - Add a `MAX_POLL_ATTEMPTS` (or wall-clock timeout, e.g., 120 s).
  - Track consecutive errors; after N, surface "Connection lost" and `setGenerating(false)`.
  - Document the polling contract (interval, cap, jitter) at the top of the function.

## 9. `dependentsMap` per-credential fetch silently swallows errors as "no dependents"

- **Severity**: medium
- **Category**: trade-off-hidden
- **File**: src/features/vault/sub_dependencies/CredentialRelationshipGraph.tsx:46-52
- **Scenario**: `Promise.all` over `credentials.map(async (cred) => ...)` catches any error from `getCredentialDependents` and stores `[]` for that credential. The user sees nothing different.
- **Root cause**: The trade-off between "fail loudly" and "render the rest of the graph" was made tacitly. No log, no banner, no retry button.
- **Impact**: A backend bug, a permission change, or a malformed credential can cause one credential's dependents to silently disappear from the graph — making blast radius look smaller than reality. This is the exact failure mode the simulator is designed to detect, but the simulator itself can be the victim of it.
- **Fix sketch**:
  - At minimum, count fetch errors and show a single banner ("3 of 47 credentials failed to load dependents — some impact data may be incomplete").
  - Log via `silentCatch`/`toastCatch` rather than bare swallow.

## 10. `failoverSuggestions` matches on `service_type` only, ignoring whether credentials are healthy

- **Severity**: medium
- **Category**: requirements-unclear
- **File**: src/features/vault/sub_dependencies/credentialGraph.ts:301-308
- **Scenario**: Failover candidates are *any* credential of the same service type, including ones whose `healthcheck_last_success` is `false`. The UI does render a red `XCircle` for those, but they are still listed as suggestions and the `MitigationSummary` only checks `f.healthOk === true` for one of its bullets.
- **Root cause**: It is unclear whether unhealthy alternates should be presented as failover candidates at all. There is no documented rule for ranking, deduping, or filtering.
- **Impact**: An ops user revoking credential A might pick credential B from the failover list without noticing the red icon, swap traffic onto a credential they already know is broken, and cause a worse outage. The list ordering is also unstable (whatever order the credentials store returned).
- **Fix sketch**:
  - Sort: healthy first, untested second, failing last (or hidden).
  - Add an explicit comment on what "candidate" means.
  - Consider filtering out `healthOk === false` entirely or marking them as "unsuitable".

## 11. Query history is capped at 10 entries with no UI affordance — and history is per-mount, lost on tab change

- **Severity**: medium
- **Category**: undocumented-decision
- **File**: src/features/vault/sub_databases/tabs/ConsoleTab.tsx:50-53
- **Scenario**: `setHistory((prev) => [{ query: text, timestamp: Date.now() }, ...filtered].slice(0, 10))`. The `10` is undocumented, deduping is by exact string match (whitespace-sensitive), and the entire array lives in `useState` — closing and reopening the modal loses it.
- **Root cause**: The product question of "should query history persist" was deferred. The 10-cap, the dedupe semantics, and the lifetime are all undocumented choices.
- **Impact**: Two adjacent expectations clash silently: the user assumes the "Recent" pill row is durable history, but it disappears on modal close. They also can't tell why a slightly-edited query doesn't displace the old one.
- **Fix sketch**:
  - Document or extract `HISTORY_MAX = 10`.
  - Either persist via the vault store (preferred) or rename the row to "Session recents" so users don't expect persistence.
  - Normalise whitespace before dedupe.

## 12. `extractErrorMessage` exists in two slightly different copies

- **Severity**: low
- **Category**: missing-docs
- **File**: src/features/vault/sub_databases/tabs/ConsoleTab.tsx:11-19 (duplicate of safeModeUtils.ts:71-78)
- **Scenario**: `ConsoleTab` defines a local `extractErrorMessage` byte-identical to the exported one in `safeModeUtils.ts`, except the local one has a different inline comment in the catch block. `ChatTab.tsx` and `QueryEditorPane.tsx` both import the version from `safeModeUtils`.
- **Root cause**: Probably an artefact of factor-out-but-don't-delete refactor. No comment explains why the duplicate exists.
- **Impact**: Future fixes (e.g., recognising new error shapes from Tauri) will be applied to one copy and not the other. Drift is silent because both tests pass.
- **Fix sketch**:
  - Delete the local copy and import the shared one.
