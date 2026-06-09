# UI Perfectionist — creative-productivity-plugins
> Total: 6
> Severity: 1 critical, 2 high, 2 medium, 1 low

## 1. Three plugins use three different empty-state systems — they read as three products
- **Severity**: high
- **Category**: visual-consistency
- **File**: src/features/plugins/artist/sub_gallery/GalleryPage.tsx:180; src/features/plugins/drive/components/DriveEmptyHint.tsx:69; src/features/plugins/obsidian-brain/sub_browse/BrowsePanel.tsx:151
- **Scenario**: A user with all three plugins installed sees an Obsidian "no vault" state built from the shared `EmptyState` (14×14 rounded-xl icon badge, `typo-heading-lg`, pill CTA), a Drive empty folder built from `DriveEmptyHint` (dashed-border card, *italic* text, cyan gradient CTA), and an Artist empty gallery built from raw inline JSX (a 14×14 `rounded-2xl` rose square, `typo-section-title`, **no CTA at all**). Same conceptual moment, three unrelated visual languages.
- **Root cause**: There is a canonical `src/features/shared/components/feedback/EmptyState.tsx` (used by Obsidian), but Drive forked its own `DriveEmptyHint` primitive and Artist hand-rolls empties inline in `GalleryPage` (180-197), `CreativeStudioPanel` (352-375) and `Gallery3D` (217-227). Nothing enforces a shared treatment across the context.
- **Impact**: inconsistency
- **Fix sketch**: Adopt the shared `EmptyState` in Artist's gallery empty (replace lines 180-197) and give it an action (`scanAndImport`) so it matches Drive/Obsidian's actionable empties. Longer term, reconcile `DriveEmptyHint` with `EmptyState` (or have `DriveEmptyHint` wrap it) so dashed-vs-solid and italic-vs-roman stop diverging. At minimum the three empties should share icon-badge geometry, type ramp, and "has a primary CTA" behavior.

