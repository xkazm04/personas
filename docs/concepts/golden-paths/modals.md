# Golden path — Modals

> **Corrections pass — 2026-08-13.** This path was written as a probe BEFORE
> discovery replaced the top-down 56-topic tree with the 247-leaf spine, and
> its topic path was never re-pointed. Old address `frontend/surfaces/modals` names a domain that
> no longer exists. Corrected above. The document's content was not affected.

> Situation node: `ui-system/overlays/modal-dialog` · [situation spine](../situation-spine.md)
> Hand-authored 2026-08-13 from a repo-wide ground-truth sweep (46 tool calls).
> The **Deviations** section is a fix backlog; it migrates to `violating` cells
> in `workspace_practice_context_state` when this path is ingested.

## Trigger

- "Add a confirm dialog before deleting this credential / persona / project."
- "Clicking a row should open a detail modal showing the full execution / KPI / memory."
- "We need a wizard or multi-step form that pops over the current page."
- "Put this settings form in a popup instead of inline."
- "Make this panel slide in from the right edge."
- "The picker needs to open on top of the modal that launched it."

## The one way

Never render a backdrop yourself. Compose `BaseModal` from `@/lib/ui/BaseModal` (or its alias `@/features/shared/components/modals`), passing at minimum `isOpen`, `onClose`, a `titleId`, and one width declaration. Prefer the `size` scale (`sm|md|lg|xl|full|6xl`) over `maxWidthClass` so the app keeps a shared width vocabulary. Always pass `portal` — the app is full of `backdrop-blur` and `framer-motion` transform ancestors that silently clip a non-portaled `fixed` overlay. The `titleId` **must** match an `id` on the real heading element, even when that heading lives in a child header component; a `titleId` with no matching `id` is a dangling `aria-labelledby` and the dialog is announced nameless. If your panel is a flex column with a scrolling body, you **must** pass `staggerChildren={false}` — the stagger wrapper is a block-level `motion.div` that breaks the flex chain and silently no-ops your `flex-1`. If you override `panelClassName`, re-declare a height ceiling (`max-h-[85vh]` or `h-[85vh]`), because the override replaces `defaultPanelClass` wholesale rather than merging. For anything with header/close/scroll-body/footer, wrap `DetailModal` instead of rebuilding that chrome. For confirms use `ConfirmDialog`; for destructive confirms `ConfirmDestructiveModal` with its `useConfirmDestructive()` hook. Escape, backdrop-click, the Tab focus trap, focus restore, progressive backdrop blur and stack-aware z-index are all already handled — re-implementing any of them is a bug, not a hardening.

## Mandated primitives

- **`src/lib/ui/BaseModal.tsx` — `BaseModal`** — the only sanctioned overlay: portal escape hatch, `role="dialog"` + `aria-modal` + `aria-labelledby`, Escape (priority 80 on the app keyboard ladder, gated to the topmost modal), Tab cycling, focus restore, backdrop dismiss, `useReducedMotion` variants, per-child stagger, `placement="center" | "right-drawer"`.
- **`src/features/shared/components/modals/index.ts`** — re-export alias; importing from here also satisfies the ESLint rule.
- **`src/lib/ui/ModalStackContext.tsx`** — mounted once at `src/App.tsx:310`. Depth-ordered z-index (50 base, 10000 portal base, +10 per depth) and progressive backdrop: topmost `bg-black/60 surface-blur-modal`, beneath `bg-black/30 surface-blur-popover`. Also gates Escape to the topmost modal.
- **`overview/components/dashboard/widgets/DetailModal.tsx`** — the composed shell (`title` / `subtitle` / `actions` / `maxWidthClass` / `children`) with header band, close button, `flex-1 overflow-y-auto` body and footer already correct. Reach for this before hand-composing bands.
- **`shared/components/feedback/ConfirmDialog.tsx`** — themed replacement for native `confirm()`; its `busy` state disables both buttons and blocks backdrop/Escape while `onConfirm` is pending.
- **`shared/components/overlays/ConfirmDestructiveModal.tsx` + `useConfirmDestructive()`** — `requireTypedConfirmation`, `details` rows, `warningMessage`, host-provided `blastRadius` slot so the primitive stays domain-free.
- **`shared/components/overlays/UnsavedChangesModal.tsx`** + `useUnsavedGuard` — the save/discard/stay guard.
- **`eslint-rules/enforce-base-modal.cjs`** — warns on `role="dialog"` without a BaseModal import. See Gaps for why it is close to non-functional.

## Steps

