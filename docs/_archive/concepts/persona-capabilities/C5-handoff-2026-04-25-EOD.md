# C5 — Build-from-scratch acceptance scenarios — 2026-04-25 EOD handoff

> Continuation of `C5-build-from-scratch-acceptance-scenarios.md`. The previous
> session shipped scenario 1 end-to-end (build → promote → drive event →
> execution → translated artefact in the Drive plugin). Scenarios 2 and 3
> reached `test_complete` and produced promoted personas, but their **live
> execution was not exercised** — they're schedule-triggered (daily / hourly)
> so a test run can't observe an actual execution without waiting for the
> wall-clock or injecting a manual run.
>
> This session's contribution: a **manual "Run now" trigger** on the use-case
> detail panel + the "Personas Tool Semantics — Mandatory Algorithm" runtime
> prompt section that finally got scenario 1 to land its translated file in
> the real Drive sandbox. Next session continues by exercising scenarios 2
> and 3 via the manual trigger and asserting downstream chained UC2.

---

## TL;DR for the next person

1. **Launch dev with test-automation** (the runners need port 17320):
   ```bash
   npx tauri dev -- --features test-automation
   ```
2. **Re-run scenario 1 as a sanity check** — it should still land a Czech
   sibling in `<drive_root>/inbox/eng-sample-<timestamp>_cs.md`:
   ```bash
   python tools/test-mcp/e2e_full_translation.py --report /tmp/s1.json
   ```
3. **Use the new "Run now" button** on each scenario-2/3 persona's use-case
   detail panel — confirms the chained event delivery that schedule-triggered
   personas can't otherwise demonstrate without manual time travel.
4. **For scenario 3 specifically**: run UC1 ("Sentry triage"), confirm UC2
   ("GitHub writeup") fires automatically when UC1 emits its
   `<persona>.<task>.accepted` event. That's the autotriage chain.

---

## What landed this session (changes still uncommitted on `master`)

### A — Tool selection algorithm in the runtime prompt
`src-tauri/src/engine/prompt/mod.rs::assemble_prompt`

A new `## Tool Selection — Mandatory Algorithm` section enumerates the three
tool families and codifies the decision rule as pseudocode:

```text
IF data_will_be_seen_by_user OR data_will_trigger_downstream_persona:
   connector = the one wired into this capability's `connectors`
   verb      = the connector's MCP verb that matches the operation
   CALL `mcp__personas__<verb>` with the relative path/identifier from
   `input_data` (RELATIVE to the connector sandbox, never CWD)
ELIF data_is_purely_transient_for_your_own_reasoning:
   CALL Bash / Read / Write / Edit on CWD
ELIF persona_IR_registered_a_specific_named_tool:
   CALL that tool by its declared name
```

Behavior-driven, **not** connector-specific — future personas (GDrive,
Dropbox, Slack, vector DB, …) inherit it for free. Includes trip-wires
("`input_data.path` is RELATIVE to the connector, not your CWD") and
injects the actual `PERSONAS_DRIVE_ROOT` path so the LLM can ground its
sandbox claim.

**Live result:** scenario 1's persona uses `mcp__personas__drive_write_text`
with the relative sibling path — translated file lands in the Drive plugin
where the user can see it.

### B — `listen_event_type` translation at the IR-to-trigger boundary
`src-tauri/src/commands/design/build_sessions.rs::create_triggers_in_tx`

The dispatcher's matcher is `json_extract(config, '$.listen_event_type')`.
The LLM emits one of: `event_type` (singular string) / `event_types[0]`
(plural array) / `events[0]` / `subscribe_to[0]` / `event`. Without
translation, the SQL filter returned 0 rows for every event-driven persona
and dispatch silently no-op'd.

The fix probes all five shapes and lifts the first non-empty value into
`listen_event_type`. Build pipeline now produces dispatcher-compatible
trigger configs regardless of the LLM's chosen IR vocabulary.

### C — Manual "Run now" button on the use-case detail panel
`src/features/agents/sub_use_cases/libs/useUseCaseDetail.ts` +
`src/features/agents/sub_use_cases/components/detail/UseCaseDetailPanel.tsx`

A second action button next to the existing "Test" button:

| Button | Calls | Effect |
|---|---|---|
| **Test** (`Play` icon) | `startTest` (lab harness) | Sandboxed run — records to lab module, does **not** emit events to subscribers. |
| **Run now** (`Rocket` icon, `data-testid="use-case-run-now"`) | `executePersona(personaId, undefined, inputData, useCaseId, ...)` | Real CLI spawn, real cost, **fires `emit_event` protocol messages** that cascade to downstream personas listening on this UC's event_subscriptions. |