## 2. Artist gallery has no error state — a failed asset load shows the same UI as "no images"
- **Severity**: high
- **Category**: missing-state
- **File**: src/features/plugins/artist/sub_gallery/GalleryPage.tsx:176-197
- **Scenario**: If `useArtistAssets` fails (scan throws, watch folder unreadable, IPC error), the gallery cannot distinguish failure from emptiness: it renders `loading ? "Loading…" : filteredAssets.length === 0 ? <empty> : grid`. The user sees "No images yet — scan to import," scans, it fails again, and they get the same screen with no error surfaced. Compare Drive's `DriveFileList.tsx:333` which renders a dedicated `error_prefix` branch, and Obsidian's `BrowsePanel.tsx:202` `failed_to_load`.
- **Root cause**: The hook's loading/empty are wired but there is no `error` branch in the render ternary; failures are error-blind.
- **Impact**: error-blind
- **Fix sketch**: Surface an `error` value from `useArtistAssets` and add a third branch before the empty check (mirror Drive's `error_prefix` row or use `EmptyState` with a retry action wired to `scanAndImport`). The scan button at 156-164 should also visibly reflect a failed scan, not just stop spinning.

## 3. Per-image delete is instant and destructive with no confirm and an off-palette color
- **Severity**: critical
- **Category**: visual-hierarchy
- **File**: src/features/plugins/artist/sub_gallery/AssetCard.tsx:161-170
- **Scenario**: Hovering any gallery card reveals a trash button that deletes the asset on a single click with **no confirmation** (`onClick={() => onDelete(asset.id)}`). The bulk delete path goes through `GallerySelectionBar`, but the single-card delete does not. The same app's Drive plugin *always* routes deletes through `DriveConfirm` (`DrivePage.tsx:651`), so behavior for "delete a file" is inconsistent and the single-image path is the dangerous one.
- **Root cause**: Hover-overlay action calls the destructive handler directly; no guard, and the button is tinted `bg-red-500/20 text-red-400` while the rest of the card system uses the rose accent (`rose-500`) — so even the danger color is off-palette versus `pluginTheme.ts` artist accent (`244 63 94` = rose).
- **Impact**: confusion (accidental data loss) + inconsistency
- **Fix sketch**: Route single-card delete through the same confirm dialog pattern Drive uses (or an undo toast). Normalize the trash button to the rose danger palette so it stops mixing `red-500` and `rose-500` within one surface. The tag and send-to-studio buttons (172-192) similarly use blue/rose ad-hoc — pull them onto a shared hover-action token.

## 4. Hover-overlay card actions are mouse-only and not keyboard/AT reachable
- **Severity**: medium
- **Category**: accessibility
- **File**: src/features/plugins/artist/sub_gallery/AssetCard.tsx:158-193
- **Scenario**: The delete / edit-tags / send-to-media-studio buttons live inside a `group-hover:opacity-100 … group-hover:pointer-events-auto` overlay. A keyboard or screen-reader user can never reveal them (no `:focus-within` escape hatch), and the three buttons carry only `title=` — no `aria-label` — so even if reached they are weakly announced. The selection checkbox (118-135) is correctly done with `aria-label`/`aria-pressed`, which highlights the inconsistency.
- **Root cause**: Actions gated purely on pointer hover with no focus-visibility fallback and missing `aria-label`s.
- **Impact**: inaccessible
- **Fix sketch**: Add `group-focus-within:opacity-100 group-focus-within:pointer-events-auto` to the overlay (160) so Tab reveals it, and add `aria-label` to the three action buttons (matching the `title` text). This brings the card in line with the lightbox controls in `Gallery2D.tsx`, which are fully `aria-label`led.

## 5. Suspense / loading fallbacks differ per plugin — Artist flashes blank, Obsidian spins, Drive pings
- **Severity**: medium
- **Category**: missing-state
- **File**: src/features/plugins/artist/ArtistPage.tsx:48,68; src/features/plugins/obsidian-brain/ObsidianBrainPage.tsx:31; src/features/plugins/drive/components/DriveFileList.tsx:1095
- **Scenario**: Switching into a lazy Artist sub-tab renders `Suspense fallback={null}` — the panel area goes blank until the chunk loads. The identical action in Obsidian shows a centered `LoadingSpinner` with a label; Drive's list shows a cyan ping dot + "Loading." So the same "panel is loading" moment is invisible in one plugin and clearly communicated in the other two.
- **Root cause**: `ArtistPage` passes `fallback={null}` to both `Suspense` boundaries instead of the shared `LoadingSpinner` the sibling plugins use.
- **Impact**: unpolished (perceived hang)
- **Fix sketch**: Give Artist's two `Suspense` boundaries the same centered `LoadingSpinner` fallback Obsidian uses (`ObsidianBrainPage.tsx:31`), so chunk loads read as deliberate loading rather than a stutter.

## 6. Gallery toolbar select/sort uses bespoke controls that drift from the rest of the toolbar
- **Severity**: low
- **Category**: polish
- **File**: src/features/plugins/artist/sub_gallery/GalleryPage.tsx:114-142
- **Scenario**: Inside the sort cluster the native `<select>` (114-122) sits beside two 36×36 (`w-9 h-9`) icon buttons; the mode-toggle buttons above are `px-2.5 py-1.5` and the search input is `py-1.5`, so the toolbar contains three different control heights packed into pill containers. The sort-direction button's `title` is also hardcoded to `t.plugins.artist.sort_date` for **both** asc and desc (125), so the tooltip is wrong half the time.
- **Root cause**: Native `<select>` and ad-hoc icon-button sizing mixed into a single toolbar with no shared control-height token; copy/paste left a stale `title` ternary that returns the same key on both branches.
- **Impact**: unpolished
- **Fix sketch**: Normalize control heights across the toolbar row (one shared `h-9`/`py-1.5` token), and fix the sort-direction `title` to use ascending/descending copy (the `aria-label` at 126 already does this correctly — reuse it). Consider a styled segmented control for sort to match the mode-toggle so the toolbar reads as one component family.
