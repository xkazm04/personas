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
| `37d297a0` | **fix(build,test-harness)**: per-UC event subscription persistence + emits hint in build prompt + scenario runner slice-and-loop fixes. Five sub-fixes after live-running the scenario flushed out the actual failure modes. |

All four ship on `master`; `npx tsc --noEmit` clean; `cargo check --features "test-automation desktop"` clean.

## Session result

Ran the scenario end-to-end against a live `npx tauri dev --features test-automation` app; captured execution rows as proof:

- `build_session 337156da` → persona `132ada2e` promoted with `subscriptions=1` to `drive.document.added`, `trigger_type=event_listener`.
- Drive write to `fresh-inbox/final-*.md` published `drive.document.added` → event bus matched 1 subscriber → persona invoked.
- Execution `2991a1f6-7236-4fb5-8c17-0bff47f2450a` completed (12.3s, $0.14), output assertions 1/1 passed, agent emitted `user_message` + `agent_memory` + `emit_event` per protocol.

**What's NOT there yet: the agent reports the translation complete but cannot actually write the translated file**, because `drive_write_text` isn't registered in the runner's tool registry. `execution_config.tool_names` lists only the built-in shims `["ai_generation","text_analysis","file_read","file_write"]`; there's no wiring from those shims to the sandboxed drive commands. The agent therefore produces a convincing `user_message` ("Translation Completed … Output: `fresh-inbox/final-*_czech.md`") without a matching file on disk.

That last-mile gap is the next session's top task — it's entirely separate from the build/subscribe/dispatch chain that this session fixed, and touches the runner + tool registry rather than the build pipeline.

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

## What I observed running the scenario live (2026-04-22 PM)

Five fixes were needed after the initial commits landed:

1. **Per-UC event subscriptions never persisted.** `create_event_subscriptions_in_tx` in `commands/design/build_sessions.rs` iterated only `ir.events[]` (persona-level) and built a reverse lookup from per-UC subs without ever inserting them. The v3 prompt puts event_subscriptions only on use_cases — so `persona_event_subscriptions` stayed empty and the event bus reported `no subscriber matches`. Fixed: the insert loop now runs per-UC first, then falls back to persona-level; `"listen"` and `"subscribe"` directions are both accepted.

2. **Build LLM chose polling, not events.** Even with the user's answer saying "event-driven only", the LLM picked a `polling` trigger because it had no visibility into which event names the platform actually emits. Fixed: `build_session.rs::build_session_prompt` now extracts `metadata.emits[]` from each available connector and appends `[emits: drive.document.added — ...]` to the `## Available Connectors` section. Rule 15 added telling the LLM to subscribe to listed event_types rather than invent plausible names.

3. **Scenario runner bridge methods got killed at 25s.** `__exec__` has a 25s rejection timer for non-long methods, so any `waitForBuildPhase`/`waitForPersonaExecution` call waiting longer returned `{error: "timeout"}` with no phase/execution field — the Python loop saw `phase: None` forever and never answered. Fixed: both methods slice at 20s and return `{success: false, timedOut: true, ...}` on slice expiry; Python loops per-slice against its own wall-clock budget.

4. **`driveWriteText` swapped its arguments.** `__exec__` uses `Object.values(params)`, which after serde_json alphabetizes keys (`content` < `relPath`) becomes `fn("content_value", "relPath_value")`. Files ended up named after the content string. Fixed: the method accepts either a single `{relPath, content}` object or the alphabetical-positional fallback.

5. **Lazy-chunk mount race.** `startBuildFromIntent` waited 400ms for `UnifiedMatrixEntry`'s React lazy chunk to paint the textarea. First mount after `setIsCreatingPersona(true)` took several seconds on a cold reload. Fixed: polls for `[data-testid="agent-intent-input"]` up to 15s. Also swapped the setup order to match `startCreateAgent` (`selectPersona(null)` BEFORE `setIsCreatingPersona(true)`), avoiding a PersonaEditor/matrix race.

All five fixes land together in `37d297a0`.

