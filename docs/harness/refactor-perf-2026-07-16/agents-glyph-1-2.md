# agents/glyph [1/2] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 0 high / 5 medium / 1 low)
> Context group: Persona Authoring & Design | Files read: 34 | Missing: 0

## 1. Recipe-suggestion cancellation is dead code — stale IPC responses can clobber the current match
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: stale-response-race
- **File**: src/features/agents/sub_glyph/commandPanel/composer/ComposerRecipeSuggestion.tsx:96
- **Scenario**: User types a task, pauses 300ms (invoke #1 fires), keeps typing to a different task, pauses again (invoke #2 fires). If #1 resolves after #2 (Tauri IPC ordering is not guaranteed, and match latency varies with catalog size), the chip shows the recipe for the OLD task — and the impression telemetry logs it.
- **Root cause**: The `cancelled` guard is returned from *inside the setTimeout callback* (`return () => { cancelled = true; }`), which makes it the timeout callback's return value — never invoked. The effect's actual cleanup only does `clearTimeout(handle)`, so once an invoke is in flight nothing can mark it stale. `cancelled` is permanently `false`.
- **Impact**: Out-of-order responses overwrite newer state; the debounce prevents call floods but not response races. Also inflates `recipe_suggestion_events` impressions with matches the user never meaningfully saw, which feeds the mode-2 eligibility gate.
- **Fix sketch**: Hoist the staleness flag to the effect scope: declare `let cancelled = false` at effect top, check it in `.then`, and return a single cleanup that does both `clearTimeout(handle)` and `cancelled = true`. Alternatively keep a `requestSeq` ref and ignore responses whose seq is not the latest.

## 2. Channel-spec destination metadata and the built-in-inbox constant are duplicated across four files
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/agents/sub_glyph/commandPanel/CommandPanelMessagingRow.tsx:24
- **Scenario**: Adding a new delivery channel type (or a new required destination key for an existing one) requires synchronized edits in `ComposerMessagingPickerModal.DESTINATION_FIELDS`, `CommandPanelMessagingRow.REQUIRED_KEYS`, and both `isFullyConfigured` implementations — the comment at line 22 even admits "Kept in sync there". Miss one and the row chip says "configured" while the picker says "incomplete" (or vice versa).
- **Root cause**: `DESTINATION_FIELDS` (ComposerMessagingPickerModal.tsx:90) and `REQUIRED_KEYS` (CommandPanelMessagingRow.tsx:24) encode the same `ChannelSpecV2Type → required keys` mapping twice, with two separate `isFullyConfigured` functions. On top of that, the `BUILT_IN_INBOX` spec literal is defined three times (ComposerMessagingPickerModal.tsx:106, useComposeConfig.tsx:41, CommandPanelComposer.tsx:39), along with the "ensure built-in present" merge logic.
- **Impact**: Classic drift hazard on a wire-format-adjacent contract (the dispatcher's `deliver_*` adapters); silent inconsistency between the two composer surfaces rather than a compile error.
- **Fix sketch**: Create `commandPanel/channelSpec.ts` exporting `DESTINATION_FIELDS` (REQUIRED_KEYS derivable as `DESTINATION_FIELDS[t].map(f => f.key)`), one `isFullyConfigured(spec)`, `BUILT_IN_INBOX`, and a small `ensureBuiltIn(specs)` helper. Point all four files at it.

## 3. Cinema casting machinery duplicated between GlyphCinemaLayout and GlyphDialogueCinemaLayout
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/agents/sub_glyph/GlyphDialogueCinemaLayout.tsx:150
- **Scenario**: Any tweak to the silhouette art, palette, casting cadence, or the connector-dedup rule must be made twice; the two copies have already drifted (PALETTE has 10 vs 8 entries, `useCasting` freezes on coronation while `useReelCasting` fast-forwards) in ways that are partly intentional but structurally indistinguishable from accidental drift.
- **Root cause**: GlyphDialogueCinemaLayout re-declares `FORMS`, `PALETTE`, `Cand`, `Silhouette` (byte-identical SVG at lines 150–168 vs GlyphCinemaLayout.tsx:98–127), a near-identical casting hook, and the same `capTitles` / connector-dedup memos (`seen` set over `personaResolution.connectors`, also tripled in GlyphMetadataPanel.tsx:35–43). ~150 duplicated lines.
- **Impact**: Real maintenance surface on two live compose-surface prototypes; the connector-dedup rule (`service_type || name` lowercased) is business logic triplicated in render files.
- **Fix sketch**: Extract `cinemaShared.tsx` with `FORMS`, `PALETTE`, `Silhouette`, `makeCandidates`, and a parameterized `useCasting({ count, floor, castMs, fastForwardMs? })`; extract `useDedupedConnectorNames(personaResolution)` into a small hook used by both cinemas and GlyphMetadataPanel. Keep the per-variant timings as call-site constants.

## 4. Event-picker reset effect depends on the live persona list — store refreshes wipe in-progress selections
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: effect-dependency-churn
- **File**: src/features/agents/sub_glyph/commandPanel/composer/ComposerEventPickerModal.tsx:50
- **Scenario**: The modal is open and the user has toggled two subscriptions and typed a search query. Anything that calls `fetchPersonas()` in the background (credential added from the test report, a promote finishing, another surface refreshing) replaces the store's `personas` array → `list` memo gets a new identity → the open-gated effect re-runs: `draft` resets to the stale `selected` prop, the query clears, the active persona jumps back to `list[0]`, and focus is re-stolen by the 80ms timeout.
- **Root cause**: The initialize-on-open effect declares `[open, selected, list]` as deps, but `list` is derived state that changes independently of the modal opening. The effect body only guards `if (!open) return` — it does not distinguish "just opened" from "deps churned while open".
- **Impact**: User-visible lost work (selections/search wiped mid-edit) plus redundant state churn/re-renders on every store refresh while the modal is open.
- **Fix sketch**: Run the reset only on the open transition: track `prevOpen` in a ref (or key the modal contents on `open`) and initialize `draft`/`query`/`activePersonaId` only when `open` flips false→true. Keep `list[0]` fallback lookup inside the handler rather than in the effect deps.

## 5. GlyphFullLayout and GlyphStageSurface carry parallel copies of the post-compose stage wiring
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/agents/sub_glyph/GlyphFullLayout.tsx:37
- **Scenario**: GlyphStageSurface was extracted (2026-07-07) precisely so prototypes share one build/refine/test stage, but the flagship GlyphFullLayout still keeps its own inline copy: the same 8 pieces of local UI state, the same session-change reset effect (GlyphFullLayout.tsx:133–143 vs GlyphStageSurface.tsx:74–84), the same ~35-prop GlyphSigilFace bundle, the same GlyphRowStrip/title band, and the same CapabilityAddModal/BuildSimulatePanel/TestReportModal block (incl. the identical `onCredentialAdded` fetchPersonas closure). A fix landing in one (e.g. adding `setShowAdd(false)` to the reset — present in StageSurface, absent in FullLayout) silently misses the other.
- **Root cause**: The extraction stopped at the prototype layouts; the baseline kept its pre-extraction copy because it interleaves the composer overlay, edit face, and top-center summary popup into the same JSX.
- **Impact**: ~150 lines of drift-prone duplication on the most-used build surface; the reset-effect divergence is already real (`showAdd` not cleared on session change in GlyphFullLayout).
- **Fix sketch**: Either render GlyphStageSurface inside GlyphFullLayout's non-compose branch (passing the two extra slots — top-center summary and edit face — as props), or extract the shared modal block + reset hook (`useStageLocalState(buildSessionId)`) that both consume. Verify GlyphDimensionSummaryCard positioning survives; needs a look at GlyphEditFace interplay (outside this context slice).

## 6. Six always-mounted useHealthyConnectors consumers fire duplicate vault fetches per composer surface
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: duplicate-fetch
- **File**: src/features/agents/sub_glyph/useComposeConfig.tsx:105
- **Scenario**: One Dialogue/Composer surface mounts useComposeConfig (hook), ComposerConnectorsPickerModal, ComposerMessagingPickerModal (both mounted even while closed via `cfg.modals`), plus CommandPanelToolsRow/CommandPanelMessagingRow in the baseline — each calls `useHealthyConnectors()`, whose mount effect runs `if (!credentials.length) fetchCredentials()` (useHealthyConnectors.ts:23–26, shared hook outside this context). When the vault store is empty or still loading, every consumer fires its own `fetchCredentials` + `fetchConnectorDefinitions` IPC call on mount.
- **Root cause**: Fetch-on-empty is done per-consumer inside the hook with no in-flight dedup visible at the hook level; the composer surfaces multiply the consumer count by keeping all picker modals permanently mounted.
- **Impact**: Up to ~6 redundant IPC round-trips (and repeated O(creds × defs) `find` joins) per composer mount when the vault is cold — bounded, but pure waste on a surface users open often. If the vault legitimately has zero credentials, every future consumer mount re-fires the fetch.
- **Fix sketch**: Verify whether vaultStore dedupes in-flight fetches; if not, add a `loading/loaded` flag checked by the hook (`if (!loaded && !loading) fetch…`). Cheaper local fix inside this context: lazy-mount the picker modals (render only when their `open` flag is true) so closed pickers don't subscribe or fetch at all.
