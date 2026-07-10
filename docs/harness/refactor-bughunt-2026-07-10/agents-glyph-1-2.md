> Context: agents/glyph [1/2]
> Total: 10
> Critical: 0  High: 1  Medium: 4  Low: 5

## 1. useComposeConfig silently discards connector table-scope
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: silent-failure / trust-boundary
- **File**: src/features/agents/sub_glyph/useComposeConfig.tsx:252-257 (connectors modal) + :123-128 (quick-config emit)
- **Scenario**: In the connectors picker the user opens a database connector and narrows the persona to a specific subset of tables (`ConnectorTableScopeRow` → `onApply(next, prunedTables)`). `ComposerConnectorsPickerModal.onApply` has signature `(next: string[], tables: Record<string,string[]>) => void`, but useComposeConfig wires it as `onApply={(next) => { setSelectedConnectors(next); ... }}` — the second `tables` argument is dropped. The quick-config effect then always emits `connectorTables: {}`. Result: the persona is built with access to ALL tables of that database instead of the user-selected subset.
- **Root cause**: The hook only tracks `selectedConnectors` (string[]); it never added table-scope state, unlike `CommandPanelComposer.tsx:214-218` which correctly captures `nextTables` into `selectedConnectorTables`.
- **Impact**: security/scope — user-intended data-access restriction is silently voided on every surface built on this hook (e.g. GlyphDialogueCinemaLayout). No error, no UI trace.
- **Fix sketch**: Add `const [connectorTables, setConnectorTables] = useState<Record<string,string[]>>({})`, capture the 2nd arg in `onApply`, pass `tables={connectorTables}` into the modal, and emit `connectorTables` in the quick-config effect (mirror CommandPanelComposer).

## 2. Recipe-suggestion match has a dead cancel guard → stale-response race
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: race-condition
- **File**: src/features/agents/sub_glyph/commandPanel/composer/ComposerRecipeSuggestion.tsx:79-101
- **Scenario**: The debounced effect fires `match_recipes_to_intent`, and its `.then` guards on `if (cancelled) return`. But `let cancelled = false` lives INSIDE the `setTimeout` callback, and the `return () => { cancelled = true }` is the return value of that callback (ignored by setTimeout) — NOT the effect's cleanup. The effect cleanup only runs `clearTimeout(handle)`. So once the timer fires and a fetch is in flight, editing the task cannot cancel it. If the user keeps typing and an older request resolves after a newer one, the stale match overwrites the fresh `setMatch`.
- **Root cause**: Cleanup closure nested one level too deep; `cancelled` is effectively dead code.
- **Impact**: UX — a recipe chip for a prior intent fragment can flash/persist over the current one; impression telemetry logged against a stale recipe_id.
- **Fix sketch**: Hoist `let cancelled = false` to effect scope and `return () => { cancelled = true; clearTimeout(handle); }` as the effect's cleanup.

## 3. launch() augments intent then fires in the same tick — augmentation may not reach the build
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: state-corruption / ordering
- **File**: src/features/agents/sub_glyph/useComposeConfig.tsx:231-242
- **Scenario**: `launch` calls `onIntentChange(\`${intentText}\n---\n...${coreAugmentation}\`)` and then synchronously `onLaunch()`. `onIntentChange` schedules a parent `setState`; if the parent's `onLaunch` reads its `intentText` state (the common pattern), it reads the pre-augmentation value on this render — the memory/review lines and the persona-core directive block are dropped from the launched build. The same tick cannot observe the just-scheduled state.
- **Root cause**: setState-then-read-in-same-tick assumption; the augmented string is never handed to launch directly.
- **Impact**: correctness — persona-core temperament + memory/review preferences silently omitted from the build prompt (assumes parent `onLaunch` reads state rather than a ref; verify against the parent launch handler).
- **Fix sketch**: Have `onLaunch` accept the augmented text (`onLaunch(finalText)`), or store the composed intent in a ref that the parent reads, rather than relying on the async state flush.

## 4. parseIntent re-buckets user text that contains a recognized "Label:" prefix
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/features/agents/sub_glyph/commandPanel/commandPanelHelpers.ts:62-82
- **Scenario**: `composeIntent` prefixes each row (`Task: …`, `Output: …`) and joins with `\n`; `parseIntent` reverses it by matching `^([A-Za-z ]+):\s*(.*)$` against composeLabels. If a user types a line like `Output: ranked list` INSIDE the Task field, a remount round-trips that line out of Task and into the Output row (and `Human review:` similarly), silently reorganizing their prose.
- **Root cause**: The label round-trip has no escaping/sentinel; any line beginning with a composeLabel word + colon is treated as a section header.
- **Impact**: UX/data — occasional content reshuffling on re-entry into an existing persona's build flow.
- **Fix sketch**: Only treat a line as a section header when it exactly equals a known label prefix at the start of the whole block, or wrap the machine-composed labels in a sentinel (e.g. a zero-width marker) that free text won't reproduce.

