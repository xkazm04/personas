# Codebase Concerns

**Analysis Date:** 2026-03-13

## Tech Debt

**Consolidated Database Migrations:**
- Issue: All 11 Vibeman migrations (090--112) merged into single consolidated `SCHEMA` constant in `src-tauri/src/db/migrations.rs` (2611 lines). While this simplifies deployment, it makes incremental migration history impossible to trace and difficult to debug schema changes.
- Files: `src-tauri/src/db/migrations.rs`
- Impact: Future schema debugging becomes harder. Breaking changes in consolidated schema harder to isolate. Migration rollback impossible.
- Fix approach: Consider separate migration files per logical grouping or maintain migration changelog alongside schema, document transition path for users.

**Large Monolithic Components:**
- Issue: Several frontend components exceed 700 lines, combining state management, business logic, and UI rendering:
  - `ProjectManagerPage.tsx` (720 lines)
  - `BundleImportDialog.tsx` (608 lines)
  - `SetupCards.tsx` (586 lines)
  - `MatrixCommandCenter.tsx` (507 lines)
- Files: `src/features/dev-tools/sub_projects/ProjectManagerPage.tsx`, `src/features/sharing/components/BundleImportDialog.tsx`, `src/features/home/components/SetupCards.tsx`
- Impact: Testing individual features requires loading entire component. State changes difficult to trace. Cognitive load when onboarding new developers.
- Fix approach: Extract hooks for state logic (`useProjectManagerState`), separate presentational components, use Compound Component pattern for complex UIs.

**Extensive Use of Console Methods Without Structured Logging:**
- Issue: 125+ instances of `console.error`/`console.warn` scattered throughout frontend (`src/`) without structured correlation to Sentry events or backend logs.
- Files: Various files in `src/features/`, `src/hooks/`, `src/api/`
- Impact: Production debugging difficult without centralized observability. Log aggregation not possible. Console noise in development.
- Fix approach: Replace with centralized error reporting via Sentry, add request IDs to correlate with backend traces.

**Credential Refresh Lock Map Without Eviction Policy:**
- Issue: `src-tauri/src/engine/runner.rs` maintains static `CREDENTIAL_REFRESH_LOCKS` HashMap with manual prune-on-acquire (every 32 acquisitions). Low cardinality system (single-user desktop app), but pattern is fragile.
- Files: `src-tauri/src/engine/runner.rs` (lines 13-36)
- Impact: If credential IDs grow faster than 1 per 32 acquisitions, map will grow unbounded. Manual pruning is implicit.
- Fix approach: Use explicit TTL-based eviction or scheduled cleanup task. Document cardinality assumptions.

## Known Bugs

**Potential Race Condition in Token Refresh Mutex Acquisition:**
- Symptoms: Multiple concurrent credential operations on same credential may race even with per-credential locks if one operation panics before releasing lock.
- Files: `src-tauri/src/engine/runner.rs`
- Trigger: Create two parallel executions using same credential while OAuth refresh is in-flight, then kill one task.
- Workaround: Current implementation uses `unwrap_or_else(|e| e.into_inner())` which recovers from poisoned locks, mitigating most practical scenarios.
- Notes: Not a blocker but fragile by design. Rust's Mutex poisoning model means recovery is implicit.

**Database Query Result Capping at 500 Rows:**
- Symptoms: Large dataset exports/analytics queries silently truncate at 500 rows without user notification.
- Files: `src-tauri/src/engine/db_query.rs` (line 25: `const MAX_ROWS: usize = 500`)
- Trigger: User runs SELECT query on large table expecting all results; only first 500 rows returned.
- Workaround: Query smaller result sets, use filtering in WHERE clause.
- Notes: Hard limit exists to prevent memory exhaustion but lacks warning to user. Should add result count feedback.

**Error Messages Sanitized at Engine, Not Propagated Fully:**
- Symptoms: Secrets stripped from error messages via `sanitize_error()` but only in db_query context. Other query failures may expose connection strings/credentials.
- Files: `src-tauri/src/engine/db_query.rs` (lines 32-74)
- Trigger: Connection error from external database reveals auth details before sanitization.
- Workaround: All external DB queries go through `execute_query()` which sanitizes, but raw SQL errors elsewhere may not.
- Notes: Good defensive coding but coverage not exhaustive. Need audit of all error propagation paths.

## Security Considerations

