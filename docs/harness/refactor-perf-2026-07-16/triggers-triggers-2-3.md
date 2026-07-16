# triggers/triggers [2/3] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 0 high / 4 medium / 1 low)
> Context group: Execution & Orchestration | Files read: 18 | Missing: 0

## 1. Perpetual requestAnimationFrame loop keeps running after countdown reaches zero

- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: resource-waste
- **File**: src/features/triggers/sub_triggers/RadialCountdownRing.tsx:29-46
- **Scenario**: A scheduled/polling trigger's countdown ring animates via rAF. Once `currentRemaining` clamps to 0 (line 34), the loop keeps scheduling frames forever — 60 callbacks + 60 style writes per second per ring — until the row unmounts. With several visible trigger rows, that's N idle rAF loops burning CPU while displaying a static full circle.
- **Root cause**: The `animate` closure unconditionally re-queues itself (`rafRef.current = requestAnimationFrame(animate)`); there is no terminal condition when the fraction bottoms out at 0, and no bail-out when the offset stops changing.
- **Impact**: Continuous main-thread work and battery drain in a long-lived desktop app for a visual that is no longer moving. Multiplied by every trigger row rendered with a ring.
- **Fix sketch**: Stop re-queuing once `currentRemaining <= 0`: write the final offset and `return` without scheduling the next frame (the `[remaining]` reset effect already restarts the loop when the parent recalculates — but that effect must also re-kick the animation, so either merge the two effects with `remaining` in deps of the animation effect, or set a `stopped` ref that the reset effect clears and re-arms). Alternatively, replace per-frame JS with a single CSS `stroke-dashoffset` transition of duration `remaining`s, eliminating rAF entirely.

## 2. TriggerListItem re-parses trigger config JSON on every render and passes a fresh object identity downstream

- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/triggers/sub_triggers/TriggerListItem.tsx:76
- **Scenario**: While a trigger row is expanded, every re-render of `TriggerListItem` (e.g. any `pipelineStore.triggerRateLimits` update, parent list re-render, store churn) executes `parseRawConfig(trigger.config)` inline in JSX — a `JSON.parse` per render — and hands `TriggerDetailDrawer` a brand-new `rawConfig` object each time.
- **Root cause**: The component already memoizes one parse for `rateLimit` (lines 38-41) but performs a second unmemoized parse for the `rawConfig` prop, and a third inside `handleRateLimitChange`. The new object identity per render defeats any `memo`/`useMemo` keyed on `rawConfig` inside the drawer subtree.
- **Impact**: Redundant JSON parsing plus guaranteed prop-identity churn into the (heaviest) expanded-drawer subtree — every store tick re-renders the whole drawer even when the config is unchanged.
- **Fix sketch**: Hoist a single `const rawConfig = useMemo(() => parseRawConfig(trigger.config), [trigger.config])`; derive `rateLimit` from it (`useMemo(() => extractRateLimit(rawConfig), [rawConfig])`), pass the memoized object to the drawer, and reuse it in `handleRateLimitChange` (spreading into a copy before mutating `rate_limit`).

## 3. Duplicated editable string-list widget in FileWatcherConfig and AppFocusConfig

- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/triggers/sub_triggers/configs/FileWatcherConfig.tsx:27-54 (dup: configs/AppFocusConfig.tsx:27-50)
- **Scenario**: Both config panels render the same "list of text inputs with per-row X remove button (hidden when length==1) + trailing Plus add button" structure — same immutable-update handlers, same layout classes, differing only in placeholder, accent color, and mono font.
- **Root cause**: The path-list editor was copy-pasted from one config to the other instead of being extracted; ~25 near-identical JSX lines each.
- **Impact**: Any fix (e.g. trimming empty rows, keying by index bugs when removing mid-list — both use `key={i}` which loses focus/state on removal, a latent shared bug) must be made twice and can drift. FileWatcher additionally threads validation-error clearing that AppFocus lacks, so the two are already diverging.
- **Fix sketch**: Extract a `StringListInput` component (props: `values`, `onChange`, `placeholder`, `addLabel`, `accentClass`, optional `onEdit` side-effect for error clearing) into `sub_triggers/configs/` next to `TriggerFieldGroup`, and use it in both panels. While extracting, switch to stable keys (or accept index keys but document it) in one place.

## 4. TriggerStatusSummary builds its summary from hardcoded English fragments, bypassing i18n used everywhere else in the feature

- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/features/triggers/sub_triggers/TriggerStatusSummary.tsx:19-40
- **Scenario**: The collapsed-row summary concatenates raw literals — `cron: …`, `every …`, `custom endpoint`, `webhook listener`, `from …` — while every sibling component in this context pulls strings through `useTranslation`. `TimezoneSelect` similarly hardcodes the `' (detected)'` suffix (TimezoneSelect.tsx:73) and already flags its placeholder as debt via `DebtText`.
- **Root cause**: Summary-fragment strings were never routed through the `t.triggers.*` catalog when the rest of the feature was internationalized.
- **Impact**: Non-English locales show mixed-language trigger rows; the strings are invisible to the translation-parity tooling this repo uses.
- **Fix sketch**: Add `t.triggers.summary.{cron,every,webhook_listener,custom_endpoint,from}` (and `t.common.detected`) catalog entries, convert the component to a hook-using function with `useTranslation`, and interpolate via the existing `tx` helper.

## 5. PendingTriggerApprovals per-item persona lookup scans the personas array per pending fire per render

- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: repeated-scan
- **File**: src/features/triggers/sub_triggers/PendingTriggerApprovals.tsx:21
- **Scenario**: `nameFor` runs `personas.find(...)` once per pending fire on every render, and the component re-renders every 20s poll tick (a fresh `pending` array from `setPending` even when contents are unchanged) plus on any `agentStore.personas` change.
- **Root cause**: Linear scan inside the row map with no memoized id→name map, combined with the poll always replacing state with a new array identity.
- **Impact**: Bounded (pending fires are few), but the unconditional 20s state replacement re-renders the banner subtree even when nothing changed; the find is O(personas × pending) each time.
- **Fix sketch**: Memoize `const nameById = useMemo(() => new Map(personas.map(p => [p.id, p.name])), [personas])`, and in `refresh` skip `setPending` when the fetched list is deep-equal (or compare joined ids) to the current one to avoid no-op re-renders on every poll.
