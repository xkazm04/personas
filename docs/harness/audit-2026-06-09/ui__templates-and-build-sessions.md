# UI Perfectionist — templates-and-build-sessions
> Total: 6
> Severity: 1 critical, 3 high, 2 medium

## 1. Preset card accent strip uses a non-existent class on a non-positioned parent
- **Severity**: critical
- **Category**: visual-consistency
- **File**: src/features/templates/sub_presets/PresetLibraryPage.tsx:107-112
- **Scenario**: Every preset card in the Presets catalog is supposed to show a thin colored accent bar pinned to the top edge (the preset's brand color). It never appears where intended — instead a 2px colored line floats inline above the content with a stray `mb-3` gap.
- **Root cause**: The strip element has `className="absolute-top-strip ..."`, but `absolute-top-strip` is not defined in any CSS file (verified: zero matches outside this one usage), so it resolves to nothing. Even if it were meant to be `absolute top-0 left-0 right-0`, the parent `<button>` (line 103) has no `relative` positioning, so an absolutely-positioned strip would escape the card entirely.
- **Impact**: inconsistency / unpolished — the signature color affordance that visually distinguishes presets is silently broken across the whole catalog.
- **Fix sketch**: Add `relative` to the card `<button>` className, then replace `absolute-top-strip ... mb-3` with `absolute top-0 inset-x-0 rounded-t-modal` (drop `mb-3`). Or, if an inline top rule was actually intended, drop the dead class and keep it as a deliberate `mb-3` divider — but the comment "absolute-top-strip" signals the former.

## 2. n8n import buttons hand-roll the design system's `accent`/`primary` variants
- **Severity**: high
- **Category**: component-extraction
- **File**: src/features/templates/sub_n8n/steps/upload/N8nUploadStep.tsx:172, 213-224, 266-280, 294; src/features/templates/sub_n8n/widgets/N8nWizardFooter.tsx:84-180
- **Scenario**: The presets flow uses the shared `<Button>` everywhere, but the entire n8n wizard (mode tabs, Fetch, Import, Continue, Back, Test, Build Persona, primary CTA) is built from raw `<button>` elements with copy-pasted `bg-violet-500/20 text-violet-300 border border-violet-500/30 hover:bg-violet-500/30` strings and bespoke `px-4 py-2.5` padding that doesn't match any `SIZE_CLASSES` entry.
- **Root cause**: `Button.tsx` already ships exactly these surfaces: `variant="accent" accentColor="violet"` and `variant="primary"`. The n8n widgets predate or ignore the shared component, duplicating its styling by hand in 8+ places.
- **Impact**: inconsistency — violet tints, radii, and padding drift from the rest of the app and from the sibling presets flow; any future token change to the accent surface won't reach these buttons.
- **Fix sketch**: Replace the raw buttons with `<Button variant="accent" accentColor="violet" size="md">` (or `primary` for the filled CTAs) and let `disabled` drive the disabled surface. Keeps tactile `active:scale`, focus rings, and tooltip behavior for free.

## 3. Raw clickable buttons in the n8n flow lack the focus-visible ring the shared Button provides
- **Severity**: high
- **Category**: accessibility
- **File**: src/features/templates/sub_n8n/widgets/N8nWizardFooter.tsx:84-91, 114-135, 165-180; src/features/templates/sub_n8n/steps/upload/N8nUploadStep.tsx:57-69, 213, 266
- **Scenario**: A keyboard user tabbing through the n8n wizard footer (Back, Test Persona, Build, primary CTA) and the mode tabs gets no visible focus indicator — focus is invisible on these controls. The dropzone (line 144) and the shared `Button` both have `focus-visible:ring-*`, so the inconsistency is jarring within the same screen.
- **Root cause**: These hand-rolled `<button>`s set only `transition-colors`/hover states; none include `focus-visible:ring-*` or `focus-visible:outline-*`. The design system's `Button` includes a focus ring by default, which is why the gap is invisible until you switch to keyboard nav.
- **Impact**: inaccessible — fails WCAG 2.4.7 (Focus Visible) for the primary build-session navigation.
- **Fix sketch**: Migrating to `<Button>` (finding #2) resolves this. If kept raw, add `focus-visible:ring-2 focus-visible:ring-violet-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background` to each.

## 4. Hard-coded English UI strings break i18n consistency
- **Severity**: high
- **Category**: visual-consistency
- **File**: src/features/templates/sub_n8n/steps/N8nImportTab.tsx:116, 138; src/features/templates/sub_n8n/steps/N8nSessionList.tsx:79, 282; src/features/templates/sub_n8n/steps/upload/PreviewCard.tsx:45; src/features/templates/sub_n8n/steps/N8nParserResults.tsx:158-166
- **Scenario**: In a screen where literally every other label flows through `t.templates.n8n.*`, a handful of strings are hard-coded: the error/warning banner "Dismiss" buttons, the session-card "Retry" badge, the error-recovery "Retry" button, the preview "{n} element(s)" pluralization, and the selection-summary "tools / triggers / connectors / selected for import". A non-English locale will see English fragments mid-sentence.
- **Root cause**: Inline literals instead of translation keys; the pluralization in PreviewCard (`element{...!== 1 ? 's' : ''}`) also hand-codes English plural rules that `tx(...)` count interpolation already handles elsewhere (see ToolsSection's `tx(tools_header, { count })`).
- **Impact**: inconsistency / partially inaccessible to non-English users — mixed-language UI on a localized surface.
- **Fix sketch**: Add `t.templates.n8n.dismiss`, `.retry`, `.element_count` (with `tx` count form), and reuse the existing `tools_header`/`triggers_header`/`connectors_header` count keys for the selection summary chips.

## 5. n8n session list has loading + error states but no empty state
- **Severity**: medium
- **Category**: missing-state
- **File**: src/features/templates/sub_n8n/steps/N8nSessionList.tsx:253-257
- **Scenario**: When a user opens the n8n import tab with no in-progress imports (the common case for a returning user who finished previous imports), the "Previous imports" section simply returns `null` — there's no "No saved imports yet" message and no heading. By contrast the presets page (PresetLibraryPage.tsx:43-53) ships a polished empty state with icon + title + hint. The two sibling browse surfaces feel inconsistent.
- **Root cause**: `if (sessions.length === 0 ...) return null` and the same for `activeSessions` — a deliberate hide, but it leaves a returning user with no acknowledgement that the list is intentionally empty vs. failed to load.
- **Impact**: unpolished / inconsistency — silent emptiness reads as "is this broken?" relative to the presets empty state.
- **Fix sketch**: When there are zero active sessions (and no error), render a compact empty hint matching the presets pattern (Clock/History icon + `t.templates.n8n.no_previous_imports`) rather than `null`, or keep `null` only on the very first import and show the hint once the user has a history.

## 6. Selection-summary count chips are decorative text with no semantic/contrast affordance
- **Severity**: medium
- **Category**: polish
- **File**: src/features/templates/sub_n8n/steps/N8nParserResults.tsx:154-168
- **Scenario**: After analysis, the "N tools / N triggers / N connectors selected for import" summary uses `text-foreground` on tinted pills, but the trailing "selected for import" label is also `text-foreground` with no de-emphasis, and the counts don't update with an aria-live region when the user toggles items below — a screen-reader user toggling a tool checkbox gets no announcement that the count changed.
- **Root cause**: Static text summary that mirrors live selection state but isn't wired to `aria-live`, plus uniform foreground color giving the row no visual hierarchy between the count chips and the explanatory suffix.
- **Impact**: unpolished / error-blind for AT users — the count is the feedback that toggling worked, but it's silent to screen readers.
- **Fix sketch**: Wrap the summary row in `aria-live="polite"` so count changes announce, and de-emphasize the "selected for import" suffix to `text-foreground/60` so the numeric chips read as the primary information.