1. **Decide modal vs drawer vs popover first.** Blocking decision or detail inspection → centered `BaseModal`. Persistent side context → `placement="right-drawer"` (fixed `w-[480px]`, no child stagger). Anchored to a trigger → **not a modal**; use `overlays/QuickEditPopover` or a plain anchored portal, and do not put `role="dialog"` on it.
2. **Import the primitive** — `import { BaseModal } from '@/lib/ui/BaseModal';`
3. **Pick a width from the scale** — `sm`→`max-w-md`, `md`→`max-w-xl`, `lg`→`max-w-3xl`, `xl`→`max-w-4xl`, `full`→`max-w-5xl`, `6xl`→`max-w-6xl`. Omitting both defaults to `max-w-4xl`. Reach for `maxWidthClass` only when the scale has no rung for you.
4. **Wire `titleId` to a real heading** — a stable literal, then `<h2 id="…">` in the header. If the header is a child component, the `id` lives there; that is the exemplary pattern.
5. **Pass `portal`** unless you have a specific reason not to.
6. **Compose the body** — header + scrolling body (+ footer) → wrap `DetailModal`. Hand-compose only when its chrome genuinely doesn't fit.
7. **If hand-composing a flex-column panel** — `panelClassName` with `flex flex-col` **and** a height ceiling; body gets `flex-1 min-h-0 overflow-y-auto` (`min-h-0` is what lets `flex-1` shrink below intrinsic height — see `TemplateDetailModal.tsx:238`); **pass `staggerChildren={false}`**.
8. **Add your own close button in the header** — BaseModal ships no chrome by design. `aria-label` from `t.*`, plus the `focus-ring` class.
9. **Do not add** an Escape listener, a Tab trap, a body-scroll lock, or a backdrop `onClick`.
10. **Route every string through i18n** and translate all 14 locales in the same change.

## Anti-patterns

- **Hand-rolling `fixed inset-0` + a centered panel** — loses focus trap, focus restore, Escape gating, stack-aware z-index, progressive blur, reduced-motion. 23 surfaces do this today.
- **Omitting `role="dialog"` on a hand-rolled overlay so lint stays quiet** — the rule pattern-matches that literal, so 45 of 46 `fixed inset-0` files never trip it. Linter silence is not evidence of compliance.
- **A `titleId` matching no element** — dangling `aria-labelledby`, dialog announced nameless. Six live instances.
- **Flex-column panel + scrolling body without `staggerChildren={false}`** — the stagger wrapper is `display:block`; `flex-1` gets no height and the body collapses or overflows. 15 live instances.
- **Overriding `panelClassName` without re-declaring `max-h-`** — the viewport ceiling vanishes and tall content runs off-screen with nothing to scroll it. 25 of 64 overrides.
- **Overriding `containerClassName` to hardcode a z-index** — `BaseModal` applies `style={{ zIndex }}` *only when `containerClassName` is absent*, so the override opts you out of depth ordering and freezes you at one layer.
- **Re-implementing Escape on top of BaseModal** — duplicates the priority-80 handler and defeats topmost-only gating, so one keypress closes two stacked modals. 8 live instances.
- **Re-implementing the Tab focus trap** — `PeerDetailDrawer.tsx:84`.
- **Building a second generic modal shell** because BaseModal didn't stack — the right fix is extending the primitive.
- **Putting `role="dialog"` on an anchored popover** to look accessible — it makes lint demand a migration that would be wrong.
- **Wrapping a BaseModal in your own scrim** to force it above something — `TestReportModal.tsx:314`.

## Evidence

Adoption is strong at the entry point: **129 `<BaseModal` call sites across 128 files, and 100% pass `isOpen`, `onClose` and `titleId`.** All drift is downstream of those three props.

- `src/lib/ui/BaseModal.tsx:38-42` — the `staggerChildren` doc comment states the flex-chain failure mode outright; the doctrine is written into the primitive.
- `…/BaseModal.tsx:179-181` — progressive backdrop by stack depth.
- `…/BaseModal.tsx:198-227` — Escape + Tab cycling via `useAppKeyboard` at priority 80 with `if (!isTopmost) return false`.
- `src/lib/keyboard/AppKeyboardProvider.tsx:31-41` — the priority ladder: CommandPalette 90, BaseModal 80, TriageDeck 70.
- `teams/sub_kpis/KpiDetailModal.tsx:50-58` — **the reference call site**: `portal` + `staggerChildren={false}` + `h-[85vh] flex flex-col` + extracted `<ModalHeader>` + `flex-1 overflow-y-auto` body, in seven lines.
- `overview/components/dashboard/widgets/DetailModal.tsx:20-63` — the composed shell; `staggerChildren={false}` at `:27` paired with the body at `:54`, ambient-glow layers at `:32-33`.
- `overview/sub_patterns/PracticeDetailLedger.tsx:67` · `overview/sub_manual-review/components/backlog/BacklogDetailLedger.tsx:78` · `vault/shared/playground/PlaygroundHeader.tsx:112` — the correct cross-file `titleId` pattern.
- `shared/components/feedback/ConfirmDialog.tsx:39-55` — `busy` guard blocking double-confirm and dismissal mid-flight.
- `shared/components/overlays/ConfirmDestructiveModal.tsx:19-22,107-124,189-217` — domain-free `blastRadius` slot, type-to-confirm gate, `useConfirmDestructive()` so call sites never manage open/config state.
- `templates/sub_generated/gallery/modals/TemplateDetailModal.tsx:238-244` — the `min-h-0` explanation.
- `settings/sub_network/components/PeerDetailDrawer.tsx:137-150` — the `right-drawer` exemplar, incl. the `className="contents"` ref trick that adds a ref without breaking the flex chain.