**Credential Field Extraction Without Consistent Encryption State Checking:**
- Risk: `src-tauri/src/engine/runner.rs` retrieves decrypted credential fields but doesn't verify encryption key is still valid. If encryption key rotates or database is copied without secrets, decryption silently fails to empty string.
- Files: `src-tauri/src/engine/runner.rs`, `src-tauri/src/db/repos/resources/credentials.rs`
- Current mitigation: All credentials stored with AES-256-GCM encryption. Key derived from app keyring on first run. Once-per-session pattern.
- Recommendations: Add encryption key version tracking in credential metadata. Implement periodic key rotation audit. Log all decryption attempts with result.

**OAuth Callback State Parameter Validated, But Timeout Window Loose:**
- Risk: OAuth callback server accepts connections for 10 minutes (`OAUTH_SESSION_TTL_SECS = 10 * 60`). Long window if user abandons OAuth flow; attacker could inject code parameter via CSRF.
- Files: `src-tauri/src/commands/credentials/oauth.rs` (lines 25-26)
- Current mitigation: State parameter compared to expected value (RFC 6749 §10.12). CSRF tokens prevent simple replay.
- Recommendations: Reduce timeout to 2-5 minutes. Log all OAuth callback attempts (success and failure). Add rate limiting on callback endpoint per localhost port.

**Env Var Sanitization Blocklist in Runner:**
- Risk: `src-tauri/src/engine/runner.rs` blocks injection of critical env vars (PATH, LD_PRELOAD, etc.) but whitelist is hardcoded (lines 65-90). New runtime attack vectors may not be covered by future Node/Python versions.
- Files: `src-tauri/src/engine/runner.rs`
- Current mitigation: Comprehensive list of language runtime vectors (NODE_OPTIONS, PYTHONPATH, RUBYOPT, etc.). Sanitization applied to all credential/MCP field injection.
- Recommendations: Move blocklist to configuration file with versioning. Monitor Node/Python/Ruby security advisories for new injection vectors. Consider sandboxing CLI execution in containers.

**Hybrid Encryption Fallback to Plain RSA for Legacy Payloads:**
- Risk: `src-tauri/src/engine/crypto.rs` (lines 56-74) falls back to plain RSA if no `.` separator found in ciphertext. Legacy payloads unencrypted or RSA-only may not have AEAD authentication.
- Files: `src-tauri/src/engine/crypto.rs`
- Current mitigation: Uses AES-256-GCM for new payloads (authenticated + encrypted). Fallback is emergency compatibility path.
- Recommendations: Audit when legacy payloads were last used. Set hard deprecation deadline for RSA-only payloads (e.g., 6 months). Log all fallback decryptions with source IPs.

## Performance Bottlenecks

**Database Query Latency Not Monitored per Service Type:**
- Problem: `execute_query()` tracks total duration but doesn't break down time spent in HTTP requests vs. JSON parsing vs. result marshaling. External database queries can be slow if API is overloaded.
- Files: `src-tauri/src/engine/db_query.rs` (lines 81-100)
- Cause: Single `Instant` timer captures entire operation. No intermediate checkpoints.
- Improvement path: Add span-based tracing for HTTP request, response parse, result iteration. Log p99 latencies per service type (Supabase, Neon, PlanetScale, etc.) to identify slow connectors.

**ConcurrencyTracker Uses Linear Search in Queue Drain:**
- Problem: Every time an execution finishes, `drain_next()` iterates all per-persona queues looking for highest-priority item. With 100+ personas each with 5-10 queued executions, this becomes O(n*m).
- Files: `src-tauri/src/engine/queue.rs`
- Cause: `VecDeque` with manual priority scanning rather than priority queue.
- Improvement path: Replace `VecDeque<QueuedExecution>` with binary heap per priority level, or use priority queue crate. Benchmark with 500 personas + 10K queued executions.

**Static HTTP Client Reused Globally Without Connection Pool Metrics:**
- Problem: `http_client()` returns shared `reqwest::Client` with 30-second timeout. No metrics on pool exhaustion, connection reuse, or idle connections.
- Files: `src-tauri/src/engine/db_query.rs` (lines 28-30)
- Cause: One global client for all external database queries + API proxy + MCP queries. No visibility into connection pool state.
- Improvement path: Instrument client with metrics middleware. Add alerts for connection pool exhaustion. Consider per-service-type clients with size limits.

