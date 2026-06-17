# Test Mastery — Persona Templates
> Total: 7 findings (2 critical, 3 high, 1 medium, 1 low)

## 1. Template integrity check (`check_template_integrity` / `compute_content_hash`) is the security trust boundary but has ZERO tests
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/template_checksums.rs:28-217 (call site src-tauri/src/commands/design/template_adopt.rs:28-62, 265)
- **Current test state**: none (`grep -c "#[test]"` on template_checksums.rs = 0)
- **Scenario**: `compute_content_hash` is a hand-ported reimplementation of the frontend JS `computeContentHashSync` (UTF-16 code-unit FNV-style mix, in `src/lib/templates/templateVerification.ts`). It is the anti-tamper gate: a tampered template whose content no longer matches the embedded `CHECKSUM_MANIFEST` is supposed to be rejected at adopt time (`integrity.is_known_template && !integrity.valid` → `AppError::Validation`). Nothing asserts the Rust hash equals the JS hash for a known input, nor that a known-but-mutated template is actually rejected. A one-char drift between the two ports (endianness, `>> 13` vs `>> 16`, the `0x1F_FFFF` mask, the `combined` packing) silently makes `valid` always false for genuine templates OR always-pass for tampered ones — and the only thing keeping the feature alive today is the `#[cfg(not(debug_assertions))]` "allow unknown" escape hatch (lines 39-46), so the reject branch is effectively never exercised.
- **Root cause**: A cryptographic-style port was shipped with no golden-vector test pinning it to the JS source of truth, and the manifest key/content contract mismatch (documented at lines 33-38) means the live reject path never fires in practice, so a bug here is invisible until a real tamper slips through.
- **Impact**: Defense-in-depth against template tampering (the stated reason the manifest is embedded in the binary) is unverified. Either the integrity check is silently inert (security theater) or it could brick all adoptions again (the regression called out in the comment that "bricked the ENTIRE Presets feature on shipped binaries").
- **Fix sketch**: Add `#[cfg(test)] mod tests` to template_checksums.rs. (a) Golden vector: `assert_eq!(compute_content_hash("known string"), "<hash produced by the JS impl>")` — generate the expected value from `templateVerification.ts`/`generate-template-checksums.mjs` and pin it; this is the load-bearing parity invariant. (b) `verify_template` returns `valid=true, is_known_template=true` when content hashes to a manifest entry, `valid=false, is_known_template=true` when the same path's content is mutated one byte, `is_known_template=false` for an unknown path. (c) A `check_template_integrity` test asserting the known-but-tampered branch returns `Err(AppError::Validation)`. Add a CI gate that re-runs `generate-template-checksums.mjs` and fails if the committed manifest drifts.