## Deviations found

**Hand-rolled overlays bypassing BaseModal (23) — the core backlog.** None has `aria-modal`; none has a focus trap.

- `agents/sub_glyph/commandPanel/composer/ComposerPickerShell.tsx:89` — **highest leverage.** A full parallel modal primitive (header/body/footer, own `size` prop, portal, Escape, `z-[10050]`) with 6 downstream consumers.
- `shared/chrome/CommandPalette.tsx:410` — global palette, top-anchored, `z-[9999]`.
- `templates/sub_generated/adoption/chronology/TestReportModal.tsx:68` and `:314` — two hand-rolled backdrops; `:314` wraps a real BaseModal in a raw scrim.
- `plugins/research-lab/sub_reports/ReportPreviewDrawer.tsx:215` · `plugins/research-lab/sub_experiments/ExperimentRunsDrawer.tsx:47` — right drawers; `placement="right-drawer"` already exists.
- `plugins/fleet/SkillLibraryDrawer.tsx:75` — left-edge drawer; no left placement in the primitive (see Gaps).
- `home/sub_cockpit/widgets/DecisionDrawer.tsx:54` — centered decision card (misnamed).
- `schedules/components/FrequencyEditor.tsx:101` — **no Escape, no backdrop close.**
- `plugins/dev-tools/sub_context/ScanOverlay.tsx:31` — blocking overlay, no Escape, no backdrop close.
- `settings/sub_api_keys/components/CreatedKeyDialog.tsx:85` — no backdrop close, but *deliberately* (one-time plaintext token); migration needs a guarded `onClose`.
- `vault/shared/vector/ingest/IngestDirectoryPicker.tsx:77` — Escape uses `stopPropagation` so the parent `VectorKbModal` doesn't also close; that constraint must survive migration.
- `triggers/sub_studio/routing/layouts/DisconnectDialog.tsx:20` — destructive confirm; should be `ConfirmDestructiveModal`.
- `triggers/sub_studio/routing/layouts/AddPersonaModal.tsx:107` · `templates/sub_generated/adoption/QuickAddCredentialModal.tsx:139` · `plugins/dev-tools/sub_projects/CrossProjectMetadataModal.tsx:301` · `overview/sub_memories/components/MemoryDetailModal.tsx:35` · `agents/sub_use_cases/components/core/EventRenameModal.tsx:176` · `settings/sub_api_keys/components/ApiKeyAuditDrawer.tsx:68` · `settings/sub_api_keys/components/CreateApiKeyDialog.tsx:104` · `recipes/sub_list/components/RecipePicker.tsx:39` · `plugins/artist/sub_media_studio/TextLane.tsx:51` · `plugins/artist/sub_gallery/TagEditorModal.tsx:73` · `plugins/artist/sub_gallery/BulkAddTagModal.tsx:18` — straight BaseModal migrations.

**Dangling `titleId` (6).** `home/sub_welcome/SetupCards.tsx:356` · `agents/sub_lab/components/versions_table/LabVersionsTable.tsx:337` and `:356` · `…/PostActivationReconcileDialog.tsx:59` · `templates/sub_generated/gallery/modals/CatalogCredentialModal.tsx:93` · `scraper/ScrapeEditorModal.tsx:38`

**Latent flex-chain break — scrolling body with stagger still on (15).** `PersonaSelectorModal.tsx:78` · `onboarding/OnboardingOverlay.tsx:97` · `ReviewResultsModal.tsx:17` · `ProjectTeamPreviewModal.tsx:135` · `DriveSignDialog.tsx:80` · `DriveVerifyDialog.tsx:75` · `RecipePlaygroundModal.tsx:35` · `ucPreviewModal.tsx:21` · `RebuildModal.tsx:53` · `RecommendedModal.tsx:25` · `TemplateDetailModal.tsx:140` · `CreateTemplateModal.tsx:67` · `PresetPreviewModal.tsx:52` · `GatewayMembersModal.tsx:188` · `ResourcePicker.tsx:183`

