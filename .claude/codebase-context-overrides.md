<!--
  Hand-curated overrides appended to .claude/codebase-context.md by the
  /refresh-context skill (see .claude/skills/refresh-context/skill.md
  Phase 3.5).

  This file is the source of truth for context groups that must survive
  DB regeneration but are not yet (or never will be) populated by the
  Personas app's "Scan Codebase" feature.

  How to extend:
    - Add new groups as `## Group Name` sections below.
    - Each group's sub-contexts use `### context-id` headers and follow the
      same shape as DB-rendered contexts (Files, Entry points, Keywords,
      Tech stack).
    - The whole content of this file is appended verbatim to the rendered
      codebase-context.md, before the snapshot-meta footer.

  How to retire:
    - When a hand-curated group becomes obsolete (e.g. the Personas app
      finally scans shared/ and writes real rows into dev_contexts), delete
      the corresponding section here and run /refresh-context.
-->

## Shared UI Primitives

> **Group type:** —
> **Color:** slate
>
> ✳ **Hand-curated section.** Source: `.claude/codebase-context-overrides.md`. Appended to this file by `/refresh-context` after DB-derived groups. Edit the override file (not this one) to update — direct edits here will be wiped on next refresh. See ADR `2026-05-01-durable-shared-ui-context`.

### shared-buttons-display

The primitive layer of buttons, badges, icons, and display components shared across all features. `Button` is the canonical clickable primitive (variants: primary/secondary/ghost/danger/accent/link; sizes xs–lg + icon variants). Display includes `Badge`, `StatusBadge`, `Tooltip`, `TruncateWithTooltip`, `PersonaIcon`, `PersonaAvatar`, `EmptyIllustration`, `CategoryChip`, `ConnectorMeta`, `RelativeTime`, `UuidLabel`, `Collapse`, `AnimatedCounter`. Tables: `DataGrid`, `UnifiedTable`. Top-level barrel `@/features/shared` re-exports the most-used.

**Files:**
- `src/features/shared/components/buttons/Button.tsx`
- `src/features/shared/components/buttons/CopyButton.tsx`
- `src/features/shared/components/display/Badge.tsx`
- `src/features/shared/components/display/StatusBadge.tsx`
- `src/features/shared/components/display/Tooltip.tsx`
- `src/features/shared/components/display/PersonaIcon.tsx`
- `src/features/shared/components/display/EmptyIllustration.tsx`
- `src/features/shared/components/display/DataGrid.tsx`
- `src/features/shared/components/display/UnifiedTable.tsx`
- `src/features/shared/components/display/ConnectorMeta.tsx`
- `src/features/shared/components/display/RelativeTime.tsx`
- `src/features/shared/components/display/index.ts` (barrel)
- `src/features/shared/components/buttons/index.ts` (barrel)
- `src/features/shared/index.ts` (top-level barrel)

**Entry points:** src/features/shared/index.ts, src/features/shared/components/buttons/Button.tsx

**Keywords:** button, badge, tooltip, icon, avatar, primitive, shared, ui, display, datagrid, table, status badge

**Tech stack:** React, TypeScript, Tailwind CSS 4

---

### shared-modals-overlays

Canonical modal and overlay layer. `BaseModal` (focus trap + ESC + backdrop dismiss + portal stacking-context escape) is non-negotiable for all dialogs — ESLint `enforce-base-modal` flags raw `role="dialog"` without it. Lives in `@/lib/ui/BaseModal` and is re-exported from `@/features/shared/components/modals` for discoverability. Overlays surface higher-level patterns: `CommandPalette` (global ⌘K), `ConfirmDestructiveModal` + `useConfirmDestructive` (destructive-action confirmation), `UnsavedChangesModal`, `FirstUseConsentModal`, `FilterBar`, `QuickEditPanel`.

**Files:**
- `src/lib/ui/BaseModal.tsx`
- `src/features/shared/components/modals/index.ts`
- `src/features/shared/components/modals/ExecutionDetailModal/ExecutionDetailModal.tsx`
- `src/features/shared/components/overlays/CommandPalette.tsx`
- `src/features/shared/components/overlays/ConfirmDestructiveModal.tsx`
- `src/features/shared/components/overlays/UnsavedChangesModal.tsx`
- `src/features/shared/components/overlays/FirstUseConsentModal.tsx`
- `src/features/shared/components/overlays/FilterBar.tsx`
- `src/features/shared/components/overlays/QuickEditPanel.tsx`
- `src/features/shared/components/overlays/commandPaletteUtils.ts`
- `src/features/shared/components/overlays/index.ts` (barrel)
- `eslint-rules/enforce-base-modal.cjs`

**Entry points:** src/lib/ui/BaseModal.tsx, src/features/shared/components/overlays/CommandPalette.tsx

**Keywords:** modal, dialog, overlay, command palette, base modal, focus trap, confirm, unsaved changes, consent

**Tech stack:** React, TypeScript

---

### shared-feedback

