# 11 — Build Wizard (current state, post-C7/C8)

> Living reference for the build-wizard layer as of 2026-04-28. Covers
> the pipeline state machine, the gate system, the typed-payload
> questionnaire, the glyph UI layout (post-2026-04-28 refactor), the
> dry-run + auto_triage runtime flows, and a file map you can grep into
> when extending any surface.
>
> **Why this doc exists:** the building / glyph / questionnaire /
> components surfaces grew significantly during C5-C8 and the legacy
> docs (`06-building-pipeline.md`, `08-frontend-impact.md`) freeze at
> earlier phases. This doc is the canonical "what's there now" so we
> can plan the next wave without rebuilding the mental model from
> handoff archaeology.

---

## TL;DR — what runs when

```
user types intent in Design tab
  └─> UnifiedMatrixEntry creates a draft persona (enabled=false)
        └─> startBuildFromIntent → BuildSession (phase: initializing)
              ↓
        BuildSession runner spawns claude CLI with the build prompt
              ↓
        runner emits BuildEvent stream (CellUpdate / Question / Progress / agent_ir)
              ↓
        gate state machine in `engine::build_session::gates` blocks
        clarifying-question elision per dimension (rule defenses)
              ↓
        runner persists `agent_ir` JSON to build_session row when LLM emits it
              ↓
        when LLM emits agent_ir AND all gates open → phase: draft_ready
              ↓
        user clicks "Test" → triggerBuildTest → runs tool tests
              ↓ (phase: test_complete)
              ├──> "Dry-run" button → simulate_build_draft (snapshots
              │      design_context, dispatches simulate execution,
              │      returns artefacts) — does NOT mutate phase
              └──> "Promote" → promote_build_draft_inner (single SQL tx
                     creating triggers / subs / tools / smee_relays;
                     post-tx auto_create_smee_relays for webhook URLs)
                       ↓ (phase: promoted)
                     persona becomes enabled=true; runtime takes over
```

The build session's `phase` column is **strict** —
`build_session.rs::validate_transition` allows only:
- `DraftReady → Testing | Resolving | Promoted`
- `Testing → TestComplete | DraftReady | Testing`
- `TestComplete → Testing | Promoted`

There is **no `SimulationPhase`**. Dry-run is a side action callable
from `draft_ready` / `testing` / `test_complete` / `promoted`.

---

## Section 1 — Backend pipeline

### 1.1 Phase machine

`src-tauri/src/db/models/build_session.rs::BuildPhase`:

| Phase | Meaning |
|---|---|
| `Initializing` | Session row inserted, runner not yet spawned |
| `Analyzing` | Runner spawned claude CLI, no events back yet |
| `Resolving` | LLM emitted at least one CellUpdate; gates checking |
| `AwaitingInput` | LLM emitted a clarifying_question; pending_question column set |
| `DraftReady` | LLM emitted agent_ir + all gates open |
| `Testing` | User triggered triggerBuildTest |
| `TestComplete` | Tool tests reported back |
| `Promoted` | promote_build_draft_inner committed |
| `Failed` | Runner crashed / unrecoverable error |

### 1.2 Gate state machine — `engine::build_session::gates`

For each capability (`cap_id`), four dimensions have gates:
`trigger`, `connectors`, `review_policy`, `memory_policy`. Each is one
of:
- `Closed` — no answer yet, will block agent_ir if the LLM tries to emit
- `Pending` — clarifying_question asked, waiting for user
- `Open` — answered (or auto-opened by intent heuristic)

**Initial seeding**: when the LLM emits a `capability_enumeration` or
`capability_resolution`, `gate_seed_for_intent` runs each dimension's
keyword heuristic against the user's intent text:
- `trigger` opens on: `every morning|day|week|month`, `daily.|daily `,
  `runs daily|weekly|monthly`, `weekly at`, `monthly at`, `at 9am`,
  `cron`, event keywords (`whenever`, `when a`, `as soon as`,
  `incoming`, `arrives`), manual keywords (`on command`, `manually`,
  `on demand`). **Bare `weekly`/`monthly` are intentionally NOT
  keywords** — they are content modifiers more often than schedule
  expressions (closed in C8).
