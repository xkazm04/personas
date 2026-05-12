# Code-refactor scan — Incidents, Manual Review, Memories & Knowledge

> Total: 11 findings (3 high, 6 medium, 2 low)
> Scope: src/ + src-tauri/, full-stack (Tauri/React/Rust)
> Date: 2026-05-12
> Path drift: All listed paths in the task spec were wrong. Real locations:
>   - `src/features/incidents` → `src/features/overview/sub_incidents`
>   - `src/features/manual-review` → `src/features/overview/sub_manual-review`
>   - `src/features/memories` → `src/features/overview/sub_memories`
>   - `src/features/knowledge` → `src/features/overview/sub_knowledge`
>   - `src/api/incidents.ts` → `src/api/overview/incidents.ts`
>   - `src/api/manualReview.ts` → `src/api/overview/reviews.ts` (manual reviews live alongside design reviews)
>   - `src/api/memories.ts` → `src/api/overview/memories.ts`
>   - `src/api/knowledge.ts` → `src/api/overview/intelligence/knowledge.ts`
>   - `src/stores/slices/incidentSlice.ts` → does not exist (incidents have no slice, hook-only via `useIncidentsData`)
>   - `src/stores/slices/memorySlice.ts` → `src/stores/slices/overview/memorySlice.ts`
>   - `src/stores/slices/knowledgeSlice.ts` → does not exist (no slice)
>   - `src-tauri/src/commands/incidents.rs` → `src-tauri/src/commands/execution/audit_incidents.rs`
>   - `src-tauri/src/commands/manual_review.rs` → integrated into `src-tauri/src/db/repos/communication/manual_reviews.rs` + design_review commands
>   - `src-tauri/src/commands/memories.rs` → `src-tauri/src/commands/core/memories.rs` (+ `memory_compile.rs`)
>   - `src-tauri/src/commands/knowledge.rs` → `src-tauri/src/commands/execution/knowledge.rs`
>   - `src-tauri/src/db/models/incident.rs` → `src-tauri/src/db/models/audit_incident.rs`
>   - `src-tauri/src/db/models/memory.rs` → matches.

## 1. Entire `sub_memories/hooks/` directory is dead — 4 files duplicating `libs/`

- **Severity**: high
- **Category**: dead-code / duplication
- **File**:
  - `src/features/overview/sub_memories/hooks/memoryActions.ts:1-139` (140 LOC)
  - `src/features/overview/sub_memories/hooks/memoryConflicts.ts:1-200` (201 LOC)
  - `src/features/overview/sub_memories/hooks/mergeMemories.ts:1-35` (35 LOC)
  - `src/features/overview/sub_memories/hooks/conflictBadges.tsx:1-27` (28 LOC)
  - Total: 4 files, ~404 LOC orphan
- **Scenario**: Every public symbol re-exported by `sub_memories/index.ts` (`detectConflicts`, `textSimilarity`, `loadActions`, `saveActions`, `extractActionsFromReview`, `ACTION_KIND_META`, `MemoryAction`, `MemoryConflict`, `kindBadge`, `similarityBadge`, `mergeMemories`) comes from `./libs/`. All component imports (`MemoryConflictReview.tsx:7`, `ConflictCard.tsx:7`, `MemoryActionCard.tsx:3`) and the store (`stores/slices/overview/memorySlice.ts:6-7`) also import from `./libs/`. A full grep for `sub_memories/hooks/` returns exactly one hit — a comment in `src/lib/memoryLimits.ts:7` that *describes* the legacy copy. No runtime path loads `hooks/*`.
- **Root cause**: A refactor moved `hooks/*.ts` to `libs/*.ts` (file dates differ: `libs/memoryActions.ts` is Apr 26, `hooks/memoryActions.ts` is Mar 12). The hook copies stayed behind. The libs copies have additional features (`silentCatch`/`toastCatch` reporting, in-memory `_sessionBackup`, shape-guard parsing) the hooks copies lack.
- **Impact**: 404 LOC of bit-rotting dead code. The two copies of `memoryConflicts.ts` are NEAR-identical (same algorithm, same thresholds, same NEGATION_PAIRS list); a maintainer tuning thresholds in `libs/` while the hooks copy still ships in some import resolver path could silently get the wrong logic. The comment in `memoryLimits.ts:7` actively misleads readers into thinking both copies are live.
- **Fix sketch**:
  1. `rm src/features/overview/sub_memories/hooks/` (whole dir).
  2. Update `src/lib/memoryLimits.ts:7` comment to drop the "legacy hook copy" reference.

## 2. `TriagePlayer.tsx` is fully orphaned but its `TriageReview` type leaks the dead component into live imports