The hook (`useUseCaseDetail`) exposes `handleManualRun` + `isManualRunning`.
The handler:
- Pulls `selectedFixture.inputs ?? useCase.sample_input` as the input payload.
- Generates a `crypto.randomUUID()` idempotency key.
- Surfaces failures via `toastCatch('use-case:manual-run', ...)`.
- Disabled while a test is also running (avoids lab-harness contention).

This is **the** mechanism for testing schedule-triggered personas without
waiting for cron, AND for verifying chained event delivery on demand.

### D — Cleanup helpers + composer-input probe in the test bridge
`src/test/automation/bridge.ts`
- `listAllPersonas` / `deletePersonaById` / `getPersonaIr` so scenario
  runners can purge prior copies (a single drive event was fanning out to
  ~7 stale clones from prior runs).
- `startBuildFromIntent` now probes both `[data-testid="agent-intent-input"]`
  (legacy GlyphFullLayout) and `[data-testid="composer-row-task"]` (current
  CommandPanelComposer) to stay robust to UI evolution.

### E — Scenario runners (re-created)
- `tools/test-mcp/e2e_full_translation.py` — adds cleanup, per-run unique
  `eng-sample-<timestamp>.md` filename (so every run produces a fresh
  `drive.document.added` event, never `edited`), 120s httpx client timeout,
  `MAX_PER_CELL=4` loop guard.
- `tools/test-mcp/e2e_news_watch.py` — same shape, asserts schedule
  trigger + emit subscription.
- `tools/test-mcp/e2e_sentry_watcher.py` — same shape, asserts ≥1 trigger
  and tracks `distinct_capabilities` (UC1 + UC2).

---

## Where each scenario stands

### Scenario 1 — Document Translation ✅ FULLY GREEN

Live verification 2026-04-25 (run timestamp 1777130064):
```
[OK] cleanup → start_build → 5 rounds → test_complete → promote
[OK] drive.write: inbox/eng-sample-1777130064.md  ← user input lands in Drive
[OK] exec.wait                                    ← persona executed
[OK] drive.read_translation: inbox/eng-sample-1777130064_cs.md (118 bytes)
   "# Čtvrtletní aktualizace … Naše tržby v 1. čtvrtletí vzrostly o 17 %.
    Děkujeme za skvělou práci."
```

The persona used `mcp__personas__drive_write_text` (not built-in Write) to
save the sibling. Confirmed by the file appearing in the actual Drive
plugin sandbox listing.

**Persona:** `Document Translation Assistant`
(`5a80651a-1303-4ccc-a030-b3682d57ac39`)

### Scenario 2 — News Scraper ⚠️ BUILD GREEN, EXEC NOT YET EXERCISED

Build & promote verified live (2026-04-25 15:19):
```
[OK] cleanup → start_build → 6 rounds → test_complete → promote
[OK] ir.shape: triggers=1 subscriptions=1 tools=3
[OK] ir.trigger: trigger_type=schedule
[OK] ir.subscriptions: event_types=['market.digest.published']
```

**Persona:** `AI Agent Market Intelligence`
(`811c8374-8946-424e-8ca1-ff02b02cc89a`)

The trigger is `schedule` (cron `0 7 * * *`, next fire 2026-04-26 05:00 UTC).
**No execution has run yet** — that needs either (a) the wall clock to
advance to the cron tick, or (b) the new "Run now" button to fire the UC
manually. Use (b) next session.

### Scenario 3 — Sentry Watcher ⚠️ BUILD GREEN, EXEC NOT YET EXERCISED

Build & promote verified live (2026-04-25 15:22):
```
[OK] cleanup → start_build → 7 rounds → test_complete → promote
[OK] ir.shape: triggers=2 subscriptions=2 distinct_capabilities=2
```

**Persona:** `Sentry Issue Tracker`
(`7bcf1f8a-fa42-427d-aa5c-9f216a0dd6f8`)

The LLM correctly enumerated **2 capabilities** (UC1 = Sentry triage, UC2 =
GitHub writeup), each with its own trigger and subscription. Both triggers
are schedule-based. No execution has run yet — same situation as scenario 2.

The interesting downstream-chain assertion (UC1 emits → UC2 listens →
UC2 fires automatically) requires the manual trigger to bootstrap UC1.

### Persona-list visibility note

User reported "I only see the translation persona in the UI". All three
personas are in the DB with `enabled=true` (verified via `listAllPersonas`
bridge call):

| ID | Name | Trust origin | Created |
|---|---|---|---|
| `5a80651a` | Document Translation Assistant | builtin | 15:14 |
| `811c8374` | AI Agent Market Intelligence | builtin | 15:19 |
| `7bcf1f8a` | Sentry Issue Tracker | builtin | 15:22 |