## Final remaining gap: drive tools aren't in the runner's tool registry

The agent runs the capability, produces correct protocol output (`user_message`, `agent_memory`, `emit_event: task_completed`, `outcome_assessment.accomplished: true`), and self-reports success — but the translated file is never written to disk because `drive_write_text` isn't in `execution_config.tool_names`. The runner currently only exposes built-in shims:

```
"tool_names": ["ai_generation", "text_analysis", "file_read", "file_write"]
```

To close this, the next session needs to:

1. **Register drive commands as invokable tools.** Look at `src-tauri/src/engine/tool_*` (tool registry) and `src/lib/personas/platformDefinitions.ts`. `drive_write_text` / `drive_read_text` / `drive_list` already exist as Tauri commands — they just need a tool descriptor so the runner can invoke them via the agent's tool_use messages.
2. **Seed the persona's tool_hints with those names.** The build LLM already lists tool hints in each capability; once drive tools exist in the registry, the prompt-side rule can steer the LLM to hint at them when the connector is `local_drive`.
3. **Expose the drive root to the agent's working directory.** Check whether `LOCAL_DRIVE_ROOT` env var is set in `execute_persona`'s process spawn so the agent can call `drive_write_text` with relative paths.

Verification: the scenario's step 7 already polls `drive.list` for translated siblings with common suffixes (`.cs.md`, `.cz.md`, `_cs.md`, `.cs`) — once the tool is wired, that check will flip to `ok`.

## Also worth carrying forward

- **`drive.document.*` Event Builder palette.** Taxonomy entries exist; the `EventListenerConfig` dropdown at `src/features/triggers/sub_triggers/configs/EventListenerConfig.tsx` should pick them up automatically via `getEventTypeOptionsGrouped`, but needs visual confirmation.
- **Scenario screenshots per step.** `/screenshot` endpoint already exists in `test_automation.rs`. Calling it at each chronological step gives a richer post-mortem than the JSON log alone.
- **`__exec__` alphabetical-args quirk.** `driveWriteText` was fixed defensively, but any future multi-arg bridge method is a trip hazard. Consider modifying `__exec__` to pass the params object as a single arg when `fn.length === 1`, with a one-line migration note for existing positional methods.

## State of the codebase for next session

- `master` branch, 5 commits ahead of `f33d71fa` (session starting point): `f1c78796`, `38d05c99`, `53accd50`, `999b1525`, `37d297a0`.
- Uncommitted working-tree churn is entirely from unrelated UI prototypes (`GlyphCard`, `HomeRoadmapView*`, `GuidedTour*`). None of that is in scope.
- Preexisting Cargo errors under the default feature set in `test_automation.rs`, `healthcheck.rs`, `ocr/mod.rs`, `auth_detect.rs` still exist and still fail under the default feature set (unchanged from prior handoffs). Build with `--features "test-automation desktop"` to get a clean check.
- Known stray data from the scenario runs: a few personas named `Document Translator`/`Document Auto Translator`/`Document Auto-Translator` and a `fresh-inbox/` folder with test documents. Both are harmless; delete via `/bridge-exec deleteAgent` or the drive UI if they get in the way.

## Resume checklist

1. Launch dev app with `npx tauri dev -- --features test-automation`.
2. `curl http://127.0.0.1:17320/health` — verify 200.
3. Find the drive tool registration surface (grep `tool_registry` / `platformDefinitions.ts` / `PersonaToolDefinition` for "file_write" — drive_write_text should live adjacent).
4. Wire `drive_write_text` / `drive_read_text` / `drive_list` as invokable tools.
5. Rerun `tools/test-mcp/e2e_build_from_scratch.py --no-persona-cleanup --report /tmp/run.json`. Step 7 (`translated_file`) should flip from `info — no translated sibling found` to `ok` with the file contents.
6. Spot-check the execution detail (use `bridge-exec getPersonaDetail` or query `persona_executions` in SQLite) — look for `tool_use` entries naming `drive_write_text`.