## 2. `populate_persona_parameters_from_design` + `coerce_answer_to_param_value` — adoption-answer → persona.parameters write has no test
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/commands/design/template_adopt.rs:1085-1234
- **Current test state**: none (only sibling `model_tier_mapping_tests` and `adoption_adjust_tests` exist; neither touches these)
- **Scenario**: This is the data-write that turns a user's questionnaire answers into the persona's persisted `parameters` column (and ultimately the running prompt). It encodes several business invariants with NO assertions: (1) precedence — a `maps_to: persona.parameters[KEY]` question must override a same-KEY `suggested_parameters[]` entry; (2) type coercion in `coerce_answer_to_param_value` — `"number"` parses to a JSON number and falls back to `default` on garbage, `"boolean"` maps `true/yes/1/on` and `false/no/0/off` (and falls back to default on anything else), empty/whitespace answer returns the default; (3) deterministic key-sorted output. A regression in the boolean/number fallback would silently write the wrong runtime value (e.g. a malformed "500abc" threshold coerced to `0` instead of the template default), changing what the agent actually does — money/threshold-style knobs are exactly here.
- **Root cause**: Pure-ish transformation logic buried behind a DB write; the coercion helper is trivially unit-testable in isolation but was never extracted into a test.
- **Impact**: Silent misconfiguration of adopted personas — a user's answer is dropped or mis-coerced and the persona runs with a wrong parameter, with no error surfaced.
- **Fix sketch**: `coerce_answer_to_param_value` is **llm-generatable** — pure `(raw, type, default) -> Value`. Generate a table-driven batch asserting the *business invariant* "valid input coerces to its typed form; invalid/empty input falls back to the provided default" across number/boolean/string/empty/whitespace/out-of-vocab cases (not a snapshot of today's strings). For `populate_persona_parameters_from_design`, add an in-memory-SQLite test (the repo already uses `DbPool`-backed tests elsewhere) asserting: questionnaire answer wins over `suggested_parameters`, the persisted JSON is key-sorted, and a missing-answer question lands its `default` as `value`.

## 3. `usePresetAdoption` state machine — partial-failure / retry / re-entrancy guard is untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src/features/templates/sub_presets/usePresetAdoption.ts:54-284
- **Current test state**: none (no test file anywhere under sub_presets/)
- **Scenario**: This headless hook is the brain behind both the Templates modal and the in-app Teams flow, and it owns several business-critical branches that ship with no assertions: (1) the `adoptingRef` synchronous re-entrancy guard (lines 73, 118-119) that prevents a double-click from firing two `adoptTeamPreset` calls; (2) the partial-failure path — when `res.failed_members.length > 0`, stage goes to `done`, a warning toast fires, and `rowsWithResult` (lines 252-262) must reconcile failed rows even if the progress event lost the race; (3) the catch path resetting `stage` back to `preview` so the user can retry; (4) `retry` only re-submitting failed roles. A regression that drops the re-entrancy guard means duplicate team adoptions (duplicate personas/teams created); a regression in `rowsWithResult` means a failed member silently shows as "done."
- **Root cause**: Async-event-driven hook with store/IPC dependencies — perceived as hard to test, so it wasn't, despite encoding the most consequential logic in this context.
- **Impact**: Double-adoption duplicates, or failed members masquerading as succeeded — the user thinks their team is complete when a role is missing.
- **Fix sketch**: Add `usePresetAdoption.test.ts` with `@testing-library/react`'s `renderHook`, mocking `@/api/templates/teamPresets` and the zustand stores. Assert: a second synchronous `adopt()` call while the first is in flight is a no-op (mock called once); a partial result drives stage→`done` + warning toast + the failed row's status==='failed' via `rowsWithResult`; a thrown `adoptTeamPreset` resets stage→`preview`; `retry()` calls `retryTeamPresetMembers` with exactly the failed roles. Use a deterministic fake for the `team-preset-adopt-progress` event.

## 4. `wire_event_subscriptions_from_use_cases` — cross-persona event wiring (self-scope vs `*` default, de-dup) is untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/commands/design/template_adopt.rs:907-979
- **Current test state**: none
- **Scenario**: This decides whether an adopted team actually runs as a pipeline. The business rule: a `listen`-direction subscription gets `source_filter = "*"` (cross-persona) UNLESS this persona itself emits that event type, in which case it stays self-scoped (`NULL`); rows are de-duped on `(event_type, source_filter)`; only `listen`/`subscribe`/`consume` directions create rows. A regression flipping the self-emit check would either make a persona listen to its own emissions (infinite-ish handoff loop / wrong wiring) or never receive a teammate's events (the "team" silently doesn't chain) — the exact "built-but-unwired" failure mode the comment warns about.
- **Root cause**: SQL-touching helper, but the source_filter decision is pure logic over the `use_cases` JSON that could be tested with an in-memory DB; nobody did.
- **Impact**: Adopted team presets that look configured but never hand off events between members — the headline value of a "team" preset silently broken.
- **Fix sketch**: In-memory SQLite test inserting a persona then calling the fn with use_cases JSON where one event is both emitted and listened-for (assert `source_filter IS NULL`) and one is only listened-for (assert `source_filter = '*'`); assert duplicate `(event_type, source_filter)` pairs collapse to one row and `emit`-only entries create zero rows.

