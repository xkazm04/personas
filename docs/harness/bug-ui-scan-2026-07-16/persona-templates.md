# Persona Templates — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 0, High: 1, Medium: 3, Low: 1)

## 1. Stale `result.failed_members` overlay overwrites live retry progress — retried members show "failed" the whole time
- **Severity**: High
- **Category**: bug
- **File**: src/features/templates/sub_presets/usePresetAdoption.ts:288-298 (overlay) + 178-219 (retry)
- **Scenario**: A preset adoption ends partial (e.g. 2 of 5 members failed). The user clicks "Retry 2 failed". `retry()` sets those rows to `adopting`, but `setResult` is NOT cleared/refreshed until the backend call returns — and the derived `rowsWithResult` memo re-stamps every role present in the *old* `result.failed_members` back to `failed` (with the stale error) whenever `r.status !== 'failed'`. So the moment `retry()` flips a row to `adopting`, the overlay flips it straight back to `failed`; even live `TEAM_PRESET_ADOPT_PROGRESS` events (`adopting` → `done`) are overwritten until the retry promise resolves and `setResult(res)` lands.
- **Root cause**: `rowsWithResult` assumes `result` is always at least as fresh as `rows`; during a retry the opposite is true — `rows` carries live status while `result` is the previous, superseded outcome.
- **Impact**: During the entire retry the modal shows red "failed" badges (with the old error text) for members that are actively being re-adopted or already succeeded. A user reasonably concludes the retry did nothing and closes the modal — the spinner state the retry code carefully sets is never visible.
- **Fix sketch**: Clear the stale overlay at retry start (`setResult(null)` after capturing `failedRoles`, or track a `retrying` flag that disables the overlay), or make the overlay only upgrade rows whose status is still `queued`.

## 2. Questionnaire answers can be silently dropped after a "successful" adoption
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/commands/design/template_adopt.rs:709-753
- **Scenario**: User opens "Customize first", answers 15 questions across a preset's members, and adopts. `create_persona_atomically` succeeds, then `populate_persona_parameters_from_design` (which is the ONLY place the user's overrides are applied to `persona.parameters`) fails — e.g. a transient pool/DB error, or a template whose `adoption_questions` regex trips `AppError::Internal`. The error is `tracing::warn!`-ed and execution continues; the same best-effort pattern covers the codebase pin (line 746).
- **Root cause**: "Best-effort post-create writes" treats user-provided customization the same as derived cosmetic columns. The Ok response carries no signal that parameters/pin were skipped, so the frontend shows the full green "Adopted N members" toast and the member row goes `done`.
- **Impact**: Success theater — persona is created with template defaults, the user's explicit answers vanish with no UI trace. The user only discovers it later when the persona behaves as if unconfigured ({{param.*}} resolve to defaults), and there is no way to re-run the questionnaire on an existing persona from this surface.
- **Fix sketch**: When `parameter_overrides` is `Some` and non-empty, treat a parameters-write failure as adoption failure (the persona create is already in its own transaction — delete or mark the row), or at minimum return a `warnings[]` field in the response that the modal surfaces next to the member row like `missing_credentials` already does.

## 3. Number question min/max never enforced — clearing the stepper writes 0 even when min > 0
- **Severity**: Medium
- **Category**: bug
- **File**: src/features/templates/sub_presets/PresetQuestionnaireForm.tsx:352-364 + src-tauri/src/commands/design/template_adopt.rs:1321-1342
- **Scenario**: A question declares `type: number, min: 1, max: 24` (e.g. "hours between digests"). The user clears the NumberStepper field: with `allowEmpty`, the stepper emits `null`, and `NumberControl`'s `onChange(v ?? 0)` converts it to `0` — below min, bypassing the stepper's own clamp (which only applies to typed digits). The override `0` is sent to adopt; server-side `coerce_answer_to_param_value` parses any `f64` and applies **no min/max check**, so `persona.parameters[key].value = 0` is persisted and substituted into the prompt.
- **Root cause**: The form's documented assumption ("an out-of-range number… just falls back to the template default at adopt time", PresetQuestionnaireForm.tsx:66-73) is false — the backend coercion only falls back on *unparseable* input, never on range violations, and the `v ?? 0` shim manufactures an out-of-range value the UI itself would refuse to step to.
- **Impact**: Adopted personas run with parameter values the template author declared invalid (0-hour intervals, 0 budgets), producing tight scheduling loops or nonsense config with no error anywhere.
- **Fix sketch**: In `NumberControl`, map `null` to "remove override" (call `onChange(undefined)` and have `setMemberOverride` delete the entry) instead of `0`; in `coerce_answer_to_param_value`, clamp/fall back to default when the question carries `min`/`max` and the parsed value is outside them.

## 4. Preset list load failure renders the "no presets" empty state instead of an error state
- **Severity**: Medium
- **Category**: ui
- **File**: src/features/templates/sub_presets/PresetLibraryPage.tsx:38-45 + 59-65
- **Scenario**: `listTeamPresets()` rejects (disk read error, corrupted preset manifest, IPC auth hiccup on wake). The catch handler runs `silentCatch` then `setPresets([])` — the page now shows the Layers icon + "empty_title / empty_hint" copy, which tells the user the preset library legitimately has nothing in it.
- **Root cause**: The component collapses the error state into the empty state; `presets === []` is used to mean both "loaded, zero presets" and "failed to load".
- **Impact**: A failure that would be fixed by retry/restart is presented as an authoritative "there are no templates", for a feature whose entire page is that list. No retry affordance exists, so the only recovery is navigating away and back (which re-mounts).
- **Fix sketch**: Add an `error` state (`setPresets(null); setError(true)`) and render a distinct error panel with a Retry button that re-invokes `listTeamPresets`; keep the empty state only for a successful zero-length response.

## 5. Preview member rows render `<button>` as a direct child of `<ul>` — invalid list semantics
- **Severity**: Low
- **Category**: ui
- **File**: src/features/templates/sub_presets/PresetPreviewModal.tsx:138-187
- **Scenario**: In preview stage, `RowTag` is `'button'`, so the member list becomes `<ul><button>…</button>…</ul>` — `<ul>` permits only `<li>` children. Once adoption starts, the same rows switch to `<li>` (fine), so the DOM shape of the list changes mid-flow.
- **Root cause**: The interactive/static branch swaps the element type at the list-item level instead of nesting the interactive control inside a constant `<li>`.
- **Impact**: Invalid HTML; screen readers lose the "list of N items" announcement and item indexing for the selectable rows (the primary selection UI of the modal), and AT behavior for `aria-pressed` toggles inside a broken list is inconsistent across readers.
- **Fix sketch**: Always render `<li>` and, in preview stage, place the `<button type="button" aria-pressed=…>` inside it (full-width), keeping styles on the button; status stage renders the row content directly in the `<li>`.
