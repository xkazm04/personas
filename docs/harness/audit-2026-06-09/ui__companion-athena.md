# UI Perfectionist — companion-athena
> Total: 6
> Severity: 1 critical, 3 high, 1 medium, 1 low

## 1. Assistant replies and listening/thinking state are invisible to screen readers
- **Severity**: critical
- **Category**: accessibility
- **File**: src/features/plugins/companion/CompanionPanel.tsx:1752
- **Scenario**: A screen-reader user sends a message (or holds-to-talk). Athena's "Thinking…" status, the streamed reply that swaps into the bubble, the slow-progress hint, and the "now listening" dictation state are all painted silently. The user has no idea a reply arrived or that the mic is hot.
- **Root cause**: The scroll container (`flex-1 overflow-y-auto … companion-scroll`) and the streaming bubble (line ~1959) carry no `aria-live`/`role="status"`. A repo-wide grep confirms `aria-live` exists only in the orb layers (`orb/AthenaGuideLayer.tsx:33`, `orb/AthenaOrbLayer.tsx:167`) — never in the chat panel itself, which is the primary surface.
- **Impact**: inaccessible
- **Fix sketch**: Wrap the message list region (or add a dedicated visually-hidden mirror) with `aria-live="polite" aria-atomic="false"` so completed assistant turns are announced; give the streaming status line (`{streamingBeat ?? phaseLabel … ?? thinking}` at line 1963-1971) `role="status" aria-live="polite"`. Add an `aria-live="assertive"` `sr-only` region driven by `dictation.listening`/`talking` so "Listening…" and "Stopped listening" are spoken.

## 2. Voice/dictation errors are color-and-tooltip only — never readable
- **Severity**: high
- **Category**: missing-state
- **File**: src/features/plugins/companion/Composer.tsx:248
- **Scenario**: The user clicks the mic, the OS/browser denies permission (`error: 'not-allowed'`) or STT drops (`'network'`). The mic button merely turns amber and the only explanation hides inside the `title` tooltip. On a desktop touch/trackpad flow the user never hovers, so they just see a mic that "does nothing" — classic error-blindness for the most failure-prone control.
- **Root cause**: `useDictation` exposes a rich `error` code (line 31 of useDictation.ts), but Composer consumes it only to recolor the button and swap the `title` string (lines 256-271). There is no inline, persistent, readable message and no distinct copy for permission-denied vs network.
- **Impact**: error-blind
- **Fix sketch**: When `dictation.error` is set, render a small inline notice below the textarea (mirroring the existing rose `sendError` chip pattern at CompanionPanel.tsx:2078) with `role="alert"`, mapping `not-allowed` → a permission-help line and other codes → a generic retry line. Clear it on the next successful `start()`.

## 3. The Stop/interrupt control is hover-only — unreachable by keyboard and touch
- **Severity**: high
- **Category**: accessibility
- **File**: src/features/plugins/companion/CompanionPanel.tsx:1973
- **Scenario**: A turn is running long. To cancel it the user must mouse-hover the streaming bubble to reveal the floating Stop button — it is `opacity-0 group-hover:opacity-100`. Keyboard-only and touch/trackpad users (a desktop app, often used on laptops) can't discover or reach it; the only other stop affordance is buried in the orb decision flow.
- **Root cause**: The interrupt button relies solely on `group-hover` for visibility (`opacity-0 group-hover:opacity-100 focus:opacity-100`). `focus:opacity-100` only helps after it's already tab-reachable, but with zero opacity and no persistent affordance it reads as absent; there is no always-visible stop control anywhere in the composer region during streaming.
- **Impact**: inaccessible
- **Fix sketch**: Keep the bubble-corner button but also surface a persistent, always-visible Stop affordance during `streaming` (e.g. swap the Send button to a Stop/Square state, like most chat UIs, or pin a small Stop chip near the slow-progress hint). Ensure it is in tab order and labeled (the existing `aria-label={stop_turn}` is good).

## 4. Approve/reject + numbered-chip + busy-spinner button markup is duplicated across four components
- **Severity**: high
- **Category**: component-extraction
- **File**: src/features/plugins/companion/ApprovalCard.tsx:183
- **Scenario**: The same primary/secondary action-button pair (with `Loader2` spinner swap, `disabled:opacity-50 disabled:cursor-not-allowed`, `rounded-interactive` sizing) is hand-rolled in ApprovalCard (lines 183-208), ProactiveCard (lines 101-128), and the numbered-chip variant `[badge {i+1}] + truncate label` is duplicated between OrbDecisionBubble (lines 196-237) and QuickReplies (lines 42-58). Tints and paddings have already drifted (`p-3.5` vs `p-3`, primary vs foreground busy states), so cards look subtly inconsistent side by side.
- **Root cause**: No shared `<CardActionButton>` / `<NumberedChip>` primitive; each card re-implements the pattern, guaranteeing future drift.
- **Impact**: inconsistency
- **Fix sketch**: Extract a `CompanionActionButton` (variant: primary | ghost | danger; props: busy, icon, label) and a `NumberedChip` (digit badge + truncating label, danger flag) into the companion folder; refactor ApprovalCard, ProactiveCard, OrbDecisionBubble, and QuickReplies to consume them.

## 5. Decision/approval options carry no visual weight hierarchy
- **Severity**: medium
- **Category**: visual-hierarchy
- **File**: src/features/plugins/companion/orb/OrbDecisionBubble.tsx:195
- **Scenario**: When Athena surfaces a hands-free decision, every non-danger option renders with the identical `bg-primary/10 border-primary/20` chip (lines 203-218), and the "0 — Explain" option looks like just another peer chip. After the user picks "Explain", the recommendation banner appears but the option Athena actually recommends is not emphasized among the row — the user must re-read prose to map the advice back to a button.
- **Root cause**: All options share one style; there is no notion of a recommended/primary option versus alternatives, and `0/Explain` (a meta-action) is styled at the same altitude as real choices.
- **Impact**: confusion
- **Fix sketch**: Give the recommended option a filled primary treatment (or a small "Recommended" tag) once `explained` is set and the decision exposes a recommended key; visually demote `0/Explain` to a quieter, clearly-secondary affordance (it already uses `foreground/5`, but it sits inline with primary chips — separate it onto its own row or add a divider) so the real choices read as the main act.

## 6. Generic spinner/empty-state polish gaps: page loading label and the "no nudges" baseline
- **Severity**: low
- **Category**: missing-state
- **File**: src/features/plugins/companion/CompanionPanel.tsx:1810
- **Scenario**: The chat empty state is well handled by `WelcomeHero`, but two adjacent states are thinner: the lazy panel fallback (CompanionPluginPage.tsx:42-47) is a bare centered spinner with no skeleton of the panel chrome, and there is no distinct "all caught up — no nudges" affirmation when proactive is empty (the WelcomeHero only shows on a fully empty transcript at line 1810, so a returning user with history but zero nudges sees nothing acknowledging the quiet inbox).
- **Root cause**: The empty/loading states are handled per-branch with minimal treatment; the "no proactive nudges, but conversation exists" case has no positive empty affirmation.
- **Impact**: unpolished
- **Fix sketch**: Replace the plugin-page spinner with a lightweight skeleton matching the panel layout; optionally add a small, dismissible "You're all caught up" line in place of the proactive strip when `proactive.length === 0` and the transcript is non-empty, reusing the existing chip styling.
