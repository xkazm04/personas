# Golden path — Dropdown and select

> Situation node: `ui-system/controls-and-forms/dropdown-and-select` · [situation spine](../situation-spine.md)
> Composed 2026-08-13 from a repo-wide ground-truth sweep (~35 direct tool calls
> plus three parallel corpus sweeps — the raw-`<select>` corpus, the hand-rolled
> anchored-menu corpus, and the keyboard/async-options corpus — 143 further tool
> calls), against `master` @ `2602d843b`.
> Dimensions: **ui · function · performance**. `twoSided: false`.
> Spine facts: `convergence: diverged`, `risk: high`, `recurrence: 110`.
> Every count below was produced by grep or by an AST-shaped scan over
> `src/**/*.tsx`, not estimated. `.claude/worktrees/**` excluded.
> The **Deviations** section is a fix backlog; it migrates to `violating` cells
> in `workspace_practice_context_state` when this path is ingested.

**This path absorbs two situations discovery recorded separately**, because
neither can be answered without answering this one:
`Anchored popovers` (recurrence 28, owner `forms/useAnchoredPortalPosition.ts`)
— every dropdown that opens near a viewport edge is the same problem — and
`Connector-sourced option list` (recurrence 4, owner
`adoption/useDynamicQuestionOptions.ts`) — a select whose options arrive from a
fetch. Where a popover is *not* a pick-one control (context menu, tooltip,
hover card, inline confirm) it belongs to the overlays concern and to
[`modals.md`](./modals.md); this path still states the positioning contract
because there is exactly one positioning primitive and it lives in `forms/`.

