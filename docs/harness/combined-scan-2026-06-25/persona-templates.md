# Persona Templates — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: persona-templates | Group: Templates & Recipes
> Total: 5 | Critical: 1 | High: 2 | Medium: 2 | Low: 0

## 1. Backend template-integrity check is permanently inert — tampered templates are adopted with zero enforcement
- **Severity**: Critical
- **Lens**: bug-hunter
- **Category**: security / silent failure
- **File**: src-tauri/src/commands/design/template_adopt.rs:28-62 (false claim at :263-265)
- **Scenario**: An attacker (or a corrupted sync) edits a shipped template JSON on disk — swaps the `system_prompt`, injects a malicious tool/connector, or rewrites `persona_meta`. The user adopts that preset member. `check_template_integrity` runs, but `verify_template(template_name, content_json)` is called with a *bare* template name/id and the *payload-only* JSON, while `CHECKSUM_MANIFEST` is keyed by full relative file path (`content/audio-briefing-host.json`) and hashes the *entire file*. The lookup misses, so `is_known_template == false` for 100% of adoptions.
- **Root cause**: The two reject branches are both dead. The `#[cfg(not(debug_assertions))]` "unknown template" branch was deliberately downgraded to a `tracing::warn!` (per the in-code note) to avoid bricking the feature, and the `is_known_template && !valid` "tampered" branch can never fire because `is_known_template` is never true. There is no key/content reconciliation, so the only enforcement path is unreachable. The comment at :263-265 ("This catches tampered templates even if the frontend checksums were bypassed") is factually false.
- **Impact**: The entire defense-in-depth promise of the embedded Rust manifest (the stated reason it exists, template_checksums.rs:4-7) is absent. Any on-disk template tampering is adopted verbatim into a persona that then runs with elevated CLI/connector capability. The frontend checksum is the *only* gate, and it is the one explicitly assumed to be bypassable.
- **Fix sketch**: Make the call contract match the manifest contract: either (a) resolve the template's real relative path and hash the on-disk *file* (not the payload) before adoption, or (b) regenerate the manifest keyed by template id over the payload JSON the callers actually pass. Until reconciled, re-enable a hard reject on `is_known_template && !valid` AND treat `!is_known_template` as fail-closed for templates that *should* be in the manifest (allow-list the few dynamic ones). Delete/*correct* the misleading "catches tampered templates" comment.
- **Value**: impact=9 effort=5

## 2. Recipe-ref hydration failure is swallowed → silent partial/empty adoption reported as success
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent failure / error handling
- **File**: src-tauri/src/commands/design/template_adopt.rs:292-301 (helper: src-tauri/src/engine/template_v3.rs:47-149)
- **Scenario**: A preset member's template is v3 recipe_ref-shaped and one referenced recipe is missing from the DB, or a recipe's `prompt_template` is not valid serialized-UC JSON (hand-edited / migration drift). `hydrate_recipe_refs` returns `Err` — but it mutates `use_cases` *in place per entry*, so earlier UCs are already hydrated and later ones remain bare `{recipe_ref: …}` stubs. The caller logs `warn!` and continues "with un-hydrated payload."
- **Root cause**: The `if let Err(e) = hydrate_recipe_refs(...) { warn; }` block treats a hard structural failure as best-effort. `normalize_v3_to_flat` then runs over a half-hydrated payload: the surviving recipe_ref stubs carry no `suggested_trigger`/`connectors`/`event_subscriptions`, so they hoist nothing and map to empty Use Cases. The adopted persona is missing capabilities, but `instant_adopt_template_inner` returns `Ok`, the per-row progress emits `done`, and the modal shows the green "adopted" state.
- **Impact**: User gets a structurally broken persona (empty/partial use cases, missing tools/triggers, default "You are a helpful AI assistant." prompt when normalization is starved) with no error surfaced anywhere. Likely whenever the recipe catalog drifts from the shipped templates.
- **Fix sketch**: Treat hydration failure as fatal for the member: propagate the `Err` (so the row goes `failed` with the offending recipe id) instead of swallowing it. At minimum, after hydration, assert no `recipe_ref` stubs remain in `use_cases` and fail the adoption if any do.
- **Value**: impact=7 effort=2

