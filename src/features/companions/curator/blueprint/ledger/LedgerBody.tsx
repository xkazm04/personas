/**
 * Layer one's scroll region: the sticky head, the rows, and the two bands that
 * account for the corpus the plan does not carry.
 *
 * Split out of `Blueprint.tsx` at the 2026-09-25 module gate, where the root
 * had grown past the 200-line limit. It is a real seam and not a line-count
 * trick: everything here is the LEDGER, and everything left in the root is the
 * page around it - the bar, the verdict, the console slot, the descent and the
 * drawer. The row memo moves with the rows it builds.
 */
import { memo, useMemo, type RefObject } from 'react';

import { matchesQuery } from '@/lib/text/search';

import type { ChannelId } from '../model/channels';
import type { BlueprintModel, BlueprintRow } from '../model/types';
import { useWords } from '../words';

import { Bands } from './Bands';
import { LedgerEmpty, type BlueprintPhase } from './LedgerEmpty';
import { LedgerHead } from './LedgerHead';
import { LedgerRow } from './LedgerRow';

export interface LedgerBodyProps {
  model: BlueprintModel;
  /** The rows as the state hook sorted and soloed them - never null here. */
  rows: BlueprintRow[];
  cursor: number;
  /** The raw search box, trimmed by the caller that owns it. */
  query: string;
  solo: ChannelId | 0;
  onSolo: (channel: ChannelId) => void;
  /** Open a row into layer two. The index is the row's position, not its rank. */
  onDescend: (index: number) => void;
  /** Which unpopulated phase to say, consulted only when `model.rows` is null. */
  phase: BlueprintPhase;
  /** The scroll element, held by the descent so it can animate out of it. */
  scrollRef: RefObject<HTMLDivElement | null>;
  hidden: boolean;
}

function LedgerBodyInner({
  model,
  rows,
  cursor,
  query,
  solo,
  onSolo,
  onDescend,
  phase,
  scrollRef,
  hidden,
}: LedgerBodyProps) {
  const { w } = useWords();
  // Matching (case folding, diacritics, multi-term) is the app's policy, not
  // this call site's: an accented slug must find its row in all 14 locales.
  const bodyRows = useMemo(
    () =>
      rows.map((row, i) => (
        <LedgerRow
          key={row.id}
          row={row}
          index={i}
          model={model}
          current={i === cursor}
          dimmed={!!query && !matchesQuery(row.id, query)}
        />
      )),
    [cursor, model, query, rows],
  );

  return (
    <section className="cb-ledger" aria-label={w.ledger_region} aria-hidden={hidden}>
      <div className="cb-lscroll" ref={scrollRef}>
        <LedgerHead model={model} solo={solo} onSolo={onSolo} />
        <div
          role="listbox"
          aria-label={w.ledger_region}
          tabIndex={-1}
          onClick={(e) => {
            const row = e.target instanceof Element ? e.target.closest('[data-cb-row]') : null;
            if (row) onDescend(Number(row.getAttribute('data-cb-row')));
          }}
        >
          {/* No rows is not an empty list: it is a ledger nobody has read, and
              it says so once, here, on the ledger's own grid rather than as a
              card that replaced the page. */}
          {model.rows === null && <LedgerEmpty phase={phase} />}
          {bodyRows}
          <Bands model={model} />
        </div>
      </div>
    </section>
  );
}

export const LedgerBody = memo(LedgerBodyInner);
