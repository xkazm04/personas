# `run_execution` stage split — `ExecutionContext` design

Deferred step from the `engine/runner/` refactor. The orchestrator
`run_execution` in `engine/runner/mod.rs` is still ~1900 lines because
splitting its four pipeline stages into separate files requires threading
30+ local state values between them without a 50-parameter function call.
This doc specifies the `ExecutionContext` struct that unblocks the split
and the procedure to apply it safely.

## Current shape

```rust
pub async fn run_execution(
    emitter, pool, execution_id, persona, tools, input_data, log_dir,
    child_pids, engine_kind, execution_use_case_id, byom_config,
    model_profile_override, failover_config, continuation, group_id_override,
    input_schema_override, workspace_instructions_override,
    simulation_mode, ops_mode, cancellation_flag
) -> ExecutionResult {
    // Stage 1: Validate (~375 lines) — logger, workspace cascade, model,
    //          ops/sim detection, use-case expansion, model override,
    //          capability contract pre-check, credential resolution.
    // Stage 2: SpawnEngine (~575 lines) — BYOM, failover chain, prompt
    //          assembly, memory injection, ExecutionConfig snapshot,
    //          .claude/settings.json sidecar, CliProcessDriver::spawn.
    // Stage 3: StreamOutput (~580 lines) — read stream-json lines, dispatch
    //          protocol messages, track cost/session_id.
    // Stage 4: FinalizeStatus (~340 lines) — driver.wait(), post-mortem,
    //          outcome assessment, drive-sync diff, persist, emit, close log.
}
```

## Target shape

```
engine/runner/
├── mod.rs               # run_execution (thin: build ctx, call 4 stages, done)
├── context.rs           # ExecutionContext struct + lifecycle
├── stage_validate.rs    # validate(&mut ctx) -> StageOutcome
├── stage_spawn.rs       # spawn(&mut ctx) -> StageOutcome
├── stage_stream.rs      # stream(&mut ctx) -> StageOutcome
├── stage_finalize.rs    # finalize(&mut ctx) -> ExecutionResult
├── env.rs, globals.rs, credentials.rs   # (unchanged — already extracted)
└── README.md
```

## `ExecutionContext` — field groups

The struct has a clear internal layout: **inputs** (set once in mod.rs),
**cross-stage state** (written by early stages, read by later ones), and
**terminal data** (populated by finalize). Every field documented so a
future reader knows which stage owns the write.

```rust
/// Per-execution mutable state threaded through the four pipeline stages.
///
/// Construction is a single call in `run_execution`; stages take `&mut
/// ExecutionContext` and mutate freely. No stage reads a field it can't
/// see having been written: the comment above each field names the owner
/// stage. The only exceptions are the inputs (set by the caller before
/// Stage 1) and the terminal summaries (written by Stage 4, read by
/// nobody else).
pub(super) struct ExecutionContext {
    // ── Inputs (set by run_execution before Stage 1) ─────────────────
    pub emitter: Arc<dyn super::events::ExecutionEventEmitter>,
    pub pool: DbPool,
    pub execution_id: String,
    pub persona: Persona,                         // mutated by workspace cascade
    pub tools: Vec<PersonaToolDefinition>,
    pub input_data: Option<serde_json::Value>,
    pub log_dir: PathBuf,
    pub child_pids: Arc<Mutex<HashMap<String, u32>>>,
    pub engine_kind: EngineKind,
    pub execution_use_case_id: Option<String>,
    pub byom_config: Option<ByomConfig>,
    pub model_profile_override: Option<ModelProfile>,
    pub failover_config: Option<FailoverConfig>,
    pub continuation: Option<Continuation>,
    pub group_id_override: Option<String>,
    pub input_schema_override: Option<serde_json::Value>,
    pub workspace_instructions_override: Option<String>,
    pub simulation_mode: bool,
    pub ops_mode: bool,
    pub cancellation_flag: Arc<AtomicBool>,

    // ── Stage 1 (Validate) writes ─────────────────────────────────────
    pub logger: ExecutionLogger,
    pub trace: TraceCollector,
    pub start_time: Instant,
    pub log_file_path: String,
    pub model_profile: Option<ModelProfile>,
    pub cred_env: Vec<(String, String)>,
    pub cred_hints: Vec<String>,
    pub injected_connectors: Vec<String>,
    pub workspace_instructions: Option<String>,
    pub connector_usage_hints: Vec<ResolvedConnectorHint>,
    pub is_simulation_mode: bool,
    pub is_ops_mode: bool,
    pub traceparent_header: String,
    pub w3c_trace: W3cTraceContext,
    pub drive_root_for_sync: Option<PathBuf>,
    pub pre_drive_snapshot: Option<HashMap<String, DriveEntry>>,

    // ── Stage 2 (SpawnEngine) writes ─────────────────────────────────
    pub exec_dir: PathBuf,
    pub prompt_text: String,
    pub cli_args: CliArgs,
    pub execution_config: ExecutionConfig,
    pub failover_chain: Vec<FailoverCandidate>,
    pub driver: Option<CliProcessDriver>,         // None on spawn failure

