# C4 — Build-from-scratch scenario handoff (2026-04-22 PM)

> Acceptance scenario, end-to-end: user prompts "translate every incoming
> English document to Czech", build pipeline asks dimension questions,
> user answers, persona is promoted, Plugins.Drive fires
> `drive.document.added`, persona executes the translation, translated
> sibling file lands next to the source.

## What already landed on master this session

| Commit | What |
|---|---|
| `f1c78796` | **fix(ipc)**: `coerceArgs` must not recurse into class instances (Channel). Root-cause of the original `start_build_session: "invalid type: map, expected a string"` error. 9/9 unit tests. |
| `38d05c99` | **feat(drive)**: `drive.document.{added,edited,renamed,deleted}` persona events emitted from every Local Drive mutation. Four new entries in `eventTypeTaxonomy.ts`, connector seed regenerated with `metadata.emits[]`. |
| `53accd50` | **test(harness)**: e2e scenario runner (`tools/test-mcp/e2e_build_from_scratch.py`), new `/bridge-exec` dispatcher, scenario helpers on `window.__TEST__`. |

All three ship on `master`; `npx tsc --noEmit` clean; `cargo check --features "test-automation desktop"` clean.

## How to run the scenario

```bash
# 1. Launch the dev app with both features — desktop for OS hooks,
#    test-automation for the HTTP bridge on :17320.
cargo tauri dev --features "test-automation desktop"

# 2. Confirm the harness is reachable.
curl http://127.0.0.1:17320/health
# → {"status":"ok","server":"personas-test-automation","version":"0.2.0"}

# 3. Drive the scenario.
uvx --with httpx python tools/test-mcp/e2e_build_from_scratch.py

# Optional flags:
#   --intent "..."          override the prompt
#   --doc-path inbox/x.md   override the drive write path
#   --build-timeout 240     bump the per-phase wait budget
#   --skip-execution        stop after promote (fast smoke test)
#   --report run.json       write the structured run log
```

The scenario runs seven chronological steps, each recorded in a JSON log:

1. `preflight` — health check
2. `start_build` — `startBuildFromIntent(intent)` → session + draft persona
3. `answer_dimensions` — loops `awaiting_input` cycles, batches deterministic answers keyed by cell (`triggers`, `connectors`, `human-review`, `messages`, `memory`, `error-handling`, `events`, `use-cases`)
4. `test_and_promote` — `test_build_draft` + `promote_build_draft`
5. `inspect_persona` — verifies `design_context.useCases`, `triggers`, `event_subscriptions` are populated; flags if no `drive.document.*` subscription was created
6. `drive_write_and_wait_execution` — writes the test document via `drive_write_text`, triggers `drive.document.added`, polls `list_executions` for the persona
7. `cleanup` — `deleteAgent` unless `--no-persona-cleanup`

## Likely first-run surprises & where to look

### Build LLM doesn't produce a `drive.document.added` subscription

**What to check first.** The `drive.document.added` event is new to the
taxonomy and the build prompt in `build_session.rs:1426+` doesn't
mention it by name — it says "use three-level dot syntax" and leaves
the choice to the model. If the LLM emits `file_changed` or
`document_added` instead, the persona won't match drive events.

**Fix options:**

- Short-term: add a one-liner to the answer recipe in
  `tools/test-mcp/e2e_build_from_scratch.py` under `answer_recipes["events"]`
  naming the exact event type. The recipe already suggests
  `drive.document.added` explicitly — verify the build LLM honors it in
  `capability_resolution[field=event_subscriptions]`.
- Medium-term: surface `metadata.emits[]` from selected connectors into
  the build prompt's Available Connectors section so the LLM sees the
  exact event strings it can subscribe to. See
  `scripts/connectors/builtin/local-drive.json` — the `emits[]` array is
  populated but `build_session.rs::build_session_prompt` doesn't read it
  yet. A ~20-line addition where `connector_section` is assembled.
- The Rust side of the event bus already handles dot-syntax event types
  (`is_safe_type_string` in `db/repos/communication/events.rs:29`).

### `awaiting_input` never arrives

If the LLM skips straight to `draft_ready` because it read the intent
as unambiguous, the scenario's answer loop is a no-op and promotion
may proceed without the drive subscription. This is fine — the
scenario will still promote but step 5 will log
`subscription.drive: info — not given a drive subscription`.

