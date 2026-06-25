# Recipes & Use-Case Blueprints — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: recipes-and-use-case-blueprints | Group: Templates & Recipes
> Total: 5 | Critical: 0 | High: 2 | Medium: 3

## 1. Suggestion threshold 0.90 is effectively unreachable — the recipe typeahead silently never fires
- **Severity**: High
- **Lens**: ambiguity-guardian
- **Category**: magic-number / silent false-negative
- **File**: src-tauri/src/engine/recipe_matcher.rs:33 (and scoring at :127, gate at :169)
- **Scenario**: User types "triage my emails every morning"; a recipe named "Email Triage" with a matching description exists. The composer should surface a suggestion chip, but never does.
- **Root cause**: `score = 0.6*name_j + 0.3*desc_j + 0.1*tags_j`, where each `*_j` is a raw Jaccard over token *sets* (no stemming, plural≠singular, length-penalizing). The max name contribution is 0.6 (only when the name's token set is *identical* to the intent's). To clear `SUGGESTION_THRESHOLD = 0.90` you need name **and** description Jaccards both ≈1.0 — i.e. all three fields are near-verbatim copies of what the user typed. Realistic strong matches (name_j≈0.4, desc_j≈0.4, tags_j≈0.3) score ≈0.39. "emails" vs "email" are different tokens, so even an exact topical hit collapses the Jaccard. The threshold was calibrated against the only case that reaches it: the identical-text fixtures in `match_threshold_gate`.
- **Impact**: The entire keyword-suggestion feature is dead weight in production — `above_threshold` is essentially always false, so no chip ever renders. A user-visible feature silently does nothing; nobody notices because below-threshold matches are still returned (for debug) but never surfaced.
- **Fix sketch**: Either (a) lower the threshold to a value reachable by the weighted-Jaccard distribution (empirically ~0.35–0.5) and document the recalibration, or (b) normalize fields first (lowercase + light stemming/lemmatization, treat name overlap as containment rather than symmetric Jaccard so short intents aren't punished). Add a test asserting a *paraphrased* (not verbatim) strong intent clears the bar.
- **Value**: impact=8 effort=3

## 2. Eligibility is "vacuously Eligible" whenever tool_hints[] is absent and ignores connectors — a false green light that seeds a non-functional persona
- **Severity**: High
- **Lens**: ambiguity-guardian
- **Category**: false-positive / partial-seed enabler
- **File**: src-tauri/src/engine/recipe_eligibility.rs:126-134 (state pick) and :256 (`Resolved(Vec::new())`); connectors-deferred note at :30-34
- **Scenario**: A recipe whose real requirements live only in `connectors[]` (e.g. a Gmail OAuth credential) or whose `tool_hints[]` was never populated during derivation scores `Eligible`. The card shows one-click adopt; the user adopts; the resulting persona has no Gmail credential/tool and fails the first time it runs.
- **Root cause**: Eligibility is decided **entirely** by tool-name overlap from `tool_hints[]`/`tool_requirements`. An empty/absent requirement set returns `Resolved(vec![])` → `Eligible` (line 131-133), and `connectors[]` is explicitly not scored in v1 (line 30-34). So "Eligible" means "no *tool-name* requirements I could parse," not "this persona can actually run this recipe." Whether `tool_hints` is reliably emitted by derivation is undocumented tribal knowledge.
- **Impact**: This is exactly the "half-configured persona" the recipe system is meant to prevent: adoption proceeds on a green light it cannot honor, producing a persona that silently can't perform its seeded capability. Recoverable (re-wire the tool/credential), but the UI actively asserts readiness it didn't verify.
- **Fix sketch**: Make eligibility honest about scope — either score `connectors[]` against the persona's wired credentials (promote E.2's check into the gate), or downgrade no-signal recipes from `Eligible` to a distinct "Unverified/AdoptableWithSetup" state so the UI never promises one-click for recipes whose requirements weren't modeled. At minimum, document the invariant that `tool_hints[]` must be populated for eligibility to be meaningful, and add a derivation-time assertion.
- **Value**: impact=8 effort=5

## 3. Eligibility tool matching is exact + case-sensitive — a usable recipe is wrongly marked Incompatible
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: false-negative / silent skip
- **File**: src-tauri/src/engine/recipe_eligibility.rs:106-124
- **Scenario**: A bundle recipe declares `tool_hints: ["Gmail_Search"]` (or ` gmail_search` with stray whitespace beyond the trim, or a tier-renamed tool) while the catalog stores `gmail_search`. The recipe is classed `Incompatible` and dimmed with "not in catalog," even though the tool exists.
- **Root cause**: `persona_names`/`catalog_names` are built as `HashSet<&str>` of raw `t.name` and compared with `contains(name)` (lines 106-123). Matching is byte-exact and case-sensitive; the only normalization is the `.trim()` inside `parse_tool_name_array`. Any casing/spelling drift between how a recipe names a tool and how the catalog stores it produces a false `missing_tools_uncatalogued` → `Incompatible` (which also takes precedence over every other state).
- **Impact**: Genuinely adoptable recipes are silently hidden/dimmed with a misleading "retired/different tier" reason. Hard to diagnose because the scoring is "deterministic and correct" — it's the comparison key that's brittle.
- **Fix sketch**: Normalize both sides through one canonicalizer (lowercase + trim, or an explicit alias map) before set construction. Add a test with mixed-case `tool_hints` against a lowercase catalog asserting `Eligible`.
- **Value**: impact=5 effort=2

