# UI Perfectionist — creative-productivity-plugins (2026-06-13)

> Total: 9 findings (1 critical, 4 high, 3 medium, 1 low)

Scope reviewed: `artist/ArtistPage.tsx` (+ `sub_blender/CreativeStudioPanel.tsx`, `sub_gallery/GalleryPage.tsx`), `drive/DrivePage.tsx` (+ `components/*`), `obsidian-brain/ObsidianBrainPage.tsx` (+ `sub_setup/SetupPanel.tsx`, `sub_cloud/CloudSyncPanel.tsx`). The dominant theme is **cross-plugin drift**: the Obsidian plugin is a model citizen (uses `SectionCard`, `SettingRow`, `LoadingSpinner`, `EmptyState`, `ActivityDot`, `focus-ring`), while the Artist plugin hand-rolls nearly every primitive and the Drive plugin maintains its own private mini-design-system that duplicates the catalog.

---

## 1. Artist plugin hand-rolls the entire UI vocabulary the catalog already provides
- **Severity**: critical
- **Category**: reuse
- **File**: src/features/plugins/artist/sub_blender/CreativeStudioPanel.tsx:142, :176, :225, :366, :407 (and GalleryPage.tsx:81–188)
- **Problem**: Systemic across the whole Artist surface. `CreativeStudioPanel` contains 8 raw `<button>` elements, zero `focus-ring`, a custom `StatusDot` (line 450) and `StatusRow` (line 456) that duplicate the catalog `StatusDot`, and hand-built collapsible/refresh chips — none of which exist in the design system as bespoke. Compare to `obsidian-brain/SetupPanel.tsx`, which renders the *same kinds* of buttons/toggles/status via `Button`-style classes with `focus-ring`, `SettingRow`, `ActivityDot`, and `LoadingSpinner`. A user moving from the Obsidian tab to the Artist tab in the same app sees a visibly different, lower-fidelity button language. This is the #1 catalog-deviation issue in the reference.
- **Fix sketch**: Replace raw `<button>` with `@/features/shared/components/buttons/Button` (variants: `secondary` for Refresh/Check, `danger`/`accent` for Install/Send, `ghost` icon for Copy/Clear). Replace the local `StatusDot`/`StatusRow` with catalog `StatusDot` + `SettingRow`/status row pattern. Every interactive element must carry `focus-ring` (currently 0 occurrences in the file).

## 2. Hand-rolled spinners instead of `LoadingSpinner` across Artist
- **Severity**: high
- **Category**: reuse
- **File**: src/features/plugins/artist/sub_blender/CreativeStudioPanel.tsx:118, :147, :161, :181; src/features/plugins/artist/sub_gallery/GalleryPage.tsx:163
- **Problem**: Loading/working states use `RefreshCw …animate-spin` / `Download …animate-bounce` / `FolderSearch …animate-spin` as ad-hoc spinners. The catalog ships `LoadingSpinner` (canonical spinner with size + a11y label) — which the Obsidian plugin uses correctly (`SetupPanel.tsx:204, :258, :375`; `CloudSyncPanel.tsx:4`). Three plugins in the same product spin three different ways; the Artist spinners also have no accessible label.
- **Fix sketch**: Swap the inline `animate-spin` icons for `<LoadingSpinner size="sm" />`. For the in-button busy state, adopt `AsyncButton` (catalog: "shows a spinner + disables itself while an async onClick is in flight") for Check/Install/Send.

## 3. Three plugins, three different empty-state designs — none use catalog `EmptyState`
- **Severity**: high
- **Category**: reuse
- **File**: src/features/plugins/drive/components/DriveEmptyHint.tsx:69 (whole component); src/features/plugins/artist/sub_blender/CreativeStudioPanel.tsx:352
- **Problem**: Drive ships its own ~110-line `DriveEmptyHint` (dashed card + cyan icon square + italic text) with a private 3-size system; Artist hand-builds a separate empty block (rose `w-12 h-12` rounded icon + example chips); Obsidian correctly imports `EmptyState` (`CloudSyncPanel.tsx:5`). Same product, three unrelated "nothing here yet" visuals. The Drive component's docstring even acknowledges it is re-inventing a shared primitive ("Shared … primitive for the drive plugin").
- **Fix sketch**: Migrate both Drive and Artist to `@/features/shared/components/feedback/EmptyState` (it already supports icon/title/body/CTA, the exact props `DriveEmptyHint` exposes). If size variants are genuinely needed, push them into the catalog `EmptyState` rather than maintaining a plugin fork.

## 4. Drive re-implements a confirm dialog instead of catalog `ConfirmDialog`
- **Severity**: high
- **Category**: reuse
- **File**: src/features/plugins/drive/components/DrivePrompt.tsx:18 (`DriveConfirm`)
- **Problem**: `DriveConfirm` builds confirm/cancel-on-`BaseModal` from scratch with its own raw `<button>`s and bespoke danger styling (`bg-rose-500/25 …` vs `bg-sky-500/25 …`). The catalog ships `ConfirmDialog` ("Confirm/cancel dialog for destructive or irreversible actions") for exactly this. The delete/empty-trash flows (`DrivePage.tsx:735, :747`) are the most destructive actions in the plugin and they render through a one-off dialog whose button styling matches nothing else.
- **Fix sketch**: Replace `DriveConfirm` with `ConfirmDialog`, passing `danger`, title, and the `DeleteBreakdown` node as body. Removes a whole file and aligns destructive-action affordance with the rest of the app.

