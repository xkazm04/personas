# Design Reviews & Diagrams — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: design-reviews-and-diagrams | Group: Templates & Recipes
> Total: 5 | Critical: 0 | High: 1 | Medium: 3 | Low: 1

## 1. Activity-diagram footer crashes on the exact malformed flow FlowDiagram was built to survive
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: latent crash / null-deref
- **File**: src/features/templates/sub_diagrams/ActivityDiagramModal.tsx:130-133
- **Scenario**: An LLM-generated `use_case_flows` entry omits the `nodes` (or `edges`) array — e.g. `{"id":"f1","name":"Main","description":"…","edges":[...]}` with no `nodes`. The user clicks "View flows". `FlowDiagram` renders fine (it does `flow.nodes ?? []`, see FlowDiagram.tsx:27-45). But the modal footer renders in the SAME pass and reads `activeFlow.nodes.length`, `activeFlow.edges.length`, and `activeFlow.nodes.filter(...)` directly.
- **Root cause**: `UseCaseFlow.nodes/edges` are typed as non-optional arrays (frontendTypes.ts:319-320), so TS sees the access as safe, but FlowDiagram's own comment documents that the LLM may omit them. The footer (lines 130-133) was never given the `?? []` normalization FlowDiagram has. `undefined.length` / `undefined.filter` throws `TypeError`. ActivityDiagramModal is mounted in DesignReviewsPage.tsx:94-101 with NO surrounding `ErrorBoundary` (unlike the n8n/Recipes/Presets tabs), so the throw escapes the whole page subtree.
- **Impact**: One malformed flow (the documented, defended-against case) blanks the diagram modal / page instead of degrading gracefully — defeating the entire FlowDiagram hardening effort. Also affects legacy reviews persisted before the shape was stabilized.
- **Fix sketch**: Derive `const nodes = activeFlow.nodes ?? []; const edges = activeFlow.edges ?? [];` once and use those in the footer counts; and/or wrap `<ActivityDiagramModal>` in an `ErrorBoundary` in DesignReviewsPage. Bonus: `parseJsonSafe<UseCaseFlow[]>(use_case_flows, [])` (DesignReviewsPage.tsx:99) does not validate array-ness — a stored `"null"`/object would yield a non-array and crash `flows[0]`/`flows.length`; guard with `Array.isArray`.
- **Value**: impact=7 effort=1

## 2. `last_design_result` lives in two places that the backend never reconciles
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: state desync / dual source of truth
- **File**: src-tauri/src/commands/design/analysis.rs:436-457 (and refine read at :151-160; conversations.rs append COALESCE at design_conversations.rs:93/143)
- **Scenario**: A design run completes. `run_design_analysis` persists the new result to `persona.last_design_result` ONLY. The `design_conversations.last_result` column is updated solely when the FRONTEND later calls `append_*_design_message` with a `last_result` arg (and the SQL is `COALESCE(?3, last_result)` — a NULL leaves the old value). If the frontend skips/races that call, the conversation's cached `last_result` silently stays stale. Then `refine_design` (analysis.rs:151) seeds the refinement base from `current_result` → `persona.last_design_result` — never the conversation's cache — while ALSO loading that same conversation's history (:156-160).
- **Root cause**: Two authoritative stores for "the latest design" with no backend invariant tying them together; the refine path mixes them (persona for the result, conversation for the transcript).
- **Impact**: A refinement can run against a result that disagrees with the conversation transcript the model is also shown, or the UI can display a stale cached result — wrong/confusing design conclusions with no error surfaced.
- **Fix sketch**: Make `run_design_analysis` write the conversation's `last_result` in the same persistence step (pass the `conversation_id` through `DesignRunParams`), or drop `conversation.last_result` entirely and always read `persona.last_design_result`. Document which column is canonical.
- **Value**: impact=5 effort=4

