# api/vault — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 1 high / 2 medium / 2 low)
> Context group: Core Libraries & State | Files read: 15 | Missing: 0

## 1. Abandoned module split: dbSchemaExec/dbSchemaQueries/dbSchemaTables fully duplicate dbSchema.ts with zero importers
- **Severity**: High
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/api/vault/database/dbSchemaExec.ts:1 (also dbSchemaQueries.ts, dbSchemaTables.ts)
- **Scenario**: Someone started splitting the dbSchema.ts monolith into exec/queries/tables modules but never rewired a single importer — all 12 consuming files (databaseSlice.ts, useQueryDebug.ts, useTableIntrospection.ts, useSchemaProposal.ts, the sub_databases tabs, tests) still import from `@/api/vault/database/dbSchema`. A repo-wide grep for `dbSchemaExec|dbSchemaQueries|dbSchemaTables` in src/ matches only the store field name `dbSchemaTables`, never the modules.
- **Root cause**: Split was committed without the follow-through step (rewire imports, delete the monolith), leaving two live copies of every wrapper (`classifyDbQuery`, `executeDbQuery`, `startQueryDebug`, `cancelQueryDebug`, all saved-query and schema-table CRUD, introspection).
- **Impact**: Classic drift hazard: a fix to a wrapper signature or command args in dbSchema.ts silently leaves stale duplicates behind (dbSchemaTables.ts already diverges stylistically with inline `import("...").QueryResult` types). ~100 duplicated lines with no runtime value.
- **Fix sketch**: Pick a direction and finish it. Cheapest: delete the three split files (they are pure duplicates, statically imported nowhere). Or complete the split: repoint the 12 importers at the three modules, delete dbSchema.ts. Either way `tsc` is the gate; no dynamic-import usage exists for these paths.

## 2. Four dead API wrappers with no non-test callers
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/api/vault/credentials.ts:119 (also credentials.ts:88, rotation.ts:59, database/vectorKb.ts:83)
- **Scenario**: `getCredentialAuditLogGlobal`, `migratePlaintextCredentials`, `getOAuthTokenMetrics`, and `kbListExtractionRuns` are exported but a src-wide grep (excluding __tests__) finds only their definitions — no feature, hook, or store imports them.
- **Root cause**: Frontend surfaces for these commands were removed or never built (global audit view, plaintext migration UI, per-credential token-metric chart, extraction-run history) while the IPC wrappers stayed behind.
- **Impact**: Dead exports keep their Rust command counterparts looking "used" and inflate the API surface a reader must understand; tests exercise wrappers nothing calls. Verification needed only that no dynamic `invoke` bypass exists (unlikely — all frontend IPC goes through these typed wrappers).
- **Fix sketch**: Delete the four wrappers plus their unit-test cases. Then check whether the backing Rust commands (`credential_audit_log_global`, `migrate_plaintext_credentials`, `get_oauth_token_metrics`, `kb_list_extraction_runs`) have any other caller (engine subscriptions, CLI) before pruning them too — that half needs cross-context verification.

## 3. Unbounded `list_all_credential_events` fetch — API offers no limit and the store loads every event
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: unbounded-fetch
- **File**: src/api/vault/credentials.ts:42
- **Scenario**: `credentialSlice.fetchCredentialEvents` calls `listAllCredentialEvents()` and stores the full result. Credential events are append-mostly audit-style rows (create/update/healthcheck outcomes); after months of daily healthcheck sweeps across ~24 credentials this table grows without bound, and every vault open re-serializes the whole history across IPC into Zustand.
- **Root cause**: The wrapper (and presumably the Rust command) takes no `limit`/`since` parameter, unlike the sibling `getCredentialAuditLog(credentialId, limit?)` which already models capping.
- **Impact**: IPC payload and store memory grow linearly with app age; the UI only ever needs recent events per credential. Slow vault-tab loads on long-lived installs, with the cost paid on a hot path (slice init).
- **Fix sketch**: Add a `limit` (and optionally `sinceIso`) arg to `list_all_credential_events` on the Rust side (rusqlite `ORDER BY created_at DESC LIMIT ?`), thread it through the wrapper, and have `fetchCredentialEvents` pass a sane cap (e.g. 500). Verify no consumer relies on full history before capping.

## 4. NL-query polling ships the full cumulative `lines[]` every tick and the only consumer discards it
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: payload
- **File**: src/api/vault/database/nlQuery.ts:8
- **Scenario**: ChatTab polls `getNlQuerySnapshot` on an interval while an LLM job runs. `NlQuerySnapshot.lines` carries the job's entire accumulated output on every poll, but ChatTab only reads `status`, `generated_sql`, `explanation`, and `error` — `lines` is never touched.
- **Root cause**: Snapshot shape was designed for a streaming-log consumer that this feature does not have; polling re-serializes O(total output) per tick instead of a delta or nothing.
- **Impact**: For a chatty LLM run the per-tick IPC payload grows linearly with output length for the duration of the job — bounded (job-scoped) but pure waste on a UI-latency-sensitive polling loop.
- **Fix sketch**: Either drop `lines` from the snapshot returned by `get_nl_query_snapshot` (if no other caller needs it — the Rust side is the authority), or add a `sinceLine: number` cursor so polls return only new lines. Frontend-only alternative: keep the type but have the backend omit lines unless requested via an `includeLines` flag.

## 5. Mid-file imports in credentials.ts
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/api/vault/credentials.ts:35
- **Scenario**: `import type { BlastRadiusItem } from "@/api/agents/personas"` sits at line 35 between two export groups, and three more type imports (`CredentialAuditEntry`, `CredentialUsageStats`, `CredentialDependent`) appear at lines 110-112 under a section banner.
- **Root cause**: Sections were appended over time with their imports pasted in place instead of hoisted.
- **Impact**: Purely readability — a reader scanning the import block gets an incomplete picture of the module's dependencies; ESLint `import/first` would flag this if enabled.
- **Fix sketch**: Hoist the four `import type` statements to the top import block. Zero behavior change (type-only imports are erased at compile time).