- `review_policy` opens on: `automatically`, `auto-publish`, `no
  review`, `no human`, `fully automated`.
- `memory_policy` opens on: `stateless`, `independently`, `no memory`,
  `remember user`, `learn over time`.
- `connectors` opens on a fuzzy keyword match against the connector
  registry's `name` set (plus a small fallback list for cold-start).

When the LLM tries to emit `agent_ir` but a gate is still `Closed`, the
runner suppresses the IR emit and synthesizes a clarifying_question for
that dimension via `synthesize_gate_question`.

### 1.3 Build prompt rules (numbered)

`src-tauri/src/engine/build_session/session_prompt.rs`. Stable as of
C8:

| Rule | Subject |
|---|---|
| 1-15 | Phase A/B/C scaffolding (mission, principles, capability granularity, event names, etc.) |
| 16 | Heuristic mirror — keep keyword lists in sync with `gates.rs::intent_implies_*` |
| 17-20 | Per-capability resolution structure |
| 21 | `mode: "auto_triage"` for "let agent decide" / decision-principle-judged intents |
| 22 | Verbatim event names — never rewrite backtick-quoted user-supplied event_types |
| **23 (C7)** | When the LLM needs a sample/template/example, emit clarifying_question with `accepts_reference: true` |
| **24 (C7)** | When the LLM picks `webhook` trigger, MUST emit clarifying_question with `accepts_webhook_source: true` so the user can attach a smee.io URL — UNLESS the user already pasted a smee URL in the intent (then pull it verbatim into `smee_channel_url`). |

Numbering is load-bearing — the LLM has internalised the existing
rules. New rules go at the end.

### 1.4 Three storage planes (post-promote)

This is the most error-prone part of the system to reason about. The
LLM emits ONE IR shape, the promote pipeline transforms it into THREE
outputs with different key conventions and consumers:

| Field | Where written | What it carries | Who reads it |
|---|---|---|---|
| `build_sessions.agent_ir` | LLM emits `agent_ir` event → runner stores raw JSON | Full v3 IR, **LLM-emitted UC ids** (`uc_generate_invoice`), `persona` block | `simulate_build_draft`, `test_build_draft`, dry-run snapshot |
| `personas.design_context` | `promote_build_draft_inner::update_persona_in_tx` | `useCases[]` (camelCase, **UUID-rekeyed**: `uc-b98e…`) + `summary` + `builderMeta`. **C7+**: also `review_policy`, `generation_settings`, `memory_policy` per UC | `pick_use_cases_array` helper (tries snake/camel both), `pick_generation_policy`, `cascade_use_case_toggle` |
| `personas.last_design_result` | `promote_build_draft_inner` | Flat v2 shape (`suggested_*`, `use_case_flows`, `structured_prompt`, `full_prompt_markdown`). **C7+**: also `persona` block (mission/principles/constraints/decision_principles) hoisted by `AgentIr.persona` field | `auto_triage::extract_principles_from_design_result`, design preview UI |

**Always use `engine::design_context::pick_use_cases_array(&dc)` to
read** — it tries snake_case first, falls back to camelCase. Migrating
older readers to this helper closed the C7 case-key bug; future
readers should use it on day one.

**UC-id reconciliation** (C8): `simulate_build_draft` accepts EITHER
the LLM-emitted name OR the post-promote UUID. Internally it uses
`resolve_simulation_use_case_id` which matches against the snapshot
first, then falls back to a position-based lookup against the persona's
prior `design_context`. See
`commands/design/build_simulate.rs::resolve_simulation_use_case_id`.

### 1.5 Typed-payload questionnaire (C7)

Beyond plain text answers, two question types accept structured
payloads:

**`accepts_reference: true`** (rule 23) — user attaches:
- File (path) — read by `engine::build_session::reference::read_file_reference`, extension allowlist, 256 KB cap, UTF-8 only
- URL — fetched by `fetch_url_reference`, SSRF-safe transport, content-type allowlist (text/*, application/json/xml/yaml/toml), 256 KB body cap
- Inline text — pasted directly

`materialise_reference` routes to the right loader. Contents are
fenced as `--- ATTACHED REFERENCE: <name> ---\n…\n--- END REFERENCE ---`
and prepended to the answer text before the CLI sees it.

**`accepts_webhook_source: true`** (rule 24) — user attaches:
- smee channel URL (must start `https://smee.io/`)
- optional comma-separated `event_filter`

Validator in `validation/trigger.rs` enforces the URL prefix.
`append_webhook_source_fence` writes a `--- WEBHOOK SOURCE ---` block.
At promote time, `auto_create_smee_relays` (post-tx, best-effort)
creates the `smee_relays` row binding the URL to the persona.
Idempotent on `(persona_id, channel_url)`; refuses to repoint
cross-persona.

### 1.6 Dry-run preview

`commands/design/build_simulate.rs::simulate_build_draft`:
1. Loads build_session row.
2. Captures `personas.design_context` as `prior_design_context` (so the
   resolver can map UUID → LLM-name BEFORE it gets overwritten).
3. Parses `session.agent_ir` (or falls back to
   `persona.last_design_result`).
4. Applies any adoption_answers.
5. Builds a snake-case snapshot via
   `build_simulation_design_context(&ir)`.
6. **Persists snapshot to `personas.design_context`** (overwrites
   any prior value).
7. Resolves `use_case_id` via `resolve_simulation_use_case_id`.
8. Calls `execute_persona_inner(..., is_simulation=true)`.

`get_simulation_artefacts(execution_id)` returns
`{executionId, reviews[], memories[]}`. **Messages and events
deliberately deferred** — no per-execution accessors today.

The phase machine is **not mutated**. Dry-run is a side action.

### 1.7 auto_triage runtime

`engine::auto_triage` (added in C6, runtime verification added in C8
via Phase D2 + `synthesize_manual_review`):

When dispatch processes `ProtocolMessage::ManualReview` and the
capability's `review_policy.mode == "auto_triage"`:
1. Insert review row with status `Pending`.
2. `spawn_evaluator_task` fires a tokio task with all context
   cloned/owned — dispatch loop is never blocked.
3. Task loads `persona.last_design_result.persona.{decision_principles,
   principles, constraints}` + per-UC `review_policy.context`.
4. `evaluate()` calls `claude -p -` single-turn against the evaluator
   prompt (120s timeout).
5. `parse_verdict_response` accepts `{verdict: "approve"|"reject",
   reasoning: "..."}` JSON, tolerant of surrounding prose and synonyms.
6. `apply_verdict` updates review row to `Approved` / `Rejected` and
   audits via `policy_events` with kind
   `review.auto_triage.{approved|rejected}`.
7. On any failure (CLI spawn / timeout / parse error) → `apply_fallback`
   updates row to `Resolved` and audits
   `review.auto_triage.fallback`. Preserves the C6 MVP behaviour so a
   degraded evaluator never blocks a run.

The C8 test bridge command `synthesize_manual_review` (gated by
`#[cfg(feature = "test-automation")]`) bypasses dispatch entirely:
inserts a synthetic execution row + manual_review row + spawns the
evaluator directly. Used by `e2e_phase_d2.py` to verify the runtime
end-to-end without LLM nondeterminism on `request_review` emits.

---

## Section 2 — Frontend layout

### 2.1 Component tree (post-2026-04-28 Glyph refactor)

```
DesignTab (sub_design)
  └── UnifiedMatrixEntry (matrix/UnifiedMatrixEntry.tsx)
       │
       ├── (intent capture form — initial empty state)
       │
       └── GlyphFullLayout (glyph/GlyphFullLayout.tsx) — when build session active
             │
             ├── GlyphTopBar       — persona name + phase chip + back button
             ├── GlyphHeroSigil    — big animated sigil (status visual)
             │     └── GlyphSigilCanvas + GlyphSigilFace
             ├── GlyphPetalIcons   — petal cluster around sigil for capabilities
             ├── GlyphOrbitProgress — orbit ring showing dimension resolution
             ├── GlyphCoreContent  — center content (varies by phase)
             │     ├── (analyzing/resolving) GlyphActivityStrip
             │     ├── (awaiting_input)      GlyphQuestionPanel + SpatialQuestionPopover
             │     ├── (draft_ready)         dimension summary cards
             │     └── (test_complete)       GlyphTestCompleteCore
             │           ├── "Dry-run" button → BuildSimulatePanel modal
             │           ├── "Promote" button → promoteBuildDraft
             │           └── "Refine" button  → GlyphRefineComposer
             ├── GlyphRowSection   — collapsible rows below the sigil
             │     └── GlyphRowStrip
             ├── GlyphLegend       — legend / status chips
             ├── GlyphDimensionSummaryCard — per-dimension summary tile
             └── GlyphAnswerCard   — answered-question chip
```

`commandPanel/` subdir under `glyph/` holds the wizard's command
console (search bar + slash commands for "name agent", "open
dimension", etc.). Composer tooling rendered there.

### 2.2 Questionnaire UI — `SpatialQuestionPopover`

`src/features/agents/components/matrix/SpatialQuestionPopover.tsx`.
Renders the active clarifying_question's UI. Three modes wired off
question flags:

- **plain text** — default. `<textarea>` + Submit button.
- **`acceptsReference: true`** — mounts `ReferenceAttachmentPicker`
  (file / URL / inline 3-mode picker). Submit enabled when EITHER text
  OR a reference is present.
- **`acceptsWebhookSource: true`** — mounts `WebhookSourcePicker`
  (smee URL + optional event_filter). Submit enabled when EITHER text
  OR a webhook source is present.

The two picker modes are mutually exclusive in practice (the LLM
emits one or the other per question, never both).

### 2.3 Picker modals

| Modal | Path | Triggered by | What it does |
|---|---|---|---|
| `ReferenceAttachmentPicker` | `matrix/ReferenceAttachmentPicker.tsx` | `acceptsReference: true` clarifying_question | 3-mode UI: file via `@tauri-apps/plugin-dialog::open()`, URL with HTTPS validation, inline textarea |
| `WebhookSourcePicker` | `matrix/WebhookSourcePicker.tsx` | `acceptsWebhookSource: true` clarifying_question | smee URL form + filter input + "Create at smee.io/new" external link |
| `MatrixCredentialPicker` | `matrix/MatrixCredentialPicker.tsx` | (legacy matrix path) connector dimension | Vault-backed credential selector with quick-add modal |
| `TablePickerModal` | `matrix/TablePickerModal.tsx` | per-connector resource selection | Lists connector resources (e.g. ElevenLabs voices) by API |
| `BuildSimulatePanel` | `matrix/BuildSimulatePanel.tsx` | "Dry-run" button in `GlyphTestCompleteCore` | UC dropdown + input override + Run button → calls `simulateBuildDraft` → renders artefacts (reviews, memories) |
| `BuildReviewPanel` | `matrix/BuildReviewPanel.tsx` | (legacy review queue surfacing) | Lists pending manual reviews scoped to the active build's draft persona |

### 2.4 Hooks + state

- `useMatrixBuild` (`matrix/useMatrixBuild.ts`) — orchestrates `startBuildFromIntent` / `answerPendingBuildQuestions` / typed-payload short-circuits / `triggerBuildTest` / `promoteBuildDraft`. Single source of truth for the "what should the wizard do next" decision.
- `useMatrixLifecycle` (`matrix/useMatrixLifecycle.ts`) — manages the persona row lifecycle (create / abandon / delete) around the build session.
- `useBuildSession` (`hooks/build/useBuildSession.ts`) — Zustand bridge for active session state (sessionId, phase, pendingQuestion, agentIr).
- `useGlyphLayoutState` (`glyph/useGlyphLayoutState.ts`) — derives the glyph's animation/visual state from build phase + dimension counts + last events.

Layout preference is stored under `localStorage["personas:build-layout"]` with two valid values:
- `"glyph-full"` (default — current flagship)
- `"legacy-dimensions"` (8-dimension matrix grid, preserved as fallback)

Earlier `"v3-capabilities"` and `"glyph"` values migrate to `"glyph-full"` on read.

---

## Section 3 — File map (where each piece lives)

### Backend (`src-tauri/src/`)

| Concern | File |
|---|---|
| Build session phase machine | `db/models/build_session.rs::BuildPhase` |
| Build session storage / retry | `commands/design/build_sessions.rs` |
| Build runner (CLI subprocess + event loop) | `engine/build_session/runner.rs` |
| Build prompt (rules 1-24) | `engine/build_session/session_prompt.rs` |
| Gate state machine | `engine/build_session/gates.rs` |
| BuildEvent parser | `engine/build_session/parser.rs` |
| Reference attachment loader / fence | `engine/build_session/reference.rs` |
| Webhook source fence | `engine/build_session/reference.rs::append_webhook_source_fence` |
| design_context shape helper | `engine/design_context.rs::pick_use_cases_array{,_mut}` |
| Dry-run command | `commands/design/build_simulate.rs` |
| Dry-run UC-id resolver (C8) | `commands/design/build_simulate.rs::resolve_simulation_use_case_id` |
| Synthesize manual_review (test-only) | `commands/testing/synthesize_review.rs` |
| auto_triage second-pass evaluator | `engine/auto_triage.rs` |
| auto_triage spawn from dispatch | `engine/dispatch.rs::ProtocolMessage::ManualReview` |
| Promote pipeline (single-tx) | `commands/design/build_sessions.rs::promote_build_draft_inner` |
| smee auto-bind post-tx | `commands/design/build_sessions.rs::auto_create_smee_relays` |
| Trigger config (incl. smee fields) | `db/models/trigger.rs::TriggerConfig::Webhook` |
| Trigger validator | `validation/trigger.rs` |
| AgentIr (incl. `persona` block hoist) | `db/models/agent_ir.rs` |
| design_context envelope type | `db/models/persona.rs::DesignContextData` |

### Frontend (`src/`)

| Concern | File |
|---|---|
| Wizard entry / variant switch | `features/agents/components/matrix/UnifiedMatrixEntry.tsx` |
| Glyph-full layout (current flagship) | `features/agents/components/glyph/GlyphFullLayout.tsx` |
| Glyph layout state derivation | `features/agents/components/glyph/useGlyphLayoutState.ts` |
| Glyph layout helpers / types | `features/agents/components/glyph/{glyphLayoutHelpers.ts,glyphLayoutTypes.ts}` |
| Glyph sigil canvas (animated) | `features/agents/components/glyph/{GlyphSigilCanvas,GlyphSigilFace,GlyphHeroSigil}.tsx` |
| Glyph orbit progress | `features/agents/components/glyph/GlyphOrbitProgress.tsx` |
| Glyph petal icons | `features/agents/components/glyph/GlyphPetalIcons.tsx` |
| Glyph core content (phase-specific) | `features/agents/components/glyph/GlyphCoreContent.tsx` |
| Glyph activity strip | `features/agents/components/glyph/GlyphActivityStrip.tsx` |
| Glyph test-complete (Dry-run / Promote / Refine) | `features/agents/components/glyph/GlyphTestCompleteCore.tsx` |
| Glyph refine composer | `features/agents/components/glyph/GlyphRefineComposer.tsx` |
| Glyph row strip | `features/agents/components/glyph/{GlyphRowSection,GlyphRowStrip}.tsx` |
| Glyph dimension summary card | `features/agents/components/glyph/GlyphDimensionSummaryCard.tsx` |
| Glyph editable name | `features/agents/components/glyph/GlyphEditableName.tsx` |
| Glyph edit face | `features/agents/components/glyph/GlyphEditFace.tsx` |
| Glyph legend | `features/agents/components/glyph/GlyphLegend.tsx` |
| Glyph top bar | `features/agents/components/glyph/GlyphTopBar.tsx` |
| Glyph answer card | `features/agents/components/glyph/GlyphAnswerCard.tsx` |
| Glyph command panel (slash-commands) | `features/agents/components/glyph/commandPanel/` |
| Question popover | `features/agents/components/matrix/SpatialQuestionPopover.tsx` |
| Reference attachment picker | `features/agents/components/matrix/ReferenceAttachmentPicker.tsx` |
| Webhook source picker | `features/agents/components/matrix/WebhookSourcePicker.tsx` |
| Build simulate panel | `features/agents/components/matrix/BuildSimulatePanel.tsx` |
| Matrix-build orchestration hook | `features/agents/components/matrix/useMatrixBuild.ts` |
| Matrix lifecycle hook | `features/agents/components/matrix/useMatrixLifecycle.ts` |
| Build session bridge | `hooks/build/useBuildSession.ts` |
| Test bridge | `test/automation/bridge.ts` |
| Cell vocabulary (cellKeys) | `features/agents/components/matrix/cellVocabulary.ts` |
| Buildtypes | `lib/types/buildTypes.ts` |
| API wrappers (invoke) | `api/agents/buildSession.ts` |

---

## Section 4 — How to extend (cookbook)

**Adding a new clarifying-question typed payload** (e.g. a future "code
fixture" picker):

1. Backend: add `accepts_<name>: bool` to `BuildEvent::{Question,
   ClarifyingQuestionV3}` + `parser.rs`. Add `User<Name>Source`
   struct + `UserAnswer.<name>_source` field. Implement a
   `materialise_<name>` loader in
   `engine/build_session/reference.rs` (or a new sibling module).
2. Build prompt: add a new numbered rule (currently rules end at 24)
   describing when to ASK vs SKIP and the JSON shape.
3. Frontend: add `BuildQuestion.accepts<Name>: boolean` in
   `lib/types/buildTypes.ts`. Build a picker component matching
   `ReferenceAttachmentPicker` / `WebhookSourcePicker` shape. Mount in
   `SpatialQuestionPopover` behind the flag.
4. `useBuildSession::answerQuestion` short-circuits the batch path
   when `<name>Source` is set; sends straight to
   `answer_build_question`.
5. Test bridge helper `answerBuildQuestionWith<Name>(cellKey, answer,
   source)` in `test/automation/bridge.ts` — **positional args, NOT a
   single object** (the bridge dispatcher's `parseParamNames` /
   `resolveArgs` matches Python params dict to declared names; single-
   object signatures fall back to alphabetical `Object.values` and
   scramble argument order).

**Adding a new build-session phase**: don't, unless the runner needs
genuine new behaviour. The current 9-phase machine is small and
strict. Side actions (dry-run, simulate) should not mutate phase.

**Touching the gate keyword lists**: keep `intent_implies_*` in
`gates.rs` mirrored against the build prompt's rule 16 description.
Drift between them creates ghost behaviour where the gate auto-opens
but the prompt thinks it should ask. Tests in `gates::tests` pin the
behaviour.

**Reading from `design_context`**: always go through
`engine::design_context::pick_use_cases_array(&dc)`. Snake_case and
camelCase shapes both ship in production today (snake from C7 dry-run
snapshots, camel from matrix-builder promotes). Hardcoding either key
will silently regress on one of the populations.

**Touching auto_triage**: the runtime path is in `dispatch.rs` →
`spawn_evaluator_task`. The pure pieces (`build_evaluator_prompt`,
`parse_verdict_response`, `extract_principles_from_design_result`) are
in `auto_triage.rs` and have 14 unit tests pinning behaviour. The test
bridge `synthesize_manual_review` in `commands/testing/synthesize_review.rs`
gives you a deterministic E2E hook.

**Adding a new connector that the build LLM should know about**: add
to `db/builtin_connectors.rs` (one row in the `BUILTIN_CONNECTORS`
slice). The `name` field is what the build prompt's connector
enumeration shows the LLM. Categories ship through to
`category_groups.rs`.

---

## Section 5 — Known landmines

These are the bugs / gotchas that have bitten previous sessions. Worth
keeping in mind:

1. **agent_ir-landing race** — runner emits `phase: test_complete`
   shortly before `session.agent_ir` is queryable. C6 added a 2s
   server-side retry inside `promote_build_draft_inner`; phase drivers
   add a 60s client-side `wait_for_agent_ir` poll. Both are belt-and-
   braces.
2. **camelCase vs snake_case design_context** — closed in C7 via the
   `pick_use_cases_array` helper. Never hardcode either key.
3. **UC-id rekey at promote** — closed in C8 via
   `resolve_simulation_use_case_id`. `agent_ir` keeps LLM names;
   `design_context` rekeys to UUIDs. Dry-run accepts either form.
4. **Bridge dispatch arg shape** — bridge.ts methods MUST use
   positional args matching Python's params dict keys, NOT a single
   `params: {...}` object. The dispatcher falls back to alphabetical
   `Object.values` when no declared name matches.
5. **bridge.ts has side effects** — `window.__TEST__ = bridge` at
   module init means Vite HMR doesn't reload it cleanly. Hard
   `location.reload()` (via `/eval` or restart) needed after editing
   bridge.ts.
6. **Bridge tier** — the test bridge calls `invoke` with raw
   `@tauri-apps/api/core` (no token). Privileged or Cloud commands
   won't reach the bridge. Either keep the command Public (with
   `require_auth`-inner if state-mutating) or write a test-only
   `bridge_<cmd>` shim gated by `#[cfg(feature = "test-automation")]`.
7. **Build prompt rule changes propagate immediately** — no cache
   invalidation needed. The prompt is composed fresh per build session.
   Touch the file, wait for tauri rebuild, next `startBuildFromIntent`
   uses the new prompt.
8. **Verbose intents confuse the LLM** — verbose intents with multi-
   step chains can wedge in `resolving` for many rounds without
   finalising. C8's Phase J needed two iterations of trim before the
   LLM converged. When a Phase driver hangs without producing
   agent_ir, **simplify the intent first**, then debug the driver.
9. **Concurrent file-watcher activity destabilises the dev server** —
   any tool re-saving frontend files during a phase driver run can
   trigger HMR-induced reloads that kill the in-flight build session.
   Hold the watcher when running drivers.

---

## Cross-references

- Per-session detail: `C5-handoff-2026-04-25-EOD.md`,
  `C5-handoff-2026-04-26.md`, `C6-handoff-2026-04-27.md`,
  `C7-handoff-2026-04-28.md`, `C8-handoff-2026-04-28.md`.
- Test scenario suite (Phase A through K): `12-test-scenarios.md` and
  `test-scenarios.xlsx`.
- Original C2 building pipeline (historical): `06-building-pipeline.md`.
- Original tab-by-tab UI rewiring (historical): `08-frontend-impact.md`.
- Implementation plan with phase-by-phase status:
  `09-implementation-plan.md` (see "Build-wizard wave — sessions
  C5/C6/C7/C8" section).
- Active deferred items: `10-deferred-backlog.md` (see §N — Build-
  wizard wave deferred items).
