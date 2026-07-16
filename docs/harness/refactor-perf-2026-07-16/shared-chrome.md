# shared/chrome — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 1 high / 4 medium / 1 low)
> Context group: Shared UI & Design System | Files read: 29 | Missing: 2

## 1. Toast auto-dismiss RAF timer duplicated verbatim in both toast items
- **Severity**: High
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/shared/chrome/ToastContainer.tsx:81 (and :205)
- **Scenario**: `StandardToastItem` (lines 50–110) and `HealingToastItem` (lines 197–234) carry the exact same ~35-line block: `paused`/`pausedRef`/`elapsedRef`/`lastTickRef` state, the RAF `tick` loop with pause accounting, the once-per-second elapsed-label update, and the visibility gating. Any fix to the timer (e.g. the pause/resume drift on `mouseleave`, or a battery-friendly interval swap) must be applied twice or the two toast kinds silently diverge.
- **Root cause**: HealingToastItem was created by copy-pasting StandardToastItem's timer instead of extracting the shared behavior.
- **Impact**: Real maintenance hazard on a hot, always-mounted surface (every toast in the app runs this loop); double the code to audit for the earlier RAF/pause bugs this file has already been through.
- **Fix sketch**: Extract a `useToastTimer(toast, onDismiss)` hook returning `{ elapsedLabel, isPaused, setPaused }` (it already only depends on `toast.duration/id/timestamp`, `onDismiss`, and document visibility). Both items become pure markup consumers. The `onMouseEnter/onMouseLeave` handlers and `lastTickRef` reset move into the hook's returned handlers.

## 2. Fleet strip's shared pulse animation runs forever, even when the fleet is idle
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: idle-animation
- **File**: src/features/shared/chrome/FleetActivityStrip.tsx:60
- **Scenario**: `animate(pulseOpacity, [0.45, 1, 0.45], { repeat: Infinity })` is started unconditionally on mount (unless reduced motion). When zero executions are running — the overwhelmingly common state — no bar reads `pulseOpacity`, yet framer-motion keeps ticking the animation every frame for the lifetime of the app, since the strip is always-mounted chrome.
- **Root cause**: The effect gates on `prefersReducedMotion` only; it doesn't consider whether any `running` slot actually consumes the MotionValue.
- **Impact**: A permanent per-frame animation callback on an idle desktop app — needless CPU wakeups/battery drain that the strip's own design notes (tick "only while the readout is open", reap "without a permanent timer") show the file otherwise avoids.
- **Fix sketch**: Add `running > 0` to the effect condition and dependency list: start the loop only while at least one bar is running, stop (and `pulseOpacity.set(1)`) when the fleet drains. Bars joining later already share the phase because the MotionValue persists.

## 3. CommandPalette rescoring does an O(n²) `personas.find` per keystroke
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: quadratic-scan
- **File**: src/features/shared/chrome/CommandPalette.tsx:270
- **Scenario**: In the `items` memo, `agentItems.map(item => personas.find(pp => \`agent:${pp.id}\` === item.id)!)` runs a linear scan (plus a string allocation per comparison) for every agent item, on every deferred keystroke. With N personas that's O(n²) string-building work per keypress; the credential/template/automation blocks below it avoid this by index-pairing.
- **Root cause**: `agentItem()` discards the source persona, so stage 2 has to re-derive it from the id by scanning the array.
- **Impact**: Bounded but real typing latency in the palette as the persona count grows (this app targets fleets of agents); it is the single hottest per-keystroke loop in the file.
- **Fix sketch**: In the `stableItems` memo, keep the pairing: build `agentItems` as `personas.map(p => ({ persona: p, item: agentItem(...) }))` or zip by index like the credentials block (`agentItems[i]` ↔ `personas[i]` are already order-aligned). Score against the carried persona directly; no `find`, no template-string churn.

## 4. Palette item lists are rebuilt on every store change while the palette is closed
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/shared/chrome/CommandPalette.tsx:178
- **Scenario**: CommandPalette is mounted app-wide and renders `null` until opened, but its hooks always run. The `stableItems` memo builds ~6 items per persona (entity item + 5 agent-action items, each allocating JSX icon nodes) plus credential/template/automation/nav items, and it recomputes whenever `personas`, `credentials`, `recipes`, `automations`, or translations change — e.g. every `fetchPersonas` refresh or persona toggle — even though the palette is closed 99% of the time.
- **Root cause**: The memo pipeline isn't gated on `open`; the component subscribes to five stores and eagerly materializes the full result set so it's ready before the palette is ever summoned.
- **Impact**: O(6·N) object/JSX allocation on background store updates in always-mounted chrome; grows linearly with fleet size and runs during unrelated activity (executions updating persona lists).
- **Fix sketch**: Short-circuit the heavy memos when closed: `if (!open) return EMPTY_STABLE_ITEMS;` inside `stableItems` (with `open` in deps) — reopening recomputes once, which is when the data is actually needed. Alternatively split the item-building into a child component rendered only when `open`.

## 5. Click-outside popover effect duplicated four times across footer/breadcrumb
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/shared/chrome/DesktopFooter.tsx:38 (also :122, :351; BreadcrumbTrail.tsx:40)
- **Scenario**: `AccountFooterIcon`, `ThemeFooterIcon`, and `ProjectPickerFooterIcon` in DesktopFooter, plus `EllipsisDropdown` in BreadcrumbTrail, each hand-roll the identical `useEffect` — `if (!open) return; mousedown listener; ref.contains check; setOpen(false)` — 8 lines × 4 copies in this context alone.
- **Root cause**: No shared `useClickOutside` hook; each popover re-implements the dismissal contract inline.
- **Impact**: Pure repetition that invites drift (e.g. one copy later needing `touchstart`/Escape support gets fixed, three don't); every new footer popover adds a fifth copy.
- **Fix sketch**: Add `useClickOutside(ref, onOutside, enabled)` to `src/hooks/utility/interaction/` and replace the four effects with one-liners. Verify whether other contexts have the same inline pattern before naming, so they can migrate to the same hook later.

## 6. Stale pre-move `silentCatch` keys reference the old components/layout path
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/features/shared/chrome/DesktopFooter.tsx:268 (also Sidebar.tsx:29, SystemLoadFooterIcon.tsx:81)
- **Scenario**: Error-funnel keys still say `features/shared/components/layout/DesktopFooter:catch1`, `features/shared/components/layout/sidebar/Sidebar:catch1`, and `features/shared/components/layout/SystemLoadFooterIcon:poll`, but these files live under `features/shared/chrome/`. Anyone tracing a logged silent-catch back to source greps the wrong directory.
- **Root cause**: Files were relocated from `components/layout/` to `chrome/` without updating the embedded path strings.
- **Impact**: Misleading diagnostics only — no runtime behavior change.
- **Fix sketch**: Update the three key strings to the `features/shared/chrome/...` paths. While there, the hand-drawn dismiss-X SVG duplicated in CliReadinessBanner.tsx:40 and UpdateBanner.tsx:103 can be replaced with the lucide `X` icon used everywhere else in this context.