- **Severity**: high
- **Category**: dead-code
- **File**: `src/features/overview/sub_manual-review/components/TriagePlayer.tsx:1-391` (391 LOC)
- **Scenario**: `TriagePlayer` is a 391-LOC "swipe queue + center stack" component for manual reviews. Grep shows zero JSX usages — `<TriagePlayer` appears nowhere. The only consumer reference is `ManualReviewList.tsx:27`: `import type { TriageReview } from './TriagePlayer';` — pulling only the `TriageReview` interface. Meanwhile `reviewFocusHelpers.tsx:8-20` exports its own copy of the same `TriageReview` shape, and the live path (`ManualReviewList → ReviewFocusFlow`) uses that one.
- **Root cause**: `ReviewFocusFlow` (597 LOC) replaced `TriagePlayer`. The component was retired but the file was kept because `ManualReviewList` accidentally type-references it.
- **Impact**: 391 LOC orphan, plus inside it three more local duplicates of things that exist elsewhere: a 6-row `SEVERITY_CONFIG` (mirrors `reviewFocusHelpers.tsx:82` and `formatters.ts:127`), a `parseSuggestedActions` (TriagePlayer.tsx:49) duplicating `reviewHelpers.ts:32`, and a `TriageReview` interface duplicating `reviewFocusHelpers.tsx:8`.
- **Fix sketch**:
  1. Move the `TriageReview` interface to `reviewFocusHelpers.tsx` (already declared there — just retarget the import).
  2. Update `ManualReviewList.tsx:27` to `import type { TriageReview } from './reviewFocusHelpers';`.
  3. `rm src/features/overview/sub_manual-review/components/TriagePlayer.tsx`.

## 3. `sub_knowledge/knowledgeTypes.ts` is an orphan duplicate of `libs/knowledgeHelpers.ts`

- **Severity**: medium
- **Category**: dead-code / duplication
- **File**: `src/features/overview/sub_knowledge/knowledgeTypes.ts:1-24` (24 LOC)
- **Scenario**: Defines `KNOWLEDGE_TYPES`, `COLOR_MAP`, `formatDuration`, `formatCost` — all four are also exported by `libs/knowledgeHelpers.ts` with the same names. All three actual consumers (`KnowledgeRow.tsx:6`, `KnowledgeGraphDashboard.tsx:16`, `AnnotateModal.tsx:6`) import from `libs/knowledgeHelpers`. Grep for `knowledgeTypes` returns zero hits outside the file itself. The libs version is the upgraded one — it has 7 knowledge types (vs 5 in the orphan), adds `SCOPE_TYPES`, uses custom SVG icons from `KnowledgeTypeIcons.tsx`, and has 7 colors (vs 5).
- **Root cause**: An earlier shape of the knowledge feature kept type config at the package root; the libs/ refactor never deleted the original.
- **Impact**: 24 LOC orphan. Subtle correctness risk: any contributor finding `knowledgeTypes.ts` first would extend it (e.g., add `agent_annotation`) and silently miss the live registry.
- **Fix sketch**: `rm src/features/overview/sub_knowledge/knowledgeTypes.ts`.

## 4. `parseSuggestedActions` duplicated across 3 sites with subtly different fallback semantics

- **Severity**: medium
- **Category**: duplication
- **File**:
  - Canonical: `src/features/overview/sub_manual-review/libs/reviewHelpers.ts:32-41`
  - Dup A: `src/features/overview/sub_manual-review/components/TriagePlayer.tsx:49-57` (orphan, see finding 2)
  - Dup B: inline in `ReviewDetailPanel.tsx:82-89` for `decisions` parsing (same JSON pattern, different field)
- **Scenario**: `reviewHelpers.parseSuggestedActions` parses a JSON array; on parse failure it splits the raw string by `;` and `\n`. `TriagePlayer`'s copy parses JSON the same way but on failure splits only by `\n`. `ReviewDetailPanel` has yet another inline JSON.parse pattern for the `decisions` field. `ReviewFocusFlow.tsx` and `ReviewDetailPanel.tsx` both already import the canonical version, so the divergence sits in the orphan + an inline copy.
- **Root cause**: Each component re-derived the JSON-or-newline-split helper in isolation. The `reviewFocusHelpers.parseDecisions` (line 39) is similarly a near-cousin parsing the same wire format.
- **Impact**: Subtle behavioral drift — a persona sending `"a;b;c"` would yield `["a","b","c"]` in the canonical version but `["a;b;c"]` in TriagePlayer's. With finding 2 applied, two of the three sites disappear; only `ReviewDetailPanel.tsx:82` remains as duplicate.
- **Fix sketch**: After deleting `TriagePlayer.tsx`, factor `reviewFocusHelpers.parseDecisions` and the inline `ReviewDetailPanel.tsx:82` decision-parse into a single `parseDecisionsContext(raw)` helper in `libs/reviewHelpers.ts`.

