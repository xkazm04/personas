# C4 — Build-from-scratch scenario handoff (2026-04-23 EOD)

> **Acceptance scenario** (unchanged across sessions): user describes an
> ambiguous intent like *"translate every incoming document from English to
> Czech"* → the build pipeline asks clarifying questions for each dimension
> (trigger, source connector, HITL, destination, memory) → user answers →
> persona promoted → Plugins.Drive fires `drive.document.added` → persona
> executes the translation → translated sibling file lands next to the source.
>
> **Status**: six of the seven chronology steps are proven green; the seventh
> (runner actually writing the translated file) is blocked on drive tools
> not being registered with the runner, which is the next-session target.
> **And** the LLM still resolves most dimensions without asking, despite
> Rules 16–17 in the prompt — the gating redesign is the bigger follow-up.

---

## TL;DR for the next person

Run this, look at the first `[XX]` in the log, start there:

```bash
# In one shell
npx tauri dev -- --features test-automation

# In another
curl -fsS http://127.0.0.1:17320/health   # expect {"status":"ok",...}
uvx --with httpx python tools/test-mcp/e2e_question_loop.py --report /tmp/q-loop.json
```

Current expected behavior:
- Round 0 (mission) **passes** — inline panel renders, answer submits, phase transitions.
- Round 1 — build jumps straight to `test_complete`. That is the bug. LLM
  should be forced to emit 4–5 more `clarifying_question` events.

---

## All commits this arc

In order on `master`, starting from `f33d71fa` (session 1 entry):

| Commit | Type | What |
|---|---|---|
| `f1c78796` | fix | `coerceArgs` must not recurse into class instances (Tauri `Channel`). Original `start_build_session: "invalid type: map, expected a string"` bug. Unit-tested. |
| `38d05c99` | feat | `drive.document.{added,edited,renamed,deleted}` persona events emitted from every Local Drive mutation. Taxonomy + i18n + `local-drive.json` `metadata.emits[]`. Connector seed regenerated. |
| `53accd50` | test | Scenario runner `tools/test-mcp/e2e_build_from_scratch.py`. Generic `/bridge-exec` HTTP dispatcher. Bridge scenario helpers (`startBuildFromIntent`, `answerPendingBuildQuestions`, `waitForBuildPhase`, `waitForPersonaExecution`, `driveWriteText`, `driveList`, `driveReadText`). |
| `999b1525` | docs | Session-1 handoff (now superseded). |
| `37d297a0` | fix | Five production fixes discovered by running the scenario live: per-UC event_subscriptions persisted; build prompt consumes `metadata.emits[]`; bridge methods slice at 20s so `__exec__` doesn't kill long waits; Python loops per-slice; `driveWriteText` handles `__exec__` alphabetical-arg quirk; lazy-chunk mount race for the intent textarea. |
| `2539a1d2` | docs | Session-1 handoff updated with live-run findings. |
| `04a5f6cb` | feat | Rules 16–17 added to the build prompt (force clarifying_question gates per dimension; `scope: "connector_category"` with `category` token). `CredentialPickerCards` moved to `src/features/shared/components/picker/`. New `VaultConnectorPicker` wraps it with a category-filtered vault query + Add-from-Catalog CTA. Adoption imports updated. **Regression introduced:** `SpatialQuestionPopover` auto-opened for every incoming question → modal takeover in every layout. |
| `84eb8447` | fix | Reverts the auto-open. Lifts `GlyphQuestionPanel` to `UnifiedMatrixEntry`'s top level so all three layouts render inline Q&A. Fixes `answerPendingBuildQuestions` stale-snapshot bug (Zustand `getState()` returns a frozen snapshot; re-fetch after `collectAnswer`). Adds `e2e_question_loop.py` — testid-driven per-round assertions. |

Uncommitted working-tree churn (`PersonaUseCasesTab*`, `HomeRoadmapView*`,
`GuidedTour*`, `.claude/CLAUDE.md`) is unrelated UI prototyping; none of it is
in scope for this workstream.

---

## What's live-verified green

Run `uvx --with httpx python tools/test-mcp/e2e_question_loop.py --report /tmp/q-loop.json` against a running dev app, observe the log file:

