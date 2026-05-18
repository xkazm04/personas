import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';
import type { GlyphDimension } from '@/features/shared/glyph';
import type { PetalState } from '@/features/shared/glyph/persona-sigil';
import type { DisplayUseCase } from '@/features/agents/sub_use_cases/components/recipes-prototype/shared/displayUseCase';
import { PersonaHero } from './PersonaHero';
import { UseCaseRow } from './UseCaseRow';

export type PersonaLayoutMode = 'view' | 'adoption' | 'scratch';

/** Compose the CSS Grid template column list for the main grid: narrow
 *  side tracks for `leftSlot` and `rightSlot` (when present), a flexible
 *  main column in between. The bare main column (no slots) skips the
 *  grid entirely so the layout matches the pre-slot version when no
 *  caller opts in.
 *
 *  Sidebar width grows with the breakpoint (220 → 260 → 320 px). At
 *  common 1366-1440 viewports a pair of 320 px tracks ate so much of
 *  the content area that the sigil floored at its minimum size; 220 px
 *  there reads as compact-but-functional and frees ~200 px back to the
 *  sigil column. Wide monitors (2xl+) get the full 320 px back since
 *  the sigil hits its cap with plenty of room to spare. */
function gridClass(leftSlot: unknown, rightSlot: unknown): string {
  if (leftSlot && rightSlot) {
    return 'grid gap-4 lg:gap-6 lg:grid-cols-[220px_minmax(0,1fr)_220px] 2xl:grid-cols-[260px_minmax(0,1fr)_260px] 3xl:grid-cols-[320px_minmax(0,1fr)_320px]';
  }
  if (leftSlot) {
    return 'grid gap-4 lg:gap-6 lg:grid-cols-[220px_minmax(0,1fr)] 2xl:grid-cols-[260px_minmax(0,1fr)] 3xl:grid-cols-[320px_minmax(0,1fr)]';
  }
  if (rightSlot) {
    return 'grid gap-4 lg:gap-6 lg:grid-cols-[minmax(0,1fr)_220px] 2xl:grid-cols-[minmax(0,1fr)_260px] 3xl:grid-cols-[minmax(0,1fr)_320px]';
  }
  return '';
}

interface PersonaLayoutProps {
  /** Drives mode-specific chrome (top/right slots, padding, etc.). */
  mode: PersonaLayoutMode;

  /** Persona identity displayed in the hero band. */
  personaName: string;

  /** Capability rows. Empty array renders the emptyNode (if provided) or
   *  nothing — caller decides what the empty state looks like since it
   *  differs across modes (scratch shows compose textarea, adoption shows
   *  template loading state, view shows EmptyState). */
  items: DisplayUseCase[];

  /** When set, the row with this id renders nothing — the detailNode
   *  takes the full surface. Caller controls the lifecycle. */
  selectedItemId?: string | null;

  /** Currently in-flight toggle target. Drives the power button's disabled
   *  + spinner state on the matching row. */
  pendingToggleId?: string | null;

  /** Per-row handlers. `onRun` is optional — in adoption / scratch
   *  pre-build modes there's no runnable persona, so the row hides its
   *  run button. */
  onRowOpen: (uc: DisplayUseCase) => void;
  onRowToggle: (uc: DisplayUseCase) => void;
  onRowRun?: (uc: DisplayUseCase) => void;

  /** Optional content rendered on the right side of the hero's metadata
   *  band (e.g. persona default model picker). Flows into the band, not
   *  next to the sigil. */
  heroRightSlot?: ReactNode;

  /** Forwarded to PersonaHero.petalStatesOverride. Adoption supplies its
   *  own derivation (pending state for dims with unanswered questions);
   *  view mode omits this and lets the hero compute from useCases. */
  heroPetalStatesOverride?: Record<GlyphDimension, PetalState>;

  /** Forwarded to PersonaHero.onPetalClick. Adoption mode opens the
   *  inline answer card on click; view mode leaves it unset (no-op). */
  onHeroPetalClick?: (dim: GlyphDimension) => void;