## 5. Three independent `SEVERITY_*` config maps for the same severity vocabulary

- **Severity**: medium
- **Category**: duplication
- **File**:
  - `src/lib/utils/formatters.ts:127-132` — `SEVERITY_COLORS` (canonical, design-token-based: `bg-status-info`, `bg-status-warning`, `bg-status-error`).
  - `src/features/overview/sub_manual-review/components/reviewFocusHelpers.tsx:82-104` — `SEVERITY_CONFIG` (hex-anchored Tailwind: `from-red-500`, `from-amber-500`, `from-emerald-500`).
  - `src/features/overview/sub_manual-review/components/reviewFocusHelpers.tsx:146-150` — `SEV_BADGE_COLORS` (third style: `bg-red-500/15`).
  - Plus `TriagePlayer.tsx:37-43` (dead, but currently parallel).
- **Scenario**: The `formatters.ts` canonical map uses semantic tokens. The manual-review feature defines two new maps with literal Tailwind palette colors. `incidentTaxonomy.ts:48-50` correctly funnels back to `SEVERITY_COLORS`, proving the canonical version is usable. Manual-review chose to re-skin instead.
- **Root cause**: The triage flow wanted gradient + glow effects that the token-based map didn't expose, so the author defined a parallel ladder. The badge map is a separate third variant for queue chips.
- **Impact**: Theming drift — a tokens.css update to `--status-warning` is invisible to ManualReview. Three places to update when severity styling evolves.
- **Fix sketch**: Extend `formatters.SEVERITY_COLORS` with optional `gradient`/`shadow` fields, or expose a `severityVariant: 'badge' | 'gradient' | 'dot'` helper there. Then collapse `SEVERITY_CONFIG` + `SEV_BADGE_COLORS` to thin wrappers, or delete them.

## 6. `MemoryActionCard.tsx` `ACTION_KIND_META` hex colors duplicate Tailwind classes already in the same record

- **Severity**: low
- **Category**: duplication / cruft
- **File**: `src/features/overview/sub_memories/libs/memoryActions.ts:129-135`
- **Scenario**: Each `ACTION_KIND_META` entry has both `color: '#f59e0b'` AND `bgClass: 'bg-amber-500/10'` + `borderClass: 'border-amber-500/20'` + `textClass: 'text-amber-400'`. The hex literal is the same color the Tailwind class points at. Grep shows `ACTION_KIND_META` is used by `MemoryActionCard.tsx` only; if the hex is consumed for a non-Tailwind context (SVG, chart), only one site needs it.
- **Root cause**: Author kept both representations "just in case."
- **Impact**: Duplicate truth — if a designer rebrands amber to a different shade in tailwind config, the hex stays stale.
- **Fix sketch**: Grep `ACTION_KIND_META.*color` usages; if the hex isn't actually consumed in inline-style, drop the `color` field.

## 7. `IncidentSeverity` enum on the Rust side has no `from_str` while `IncidentStatus` does — asymmetric API and unused enum

- **Severity**: low
- **Category**: dead-code
- **File**: `src-tauri/src/db/models/audit_incident.rs:57-76`
- **Scenario**: `IncidentSeverity` derives Serialize/Deserialize and has only `as_str()` — no `from_str`. Grep finds zero call sites: the repo (`audit_incidents.rs:normalize_severity`) returns `String`, not the enum; the `severity` field on `AuditIncident` is `String`. The enum exists purely for `ts-rs` export so the TS side gets a union literal, which IS used by `IncidentFilters` etc. — but the Rust-side `as_str()` impl has no callers.
- **Root cause**: Author kept the impl block when only the TS shape mattered.
- **Impact**: Trivial dead code (10 LOC). Easy mismatch later when someone adds a variant and forgets the impl.
- **Fix sketch**: Delete the `impl IncidentSeverity { pub fn as_str() ... }` block; keep the enum for ts-rs.

## 8. `memorySlice.ts` `incrementCountEntry` / `decrementCountEntry` duplicate the same map-update pattern used elsewhere