## 3. Valid designs silently scored "failed" — the flows dimension demands start+end+≥5 nodes, all-or-nothing
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: analysis produces wrong conclusion on valid input
- **File**: src-tauri/src/commands/design/reviews.rs:2558-2580 (gate at :384 and :780)
- **Scenario**: A correct, complete design produces a 4-node flow, or a flow whose terminal node is typed `action`/`connector` rather than literally `"end"`, or omits an explicit start node. `score_design_result` requires `has_start && has_end && enough_nodes (>=5)` simultaneously, so the flows dimension scores 0. Each missed dimension is 20 points; dropping flows pulls structural from 60→40, crossing the `>= 55` pass gate.
- **Root cause**: The flows criterion conjoins three undocumented hard thresholds and contributes all-or-nothing. The `>=5` node count and the requirement of nodes literally typed `start`/`end` are magic and unexplained.
- **Impact**: A good template gets `status = "failed"` and a red badge in the gallery, prompting the user to burn a paid CLI rebuild on a design that was fine. The "why" is invisible — there's no per-dimension breakdown shown.
- **Fix sketch**: Soften to partial credit (e.g. score start/end/size independently), lower or document the `>=5` constant, and accept terminal nodes by graph topology (out-degree 0) not only by `type=="end"`. Persist per-dimension results so the UI can explain the score.
- **Value**: impact=5 effort=3

## 4. `activeFlowIndex` never resets — switching to a review with fewer flows shows "no flow data" for a review that has flows
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: stale UI state / wrong render
- **File**: src/features/templates/sub_diagrams/ActivityDiagramModal.tsx:26,32
- **Scenario**: User opens review A (5 flows), selects tab 4 (`activeFlowIndex = 3`). Without closing the modal, they trigger "View flows" on review B (2 flows) — DesignReviewsPage keeps the modal mounted and just swaps the `flows` prop. React reuses the component instance, so `activeFlowIndex` stays 3. `flows[3]` is `undefined` → `activeFlow = null` → canvas renders the "no flow data" empty state and none of B's 2 tabs is highlighted, even though B has flows. A rebuild that shrinks the flow count produces the same desync.
- **Root cause**: `useState(0)` with no `useEffect`/key to clamp or reset `activeFlowIndex` when `flows` (or the review identity) changes.
- **Impact**: Diagram appears empty/broken for a perfectly good review until the user closes and reopens — looks like data loss.
- **Fix sketch**: Reset on prop change — `key={diagramReview.id}` on the modal in DesignReviewsPage, or `useEffect(() => setActiveFlowIndex(0), [flows])`, or clamp `Math.min(activeFlowIndex, flows.length - 1)`.
- **Value**: impact=4 effort=2

## 5. Magic pass threshold `structural_score >= 55` doesn't correspond to any reachable score
- **Severity**: Low
- **Lens**: ambiguity-guardian
- **Category**: undocumented constant
- **File**: src-tauri/src/commands/design/reviews.rs:384 (also :780)
- **Scenario**: A maintainer reading `if structural_score >= 55 { "passed" }` cannot tell what "55" means. `structural_score` is `(passed/5)*100` rounded, so its only possible values are 0/20/40/60/80/100. `>= 55` is therefore exactly `>= 60`, i.e. "3 of 5 dimensions" — but nothing says so, and a later refactor that changes the dimension count or makes scoring continuous would silently shift the gate.
- **Root cause**: The threshold is expressed as an opaque percentage rather than as the dimension count it actually encodes, with no comment.
- **Impact**: No functional defect today, but high-confusion / fragile: an easy place to introduce an off-by-one pass/fail regression. The two call sites (:384, :780) must stay in lockstep with no shared constant.
- **Fix sketch**: Replace with a named constant tied to the scoring model, e.g. `const STRUCTURAL_PASS_DIMENSIONS: i32 = 3;` and compare `structural_passed >= STRUCTURAL_PASS_DIMENSIONS`, shared by both call sites; comment why 3/5.
- **Value**: impact=3 effort=1