User-feedback primitives: loading, error, empty, toast, banner, error boundary. `LoadingSpinner` is the default loading indicator (171 callers). `ToastContainer` is the singleton toast surface mounted at app root. `EmptyState` (default export) and `EmptyIllustration` cover empty-state shapes. Error surfaces: `ErrorBanner`, `InlineErrorBanner`, `ErrorRecoveryBanner`, `InlineErrorRecovery`, `ErrorBoundary`. `AriaLiveProvider` + `useAnnounce` provide accessible live-region announcements. `ConnectionStatusBadge`, `StalenessIndicator`, `UpdateBanner` cover system-state surfaces.

**Files:**
- `src/features/shared/components/feedback/LoadingSpinner.tsx`
- `src/features/shared/components/feedback/SuspenseFallback.tsx`
- `src/features/shared/components/feedback/ToastContainer.tsx`
- `src/features/shared/components/feedback/EmptyState.tsx`
- `src/features/shared/components/feedback/ErrorBanner.tsx`
- `src/features/shared/components/feedback/InlineErrorBanner.tsx`
- `src/features/shared/components/feedback/ErrorRecoveryBanner.tsx`
- `src/features/shared/components/feedback/ErrorBoundary.tsx`
- `src/features/shared/components/feedback/AriaLiveProvider.tsx`
- `src/features/shared/components/feedback/ConnectionStatusBadge.tsx`
- `src/features/shared/components/feedback/StalenessIndicator.tsx`
- `src/features/shared/components/feedback/UpdateBanner.tsx`
- `src/features/shared/components/feedback/index.ts` (barrel)

**Entry points:** src/features/shared/components/feedback/LoadingSpinner.tsx, src/features/shared/components/feedback/ToastContainer.tsx

**Keywords:** loading, spinner, toast, error banner, empty state, error boundary, suspense, aria live, announce, healing toast, recovery

**Tech stack:** React, TypeScript

---

### shared-forms

Form primitives shared across feature modules: `FormField` (label + error wrapper), `ThemedSelect` (filterable, icon-aware), `AccessibleToggle`, `Listbox`, `PillGroup`, `KeyValueEditor`, icon/color pickers (`IconSelector`, `PopupIconSelector`, `ColorPicker`, `PopupColorPicker`), `PersonaSelector` + modal variant, `DirectoryPickerInput` (Tauri filesystem dialog), `SourceDefinitionInput` (multi-source picker for local/codebase/database). Hooks: `useFieldValidation`, `useShakeError`. ~85 import sites across the app.

**Files:**
- `src/features/shared/components/forms/FormField.tsx`
- `src/features/shared/components/forms/ThemedSelect.tsx`
- `src/features/shared/components/forms/AccessibleToggle.tsx`
- `src/features/shared/components/forms/Listbox.tsx`
- `src/features/shared/components/forms/PillGroup.tsx`
- `src/features/shared/components/forms/KeyValueEditor.tsx`
- `src/features/shared/components/forms/IconSelector.tsx`
- `src/features/shared/components/forms/ColorPicker.tsx`
- `src/features/shared/components/forms/PersonaSelector.tsx`
- `src/features/shared/components/forms/DirectoryPickerInput.tsx`
- `src/features/shared/components/forms/SourceDefinitionInput.tsx`
- `src/features/shared/components/forms/useFieldValidation.ts`
- `src/features/shared/components/forms/useShakeError.ts`
- `src/features/shared/components/forms/index.ts` (barrel)

**Entry points:** src/features/shared/components/forms/FormField.tsx, src/features/shared/components/forms/ThemedSelect.tsx

**Keywords:** form, input, select, toggle, listbox, pill, key value, icon picker, color picker, persona selector, directory picker, source definition, validation, shake

**Tech stack:** React, TypeScript

---

### shared-layout

Page-level layout shells, section primitives, sidebar, footer, theme provider. `ContentLayout` (`ContentBox` + `ContentHeader` + `ContentBody`) is the canonical content shell with scroll-aware shadow and icon-color palette. `SectionCard`, `SectionHeader`, `SectionHeading` group content. `SegmentedTabs`, `PanelTabBar` for tabbed UIs. `TitleBar` + `BreadcrumbTrail` + `DesktopFooter` for chrome. `Sidebar` orchestrates nav (with `SidebarLevel1`/`Level2`, custom `SidebarIcons`, section adapters). `VibeThemeProvider`, `BackgroundServices` for app-level providers. `DeferUntilIdle` defers heavy children until idle.

**Files:**
- `src/features/shared/components/layout/ContentLayout.tsx`
- `src/features/shared/components/layout/SectionCard.tsx`
- `src/features/shared/components/layout/SectionHeader.tsx`
- `src/features/shared/components/layout/SectionHeading.tsx`
- `src/features/shared/components/layout/SegmentedTabs.tsx`
- `src/features/shared/components/layout/PanelTabBar.tsx`
- `src/features/shared/components/layout/TitleBar.tsx`
- `src/features/shared/components/layout/BreadcrumbTrail.tsx`
- `src/features/shared/components/layout/DesktopFooter.tsx`
- `src/features/shared/components/layout/VibeThemeProvider.tsx`
- `src/features/shared/components/layout/DeferUntilIdle.tsx`
- `src/features/shared/components/layout/sidebar/Sidebar.tsx`
- `src/features/shared/components/layout/sidebar/SidebarLevel1.tsx`
- `src/features/shared/components/layout/sidebar/SidebarLevel2.tsx`
- `src/features/shared/components/layout/sidebar/SidebarIcons.tsx`
- `src/features/shared/components/layout/sidebar/sidebarData.ts`
- `src/features/shared/components/layout/index.ts` (barrel)

