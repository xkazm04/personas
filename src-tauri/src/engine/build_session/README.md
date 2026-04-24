# `engine::build_session` — module map

> Multi-turn build-session lifecycle for the persona-from-scratch flow. The
> module owns the long-lived tokio task that drives the LLM through the
> `behavior_core → capability_enumeration → capability_resolution → agent_ir`
> chronology, the user-question gate state machine, and the test-and-promote
> handoff to the runner.

This README is for humans **and** other LLM CLIs reading the codebase. It maps
each file to the responsibility it owns and the public contracts other modules
depend on. When you change behavior here, update the row that describes it.

## Why this is split this way

`build_session.rs` grew past 3,400 lines as the v3 capability framework
matured. The functions inside cluster into clear concerns (manager, gate
enforcement, prompt authorship, template matching, parsing, the run-session
spine, tool-test orchestration, IPC/DB glue). Each cluster now lives in its
own file; `mod.rs` is the slim public API + glue layer.

```
engine/build_session/
├── mod.rs            Public API + BuildSessionManager + SessionHandle.
│                     Re-exports `run_tool_tests`. 306 lines.
├── gates.rs          Per-capability gate state machine + intent heuristics +
│                     synthesised clarifying questions. 342 lines.
├── session_prompt.rs build_session_prompt — the v3-framework system prompt
│                     the LLM is given. Includes language preamble + Rule 5
│                     per-locale name examples. 387 lines. (Named to
│                     disambiguate from the runtime-execution `engine::prompt`.)
├── templates.rs      Keyword similarity matching against scripts/templates/
│                     for the "Reference Templates" prompt section. 161 lines.
├── runner.rs         `run_session` async loop — the spine that spawns the
│                     CLI, drains stream-json, applies gates, mirrors events,
│                     persists checkpoints. 835 lines.
├── parser.rs         stream-json → typed `BuildEvent` parser + legacy mirror
│                     helpers + clarifying_question event constructor. 686
│                     lines.
├── tool_tests.rs     LLM-driven pre-promote test runner (`run_tool_tests`,
│                     `extract_test_plan`, `generate_test_summary`). 758
│                     lines.
├── events.rs         Tauri-channel + DB-update glue: `dual_emit`,
│                     `emit_session_status`, `emit_error`, `cleanup_session`,
│                     `update_phase{,_with_error}`. 111 lines.
└── README.md         You are here.
```

Total: ~3,586 lines (vs. 3,419 in the original monolith — the small overhead
is from per-file headers, imports, and the README itself).

## File responsibilities

### `mod.rs`

- **`BuildSessionManager`** (public) — owns the in-memory session map and the
  `start_session` / `submit_answer` / `cancel_session` lifecycle. This is the
  only struct other modules construct directly (see `lib.rs::AppState`).
- **`run_session`** — the long-lived tokio task that spawns the Claude CLI,
  pipes the system prompt, drains stream-json events, applies the gate state
  machine, mirrors v3 events to legacy cell-update for the existing UI, and
  persists per-event checkpoints into SQLite. ~780 lines; the spine of the
  module. Suggested next refactor target: `runner.rs`.
- **`parse_build_line` + `parse_json_object`** — JSON-event parser that turns
  CLI stream-json lines into typed `BuildEvent` variants. Includes legacy
  shape mirroring (v3 cap-resolution → legacy cell-update). Suggested next
  refactor target: `parser.rs`.
- **`run_tool_tests` / `build_test_prompt` / `extract_test_plan` /
  `generate_test_summary`** — LLM-driven test runner used right before
  promote. Suggested next refactor target: `tool_tests.rs`.
- **`build_clarifying_question_events`** — shared helper that turns a
  question object into both the v3 typed event AND the legacy `Question`
  mirror. Used by parser and by [`gates::synthesize_gate_question`].
- **Event helpers** (`dual_emit`, `emit_session_status`, `emit_error`,
  `cleanup_session`, `update_phase`, `update_phase_with_error`) —
  Tauri-channel + DB-update glue. Suggested next refactor target: `events.rs`.

### `gates.rs`

The Rule 16/17 enforcement. When the LLM tries to skip a gated dimension
(`suggested_trigger`, `connectors`, `review_policy`, `memory_policy`), this
module:

1. Tracks per-capability gate state (`Closed → Pending → Open`).
2. Suppresses the out-of-order `capability_resolution` event so the UI
   doesn't see a value the user never confirmed.
3. Synthesises a `clarifying_question` (legacy + v3 mirrored) so the UI
   surface always renders an actionable question, even if the LLM didn't
   author one.

The intent heuristics (`intent_implies_*`) decide when a gate can auto-open
because the user's intent is unambiguous. **Keep the keyword lists
synchronised with the corresponding "skip when intent literally says X" rule
in `prompt.rs::Rule 16`.** If you add a phrase to the prompt rule, add it to
the heuristic too — otherwise the LLM will skip the question while the gate
stays closed and `find_first_unopen_gate` will keep nagging.

