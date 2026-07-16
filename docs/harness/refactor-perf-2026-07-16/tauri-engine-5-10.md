# tauri:engine [5/10] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 0 high / 4 medium / 2 low)
> Context group: Backend Engine & Runtime | Files read: 18 | Missing: 0

## 1. Repeated full-map re-sort at every directory level in KB index walk
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: algorithmic-waste
- **File**: src-tauri/src/engine/kb_index.rs:235
- **Scenario**: `walk()` ends with `for notes in out.values_mut() { notes.sort_by(...) }` — but `out` is the *entire* accumulated folder map and `walk()` recurses once per directory. Indexing a vault with D directories and N total notes re-sorts every folder's vector D times, so a 100-folder / 1000-note Obsidian vault performs ~100 full-map sorts instead of 1.
- **Root cause**: The per-folder sort was placed inside the recursive function instead of after the top-level call in `build_index`.
- **Impact**: O(D × Σ n·log n) work where O(Σ n·log n) suffices. Mostly-sorted re-sorts are cheap-ish, but on large/deep vaults this is measurable wasted CPU on a user-triggered indexing path, and it grows quadratically with tree size.
- **Fix sketch**: Delete the sort loop from `walk()` and run it once in `build_index` right after the initial `walk(root, root, ...)` call returns. Behavior is identical (the cap/`take(limit)` reads the map only after the walk completes).

## 2. Per-(tool × connector) JSON re-parse plus DB query inside nested healing-hint loop
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src-tauri/src/engine/healing_timeline.rs:85
- **Scenario**: `resolve_hint_from_cache` iterates `tools × connectors` and calls `serde_json::from_str(&connector.services)` inside the inner loop — each connector's services JSON is re-parsed once per tool. It is invoked once per failed execution in `run_healing_analysis` (up to 10 failures), so a persona with T tools and C connectors does up to 10 × T × C JSON parses, plus a `repo::get_knowledge_hint` DB query per matched (tool, connector) pair.
- **Root cause**: The "with_cache" variant caches the tools/connectors *fetches* but not the derived per-connector parsed service list or the tool→connector mapping, so the expensive derivation is redone in the hot inner loop.
- **Impact**: Wasted CPU (repeated JSON parsing of identical strings) and repeated SQLite hits during every healing analysis pass — a path that fires automatically when executions fail, i.e. exactly when the system is already under stress.
- **Fix sketch**: Parse each connector's `services` once up front into a `HashMap<tool_name, Vec<&connector_name>>`, build it a single time per `run_healing_analysis` call (alongside the existing tools/connectors pre-fetch), and pass that map into the hint resolver. `get_knowledge_hint` then runs at most once per (connector, pattern_key), memoizable in a small local HashMap keyed by connector name.

## 3. Lenient JSON parsing API is entirely dead ("planned API" never wired)
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src-tauri/src/engine/safe_json.rs:108
- **Scenario**: `lenient_from_str`, `lenient_from_str_as`, `recover_json`, `strip_code_fences`, `extract_json_body`, `remove_trailing_commas`, and `fix_truncated_keywords` are all `#[allow(dead_code)]` with the comment "planned API — no Tauri command wires into lenient parsing yet". That is ~230 lines of production code plus ~120 lines of tests maintained for a feature nothing calls.
- **Root cause**: Speculative API landed ahead of its consumer; the `allow(dead_code)` annotations confirm the compiler sees zero in-crate callers (verification for cross-crate callers unnecessary — this is a binary crate module).
- **Impact**: Maintenance burden: string-splicing heuristics (`fix_truncated_keywords` does manual byte scanning with escape tracking) are exactly the kind of code that needs care on every touch, and reviewers must reason about it despite it never running. It also invites divergence from `workflow_compiler::parse_output`, which independently implements its own fence-stripping fallback (line 99) instead of using this module.
- **Fix sketch**: Either wire it: replace the ad-hoc ```` ```json ```` extraction in `workflow_compiler::parse_output` with `safe_json::lenient_from_str_as::<TopologyBlueprint>` (one real consumer, deletes duplicate fence logic, drops all `allow(dead_code)`); or delete the lenient half of the module and keep only the strict `from_str`/`from_str_as`. Wiring is the better trade — the consumer already exists.

## 4. Field-resolution cascade triplicated across String/f64/i32 helpers
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/engine/config_merge.rs:302
- **Scenario**: `resolve_f64_field` (302-332) and `resolve_i32_field` (334-364) are byte-identical modulo the numeric type; `resolve_string_field` (266-300) is the same cascade with an added "empty string counts as absent" filter. Any change to the inheritance semantics (e.g. tracking that BOTH lower tiers exist, or a fourth tier) must be applied three times.
- **Root cause**: Monomorphic helpers written before generalizing; `ConfigField<T>` is already generic so the resolver could be too.
- **Impact**: ~70 lines of pure duplication in the config-inheritance core; a semantic fix applied to one copy and missed in another silently diverges the `source`/`is_overridden` metadata the UI displays.
- **Fix sketch**: One generic `fn resolve_field<T: Clone + Serialize + TS>(agent: Option<T>, ws: Option<T>, global: Option<T>) -> ConfigField<T>` covering the numeric cases; keep `resolve_string_field` as a thin wrapper that maps empty strings to `None` before delegating. Existing tests pin the behavior.

## 5. Dead `resolve_knowledge_hint` wrapper superseded by the `_with_cache` variant
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src-tauri/src/engine/healing_timeline.rs:26
- **Scenario**: `resolve_knowledge_hint` is annotated `#[allow(dead_code)]`; the only live call path (`run_healing_analysis`) uses `resolve_knowledge_hint_with_cache`. The wrapper duplicates the category→pattern_key match and the tools/connectors fetching that the caller already performs.
- **Root cause**: When the batched variant was introduced to kill redundant per-loop queries, the original single-shot entry point was kept "just in case" instead of removed.
- **Impact**: ~35 lines of unreachable code duplicating the pattern-key mapping in two places; a new failure category added to one match arm but not the other would silently diverge.
- **Fix sketch**: Delete `resolve_knowledge_hint` (the `allow(dead_code)` proves no in-crate caller). If a single-shot entry point is ever needed again, it is a two-line composition over the `_with_cache` variant.

## 6. Stopword HashSet rebuilt on every `tokenize` call in the typeahead scorer
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: repeated-allocation
- **File**: src-tauri/src/engine/recipe_matcher.rs:121
- **Scenario**: `tokenize` constructs a ~50-entry `HashSet<&str>` from `STOPWORDS` on each call. `match_intent_to_recipes` calls `tokenize` for the intent plus 2–3 times per recipe (name, description, each tag), so one debounced keystroke against N recipes rebuilds the identical set ~3N times.
- **Root cause**: The stopword set is derived from a `const` slice inside the function instead of being a process-lifetime static.
- **Impact**: Bounded but pure waste on an interactive typeahead path (the module's own docs call it "a debounced typeahead"); also `score_recipe` re-tokenizes every recipe's static name/desc/tags on every keystroke, which compounds for large recipe pools.
- **Fix sketch**: `static STOPWORD_SET: LazyLock<HashSet<&'static str>> = LazyLock::new(|| STOPWORDS.iter().copied().collect());` and reference it in `tokenize`. If recipe pools grow, a follow-up can cache per-recipe token sets keyed by `updated_at`, but the static set alone is a two-line win.
