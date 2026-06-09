# UI Perfectionist — persona-authoring-editor
> Total: 6
> Severity: 1 critical, 2 high, 2 medium, 1 low

## 1. Persona name field has no required/validation/error affordance
- **Severity**: critical
- **Category**: missing-state
- **File**: src/features/agents/sub_settings/components/PersonaSettingsTab.tsx:94-101
- **Scenario**: The user clears the persona name in the identity card. The field looks fine, the status bar flips to "All saved", and the autosave silently persists an empty name. The persona then renders as a blank chip everywhere (sidebar, empty-state resume row, header title) with no indication anything is wrong.
- **Root cause**: The `name` input is a plain `INPUT_FIELD` with no `required`, no `aria-required`, no empty-value guard, and no error state — even though the design-token layer already ships `INPUT_FIELD_ERROR` / `inputFieldClass(hasError)` (designTokens.ts:106-112) and the autosave (`useEditorSave.performSettingsSave`) writes `name` unconditionally. Name is the one truly required field of the whole editor and it is the only one with zero validation.
- **Impact**: error-blind — invalid (empty) state is saved without any feedback, producing nameless personas downstream.
- **Fix sketch**: Derive `const nameError = draft.name.trim() === ''`. Apply `className={inputFieldClass(nameError)}`, set `aria-invalid={nameError}` and `aria-describedby="persona-name-error"`, render a small `text-red-400 typo-caption` message below ("Name is required"), and gate the name half of the autosave (skip the IPC while empty, keep the prior baseline) so an empty name can never overwrite a valid one.

## 2. Identity inputs are not programmatically tied to their labels
- **Severity**: high
- **Category**: accessibility
- **File**: src/features/agents/sub_settings/components/PersonaSettingsTab.tsx:94-136
- **Scenario**: A keyboard/screen-reader user tabs into the Settings tab. The name `<input>`, description `<textarea>`, icon-picker button, and color picker each have a visible `<label>`, but the labels are bare text with no `htmlFor`. Clicking a label does not focus its control, and assistive tech announces the inputs without their names.
- **Root cause**: Labels use `<label className="block …">{text}</label>` with no `htmlFor`/`id` pairing. This is inconsistent with the sibling form `PersonaParametersCard.tsx:117-121`, which correctly pairs `htmlFor={\`param-${param.key}\`}` with `id` on every editor — so the right pattern already exists in-scope and is simply not applied here.
- **Impact**: inaccessible — labels not associated, larger click target lost, fails WCAG 1.3.1/4.1.2.
- **Fix sketch**: Add `id="persona-name"` / `htmlFor="persona-name"` (and likewise for description, icon button, color picker), mirroring the parameter-card pattern. Give the icon-only picker button an `aria-label` in addition to its `title`.

## 3. Three divergent visual languages for the same dirty / saving / saved state
- **Severity**: high
- **Category**: visual-consistency
- **File**: src/features/agents/sub_settings/components/SettingsStatusBar.tsx:24-42
- **Scenario**: Within one editor the user sees three different "is it saved?" treatments: the Settings status bar (amber pulsing dot + "Changed" / spinner + "Saving" / emerald check + "All saved"), the per-parameter row in the Design tab ("Saving…" text / green check "Saved" / an "Apply" button — PersonaParametersCard.tsx:127-166), and the tab-bar dirty badge (amber `w-1.5 h-1.5` pulse dot — EditorTabBar.tsx:48). Same concept, three unrelated affordances, so the user must re-learn "saved" per surface.
- **Root cause**: Each form region invented its own dirty/save indicator instead of a shared `SaveStatus` primitive; the amber-dot motif in SettingsStatusBar:33 and the tab badge are even hand-duplicated rather than shared.
- **Impact**: inconsistency — fragmented mental model of save state across the editor.
- **Fix sketch**: Extract a single `<SaveStatus state="saving|dirty|saved" labels={…} />` primitive (dot/spinner/check + text) and consume it in SettingsStatusBar, the parameter rows, and as the tab-bar badge source, so "dirty" and "saved" read identically everywhere.