Workaround: add a `clarifying_question` guard by making the intent
*deliberately* ambiguous, e.g. drop "local drive" from the prompt so
the LLM must ask about source.

### Promotion fails with "Build session has no agent_ir"

Means `test_build_draft` was skipped and the agent_ir field never got
stamped. The scenario's step 4 calls `triggerBuildTest` before
`promoteBuildDraft`; the test step is marked `info` on failure
(non-fatal) but promotion still needs an `agent_ir`. If the build LLM
hasn't emitted the final `agent_ir` event, check the session row in
SQLite for the `agent_ir` column.

### `drive.document.added` fires but no execution

The event matcher wires `source_type=local_drive` against any subscription
whose `event_type == drive.document.added` (see `engine/bus.rs:match_event`).
If the persona got a subscription for a different event_type (e.g.
`file_changed`), no trigger fires. Log the raw pending events:

```sql
SELECT id, event_type, source_type, source_id, status FROM persona_events
 ORDER BY created_at DESC LIMIT 5;
```

### Persona executes but doesn't actually translate

This is the deepest gap and probably requires a real LLM call in the
executor, not just a stub. Once the drive trigger fires, the persona's
capability runs under the normal execution pipeline — whether the
agent *emits* a `drive_write_text` call depends on `system_prompt` and
`tool_hints`. The scenario's step 7 checks for translated sibling
files; if none appears, inspect `execution.output_lines` on the
returned execution row — the agent may have written a `user_message`
but not invoked the drive tool.

## What's NOT done (explicit backlog)

1. **Build prompt awareness of `metadata.emits[]`.** See "Likely
   surprises" above. One-line augmentation in
   `build_session.rs::build_session_prompt`.
2. **`drive.document.*` surfaced in the Event Builder UI palette.** The
   taxonomy entries exist; the `EventListenerConfig` dropdown at
   `src/features/triggers/sub_triggers/configs/EventListenerConfig.tsx`
   should pick them up automatically via `getEventTypeOptionsGrouped`,
   but visual verification after running the app is needed.
3. **Drive tool surface for the runner.** The built-in executor needs
   `drive_write_text` / `drive_read_text` / `drive_list` exposed as
   tools the persona can call. Check `src-tauri/src/engine/tool_*` and
   `src/lib/personas/tool_registry.ts` — if they aren't registered as
   invokable tools, the agent can't write the translated file.
4. **Scenario iteration logs.** The Python script records a structured
   log but has no screenshot capture. `/screenshot` endpoint exists
   (already in test_automation.rs) — call it at each step transition
   for a richer post-mortem.
5. **Regression tests for `coerceArgs + Channel`.** Shipped as unit
   tests in `src/lib/__tests__/tauriInvoke.coerceArgs.test.ts`. An
   integration test that actually starts a build session through the
   harness would be a stronger safety net; the scenario itself doubles
   as one.

## State of the codebase for next session

- `master` branch, 3 commits ahead of `f33d71fa` (session starting point).
- Uncommitted working-tree churn is entirely from unrelated UI
  prototypes (`GlyphCard`, `HomeRoadmapView*`, `GuidedTour*`). None of
  that is in scope.
- Preexisting Cargo errors under the default feature set in
  `test_automation.rs`, `healthcheck.rs`, `ocr/mod.rs`,
  `auth_detect.rs` still exist and still fail under the default
  feature set (unchanged from prior handoffs). Build with
  `--features "test-automation desktop"` to get a clean check.

## Resume checklist

1. Launch dev app with `cargo tauri dev --features "test-automation desktop"`.
2. `curl http://127.0.0.1:17320/health` — verify 200.
3. `uvx --with httpx python tools/test-mcp/e2e_build_from_scratch.py --report /tmp/run.json`.
4. Open `/tmp/run.json`; the first `outcome: fail` row is where to
   start.
5. If step 3 (`answer_dimensions`) never hits `draft_ready`, follow the
   "`awaiting_input` never arrives" note.
6. If step 6 (`persona_execution`) returns no matching execution,
   follow the `drive.document.added fires but no execution` note and
   query `persona_events` directly.
7. If the translation never lands, inspect the execution row — the
   agent may need tool access to `drive_write_text`.

Each problem above has a pointer to the exact file/line to start at;
none of them should need re-reading the whole codebase from scratch.
