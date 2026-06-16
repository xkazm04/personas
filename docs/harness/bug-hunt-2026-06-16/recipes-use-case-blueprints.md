# Bug Hunter — Recipes & Use-Case Blueprints

> Total: 5 findings (1 critical, 2 high, 1 medium, 1 low)
> Context: recipes-use-case-blueprints | Group: Templates & Recipes

## 1. Scheduled curation never fires — date-format mismatch between writer and reader
- **Severity**: Critical
- **Category**: Silent failure / success theater
- **File**: `src-tauri/src/engine/curation_scheduler.rs:80-96`
- **Scenario**: A user sets a curation cron (`set_persona_curation_schedule`). The boot worker spins up, logs "curation_scheduler" ready, and ticks every 60s — but no `memory_curation_run` job is ever enqueued, for any persona, ever.
- **Root cause**: `curation_schedule::upsert` and `mark_run_now` persist `created_at` / `last_curation_at` via SQLite `datetime('now')`, which yields `2026-06-16 14:30:00` (space separator, no timezone). The scheduler reads those strings and does `s.parse()` / `schedule.created_at.parse()` into a `DateTime<Utc>`, whose `FromStr` is RFC3339-only and **rejects** a bare space-separated, offset-less timestamp. Both parse arms fall through to `=> now`, so `reference = now`, `next_fire = now + ≥1min > now`, and the "not yet due" `continue` runs every tick. The first-fire path (created_at) and the steady-state path (last_curation_at) are both poisoned by the same format gap.
- **Impact**: The entire F-CRON scheduled-curation feature is dead on arrival. Personas' memory is never auto-curated despite the UI accepting and persisting a schedule. No error surfaces — only a `debug!`/`warn!` buried in logs.
- **Fix sketch**: Either store timestamps as RFC3339 (`strftime('%Y-%m-%dT%H:%M:%SZ','now')`, matching the rest of the codebase which uses `chrono::Utc::now().to_rfc3339()`), or parse with a tolerant helper (`NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S").map(|n| n.and_utc())` with an RFC3339 fallback). Add a round-trip test: write via `mark_run_now`, read via `list`, assert the scheduler parses it.

## 2. Recipe suggestion chip is mathematically unreachable for the shipped catalog
- **Severity**: High
- **Category**: Silent failure / dead feature
- **File**: `src-tauri/src/engine/recipe_matcher.rs:23-33,114-127,169`
- **Scenario**: User types an intent in the Glyph composer; the debounced typeahead calls `match_recipes_to_intent`. `above_threshold` is always `false` for the ~299 seeded recipes, so the "use this recipe?" chip never appears in real use.
- **Root cause**: `SUGGESTION_THRESHOLD = 0.90`, but the score is `0.6·name + 0.3·desc + 0.1·tags` (Jaccard, all in [0,1]). For the real catalog: names are 2-4 tokens ("Approval Workflow", "Monthly Report"), descriptions are 40-80-token paragraphs, and `tags` are template-slug tokens plus the literal `"derived"` (e.g. `["access-request-manager","derived"]`). To clear 0.90 the intent token set must (a) equal the name set exactly *and* (b) overlap the long description heavily *and* (c) overlap the slug tags — simultaneously. Description Jaccard against a short intent is bounded near `intent_len / desc_len` (~0.03), and tags rarely intersect intent at all. Realistic ceiling for a perfect name match is ~0.61. The 0.30 gap to 0.90 cannot be closed by desc+tags on this data.
- **Impact**: A whole user-facing feature (recipe surfacing in the composer) silently produces nothing. The conservative-threshold direction was applied to a scoring scale that can't reach it.
- **Fix sketch**: Recalibrate the threshold against the actual seed distribution (e.g. dump top-1 scores for a corpus of realistic intents and pick a percentile), or normalize the score so name-dominant matches can reach the gate (e.g. score by `max` of per-field Jaccard, or weight description by token-coverage of the *intent* rather than symmetric Jaccard). Add a corpus test asserting at least some intents clear the threshold against the real bundle.

