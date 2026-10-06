/**
 * DecisionPeek — the hub's level 2: one chip's items, anchored under it.
 *
 * A SLOT like the strip: it renders what it is handed and reports intent. The
 * roster, the writes and the router live in `DecisionHub`; the winning
 * prototype direction replaces this markup, not those seams.
 *
 * Three states, one place each: ghost rows while the chip's items load (never a
 * spinner, and never an empty band before the read lands), the shared empty
 * band when the chip answered with nothing, and an error with retry when it
 * failed.
 */
import { useEffect } from 'react';

import { ErrorBanner } from '@/features/shared/components/feedback/ErrorBanner';
import { KitHost, Rows } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import { Kbd } from '@/features/fleet/monitor/grid/prototype/entry-e/parts';

import type { DecisionChip, DecisionItem } from '../model/decisionModel';
import { chipLabel } from './chipMeta';
import { PeekPanel } from './PeekPanel';
import { PeekRow } from './PeekRow';
import { usePeekKeyboard } from './usePeekKeyboard';

export interface DecisionPeekProps {
  chip: DecisionChip;
  items: readonly DecisionItem[];
  /** The chip's items have been read at least once. */
  ready: boolean;
  /** The chip's read failed; shown with a retry. */
  error?: string | null;
  onRetry: () => void;
  onDecide: (item: DecisionItem, verdict: 'accept' | 'reject') => void;
  onOpen: (item: DecisionItem) => void;
  onWalk: (step: 1 | -1) => void;
  onClose: () => void;
  /** Off while an opened item's surface owns the keyboard. */
  keyboard: boolean;
  /** Left offset from the hub's own box, in px. */
  left: number;
}

export function DecisionPeek({
  chip, items, ready, error, onRetry, onDecide, onOpen, onWalk, onClose, keyboard, left,
}: DecisionPeekProps) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const label = chipLabel(m, chip);
  const keys = usePeekKeyboard(items, keyboard, { onOpen, onDecide, onWalk, onClose });
  const focusedId = items[keys.index]?.id ?? null;

  // Keep the focused row on screen as ↑/↓ walk past the fold.
  useEffect(() => {
    if (!focusedId) return;
    document
      .querySelector(`[data-testid="decision-peek-row-${CSS.escape(focusedId)}"]`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [focusedId]);

  return (
    <PeekPanel label={tx(m.dc_hub_peek_aria, { label })} title={label} left={left} onClose={onClose}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && (
          <div className="p-2">
            <ErrorBanner variant="inline" message={tx(m.dc_hub_peek_failed, { label })} onRetry={onRetry} />
          </div>
        )}
        {!(error && items.length === 0) && (
        <KitHost compact testId="decision-peek-list">
          <Rows
            loading={!ready && !error}
            count={items.length}
            empty={{ title: m.dc_hub_peek_empty_title, hint: m.dc_hub_peek_empty_hint, testId: 'decision-peek-empty' }}
          >
            {items.map((item, i) => (
              <PeekRow
                key={item.id}
                item={item}
                focused={i === keys.index}
                armed={keys.armed && i === keys.index}
                onOpen={onOpen}
              />
            ))}
          </Rows>
        </KitHost>
        )}
      </div>
      <div className="flex flex-shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-3 py-1.5 typo-caption" aria-hidden>
        <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd></span>
        <span className="flex items-center gap-1"><Kbd>↵</Kbd>{m.dc_hub_key_open}</span>
        <span className="flex items-center gap-1"><Kbd>A</Kbd>{m.dc_hub_key_accept}</span>
        <span className="flex items-center gap-1"><Kbd>R</Kbd>{m.dc_hub_key_reject}</span>
        {(chip === 'reports' || chip === 'chat') && (
          <span className="flex items-center gap-1"><Kbd>D</Kbd>{m.dc_hub_key_done}</span>
        )}
        <span className="flex items-center gap-1"><Kbd>Esc</Kbd>{t.common.close}</span>
      </div>
    </PeekPanel>
  );
}