## 5. Drive `BulkChip` is a hand-rolled button with raw cyan/rose status colors
- **Severity**: high
- **Category**: token
- **File**: src/features/plugins/drive/DrivePage.tsx:811 (`BulkChip`), plus header pill :503–:545
- **Problem**: The selection toolbar pill is built from raw `<button>` + literal `text-cyan-100 / bg-cyan-500/25 / text-rose-100 / bg-rose-500/30 / shadow-[0_0_14px_-6px_rgba(34,211,238,0.55)]` everywhere. None of this routes through `statusTokens` (the single source of truth for status color) or the catalog `Button`; the danger tone reinvents what `Button variant="danger"` already encodes. The hard-coded cyan/rose also won't follow `themeStore` if the theme changes. The same raw-color pattern repeats in `DeleteBreakdown` (:799) and `DriveTrashBanner` (:26–:46).
- **Fix sketch**: Build `BulkChip` on catalog `Button` (size `xs`, `ghost`/`danger` variants). Move the cyan accent to a theme/`primary` token and the destructive tint to `statusTokens.error`. The bare-numeric counts (`tabular-nums`) should use the catalog `Numeric` formatter.

## 6. Artist status colors bypass `statusTokens` (15 raw semantic-color usages)
- **Severity**: medium
- **Category**: token
- **File**: src/features/plugins/artist/sub_blender/CreativeStudioPanel.tsx:130, :207–:209, :290, :433–:437, :478
- **Problem**: Success/error/warning/info are expressed as raw Tailwind (`text-emerald-400`, `text-red-400`, `text-amber-400`, `text-blue-400`) in ~15 places — the "Ready" label, connector check/x icons, streaming dot, and the `OutputLine` severity map. `statusTokens.ts` exists precisely so success=emerald / error=red / warning=amber render identically and theme-safely everywhere. The `OutputLine` map (user=rose, tool=blue, milestone=emerald, error=red, system=amber) is a private, undocumented status vocabulary.
- **Fix sketch**: Replace literal colors with `statusTokens.success/error/warning/info` (`.text`/`.icon` classes). Drive the `OutputLine` severity → class mapping off the same tokens so log severity colors match status colors app-wide.

## 7. Artist collapse affordance uses text glyphs `▲ / ▼` instead of an icon
- **Severity**: medium
- **Category**: polish
- **File**: src/features/plugins/artist/sub_blender/CreativeStudioPanel.tsx:150
- **Problem**: The Environment Status panel signals expand/collapse with literal `{expanded ? '▲' : '▼'}` unicode glyphs in a `<span>`. These render at the surrounding font size/baseline (mis-aligned, weight-inconsistent) and don't match the `ChevronDown`-style icons the rest of the app — and the Obsidian plugin's `SectionCard collapsible` — use. The whole collapsible header is also a hand-built `role="button"` rather than reusing `SectionCard`.
- **Fix sketch**: Replace the glyph with a lucide `ChevronDown` (rotated on `expanded`), or better, wrap the whole block in catalog `SectionCard collapsible` (as `obsidian-brain/SetupPanel.tsx:195` does) and delete the custom header entirely.

## 8. Artist relies on `title=`-only affordances and unlabeled icon buttons
- **Severity**: medium
- **Category**: a11y
- **File**: src/features/plugins/artist/sub_blender/CreativeStudioPanel.tsx:334 (Clear), :399 (Cancel), :407 (Send)
- **Problem**: The Clear (`Trash2`), Cancel (`Square`), and Send (`Send`) icon-only buttons rely on `title=` for their meaning; Clear/Cancel/Send have no `aria-label`, and none use `focus-ring`, so they're invisible to keyboard focus and screen readers. The reference flags `title=` where `Tooltip` belongs and icon-only buttons without labels as quality defects. (The Copy button at :329 does add `aria-label` — inconsistent within the same toolbar.)
- **Fix sketch**: Give every icon-only button an `aria-label`, add `focus-ring`, and route hover hints through the catalog `Tooltip` instead of `title=`. Adopting `Button variant="ghost"` (icon size) gets focus-ring + a11y baseline for free.

## 9. `formatBytes` reimplemented inline instead of catalog `Numeric`/byte formatter
- **Severity**: low
- **Category**: reuse
- **File**: src/features/plugins/obsidian-brain/sub_cloud/CloudSyncPanel.tsx:19
- **Problem**: A local `formatBytes` with hand-rolled `.toFixed(1)` thresholds. The reference calls out `toFixed`/`toLocaleString` as deviations from the shared `Numeric` number formatter, and byte formatting is common enough that the catalog/`@/lib` likely owns it. Per-plugin byte math drifts in rounding/units (Drive's details pane formats sizes too).
- **Fix sketch**: Use the shared `Numeric` component / a `lib/format` byte helper so KB/MB/GB rounding is consistent between Drive and Obsidian Cloud Sync.
