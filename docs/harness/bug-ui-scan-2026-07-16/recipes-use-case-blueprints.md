# Recipes & Use-Case Blueprints — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 0, High: 0, Medium: 3, Low: 2)

## 1. Unparseable `last_curation_at` permanently and silently disables scheduled curation for a persona
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/engine/curation_scheduler.rs:95-107
- **Scenario**: If a persona's `persona_curation_schedule.last_curation_at` is ever written in a format neither parser accepts — e.g. an ISO `2026-06-16T14:30:00` ("T" separator, no offset) fails BOTH the RFC3339 parser (requires offset) and the strict `"%Y-%m-%d %H:%M:%S"` parser (requires a space), as does a fractional-seconds `datetime('now','subsec')` value from any future/foreign write path — then on every tick the reference falls back to `now`, so `next_fire` is always strictly in the future and the schedule never fires again.
- **Root cause**: The fallback for an unparseable watermark is `now`, which by construction can never be due; and because `mark_run_now` only executes on a fire, the bad timestamp is never rewritten. The failure is self-perpetuating, surfaced only as a once-per-minute `tracing::warn` that no UI reads. Notably this module already shipped one bug of exactly this class (the RFC3339-only parse documented at the top of `parse_db_timestamp`), proving the format-drift hazard is real, yet the recovery path still fails closed forever.
- **Impact**: Nightly memory curation for that persona silently stops permanently — the user configured a schedule, the UI shows it as active, nothing ever runs, and there is no repair short of manually re-running curation (which rewrites the watermark).
- **Fix sketch**: On unparseable `last_curation_at`, fall back to the row's `created_at` (or treat the row as due once), and have `mark_run_now` rewrite the watermark in canonical form so the row self-heals instead of wedging.

## 2. Legacy object-array `tool_requirements` scores `Eligible` — the exact false green light the module's INVARIANT forbids
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/engine/recipe_eligibility.rs:258-266
- **Scenario**: A pre-2.2 recipe carries `tool_requirements: [{"name":"gmail_search","category":"io"}]` (the legacy object-array shape the code itself acknowledges) and a plain-text `prompt_template` with no `tool_hints`. If a user views it against a persona with no tools wired, `parse_tool_name_array` returns `None` (non-string elements), the branch deliberately "preserves historical behavior", and the recipe falls through to `Resolved(vec![])` → vacuously `Eligible`.
- **Root cause**: The wrong-shape branch conflates "no *string* requirements" with "no requirements" even though the objects demonstrably carry tool names in a `name` field — the very extraction pattern `extract_required_connectors` (lines 304-332) already implements for connector objects. The module-level INVARIANT ("Eligible means every modelled requirement this gate can verify is satisfied") is violated: a requirement is visible, readable, and ignored.
- **Impact**: The card promises one-click adoption, the user adopts, and the persona has none of the required tools wired — the recipe fails on first run, exactly the failure mode the 2026-05 connector-downgrade fix was built to prevent.
- **Fix sketch**: In the valid-JSON-wrong-shape branch, attempt `o.get("name").or(o.get("type"))` extraction per element (mirroring `extract_required_connectors`); only fall back to "no string requirements" when no element yields a name. At minimum, downgrade such recipes to `AdoptableWithSetup` rather than `Eligible`.

## 3. Suggestion threshold is unreachable for recipes without description/tags — the "chip never fires" bug recreated for user-authored recipes
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/engine/recipe_matcher.rs:30-52 (weights + SUGGESTION_THRESHOLD)
- **Scenario**: A user creates a recipe named "Email Triage" with no description and no tags (the common shape for hand-made recipes — both fields are optional), then later types "triage my emails every morning" into the Glyph composer. Name Jaccard = |{email,triage}| / |{triage,email,every,morning}| = 0.5 → score = 0.6 × 0.5 = 0.30, with desc/tags contributing exactly 0 → below the 0.40 threshold → no chip.
- **Root cause**: The absolute weights (0.6/0.3/0.1) assume all three fields exist; for a name-only recipe the maximum achievable score is 0.6, so clearing 0.40 requires name Jaccard ≥ 0.667 — i.e. near-verbatim typing. The 2026-06-29 recalibration rationale ("strong paraphrase lands at 0.40–0.55") only holds when description and tags contribute; for the name-only class the recalibration silently re-created the original "threshold unreachable for real typed intents" failure it was fixing. The regression test (`paraphrased_strong_match_fires_suggestion`) only covers a recipe with a rich description AND three tags.
- **Impact**: Recipe suggestions effectively never fire for user-authored (description-less/tag-less) recipes — a dead feature for exactly the recipes the user cares most about, with silent fallthrough by design so nobody notices.
- **Fix sketch**: Renormalize weights over the fields actually present (e.g. divide by the sum of weights of non-empty fields), or score `max(name_score, weighted_total)` against the threshold. Add a name-only paraphrase regression test.

## 4. Startup model-tier refresh silently reverts manual `model_override` edits on builtin recipes every launch
- **Severity**: Low
- **Category**: bug
- **File**: src-tauri/src/engine/recipe_seed.rs:257-311
- **Scenario**: A user (or dev) edits a builtin recipe's `prompt_template` to set `model_override: "haiku"` to cap cost on an expensive capability the bundle tiers at a higher model. On the next app start, `refresh_model_tier` sees the stored tier differs from the bundle's, field-merges the bundle value back in, and the edit is gone — repeated on every launch, with no notice and no way to make the change stick.
- **Root cause**: The seeder's other repair path carefully distinguishes user edits from stale data (the `name == source_use_case_id` signature explicitly protects renames), but the tier merge has no equivalent user-touch marker — "differs from bundle" is treated as "stale" even when it is deliberate. The "system-owned decision" assumption fails the moment the recipe editor exposes `prompt_template` (it does — recipes are user-editable JSON).
- **Impact**: Silent per-launch reversion of a user's cost/quality choice; the recipe resumes running on the more expensive tier without the user knowing. State the user saved is quietly overwritten.
- **Fix sketch**: Record the bundle tier last applied (e.g. `model_tier_seed_rev` or store the seed's value alongside) and only overwrite when the stored value still equals the *previous* bundle value — a three-way merge — or skip refresh when the row's `updated_at` postdates the last seed pass.

## 5. Quick-test failure toast is hardcoded English and swallows the error cause in a fully i18n'd surface
- **Severity**: Low
- **Category**: ui
- **File**: src/features/recipes/sub_list/components/RecipeList.tsx:39-45
- **Scenario**: A user on any of the 13 non-English locales clicks Quick Test on a recipe whose `sample_inputs` is stale/malformed JSON, or whose execution fails (missing credential, CLI timeout). The catch shows a raw English toast "Quick test failed" while every other string in the component goes through `t.recipes.*`.
- **Root cause**: The catch block drops the caught error entirely (`catch {`) and inlines a literal instead of a translation key, so neither the locale system nor the actual failure reason (parse error vs execution error vs backend message) reaches the user. Sibling flows in this feature route errors through localized toasts.
- **Impact**: Localization gap plus zero diagnostic value — the user cannot tell whether the recipe's sample inputs are broken (fixable in the editor) or the execution backend failed (credential/CLI issue), so the same opaque toast covers both.
- **Fix sketch**: Add a `t.recipes.quick_test_failed` key (seed the 13 locale placeholders per the i18n-no-gaps hook), capture the error, and append its message; optionally pre-validate `sample_inputs` JSON separately to give a "fix sample inputs" toast distinct from execution failure.