**`panelClassName` override drops the `max-h-[85vh]` ceiling (25 of 64).** Worst are the large surfaces: `AnomalyDrilldownPanel.tsx:127` · `HealingIssueModal.tsx:57` · `AutomationSetupModal.tsx:28` · `ExecutionDetail.tsx:150` · `AnnotateModal.tsx:41` · `SchemaManagerModal`-class surfaces.

**Duplicate Escape handler (8).** `GlyphFullLayout.tsx:116` · `DriveImageLightbox.tsx:153` · `KbPickerDialog.tsx:107` · `CreateTwinWizard.tsx:53` · `PeerDetailDrawer.tsx:77` · `AutoTeamModal.tsx:48` · `RenameEventDialog.tsx:191` · `SchemaManagerModal.tsx:124`

**Duplicate focus trap (1).** `settings/sub_network/components/PeerDetailDrawer.tsx:84-102`

**`containerClassName` override disables stack-aware z-index (8).** `GlyphFullLayout.tsx:329` · `DetailModal.tsx:20` · `DriveImageLightbox.tsx:295` · `FirstUseConsentModal.tsx:154` · `ucPreviewModal.tsx:21` · `TemplateDetailModal.tsx:140` · `IngestTextModal.tsx:40` · `ResourcePicker.tsx:183`. Hardcoded values range `z-[60]`→`z-[10500]` — an unmanaged parallel z-order. `TemplateDetailModal.tsx:145` additionally uses `absolute inset-0` with no `portal`, scoping itself to a parent stacking context.

**Width-scale drift.** Only 78 of 129 call sites use `size=`; 49 bypass it with `maxWidthClass`. `PersonaCoreModal.tsx:27` passes both, so `size` is silently ignored.

**Lint false positives — anchored popovers flagged (8).** `FindingBadge.tsx:210` · `WarningBadge.tsx:107` · `passportWidgets.tsx:187` · `DeployPopover.tsx:55` · `DataLinksPopover.tsx:80` · `StandardsScan.tsx:111` · `ImprovePopover.tsx:91` · `DemoNotice.tsx:23`. Correct resolution is a justified disable (as `ShareAgentButton.tsx:61` does) or dropping `role="dialog"` — not migration.

## Gaps in the primitive

1. **No left-edge drawer.** `placement` accepts only `'center' | 'right-drawer'`; drawer width is hardcoded `w-[480px]` with no prop.
2. **No supported way to stack above a portaled BaseModal.** Depth z-index counts only modals registered in `ModalStackContext`. A picker launched *from* a modal has no prop to sit above `Z_INDEX_PORTAL_BASE`; the only lever is `containerClassName`, which then disables depth ordering entirely. `ComposerPickerShell.tsx:77-79` documents this and hardcodes `z-[10050]`. **This single gap explains the parallel primitive, most of the 8 `containerClassName` overrides, and the raw scrim.** Fix: a `zIndexBoost`/`layer` prop, or make `containerClassName` merge.
3. **`panelClassName` / `containerClassName` replace rather than merge.** Every override silently discards defaults it didn't intend to touch — the height ceiling (25 instances) and the z-index (8). A `cn()` merge or `*ClassNameExtra` props would eliminate two deviation classes at once.
4. **`staggerChildren` defaults to `true`, the unsafe default.** The prop exists solely to disable a behaviour that breaks the most common composition. 43 call sites opt out; 15 should have and didn't. Defaulting to `false` inverts the failure mode from silent-layout-break to merely-less-animated.
5. **No mid-flight dismissal guard.** `ConfirmDialog` implements a `busy` lock locally; `BaseModal` has no `dismissable={false}` / `closeOnBackdrop={false}`. `CreatedKeyDialog` and `ScanOverlay` hand-rolled partly for this.
6. **No nested-Escape scoping** — `IngestDirectoryPicker.tsx:40` uses `stopPropagation` on a raw listener. Really gap #2 in another costume.
7. **The ESLint rule is close to non-functional as a gate.** It fires only on a `role="dialog"` **string literal** with no BaseModal import. 45 of 46 hand-rolled `fixed inset-0` files carry no `role`, so it never sees the real deviation population; meanwhile 8 of its 8 firings are anchored popovers where migration is wrong. A dynamic role (`Sidebar.tsx:197`) also escapes it. **The rule should key on `fixed inset-0` + a backdrop-colour class, not on `role`.**

**Not a gap:** BaseModal shipping no header/close/footer chrome is deliberate — `DetailModal` is that layer, and it is underused (7 adopters against 129 raw call sites).
