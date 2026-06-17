# Test Mastery — Design Reviews & Diagrams
> Total: 7 findings (1 critical, 3 high, 2 medium, 1 low)

Scope note: the underlying design *engine* (`engine/design.rs` — `extract_design_result`, `extract_design_question`, `check_feasibility`, prompt builders) is well covered with 16 `#[test]`s. The gap is the **command layer** in this context (`commands/design/reviews.rs`, `analysis.rs`, `conversations.rs`) — it has **zero `#[cfg(test)]` modules** despite holding the scoring gate, the template classifier, and the keyset-cursor codec. The frontend diagram code (`FlowDiagram.tsx` BFS layering) is also untested, and the repo has mature vitest+jsdom infra (189 test files) so adding tests is low-friction.

## 1. `score_design_result` pass/fail gate has no tests
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/commands/design/reviews.rs:2470-2603
- **Current test state**: none
- **Scenario**: This function computes the structural (0-5 → %) and semantic (0-4 → %) scores from a generated design, and `start_design_review_run` / `rebuild_design_review` brand a review `"passed"` iff `structural_score >= 55`. A regression in any of the 9 dimension checks (e.g. the flows check requires `start` + `end` + `≥5 nodes`; the connectors check requires non-empty `credential_fields` AND `auth_type`) silently shifts the pass/fail line. A design that should fail gets surfaced to users as a passing, adoptable template — and a rebuild marks it `passed` and persists it. No test would catch the threshold or any dimension flipping.
- **Root cause**: Scoring lives inline in the command module where no test harness was ever set up; the boundary case `structural_passed = 3/5 = 60% → passed` vs `2/5 = 40% → failed` (the actual 55 cutoff) is never asserted.
- **Impact**: Bad designs marketed as good (and vice versa) — the core quality signal of the whole templates surface becomes unreliable, eroding trust in generated/adopted personas.
- **Fix sketch**: Add a `#[cfg(test)] mod tests` to reviews.rs. Build `serde_json::json!` fixtures and assert: (a) a fully-populated result → `(100, 100)`; (b) an empty `{}` → `(0, 0)`; (c) a result with exactly the 3 structural dims that sum to 60% scores `passed`, and one at 40% scores `failed` — pin the **55 boundary** explicitly; (d) flows with only 4 nodes, or missing `end`, do NOT count; (e) a connector missing `auth_type` does NOT count. Invariant: the score is a deterministic function of which dimensions are *structurally complete*, and the pass line sits between 2/5 and 3/5.

## 2. `infer_template_category` 20-rule classifier is untested
- **Severity**: high
- **Category**: llm-generatable
- **File**: src-tauri/src/commands/design/reviews.rs:2165-2398
- **Current test state**: none
- **Scenario**: Pure function (instruction text + connectors JSON → category key) used on every review create, every import, both backfill commands (`backfill_review_categories`), and by `template_adopt.rs` to set `persona.template_category`. Rules are **order-sensitive** ("security" before "devops" before "testing"…) and the connector fallback maps brand names (stripe→finance, github→development). A reordering or a typo'd keyword silently mis-buckets templates, breaking category filters/badges across the gallery — and there is no assertion that "this instruction lands in this category".
- **Root cause**: Classifier was added inline with no test module; precedence between overlapping keyword sets (e.g. an instruction containing both "pipeline" [sales] and "deploy" [devops]) is undocumented and unverified.
- **Impact**: Mis-categorized templates → wrong filter results, wrong persona `template_category`, polluted taxonomy that backfill then cements across the whole table.
- **Fix sketch**: **LLM-generatable batch.** One table-driven test: array of `(instruction, expected_category)` covering each of the 20 rules + the connector fallbacks + the `"productivity"` default. Add explicit precedence cases (instruction hitting two rules → asserts the earlier rule wins) and an empty-instruction-with-`["stripe"]`-connectors → `"finance"` case. Invariant to assert: **rule order is the contract** (first matching keyword group wins; connector fallback only fires when no keyword matched).

## 3. `parse_review_cursor` / `next_cursor` keyset codec round-trip untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/commands/design/reviews.rs:909-954
- **Current test state**: none
- **Scenario**: `list_manual_reviews_page` is the L1/L2 pagination layer of the overview "layered-fetch" contract. `next_cursor` is encoded as `"{created_at}|{id}"` and decoded by `parse_review_cursor` via first-`|` split. The decoder relies on the invariant that neither RFC3339 timestamps nor UUIDs contain `|`. If the cursor format or the decoder's split logic drifts (e.g. someone uses `split('|')` last-segment, or the encode side changes the separator), pagination silently breaks: pages repeat or skip rows, and a malformed cursor is meant to fall back to page 1. None of this is asserted.
- **Root cause**: Encode (line 945) and decode (912) live in different functions with the contract only in a comment; no round-trip test ties them together; `limit.clamp(1, 200)` default-40 behavior is also unverified.
- **Impact**: Manual-review backlog (a human-in-the-loop queue) silently drops or duplicates rows during scroll — reviewers miss pending approvals, or re-action the same item.
- **Fix sketch**: Unit-test `parse_review_cursor`: valid `"2026-06-17T00:00:00Z|uuid"` → `Some(...)`; empty string, no-`|`, leading-`|`, trailing-`|` → `None`. Add a round-trip test asserting `parse(format!("{}|{}", c, i)) == Some((c, i))`. Assert the limit clamp (0→1, 999→200, None→40) by extracting the clamp into a tiny helper if needed. Invariant: cursor encode/decode is a lossless round-trip; bad input degrades to page-1, never panics.

