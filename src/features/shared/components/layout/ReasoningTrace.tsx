import { useEffect, useMemo, useRef, useState } from "react";
import type { ReasoningEntry } from "@/hooks/execution/useReasoningTrace";
import { useTranslation } from '@/i18n/useTranslation';
import { EntryRenderer } from './ReasoningTraceEntry';
import { ReasoningTraceToolbar } from './ReasoningTraceToolbar';
import { filterTraceEntries, lastErrorIndex, traceToMarkdown, type TraceFilter } from './reasoningTraceModel';

interface ReasoningTraceProps {
  entries: ReasoningEntry[];
  isLive: boolean;
  startTime?: number;
}

export default function ReasoningTrace({ entries, isLive, startTime }: ReasoningTraceProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);
  const [filter, setFilter] = useState<TraceFilter>('all');

  const baseTime = startTime ?? (entries.length > 0 ? entries[0]!.ts : Date.now());

  const visible = useMemo(() => filterTraceEntries(entries, filter), [entries, filter]);
  const markdown = useMemo(() => traceToMarkdown(visible, baseTime), [visible, baseTime]);
  const hasError = lastErrorIndex(visible) >= 0;

  // Auto-scroll to bottom when live
  useEffect(() => {
    if (!isLive || userScrolledUp.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visible.length, isLive]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    userScrolledUp.current = !atBottom;
  };

  /**
   * Jump to the newest error row and PAUSE the live autoscroll — otherwise the
   * next event would immediately drag the pane back to the bottom, which is
   * exactly the hunt this control exists to end.
   */
  const jumpToError = () => {
    userScrolledUp.current = true;
    const rows = scrollRef.current?.querySelectorAll('[data-entry-type="error"]');
    rows?.[rows.length - 1]?.scrollIntoView({ block: 'center' });
  };

  if (entries.length === 0) {
    return (
      <div className="px-3 py-4 typo-caption text-foreground text-center">
        {t.shared.reasoning_trace.waiting}
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-0">
      <ReasoningTraceToolbar
        filter={filter}
        onFilterChange={setFilter}
        markdown={markdown}
        onJumpToError={hasError ? jumpToError : undefined}
      />
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="max-h-[300px] overflow-y-auto px-3 py-1 space-y-0.5"
      >
        {visible.map((entry, i) => (
          <div key={i} data-entry-type={entry.type}>
            <EntryRenderer entry={entry} baseTime={baseTime} />
          </div>
        ))}
      </div>
    </div>
  );
}
