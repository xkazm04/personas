# UI Perfectionist — persona-use-cases-parameters
> Total: 6
> Severity: 0 critical, 3 high, 2 medium, 1 low

## 1. Hardcoded English strings bypass the i18n layer in several in-scope components
- **Severity**: high
- **Category**: visual-consistency
- **File**: src/features/agents/sub_use_cases/components/schedule/SubscriptionList.tsx:15-20
- **Scenario**: A non-English user sees the rest of the Use Cases tab translated, but the subscription/trigger stage badges always read "active / paused / suggested / retired" in English. The same leak appears across the Event Rename modal and the Pause dialog — Cancel buttons, "Save aliases", "Saving…", `placeholder="alert"`/`"escalation"`, hand-built `consumer(s)` pluralization, plus "Never used"/"just now"/"5m ago" relative times in the connector picker.
- **Root cause**: These strings are literals in the markup/`STAGE_BADGE` map and `formatRelative`, not pulled from `t.agents.use_cases`. The codebase clearly has a translation table (every sibling component uses `useTranslation()` and `DebtText`), so this is an inconsistency, not a missing system.
- **Impact**: inconsistency
- **Fix sketch**: Route badge labels, modal button/placeholder text, the pluralized "consumer(s)" / "subscription(s)" strings, and the relative-time helper through `t.agents.use_cases.*` (add keys) or the existing `tx()` interpolation + a shared relative-time formatter. Concrete leaks: SubscriptionList.tsx:16-19; EventRenameModal.tsx:140,147,201,206,290,297; CapabilityDisableDialog.tsx:33-37,62,84; ConnectorDimCard.tsx:144,221-230.

## 2. Subscription/trigger row markup is duplicated three times instead of one shared row component
- **Severity**: high
- **Category**: component-extraction
- **File**: src/features/agents/sub_use_cases/components/schedule/SubscriptionList.tsx:36-62
- **Scenario**: `ActiveTriggers` (lines 36-62) and `ActiveSubscriptions` (lines 81-107) render an essentially identical `SectionCard` row — leading icon, `flex-1 min-w-0` title + truncated subtitle, stage badge, trash button. A near-identical third copy lives in UseCaseSubscriptions.tsx:83-130 (the suggested-subscription card). Any tweak to row spacing, the badge, or the delete affordance must be hand-applied in three places, and they already drift (the suggested card adds an "Activate" button + toggle the others lack).
- **Root cause**: No extracted `SubscriptionRow` primitive; each section re-implements the row inline with only the icon/color/trailing-controls varying.
- **Impact**: inconsistency
- **Fix sketch**: Extract a single `SubscriptionRow` (props: `icon`, `iconClass`, `title`, `subtitle?`, `badge?`, `trailing?: ReactNode`) and render all three call sites through it. Removes ~60 lines of duplicate JSX and guarantees the rows stay visually identical.

## 3. Most interactive controls have no visible focus state (keyboard users get no indicator)
- **Severity**: high
- **Category**: accessibility
- **File**: src/features/agents/sub_use_cases/components/detail/UseCaseFixtureDropdown.tsx:47-61
- **Scenario**: Tabbing through the Use Cases pipeline (Fixture / Channel / Model dropdown triggers, the Test / Run Now / Stop buttons, the dim cards in the detail view, the day/preset buttons in the scheduler) produces no visible focus ring — only hover styles change. A keyboard or screen-magnifier user cannot tell which control is focused. Only 7 of ~30 in-scope files apply any `focus`/`focus-visible`/`focus-ring` class; DayTimeGrid does it right (`focus-visible:ring-2`), the rest do not.
- **Root cause**: The shared button pattern in this folder was authored with `hover:`/`transition-colors` but no focus token. The project has a `focus-ring` utility (used in UseCaseSubscriptionForm.tsx:63) that simply was not applied consistently.
- **Impact**: inaccessible
- **Fix sketch**: Add the existing `focus-ring` (or `focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none`) utility to the trigger/action buttons in UseCaseFixtureDropdown, UseCaseChannelDropdown, UseCaseModelDropdown, UseCaseDetailPanel (Test/Stop/Run Now), and the DimCard buttons in UseCaseDetailExpanded.tsx. Ideally fold it into the repeated button class strings once they are extracted.

## 4. Icon-only delete buttons lack an accessible name
- **Severity**: medium
- **Category**: accessibility
- **File**: src/features/agents/sub_use_cases/components/schedule/SubscriptionList.tsx:54-59
- **Scenario**: The trash-can buttons that retire a trigger (SubscriptionList.tsx:54) and a subscription (line 99) render only a `<Trash2>` icon with no text and no `aria-label`/`title`, so a screen reader announces an unlabeled "button". The same gap exists on the suggested-subscription trash button (UseCaseSubscriptions.tsx:121-127). By contrast EventRenameModal's remove-row button does set a `title`, and the fixture delete sets `title` — so the pattern is known but applied unevenly.
- **Root cause**: Icon-only buttons were added without an `aria-label`; reliance on visual recognition only.
- **Impact**: inaccessible
- **Fix sketch**: Add `aria-label={t.agents.use_cases.retire_subscription}` (and a matching trigger key) to the three trash buttons; prefer `aria-label` over `title` for the accessible name on icon-only controls.

## 5. Two divergent "Test" runners give the primary run action two different visual weights
- **Severity**: medium
- **Category**: visual-hierarchy
- **File**: src/features/agents/sub_use_cases/components/core/UseCaseTestRunner.tsx:174-180
- **Scenario**: `UseCaseTestRunner` renders the Test action as a full-width, gradient `from-primary to-accent` shadowed button (a clear primary), while the actively-used `UseCaseDetailPanel` renders Test as a small, low-emphasis `bg-primary/10` pill sitting in a crowded row beside Run Now / Stop / Tests (lines 112-119). The user meets two visually unequal treatments of the same "run a test" concept, and in the panel the true primary action (Run Now, which spawns a real run and costs money) is styled almost identically to the cheaper Test.
- **Root cause**: Two parallel runner implementations with independently chosen emphasis; no single source of truth for which run action is primary.
- **Impact**: confusion
- **Fix sketch**: Decide one emphasis hierarchy — e.g. in the panel make the destructive/expensive "Run Now" the visually dominant action and keep Test secondary, or consolidate onto one runner component. At minimum align the button tier styling between the two so "Test" reads the same everywhere.

## 6. Ad-hoc Tailwind sizing/color used instead of the typography + color tokens
- **Severity**: low
- **Category**: visual-consistency
- **File**: src/features/agents/sub_use_cases/components/schedule/ScheduleBuilder.tsx:129
- **Scenario**: The "this schedule will run …" hint uses `className="text-sm text-muted-foreground/70"` — the only place in the entire in-scope folder using raw `text-sm` / `text-muted-foreground`. Every sibling line uses the `typo-body` / `typo-caption` scale and `text-foreground`, so this single line renders at a subtly different size/weight/color than the surrounding scheduler copy.
- **Root cause**: One line escaped the token migration; it predates or was missed by the `typo-*` rollout.
- **Impact**: inconsistency
- **Fix sketch**: Replace with `className="typo-body text-foreground"` (or `typo-caption` to match the adjacent hint scale) so it tracks the design tokens used everywhere else in the file.