## 4. Parameter-editor inputs bypass the shared INPUT_FIELD token (focus/border drift)
- **Severity**: medium
- **Category**: visual-consistency
- **File**: src/features/agents/sub_design/components/PersonaParametersCard.tsx:248,262-268
- **Scenario**: The text input and `<select>` in the parameters card look subtly off versus every other editor field: different border (`border-card-border` vs `border-primary/12`), different radius (`rounded-input` vs `rounded-xl`), and on focus they show only `focus:border-primary/40` with `focus:outline-none` — no focus ring — whereas the identity/execution fields use the token's `focus-ring focus-visible:ring-offset-1`.
- **Root cause**: These inputs are hand-styled instead of using the canonical `INPUT_FIELD` constant (designTokens.ts:103) that the Settings tab already uses. The hand-rolled focus style also weakens keyboard-focus visibility.
- **Impact**: unpolished — input styling and focus visibility drift between two tabs of the same editor.
- **Fix sketch**: Replace the inline class strings on the string-`input` and `select` with `INPUT_FIELD` (size variant if needed), restoring the shared ring/offset focus treatment and matching border/radius tokens.

## 5. Repeated section-header + card scaffold duplicated per Settings group
- **Severity**: medium
- **Category**: component-extraction
- **File**: src/features/agents/sub_settings/components/PersonaSettingsTab.tsx:75-80,151-156
- **Scenario**: The Identity and Execution groups (and any future group) each repeat the same markup: an `<h4>` with a gradient bar accent (`<span className="w-6 h-[2px] bg-gradient-to-r from-primary to-accent …" />` + `typo-submodule-header`) followed by a `bg-secondary/40 backdrop-blur-sm border border-primary/20 rounded-modal p-3 space-y-3` card. The same four toggle rows (Enabled/Sensitive/CLI/Langfuse, lines 224-284) also repeat an identical `flex items-center justify-between … typo-body label + AccessibleToggle` row five times.
- **Root cause**: No `<SettingsSection title>` wrapper or `<ToggleRow label desc>` helper — the section chrome and the toggle-row layout are inlined and copy-pasted, so spacing/typography can drift and every new group re-implements the scaffold.
- **Impact**: inconsistency — duplicated markup invites per-group spacing/heading drift and bloats the form.
- **Fix sketch**: Extract `SettingsSection({ title, children })` (header bar + card shell) and `ToggleRow({ label, description?, checked, onChange, … })`; re-author the Identity/Execution groups and the four toggles through them.

## 6. Two inline save-error banners hand-rolled instead of reusing BannerPrimitive
- **Severity**: low
- **Category**: component-extraction
- **File**: src/features/agents/sub_editor/components/EditorBody.tsx:151-173
- **Scenario**: When a tab save fails, the user gets a red banner with a `RefreshCw` icon and a Retry button; a different generic save error shows a near-identical red banner with a spinning icon. Both replicate the `animate-fade-slide-in mx-6 my-2 rounded-modal … bg-red-500/10 border border-red-500/20` shell that `BannerPrimitive` (EditorBanners.tsx:38-61) already standardizes (including a `red` color scheme at line 32-35) and which every other editor banner uses.
- **Root cause**: These two error states were inlined in `EditorBody` instead of routed through the existing `BannerPrimitive` / typed banner components, so the red error banners are the only banners in the editor not sharing the primitive's padding, dismiss affordance, and action layout.
- **Impact**: inconsistency — error banners diverge from the editor's own banner system and can drift on future banner restyles.
- **Fix sketch**: Add a `SaveErrorBanner` (or reuse `BannerPrimitive` with `colorScheme="red"`, an action array for Retry, and the appropriate icon) and render both failure cases through it, matching the unsaved/cloud/partial-load banners.
