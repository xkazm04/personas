import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { FileText } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import type { PersonaChannelItem } from '@/lib/bindings/PersonaChannelItem';
import { MD_CHAT_RHYTHM } from './TalkLine';

/* ── REPORT: a compact bubble with an attachment chip (opens ReportDetailModal) ── */

/**
 * The preview's visual clamp. `line-clamp-*` needs `display:-webkit-box`,
 * which collapses markdown's block children (lists, tables, fenced code) into
 * one inline run — so the clamp is a max-height box instead, and the cut is
 * softened with a MASK rather than a gradient overlay: the bubble sits on a
 * translucent `bg-secondary/20` whose effective color no single `from-*` stop
 * can match, and a mask fades whatever is actually behind it.
 */
const REPORT_PREVIEW_FADE = 'linear-gradient(to bottom, #000 65%, transparent 100%)';

export const PersonaReportBubble = memo(function PersonaReportBubble({
  item, onOpenReport,
}: {
  item: PersonaChannelItem;
  /** Fetches `get_report(reportId)` and opens the detail modal. */
  onOpenReport: (reportId: string) => void;
}) {
  const { t } = useTranslation();
  const boxRef = useRef<HTMLDivElement>(null);
  const inkRef = useRef<HTMLDivElement>(null);
  // Fade only when the preview actually overflows — a two-line report must not
  // render with its last line dissolving for no reason.
  const [overflows, setOverflows] = useState(false);
  const body = item.body ?? '';

  useEffect(() => {
    const box = boxRef.current;
    const ink = inkRef.current;
    if (!box || !ink) return;
    const measure = () => setOverflows(ink.offsetHeight - box.clientHeight > 2);
    measure();
    // The markdown body reflows as the bubble's width settles (the row is
    // virtualized and measured after mount), so watch the ink, not the clamp.
    const ro = new ResizeObserver(measure);
    ro.observe(ink);
    return () => ro.disconnect();
  }, [body]);

  const openReport = useCallback(() => {
    if (item.reportId) onOpenReport(item.reportId);
  }, [item.reportId, onOpenReport]);

  return (
    <div className="py-1 flex justify-start">
      <div className="max-w-[78%] min-w-0 px-3 py-2 rounded-card border border-border bg-secondary/20">
        <span className="flex items-center gap-1.5 mb-0.5">
          <span className="typo-heading text-foreground truncate">
            {item.title ?? t.monitor.conv_persona_report_chip}
          </span>
          <span className="flex-shrink-0 typo-caption">
            <RelativeTime timestamp={item.at} />
          </span>
        </span>
        {body && (
          <div
            ref={boxRef}
            className="max-h-28 overflow-hidden"
            style={
              overflows
                ? { maskImage: REPORT_PREVIEW_FADE, WebkitMaskImage: REPORT_PREVIEW_FADE }
                : undefined
            }
          >
            <div ref={inkRef}>
              <MarkdownRenderer
                content={body}
                className={`typo-caption ${MD_CHAT_RHYTHM}`}
              />
            </div>
          </div>
        )}
        {item.reportId && (
          <Button variant="accent" tone="info" size="xs" onClick={openReport} icon={<FileText className="h-3.5 w-3.5" aria-hidden />} className="mt-1.5 whitespace-nowrap">
            {t.monitor.conv_persona_report_chip}
          </Button>
        )}
      </div>
    </div>
  );
});

