# Moonshots — Database Infrastructure

## 1. The Reversible Agent: A Time-Machine Data Ledger with Per-Execution Undo
- **Tier**: 1 (10x category-defining)
- **Category**: trust
- **Impact**: Every row an agent writes becomes attributable, diffable, and reversible — "undo this agent run" as a one-click primitive lets personas act autonomously with real write authority because nothing they do is irreversible.
- **Feasibility**: high
- **Time-horizon**: months
- **Why it's a moonshot**: The single biggest ceiling on autonomous agents is not capability — it's blast radius. Today Personas mitigates risk *before* the write (safe-mode banners, quality gates, healing retries); nobody in the agent-platform space offers full *after-the-fact* reversibility of an agent's data effects. The infrastructure is already 80% present and pointed the wrong way: CDC captures every INSERT/UPDATE/DELETE on every pooled connection but throws the events at the frontend and *drops them* when the channel is full; backups snapshot the whole DB but only at boot, with no correlation to what changed or why. Turn that ephemeral change stream into a durable, execution-correlated journal with before-images, and Personas becomes the first agent platform where "let the agent write to my data" is a safe default — which also supercharges the Self-Healing Recovery journey (root-cause = exact row diff; recovery = selective rollback instead of retry-and-pray).
- **What exists today**:
  - `src-tauri/db/src/cdc.rs` — update-hook CDC on every pooled connection (`CdcCustomizer`), typed `CdcEvent {action, table, rowid}`, drain task, drop counter. Currently emit-and-forget; events lost on overflow are gone forever.
  - `src-tauri/db/src/backup.rs` — pre-migration whole-file snapshots with 3-set rotation (`backup_before_migrations`). Explicitly notes there is no "what changed" signal.
  - `src-tauri/db/src/migrations/incremental.rs` + `schema.rs` — the idempotent additive-migration machinery a `change_journal` table slots straight into.
  - `src-tauri/db/src/perf.rs` — proof this layer already runs a low-overhead global instrumentation ring; the journal writer follows the same pattern.
  - Execution correlation targets: `persona_executions` (execution-repo cross-ref) already tracked by CDC's `table_to_event`.