- Preflight HTTP health
- `startBuildFromIntent` succeeds, draft persona created
- **Inline question panel renders** — `[data-testid="build-inline-questions"]` visible
- **Mission-scope question renders inline** — `[data-testid="glyph-question-behavior_core"]` visible, 3 options, no modal takeover
- `answerPendingBuildQuestions` submits and clears — phase transitions away from `awaiting_input`
- Previously, session-1 proved: drive event bus fires `drive.document.added`, matches to persona subscription, invokes a real LLM execution that completes (`execution_id` + `$0.14` + 1/1 output assertion passed)

## What's broken / half-done — explicit backlog

### 1. LLM resolves most capability fields without asking (highest priority)

Even with the ambiguous intent *"I want an agent that helps me process incoming documents"*, Sonnet asks ONE mission question then jumps straight to `test_complete`. Rules 16–17 of the build prompt (`src-tauri/src/engine/build_session.rs:1774+`) are advisory; the model treats them as suggestions.

**Why the rule-level approach fails:** Sonnet is too good at guessing plausible defaults. Once it's emitted `behavior_core`, it can write `capability_resolution` events for every field from inference alone. The prompt has no mechanism to reject a `capability_resolution` that skipped a gate.

**Required fix — state-machine gate on the Rust side:**

Pseudocode for `src-tauri/src/engine/build_session.rs::run_session`:
```rust
// Per-capability dimension coverage ledger, initialized when
// capability_enumeration arrives. Each flag flips true when either
// (a) a clarifying_question for that dimension has been asked AND
// answered, or (b) the user's intent unambiguously names the value
// (use some heuristic string match — imperfect but safer than
// blindly trusting the LLM).
struct DimensionCoverage {
    trigger: bool,
    source_connector: bool,
    destination: bool,
    review_policy: bool,
    memory_policy: bool,
}

// When parsing LLM events:
match event {
    CapabilityResolution { field: "suggested_trigger", .. } => {
        if !coverage.trigger {
            // Refuse — re-emit a progress message nudging the LLM to
            // ask before resolving. Don't apply the resolution yet.
            emit_error("trigger must be clarified first", retryable: true);
            continue;
        }
    }
    ClarifyingQuestion { scope: "field", field: "suggested_trigger", .. } => {
        // This is the user answering — mark the gate open.
        // (Actually set when the user's answer comes in, not on the question.)
    }
    AgentIr { .. } if !coverage.all_covered() => {
        emit_error("cannot emit agent_ir before all dimensions are clarified");
        continue;
    }
    ...
}
```

Implementation notes:
- The parser in `parse_build_line` → `parse_json_object` is where event dispatch lives. Track coverage in `run_session`'s state.
- When coverage is incomplete and the LLM tries to terminate, send back a prompt-level message like `"You tried to emit agent_ir but capability uc_X has unanswered fields: [connectors, review_policy]. Ask before resolving."` — the CLI's `--continue` channel is already how we send mid-session instructions.
- Heuristic intent-analysis that opens gates automatically (e.g. "every morning" → trigger gate open with `schedule`) is worth doing but keep it conservative.

**Verification:** after the gate lands, `e2e_question_loop.py` should reach 5+ rounds before `test_complete`. Current scoreboard is 1.

### 2. VaultConnectorPicker rendering not yet confirmed end-to-end

Because #1 blocks the LLM from ever emitting `scope: "connector_category"`, the testid path `vault-connector-picker-<category>` has not been asserted by a live run yet. The component is wired (`src/features/shared/components/picker/VaultConnectorPicker.tsx`), its integration into `GlyphQuestionPanel` and `SpatialQuestionPopover` is in place, and both surfaces check `question.connectorCategory` to route rendering. Unit of verification to add to `e2e_question_loop.py` once #1 is fixed:

```python
# Inside inspect_question_dom, when connector_category is set, also
# assert at least one of:
#   [data-testid="vault-connector-picker-<category>"]  (non-empty state)
#   [data-testid="vault-connector-picker-empty"]       (empty state)
# The helper already has this scaffolding.
```

### 3. Drive tools not registered for runner → translated file never materializes

