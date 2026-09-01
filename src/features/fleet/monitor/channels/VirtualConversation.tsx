import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

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
 *
 * THE PAGE FLIP (plan Lane A, "page-flip with a pin reserve"). A send used to
 * just append: your own message landed one line above the composer and every
 * reply pushed it further up, so the thing you were waiting on an answer to
 * left the screen first. Pass `pinKey` and the row it names is scrolled to the
 * TOP of the viewport instead — which is only reachable if there is something
 * below it, so a SPACER is reserved underneath and shrinks by exactly what each
 * arriving reply adds. The pose is therefore a legitimate bottom the whole
 * time: follow-to-bottom stays armed, the suppression is one-shot, and when the
 * replies have filled the reserve the list is an ordinary chat again.
 * -------------------------------------------------------------------------- */

const ESTIMATE = 64;

// Generic over the row type — the team conversation renders `ConversationRow`,
// the persona conversation `PersonaConversationRow`; the virtualizer only ever
// touches `key`.
export function VirtualConversation<R extends { key: string }>({
  rows, renderRow, onTopReached, hasMore, pinKey = null,
}: {
  rows: R[];
  renderRow: (row: R) => ReactNode;
  /** Fired when the top scrolls into view — pages older history. */
  onTopReached?: () => void;
  hasMore?: boolean;
  /** The row to pose at the viewport top — the operator's own newest message.
   *  Changing it arms one flip; it releases itself once the reserve is used up
   *  or the reader scrolls away. */
  pinKey?: string | null;
}) {
  const { t, tx } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const prevCount = useRef(rows.length);
  const fetching = useRef(false);
  const [unseen, setUnseen] = useState(0);
  // The armed pin, and the empty space that makes its pose reachable. The key
  // is a ref because the flip is an EDGE, not a state the render reads.
  const pinned = useRef<string | null>(null);
  const [reserve, setReserve] = useState(0);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATE,
    // C4: no measureElement override. The previous `(el) =>
    // el.getBoundingClientRect().height` forced a synchronous layout per row
    // per measure; TanStack's default path measures via border-box size /
    // ResizeObserver and batches, which is the whole point of using it.
    overscan: 8,
    getItemKey: (i) => rows[i]?.key ?? i,
  });

  useEffect(() => {
    fetching.current = false;
  }, [rows.length]);

  // Arm the flip. Only the CHANGE matters: re-rendering with the same pinKey
  // must not re-pose a list the reader has since scrolled.
  const lastPin = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (pinKey === lastPin.current) return;
    lastPin.current = pinKey;
    if (!pinKey) return;
    pinned.current = pinKey;
    stick.current = true;
  }, [pinKey]);

  // Hold the pose. Runs on every size change while a pin is armed: the reserve
  // is exactly the gap between where the pinned row would have to start and
  // what the content can currently reach, so each reply that lands shrinks it
  // by its own height and the row does not move.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!pinned.current || !el) return;
    const index = rows.findIndex((r) => r.key === pinned.current);
    if (index < 0) {
      pinned.current = null;
      setReserve(0);
      return;
    }
    const start = virtualizer.getOffsetForIndex?.(index, 'start')?.[0] ?? 0;
    const need = Math.max(0, Math.round(start + el.clientHeight - virtualizer.getTotalSize()));
    setReserve(need);
    // Used up — the conversation has grown past the pin on its own, so the
    // ordinary bottom IS the pose and the flip retires itself.
    if (need === 0) pinned.current = null;
    virtualizer.scrollToIndex(index, { align: 'start' });
  }, [rows, virtualizer, reserve]);

  // New rows arrived: ride the bottom if we were already there, else count them.
  useLayoutEffect(() => {
    const grew = rows.length - prevCount.current;
    prevCount.current = rows.length;
    if (grew <= 0) return;
    // While pinned, the effect above owns the scroll position — one scroll
    // authority at a time, or the two fight for the same frame.
    if (stick.current && !pinned.current) {
      virtualizer.scrollToIndex(rows.length - 1, { align: 'end' });
      setUnseen(0);
    } else if (stick.current) {
      setUnseen(0);
    } else {
      setUnseen((n) => n + grew);
    }
  }, [rows.length, virtualizer]);

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    // The reserve is empty space the list PUT there — counting it as distance
    // from the bottom would read our own pose as "the reader scrolled up" and
    // disarm follow on the very send that armed it.
    const fromBottom = el.scrollHeight - reserve - el.scrollTop - el.clientHeight;
    stick.current = fromBottom < 80;
    // Taking the scroll back releases the pin: the reader has said where they
    // want to be, and nothing should pull them off it.
    if (!stick.current && pinned.current) {
      pinned.current = null;
      setReserve(0);
    }
    if (stick.current && unseen) setUnseen(0);

    if (hasMore && onTopReached && !fetching.current && el.scrollTop < 200) {
      fetching.current = true;
      onTopReached();
    }
  };

  const toLatest = () => {
    stick.current = true;
    pinned.current = null;
    setReserve(0);
    setUnseen(0);
    virtualizer.scrollToIndex(rows.length - 1, { align: 'end' });
  };

  return (
    <div className="relative flex-1 min-h-0">
      <div ref={scrollRef} onScroll={onScroll} className="absolute inset-0 overflow-y-auto px-3">
        {/* The reserve rides on the SAME element the virtualizer sizes, so the
            rows keep their absolute coordinates and only the reachable scroll
            range changes. A sibling spacer would do the same thing and give the
            measurement two owners. */}
        <div
          style={{
            height: virtualizer.getTotalSize() + reserve,
            position: 'relative',
            width: '100%',
          }}
        >
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
