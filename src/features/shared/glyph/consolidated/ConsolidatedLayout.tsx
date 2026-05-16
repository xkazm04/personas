import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';
import type { DisplayUseCase } from '@/features/agents/sub_use_cases/components/recipes-prototype/shared/displayUseCase';
import { PersonaHero } from './PersonaHero';
import { UseCaseRow } from './UseCaseRow';

export type ConsolidatedMode = 'view' | 'adoption' | 'scratch';

interface ConsolidatedLayoutProps {
  /** Drives mode-specific chrome (top/right slots, padding, etc.). */
  mode: ConsolidatedMode;

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

  /** Optional right-edge content in the hero band (e.g. persona default
   *  model picker). */
  heroRightSlot?: ReactNode;

  /** Optional slot above the hero — adoption uses this for the
   *  QuestionnaireHeaderBand stepper. */
  topSlot?: ReactNode;

  /** Optional slot to the right of the grid — adoption uses this for the
   *  QuestionnaireStoryThread. */
  rightSlot?: ReactNode;

  /** Per-row inline policy controls (memory / review / events). Caller
   *  decides what to render — view mode supplies TilePolicyToggles;
   *  adoption / scratch supply their own equivalents (or omit). */
  renderRowPolicySlot?: (uc: DisplayUseCase) => ReactNode;

  /** Detail panel rendered when `selectedItemId` is set. View mode passes
   *  UseCaseDetailExpanded; other modes can pass mode-specific drill-downs. */
  detailNode?: ReactNode;

  /** Rendered in place of the row list when `items` is empty. Caller-owned
   *  so each mode picks its own empty messaging. */
  emptyNode?: ReactNode;

  /** Max width of the centre column. Defaults to 960px so the hero and
   *  rows stay readable on wide displays. */
  maxWidth?: number;
}

const DEFAULT_MAX_WIDTH = 960;

/**
 * Mode-agnostic Consolidated layout: persona-level hero band + capability
 * rows below, with optional top / right slots for adoption chrome and a
 * detail-overlay slot for drill-downs.
 *
 * Behaviour parity with the prior view-only ConsolidatedSigilLayout:
 *   • selecting an item swaps the surface to the detailNode
 *   • per-row run / toggle / open handlers are caller-supplied
 *
 * The disable-confirmation dialog and any mode-specific modals (vault
 * quick-add, picker modals, etc.) are caller-owned — this component only
 * renders the shell.
 */
export function ConsolidatedLayout({
  mode,
  personaName,
  items,
  selectedItemId,
  pendingToggleId,
  onRowOpen,
  onRowToggle,
  onRowRun,
  heroRightSlot,
  topSlot,
  rightSlot,
  renderRowPolicySlot,
  detailNode,
  emptyNode,
  maxWidth = DEFAULT_MAX_WIDTH,
}: ConsolidatedLayoutProps) {
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
              <div
                className="mx-auto px-4 py-4 flex flex-col gap-4"
                style={{ maxWidth }}
              >
                {topSlot}

                <div className={rightSlot ? 'grid gap-4 lg:grid-cols-[1fr_320px]' : ''}>
                  <div className="flex flex-col gap-4 min-w-0">
                    <PersonaHero
                      personaName={personaName}
                      useCases={items}
                      rightSlot={heroRightSlot}
                    />

                    {items.length === 0 ? (
                      emptyNode ?? null
                    ) : (
                      <div className="flex flex-col gap-2">
                        <span className="typo-label uppercase tracking-[0.18em] text-foreground/55 px-1">
                          {t.agents.use_cases.consolidated_capabilities_heading}
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