**Adjacent leaves — cross-reference, do not absorb.**
[`form-field-and-validation.md`](./form-field-and-validation.md) owns the
label/error/validation wrapper; its **Gaps #3** is *blocked on this document*
and § **Gaps #1** below is the unblocking fix. [`tables.md`](./tables.md) owns
`UnifiedTable` — but its per-column filter menu is one of the six parallel
dropdown implementations catalogued here. [`modals.md`](./modals.md) owns the
z-index stack this path's portals must clear. `PillGroup` / `SegmentedTabs` /
`TriggerTypeSelector` are pick-one controls that are **not** dropdowns; they
belong to a tab-strip/segmented leaf, along with `useRovingTabIndex` (see
§ Gaps #8).

---

## Trigger

- "Add a dropdown so the user can pick a persona / project / credential / model here."
- "This select looks wrong in dark mode" / "the options are white on white."
- "The dropdown is cut off by the panel / renders behind the modal."
- "It opens downward at the bottom of the screen and I can't see the options."
- "Let the user search this list — there are too many options to scroll."
- "Populate this picker from their connected GitHub / Slack account."
- "Why can't I use the keyboard in this dropdown?"

If you are about to type `<select`, `<option`, `useState(false)` named `open` /
`isOpen` / `showMenu`, `absolute top-full`, `document.addEventListener('mousedown'`,
`getBoundingClientRect()` to place a menu, `role="listbox"`, `role="menu"`,
`aria-haspopup`, or a `z-[…]` literal on a floating panel — you are in this
situation.

---

## The one way

Render every pick-one control as **`forms/ThemedSelect` in its default *native*
mode** — a real `<select>` carrying `[&>option]:bg-background
[&>option]:text-foreground`, `appearance-none` and a drawn chevron. It costs no
JavaScript and it hands you, unremovably, the things this repo has never once
built by hand: letter type-ahead, `Home`/`End`/`PageUp`/`PageDown`, `Escape`,
arrow navigation, and the platform's own screen-reader mapping. It forwards
`{...rest}` to the `<select>`, so `id`, `aria-invalid`, `aria-describedby`,
`required`, `disabled` and `onBlur` all land — which makes it the **only** select
in the repo that can sit inside `FormField`. Escalate to
**`<ThemedSelect filterable>`** only when a plain text option genuinely cannot
express the choice — option rows need icons or secondary descriptions, or the
list is long enough that scrolling it is worse than typing — and know exactly
what you are buying it with: the `filterable` branch accepts **8** of
`SelectHTMLAttributes`' props and silently drops every other one, and it has
**zero** key handlers and **zero** ARIA roles, so it is a mouse-only control.
Pass it `options`, `value`, `onValueChange`, a translated `aria-label`, a
translated `placeholder`, and `hideSearch` when the list is short. Reach for
**`forms/Listbox`** when the trigger is not a select — a toolbar button, a chip,
a table cell, a multi-select — or when option rows are arbitrary JSX; it is the
only primitive with real keyboard navigation, but that navigation is gated on
`itemCount`, so passing it is not optional, and you owe the rows their
`role="option"` + `aria-selected` and the trigger its `aria-expanded` +
`aria-haspopup="listbox"`. If you portal, position with
`useAnchoredPortalPosition(ref, open, { flip: true })` — never a hand-rolled
`getBoundingClientRect`, and never `useViewportClampAbsolute`, which measures
once on open and is stale the moment anything scrolls. Then stop: no raw
`<select>`, no new `useState(open)` + `absolute top-full` + `mousedown` listener,
no `z-[…]` literal you invented, no `ColumnDropdownFilter` in new code.

---

## Mandated primitives

- **`src/features/shared/components/forms/ThemedSelect.tsx`** (282 lines) —
  `ThemedSelect` + `ThemedSelectProps` + `ThemedSelectOption`. **Two components
  behind one name.** *Native mode* (`:253-277`): the real `<select>`, option
  theming at `:263`, `{...rest}` spread at `:271`, drawn chevron at `:275`.
  *Filterable mode* (`FilterableSelect`, `:68-225`): portal to `document.body`
  at `:162`, `z-[10200]` to clear portal-mode `BaseModal` (`:165-167`),
  flip-aware position via `useAnchoredPortalPosition(…, { flip: true,
  maxMenuHeight: 220 })` at `:96`, debounced filter at `:119`, `highlightMatch`
  at `:215`, icon support via `OptionIcon` at `:42`, `hideSearch` at `:177`.
  The two modes have **opposite** accessibility profiles — see Gaps #1.
- **`.../forms/Listbox.tsx`** (233 lines) — `Listbox` with `renderTrigger` +
  render-prop `children({ close, focusIndex, query })`. `role="listbox"` +
  `aria-label` on the menu (`:206`, `:219`), `ArrowUp`/`ArrowDown`/`Enter`/
  `Escape` at `:134-154` **gated on `itemCount != null`** (`:135`), `portal`
  mode at `:199-212`, `searchable` type-ahead header at `:157-181` with an
  `aria-live` result count at `:184-188`, click-outside for both portal
  (`:92-103`) and inline (`:105`) paths.
- **`.../forms/useAnchoredPortalPosition.ts`** (67 lines) — the repo's only
  flip-aware anchoring hook. `{ flip, maxMenuHeight, gap, bottomMargin }` →
  `{ top, left, width, flipUp }`. Flip decision at `:46-47`; recomputes on
  capture-phase `scroll` + `resize` while open (`:57-58`). **3 importers.**
- **`@/hooks/utility/interaction/useClickOutside`** — the sanctioned dismissal
  hook. 11 consumers, against 46 inline `document.addEventListener('mousedown')`
  re-implementations in 43 files.
- **`templates/sub_generated/adoption/useDynamicQuestionOptions.ts`** — the
  contract for connector-sourced options. `DynamicOptionState { loading, ready,
  error, errorKind: 'no_credential' | 'fetch_failed' | null, items,
  waitingOnParent }` + `retry(id)` (`:12-31`). Sequence-guarded against late
  responses (`requestIdRef`, `:81`), fingerprint-gated refetch (`:87`) so an
  unrelated keystroke does not re-issue every discovery call, `depends_on`
  chaining. **Copy this state shape even when you don't use this hook** — the
  `errorKind` split is load-bearing: `no_credential` must not offer Retry.
- **`@/i18n/useTranslation`** — every `placeholder`, `aria-label`, `ariaLabel`,
  `searchPlaceholder` and option `label` is `t.section.key`.

**Not primitives — do not extend, do not copy.** `forms/ColumnDropdownFilter.tsx`
(6 consumers; zero ARIA attributes and zero key handlers in 92 lines) and the
inline column-filter menu inside `display/UnifiedTable.tsx:374-380`. Both are
listed as deviations below despite living in `shared/`.

---

## Steps

1. **Count your options and ask what a row must show.** Text-only and bounded →
   native mode, and you are done after step 3. Icons, descriptions, or a list
   long enough to need search → `filterable`. Trigger isn't a select, or rows are
   custom JSX → `Listbox`.
2. **Native mode: `<ThemedSelect id={fieldId} value={v} onChange={…}>` with
   `<option>` children.** Give it an `id` and point a `<label htmlFor>` at it —
   or better, render it inside `FormField`'s render-prop and spread
   `{...inputProps}`; it is the only select that accepts them.
   `FieldCaptureRow.tsx:96` is the proof and the shape to copy.
3. **Translate the `<option>` labels and stop.** No `onKeyDown`, no `role`, no
   click-outside, no portal. The browser owns all of it.
4. **Filterable mode: pass `options` from a `useMemo`, never an inline `.map()`.**
   `FilterableSelect` memoises the filtered list on `[options, debouncedQuery]`
   (`:121-125`); a fresh array literal per render defeats it and re-renders every
   option row. 14 call sites do this today.
5. **Filterable mode: always pass `aria-label` and `placeholder`, both
   translated.** Neither has a safe default — the trigger's only accessible name
   *is* `aria-label` (`:151`), and `placeholder` falls back to the hardcoded
   English `'Select...'` (`:72`).
6. **Set `hideSearch` on short lists, and prefer deriving it.**
   `hideSearch={options.length < 8}` (`KnowledgeTree.tsx:414`) beats a static
   `hideSearch`, because a list that grows gets its search back automatically.
   Pick one threshold and reuse it — three thresholds ship today (8, 8, 6).
7. **`Listbox`: pass `itemCount` — arrow keys *and* Escape are gated on it.**
   In `searchable` mode pass the **filtered** length. Then `onSelectFocused`, a
   translated `ariaLabel`, `role="option"` + `aria-selected` on every row,
   `aria-expanded` + `aria-haspopup="listbox"` on the trigger, and `portal` if
   any ancestor scrolls or clips. `CredentialPicker.tsx` does all of this in 99
   lines.
8. **If you portal anything, use `useAnchoredPortalPosition`.** `{ flip: true }`
   for a menu that could open near the bottom edge. Do not invent a z-index:
   9990 (Listbox) and 10200 (ThemedSelect, which clears
   `Z_INDEX_PORTAL_BASE = 10000` from `BaseModal.tsx:9`) are the two sanctioned
   layers, and anything you add must be reconciled against them — `Tooltip.tsx:315`
   sits at `z-[9999]`, i.e. *above* a portalled `Listbox` and *below* a
   `ThemedSelect`.
9. **Options from a fetch: render three states, not one.** Loading, failed, and
   settled-empty are three different sentences. Model the state on
   `DynamicOptionState`, split `no_credential` from `fetch_failed`, and offer
   Retry only for the latter. `CodebaseProjectPicker.tsx:105-142` is the
   reference — and its own comment (`:39-43`) records why: when loading-failure
   and genuinely-empty rendered the same screen, users re-created projects they
   already had.
10. **Translate everything, then run `npm run check:i18n:strict`.** New keys go
    into `src/i18n/locales/en.json` and into all 13 other locales in the same
    commit.
11. **Stop.** No `<select>`, no `absolute top-full`, no `mousedown` listener, no
    `getBoundingClientRect`, no new `z-[…]`, no fourth shared dropdown.

---

## Anti-patterns

- **A raw `<select>` — the repo's dominant idiom and its most visible defect.**
  **63 raw `<select>` elements across 46 files, and `[&>option]:bg-background`
  appears exactly once in all of `src/` — inside `ThemedSelect`.** So every one
  of the 63 renders a Chromium-default option popup: white rows, system font,
  system highlight, inside a dark app. The fix is a *rename*: `ThemedSelect`
  extends `SelectHTMLAttributes<HTMLSelectElement>` and renders `children`, so
  `<select …>` → `<ThemedSelect …>` is prop-for-prop identical. There is no
  ergonomic argument for the raw element and no migration cost.
- **Reaching for `filterable` because it is "the nicer one".** It is the mode
  with **no `onKeyDown` anywhere in the file** — no arrows, no `Enter`, no
  `Escape` — and no `role="listbox"`, `role="option"`, `aria-selected`,
  `aria-expanded`, `aria-haspopup` or `aria-activedescendant`. Its options are
  portalled to the end of `document.body`, so even Tab does not reach them from
  the trigger. With `hideSearch` nothing is focused on open at all. **36 call
  sites are keyboard-unusable**, and the hypothesis that `filterable hideSearch`
  is the good default for short lists is exactly backwards: for a short text-only
  list, native mode already gives you themed options *and* the keyboard.
- **Passing `id` / `aria-invalid` / `aria-describedby` / `required` to a
  `filterable` select.** It type-checks — `ThemedSelectProps extends
  SelectHTMLAttributes<HTMLSelectElement>` — and then `FilterableSelect`'s
  `Pick<…>` at `:78-89` takes 8 props and the rest are silently discarded at
  `:239-249`. This is the single most dangerous line in the leaf: the type
  signature promises the full native contract and the implementation honours 3%
  of it, with no error, no warning, and no test.
- **A new `useState(false)` + `absolute top-full` + `document.addEventListener('mousedown')`.**
  **33 `absolute top-full` menus and 46 inline `mousedown` listeners across 43
  files**, against 11 `useClickOutside` consumers. Each one re-decides
  dismissal, stacking and edge behaviour, and each one gets a different answer.
- **Inventing a z-index.** Nine distinct literals are in play on floating menus
  — `z-20`, `z-30`, `z-40`, `z-50`, `z-[100]`, `z-[121]`, `zIndex: 100`,
  `zIndex: 9999`, `z-[9995]`/`z-[9996]`/`z-[9999]` — plus the primitives' 9990
  and 10200. `Design.md:166` declares `.glass-sm` as the "z-10 dropdowns"
  surface. Nothing in the app is at z-10.
- **A non-portalled menu inside a scrollable or `overflow-hidden` ancestor.**
  `UnifiedTable.tsx:375` (`z-50`, absolute) opens inside a table root that is
  `overflow-hidden` with an `overflow-y-auto` body, and `ColumnDropdownFilter.tsx:73`
  (`z-[100]`, absolute) is used in exactly those headers. Both are in
  `shared/components/`. `ProjectManagerParts.tsx:36-40` documents this precise
  bug and its portal fix — in a different file.
- **Clamping instead of flipping at the viewport edge.**
  `useViewportClampAbsolute` (`useViewportClamp.ts:73`) nudges the menu back
  inside with a `translate()` measured **once** in a single `requestAnimationFrame`
  on open, with **no scroll or resize listener** — so it is stale after any
  scroll, and near the bottom it slides the menu over its own trigger instead of
  flipping above it. 4 adopters. `useAnchoredPortalPosition` flips and tracks;
  3 adopters. Ten more menus hardcode `bottom-full` (always up), which breaks at
  the viewport *top* instead.
- **A `Listbox` without `itemCount`.** The whole keydown effect returns early at
  `:135`, so the menu has no arrow navigation **and no `Escape`**. 3 of the 13
  call sites — `AddChannelButton.tsx`, `UseCaseChannelDropdown.tsx`,
  `RemoteInstructionComposer.tsx` — are in this state and look correct at a
  glance because they still carry `role="option"`.
- **An option list built inline in the JSX.** `options={personas.map(…)}`
  (14 sites) creates a new array every parent render. The worst is
  `AutomationTriggerStep.tsx:188` — `githubRepos.map(…)` — where the list is
  connector-sourced and unbounded, so a user with 500 repositories re-creates and
  re-renders 500 option buttons on every keystroke elsewhere in the form.
  `FilterableSelect` does not virtualize; `max-h-48 overflow-y-auto` at `:192`
  renders every filtered row.
- **Treating an empty option list as one state.** `PollingConfig.tsx:22` hides
  the entire field when `credentialEventsList.length === 0`, so a connector that
  returned nothing, a fetch that failed, and a fetch still in flight are all
  rendered as *the control does not exist*. `LifecycleProjectPicker.tsx:44-55`
  is the mirror image — it flashes "create a project" on every mount while the
  fetch is running, and renders the identical CTA when the fire-and-forget
  `fetchProjects()` (`:31`, no `.catch`) fails.
- **Hardcoded English in the control.** `ThemedSelect.tsx:72`
  (`placeholder = 'Select...'`) is the `CharBudget` case for this leaf: an
  English string inside a shared primitive, so it is untranslated on every
  *correct* adoption. 10 filterable call sites rely on it. Then 8 hardcoded
  `aria-label="…"` strings in `AddKpiModal`/`addKpiPrimitives`, and 2 hardcoded
  `ariaLabel` on `Listbox` (`ArenaPanelColosseum.tsx:570` `"Select use case"`,
  `DevToolsProjectDropdown.tsx:88` `"Select DevTools project"`).
- **Overriding the select's radius at the call site.** Five select radii ship
  today: `rounded-xl` (ThemedSelect's own default, `:136`/`:259`),
  `rounded-modal` (`PollingConfig.tsx:30`, `FieldCaptureRow.tsx:96`,
  `TimezoneSelect.tsx:64`, `ModelDropdown.tsx:35`), `rounded-md`
  (`DataGrid.tsx:475`), `rounded-card` (`research-lab/shared/FormField.tsx:3`),
  and `rounded-input` — the one `Design.md:216` actually assigns to
  "Inputs, selects, textareas" — which **no select in the repo uses**.

---

## Evidence

**Adoption, measured.** `<ThemedSelect>` — **77 usages across 44 files** (41
native, 36 filterable); 48 files import it. `<Listbox>` — **13 usages across 13
files**.
`ColumnDropdownFilter` — 6. Raw `<select>` — **63 across 46 files**. Hand-rolled
anchored menus — **76 across ~74 files**.

**The doctrine points at the minority primitive.** `.claude/Design.md:301-302`,
`.claude/CLAUDE.md`'s reuse table, `docs/refactor/shared-component-reuse.md:30`
and `CATALOG.md:118` all say *dropdown → `forms/Listbox`*. Listbox has 13 call
sites. `ThemedSelect` has 77 — and its `CATALOG.md:128` entry reads
*"Extra wrapper classes (width, margin, etc."*, a truncated fragment of the
`wrapperClassName` prop comment at `ThemedSelect.tsx:20`, because the file has no
`@catalog` tag. **The primitive the repo actually uses is the one the repo has
never described.**

- **`vault/sub_credentials/components/forms/FieldCaptureRow.tsx:96` — the ONE
  site to copy for native mode.** It passes `id`, `aria-invalid`,
  `aria-describedby`, `onBlur` and `disabled` to a `<ThemedSelect>` and every one
  reaches the DOM `<select>`. It is simultaneous proof that native mode satisfies
  `FormField`'s contract and that `filterable` cannot. (The irony is worth
  naming: this is the best select call site in the repo and it lives inside
  `FieldCaptureRow`, which `form-field-and-validation.md` lists as one of the 19
  shadow field wrappers.)
- **`agents/sub_connectors/components/connectors/CredentialPicker.tsx` — the ONE
  site to copy for `Listbox`.** 99 lines, zero key handlers of its own, and it
  gets arrows/Enter/Escape free: `ariaLabel` translated (`:37`), `itemCount`
  correctly counting the synthetic "None" row (`:38`), `onSelectFocused` mapping
  the index back across that offset (`:31-34`), `aria-expanded` +
  `aria-haspopup="listbox"` on the trigger (`:44-45`), `role="option"` +
  `aria-selected` on both the None row and every credential (`:65`, `:79`),
  `focusIndex` reflected visually, and an empty-state row. Its one gap is no
  `portal`.
- **`agents/sub_design/components/parameterEditing.tsx:204-219` — the reference
  for choosing `filterable`,** and the only site that writes down why (`:208-210`,
  citing CATALOG.md). It passes `aria-label={param.label}` from the schema. It
  is missing a `placeholder`.
- `teams/sub_teamWorkspace/teamStudio/slackBridge/SlackBridgePickers.tsx:67,78` —
  the reference for the **derived** `hideSearch` threshold
  (`credentials.length < 6`). Same idea at `KnowledgeTree.tsx:414` and
  `GoalsMissions.tsx:238` with a threshold of 8. Pick one.
- **`vault/sub_catalog/components/forms/CodebaseProjectPicker.tsx:105-142` — the
  ONE site to copy for connector-sourced options.** Three genuinely distinct
  screens: spinner while loading, an error screen with the message and a **Retry**
  button, and a settled-empty screen with a "Go to Dev Tools" CTA. `:39-43`
  records the incident that produced the split.
- `shared/components/forms/TableSelector.tsx:107-130` — the most complete state
  machine in the leaf: loading, error, *and two distinct empties* (no tables at
  all vs filter matched nothing). **It has zero consumers.**
- `templates/sub_generated/adoption/useDynamicQuestionOptions.ts:12-31` — the
  `errorKind` contract. `no_credential` hides Retry because retrying re-fires the
  same empty vault lookup.
- `plugins/dev-tools/sub_projects/ProjectManagerParts.tsx:13,41,76` — the third
  and only feature-level adopter of `useAnchoredPortalPosition`, and `:36-40`
  documents the clipping bug that forced it.
- `shared/components/forms/ThemedSelect.tsx:165-167` — the z-index reasoning that
  every hand-rolled menu skipped, written down in three lines.

**Tests: none.** `forms/__tests__/` contains `ChatInputBar`, `FormErrorSummary`,
`NumberStepper`, `Slider` and `useAsyncFieldValidation`. There is **no test for
`ThemedSelect`, `Listbox`, `ColumnDropdownFilter` or `useAnchoredPortalPosition`**
— the prop-drop, the `itemCount` gate, the flip decision and the option theming
are all uncovered.

---

## Deviations found

**Totals by category.** D1 · 6 parallel implementations in `shared/`. D2 · 63
raw `<select>` in 46 files. D3 · 76 hand-rolled anchored menus. D4 · 36
filterable call sites, 24 with no accessible name. D5 · 34 of 41 native call
sites with no accessible name. D6 · 3 of 13 `Listbox` call sites keyboard-dead.
D7 · 15 connector-sourced pickers, 3 correct. D8 · 14 unmemoized option arrays.
D9 · 9 z literals, 5 select radii, 3 shadow tiers. D10 · 11 hardcoded strings,
one of them inside a shared primitive.

### D1 — six parallel pick-one implementations inside `src/features/shared/` (fix first)

This is upstream of everything below. A developer consulting the catalog is not
choosing between "the primitive" and "hand-rolling"; they are choosing among six
shared answers, of which the catalog describes one correctly.

| Path | What it is | Keyboard | ARIA | Position | z |
|---|---|---|---|---|---|
| `forms/ThemedSelect.tsx:253` | native `<select>` + option theming | **full (browser)** | **full (browser)** | browser | n/a |
| `forms/ThemedSelect.tsx:68` | `FilterableSelect` portal menu | **none** | `aria-label` only | `useAnchoredPortalPosition` + flip | `z-[10200]` |
| `forms/Listbox.tsx:65` | render-prop listbox | ↑↓ Enter Esc, **gated on `itemCount`**; no Home/End, no typeahead, no `aria-activedescendant` | `role="listbox"` + caller-supplied rows | `useAnchoredPortalPosition`, **no flip** (`:108`) | 9990 / `z-50` |
| `forms/ColumnDropdownFilter.tsx:30` | column filter menu | **none** | **none** — zero `role`/`aria-*` in 92 lines | `absolute top-full` | `z-[100]` |
| `display/UnifiedTable.tsx:374` | inline column filter menu | **none** | **none** | `absolute top-full`, clipped by the table's own `overflow-hidden` | `z-50` |
| `display/DataGrid.tsx:465` | page-size raw `<select>` | full | `aria-label` | browser | n/a |

`DataGrid.tsx:475` additionally sets `appearance-auto` and `rounded-md` — the
shared layer shipping, in one folder, both `appearance-none` + custom chevron and
`appearance-auto` + native arrow, at two different radii.

### D2 — raw `<select>`: 63 elements across 46 files, 0 themed

`[&>option]` occurs **once** in `src/`. Files with more than one, worst first:

| Path | Selects | Note |
|---|---|---|
| `overview/sub_observability/components/AlertRulesPanel.tsx:73,83,112,122` | 4 | no `id`, no `aria-label`, no `htmlFor` on any; `:122` is persona-sourced |
| `plugins/dev-tools/sub_overview/OverviewParts.tsx:222,388,425,442` | 4 | all connector-sourced; `:425`/`:442` are the Sentry org/project chain |
| `agents/sub_activity/ActivityFilters.tsx:79,92,106` | 3 | all derived from loaded activity; `title=` used in place of a label |
| `agents/sub_deployment/components/cloud/CloudHistoryPanel.tsx:160,171,182` | 3 | `:160` persona-sourced |
| `settings/sub_network/components/ExposureManager.tsx:140,152,167` | 3 | sibling `<label>`s with no `htmlFor` |
| `settings/sub_byom/components/ByomRoutingRules.tsx:96,108` · `plugins/dev-tools/sub_triage/TriageRulesPanel.tsx:234,238` · `teams/sub_teamMemory/components/diff/DiffHeader.tsx:21,34` · `templates/sub_generated/generation/sources/CustomSourceView.tsx:106,116` · `agents/sub_deployment/components/cloud/CloudDeploymentsPanel.tsx:103,128` | 2 each | `CloudDeploymentsPanel` is the only pair with `id` + `htmlFor` on both |

The 10 multi-select files above hold 27 of the 63. The remaining 36 files hold
one each: `PersonaIconPickerModal.tsx:325` · `BuildSimulatePanel.tsx:207` ·
`CreateTriggerForm.tsx:53` · `compare/ModelDropdown.tsx:30` · `SystemTraceViewer.tsx:243` ·
`Gallery3D.tsx:183` · `GalleryPage.tsx:122` · `TextLane.tsx:110` · `VoiceoverButton.tsx:97` ·
`DeploymentHistoryTab.tsx:78` · `GitLabDeployModal.tsx:194` · `GitOpsVersionHistory.tsx:90` ·
`research-lab/shared/FormField.tsx:90` · `ReportPreviewDrawer.tsx:224` ·
`SchemaFieldBuilder.tsx:96` · `RecipeInputSection.tsx:125` · `AmbientContextPanel.tsx:427` ·
`ModelRoutingSection.tsx:86` · `SettingsHistoryTab.tsx:144` · `BundleExportDialog.tsx:431` ·
`WebhookSubscriptionsPanel.tsx:293` · `DataGrid.tsx:465` · `KpiProposalsPanel.tsx:190` ·
`MeasureSetupModal.tsx:194` · `AddTeamMemoryForm.tsx:85` · `MemoryRowDetail.tsx:79` ·
`QuickAddCredentialModal.tsx:365` · `PresetQuestionnaireForm.tsx:288` ·
`RateLimitControls.tsx:75` · `TimezoneSelect.tsx:61` · `TriggerScheduleConfig.tsx:241` ·
`RequestBuilder.tsx:71` · `McpToolInputForm.tsx:64` · `SearchTab.tsx:100` ·
`GatewayMembersModal.tsx:299` · `ImportSyncConfig.tsx:57`.

**Accessible naming across the 63:** 8 carry an `id`, 3 carry an `aria-label`,
and roughly **30 have no accessible name by any route** — no `id`, no
`aria-label`, no wrapping or associated `<label>`. `GitLabDeployModal.tsx` is the
sharpest single case: `:94` and `:111` are `<ThemedSelect id=…>` with proper
`htmlFor`, and `:194` in the same file is a raw `<select id="deploy-env">`.

### D3 — hand-rolled anchored menus: 76 sites

Roughly half are pick-one dropdowns that should be `ThemedSelect`/`Listbox`;
roughly half are context menus, popovers and hover cards that belong to the
overlays concern but share this leaf's positioning primitive. Grouped by defect:

**No dismissal at all (8)** — the menu can only be closed by selecting something:
`AutomationCardActions.tsx:43` · `FindingBadge.tsx:211` · `MemoriesPageDense.tsx:230`
· `ShareAgentButton.tsx:67` · `DeploymentFilters.tsx:58` · `TeamPublishButton.tsx:69`
· `PlaygroundHeader.tsx:166` · `ConversationComposer.tsx:162`. Plus
`FactoryBreadcrumb.tsx:62` (mouse-leave only) and `NodeContextMenu.tsx:32` (no Escape).

**Clipped by an `overflow` ancestor (4)** — `UnifiedTable.tsx:375` ·
`ColumnDropdownFilter.tsx:73` · `FindingBadge.tsx:211` (renders in table rows) ·
`AutomationCardActions.tsx:43`.

**Re-implementing `useAnchoredPortalPosition` with a raw `getBoundingClientRect` (12)**
— `PersonaOverviewFilterHeader.tsx:85` (portals, and **closes on scroll/resize
instead of repositioning**, `:64-79`) · `StudioTabBar.tsx:112` (hardcodes a 256px
clamp) · `FactoryBreadcrumb.tsx:44` · `WarningBadge.tsx:42` · `passportWidgets.tsx:174`
· `PassportActionsRow.tsx:183` · `improve/StandardsScan.tsx:29` · `improve/ImproveCell.tsx:56`
· `FactoryOverviewTab.tsx:266` · `FieldHint.tsx:27` · plus the two
`QuickEditPopover` callers (`CreateMemoryForm.tsx:19`, `ProjectPipelineView.tsx:151`).
The `passport/*` cluster shares an `anchorTip()` helper — a seventh anchoring
implementation, at `z-[9995]`/`z-[9996]`.

**Hardcoded `bottom-full` (always opens upward, breaks at the viewport top) (10)**
— `PopupColorPicker.tsx:56` · `FleetFooterPopover.tsx:54` · `SwitcherBreadcrumb.tsx:80`
· `DesktopFooter.tsx:117,181` · `InlineConfirm.tsx:40` · `ConversationComposer.tsx:162`
· `StationPicker.tsx:186` · `VolumePopover.tsx:47` · `NowPlayingCard.tsx:91`.

**Genuine pick-one dropdowns that should be a primitive (representative)** —
`PersonaSelector.tsx:97` (has a search input, no keyboard) ·
`UseCaseFixtureDropdown.tsx:66` · `ProjectFilter.tsx:55` · `SortDropdown.tsx:44` ·
`ConnectorFilterDropdown.tsx:86` · `ComponentFilterDropdown.tsx:91` ·
`AdminToolsDropdown.tsx:44` · `MoveToWorkspaceButton.tsx:53` · `BreadcrumbTrail.tsx:61`
· `PersonaOverviewBatchBar.tsx:108` · `ConversationSwitcher.tsx:149` ·
`GitHubRepoSelector.tsx:214` · `ScheduleRow.tsx:265` · `TeamToolbar.tsx:67` ·
`teamStudioShared.tsx:181` · `WorkspaceEditMenu.tsx:50` · `ExtractionMenu.tsx:345` ·
`DriveToolbar.tsx:447` · `CompanionToolbar.tsx:453` · `StationPicker.tsx:186`.

**ARIA census across all of them.** `role="listbox"` 6 · `role="menu"` 6 ·
`role="option"` 18 · `role="menuitem"` 10 · `role="combobox"` 2 ·
`aria-haspopup` 10 (one invalid: `ColorRow.tsx:45` uses `"true"`).
`Listbox` never emits `role="menu"`/`menuitem`, so **all 16 of those are
hand-rolled**. Only **4 hand-rolled menus have arrow-key navigation**:
`TwinPicker.tsx:160-182` (the best of them — arrows, Enter, Escape,
`scrollIntoView`, `aria-selected`), `CommandPalette.tsx:360`,
`SearchAutocomplete.tsx:95`, `FabricSearch.tsx:65`.

### D4 / D5 — accessible naming at the primitive's own call sites

`aria-label` is absent from **62 of 77** `<ThemedSelect>` usages.

- **Filterable with no accessible name (24)** — the trigger is a bare `<button>`
  whose only name would have been `aria-label`, so these announce as *"button"*:
  `AutomationTriggerStep.tsx:186` · `AnnotateModal.tsx:49,61` ·
  `CreatePracticeModal.tsx:76,113` · `LifecycleProjectPicker.tsx:69` ·
  `matrixShared.tsx:127` · `ChannelsAtelier.tsx:202,209` · `ReplyOutbox.tsx:236` ·
  `DataGrid.tsx:259` · `GoalsMissions.tsx:236` · `CreateTeamForm.tsx:142` ·
  `SlackBridgePickers.tsx:65,76,95` · `SourceDefinitionInput.tsx:312,364` ·
  `ucPowerRail.tsx:121` · `TestTab.tsx:258` · `CredentialPickerFilters.tsx:47,56,67,76`.
- **Filterable relying on the hardcoded English `'Select...'` (10)** —
  `parameterEditing.tsx:212` · `CreatePracticeModal.tsx:76` ·
  `ClusterPatternsModal.tsx:290` · `CreatePlaybookModal.tsx:138` ·
  `AddKpiModal.tsx:67,75,79` · `addKpiPrimitives.tsx:72,79,84`.
- **Native mode with neither `id` nor `aria-label` (34 of 41)** — recoverable
  only if a wrapping `<label>` exists, which `form-field-and-validation.md`
  showed is usually not the case (120 orphan labels across 49 files).
- **Native mode wired correctly (4)** — `FieldCaptureRow.tsx:96` ·
  `GitLabDeployModal.tsx:94,111` · `CreateMemoryForm.tsx:115`.

### D6 — `Listbox` call sites

10 of 13 are exemplary. The 3 that are not pass no `itemCount`, which disables
arrow navigation **and Escape**: `AddChannelButton.tsx:23` ·
`UseCaseChannelDropdown.tsx:16` · `RemoteInstructionComposer.tsx:66`.
Two more ship hardcoded English `ariaLabel`: `ArenaPanelColosseum.tsx:570` ·
`DevToolsProjectDropdown.tsx:88`. Only 1 of 13 passes `portal`
(`DevToolsProjectDropdown.tsx:85`).

### D7 — connector-sourced option lists: 15 pickers, 3 correct

| Tier | Count | Sites |
|---|---|---|
| **Full triad** (loading + error + settled-empty) | 3 | `CodebaseProjectPicker.tsx:105-142` · `TableSelector.tsx:107-130` (**zero consumers**) · `OverviewParts.tsx` Sentry org/project (`:435-470`, with a `manualMode` fallback so discovery failure never dead-ends) |
| **Empty state only** — a failed fetch is indistinguishable from "you have none" | 6 | `ExecutePersonaPicker.tsx:60` (`.catch` → `silentCatch` → `setPersonas([])`, `:36-39`) · `CredentialPicker.tsx:92` · `ConnectorDimCard.tsx:135` · `TwinPicker.tsx:224` · `RecipePicker.tsx:73` · `StationPicker.tsx:195` |
| **Silent** — no loading, no error, no empty | 6 | `ThemedSelect.tsx:193` (its `no_matches` is a *filter* message; an empty `options` array renders it identically) · `LifecycleProjectPicker.tsx:44` (flashes "create a project" during every fetch; `fetchProjects()` at `:31` has no `.catch`) · `VaultConnectorPicker.tsx:79` · `CredentialPickerCards.tsx` (207 lines, no state branches) · `OverviewParts.tsx:340` credential select · `ColumnDropdownFilter.tsx` |
| **Control vanishes entirely** | 1 | `PollingConfig.tsx:22` — `credentialEventsList.length === 0` removes the field |

**Root cause, one level up.** `src/stores/slices/vault/credentialSlice.ts:33` uses
`createCachedFetch({ ttlMs, rethrow: true })` and exposes **no
`credentialsLoading` flag** — `credentials` is `[]` both before the fetch and
after a failure. Every credential- and connector-backed picker in tiers 2 and 3
is *structurally unable* to distinguish the three states no matter what the
component does. `devToolsProjectSlice.ts:19` does export `projectsLoading` and
`LifecycleProjectPicker` simply never reads it. **Adding one flag to the
credential slice unblocks roughly eight pickers at once** — this is the highest
leverage fix in the whole leaf.

### D8 — performance

- **14 unmemoized `options={…map(…)}`** — `AutomationTriggerStep.tsx:188`
  (unbounded, connector-sourced — the worst) · `parameterEditing.tsx:215` ·
  `GlobalExecutionList.tsx:388` · `AnnotateModal.tsx:55,67` ·
  `ManualReviewList.tsx:397` · `CreatePracticeModal.tsx:79` ·
  `GoalsMissions.tsx:243` · `SourceDefinitionInput.tsx:326,378` ·
  `QuestionnaireFormGridParts.tsx:208,424` · `RotationActivePolicy.tsx:118` ·
  `RotationNewPolicy.tsx:39`. Plus 3 inline `options={[…]}` literals.
- **`useAnchoredPortalPosition.ts:41-58` re-renders the whole open menu on every
  scroll event.** `update()` unconditionally calls `setPos({…})` with a fresh
  object, and the listener is registered with `capture: true` on `window`, so it
  fires for scrolls in *any* ancestor. No rAF throttle and no equality check —
  scrolling a long page with a 200-option select open re-renders 200 option
  buttons per frame.
- **No virtualization in `FilterableSelect`** (`:192-219`); every filtered option
  is a DOM node, each running `highlightMatch` (`:215`).

### D9 — token divergence

- **z-index**: 9 literals on floating menus plus the primitives' 9990/10200.
  `Tooltip.tsx:315` at `z-[9999]` lands *between* them, so a tooltip covers a
  portalled `Listbox` and hides under a `ThemedSelect`.
- **Radius**: 5 in use on selects; `rounded-input` — the token `Design.md:216`
  assigns to selects — is used by **none**. `custom/no-raw-radius-classes` cannot
  see this: the rule skips `src/features/shared/components/` wholesale
  (`no-raw-radius-classes.cjs:46-55`, the `src/features/shared/components/` clause
  at `:49`), exactly as it skips `designTokens.ts` for
  `INPUT_FIELD`. **Both canonical form controls in this app render at card radius
  because the gate is blind to the two files that define them.**
- **Shadow**: `Design.md:229` assigns `shadow-elevation-2` to "Dropdowns, raised
  panels". `ThemedSelect`, `Listbox` and `ColumnDropdownFilter` all use
  `shadow-elevation-3`; the recipes-prototype `menuClassName` overrides use
  `shadow-elevation-4`.
- **Glass**: `Design.md:166` assigns `.glass-sm` to "z-10 dropdowns". Only
  `Listbox`'s inline mode uses it, at `z-50`.

### D10 — i18n

`ThemedSelect.tsx:72` `placeholder = 'Select...'` (shared primitive; untranslated
on every correct adoption) · 8 hardcoded `aria-label` in `AddKpiModal.tsx:67,75,79`
and `addKpiPrimitives.tsx:72,79,84,89,103` (neither file imports `useTranslation`)
· 2 hardcoded `Listbox` `ariaLabel` · `FieldCaptureRow.tsx:106` `'Select...'` ·
`SortDropdown.tsx:23` `'Newest First'`. `TimezoneSelect.tsx:69` routes its one
string through `<DebtText>`, which is the honest marker rather than a deviation.

### Second pass — what is upstream of all of it

Re-read against the corpus, the 76 hand-rolls are not a discipline failure.
**A floating menu is four orthogonal problems — position, dismissal, keyboard,
ARIA — and this repo has a shared answer to only the first two.**

| Concern | Shared answer | Adopters | Hand-rolls |
|---|---|---|---|
| Position | `useAnchoredPortalPosition` (+ the rival `useViewportClampAbsolute`) | 3 (+4) | 12 raw `getBoundingClientRect` · 33 `absolute top-full` · 10 `bottom-full` |
| Dismissal | `useClickOutside` | 11 | **46** inline `mousedown` listeners in 43 files |
| Keyboard | *(none — `Listbox`'s is welded into `Listbox`)* | 13 | 4 partial, 72 none |
| ARIA | *(none)* | — | 6 `role="menu"`, 18 `role="option"`, 10 `aria-haspopup`, all hand-written |

So each of the six shared implementations re-answers all four from scratch, and
a developer who cannot use `ThemedSelect` (needs a chip trigger) or `Listbox`
(needs a hover card) gets **nothing** — not even the two answers that exist,
because they are not obviously reusable outside the components that own them.
Hand-rolling is the rational response to that layer, which is why forbidding it
by documentation has failed five times.

**The structural fix is one headless hook, not a seventh component.**
`useMenuSurface({ triggerRef, open, setOpen, itemCount })` composing
`useAnchoredPortalPosition` + `useClickOutside` + the keydown block currently
welded into `Listbox.tsx:134-154`, and returning `{ position, triggerProps,
menuProps, getOptionProps(i) }` with the ARIA filled in. `Listbox`,
`ColumnDropdownFilter`, `UnifiedTable`'s column filter and `FilterableSelect`
all become thin renderers over it — which is also the cheapest route to Gaps #2
and #4, because the keyboard model then has exactly one home. Every deviation in
D3 becomes a mechanical migration rather than a rewrite.

---

## Gaps in the primitives

1. **`filterable` mode accepts 8 props and silently drops the rest — and the
   type says otherwise.** `ThemedSelectProps extends
   SelectHTMLAttributes<HTMLSelectElement>`, so `id`, `aria-invalid`,
   `aria-describedby`, `required`, `name` and `form` all type-check; the
   `Pick<…>` at `:78-89` and the forwarding at `:239-249` discard every one.
   This is the exact blocker recorded as **Gaps #3 in
   `form-field-and-validation.md`**, and it is why "wrap every labelled control
   in `FormField`" currently only holds for `<input>`, `<textarea>`,
   `PasswordToggleField` and *native-mode* `ThemedSelect`. **Fix:** thread
   `id`, `aria-*`, `required` and `disabled` through to the trigger `<button>`
   and add `role="combobox"` + `aria-expanded` + `aria-controls` +
   `aria-haspopup="listbox"`. One change unblocks the sibling path.
2. **`filterable` mode has no keyboard model at all.** No `onKeyDown`, no
   `keydown` listener, no `role="listbox"`/`role="option"`/`aria-selected`/
   `aria-activedescendant`. Options are portalled to the end of `document.body`,
   so Tab does not reach them from the trigger, and with `hideSearch` nothing is
   focused on open. **36 call sites are mouse-only.** `Listbox` already contains
   the pattern to lift (`:134-154`) — this is a port, not an invention.
3. **`Listbox`'s keyboard is opt-in via a prop that reads as optional.**
   `itemCount` gates the entire keydown effect (`:135`) including `Escape`. Make
   `Escape` unconditional at minimum; better, derive `itemCount` from a
   `Listbox.Option` sub-component so it cannot be forgotten.
4. **No `Home`/`End` and no letter type-ahead anywhere in the app.**
   `Home`/`End` handling exists in 13 files — all tab bars, segmented toggles,
   chip rails and scrubbers, **not one a dropdown**. True WAI-ARIA type-ahead
   (accumulate keystrokes, jump to match) has **zero implementations**; both
   "type-ahead" features in the repo are text inputs the user must focus. Native
   mode gets both free from the browser, which is the strongest argument for
   defaulting to it.
5. **`Listbox` has no `aria-activedescendant`.** `focusIndex` is a purely visual
   highlight — a screen-reader user hears nothing as they arrow through.
6. **`Listbox` cannot flip.** `:108-109` documents the omission
   (*"No flip-up: Listbox's portal mode has never needed it"*). A `Listbox` near
   the viewport bottom opens off-screen. The hook already supports `flip`;
   passing it is a one-line fix.
7. **Two competing edge strategies, neither complete.**
   `useAnchoredPortalPosition` flips and tracks scroll/resize but is
   portal-only (3 adopters). `useViewportClampAbsolute` works for
   `position: absolute` but measures once on open with no listeners (4
   adopters), so it is stale after any scroll. Neither handles horizontal
   overflow for a wide menu near the right edge except by translate-nudge.
   **Fix:** one hook with `strategy: 'portal' | 'absolute'`, flip + clamp on
   both axes, rAF-throttled, with the setState guarded by an equality check
   (see D8).
8. **`useRovingTabIndex` does not belong to this leaf — and that is the
   finding.** `hooks/utility/interaction/useRovingTabIndex.ts` (50 lines, added
   2026-04-24 under "Research updates", **zero importers**) handles
   `ArrowLeft`/`ArrowRight`/`Home`/`End` with wrap for **horizontal** composites
   — its own docblock says tablists, toolbars, menubars. It has no
   `ArrowUp`/`ArrowDown`, no typeahead, and despite its name it does not manage
   `tabIndex` (it returns only `setRef` + `onKeyDown`, leaving
   `tabIndex={active ? 0 : -1}` to the caller). Its real adopters are the **14
   sites that hand-roll a conditional `tabIndex` 0/-1** — `SegmentedTabs.tsx:126,158`,
   `PanelTabBar.tsx:84`, both `DensityToggle`s, `CapabilityTabBar.tsx:115`,
   `FilterChips.tsx:173`, `TemplateDetailModal.tsx:219`, `TriggerTypeSelector.tsx:51`,
   `ExecutionDetailTabs.tsx:89`, `DraftEditStep.tsx:129`, `ScheduleTimeline.tsx:419`,
   `InteractiveSigil.tsx:271`, `IssuesList.tsx:68` — six of which already
   implement the identical Arrow+Home+End+wrap semantics by hand. **Route it to
   the tab-strip/segmented-control leaf, not here.** What *this* leaf needs is
   the vertical analogue (↑↓ + Home/End + typeahead + `aria-activedescendant`),
   which does not exist and should be built inside `Listbox` rather than as a
   free-floating hook — a free-floating hook is precisely what got zero adopters
   the first time.
9. **`ColumnDropdownFilter` is a shared primitive with no ARIA and no keyboard**,
   and `UnifiedTable` didn't use it — it grew a seventh implementation inline.
   Either delete `ColumnDropdownFilter` in favour of a `Listbox` composition and
   point `UnifiedTable` at it, or promote one of them and delete the other. Two
   near-identical clipped menus in one folder is the state that produced the
   other 76.
10. **No loading contract on the option source.** `ThemedSelect` has no
    `loading` / `error` / `emptyMessage` props, so even a disciplined caller has
    to render the three states outside the control, above the label. Combined
    with the missing `credentialsLoading` flag (D7), a correct connector-sourced
    picker currently requires work in three files. `TableSelector` shows what
    the props should look like and has no consumers.
11. **`no_matches` doubles as the empty-options message.** `:193-195` renders the
    same string whether the filter matched nothing or `options` is `[]`.
12. **Zero tests on any of it.** No test for `ThemedSelect` (either mode),
    `Listbox`, `ColumnDropdownFilter` or `useAnchoredPortalPosition`. The
    prop-drop, the `itemCount` gate, the flip decision, the option theming and
    the portal z-index are all uncovered — and the prop-drop in particular is
    the kind of bug a single render test would have caught on the day it shipped.

---

## The missing gate

Every deviation above shipped under a green `npm run check`
(`check:contracts && check:tiers && check:tauri-configs && tsc --noEmit &&
eslint src/`). Nothing in that chain looks at selects. There is **no `jsx-a11y`
plugin** in `eslint.config.js` at all, so no rule anywhere checks ARIA. And
`.claude/conventions.json:112` lists `"select"` under `reuse.doNotHandRoll`
**with no `enforcedBy`** — the same shape as its `"form field"` sibling, and the
same outcome. `Design.md`, `CLAUDE.md`, `CATALOG.md` and the reuse doc have all
said "don't use a raw `<select>`" for months; there are 63 of them, and the
document that says it names the wrong primitive. Documentation did not hold this
line and will not.

### Signal — `custom/no-raw-select` (primary)

A `JSXOpeningElement` whose name is `select`, in any file except
`src/features/shared/components/forms/ThemedSelect.tsx`.

**Measured on the real corpus: 63 matches across 46 files, and the
false-positive rate is zero by construction.** `ThemedSelect` extends
`SelectHTMLAttributes<HTMLSelectElement>`, renders `children` unchanged, and
adds only theming — so a raw `<select>` is never the correct answer and the
migration is prop-for-prop. This is as clean a signal as `role="columnheader"`
was for tables, and cleaner than the label rule in the sibling path, because it
matches an element rather than an absence.

**This is one of the few rules in this repo that can ship a real `fixer`:**
rename the element, and add
`import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';`
if absent. Message:
*"A raw `<select>` renders OS-styled `<option>`s inside a themed app. Use
`forms/ThemedSelect` — it takes the identical props and children and adds
`[&>option]` theming. `[&>option]:bg-background` appears exactly once in `src/`."*

### Signal — `custom/no-hand-rolled-dropdown` (secondary)

Two sub-checks, both cheap and both high-precision:

- **`document.addEventListener('mousedown', …)` outside
  `hooks/utility/interaction/useClickOutside.ts`** — **46 matches across 43
  files**, against 11 `useClickOutside` consumers. A `mousedown` listener on
  `document` inside a component is dismiss-on-outside-click essentially every
  time; near-zero false positives. Message points at `useClickOutside`, and —
  when the element being dismissed is a list of options — at `Listbox`.
- **A `className` containing `absolute top-full` on an element that also
  contains a `.map(`** — 33 `absolute top-full` sites, of which 2 are not menus
  (`TriggerSchedulePreview.tsx:72`, a label span; `AppearanceThemeHoverPreview.tsx:12`,
  a hover preview) and are excluded by the `.map(` conjunct. Message names the
  clipping failure and `Listbox portal` + `useAnchoredPortalPosition`.

### Signal — `custom/require-listbox-item-count` (tertiary, tiny)

A `<Listbox>` JSX element with no `itemCount` attribute. **3 matches, 0 false
positives** — the prop is what enables arrow navigation and Escape, so its
absence is always a bug. Three-line rule; ship it with the other two.

### Mechanism

Three rules in `eslint-rules/`, registered in `eslint.config.js`. Ship
`no-raw-select` and `require-listbox-item-count` at **`"error"`**;
`no-hand-rolled-dropdown` at `"error"` behind the allowlist below. This is
load-bearing, but **not for the reason originally given** (corrected 2026-08-14):
this cited a "~10,086-warning baseline", measured since at **1,135 warnings in
246 files**. The count-independent reason is stronger — `npm run check` passes
`eslint src/` with **no `--max-warnings`** and the pre-commit hook uses
`--quiet --max-warnings 99999`, so **a warn-level rule enforces nothing at either
gate by construction** — which is exactly the state `custom/prefer-status-badge`
and `custom/prefer-numeric` are in.
All three violation sets here are small and enumerable, so error-level is
affordable. They run on `pre-commit` (`lefthook.yml` `eslint-staged`,
`*.{ts,tsx}`) and in CI via `npm run check` → `eslint src/`.

Add one non-lint check to `npm run check`: **`node scripts/check-select-tokens.mjs`**,
asserting that every dropdown surface in `src/features/shared/components/forms/`
and `display/` uses `rounded-input`, `shadow-elevation-2`, and a z-index drawn
from a named constant. `custom/no-raw-radius-classes` **cannot** do this — it
skips `src/features/shared/components/` by name (`no-raw-radius-classes.cjs:49`),
which is why the two canonical form controls in this app both render at card
radius while the radius gate runs green.

### Allowlist — named, finite, expiring

1. `src/features/shared/components/forms/ThemedSelect.tsx` — the primitive; it
   *is* the `<select>`.
2. `src/features/shared/components/forms/Listbox.tsx` and
   `useAnchoredPortalPosition.ts` — the sanctioned menu and its positioner.
3. `src/lib/ui/BaseModal.tsx`, `display/Tooltip.tsx`,
   `overlays/QuickEditPopover.tsx` — overlays, not selects; they own their own
   dismissal and stacking and are governed by [`modals.md`](./modals.md).
4. The **46 raw-`<select>` files** and the **43 inline-`mousedown` files**,
   enumerated **by path in the rule file**, each with a one-line reason. Not a
   glob. The list only ever shrinks; adding a file requires editing the rule,
   which is a reviewable diff.
5. Context menus positioned from a pointer event rather than a trigger element
   (`TableContextMenu`, `DriveContextMenu`, `ClipContextMenu`, `NodeContextMenu`)
   — genuinely not anchored dropdowns. Named individually, not by pattern.

### How it fails loudly if its own precondition is absent

This repo has shipped gates that ran green while checking nothing, and
`eslint-rules/` has **21 rules of which 12 carry `RuleTester` coverage** in
`src/test/eslint-rules/customRules.test.ts` — **9 have none**. A rule that
silently stops matching is the default outcome here, not a hypothetical. Four
assertions, in the same change:

1. **`RuleTester` fixtures for all three rules**, added to
   `src/test/eslint-rules/customRules.test.ts` alongside the existing 12: a raw
   `<select>`, a `<ThemedSelect>` (must not flag), a `<select>` inside
   `ThemedSelect.tsx` (must not flag), a `document.addEventListener('mousedown')`
   in a component, a `useClickOutside` call (must not flag), a `<Listbox>` with
   and without `itemCount`.
2. **Registration assertion** — a Vitest case importing `eslint.config.js` and
   asserting `rules['custom/no-raw-select'] === 'error'` and the same for the
   other two. The failure mode this repo actually suffers is a rule authored and
   never wired; this catches exactly that.
3. **Ratchet assertion** — a check script asserting the allowlist names at most
   46 select files and at most 43 mousedown files, and that **every listed path
   still exists**. Delete a file and the entry goes stale and the script fails;
   widen the allowlist to make a build pass and the count fails. It only tightens.
4. **The precondition guard, and the piece specific to this leaf.**
   `no-raw-select`'s entire advice — *"ThemedSelect is a drop-in"* — is true only
   while `ThemedSelectProps extends SelectHTMLAttributes<HTMLSelectElement>` and
   native mode keeps spreading `{...rest}` onto the `<select>`. If someone
   narrows that type or refactors the spread away, the rule keeps passing while
   routing every developer to a control that drops their props — the failure is
   invisible and repo-wide. So ship a **render test** in
   `forms/__tests__/ThemedSelect.test.tsx` asserting that `id`, `aria-invalid`,
   `aria-describedby`, `required` and `name` reach the DOM `<select>` in native
   mode; a **`tsc`-checked type fixture** asserting those props type-check on
   `ThemedSelectProps`; and — deliberately — **the same test for `filterable`
   mode, written as `expect.fail`/`todo` today**, so the prop-drop is a recorded,
   visible red rather than an undocumented behaviour. When Gap #1 is fixed, that
   test turns green and becomes the regression guard. Add the `Listbox`
   companion: `itemCount` present → ArrowDown moves `focusIndex`; `itemCount`
   absent → Escape still closes (which is the fix, so it fails first).

### What a gate cannot reach, and must be doctrine instead

Three of this leaf's most consequential deviations are invisible to any linter.

- **Choosing `filterable` when native mode would do.** No AST distinguishes "this
  list needs icons" from "I liked the look". This is a PR-review item: add
  *"a `filterable` select needs a written reason — icons, descriptions, or
  length"* to the PR self-review list in `.claude/CLAUDE.md`.
- **Whether a connector-sourced picker distinguishes loading from failed from
  empty.** A rule can see that `options` came from a store; it cannot judge the
  three sentences. The **mechanical half is gateable and should be filed
  upstream**: a test asserting that every async slice in `src/stores/slices/`
  exposing a collection also exposes a `*Loading` flag. That single assertion
  would have caught the `credentialSlice` gap that makes eight pickers
  structurally wrong.
- **The catalog describing the wrong primitive.** `check:catalog` exists but no
  longer gates `npm run check`, and a missing `@catalog` tag produces a plausible
  truncated fragment rather than an obvious blank — `ThemedSelect`'s entry reads
  as a real description and is a prop comment. Make `gen-shared-catalog.mjs`
  emit the explicit `_(add a `@catalog` tag)_` marker it already uses for
  `PillGroup` whenever no tag is found, instead of falling back to the first
  JSDoc in the file. That is a one-line change to the generator and it turns a
  silent wrong answer into a visible gap.
