# tauri:bench (misc) — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 1 findings (0 critical / 0 high / 1 medium / 0 low)
> Context group: Core Libraries & State | Files read: 1 | Missing: 0

## 1. `bench/db.rs` is dead scaffolding — the "personas-bench binary (later phase)" that was supposed to consume it never landed
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src-tauri/src/bench/db.rs:1 (exported via src-tauri/src/bench/mod.rs:12)
- **Scenario**: `bench/mod.rs` documents that "The `personas-bench` binary (added in a later phase) consumes this" DB module. That phase never shipped: a repo-wide search finds zero callers of `open_pool`, `BenchDbPool`, `RUBRIC_DIMENSIONS`, `MODEL_LABELS`, or `SCHEMA_VERSION` outside the file's own `#[cfg(test)]` block. `Cargo.toml` defines only `athena-bench-validate` (which uses the sibling `bench::athena_validate`, not `db`); no docs, scripts, or `.claude` skills reference `persona-bench`, `bench::db`, or `personas_bench.db`. The only bench work that did ship (2026-07-14 athena bench, per `.claude/active-runs.md`) took the `athena_validate` + `scripts/test/athena-model-bench.mjs` (JSONL) route instead of this SQLite store.
- **Root cause**: Speculative phase-1 scaffolding (schema, WAL pool, rubric/model-label constants, two unit tests) committed ahead of the consumer, and the follow-up phase was superseded by the JSONL-based athena bench harness.
- **Impact**: ~260 lines of unreachable production code plus 2 unit tests that compile and run on every `cargo test`, an embedded 4-table schema that must be mentally accounted for during audits, and a misleading module doc promising a binary that does not exist. Constants like `MODEL_LABELS` ("opus/sonnet/haiku/gemma") will silently rot as the real model set evolves.
- **Fix sketch**: Decide keep-or-kill. If the persona-bench matrix is still planned, leave the file but fix the `bench/mod.rs` doc to say the consumer is not yet built and link the plan doc. Otherwise delete `src-tauri/src/bench/db.rs`, drop `pub mod db;` from `bench/mod.rs`, and update the module docs (keep `athena_validate`, which is live via the `athena-bench-validate` bin). Verification needed before deletion: confirm no out-of-repo Claude Code skill (e.g. a global `/persona-bench` skill in `~/.claude`) reads `.planning/bench/personas_bench.db` — in-repo search found nothing.

No perf-optimizer findings: the file is init-only code (schema DDL + one pool open with WAL and busy_timeout already set), and since the module has no production callers there is no hot path to optimize. The single-`Mutex<Connection>` pool would only merit revisiting if the module gains a concurrent consumer.