**Entry points:** src/features/shared/components/layout/ContentLayout.tsx, src/features/shared/components/layout/sidebar/Sidebar.tsx

**Keywords:** layout, sidebar, footer, title bar, content shell, section, segmented tabs, breadcrumb, theme provider, defer until idle

**Tech stack:** React, TypeScript

---

### shared-progress-terminal

Progress, terminal, and use-case primitives. Progress: `WizardStepper`, `EstimatedProgressBar`, `ContentLoader` (skeleton), `TransformProgress`/`TransformModeView`/`TransformStatusPanels`, `AnalysisModeView`, `ConfigureStep`, plus phase-detection helpers (`detectTransformPhase`, `detectAnalysisPhase`). Terminal: `TerminalBody` (ANSI-aware), `TerminalHeader`, `TerminalSearchBar` + `useTerminalFilter`, `TerminalStrip`, `CliOutputPanel`. Use-cases: `UseCasesList`, `UseCaseRow`, `UseCaseHistory`, `UseCaseExecutionPanel`, `MockModePanel`, `useUseCaseExecution`. Editors: `JsonEditor`, `MarkdownRenderer`, draft-editor sub-system.

**Files:**
- `src/features/shared/components/progress/WizardStepper.tsx`
- `src/features/shared/components/progress/EstimatedProgressBar.tsx`
- `src/features/shared/components/progress/ContentLoader.tsx`
- `src/features/shared/components/progress/TransformProgress.tsx`
- `src/features/shared/components/progress/AnalysisModeView.tsx`
- `src/features/shared/components/progress/phaseDetection.ts`
- `src/features/shared/components/terminal/TerminalBody.tsx`
- `src/features/shared/components/terminal/TerminalHeader.tsx`
- `src/features/shared/components/terminal/TerminalSearchBar.tsx`
- `src/features/shared/components/terminal/CliOutputPanel.tsx`
- `src/features/shared/components/use-cases/UseCasesList.tsx`
- `src/features/shared/components/use-cases/UseCaseRow.tsx`
- `src/features/shared/components/use-cases/useUseCaseExecution.ts`
- `src/features/shared/components/editors/MarkdownRenderer.tsx`
- `src/features/shared/components/editors/JsonEditor.tsx`
- `src/features/shared/components/editors/draft-editor/index.ts`
- `src/features/shared/components/progress/index.ts` (barrel)
- `src/features/shared/components/terminal/index.ts` (barrel)
- `src/features/shared/components/use-cases/index.ts` (barrel)

**Entry points:** src/features/shared/components/terminal/TerminalBody.tsx, src/features/shared/components/use-cases/UseCasesList.tsx

**Keywords:** progress, wizard, stepper, transform, terminal, ansi, cli output, use case, markdown, json editor, draft editor, content loader

**Tech stack:** React, TypeScript

---

### shared-glyph-domain

Persona capability-dimension visualization kit (domain-specific, not a generic primitive). Tightly scoped to the 8-dimension model: trigger, task, connector, message, review, memory, event, error. Components render persona capabilities as glyphs with sigils, totems, dimension panels, and content auras. `GlyphCard` is the headline composition. `dimMeta` is the typed metadata registry (icon, color, labelKey, optional custom SVG art per dimension). `cron.ts` includes a cron humanizer used by trigger-displaying surfaces.

**Files:**
- `src/features/shared/glyph/GlyphCard.tsx`
- `src/features/shared/glyph/GlyphGrid.tsx`
- `src/features/shared/glyph/InteractiveSigil.tsx`
- `src/features/shared/glyph/SigilPetal.tsx`
- `src/features/shared/glyph/ChannelTotem.tsx`
- `src/features/shared/glyph/ConnectorTotem.tsx`
- `src/features/shared/glyph/DimensionPanel.tsx`
- `src/features/shared/glyph/GlyphQuestionPanel.tsx`
- `src/features/shared/glyph/types.ts`
- `src/features/shared/glyph/dimMeta.ts`
- `src/features/shared/glyph/dimContent.tsx`
- `src/features/shared/glyph/dimArt/DimAuras.tsx`
- `src/features/shared/glyph/channels.ts`
- `src/features/shared/glyph/triggers.ts`
- `src/features/shared/glyph/cron.ts`
- `src/features/shared/glyph/index.ts` (barrel)

**Entry points:** src/features/shared/glyph/GlyphCard.tsx, src/features/shared/glyph/dimMeta.ts

**Keywords:** glyph, sigil, dimension, capability, persona visual, totem, aura, cron humanizer

**Tech stack:** React, TypeScript

---
