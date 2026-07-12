> Context: shared/glyph [1/2]
> Total: 8
> Critical: 0  High: 0  Medium: 4  Low: 4

## 1. humanizeCron silently misrepresents multi-value hour / day-of-week fields
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/features/shared/glyph/cron.ts:10-36
- **Scenario**: For `0 9,17 * * *` (twice daily), `timeStr` runs `parseInt("9,17",10)` → `9`, so the `dom==='*' && mon==='*' && dow==='*' && timeStr` branch returns `"Daily · 09:00"` — it drops the 17:00 run entirely. Same failure for day ranges: `30 9 * * 1-5` written as an explicit list works, but `30 9 * * 1-3` hits the dow loop where `parseInt("1-3",10)` → `1`, yielding just `"Mon · 09:30"` (Tue/Wed lost).
- **Root cause**: `parseInt` truncates at the first non-digit, so comma-lists and ranges in the hour/dow fields collapse to their first element; the code assumes single-valued fields.
- **Impact**: UX / trust — the file's own docstring promises "we never lie about intent," yet the human-readable schedule understates how often the trigger fires. A user reading "Daily · 09:00" won't expect the 17:00 execution.
- **Fix sketch**: When `hour` (or `dow`) contains `,` or `-`, skip the single-time branches and fall through to the raw cron (honest) — or expand the list explicitly (e.g. `"09:00, 17:00"`). At minimum guard the `timeStr` branch with `!hour.includes(',') && !hour.includes('-')`.

## 2. DimensionPanel is not keyed by `dim` — refine text and "show more" bleed across petals
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: state-corruption
- **File**: src/features/shared/glyph/GlyphCard.tsx:189-203, src/features/shared/glyph/DimensionPanel.tsx:37, src/features/shared/glyph/dimContent.tsx:37
- **Scenario**: The sigil stays partly clickable while a panel is open (petals outside the `inset-x-6 top-16 bottom-24` overlay). Click petal → type a refine message for `task` → click a still-exposed `connector` petal directly (activeDim goes 'task'→'connector', both truthy). `<AnimatePresence>{activeDim && <DimensionPanel dim={activeDim}/>}</AnimatePresence>` has no `key`, so React reuses the same instance: `refineText` (DimensionPanel:37) and `showAll` (dimContent:37) survive the switch, and `onRefine` now targets `connector` while showing text authored for `task`.
- **Root cause**: DimContent's comment claims "the panel remounts per dim (AnimatePresence), so the expansion state naturally resets" — but AnimatePresence only tracks the presence of one unkeyed child, it does not remount on a prop change. The premise is false.
- **Impact**: data/UX — a refine feedback string can be dispatched against the wrong dimension; stale "show all" carries over.
- **Fix sketch**: Add `key={activeDim}` to `<DimensionPanel>` in GlyphCard so a dim change forces a remount (resetting refineText + showAll + the focus effect), or lift `refineText` reset into a `useEffect(..., [dim])`.

## 3. Duplicate `CELL_KEY_TO_DIM` map re-declared instead of importing the canonical one
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src/features/shared/glyph/GlyphQuestionPanel.tsx:11-22 (vs src/features/shared/glyph/persona-sigil/cellDimMap.ts:19-29)
- **Scenario**: `cellDimMap.ts` explicitly documents itself as "the single source of truth" for the cell-key→dim contract, yet `GlyphQuestionPanel.tsx` hand-rolls its own `CELL_KEY_TO_DIM` literal. Verified the local copy is never imported from the canonical file and is missing the `"sample-output": "task"` entry the canonical map carries — so a `sample-output` question would tint with the fallback `#60a5fa` instead of the task colour.
- **Root cause**: Copy-paste of the mapping predating (or ignoring) the cellDimMap consolidation.
- **Impact**: maintainability + latent tint bug — two maps drift; the panel already lacks one key.
- **Fix sketch**: Delete the local literal; `import { CELL_KEY_TO_DIM } from './persona-sigil/cellDimMap'` (or the barrel) and use it directly.

