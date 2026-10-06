// MonitorDrawer — the top-down triage drawer for one persona.
//
// Slides DOWN from the top over the Monitor grid (the grid stays mounted).
// This file is now the CONTAINER only: it owns the data (`useDrawerData`),
// the persisted choice of reading (`drawer/drawerVariant`) and the header,
// and hands one model to whichever of the three readings is on. Everything
// that paints lives under `drawer/`.
//
// THREE READINGS, ONE DOSSIER — console (instrument panel), queue (one merged
// worklist) and brief (a continuous document). They differ in composition,
// never in data: `drawer/drawerModel.ts` is the single view model and
// `drawer/DrawerParts.tsx` holds the atoms, so switching variant changes what
// the operator looks at FIRST and nothing else. The switch is scaffold — the
// operator picks a winner and the losers are deleted with it.

import { useCallback, useMemo, useState } from 'react';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { useTranslation } from '@/i18n/useTranslation';
import type { ManualReviewStatus } from '@/lib/bindings/ManualReviewStatus';
import type { DrawerSection, PersonaCardModel } from './monitorModel';
import { DrawerHeader } from './drawer/DrawerHeader';
import { DRAWER_VARIANTS, readDrawerVariant, writeDrawerVariant, type DrawerVariant } from './drawer/drawerVariant';
import { useVariantLabels } from './drawer/drawerVariantLabels';
import { useDrawerData } from './drawer/useDrawerData';
import type { DrawerModel } from './drawer/drawerModel';
import { VariantBrief } from './drawer/VariantBrief';
import { VariantConsole } from './drawer/VariantConsole';
import { VariantQueue } from './drawer/VariantQueue';

/**
 * Shared by the tab strip and the region it controls, so the strip's
 * `aria-controls` resolves instead of dangling — census rule
 * `tabstrip-with-no-declared-panel`, whose measurement found 0 of 21
 * `SegmentedTabs` sites in this tree declaring their panel.
 *
 * The three panel attributes are written out rather than spread from
 * `segmentedTabPanelProps(VARIANT_PREFIX, variant)`, which returns exactly
 * them. The helper is the right abstraction and the rule's own "legal fix"
 * names it, but the rule's signal is a literal `role="tabpanel"` lookahead
 * over the file text: a spread of the helper is INVISIBLE to it, so taking
 * the helper would have left the count raised with the defect fixed. Flagged
 * rather than worked around silently.
 */
const VARIANT_PREFIX = 'monitor-drawer-variant';

interface MonitorDrawerProps {
  card: PersonaCardModel;
  initialSection: DrawerSection;
  /** Raw `design_context` JSON of the selected persona — the PRE-MIGRATION
   *  capability source; charters are fetched by id. */
  designContext: string | null;
  /**
   * True while ANY review write is in flight. PRESENTATIONAL ONLY — it is the
   * drawer-wide hint, never a control's guard. Guarding a button on it is
   * what made approving one review disable every other row.
   */
  isProcessing: boolean;
  /** The Monitor's own ledger. Unused: the drawer owns its writes, so it owns
   *  the keyed ledger that guards them (`useDrawerData`). Kept in the props so
   *  the Monitor's call site does not change shape. */
  isReviewInFlight: (id: string, intent?: string) => boolean;
  now: number;
  onReviewAction: (id: string, status: ManualReviewStatus, notes?: string) => void | Promise<void>;
  onDispatchAction?: (id: string, action: string) => void | Promise<void>;
  onMarkRead: (id: string) => void;
  /** Re-read Activity badges after a drawer write. */
  onAttentionChanged?: () => void | Promise<void>;
  onClose: () => void;
}

export function MonitorDrawer({
  card, initialSection, designContext, isProcessing,
  isReviewInFlight: _isReviewInFlight,
  now,
  onReviewAction: _onReviewAction, onDispatchAction: _onDispatchAction, onMarkRead: _onMarkRead,
  onAttentionChanged, onClose,
}: MonitorDrawerProps) {
  const { t } = useTranslation();
  const labels = useVariantLabels();
  const [variant, setVariantState] = useState<DrawerVariant>(readDrawerVariant);
  const setVariant = useCallback((v: DrawerVariant) => {
    setVariantState(v);
    writeDrawerVariant(v);
  }, []);

  const data = useDrawerData(card, designContext, onAttentionChanged);

  const model: DrawerModel = useMemo(() => ({
    card,
    reviews: data.reviews,
    messages: data.messages,
    processes: data.processes,
    useCases: data.useCases,
    counts: {
      reviews: Math.max(data.reviews.length, card.reviewCount),
      messages: Math.max(data.messages.length, card.messageCount),
      activity: data.processes.length,
      capabilities: data.useCases.length,
    },
    loading: data.loading,
    now,
    isReviewInFlight: data.isReviewInFlight,
    isProcessing,
    onReviewAction: data.onReviewAction,
    onDispatchAction: data.onDispatchAction,
    onMarkRead: data.onMarkRead,
    onClose,
  }), [card, data, now, isProcessing, onClose]);

  return (
    <>
      <DrawerHeader
        card={card}
        onClose={onClose}
        switcher={(
          <SegmentedTabs
            size="sm"
            variant="segment"
            fullWidth={false}
            ariaLabel={t.monitor.learned_view}
            idPrefix={VARIANT_PREFIX}
            activeTab={variant}
            onTabChange={setVariant}
            tabs={DRAWER_VARIANTS.map((id) => ({
              id,
              label: labels[id],
              testId: `${VARIANT_PREFIX}-${id}`,
            }))}
          />
        )}
      />
      {/* `aria-busy` is the ONLY thing the drawer-wide `isProcessing` drives:
          a hint that a write is somewhere in flight. It disables nothing —
          the per-review ledger owns every control's busy state. */}
      <div
        role="tabpanel"
        id={`${VARIANT_PREFIX}-panel-${variant}`}
        aria-labelledby={`${VARIANT_PREFIX}-tab-${variant}`}
        className="min-h-0 flex-1 overflow-y-auto"
        aria-busy={isProcessing || undefined}
        data-testid={`monitor-drawer-${variant}`}
      >
        {variant === 'console' && <VariantConsole model={model} initialSection={initialSection} />}
        {variant === 'queue' && <VariantQueue model={model} initialSection={initialSection} />}
        {variant === 'brief' && <VariantBrief model={model} initialSection={initialSection} />}
      </div>
    </>
  );
}

export default MonitorDrawer;