  /** Forwarded to PersonaHero.activeDim. Lets the caller control which
   *  petal is "active" when the centerOverlay is open. */
  heroActiveDim?: GlyphDimension | null;

  /** Forwarded to PersonaHero.centerOverlay. Small content inside the
   *  sigil's inner core (e.g. "N questions to answer" count button). */
  heroCenterOverlay?: ReactNode;

  /** Forwarded to PersonaHero.wideOverlay. Wider content overlaying the
   *  sigil stage (e.g. adoption answer card). When set, the
   *  centerOverlay is hidden so they don't compete for visual space. */
  heroWideOverlay?: ReactNode;

  /** Optional slot above the hero — adoption uses this for the
   *  QuestionnaireHeaderBand stepper. */
  topSlot?: ReactNode;

  /** Optional slot to the right of the main column — adoption uses this
   *  for the QuestionnaireStoryThread. Takes 320px on lg+ screens; wraps
   *  below on narrow screens. */
  rightSlot?: ReactNode;

  /** Optional slot to the LEFT of the main column — typically a
   *  PersonaSigilSummary listing the saved value for each dimension. Same
   *  ~320px width as rightSlot, sticks to top on lg+ screens. Wraps to
   *  the top of the column on narrow screens (above the hero). */
  leftSlot?: ReactNode;

  /** When true, skip rendering the persona-name + capabilities band at
   *  the top of the hero. View mode uses this — the sigil + sidebars
   *  carry all the information so the header is redundant. */
  hideMetadataBand?: boolean;

  /** When true, the main column omits its inline capability rows — the
   *  caller is rendering them elsewhere (typically in rightSlot as a
   *  compact list). View mode with a compact capabilities sidebar uses
   *  this to avoid double-rendering. Has no effect when `selectedItemId`
   *  is set (the detail view is mode-independent). */
  hideCapabilityRows?: boolean;

  /** Pass-through to PersonaHero: dim the sigil's petals + show the
   *  orbital progress sweep. Adoption's build phase uses both for parity
   *  with scratch's "I'm working" visual. */
  sigilDimmed?: boolean;
  sigilShowOrbit?: boolean;

  /** Optional slot rendered between the hero and the capability rows.
   *  Adoption uses this for stepper controls, scratch may use it for
   *  intent composer artifacts. */
  belowHeroSlot?: ReactNode;

  /** Per-row inline policy controls (memory / review / events). Caller
   *  decides what to render — view mode supplies TilePolicyToggles;
   *  adoption / scratch supply their own equivalents (or omit). */
  renderRowPolicySlot?: (uc: DisplayUseCase) => ReactNode;

  /** Optional content rendered after the last capability row. View mode
   *  uses this for the "Add capability" dashed-row affordance; adoption
   *  / scratch typically leave it unset. Not rendered when items is
   *  empty (the emptyNode covers that state). */
  appendRow?: ReactNode;

  /** Detail panel rendered when `selectedItemId` is set. View mode passes
   *  UseCaseDetailExpanded; other modes can pass mode-specific drill-downs. */
  detailNode?: ReactNode;

  /** Rendered in place of the row list when `items` is empty. Caller-owned
   *  so each mode picks its own empty messaging. */
  emptyNode?: ReactNode;
}

