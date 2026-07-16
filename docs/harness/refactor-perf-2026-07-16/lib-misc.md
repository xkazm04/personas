# lib (misc) — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 0 high / 3 medium / 2 low)
> Context group: Core Libraries & State | Files read: 18 | Missing: 0

## 1. `agentIR.ts` is entirely dead — zero importers anywhere in the repo
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/lib/design/agentIR.ts:1
- **Scenario**: A repo-wide grep for `emptyAgentIR`, `diffAgentIR`, `mergeAgentIR`, and the module path `design/agentIR` finds no callers, no tests, and no re-exports — the only references are the file itself and `context-map.json`. All 135 lines (factory, structural diff, merge) ship as an aspirational "universal interchange pipeline" that was never wired up.
- **Root cause**: The module was written ahead of a diff/merge/version/rollback feature ("operations like diff, merge, version, and rollback become trivially possible") that never landed on the frontend.
- **Impact**: 135 LOC of non-trivial logic (field diffing, trigger identity keys, 13-field overlay merge) that must be kept in sync with `AgentIR`'s type every time the type grows a field — pure maintenance tax with no runtime consumer. `mergeAgentIR`'s hand-listed field-by-field copy is exactly the kind of code that silently drifts when `AgentIR` changes.
- **Fix sketch**: Delete `src/lib/design/agentIR.ts` (and its context-map entry on the next map refresh). If the diff/merge capability is still planned, resurrect it from git history when the consumer actually exists — or at minimum add a `@deprecated`/TODO marker so the next reader doesn't assume it's live. Verify with `tsc` after removal (no import breaks expected).

## 2. `KEYWORD_MAP` duplicated between `agentIconCatalog.ts` and `autoAssignIcons.ts` — and the two copies have already diverged
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/lib/icons/agentIconCatalog.ts:128
- **Scenario**: Both files carry a ~19-rule keyword→iconId table; the catalog's comment even says "Mirrors the heuristics in `autoAssignIcons.ts` so adoption-time inference agrees with the migration pass". But they already disagree: rule ORDER differs (catalog checks email/calendar first; autoAssign checks code/devops first), `'alert'` lands on `monitor` via the catalog but is also in autoAssign's `notification` bucket, `'pipeline'` appears under devops+automation+sales in autoAssign only, `'report'`, `'ops'`, `'doc'`, `'customer service'` exist in only one copy. A persona named "Deploy Alert Bot" can get a different icon at template-adoption time than the first-launch migration would assign.
- **Root cause**: The table was copy-pasted into `agentIconCatalog.ts` (for `iconIdForTemplate`) instead of extracting a shared constant, and each copy has since been edited independently.
- **Impact**: The stated invariant (adoption-time inference == migration-pass inference) is silently broken; every future keyword tweak has to be made twice and reviewers have no compile-time signal when it isn't.
- **Fix sketch**: Keep one canonical `KEYWORD_MAP` (and one `inferIconIdFromText(text)` helper) in `agentIconCatalog.ts`; have `autoAssignIcons.ts` import it and delete its local copy. Reconcile the diverged entries deliberately (union of keywords, one agreed order) in the same commit, noting that reconciliation may change which icon a few personas/templates infer.

## 3. User-facing error copy duplicated between `ERROR_PATTERNS` (errorExplanation) and `ERROR_RULES` (errorRegistry)
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/lib/errors/errorExplanation.ts:85
- **Scenario**: Several matchers exist in both tables with near-identical copy — decryption ("Could not decrypt — the passphrase may be wrong or the file is corrupted"), circular chain, webhook delivery, import/export bundle, budget, Claude-CLI-not-found. `classifyErrorFull()` runs both tables on the same string, so a single raw error carries two independently-maintained phrasings (`friendly.message` vs `explanation.summary/guidance`) that can drift apart in the UI.
- **Root cause**: `errorExplanation.ts` was created by merging three older pattern lists and "incorporates additional patterns from errorRegistry.ts" by copying the strings rather than referencing shared entries; `errorPipeline.ts` then layered both without deduplicating the sources.
- **Impact**: Editing an error message requires knowing it lives in (up to) two tables plus `ERROR_KEY_MAP` in `useTranslatedError.ts` (which the registry's comments say must be kept in sync by hand). Divergent copy for the same failure is a real UX/consistency hazard, and the sync burden grows with every new Rust error variant.
- **Fix sketch**: Pick one table as the source of message+suggestion text (the registry, since it's the superset) and reduce `ERROR_PATTERNS` entries that duplicate it to explanation-specific extras only (severity/icon/navigation action), looked up by shared rule id. Alternatively, generate both from a single rule list with optional `explanation` fields. Either way, delete the copied strings so each error has exactly one canonical phrasing.

## 4. DevInspector re-renders on every mousemove with no throttling or same-target short-circuit
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/lib/dev/DevInspector.tsx:87
- **Scenario**: While armed, the capture-phase `mousemove` handler runs `buildChain()` (a `closest("[data-loc]")` walk up the whole ancestor chain), two `getBoundingClientRect()` calls, and `setHover({...})` with a fresh object — per mouse event, even when the cursor stays inside the same element. Every event forces a portal re-render (HighlightBox ×2, SourceLabel, InspectorHud with crumb dedupe/map).
- **Root cause**: No `requestAnimationFrame` coalescing and no "same innermost element as last time → skip" guard before calling `setHover`.
- **Impact**: Dev-only (mounted behind `import.meta.env.DEV`), so no production cost — but on deep DOM trees the armed inspector gets visibly janky, which is friction on the exact tool meant to be waved around the whole app. Contained blast radius keeps this Low.
- **Fix sketch**: Track the last hovered element in a ref and return early when `e.target`'s resolved `[data-loc]` element is unchanged; coalesce updates through `requestAnimationFrame` (store the latest event, process once per frame). Both are ~10 lines and eliminate the per-pixel DOM walk + render.

## 5. `autoAssignPersonaIcons` issues one `updatePersona` IPC per persona instead of a batch write
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src/lib/icons/autoAssignIcons.ts:88
- **Scenario**: The migration loops over every eligible persona and awaits `updatePersona(p.id, …)` for each — N IPC round-trips into rusqlite, serialized in batches of 5. The `ASSIGNMENT_KEY` bump to `-v2` deliberately re-runs the pass on every existing install, so this executes on first launch for all users with stale Lucide icons.
- **Root cause**: No bulk-update command exists (or was used) for the icon/color columns, so the frontend falls back to the per-row single-record API inside a loop.
- **Impact**: Bounded and one-time per install (guarded by localStorage), so cost is small in absolute terms — but with dozens of personas it adds a burst of sequential IPC+DB writes during app startup, the most latency-sensitive moment. Kept Low because it's a cold, once-per-install path.
- **Fix sketch**: Add a `update_persona_icons_bulk(Vec<(id, icon, Option<color>)>)` Tauri command that performs the updates in a single rusqlite transaction, and have `autoAssignPersonaIcons` compute all assignments first and send one call. If a new command is too heavy for the payoff, at least raise the batch size — the 5-way throttle protects nothing on a local SQLite file.
