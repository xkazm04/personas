/**
 * Level 2 — the peek: an anchored glass drop under its chip listing that
 * chip's items in roster order (R2-C "Aurora Deck").
 *
 * The keys are the settled grammar (`peekKeys` through `usePeekKeyboard`):
 * ↑/↓ move, ←/→ (J/K) walk to the next chip, A accepts, R arms a reject and
 * Enter confirms it, D finishes a report or a thread, Enter opens the deck on
 * the focused row, Esc disarms then closes. A decided row slides out toward
 * its verdict.
 *
 * Three states, one place each: ghost rows while the chip's items load (never
 * a spinner, never an empty band before the read lands), the shared empty band
 * when the chip answered with nothing, and an error with retry when it failed.
 */
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { ArrowRight } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { ErrorBanner } from '@/features/shared/components/feedback/ErrorBanner';
import { GhostRows, KitHost, Rows } from '@/features/shared/components/kit';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useTranslation } from '@/i18n/useTranslation';

import type { ChipCount, DecisionChip, DecisionItem } from '../../model/decisionModel';
import { chipLabel } from '../chipMeta';
import { usePeekKeyboard } from '../usePeekKeyboard';
import { PeekRow } from './PeekRow';
import { PeekShell } from './PeekShell';

export interface PeekProps {
  chip: DecisionChip;
  items: readonly DecisionItem[];
  lamp: ChipCount['lamp'];
  /** The chip's items have been read at least once. */
  ready: boolean;
  /** The chip's read (or count) failed; shown with a retry. */
  failed: boolean;
  /** This chip is the strip's lead: its first row wears NEXT. */
  lead: boolean;
  anchor: HTMLElement | null;
  /** Off while the deck owns the keyboard. */
  keyboard: boolean;
  /** Put the focus on this item once it is in the list (the deck closed on it). */
  initialFocusId?: string | null;
  onRetry: () => void;
  onDecide: (item: DecisionItem, verdict: 'accept' | 'reject') => void;
  onOpen: (item: DecisionItem, from: HTMLElement | null) => void;
  onWalk: (step: 1 | -1) => void;
  onClose: () => void;
}

export function Peek({
  chip, items, lamp, ready, failed, lead, anchor, keyboard, initialFocusId,
  onRetry, onDecide, onOpen, onWalk, onClose,
}: PeekProps) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const still = useReducedMotion();
  const label = chipLabel(m, chip);
  const rowEls = useRef<Record<string, HTMLDivElement | null>>({});
  const [leaveDir, setLeaveDir] = useState(1);

  const open = (item: DecisionItem) => onOpen(item, rowEls.current[item.id] ?? null);
  const decide = (item: DecisionItem, verdict: 'accept' | 'reject') => {
    setLeaveDir(verdict === 'reject' ? -1 : 1);
    onDecide(item, verdict);
  };
  const keys = usePeekKeyboard(items, keyboard, { onOpen: open, onDecide: decide, onWalk, onClose });
  const focused = items[keys.index] ?? null;

  // Land on the row the deck closed on, the first time it is in the list.
  const pendingFocus = useRef(initialFocusId ?? null);
  const { setFocus } = keys;
  useEffect(() => {
    if (!pendingFocus.current) return;
    const at = items.findIndex((i) => i.id === pendingFocus.current);
    if (at < 0) return;
    pendingFocus.current = null;
    setFocus(at);
  }, [items, setFocus]);

  // Keep the focused row on screen as ↑/↓ walk past the fold.
  const focusedId = focused?.id ?? null;
  useEffect(() => {
    if (focusedId) rowEls.current[focusedId]?.scrollIntoView?.({ block: 'nearest' });
  }, [focusedId]);

  const loading = !ready && !failed;
  const actions = focused && (
    <Button
      variant="ghost"
      size="xs"
      className="au-lift whitespace-nowrap"
      onClick={() => open(focused)}
      iconRight={<ArrowRight className="h-3.5 w-3.5" aria-hidden />}
      data-testid="decision-peek-open-deck"
    >
      {m.dc_hub_open_deck}
    </Button>
  );

  return (
    <PeekShell chip={chip} lamp={lamp} count={ready ? items.length : null} anchor={anchor} actions={actions} onClose={onClose}>
      <div className="flex min-h-0 flex-col gap-1 overflow-y-auto px-2 pb-2" data-testid="decision-peek-list">
        {failed && (
          <div className="px-1 pb-1">
            <ErrorBanner variant="inline" message={tx(m.dc_hub_peek_failed, { label })} onRetry={onRetry} />
          </div>
        )}
        {loading ? (
          <KitHost compact><GhostRows count={3} size="s" label={tx(m.dc_hub_peek_aria, { label })} /></KitHost>
        ) : items.length === 0 ? (
          !failed && (
            <KitHost compact>
              <Rows count={0} empty={{ title: m.dc_hub_peek_empty_title, hint: m.dc_hub_peek_empty_hint, testId: 'decision-peek-empty' }}>
                {null}
              </Rows>
            </KitHost>
          )
        ) : (
          <AnimatePresence initial={!still} custom={still ? 0 : leaveDir}>
            {items.map((item, i) => (
              <PeekRow
                key={item.id}
                ref={(el) => { rowEls.current[item.id] = el; }}
                item={item}
                index={i}
                focused={i === keys.index}
                armed={keys.armed && i === keys.index}
                isNext={lead && i === 0}
                leaveDir={leaveDir}
                onFocus={() => keys.setFocus(i)}
                onOpen={(from) => onOpen(item, rowEls.current[item.id] ?? from)}
              />
            ))}
          </AnimatePresence>
        )}
      </div>
    </PeekShell>
  );
}
