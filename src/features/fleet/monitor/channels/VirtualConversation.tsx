import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { ConversationRow } from './conversationModel';

/* ----------------------------------------------------------------------------
 * VIRTUAL CONVERSATION — the chat list, windowed.
 *
 * `CollabLiveCorrespondence` renders EVERY message it has ever paged, each an
 * animated motion.div, with no virtualization at all — and it pages upward
 * forever. It is the surface in this consolidation that actually degrades, and
 * the plan calls virtualizing it non-negotiable.
 *
 * Unlike the Stream (fixed 30px radio lines, exact math), a conversation has
 * rows of wildly different heights — a one-line remark, a six-step assignment
 * card, an expanded deliberation. So this uses `measureElement` rather than a
 * fixed itemSize, with a generous estimate to keep the initial scrollbar sane.
 *
 * Chat scroll semantics, which a plain virtual list does not give you:
 *   • stick to the bottom while you're at the bottom (new messages push up),
 *   • do NOT yank you down if you've scrolled up to read,
 *   • jump-to-latest with a count of what arrived while you were away.
 * -------------------------------------------------------------------------- */

const ESTIMATE = 64;

export function VirtualConversation({
  rows, renderRow, onTopReached, hasMore,
}: {
  rows: ConversationRow[];
  renderRow: (row: ConversationRow) => ReactNode;
  /** Fired when the top scrolls into view — pages older history. */
  onTopReached?: () => void;
  hasMore?: boolean;
}) {
  const { t, tx } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const prevCount = useRef(rows.length);
  const fetching = useRef(false);
  const [unseen, setUnseen] = useState(0);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATE,
    measureElement: (el) => el.getBoundingClientRect().height,
    overscan: 8,
    getItemKey: (i) => rows[i]?.key ?? i,
  });

  useEffect(() => {
    fetching.current = false;
  }, [rows.length]);

  // New rows arrived: ride the bottom if we were already there, else count them.
  useLayoutEffect(() => {
    const grew = rows.length - prevCount.current;
    prevCount.current = rows.length;
    if (grew <= 0) return;
    if (stick.current) {
      virtualizer.scrollToIndex(rows.length - 1, { align: 'end' });
      setUnseen(0);
    } else {
      setUnseen((n) => n + grew);
    }
  }, [rows.length, virtualizer]);

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stick.current = fromBottom < 80;
    if (stick.current && unseen) setUnseen(0);

    if (hasMore && onTopReached && !fetching.current && el.scrollTop < 200) {
      fetching.current = true;
      onTopReached();
    }
  };

  const toLatest = () => {
    stick.current = true;
    setUnseen(0);
    virtualizer.scrollToIndex(rows.length - 1, { align: 'end' });
  };

  return (
    <div className="relative flex-1 min-h-0">
      <div ref={scrollRef} onScroll={onScroll} className="absolute inset-0 overflow-y-auto px-3">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
          {virtualizer.getVirtualItems().map((v) => {
            const row = rows[v.index];
            if (!row) return null;
            return (
              <div
                key={row.key}
                data-index={v.index}
                ref={virtualizer.measureElement}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${v.start}px)` }}
              >
                {renderRow(row)}
              </div>
            );
          })}
        </div>
      </div>

      {unseen > 0 && (
        <button
          type="button"
          onClick={toLatest}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-primary/25 bg-background/90 shadow-elevation-2 typo-caption text-foreground hover:bg-secondary/40 transition-colors"
        >
          <ArrowDown className="w-3.5 h-3.5" />
          {tx(t.monitor.conv_new, { count: unseen })}
        </button>
      )}
    </div>
  );
}