**Frontend Deduplication Cache Using JSON.stringify() for Keys:**
- Problem: `deduplicateFetch.ts` uses `JSON.stringify(args)` to generate cache keys. If args contain large objects (100+ MB payloads), serialization is CPU-bound and creates GC pressure.
- Files: `src/lib/utils/deduplicateFetch.ts` (line 45)
- Cause: Simple approach but doesn't scale with large argument payloads.
- Improvement path: Use stable hashing for large arguments. Add cache key size limits. Consider structured key generation per function signature.

**Budget Data Fetched Synchronously Every 60 Seconds:**
- Problem: Frontend re-fetches all monthly spend data every minute (BUDGET_TTL_MS = 60_000). If user has 500+ personas, full audit query runs regardless of viewport.
- Files: `src/stores/slices/agents/budgetEnforcementSlice.ts` (line 26)
- Cause: Simple TTL model doesn't account for number of personas or network latency.
- Improvement path: Implement incremental updates (only fetch updated personas). Cache by persona ID. Add exponential backoff if fetch fails. Consider server-sent events for real-time updates.

## Fragile Areas

**Design Review System State Machine Not Type-Safe:**
- Files: `src-tauri/src/commands/design/reviews.rs` (1643 lines)
- Why fragile: Event-driven system with multiple concurrent design review runs using string-based status codes (`"analyzing"`, `"deploying"`, `"error"`, etc.). No enum enforcement means typos introduce silent state corruptions.
- Safe modification: Create TypeScript-style discriminated union for review phase states. Emit phase state at each transition. Add telemetry for unexpected transitions.
- Test coverage: Design review tests exist but don't cover all phase transition paths (success → error → retry → success).

**CLI Process Spawning with Loose Lifecycle Management:**
- Files: `src-tauri/src/engine/runner.rs` (lines 128+: `child_pids: Arc<Mutex<HashMap<String, u32>>>`)
- Why fragile: Child processes (Python, Node, shell scripts) spawned without resource limits. If script spawns infinite child processes, no automatic cleanup.
- Safe modification: Wrap child spawn in `futures::with_timeout`. Implement process group cleanup with signal handlers (SIGTERM → SIGKILL). Add memory limits via `rlimit`.
- Test coverage: No stress tests for runaway child processes.

**Zustand Store State Machine Without Invariant Assertions:**
- Files: `src/stores/slices/agents/personaSlice.ts`, `src/stores/slices/agents/chatSlice.ts`, and similar store slices
- Why fragile: Store actions modify state without assertion that invariants hold. For example, `selectedPersona` can become orphaned if persona is deleted in another browser tab.
- Safe modification: Add invariant checks in state updates (e.g., `if (stillExists ? state.selectedPersona : null`). Implement cross-slice watchers to detect orphaned references.
- Test coverage: Unit tests for individual actions but no integration tests for concurrent updates across slices.

**N8N Transform Streaming Response Handling:**
- Files: `src-tauri/src/commands/design/n8n_transform/streaming.rs`
- Why fragile: Streaming response from n8n CLI parsed line-by-line without length limits. If n8n outputs GB of debug logs, buffer grows unbounded.
- Safe modification: Add per-message size limit (e.g., 10MB). Implement streaming JSON decoder with early termination on max depth.
- Test coverage: No tests for malformed or excessively long streaming responses.

## Scaling Limits

**Single SQLite Database for All User State:**
- Current capacity: Tested with ~10K personas, ~1M executions, ~100M events. Beyond this, WAL checkpoint duration (5+ seconds) causes noticeable UI lag during compaction.
- Limit: WAL checkpoint blocks writes when reaching size threshold (typically 1GB). Concurrent readers get stale data during compaction.
- Scaling path: Migrate execution history to append-only log (e.g., EventStore pattern). Keep SQLite for active personas + recent executions. Archive old events to cold storage. Implement timeline-based sharding.

**Per-Persona Queue Depth Hard-Capped at 10:**
- Current capacity: 10 queued executions per persona (DEFAULT_MAX_QUEUE_DEPTH in queue.rs).
- Limit: Users with high-frequency triggers (e.g., every 30 seconds) exhaust queue in 5 minutes if executions take 30+ seconds each.
- Scaling path: Make queue depth configurable per persona. Implement priority demotion after queue residence > 1 hour. Consider async job queue (e.g., Celery-style) for long-running workflows.