The visibility issue is UI-side filtering, not missing data. The most
likely culprit is `personaSlice.fetchPersonas` returning all rows but the
agents page applying a category/group filter. Worth investigating in a
follow-up session — entry point: `src/stores/slices/agents/personaSlice.ts`
+ wherever `personas.filter(...)` is called in the agents grid.

---

## Step-by-step plan for next session

### Phase 1 — Sanity check (5 min)

1. Launch dev with test-automation feature.
2. Re-run `e2e_full_translation.py`. Expect green.
3. Spot-check the personas list in the UI sidebar — confirm all three
   personas are visible. If they're not, investigate `personaSlice` filter
   chain BEFORE proceeding.

### Phase 2 — Scenario 2 manual trigger (15 min)

1. Open the persona "AI Agent Market Intelligence" → Use Cases tab.
2. Click **Run now** on its single capability.
3. Assert via the executions panel:
   - A new execution row appears for this persona.
   - `tool_steps` shows `web_search` and `personas_vector_db_index` (or
     equivalent vector-DB write verb).
   - Final `outcome_assessment.accomplished == true`.
4. Assert via Drive/Vector-DB:
   - The persona indexed at least one news item into the built-in
     `personas_vector_db`.
   - The message stream surfaced a digest entry.

### Phase 3 — Scenario 3 chained trigger (20 min)

1. Open the persona "Sentry Issue Tracker" → Use Cases tab.
2. Locate UC1 (the Sentry triage capability). Click **Run now**.
3. Assert UC1 ran AND emitted its `<persona>.<task>.accepted` event.
4. Assert UC2 (GitHub writeup) automatically picked up the event and ran
   its own execution against the GitHub credential.
5. End-to-end: a GitHub issue should be created in the user's selected
   repo with analysis + proposed fix.
6. **If UC2 doesn't auto-fire**: check the dispatcher logs for
   `Event bus: no subscriber matches`. The `listen_event_type` translation
   in `build_sessions.rs::create_triggers_in_tx` should have prevented
   this, but the chained UC1→UC2 event might use a shape we didn't probe.
   Add it to the shape list there.

### Phase 4 — Persona visibility fix if needed (30 min)

If the user can't see scenarios 2/3 personas in the agents grid, the
problem is in the rendering layer:

- Inspect `src/features/agents/components/...` for any `personas.filter`
  that requires a `template_category` / `group_id` (LLM-generated personas
  have neither).
- Confirm the default group view doesn't exclude `trust_origin === "builtin"`.
- Check the Recents/Active filter — schedule-triggered personas with no
  prior execution may be hidden.

---

## Open architectural items (deferred from earlier sessions)

These are documented in `C5-build-from-scratch-acceptance-scenarios.md`
"New features required" sections. None block scenarios 1–3 from completing
their acceptance contract; tackle when scoping further scenarios:

1. **Quick-add connector modal in the empty vault picker**
   (`src/features/shared/components/picker/VaultConnectorPicker.tsx` —
   reverted by the user; the deep-link to Catalog is the current behaviour).
2. **`auto_triage` review_policy runtime side**. Build prompt rule 21
   already produces `mode: "auto_triage"` in the IR. The runtime self-review
   pass that interprets it (instead of emitting `manual_review`) is unwritten.
3. **Capability-granularity rule strengthening** for chained pipelines —
   scenario 3's IR did produce 2 UCs this session, but earlier sessions
   showed the LLM occasionally bundling UC1+UC2 into one. If you see it
   slip back to 1 UC, consider adding a build-prompt rule that explicitly
   forbids merging when a `<persona>.<task>.accepted` chain is implied.

---

## Files touched this session (uncommitted)

| Path | Why |
|---|---|
| `src-tauri/src/engine/prompt/mod.rs` | Tool Selection — Mandatory Algorithm prompt section |
| `src-tauri/src/commands/design/build_sessions.rs` | `listen_event_type` shape translation |
| `src/features/agents/sub_use_cases/libs/useUseCaseDetail.ts` | `handleManualRun` + `isManualRunning` |
| `src/features/agents/sub_use_cases/components/detail/UseCaseDetailPanel.tsx` | "Run now" button (Rocket icon, testid `use-case-run-now`) |
| `src/test/automation/bridge.ts` | `listAllPersonas`, `deletePersonaById`, `getPersonaIr`, composer-row probe |
| `tools/test-mcp/e2e_full_translation.py` | Cleanup, unique filename, 120s timeout, loose loop guard |
| `tools/test-mcp/e2e_news_watch.py` | New scenario 2 runner |
| `tools/test-mcp/e2e_sentry_watcher.py` | New scenario 3 runner |

`docs/concepts/persona-capabilities/C5-build-from-scratch-acceptance-scenarios.md`
remains the canonical contract; this handoff is the implementation
checkpoint. When scenarios 2/3 reach end-to-end green, update C5's per-
scenario "Status" line.