## 5. `PresetQuestionnaireForm.setMemberOverride` — "typed back to default removes override" invariant is untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src/features/templates/sub_presets/PresetQuestionnaireForm.tsx:84-113 (also `BooleanControl` coercion 320-325)
- **Current test state**: none
- **Scenario**: `setMemberOverride` enforces a non-obvious business invariant: when the user edits a field back to its template default (including the string-vs-typed equality fuzz at lines 95-97), the override entry is *deleted* so the wire payload stays minimal and the "N customized" summary stays honest; when a member's last override is removed, the whole role key is deleted. The downstream `overrideCount` and the `adoptTeamPreset` payload (`Object.keys(overrides).length > 0 ? overrides : null`) both depend on this. A regression that leaves stale default-valued overrides inflates the customization count and ships redundant answers to the backend coercion path (finding #2). `BooleanControl`'s truthy parsing (`true/'true'/1/'1'/'yes'`) is a second untested coercion that must agree with the Rust side.
- **Root cause**: Reducer-like logic embedded in a component callback; never extracted or covered.
- **Impact**: Dishonest "customized" UI counts and unnecessary/contradictory override payloads reaching the persona-parameter writer.
- **Fix sketch**: Export/extract `setMemberOverride` (or test via the component with RTL). Assert: setting a value != default adds the override; setting it back to default removes the entry and the role key when it was the last one; numeric default echoed as string still counts as "equals default." `BooleanControl`'s acceptance set is **llm-generatable** — table-test the truthy/falsey invariant and pin it to match `coerce_answer_to_param_value`'s boolean vocabulary so the two layers can't drift.

## 6. `PresetLibraryPage` empty/loading/error tri-state + `create_template_feedback` validation bounds — no tests
- **Severity**: medium
- **Category**: coverage-gap
- **File**: src/features/templates/sub_presets/PresetLibraryPage.tsx:25-91; src-tauri/src/commands/design/template_feedback.rs:13-63
- **Current test state**: none
- **Scenario**: PresetLibraryPage has three distinct states keyed on `presets === null` (loading) vs `length === 0` (empty) vs populated, plus a `.catch` that maps any list error to the empty state (line 28-31). A regression collapsing null and empty would show "no presets" while still loading, or a blank page on error. Separately, `create_template_feedback` enforces `labels.len() <= MAX_LABELS (10)` and `comment.len() <= MAX_COMMENT_LEN (2000)` and `list_template_feedback` clamps limit to `[1, 200]` — simple bounds with no assertion that the boundary actually rejects/clamps.
- **Root cause**: UI tri-state and small validators are easy to skip; both are low-effort to cover.
- **Impact**: A wrong-state render (blank library) or an unbounded feedback write slipping past the cap.
- **Fix sketch**: RTL test for PresetLibraryPage rendering loading→empty→cards and the rejected-promise→empty path (mock `listTeamPresets`). For the Rust command, a small test asserting 11 labels and a 2001-char comment return `AppError::Validation`, and `list` limit clamps `0`→`1` and `9999`→`200`. The clamp/bounds are **llm-generatable**.

## 7. Shared TeamPreset fixture missing → copy-paste fixtures across the (to-be-added) preset tests
- **Severity**: low
- **Category**: test-structure
- **File**: src/features/templates/sub_presets/ (all of PresetLibraryPage / PresetPreviewModal / PresetQuestionnaireForm / usePresetAdoption)
- **Current test state**: none
- **Scenario**: Every test proposed above needs a `TeamPreset` + `PresetAdoptionSchema` fixture (members, roles, questions of each type, a group binding, a partial-failure `AdoptedTeamPresetResult`). Without a shared factory, the four new test files will each hand-roll near-identical objects, and a binding-shape change (these are ts-rs generated) will break them inconsistently.
- **Root cause**: No fixtures directory established for this context yet.
- **Impact**: Test-maintenance drag and inconsistent coverage as the bindings evolve.
- **Fix sketch**: Add a `__tests__/fixtures.ts` exporting `makeTeamPreset(overrides)`, `makeAdoptionSchema(overrides)`, and `makeAdoptResult({ ok, failed })` builders typed against the generated bindings, and have all preset tests consume them. Mirror with a Rust `fn v3_template_payload()` helper for the adopt-side tests (the `template_v3.rs` `v3_fixture()` is a good model to follow).