- **Severity**: low
- **Category**: duplication
- **File**: `src/stores/slices/overview/memorySlice.ts:57-65`
- **Scenario**: 9-line `incrementCountEntry` and 3-line `decrementCountEntry` operate on `Array<[string, number]>` from `MemoryStats.category_counts`/`agent_counts`. The pattern (find-or-insert / decrement-and-filter on an entries array) appears in at least one other slice's stats updater (likely `eventSlice` for similar denormalized counts). Worth a quick grep before extracting, but as it stands these 2 helpers are only called within this file (3 sites in `statsAfterCreate`/`statsAfterDelete`).
- **Root cause**: Local-only helpers that later grow.
- **Impact**: Minor — only becomes a problem if a second slice rediscovers them.
- **Fix sketch**: Leave alone unless a third site materializes; if extracted, move to `src/lib/utils/countMapUtils.ts`.

## 9. `useIncidentsData` polling pattern reimplements `usePolling`

- **Severity**: medium
- **Category**: duplication
- **File**: `src/features/overview/sub_incidents/libs/useIncidentsData.ts:31-62`
- **Scenario**: This hook hand-rolls a `setInterval` + `inFlightRef` + filter-keyed dependency pattern. `ManualReviewList.tsx:18` already imports `usePolling, POLLING_CONFIG` from `@/hooks/utility/timing/usePolling` for the same concern. The incidents hook also has its own `inFlightRef` race-avoidance — which `usePolling` is presumably the canonical home for.
- **Root cause**: Hook predates `usePolling`, or the author wasn't aware of it.
- **Impact**: One more place to fix when polling semantics evolve (visibility-aware pause, exponential backoff, etc.). Filter-string-key recomputation via `JSON.stringify(filters)` is a fragile dep pattern.
- **Fix sketch**: Replace the `setInterval` + filter-key block with `usePolling(refresh, POLLING_CONFIG.incidents ?? 30_000)` and pass filters via a ref to avoid re-subscription.

## 10. `KIND_PATTERNS` regex ladder duplicated across the two `memoryActions.ts` copies, and the live one has no test coverage

- **Severity**: medium
- **Category**: duplication / structure
- **File**: `src/features/overview/sub_memories/libs/memoryActions.ts:79-85` (live)
- **Scenario**: Five-row regex ladder mapping content patterns → `MemoryActionKind` ("throttle" / "schedule" / "alert" / "config" / "routing"). The orphan `hooks/memoryActions.ts:45-66` has an identical ladder — and after finding 1 deletes the orphan, that ladder still doesn't have a test (no entry under `src/api/__tests__/memories.test.ts` or anywhere). The patterns include subtle cases like `/req(uest)?s?\s*\/\s*(hour|min|sec|day)/i` (rate-limit detection) that classify into actionable rules — easy to silently break with a regex tweak.
- **Root cause**: Heuristic glued in directly without isolated tests.
- **Impact**: After finding 1 lands, this becomes the sole copy; risk shifts from drift to silent regression. Listed here because the cleanup work should land tests at the same time.
- **Fix sketch**: When deleting the orphan copy, lift `KIND_PATTERNS` + `detectKind` to a small `kindClassifier.ts` and add a vitest table covering each kind + the `'config'` fallback. Cheap insurance now that the ladder has only one home.

## 11. `MemoryReviewDetail.action` union and `MemoryReviewResult.proposal_id` shape are duplicated between TS API and Rust without a TS-binding contract

- **Severity**: medium
- **Category**: structure
- **File**:
  - `src/api/overview/memories.ts:135-167` — hand-written `MemoryReviewDetail` / `MemoryReviewResult` interfaces.
  - The rest of the file imports generated `ts-rs` bindings (e.g. `PersonaMemory`, `CreatePersonaMemoryInput`, `MemoryReviewProposal`, `ProposalEntry`, `ApplyMemoryReviewProposalResult`). Only `MemoryReviewDetail` + `MemoryReviewResult` are hand-rolled.
- **Scenario**: Every other type in this file flows from Rust via `ts-rs` `#[ts(export)]`. The review-result shapes are the lone exception — they sit in the TS file as a literal union (`'kept' | 'deleted' | 'error' | 'proposed_delete' | 'proposed_update_importance'`) and a struct that has to be kept in lockstep with whatever the Rust command returns. If the Rust side adds a sixth action (e.g. `'proposed_archive'`), TypeScript will silently accept the new string at runtime and crash the `switch` ladder in consuming components.
- **Root cause**: `review_memories_with_cli` was added before `ts-rs` was the standard pattern in this module; never retroactively migrated.
- **Impact**: Hidden drift risk between Rust authority and TS consumers; the same hand-roll problem that `MemoryStats` (line 56) also exhibits in this file.
- **Fix sketch**: On the Rust side (`commands/core/memories.rs`), add `#[derive(TS)] #[ts(export)]` to the result structs; import them from `@/lib/bindings/MemoryReviewResult` etc.; delete the hand-written interfaces.