- **Path to implementation**:
  1. Add a `change_journal` table via `migrations::run_incremental` and a second CDC consumer that durably persists every `CdcEvent` (table, rowid→PK resolution, timestamp) — reuse the existing drain-task pattern in `cdc.rs`; overflow now spills to DB instead of vanishing.
  2. Stamp journal rows with the active `execution_id`: a thread/task-local "write attribution context" set by the execution runner around each agent run (the `CdcHooks` injection point in `cdc.rs` shows exactly how to pass context downward without layer inversion).
  3. Capture before-images: register rusqlite's `preupdate_hook` (same crate, same customizer site as `update_hook`) to serialize old row values into the journal for UPDATE/DELETE.
  4. Ship the read side: an "Execution Data Diff" panel in execution observability — every run shows the exact rows it created/modified/deleted, rendered as diffs.
  5. Ship selective rollback: `undo_execution(execution_id)` replays the journal in reverse inside one transaction, with conflict detection (row modified since by someone else → flag, don't clobber). Wire it into healing alerts as a recovery strategy.
  6. Extend to point-in-time: journal + boot snapshots = restore-to-any-moment; surface a timeline scrubber in the Database Explorer.
- **Dependencies**: rusqlite `preupdate_hook` feature flag; execution runner (engine crate) for attribution context; existing CDC/backup/migration modules. No external services.
- **Risks**: (1) Journal write amplification on hot tables (persona_events) — needs table allowlist + async batching, and journal writes must themselves be excluded from CDC to avoid recursion. (2) Reverse-replay correctness under interleaved writers is genuinely hard; conflict-flagging (not silent clobber) must be the default. (3) Before-image storage of encrypted-payload tables must store ciphertext, never plaintext (the decrypt-on-read discipline in `cdc.rs::map_persona_event_row` is the template).
- **What changes if we ship it**: The trust equation inverts — users grant agents write access because every write is auditable and undoable, and "self-healing" upgrades from retry heuristics to actual surgical data repair. No competing desktop agent platform has this.

## 2. The Federated Data Plane: Every Connected Database Becomes Agent-Native
- **Tier**: 1 (10x category-defining)
- **Category**: platform
- **Impact**: The human-only Database Explorer (8 connector families, NL-to-SQL, introspection, safe-mode) becomes a governed *agent-facing* data fabric — every persona can ground on and query any of the owner's databases across all projects, turning Personas into the single NL data plane for the whole fleet.
- **Feasibility**: medium
- **Time-horizon**: quarters
- **Why it's a moonshot**: This group already contains a shockingly complete multi-dialect data workbench — parameterized introspection across postgres/mysql/redis/convex/sqlite/notion/airtable (`introspectionQueries.ts`, backend `introspect_db_tables/columns`), streaming NL-to-SQL with conversation history (`start_nl_query`), AI schema proposals, safe-mode mutation guards — but it is all cul-de-sac'd inside one UI panel for one human. The 10x move is re-aiming the same machinery at the execution engine: schema knowledge auto-embedded into the vector store so personas *know* the owner's data models, a governed `query_database` tool so personas can *use* them, and safe-mode promoted from a UI banner to an enforcement policy with human-approval routing for mutations. This is explicitly "finish and amplify": the External Protocol Integration use-case already promises "connect to SQL databases via natural-language query" — today that promise stops at the human's keyboard.
- **What exists today**:
  - `src/api/vault/database/nlQuery.ts` / `dbSchema.ts` / `schemaProposal.ts` — streaming NL→SQL job API (`start_nl_query` with conversation history + dialect awareness), schema inspection, AI schema proposals.
  - `src/features/vault/sub_databases/` — `introspectionQueries.ts` (connector-family classification, per-dialect query languages), `safeModeUtils.ts` + `MutationConfirmBanner.tsx` (mutation guarding), `ChatTab.tsx` (`chat_db_query` AI SQL chat), full table browser.
  - `src-tauri/db/src/vector_store.rs` + `embedder.rs` — sqlite-vec ANN + BM25 re-rank + ONNX fastembed, per-KB virtual tables — the exact substrate for "schema knowledge bases".
  - Credential plumbing: `credential_fields.rs` classification + the vault (credential-core-api cross-ref) already scope which databases exist and who may touch them.
- **Path to implementation**:
  1. Schema-to-KB pipeline: on connect (and on a refresh cadence), run existing introspection, render each table into a schema document (columns, types, FKs, sampled value shapes), and ingest into a per-credential knowledge base via `vector_store.rs` — pure composition of two shipped systems.
  2. Expose a `query_database(credential_id, question)` persona tool that drives the existing `start_nl_query` job machinery headlessly, retrieval-grounded on the schema KB; register it in `persona_tool_definitions` like any builtin tool.
  3. Promote safe-mode to policy: port `safeModeUtils.ts` tokenizer classification into the Rust command layer so read-only is *enforced* per credential per persona, not advisory; SELECT-only by default.
  4. Mutation approval loop: agent-proposed INSERT/UPDATE/DELETE parks as a pending approval surfaced through the existing event bus / MutationConfirm pattern; human approves once or grants standing policy.
  5. Federation: let one NL question fan out across multiple credentials (schema-KB retrieval picks the right database(s)), with per-source attribution in results — the fleet's answer engine.
  6. Schema-drift watch: periodic re-introspection diffs against the stored schema KB; drift fires a shared-event (catalog already exists in `shared_event_firings`) that can trigger personas — "my staging DB schema changed, update the seed script".
- **Dependencies**: vault-intelligence-api / credential-core-api (live credentials), execution engine tool registry, `ml` cargo feature (embedder/vector_store), existing NL-query LLM path. External: only the user's own databases.
- **Risks**: (1) Agent-issued SQL against real production databases is a sharp knife — enforcement must live in Rust, not the frontend, and default-deny mutations; (2) API-family connectors (notion/airtable/redis) don't speak SQL, so the tool needs per-family capability envelopes (the `ConnectorCapabilityNote` concept, generalized) or the promise fragments; (3) schema embeddings of sensitive column names/sampled values leak into KB storage — must respect `credential_fields.rs` sensitivity classification when building schema docs.
- **What changes if we ship it**: Personas stops being an app that *has* a database viewer and becomes the governed intelligence layer over all of the owner's data everywhere — every new project's database plugged into the vault instantly makes every persona smarter, a compounding data-moat and the strongest cross-project leverage multiplier in the product.