### `prompt.rs`

The single function `build_session_prompt` produces the entire system prompt
the LLM receives at session start. It composes:

- **Language preamble** — locale-specific naming examples and the
  "all human-readable text in `{lang_name}`" rule.
- **Phase A/B/C body** — capability-framework explanation with every
  required JSON shape inlined.
- **Rules block** — including Rule 16 (gate dimensions) and Rule 17
  (`connector_category` requires a `category` token).
- **Reference Templates** — appended via `templates::build_template_context`.

When iterating on persona-building behavior this is almost always the file
you want to edit. The prompt is connector-agnostic by design: never hardcode
product names (Gmail, GDrive, Dropbox) inside the rules — reference the
*category* slot (`storage`, `messaging`, …) and let the user's vault answer
pick the concrete connector.

### `templates.rs`

Token-overlap similarity matcher against `scripts/templates/`. Loads the
catalog once and caches via `LazyLock`. Handles non-English intents through a
fallback substring scan for ASCII service names ("gmail", "slack", …). Only
exposes one `pub(super)` symbol: `build_template_context`.

## Cross-module conventions

- **Visibility:** internal helpers stay private; symbols other submodules
  need are `pub(super)`. Nothing inside `build_session/` is `pub` to the
  outside world except `BuildSessionManager` and `run_tool_tests`, which
  are re-exported from `mod.rs`.
- **i18n:** persona-facing prompt text is currently hand-mapped per locale
  inside `prompt.rs::build_session_prompt`. The planned next step is a
  `prompt/i18n/<lang>.rs` per-locale stub that owns its own `name_examples`
  and `rule5` text — at that point this README's "i18n" section moves there.
- **Pairing rules with heuristics:** Rule 16 in `prompt.rs` and the
  `intent_implies_*` keyword lists in `gates.rs` are a pair. Tighten one
  without the other and you'll see either the LLM or the Rust gate diverge
  from the contract.
- **Legacy mirror:** the build pipeline emits both v3 events
  (`CapabilityResolutionUpdate`, `ClarifyingQuestionV3`) AND legacy mirrors
  (`CellUpdate`, `Question`) so the existing 8-dim UI keeps working. The
  mirror logic lives in `parse_json_object` (mod.rs) and
  `build_clarifying_question_events` (mod.rs); gates and parsers both
  generate mirrored pairs.

## Cross-module visibility map

Boundary calls are kept to the minimum needed; everything else is private.

| Submodule | exports `pub(super)` | calls into siblings |
|---|---|---|
| `gates` | `CapabilityGates`, `Gate`, `PendingGate`, `GATED_CAPABILITY_FIELDS`, `is_gated_field`, `legacy_cell_to_v3_field`, `gate_seed_for_intent`, `init_gates_from_enumeration`, `ensure_capability_in_coverage`, `find_first_unopen_gate`, `synthesize_gate_question` | `parser::build_clarifying_question_events` |
| `parser` | `parse_build_line`, `parse_json_object`, `build_clarifying_question_events`, `map_capability_field_to_legacy_dimension`, `map_persona_field_to_legacy_dimension` | (none) |
| `session_prompt` | `build_session_prompt` | (none) |
| `templates` | `build_template_context` | (none) |
| `runner` | `run_session` | `gates`, `parser`, `events`, `engine::cli_process`, `engine::types`, `crate::notifications`, `super::SessionHandle` |
| `tool_tests` | `run_tool_tests` (re-exported `pub` in mod.rs for `commands::design::build_sessions`) | `engine::prompt::build_cli_args`, `engine::tool_runner`, `engine::runner::resolve_credential_env_vars` (aliased `engine_runner`) |
| `events` | `dual_emit`, `emit_session_status`, `emit_error`, `cleanup_session`, `update_phase`, `update_phase_with_error` | `super::SessionHandle` |

`mod.rs` itself only has to know about `SessionHandle` (kept `pub(super)` for
`events.rs`), the public `BuildSessionManager`, and the re-exported
`run_tool_tests`.

## Suggested authoring workflow for an LLM working on this code

1. Read this README first.
2. To change WHAT the LLM is asked to do during build → edit
   `session_prompt.rs`. Mirror any new "skip when intent says X" phrasing in
   `gates.rs::intent_implies_*`.
3. To change HOW gates enforce missing answers → edit `gates.rs`.
4. To change template matching → edit `templates.rs`.
5. To change the build-session orchestration (turn loop, error recovery,
   draft-ready guard) → edit `runner.rs`.
6. To change how stream-json lines are parsed into `BuildEvent`s, or to add
   a new event type / legacy mirror → edit `parser.rs`.
7. To change how the pre-promote test runner composes its prompt or
   summarises results → edit `tool_tests.rs`.
8. To change how events leave this module (Tauri channel, global events,
   DB phase updates) → edit `events.rs`.
9. To change the public API (`BuildSessionManager`, `run_tool_tests`) →
   edit `mod.rs`.