/**
 * Mode-agnostic Persona Layout. The surface is the same shape across
 * view / adoption / scratch:
 *
 *    ┌──────────────────────────────────────────────┬─────────────┐
 *    │  topSlot (adoption: QuestionnaireHeaderBand) │             │
 *    ├──────────────────────────────────────────────┤             │
 *    │  Persona metadata band (name, counts, dims)  │             │
 *    │                                              │  rightSlot  │
 *    │              ╭──────────────╮                │ (adoption:  │
 *    │              │  Persona     │                │  story      │
 *    │              │  Sigil       │                │  thread)    │
 *    │              │  (~640px)    │                │             │
 *    │              ╰──────────────╯                │             │
 *    │                                              │             │
 *    │  belowHeroSlot (adoption: Continue button)   │             │
 *    │                                              │             │
 *    │  Capability rows (CapabilitySigil + title)   │             │
 *    └──────────────────────────────────────────────┴─────────────┘
 *
 * Selecting a row swaps the surface to detailNode (view mode passes
 * UseCaseDetailExpanded; other modes can pass their own drill-down).
 *
 * The disable-confirmation dialog and any mode-specific modals (vault
 * quick-add, scratch picker modals, etc.) are caller-owned — this
 * component only renders the shell.
 */
export function PersonaLayout({
  mode,
  personaName,
  items,
  selectedItemId,
  pendingToggleId,
  onRowOpen,
  onRowToggle,
  onRowRun,
  heroRightSlot,
  heroPetalStatesOverride,
  onHeroPetalClick,
  heroActiveDim,
  heroCenterOverlay,
  heroWideOverlay,
  topSlot,
  rightSlot,
  leftSlot,
  hideMetadataBand,
  hideCapabilityRows,
  sigilDimmed,
  sigilShowOrbit,
  belowHeroSlot,
  renderRowPolicySlot,
  appendRow,
  detailNode,
  emptyNode,
}: PersonaLayoutProps) {
  const { t } = useTranslation();

  const activeItem = selectedItemId
    ? items.find((u) => u.id === selectedItemId) ?? null
    : null;

  return (
    <div className="flex flex-col h-full" data-consolidated-mode={mode}>
      <AnimatePresence mode="popLayout" initial={false}>
        {activeItem && detailNode ? (
          <motion.div
            key="detail"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
            className="flex-1 min-h-0 flex flex-col"
          >
            {detailNode}
          </motion.div>
        ) : (
          <motion.div
            key="grid"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="flex-1 min-h-0 flex flex-col"
          >
            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
              <div className="w-full px-4 lg:px-8 py-4 flex flex-col gap-4">
                {topSlot}

                <div className={gridClass(leftSlot, rightSlot)}>
                  {leftSlot && (
                    <aside className="lg:sticky lg:top-4 lg:self-start order-first">
                      {leftSlot}
                    </aside>
                  )}

                  <div className="flex flex-col gap-6 min-w-0">
                    <PersonaHero
                      personaName={personaName}
                      useCases={items}
                      petalStatesOverride={heroPetalStatesOverride}
                      onPetalClick={onHeroPetalClick}
                      activeDim={heroActiveDim}
                      centerOverlay={heroCenterOverlay}
                      wideOverlay={heroWideOverlay}
                      metadataRightSlot={heroRightSlot}
                      hideMetadataBand={hideMetadataBand}
                      dimmed={sigilDimmed}
                      showOrbit={sigilShowOrbit}
                    />

                    {belowHeroSlot}

                    {hideCapabilityRows ? null : items.length === 0 ? (
                      emptyNode ?? null
                    ) : (
                      <div className="flex flex-col gap-2 mx-auto w-full max-w-[960px]">
                        <span className="typo-label uppercase tracking-[0.18em] text-foreground/55 px-1">
                          {t.agents.use_cases.persona_layout_capabilities_heading}
                        </span>
                        <div className="flex flex-col gap-2">
                          {items.map((uc) => (
                            <UseCaseRow
                              key={uc.id}
                              uc={uc}
                              isPendingToggle={pendingToggleId === uc.id}
                              onOpen={() => onRowOpen(uc)}
                              onToggle={() => onRowToggle(uc)}
                              onRun={onRowRun ? () => onRowRun(uc) : undefined}
                              policySlot={renderRowPolicySlot?.(uc)}
                            />
                          ))}
                          {appendRow}
                        </div>
                      </div>
                    )}
                  </div>

                  {rightSlot && (
                    <aside className="lg:sticky lg:top-4 lg:self-start">
                      {rightSlot}
                    </aside>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