## 5. Casting cinema duplicated wholesale across two layouts
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src/features/agents/sub_glyph/GlyphCinemaLayout.tsx:96-171,195-205 vs GlyphDialogueCinemaLayout.tsx:150-233
- **Scenario**: `FORMS`, `PALETTE`, the `Silhouette` component, the casting-state hook (`useCasting`/`useReelCasting`), the `capTitles` memo, and the connector-name dedup loop are near-identical copies in both files (palette differs by one color; the reel variant adds a fast-forward branch). Verified by direct diff — same shapes, same store selectors, same dedup logic.
- **Root cause**: The DialogueCinema variant was cloned from Cinema rather than sharing primitives.
- **Impact**: maintainability — a fix to the silhouette geometry or the connector-dedup rule must be made twice; they will drift.
- **Fix sketch**: Extract `Silhouette`, `FORMS`/`PALETTE`, a shared `dedupeConnectorNames(personaResolution)`, and a parametrized casting hook into a `cinemaShared.ts`; keep only the layout-specific choreography per file.

## 6. Two sources of truth for required messaging destination fields
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src/features/agents/sub_glyph/commandPanel/CommandPanelMessagingRow.tsx:24-43 (REQUIRED_KEYS + isFullyConfigured) vs commandPanel/composer/ComposerMessagingPickerModal.tsx:90-103,158-162 (DESTINATION_FIELDS + isFullyConfigured)
- **Scenario**: The row's `REQUIRED_KEYS` and the modal's `DESTINATION_FIELDS` encode the same per-channel required destination keys (slack→channel, teams→team_id+channel_id, …) plus a duplicated `isFullyConfigured`. The row comment even admits "mirrors DESTINATION_FIELDS … Kept in sync there." Two hand-synced tables of the same fact.
- **Root cause**: No shared channel-field descriptor module; each surface re-declared it.
- **Impact**: maintainability — adding a channel or changing a required key (both must match `notifications.rs`) requires edits in two files; drift produces a mismatched "needs setup" warning.
- **Fix sketch**: Export one `DESTINATION_FIELDS` + `isFullyConfigured(spec)` from a shared module and import into both the row and the modal.

## 7. BUILT_IN_INBOX literal defined three times
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: useComposeConfig.tsx:41-44, commandPanel/CommandPanelComposer.tsx:39-46, commandPanel/composer/ComposerMessagingPickerModal.tsx:106-113
- **Scenario**: The identical `ChannelSpecV2` built-in-inbox constant is re-declared in all three files.
- **Root cause**: No shared channel-defaults module.
- **Impact**: maintainability — a schema change to the built-in spec must touch three copies.
- **Fix sketch**: Export a single `BUILT_IN_INBOX` (and the "ensure built-in present" helper) from one place and import it.

## 8. DialogueStageSurface: CapabilityAddModal is unreachable (dead state)
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src/features/agents/sub_glyph/DialogueStageSurface.tsx:43,49,120
- **Scenario**: `showAdd` is declared, reset to false on session change, and passed to `<CapabilityAddModal open={showAdd} …>`, but `setShowAdd(true)` is never called anywhere in the component (`GlyphCoreContent` takes no `onShowAdd`). The modal can never open here (unlike GlyphStageSurface, which wires `onAdd` via GlyphRowStrip). So the state + modal are dead in this surface.
- **Root cause**: Copied the modal wiring from GlyphStageSurface without the trigger affordance (there is no row strip in the dialogue stage).
- **Impact**: maintainability (dead code); also a latent feature gap — no "add capability" path in the dialogue stage.
- **Fix sketch**: Either remove `showAdd`/`setShowAdd`/`CapabilityAddModal` from this surface, or add an actual trigger if the affordance is intended.

## 9. Recipe tool/connector JSON parsing duplicated
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: commandPanel/commandPanelHelpers.ts:98-116 (parseRecipeTools) vs RecipeAlternativeModal.tsx:27-45 (parseConnectorNames)
- **Scenario**: Both defensively parse a recipe's JSON requirement blob (string[] | array-of-{name/service_type}) into a name list, each with its own try/catch and shape-tolerance. Same problem, two implementations (RecipeAlternativeModal additionally dedupes).
- **Root cause**: Parsers grew independently next to their callers.
- **Impact**: maintainability — a recipe schema shape change (new object form) must be handled in both.
- **Fix sketch**: Consolidate into one `parseRecipeNameList(raw)` util (with an optional dedup flag) and reuse.

## 10. `const t = setTimeout(...)` shadows the i18n `t` in three picker modals
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication / naming-smell
- **File**: ComposerConnectorsPickerModal.tsx:57, ComposerEventPickerModal.tsx:56, ComposerMessagingPickerModal.tsx:183
- **Scenario**: Each modal destructures `const { t } = useTranslation()` and then, inside the open-focus effect, writes `const t = setTimeout(() => inputRef.current?.focus(), 80)`, shadowing the translation binding within the effect. Harmless today (the effect doesn't use translations) but a shadow trap: any future `t.xxx` added inside the effect would silently reference the timer handle.
- **Root cause**: Copy-pasted focus effect across the three sibling pickers.
- **Impact**: maintainability / latent bug hazard.
- **Fix sketch**: Rename the handle (`const focusTimer = setTimeout(...)`) in all three.