## 4. Curation scheduler relies on an undocumented single-task invariant: `mark_run_now` is a blind UPDATE, and the watermark tracks enqueue, not completion
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: race condition / silent failure
- **File**: src-tauri/src/engine/curation_scheduler.rs:144 (mark) with due-check at :121 and reference at :95-108
- **Scenario A (double-run)**: If `tick` is ever driven by two tasks (a second scheduler spawned on dev HMR / a double `setup`, or two ticks overlapping if a tick ever exceeds 60s), both read the same stale `last_curation_at`, both compute "due," both call `mark_run_now`, both `enqueue` → two distinct `memory_curation_run` jobs that both execute an expensive paid CLI pass for the same persona.
- **Scenario B (silent perpetual no-op)**: `mark_run_now` advances `last_curation_at = datetime('now')` *before/independent of* the job ever completing (lines 144-177). If the enqueued curation job persistently fails downstream, the watermark keeps advancing every cron period — the schedule looks healthy forever while curation never actually runs.
- **Root cause**: The in-tick "mark before enqueue, fail closed" ordering (well-reasoned in the comment) only dedups within a *single* sequential task. `mark_run_now` is an unconditional UPDATE, not a compare-and-swap on the old watermark, so it offers zero protection against a concurrent reader. And the watermark is an *enqueue* timestamp, not a *completion* timestamp.
- **Impact**: Duplicate paid CLI billing under multi-init; or invisible, permanent loss of curation under repeated job failure. Both are silent.
- **Fix sketch**: Make the advance a conditional UPDATE (`SET last_curation_at=? WHERE persona_id=? AND last_curation_at IS <old>`) and only enqueue when it affects 1 row — that turns the dedup atomic regardless of task count. Separately, advance the watermark on curation *completion* (or record `last_enqueued_at` vs `last_completed_at`) so a failing job doesn't masquerade as a successful run. Document the single-scheduler-task assumption at the `tick` entry.
- **Value**: impact=6 effort=5

## 5. Seed repair reads a stale in-memory `is_builtin`, so a row flagged builtin in the same pass skips its model-tier refresh; create+set_builtin is also non-transactional
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: stale-read logic bug / non-atomic write
- **File**: src-tauri/src/engine/recipe_seed.rs:204-210 and :262 (early return); create path at :240-243
- **Scenario**: A pre-2026-06 row exists with `is_builtin = 0` and a stale model tier (`model_override` null). On a re-seed pass `insert_one` calls `set_builtin(true)` (line 205), then `refresh_model_tier(pool, &existing, &seed)` (line 210). `refresh_model_tier` returns early at line 262 because the *in-memory* `existing.is_builtin` is still `false` — even though the DB row is now builtin. The model tier is **not** refreshed this pass; it only heals on the *next* app startup (one-startup lag). For an install that re-flags and retiers in one go, users run on a stale Claude-model tier for an extra cycle.
- **Root cause**: `existing` is a snapshot read once via `find_by_source`; subsequent writes (`set_builtin`) mutate the DB but not the snapshot, and `refresh_model_tier` gates on the snapshot. Relatedly, the Created path (lines 240-243) does `create_with_id` then a separate `set_builtin` with no transaction — a failure between them leaves a non-builtin row (self-heals next pass, but is a transient partial state, and the per-row error is only `warn!`-logged into `report.failed`, never escalated).
- **Impact**: Newly-builtin-flagged rows silently miss the system-owned model-tier retiering for one boot; partial create states and per-row seed failures are invisible unless the caller inspects `report.failed`. Low blast radius, self-correcting, but a genuine correctness gap in the "system-owned decision must reach existing installs" contract the module advertises.
- **Fix sketch**: Pass the post-`set_builtin` truth into `refresh_model_tier` (e.g. compute `let now_builtin = existing.is_builtin || missing_builtin;` and gate on that), or re-read the row after `set_builtin`. Wrap create+set_builtin (and the repair writes) in a single transaction so a row is never half-applied. Have the caller surface a non-zero `report.failed` to the user/health UI instead of leaving it log-only.
- **Value**: impact=4 effort=4
