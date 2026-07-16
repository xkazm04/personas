# tauri:engine/p2p — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 1 high / 4 medium / 1 low)
> Context group: Backend Engine & Runtime | Files read: 8 | Missing: 0

## 1. MessageRouter inbox grows without bound on persona keys and is never drained
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: leak
- **File**: src-tauri/src/engine/p2p/messaging.rs:153-175
- **Scenario**: A connected peer sends AgentMessages with arbitrary (even nonexistent) `target_persona_id` values. Each unique id creates a new `VecDeque` entry in `inbox`; entries are never removed — `get_messages` only clones (never drains), and there is no eviction of persona keys, no validation that the target persona exists locally, and no per-envelope payload cap below the 16 MB protocol max.
- **Root cause**: `store_received` does `inbox.entry(target.clone()).or_insert_with(VecDeque::new)` with a per-queue cap (100) but no cap on the number of queues, and no consumption/TTL path ever shrinks the map. Rate limiting (10 msg/s/peer) only slows growth; a long-running daemon still accumulates indefinitely.
- **Impact**: Unbounded memory growth on a long-lived node: at 10 msg/s a peer can park up to 100 × 16 MB per fabricated persona id and keep minting new ids forever. Even benign use leaks: every persona that ever received a message holds its last 100 envelopes (payload bytes included) for the process lifetime.
- **Fix sketch**: Validate `target_persona_id` against local personas before enqueueing (reject or count as dropped). Add a global cap (e.g. max persona keys and/or max total buffered bytes) with LRU eviction, and have `get_messages` (or a new `take_messages`) drain read envelopes. Optionally clamp accepted AgentMessage payloads well below the 16 MB frame limit.

## 2. `ConnectionManager::set_max_peers` is dead and uncallable — max_peers config changes silently never apply
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src-tauri/src/engine/p2p/connection.rs:156-158
- **Scenario**: Grep over src-tauri shows zero callers. Worse, it takes `&mut self`, but the manager is only ever held as `Arc<ConnectionManager>` (mod.rs, ManifestSync, MessageRouter), so it cannot be called without unwrapping the Arc — it is unreachable by construction. A user editing `NetworkConfig.max_peers` at runtime gets no effect until restart, with no error.
- **Root cause**: Leftover from a pre-Arc design; the "live config reload" story was implemented for periodic intervals (`with_dynamic_interval`) but never for `max_peers`.
- **Impact**: Dead API that suggests runtime reconfiguration works when it cannot; misleads future maintainers into calling a method that will not compile against the Arc-held instance.
- **Fix sketch**: Either delete the method, or make it real: change `max_peers` to `AtomicUsize`, take `&self`, and wire the config-update command to call it. The atomic variant also removes the need for the write lock in capacity checks.

## 3. Outgoing and incoming handshake paths duplicate ~90 lines of connect logic
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/engine/p2p/connection.rs:302-560
- **Scenario**: `connect_to_peer_inner` and `handle_incoming` each independently implement: version check with identical error strings, self-connection guard, `PeerConnection`/`PeerConnectionInfo` construction, `try_insert_connection` + tie-break handling, the DB-write-then-rollback-on-failure block (verbatim duplicate, including the `VarInt::from_u32(4)` close), metrics bump, and `spawn_inbound_dispatch`. Any future change (e.g. adding signed-handshake verification, changing the rollback close code) must be made twice.
- **Root cause**: The two paths differ only in stream direction (open_bi+Hello→HelloAck vs accept_bi+Hello→HelloAck reply); everything after identity exchange is direction-agnostic but was written inline in both.
- **Impact**: Real maintenance hazard on security-sensitive code: the planned signed-handshake work (followups-2026-06-08) will touch exactly this region, and a fix landing in only one path yields asymmetric behavior between initiator and acceptor.
- **Fix sketch**: Extract a private `finalize_connection(&self, quinn_conn, peer_id, display_name, is_outgoing, manifest_sync, messages) -> Result<(), AppError>` covering build-entry → try_insert → DB persist/rollback → metrics → spawn_inbound_dispatch. Optionally also extract a `check_version(peer_id, version)` helper for the duplicated version-mismatch error.

## 4. Periodic manifest sync re-reads each peer's full manifest just to count rows
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src-tauri/src/engine/p2p/manifest_sync.rs:388-395
- **Scenario**: Every 30 s, for every connected peer that synced successfully, `run_periodic_sync` calls `get_peer_manifest(peer_id)` — a full `SELECT *` of up to 1000 rows with per-row `serde_json` tag parsing and `PeerManifestEntry` allocation — only to compute `.len()` for the progress event.
- **Root cause**: `sync_manifest` already knows `resources.len()` (it received and hashed the entries) but returns `()`, so the caller re-derives the count from the DB.
- **Impact**: With max peers (32) at the entry cap this is ~32,000 row materializations + JSON parses per 30 s cycle on the shared SQLite pool, purely to emit a number the code already had. Bounded but pointless steady-state load on a hot background path.
- **Fix sketch**: Change `sync_manifest` to return `Result<usize, AppError>` (the accepted entry count, including the unchanged-hash early-return path) and pass that to `emit_sync_progress`. Alternatively use `SELECT COUNT(*) FROM peer_manifests WHERE peer_id = ?1` — but the return-value route is free.

## 5. `send_message` clones the full envelope payload per send
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: allocation
- **File**: src-tauri/src/engine/p2p/messaging.rs:98-127
- **Scenario**: `send_message` takes `envelope: AgentEnvelope` by value but wraps `envelope.clone()` into `Message::AgentMessage`, duplicating `payload: Vec<u8>` (up to the 16 MB protocol max) on every send. The clone exists only so the post-send `tracing::debug!` can read three string fields.
- **Root cause**: Logging after the move forced a defensive clone instead of capturing the few needed fields first.
- **Impact**: One full payload copy per outbound agent message — multi-MB memcpy + transient double residency on what is the hot path of agent-to-agent messaging.
- **Fix sketch**: Capture `source_persona_id`/`target_persona_id` (cheap String clones) and `payload_bytes` before constructing the message, then move `envelope` into `Message::AgentMessage { envelope }` without cloning. Same shape, ~3 lines.

## 6. PeriodicTask ships three unused builder methods under a blanket `#[allow(dead_code)]`
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src-tauri/src/engine/p2p/periodic.rs:25-64
- **Scenario**: All five production call sites (engine/p2p/mod.rs:142-244) use only `with_dynamic_interval`. `new`, `with_max_errors`, and `with_backoff_multiplier` have zero callers, and the blanket `#[allow(dead_code)]` on the whole impl block suppresses the compiler from ever telling you — including for any future method that dies.
- **Root cause**: Speculative builder API kept "just in case", silenced with a module-wide allow instead of pruning.
- **Impact**: Minor dead weight, but the blanket allow is the real cost: it masks future dead code across the entire impl.
- **Fix sketch**: Delete `new`, `with_max_errors`, and `with_backoff_multiplier` (defaults are already set in `with_dynamic_interval`) and drop the `#[allow(dead_code)]`. If backoff tuning is genuinely anticipated, keep only the two setters actually referenced by planned work and allow them individually.
