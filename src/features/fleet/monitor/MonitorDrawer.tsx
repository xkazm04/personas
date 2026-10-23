// MonitorDrawer — the top-down triage drawer for one persona.
//
// Slides DOWN from the top over the Monitor grid (the grid stays mounted).
// This file is the CONTAINER only: it owns the data (`useDrawerData`) and the
// header, and hands one model to the reading. Everything that paints lives
// under `drawer/`.
//
// ONE READING: the console (2026-10-06). Three readings — console (instrument
// panel), queue (one merged worklist) and brief (a continuous document) — were
// built behind a persisted switch as scaffold, with the losers to be deleted
// once the operator picked. He picked the console, so the switch, the other two
// readings and the borrowed labels they used are gone. `drawer/drawerModel.ts`
// stays the single view model and `drawer/DrawerParts.tsx` the atoms.
//
// Which badge was clicked still decides what the operator sees first: the
// console has no tabs, so `initialSection` is honoured by scrolling that
// section's anchor into view (`drawer/useSectionAnchor.ts`). It is the only
// thing answering `initialSection` now, so do not drop it.

import { useMemo } from 'react';
import type { DrawerSection, PersonaCardModel } from './monitorModel';
import { DrawerHeader } from './drawer/DrawerHeader';
import { useDrawerData } from './drawer/useDrawerData';
import type { DrawerModel } from './drawer/drawerModel';
import { VariantConsole } from './drawer/VariantConsole';

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
  now: number;
  /** Re-read Activity badges after a drawer write. The drawer owns its review
   *  and message writes (and the keyed ledger guarding them) in
   *  `useDrawerData`; this is the only way it tells the Monitor about one. */
  onAttentionChanged?: () => void | Promise<void>;
  onClose: () => void;
}

export function MonitorDrawer({
  card, initialSection, designContext, isProcessing, now, onAttentionChanged, onClose,
}: MonitorDrawerProps) {
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
      <DrawerHeader card={card} onClose={onClose} />
      {/* `aria-busy` is the ONLY thing the drawer-wide `isProcessing` drives:
          a hint that a write is somewhere in flight. It disables nothing —
          the per-review ledger owns every control's busy state. */}
      <div
        className="min-h-0 flex-1 overflow-y-auto"
        aria-busy={isProcessing || undefined}
        data-testid="monitor-drawer-console"
      >
        <VariantConsole model={model} initialSection={initialSection} />
      </div>
    </>
  );
}

export default MonitorDrawer;