## 4. sigilEditBodies renders hardcoded English in a 14-locale app
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: i18n-regression
- **File**: src/features/shared/glyph/persona-layout/sigilEditBodies.tsx:36-108
- **Scenario**: Every user-facing string in this file is a raw English literal — `"No trigger configured on this capability."`, `"When"`, `"Channels"`, `"Persistent memory is on for this capability."`, `"Human review is required before this capability acts."`, etc. Every sibling in this context routes copy through `useTranslation()`/`useGlyphDimText()`. Verified: the file imports no i18n and takes no `Translations` arg.
- **Root cause**: "read-only body, editing is the next slice" scaffolding that shipped without wiring translation keys.
- **Impact**: UX — non-English users see English body text in the petal edit modal; also blocks the catalog parity check.
- **Fix sketch**: Thread `t` (or the relevant `t.agents.*` section) into `resolveSigilEditBody` and replace each literal with a translation key; the on/off `labels` record maps cleanly onto per-dim key pairs.

## 5. Two competing dimension-label sources risk drift across the same sigil
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/features/shared/glyph/SigilLegend.tsx:84 & src/features/shared/glyph/persona-layout/PersonaSigilSummary.tsx:110 (via `useGlyphDimText` → `t.agents.glyph_dim_label`) vs src/features/shared/glyph/InteractiveSigil.tsx:245 & GlyphCard.tsx:63 & GlyphHeroSigil.tsx:184 (via `c[DIM_META[dim].labelKey]` → `t.templates.chronology`)
- **Scenario**: The same eight dimensions are labelled from two different translation catalogs depending on which sub-component renders. On one card the hover header/petal aria come from `templates.chronology` while the footer legend chips come from `agents.glyph_dim_label`. If the two catalogs disagree (e.g. "When" vs "Trigger"), the legend and the header name the same petal differently.
- **Root cause**: `useGlyphDimText` was introduced for the persona-sigil surface but the card surface still reads `DIM_META.labelKey`; neither was retired.
- **Impact**: maintainability / UX consistency — label edits must be made in two places to stay in sync.
- **Fix sketch**: Pick one source (the `useGlyphDimText` hook already has an English fallback) and route all petal/legend/header labels through it, or make `DIM_META.labelKey` resolve from the same catalog.

## 6. EmptyCapabilitySigil renders a dead, invisible petal map
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src/features/shared/glyph/CapabilitySigil.tsx:261-272
- **Scenario**: The first `GLYPH_DIMENSIONS.map` builds a `<g opacity={0}>` per dim containing only a `fill="none"` path and an empty `<g transform=... />`; it computes `x`/`y` that are never used (the inner group has no children). The visible petals come from the *second* map (dots) at lines 274-287. The first map paints nothing.
- **Root cause**: Leftover wedge-rendering scaffold kept "for consistency" but zeroed out.
- **Impact**: maintainability — 8 no-op SVG groups + unused trig each render; misleads readers into thinking wedges are drawn.
- **Fix sketch**: Delete the first `GLYPH_DIMENSIONS.map` block entirely (lines 261-272); the dots map already covers the empty-state visual.

## 7. PetalRow tooltip/aria fall back to a raw i18n key and dim slug
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/features/shared/glyph/persona-layout/PetalRow.tsx:50,54
- **Scenario**: `Tooltip content={tooltip ?? meta.labelKey}` and `aria-label={ariaLabel ?? dim}`. `meta.labelKey` is the translation *key* (e.g. `"trigger_label"`), not a translated string. Any caller that omits `tooltip` shows the raw key `"trigger_label"` in the tooltip; omitting `ariaLabel` announces the bare slug `"trigger"` to screen readers.
- **Root cause**: The fallback uses the key metadata rather than a resolved label (the component has no `t` in scope, unlike its siblings which use `useGlyphDimText`).
- **Impact**: UX / a11y — leaks internal key strings if a caller forgets the optional props.
- **Fix sketch**: Bring in `useGlyphDimText()` and fall back to `dimText.label[dim]`; keep `dim` only as a last resort for aria.

## 8. prettyTriggerType has no `event` case though the icon map supports it
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/features/shared/glyph/triggers.ts:37-49 (vs 22-31)
- **Scenario**: `TRIGGER_ICONS` maps both `event` and `event_listener` → `Activity`, but `prettyTriggerType`'s switch handles only `event_listener`. A trigger whose `trigger_type === 'event'` (an accepted key per the icon map) returns the raw `"event"` string as its label instead of `c.trigger_event`.
- **Root cause**: The Wave-5 icon consolidation unified `event`/`event_listener` for icons but the label switch wasn't updated to accept both.
- **Impact**: UX — an untranslated, lowercase `"event"` label appears where a localized name is expected.
- **Fix sketch**: Add `case 'event':` alongside `case 'event_listener':` returning `c.trigger_event`.