Unchanged from session 1. Agent produces a correct `user_message` saying translation completed but `execution_config.tool_names` is `["ai_generation","text_analysis","file_read","file_write"]` — no `drive_write_text`. Entry point: `src-tauri/src/engine/tool_*` + `src/lib/personas/platformDefinitions.ts`. Wire `drive_write_text` / `drive_read_text` / `drive_list` as invokable tools.

### 4. `__exec__` alphabetical-arg quirk

`Object.values(params)` on a JSON object gives keys in alphabetical order (serde_json without `preserve_order`). For multi-arg bridge methods where positional ≠ alphabetical, args arrive swapped. Currently fixed defensively in `driveWriteText`; any future multi-arg method is a trip hazard. Consider: make `__exec__` pass `fn(params)` as a single object when `fn.length === 1`, or enable the `preserve_order` feature on serde_json.

### 5. Pre-existing Cargo errors under default features

Unchanged from session 1. `test_automation.rs`, `healthcheck.rs`, `ocr/mod.rs`, `auth_detect.rs` need the `test-automation desktop` feature set to compile. Noted here so the next person doesn't waste time diagnosing.

---

## Testing practices that worked

### 1. Testid-driven scenario, not answer-recipe-driven

Session 1 pre-supplied answers via `ANSWERS_BY_KEY` dict — ran green because the Python runner filled in whatever the LLM asked (or didn't ask). That's not a real verification. Session 2's `e2e_question_loop.py` is the replacement pattern:

- Every round polls `listPendingBuildQuestions` to get the real pending set.
- Before answering, queries the DOM for `[data-testid="glyph-question-<cellKey>"]` and for category questions also `[data-testid^="vault-connector-picker-"]`.
- **Fails loudly at the first missing testid** so the first `[XX]` row in the log is always the real breakage.
- Answers use the cellKey → text map but only matches what the LLM actually asked; unrecognized cells get a sensible fallback.
- Tracks `seen_cells` — if the LLM re-asks the same cell, something rejected our last answer.

### 2. Bridge state snapshots are frozen

Zustand `useAgentStore.getState()` returns a SNAPSHOT. Mutations via `set` don't update the returned object. Bridge methods that do `collectAnswer` then immediately read `buildPendingAnswers` off the same `store` reference will see pre-collect state. Always re-fetch via `useAgentStore.getState()` after any action.

### 3. Webview reload isn't free

`window.location.reload()` clears the agent store, un-hydrates build sessions, and drops any helper methods installed via `eval`. The `useBuildSession` mount effect re-hydrates via `get_active_build_session` only when `personaId` is set. If the scenario is flowing, reloading mid-session is a self-inflicted wound.

### 4. Bridge `invoke` needs the IPC auth token

Raw `invoke()` calls via `eval` inside the webview often fail silently because the `x-ipc-token` header isn't set. Use the bridge's existing helpers (they internally use the right Tauri client), or wrap calls through `invokeWithTimeout`. Don't hand-roll `invoke` in eval blocks.

### 5. `__exec__` 25s cap

Long-running bridge methods must be SLICED internally (20s slices, returning `{timedOut: true, ...}`) and the outer Python loop budgets its own wall clock. Directly blocking past 25s makes `__exec__` reject and returns `{error: "timeout"}` with no recoverable fields.

---

## File map — where to look for each concern

### Build pipeline (Rust)

- `src-tauri/src/engine/build_session.rs` — run_session + parser + prompt builder (1400+ lines). Rules 16/17 live at lines 1774+.
- `src-tauri/src/commands/design/build_sessions.rs` — Tauri commands + `promote_build_draft_inner` + the `create_event_subscriptions_in_tx` fix from session 1.
- `src-tauri/src/db/models/build_session.rs` — BuildEvent variants, including the added `category` field on `ClarifyingQuestionV3` and `connector_category` on `Question`.
- `src-tauri/src/commands/drive.rs` — drive commands + `emit_drive_event` helper.

### Build UI (React)

- `src/features/agents/components/matrix/UnifiedMatrixEntry.tsx` — layout switch (legacy-dimensions / v3-capabilities / glyph) + **inline Q&A panel renders above all three layouts**.
- `src/features/shared/glyph/GlyphQuestionPanel.tsx` — the card component (reused by all layouts). Has the testids `glyph-question-<cellKey>`, `glyph-option-<n>`, `glyph-freetext-input`, `glyph-submit-button`. Routes to `VaultConnectorPicker` when `question.connectorCategory` is set.
- `src/features/shared/components/picker/CredentialPickerCards.tsx` — dumb card grid.
- `src/features/shared/components/picker/VaultConnectorPicker.tsx` — vault-aware wrapper. Queries `useVaultStore`, filters by category tags, shows Add-from-Catalog CTA when empty.
- `src/features/templates/sub_generated/gallery/matrix/PersonaMatrix.tsx` — the nested 3×3 matrix (used in v3 layout at opacity-70). `SpatialQuestionPopover` modal is a cell-click escape hatch only now (no longer auto-opens).
- `src/features/agents/components/matrix/SpatialQuestionPopover.tsx` — modal. Detects `question.connectorCategory` and renders `VaultConnectorPicker` inside when present.

### State + IPC

- `src/lib/tauriInvoke.ts` — `coerceArgs` is the guardian of Channel/Resource serialization. Don't regress.
- `src/lib/types/buildTypes.ts` — `BuildQuestion` gained `connectorCategory`; `BuildEvent.clarifying_question_v3` gained `category`.
- `src/stores/slices/agents/matrixBuildSlice.ts` — `handleBuildQuestion` and `handleClarifyingQuestionV3` propagate the category fields.
- `src/test/automation/bridge.ts` — testid bridge + `answerPendingBuildQuestions` fixed-snapshot behavior.

### Scenario runners

- `tools/test-mcp/e2e_build_from_scratch.py` — full end-to-end chronology runner (session 1, uses pre-supplied answers).
- `tools/test-mcp/e2e_question_loop.py` — per-round testid-asserted runner (session 2). Use this going forward for build-pipeline work.

---

## Open questions the next session should answer

1. **Is the LLM-gate a Rust state machine or a prompt trick?** (See backlog item 1.) A Rust gate is more reliable but requires threading coverage state through `run_session`. A prompt trick (e.g. forbidding any `capability_resolution` event in the same turn that didn't have a `clarifying_question` first) might work for 80% of cases with 10% of the effort.

2. **Should the LLM ever be allowed to skip a question?** Probably yes when intent is explicit: "every morning send me a digest of Slack messages" names source, trigger, frequency — no need to ask. The gate needs an "intent-derived" escape hatch that fires before the dimension is forced to ask. Avoid the gate turning every build into a 6-question interview.

3. **Does `VaultConnectorPicker` empty-state deep-link work?** Not verified live. Clicking "Open Catalog" calls `setSidebarSection("credentials")` — navigation should land, but focus-return after credential-added isn't wired. Probably fine for manual use; worth a round-trip test once the LLM actually emits `scope: "connector_category"`.

4. **Does the Glyph layout still render the question panel twice?** After this commit, `UnifiedMatrixEntry` no longer passes `pendingQuestions` to `GlyphGrid`, but `MatrixAdoptionView` still does (for template adoption). Adoption is untested in this pass — verify its Q&A works.

---

## How to resume

1. **Launch:** `npx tauri dev -- --features test-automation`
2. **Baseline:** `uvx --with httpx python tools/test-mcp/e2e_question_loop.py --report /tmp/q-loop.json` — expect round 0 green, round 1 jumps to test_complete.
3. **Fix the gate** (backlog item 1) in `src-tauri/src/engine/build_session.rs::run_session`. Run the scenario after each attempt. Expected green: 4–6 rounds before `test_complete`.
4. **Confirm `VaultConnectorPicker`** renders when the LLM emits `scope: "connector_category"`. If `e2e_question_loop.py` asserts `vault-connector-picker-storage` (or similar) in a round, the component is verified.
5. **Then** move to backlog item 3 (drive tool registration) to close out the translation-actually-happens loop.

Budget: backlog 1 is half a session. Backlog 2 auto-resolves once 1 ships. Backlog 3 is a separate session.