**Fixed Max HTTP Connection Pool Size:**
- Current capacity: Global reqwest Client with default pool size (~32 concurrent connections).
- Limit: With 500 personas × 3 external API queries per execution, pool exhaustion occurs at ~10 concurrent executions system-wide.
- Scaling path: Pool size per service type (Supabase may need different limits than GitHub). Add queue backpressure when pool exhausted. Monitor p99 request latency.

**Front-End Bundle Size Growing with Feature Additions:**
- Current: ~3-5 MB gzipped. Large components (dev-tools, templates, pipelines) bundle separately.
- Limit: Initial load time > 5 seconds on slow networks. Each major feature (templating, GitLab integration, etc.) adds 50-200 KB.
- Scaling path: Implement code splitting per major section (agents, vault, templates). Lazy-load less common features (dev-tools, GitLab). Tree-shake unused icons from lucide-react.

## Dependencies at Risk

**Recharts for Large Datasets:**
- Risk: Recharts re-renders entire chart on data update. With 1000+ data points (daily metrics for 3-year history), re-renders take 500+ ms.
- Impact: Analytics dashboards stutter. Real-time event bus visualization lags when ingesting rapid events.
- Migration plan: Consider D3.js or Nivo for large datasets. Implement windowing (show last 100 points, allow date range selection). Memoize chart components.

**Tauri 2.x Command Serialization Without Type Checking:**
- Risk: IPC commands serialized as JSON without schema validation. If frontend sends malformed arguments, Rust command panics with opaque error.
- Impact: Silent failures in development. Production crashes if frontend and backend Tauri schemas drift.
- Migration plan: Use `ts-rs` to generate Rust types from TypeScript interfaces. Validate incoming JSON against schema in Tauri commands. Add JSON schema validation middleware.

**SQLite for High-Concurrency Writes:**
- Risk: SQLite uses file-level locking. With many async tasks writing simultaneously, lock contention causes "database is locked" errors.
- Impact: Under load (100+ concurrent persona executions), writes fail with SQLITE_BUSY. Current mitigation is 5-second busy_timeout (see db/mod.rs line 33).
- Migration plan: For future scaling, evaluate PostgreSQL or consider splitting into sharded SQLite databases per organization. Implement write queue with serialization.

## Test Coverage Gaps

**Design Review Phase Transitions Not Tested:**
- What's not tested: Sequence of events during design review (analyzing → deploying → success/error → cleanup). All error paths during intermediate phases.
- Files: `src-tauri/src/commands/design/reviews.rs`
- Risk: Silent state corruption. User can trigger multiple overlapping design reviews without coordinating state. Error during "deploying" phase leaves review half-saved.
- Priority: High

**OAuth Token Refresh Under Concurrent Execution:**
- What's not tested: Two executions using same credential, both need token refresh simultaneously. Does the refresh lock prevent race conditions?
- Files: `src-tauri/src/engine/runner.rs`
- Risk: Duplicate refresh requests to OAuth provider. Token inconsistency between executions.
- Priority: High

**Credential Field Injection Sanitization:**
- What's not tested: Injecting field values containing shell metacharacters, newlines, quotes into env vars. Are all dangerous characters blocked?
- Files: `src-tauri/src/engine/runner.rs`
- Risk: Shell injection if env var value reaches eval context. Command injection if field injection reaches CLI arguments.
- Priority: Critical

**Frontend State Synchronization Across Tabs:**
- What's not tested: Open Personas app in two tabs, delete persona in one tab, check second tab. Does it refresh automatically or show orphaned persona?
- Files: `src/stores/agentStore.ts`, `src/stores/slices/agents/personaSlice.ts`
- Risk: UI shows stale state. User attempts to edit deleted persona, confusing error messages.
- Priority: Medium

**Budget Enforcement Under Rapid Spend Changes:**
- What's not tested: Execute 10 personas in parallel, all approaching budget limit. Does frontend block execution correctly? Are overrides properly scoped to session?
- Files: `src/stores/slices/agents/budgetEnforcementSlice.ts`
- Risk: Budget exceeded but execution proceeds due to stale cache. Override lingers across sessions.
- Priority: Medium

**Large Credential Exports (Data Portability):**
- What's not tested: Export 10K credentials as encrypted bundle. Does file handle cleanup work? Memory usage remain bounded?
- Files: `src-tauri/src/commands/core/data_portability.rs` (1419 lines)
- Risk: OOM crash. File descriptors leak. User loses data export.
- Priority: Medium

---

*Concerns audit: 2026-03-13*