## 3. Preset adoption silently drops every questionnaire answer that isn't a `persona.parameters[…]` mapping
- **Severity**: High
- **Lens**: ambiguity-guardian
- **Category**: adoption semantics / silent data loss
- **File**: src-tauri/src/engine/team_preset_adopter.rs:357-364 + src-tauri/src/commands/design/template_adopt.rs:656-695; schema surfaces all questions at src-tauri/src/engine/team_preset_loader.rs:514-518
- **Scenario**: A preset template ships adoption questions that (a) substitute `{{param.X}}` placeholders in the system prompt, or (b) pick a concrete vault credential for a generic connector (vault-category questions → `credential_bindings`), or (c) are plain context questions with no `maps_to`. The questionnaire form renders *all* of them (the schema builder copies `/payload/adoption_questions` unfiltered), the user answers, and `usePresetAdoption` forwards them as `overrides`.
- **Root cause**: The preset/instant path consumes answers in only two places — `populate_persona_parameters_from_design` (questions whose `maps_to` matches `persona.parameters[KEY]`) and `apply_codebase_pin_from_design` (the single `design_context[dev_project_id]` question). It never calls `adoption_answers::substitute_variables`, `inject_configuration_section`, or `apply_credential_bindings_to_connectors` — those run *only* on the build-session/promote path (build_sessions.rs, build_simulate.rs, oneshot.rs, management_api.rs), confirmed by grep. So `{{param.X}}` placeholders stay literal in the adopted prompt, credential-binding answers vanish (connector stays a generic placeholder → runtime credential resolution targets the wrong/empty service, and pre-flight may mis-flag `needs_credentials`), and the "User Configuration" summary is never injected.
- **Impact**: Users configure a preset and silently get an unconfigured persona for any non-parameter question. Two adoption code paths disagree on what an "answer" means, with no documentation of the divergence — exactly the tribal-knowledge gap that bites the next author.
- **Fix sketch**: Route preset answers through the same `adoption_answers` pipeline the build path uses (build an `AdoptionAnswers` and call substitute/inject/credential-binding after create), OR have the schema builder expose only parameter-mapped + codebase-pin questions so the UI can't collect answers that will be dropped. Document the supported `maps_to` set in one place.
- **Value**: impact=7 effort=4

## 4. Documented "out-of-range / invalid answers fall back to default at adopt time" is not implemented
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: false invariant / validation gap
- **File**: src/features/templates/sub_presets/PresetQuestionnaireForm.tsx:66-73 & :357 vs src-tauri/src/commands/design/template_adopt.rs:1231-1252
- **Scenario**: A number question declares `min: 1`. The user clears the field; `NumberControl` calls `onChange(v ?? 0)` and sends `0`. Since `0 !== default`, the override (`0`) is kept and submitted. Or a `select` answer carries a value not in `options` (stale schema, locale overlay drift).
- **Root cause**: The form comment promises "an out-of-range number or a misspelled select value … falls back to the template default at adopt time (see `instant_adopt_template_inner`'s answers conversion)." But `coerce_answer_to_param_value` only falls back on *empty* or *parse-failure*; it does no `min`/`max` clamp and no `options` membership check. So out-of-range numbers and invalid select strings are persisted verbatim into `persona.parameters[].value`.
- **Impact**: A persona parameter can hold a value the template author declared impossible (e.g. `0` iterations, an unlisted enum), reaching downstream runtime logic that trusts the declared bounds. The misleading comment makes reviewers believe a safety net exists.
- **Fix sketch**: Enforce bounds in `coerce_answer_to_param_value` (clamp to `[min,max]` or fall back to default; reject select values not in `options`), and/or stop `NumberControl` from emitting `0` on clear (emit `null` → drop override). Correct the comment to match real behavior.
- **Value**: impact=5 effort=2

## 5. Tamper-integrity primitive is a non-cryptographic 53-bit hash, overstated as "hard to modify without detection"
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: weak crypto / magic numbers
- **File**: src-tauri/src/engine/template_checksums.rs:135-152 (claim at :4-7)
- **Scenario**: Assume Finding #1 is fixed and the manifest actually gates adoption. An attacker with local file access (the stated threat model) wants a tampered template to pass. They only need content whose `compute_content_hash` equals the fixed expected value.
- **Root cause**: `compute_content_hash` is a cyrb53-style multiply/xor mixer, and the output is masked to 53 bits (`((h2 as u64) & 0x1F_FFFF) << 32 | h1`). It is neither collision- nor preimage-resistant; the algorithm and constants are public. A 53-bit non-cryptographic digest is feasible to second-preimage with offline effort, and the module comment ("the compiled binary is significantly harder to modify without detection") oversells the guarantee.
- **Impact**: The integrity story is weaker than advertised even after the reachability bug is fixed; reviewers/users may over-trust the "verified" badge. The masking constants are undocumented magic numbers tying frontend and backend together implicitly.
- **Fix sketch**: Use a cryptographic digest (SHA-256) for the integrity manifest, or at minimum document explicitly that this is a *change-detection* checksum (not tamper-resistant) and size it to a full 64 bits. Keep the frontend/backend algorithms in lockstep via a generated constant, not duplicated literals.
- **Value**: impact=4 effort=4