## 4. `extract_display_text` stream-json parser untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/commands/design/analysis.rs:474-507
- **Current test state**: none
- **Scenario**: Parses each Claude CLI stdout line for the live progress stream (design analysis AND template review runs both call it). It must: pull `content[].text` from assistant messages, pull `result` strings, emit a friendly line for `system/init`, return `None` for other system events, and pass plain (non-JSON) lines through verbatim. A regression here either floods the UI with raw stream-json noise or blanks the progress feed during a paid CLI run — the only visible signal that generation is alive.
- **Root cause**: Pure `&str → Option<String>` function with no test module; the several branches (assistant text / result / system-init / system-other / plain text) are each a distinct contract never pinned.
- **Impact**: Progress UX breaks silently; users can't tell a long-running generation from a hung one and may cancel/retry, burning more API credits.
- **Fix sketch**: **LLM-generatable.** Table test over representative lines: an assistant message JSON → returns the text; `{"result":"..."}` → returns it; `{"type":"system","subtype":"init"}` → the friendly init line; `{"type":"system","subtype":"other"}` → `None`; a bare `"hello"` plain line → `Some("hello")`; malformed JSON → passes through as plain text. Invariant: only display-relevant content surfaces; non-display events return `None`.

## 5. `FlowDiagram` BFS layering produces no test for cycles / orphans
- **Severity**: medium
- **Category**: coverage-gap
- **File**: src/features/templates/sub_diagrams/FlowDiagram.tsx:24-98
- **Current test state**: none
- **Scenario**: The layering algorithm (adjacency build → BFS by in-degree → orphan attachment → inter-layer label collection) is the only thing that turns LLM-generated `nodes`/`edges` into a renderable activity diagram. The code already defends against missing `nodes`/`edges` (null-coalesce, comment at line 17) — but there is no test proving a **cyclic** graph terminates (the `visited` set is what prevents an infinite layer loop), that orphaned/disconnected nodes still appear, or that a graph with no `start` and all-non-zero in-degree falls back to `safeNodes[0]`. A regression could hang the modal or drop nodes from the diagram.
- **Root cause**: Algorithmic component with branchy graph logic; repo has jsdom+vitest but no test was written for it.
- **Impact**: Design reviewers see an incomplete or empty diagram (missing nodes) or a frozen modal on a malformed/cyclic flow — they approve a design they couldn't actually inspect.
- **Fix sketch**: Extract the `layers`/`adjacency` logic into a pure helper (or test via RTL render + `data-testid` on FlowNodeCard) and assert: a linear 5-node flow yields the expected layer count/order; a flow with a back-edge (cycle) still terminates and visits every node once; orphan nodes are appended to the last layer; empty `nodes` renders nothing without throwing. Invariant: every node is rendered exactly once and BFS always terminates regardless of edge topology.

## 6. Backfill commands (`service_flow`, `related_tools`, categories) mutate stored designs with no tests
- **Severity**: medium
- **Category**: coverage-gap
- **File**: src-tauri/src/commands/design/reviews.rs:1745-2005
- **Current test state**: none
- **Scenario**: Three backfill commands rewrite the persisted `design_result` JSON of existing reviews: `backfill_service_flow` converts legacy `string[]` → object form and derives from `suggested_connectors`; `backfill_related_tools` matches tools to connectors by name-prefix heuristic. These are bulk DB-mutating data migrations over user content. The transform logic (old-format detection at 1798-1807, the `needs_backfill` predicate, the prefix matcher `t.starts_with(connector_name) || contains("_{name}_")`) is pure and easily testable, but a bug here corrupts the `service_flow`/`related_tools` of every review in one pass with no undo.
- **Root cause**: Migration-style transforms embedded in IPC commands; the JSON-reshaping core is never exercised in isolation.
- **Impact**: Silent corruption of stored designs across the whole table (e.g. a connector named `git` greedily matching `github_*` tools, or empty arrays overwriting good data).
- **Fix sketch**: Factor the pure transform out of the DB loop (e.g. `fn build_service_flow(obj: &Map) -> Vec<Value>`, `fn match_related_tools(connector: &str, tools: &[String]) -> Vec<String>`) and table-test: legacy `["Slack","GitHub"]` → ordered object array with lowercased `connector_name`; the prefix matcher matches `slack_send` for `slack` but NOT `slackbot_x` for a different connector; an already-backfilled object array is left untouched (`needs_backfill == false`). Invariant: backfill is idempotent and never replaces a populated field with an empty one.

## 7. `enrich_instruction` / result-extractor helpers untested
- **Severity**: low
- **Category**: llm-generatable
- **File**: src-tauri/src/commands/design/reviews.rs:2400-2465
- **Current test state**: none
- **Scenario**: `enrich_instruction` appends a `--- Template Metadata ---` block only when at least one hint is present; `extract_connectors_from_result` / `extract_triggers_from_result` / `extract_use_case_flows_from_result` pull arrays out of the design result for persistence into the review row. Low blast radius (formatting + extraction), but the "header only when hints exist" branch and the "always valid JSON array string, `[]` on absence" guarantee are cheap to lock and feed the columns used by filters.
- **Root cause**: Small pure helpers bundled into the untested command module.
- **Fix sketch**: **LLM-generatable.** Assert: no hints → instruction returned unchanged (no metadata header); each hint individually appends its labeled line; `extract_connectors_from_result` on a result with two named connectors → `"[\"a\",\"b\"]"`; on absence → `"[]"` (never `null`/error). Invariant: extractors always emit a parseable JSON array string; enrichment is additive and only when hinted.
