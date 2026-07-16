# Design Reviews & Diagrams — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 0, High: 1, Medium: 3, Low: 1)

## 1. Scoped `cancel_design_analysis` is a complete no-op — CLI keeps burning tokens and the result is still persisted after the user cancels
- **Severity**: High
- **Category**: bug
- **File**: src-tauri/src/commands/design/analysis.rs:218 (cancel), :63 (`begin_run`), :341 (`set_pid`)
- **Scenario**: User starts a design analysis / refine / compile-from-intent, then clicks Cancel. The frontend always has `designIdRef.current` set during a run (`useDesignAnalysis.ts:218` passes it), so the backend takes the scoped branch: `cancel_run("design", &id)` + `take_run_pid("design", &id)`.
- **Root cause**: API family mismatch. `spawn_design_run` registers the run with the **single-process domain** API — `registry.begin_run("design", id)` for the token and `registry.set_pid("design", pid)` for the PID (lib.rs:175, :262). The scoped cancel path uses the **multi-run** API (`cancel_run`/`take_run_pid`, lib.rs:309, :337), which reads a different map keyed `"design:{id}"` that was never populated. Neither the cancellation flag is set nor the PID found; only the unscoped `else` branch (`cancel("design")`) would work, but it is unreachable while a design id exists.
- **Impact**: Cancel is success theater: the UI goes idle, but the Claude CLI child keeps running (paid tokens), and because `cancelled` stays `false`, `run_design_analysis` proceeds to overwrite `persona.last_design_result` (analysis.rs:412, :436) with a result the user explicitly discarded — silent state corruption of the canonical design.
- **Fix sketch**: In the scoped branch call the domain APIs (`registry.cancel("design")` guarded by an id match via `clear_id_if`-style compare), or better, migrate spawn_design_run to `register_run_guarded`/`set_run_pid` keyed by design_id so scoped cancel works and concurrent designs stop sharing one PID slot.

## 2. "Claude asked a question" items are not counted as failures — a run where every item failed still completes with no error message
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/commands/design/reviews.rs:318-357 (question branch), :499-508 (completion summary)
- **Scenario**: User launches a batch review run (`start_design_review_run`) with N test cases whose instructions are vague; Claude asks a clarification question for each. Every item is skipped, scored 0/0, and emits a per-item "error" status — yet the run-completion event reports `status: "completed"` with `error_message: None`.
- **Root cause**: The `failed_count` accounting added to defeat run-level success theater covers the CLI-error, JSON-extraction-miss, and DB-write branches, but the `extract_design_question(...).is_some()` branch (and its inner DB-write-failure `continue` at :328-345) never increments `failed_count`, so the `failed_count == total` / `failed_count > 0` summary logic at :499 undercounts.
- **Impact**: The exact failure mode the counter was built to prevent re-enters through this branch: a fully or partially broken run (all questions, zero usable designs) is summarized as a clean success to any consumer of the terminal DESIGN_REVIEW_STATUS event (progress toasts, run history), and "X of N failed" messages are wrong whenever questions occurred.
- **Fix sketch**: Add `failed_count += 1;` at the top of the question branch (and in its DB-write-failure sub-path, which currently double-skips), matching the other three failure branches.

## 3. A flow node missing `label` (or `id`) crashes the diagram — and the GlyphCard mount has no ErrorBoundary
- **Severity**: Medium
- **Category**: bug
- **File**: src/features/templates/sub_diagrams/FlowNodeCard.tsx:20; src/features/shared/glyph/GlyphCard.tsx:207-214
- **Scenario**: An LLM-generated `use_case_flows` entry contains a node object without a `label` (or with a non-string one). User opens the flow — `node.label.length` throws `TypeError: Cannot read properties of undefined (reading 'length')`.
- **Root cause**: FlowDiagram's defensive normalization (its own comment: "the backend shape-checks use_case_flows only one level deep") stops at array-ness of `nodes`/`edges`; per-node field shape is still trusted. `node.id` is equally trusted (dedupe `Set`, `nodeMap`, React keys — and `key={flow.id}` for tabs at ActivityDiagramModal.tsx:70). In DesignReviewsPage the crash is caught by the "Activity Diagram" ErrorBoundary (blank modal); in GlyphCard the modal is rendered with no boundary, so the throw propagates up the card's tree.
- **Impact**: One malformed node blanks the diagram modal on the templates page, and on any GlyphCard surface it can unmount the whole enclosing view — a single bad LLM row bricks UI far beyond the diagram.
- **Fix sketch**: Extend the `safeNodes` pass to drop/repair nodes with non-string `id`/`label` (e.g. `label ?? id ?? 'Unnamed'`, skip id-less nodes with the existing dev warn), and wrap GlyphCard's ActivityDiagramModal in the same ErrorBoundary used by DesignReviewsPage.

## 4. Keyboard activation of a flow node positions the popover at the canvas origin (or off-screen)
- **Severity**: Medium
- **Category**: ui
- **File**: src/features/templates/sub_diagrams/ActivityDiagramModal.tsx:102-108; FlowNodeCard.tsx:18
- **Scenario**: A keyboard user Tabs to a node card (it has a deliberate `focus-visible` ring, so keyboard use is a supported path) and presses Enter/Space. The synthetic click event has `clientX/clientY = 0`, so `popoverPos` becomes `{x: -rect.left + scrollLeft, y: -rect.top + scrollTop}` — negative coordinates.
- **Root cause**: Popover placement assumes the activating event is a real mouse click carrying viewport coordinates; there is no fallback to the target element's geometry.
- **Impact**: The node detail popover renders detached at the top-left of (or outside) the scroll canvas, nowhere near the focused node — the inspect feature is effectively broken for keyboard/AT users despite the component advertising keyboard support via focus styling.
- **Fix sketch**: When `e.clientX === 0 && e.clientY === 0` (or `e.detail === 0`), derive the position from `e.currentTarget.getBoundingClientRect()` center instead of the pointer coordinates; same canvas-relative math applies.

## 5. Header subtitle shows the design-review count on tabs whose content it doesn't describe
- **Severity**: Low
- **Category**: ui
- **File**: src/features/templates/components/DesignReviewsPage.tsx:45-56
- **Scenario**: User has e.g. 37 design reviews and switches to the Recipes, Presets, or n8n Import tab. The header still reads "37 templates" while the body shows a recipe list / preset library / import wizard with entirely different item counts.
- **Root cause**: The subtitle logic special-cases only `explore` (title-only) and `generated` (gallery total); every other tab falls through to `reviews.length`, a count unrelated to the visible content.
- **Impact**: Misleading count directly under the page title — users read it as the count of what they're looking at (the code already acknowledges this exact problem for the explore tab and for the loading flash, but leaves recipes/presets/n8n inconsistent).
- **Fix sketch**: Return `undefined` (title-only) for the `recipes`, `presets`, and `n8n` tabs, mirroring the explore special-case — or plumb each tab's own total through the same `onTotalChange` pattern GeneratedReviewsTab uses.
