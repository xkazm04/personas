//! Recipe command surface — CRUD, generation, versioning, and execution.
//!
//! # Recipe Execution State Machine
//!
//! Recipe execution drives a long-running Claude CLI invocation behind a
//! deterministic event protocol. The frontend (`useRecipeExecution`) treats
//! the backend as an opaque state machine and reacts to status transitions —
//! this module documents that contract so UI code never has to
//! reverse-engineer terminal states.
//!
//! ## State diagram
//!
//! ```text
//!                ┌────────┐
//!                │  idle  │  (no active task in process_registry)
//!                └───┬────┘
//!                    │ start_recipe_execution
//!                    │  - registry.set_id("recipe_execution", task_id)
//!                    │  - emits status="executing"  (initial_status)
//!                    │  - emits progress "Connecting to Claude..."
//!                    ▼
//!                ┌──────────┐
//!     ┌─────────►│ executing│
//!     │          └────┬─────┘
//!     │               │ Claude stream-json lines drive progress events:
//!     │               │   SystemInit       → "Connected ({model})" + init_progress
//!     │               │   AssistantText[0] → streaming_progress
//!     │               │   AssistantToolUse → "Researching: {tool}"
//!     │               │   Result           → complete_prefix " (X.Xs, $X.XXXX)"
//!     │               │
//!     │               ▼
//!     │     ┌─────────────────┐
//!     │     │ run_ai_artifact │  (terminal disposition)
//!     │     │      _task      │
//!     │     └─────┬───────────┘
//!     │           │
//!     │   ┌───────┴────────┬─────────────┬───────────────┐
//!     │   │                │             │               │
//!     │   ▼                ▼             ▼               ▼
//!     │ ┌──────────┐  ┌─────────────┐  ┌────────┐  ┌──────────┐
//!     │ │ completed│  │extract_failed│  │ timeout│  │  failed  │
//!     │ └──────────┘  └─────────────┘  └────────┘  └──────────┘
//!     │
//!     │ cancel_recipe_execution (any time during executing)
//!     └──────────────────────── status="cancelled" (emitted by cancel handler)
//! ```
//!
//! ## Terminal states and event guarantees
//!
//! Every terminal state fires exactly **one** `recipe-execution-status` event
//! with `execution_id` matching the one returned by `start_recipe_execution`.
//! The frontend can therefore key its loading state off the status field
//! alone — no other channel needs to be observed for completion.
//!
//! | Terminal state    | `status` value | `result`         | `error`                                              | Process activity |
//! |-------------------|----------------|------------------|------------------------------------------------------|------------------|
//! | success           | `"completed"`  | `{output:"..."}` | `null`                                               | `"completed"`    |
//! | empty/whitespace  | `"failed"`     | `null`           | `extraction_failed_error` from `RECIPE_EXECUTION_MESSAGES` | `"failed"`       |
//! | timeout (120s)    | `"failed"`     | `null`           | `"Claude CLI timed out after 120 seconds"`           | `"failed"`       |
//! | spawn / CLI error | `"failed"`     | `null`           | spawn or stderr-derived message                      | `"failed"`       |
//! | task panicked     | `"failed"`     | `null`           | `"Internal error: task crashed unexpectedly..."`     | (none)           |
//! | user cancellation | `"cancelled"`  | `null`           | `null`                                               | `"cancelled"`    |
//!
//! ### Why empty output is `failed`, not `completed`
//!
//! [`recipe_execution::extract_recipe_execution_result`] trims the full LLM
//! text and returns `None` when nothing remains. This protects callers from
//! a `completed` event whose `result.output` is the empty string — which would
//! be indistinguishable from "the model produced no answer" at the UI layer.
//! Whitespace-only output therefore deliberately surfaces as `failed` with
//! [`AiArtifactMessages::extraction_failed_error`](crate::commands::credentials::ai_artifact_flow::AiArtifactMessages::extraction_failed_error).
//!
//! ### Cancellation race
//!
//! `cancel_recipe_execution` and the running task race against one another.
//! Cancellation is resolved through `process_registry`:
//!
//! 1. `cancel_recipe_execution` calls `registry.take_id("recipe_execution")`,
//!    immediately emits `status="cancelled"`, and returns.
//! 2. The running task, on Claude exit, calls
//!    `registry.get_id("recipe_execution")` and compares it against its own
//!    `task_id`. If they differ (or the slot is empty), the task exits
//!    silently — it does **not** emit a competing terminal status.
//!
//! Net effect: the frontend sees exactly one terminal event per execution,
//! even if Claude finishes a few milliseconds after the user clicks cancel.
//!
//! Because `track_pid: false` (see `start_recipe_execution` in [`crud`]), the
//! Claude child process is **not** killed on cancel — it is allowed to finish
//! in the background and its output is dropped. This is a deliberate
//! trade-off: process kill on Windows is fragile (taskkill /F /T), and recipe
//! executions are short enough that letting them complete silently is cheaper
//! than risking an orphaned subprocess tree. If a recipe ever grows long
//! enough to warrant kill-on-cancel, flip `track_pid` to `true`.
//!
//! ## Configuration tunables
//!
//! All knobs live in [`recipe_execution::RECIPE_EXECUTION_MESSAGES`]:
//!
//! - `timeout_secs: 120` — wall-clock cap on the Claude CLI invocation.
//!   Hitting it kills the child (via PID tree on Windows) and yields the
//!   `timeout` terminal state above.
//! - `initial_status: "executing"` — the first status emitted; mirrors the
//!   `runningPhase` constant in `useRecipeExecution`.
//! - `extraction_failed_error` — the user-visible message when the extractor
//!   returns `None`.
//!
//! ## Frontend contract summary
//!
//! Listeners on `recipe-execution-status` should treat **`completed`,
//! `failed`, and `cancelled` as terminal** and tear down their progress UI on
//! any of the three. `executing` is the only non-terminal value; receiving
//! it twice (e.g. on a retry) means a new task started and the previous
//! `execution_id` is no longer authoritative.

pub mod crud;
pub mod recipe_derivation;
pub mod recipe_execution;
pub mod recipe_generation;
pub mod recipe_match;
pub mod recipe_versioning;
