# vault/catalog [3/5] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 0 high / 2 medium / 3 low)
> Context group: Credentials & Connectors | Files read: 18 | Missing: 0

## 1. Secondary/cancel button class string copy-pasted across 8+ files despite an existing shared Button component
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/vault/sub_catalog/components/design/phases/AnalyzingPhase.tsx:128
- **Scenario**: The exact class string `px-4 py-2 bg-secondary/60 hover:bg-secondary text-foreground/90 rounded-modal typo-body transition-colors` (plus near-variants with `border border-primary/15`) is hand-rolled in AnalyzingPhase.tsx:128, NegotiatorGuidingPhase.tsx:118, DonePhase.tsx:64/102, and at least 4 more files outside this context (FormActions, ConnectorCredentialModal, NegotiatorPlanningPhase, AutomationActionStep). Any styling change to the "secondary action" look must be replicated 8+ times.
- **Root cause**: These phase components predate (or ignore) the shared `Button` in `@/features/shared/components/buttons`, which ForagingResults.tsx in the same context already uses with `variant`/`size` props.
- **Impact**: Real maintenance hazard: the variants have already drifted (some have a border + `font-medium` + `transition-all`, some don't), so the "same" button renders differently between phases of the same wizard. This is exactly the drift pattern the shared Button was built to kill.
- **Fix sketch**: Add (or reuse) a `variant="secondary"` on the shared Button and swap the raw `<button>` elements in the 4 in-context files; sweep the other 4 call sites in the same pass. The emerald "apply/finish" button duplicated between NegotiatorGuidingPhase.tsx:123-128 and NegotiatorPhases.tsx:76-81 can become a `variant="accent" accentColor="emerald"` in the same sweep.

## 2. AutoCredReview rebuilds connector context (field mapping + markdown URL regex) on every keystroke
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/vault/sub_catalog/components/autoCred/steps/AutoCredReview.tsx:41
- **Scenario**: `buildConnectorContext(designResult)` is called unconditionally in the component body. The component is fully parent-controlled (`credentialName`, `extractedValues`), so every keystroke in the name input or any FieldCaptureRow re-renders it and re-runs the context build.
- **Root cause**: Missing `useMemo` around a derived value whose only input (`designResult`) is stable for the lifetime of the review screen. `buildConnectorContext` (helpers/types.ts:184-210) maps all connector fields into new objects and runs `extractFirstUrl` — a regex scan over the entire `setup_instructions` markdown — each call. The unmemoized `ctx.fields.filter(...)` at line 93 then also produces a fresh array per render.
- **Impact**: Bounded but pure waste on a hot interactive path (typing credentials): O(fields + instruction-length) regex/allocation work per keystroke, plus fresh field objects defeating any memoization inside FieldCaptureRow.
- **Fix sketch**: `const ctx = useMemo(() => buildConnectorContext(designResult), [designResult]);` and hoist the `.filter((f) => f.key)` into the same memo (or a second one). Two-line change, no behavior difference.

## 3. Dead ternary in AnalyzingPhase — all three branches resolve to `text-foreground`
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/features/vault/sub_catalog/components/design/phases/AnalyzingPhase.tsx:107
- **Scenario**: The step-label className computes `step.status === 'completed' ? 'text-foreground' : step.status === 'active' ? 'text-foreground' : 'text-foreground'` — every branch is identical, so the conditional does nothing.
- **Root cause**: Leftover from a theming pass that collapsed distinct status colors into `text-foreground` without removing the now-inert conditional.
- **Impact**: Misleading: readers assume completed/active/pending labels are styled differently (they are not — the only remaining differentiation is the icon), and it hides whether the collapse was intentional. Zero runtime cost, pure noise.
- **Fix sketch**: Replace with the literal `className="typo-body font-medium text-foreground"`. If differentiated label colors were intended (e.g. dimmed pending steps), restore them deliberately instead.

## 4. Connector color-tile markup (`${color}15` bg / `${color}30` border + Plug icon) duplicated in 4 files within this context
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/vault/sub_catalog/components/design/phases/PreviewBanners.tsx:55
- **Scenario**: The inline-styled tile `style={{ backgroundColor: `${color}15`, borderColor: `${color}30` }}` wrapping a `Plug` (or ThemedConnectorIcon) appears in PreviewBanners.tsx:55-63, AutoCredReview.tsx:49-54, IdleSuggestions.tsx:49-57, and SetupSteps.tsx:58-69, with only size (w-6/w-10) and icon fallback varying.
- **Root cause**: No shared `ConnectorTile`/`ConnectorAvatar` primitive; each phase component re-derives the alpha-suffix color trick by hand.
- **Impact**: The hex-with-alpha-suffix trick silently breaks if a connector color ever arrives as `rgb()`/named color, and that assumption is now encoded in 4+ places; visual drift between the 24px and 40px variants has already begun (rounded-card vs rounded-modal).
- **Fix sketch**: Extract a small `ConnectorTile({ color, iconUrl?, label?, size })` component next to `ThemedConnectorIcon` in `@/lib/connectors/connectorMeta` (which SetupSteps already imports) and replace the four call sites. Centralizes the color-alpha logic in one place.

## 5. AutoCredBrowserError formats every log timestamp with Intl `toLocaleTimeString` per entry per render
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/vault/sub_catalog/components/autoCred/steps/AutoCredBrowserError.tsx:60
- **Scenario**: Each render maps the full `logs` array and calls `new Date(entry.ts).toLocaleTimeString([], {...})` per entry. Browser-automation runs can accumulate hundreds of log lines, and Intl-backed formatting is one of the slower per-call APIs in JS.
- **Root cause**: Timestamp formatting is done inline in the row render instead of once per entry (entries are immutable — `ts` never changes after append).
- **Impact**: Bounded — this is the terminal error screen, so re-renders are infrequent (mainly the `useAutoScrollRef` length-driven pass and parent updates). Cost is O(entries) Intl calls per render rather than per new entry.
- **Fix sketch**: Hoist a module-level `const timeFmt = new Intl.DateTimeFormat(undefined, { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })` and use `timeFmt.format(entry.ts)`; reusing one DateTimeFormat instance removes the dominant cost. If the same pattern exists in the live log view (AutoCredLogEntries), fix it there too — that path renders per streamed line.
