/**
 * ReportCard — how a `report` chat card sits in the transcript: one line
 * (glyph, title, "Open report"), not a widget. It informs; it never waits on
 * the operator, so it is not an actionable card and no "waiting on you" count
 * sees it (`isActionableChatCard` only admits the proposal kinds).
 */

import { FileText } from 'lucide-react';
import type { ChatCard } from '@/api/companion';
import { useTranslation } from '@/i18n/useTranslation';
import { useRefOpener } from './RefOpenerContext';

export function ReportCard({ card }: { card: ChatCard }) {
  const { t } = useTranslation();
  const open = useRefOpener();
  const id = card.id;
  const title = card.title ?? t.plugins.companion.report_kicker;
  return (
    <div
      className="flex items-center gap-2 rounded-card border border-foreground/10 bg-secondary/30 px-3 py-1.5 min-w-0"
      data-testid="companion-report-card"
    >
      <FileText className="w-3.5 h-3.5 shrink-0 text-primary" aria-hidden />
      <span className="typo-body text-foreground truncate min-w-0 flex-1">{title}</span>
      {id && (
        <button
          type="button"
          onClick={() => open('report', id)}
          className="shrink-0 typo-caption text-primary hover:underline underline-offset-2 rounded-interactive focus-ring"
        >
          {t.plugins.companion.report_open}
        </button>
      )}
    </div>
  );
}