## 3. Curation scheduler can double-enqueue (and double-run) when `mark_run_now` fails after enqueue
- **Severity**: High
- **Category**: Race condition / latent failure
- **File**: `src-tauri/src/engine/curation_scheduler.rs:123-147`; `src-tauri/src/engine/persona_jobs.rs:101-118`
- **Scenario**: A tick finds a persona due, successfully calls `enqueue` (a real `queued` job row now exists), then `mark_run_now` fails (transient DB lock / busy). The code logs a warning and does NOT advance `last_curation_at`. Next tick (60s later) the reference is still the old value, the persona is still "due", and a **second** `memory_curation_run` job is enqueued.
- **Root cause**: The order is enqueue-then-mark, with no transaction binding them, and `enqueue` has no dedup — it `INSERT`s a fresh `pjob_*` row every call with no uniqueness on `(kind, persona_id, queued)`. The in-code comment claims "`pop_next_queued`'s atomic UPDATE prevents double-execution at the job level even if we double-enqueue." That is false: `pop_next_queued` only prevents one *row* from being claimed twice; two distinct queued rows are two distinct jobs, each popped and executed independently.
- **Impact**: Duplicate curation runs for the same persona — wasted LLM spend and potential double-mutation of memory (curation deletes/merges memories). The misleading comment hides the gap from future maintainers.
- **Fix sketch**: Mark-then-enqueue, or wrap both in one `unchecked_transaction`. Alternatively dedup in `enqueue` via `INSERT ... WHERE NOT EXISTS (SELECT 1 ... WHERE kind=? AND persona_id=? AND status IN ('queued','running'))` for curation jobs. Fix the comment to stop asserting protection that doesn't exist.

## 4. Eligibility falls back to a long-description prompt and silently treats UC connectors/credentials as no-requirements
- **Severity**: Medium
- **Category**: Eligibility false positive / silent wrong-state
- **File**: `src-tauri/src/engine/recipe_eligibility.rs:201-257`; `src-tauri/src/commands/recipes/recipe_adoption.rs:76-86`
- **Scenario**: A recipe's serialized UC declares its dependencies via `connectors[]` (credential-type requirements) and/or carries no `tool_hints` but real credential needs (e.g. the Approval Workflow seed has `"connectors":[]` but many seeds list gmail/notion connectors). `extract_required_tools` only reads `tool_hints[]` then legacy `tool_requirements`; it ignores `connectors[]` entirely (documented as "not scored in v1"). A recipe needing an unwired Gmail credential scores `Eligible` (vacuous) and `adopt_recipe_for_persona` links it with zero setup.
- **Root cause**: Eligibility is tool-name-only by design, but adoption's hard-stop/soft-stop state machine consumes that partial signal as if it were complete. The "E.2 will hydrate connectors" promise (adoption module docs) is unimplemented — `config: None` is stored and nothing validates credentials. So a recipe that genuinely can't run (missing credential) reports green and adopts one-click.
- **Impact**: Persona adopts a recipe it cannot actually execute; failure only surfaces at run time as an auth/credential error, far from the adoption UI that said "Eligible". Eligibility false-positive undermines the whole three-state contract for any connector-bearing recipe.
- **Fix sketch**: Parse `connectors[]` from the UC and cross-check against the persona's wired credentials (the same pattern as tools: satisfied / addable / uncatalogued), or — until that lands — surface a distinct "requires credentials (unverified)" state so adoption doesn't claim full eligibility. At minimum document the gap in the adoption command's user-visible result.

## 5. Recipe seed create + builtin-flag are non-atomic; a crash between them mints a user-looking builtin
- **Severity**: Low
- **Category**: Latent failure / partial write
- **File**: `src-tauri/src/engine/recipe_seed.rs:240-244`; `src-tauri/src/db/repos/resources/recipes.rs:55-116`
- **Scenario**: `insert_one` calls `create_with_id` (row inserted, `is_builtin` defaults to 0) and then a *separate* `set_builtin(..., true)`. If the process is killed or the connection drops between the two statements, the recipe row exists but is flagged `is_builtin = 0` — indistinguishable from a user-authored recipe.
- **Root cause**: The two writes aren't in one transaction. While the next boot's seed pass self-heals (`missing_builtin` → re-flag), in the window before that the row is mis-classified: `refresh_model_tier` skips non-builtin rows, and any UI/logic that hides or protects builtin recipes treats it as user content.
- **Impact**: Narrow and self-healing on next boot, but during the window a system recipe can be edited/deleted as if user-owned, and its model tier won't refresh. Mostly a correctness/robustness nit.
- **Fix sketch**: Add an `is_builtin` parameter to a seed-only create variant (or wrap `create_with_id` + `set_builtin` in `unchecked_transaction`) so the row is never visible un-flagged. Keep the heal path as a belt-and-suspenders.
