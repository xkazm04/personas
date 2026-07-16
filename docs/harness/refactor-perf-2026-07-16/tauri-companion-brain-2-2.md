# tauri:companion/brain [2/2] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 2 findings (0 critical / 0 high / 2 medium / 0 low)
> Context group: Plugins & Companion | Files read: 2 | Missing: 0

## 1. `excerpt_500` duplicated at least 8 times across companion/brain modules
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/companion/brain/dashboard.rs:81
- **Scenario**: The identical UTF-8-safe 500-char excerpt helper is copy-pasted as a private `fn excerpt_500` in dashboard.rs, semantic.rs:535, reflection.rs:317, procedural.rs:420, goals.rs:334, doctrine.rs:640, episodic.rs:241, and cockpit.rs:170, with the same char-boundary loop inlined again in consolidation.rs:1009 — and near-identical boundary loops also live in utils/text.rs, engine/str_utils.rs, and several design/n8n files.
- **Root cause**: Each brain phase module was written by mirroring the previous one ("storage layout deliberately mirrors reflection.rs"), so the helper was cloned instead of extracted.
- **Impact**: ~9 copies of the same logic in one directory; any fix (e.g. changing the excerpt length, trimming at word boundaries, or a boundary-loop bug) must be applied 9+ times and will drift. Pure maintenance hazard, no runtime cost.
- **Fix sketch**: Add `pub fn excerpt(s: &str, max: usize) -> String` (or `excerpt_500`) to a shared location — `utils/text.rs` already hosts the char-boundary idiom, or a new `companion/brain/util.rs` — and replace all 8 private copies plus the inline loop in consolidation.rs with calls to it. Mechanical change, no behavior difference.

## 2. `graph.rs` is a doc-comment-only stub module that was never implemented
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src-tauri/src/companion/brain/graph.rs:1
- **Scenario**: `pub mod graph;` is declared in brain/mod.rs:19, but the file contains only a module doc comment promising "Phase 2: traverse, add_edge, contradict_scan" — zero items. Meanwhile the `companion_edge` table + index it claims to back are created in db/mod.rs:631 and referenced nowhere else (only doc comments mention them), so the table is written/read by nothing.
- **Root cause**: Phase-0 scaffolding (stub module + schema) landed ahead of the Phase-2 implementation, which never arrived.
- **Impact**: An empty public module and an unused SQLite table/index mislead readers into thinking a typed-relation graph exists; the schema also adds a tiny amount of dead DDL to every DB init. (Grep confirmed no code references `brain::graph` or `companion_edge` outside doc comments; the wired `commands::obsidian_brain::graph` in lib.rs is a different, real module.)
- **Fix sketch**: Either implement Phase 2 or delete `graph.rs`, the `pub mod graph;` line, and the `companion_edge` DDL/index (leaving a note in brain/mod.rs docs if the plan is still live). If schema removal is risky for existing user DBs, keep the DDL but drop the stub module and mark the table as reserved in db/mod.rs.