    // ── Stage 3 (StreamOutput) writes ────────────────────────────────
    pub assistant_text: String,
    pub claude_session_id: Option<String>,
    pub cost_accumulator: CostAccumulator,
    pub tool_steps: Vec<ToolStep>,
    pub stream_events_dispatched: Arc<AtomicUsize>,
    pub stream_memories_dispatched: Arc<AtomicUsize>,

    // ── Stage 4 (FinalizeStatus) writes ──────────────────────────────
    pub exit_code: i32,
    pub duration_ms: u64,
    pub final_status: ExecutionState,
    pub error: Option<String>,
    pub session_limit_reached: bool,
    pub execution_flows: Option<Json>,
}
```

## Stage return type

Each stage returns a `StageOutcome` that `run_execution` matches on to
decide whether to continue to the next stage, short-circuit to finalize
(with an error), or return early.

```rust
pub(super) enum StageOutcome {
    /// Continue to the next stage.
    Continue,
    /// Short-circuit: skip the rest of the stages but still run finalize
    /// so logging, event emission, and status persistence happen.
    ShortCircuit { error: String, final_status: ExecutionState },
    /// Cancel: the user cancelled (via cancellation_flag) before we even
    /// reached the next stage boundary. Emit cancel events and return.
    Cancelled,
}
```

## `run_execution` after the split

```rust
pub async fn run_execution(/* params */) -> ExecutionResult {
    let mut ctx = ExecutionContext::new(/* params */);

    match stage_validate::run(&mut ctx).await {
        StageOutcome::Continue => {}
        StageOutcome::ShortCircuit { error, final_status } => {
            return stage_finalize::finalize_early(&mut ctx, error, final_status).await;
        }
        StageOutcome::Cancelled => return stage_finalize::finalize_cancelled(&mut ctx).await,
    }

    match stage_spawn::run(&mut ctx).await {
        StageOutcome::Continue => {}
        StageOutcome::ShortCircuit { error, final_status } => {
            return stage_finalize::finalize_early(&mut ctx, error, final_status).await;
        }
        StageOutcome::Cancelled => return stage_finalize::finalize_cancelled(&mut ctx).await,
    }

    // Stream never short-circuits — it loops until the driver exits, then
    // always hands off to finalize.
    stage_stream::run(&mut ctx).await;
    stage_finalize::run(&mut ctx).await
}
```

## Procedure

1. **Land the runner helper extraction first** (already done — this branch
   has `engine/runner/{env,globals,credentials}.rs`).
2. **Write `context.rs`** — copy the field list above. Make `ExecutionContext::new`
   take exactly the same parameters as today's `run_execution`.
3. **Move Stage 1 body into `stage_validate::run`** — every `let foo = ...`
   inside the stage becomes `ctx.foo = ...`. Every reference to a prior
   variable becomes `ctx.foo`. Emit events via `ctx.emitter` unchanged.
4. **Repeat for stages 2, 3, 4.** Stage 4 is the most involved because it
   owns the `ExecutionResult` construction.
5. **Compile check after each stage extraction.** One stage at a time;
   never skip the compile step.
6. **Run `cargo check` on both feature sets** before commit.
7. **Update `runner/README.md`** — replace the "Deferred work" section
   with the new stage layout.

## Risk: mutable aliasing

The only real risk is that a field gets written by two stages. Cross-check
the field ownership comments above before moving any code. If you find a
field written by two stages, it's a sign the two stages actually share
state in a non-obvious way — either (a) consolidate the write to one
stage and have the other read, or (b) introduce a computed accessor
method on the context so both stages access through the same interface.

**Do NOT share `exec_dir` between stages 2 and 3 via a different mechanism
than the context field.** The drive snapshot + MCP sidecar logic depends
on the two stages seeing the same `exec_dir` value.

## Testing

The existing `run_execution` tests in `runner/mod.rs` are integration
tests that exercise the full pipeline. Keep them there; don't split them
by stage. Stage modules get unit tests for any self-contained helper
logic (e.g. credential matching priority rules) but the full pipeline
test stays whole.

## Why the ExecutionContext approach is right

An alternative would be `fn stage_validate(emitter, pool, execution_id,
persona, tools, ...) -> StageOutcome` with 20+ parameters. Rust's closure
inference and borrow checker make that painful to maintain: every
parameter list change ripples through every call site.

With a context struct, the stage signatures are stable and changes to
per-execution state only touch the context and the owning stage.

## For future agents reading this

* **Don't try to split run_execution without the context struct.** It'll
  turn into parameter-list hell and you'll revert.
* **The field-ownership comments are load-bearing** — if you move a write
  from stage N to stage N+1, update the comment. Silent drift is how this
  refactor dies in a year.
* **Resist splitting `stage_stream` further.** The inner stream loop is
  tight and cohesive; every line belongs with its neighbors. Extracting
  the dispatch match branches makes it harder to read, not easier.
