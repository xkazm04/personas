import { useTranslation } from '@/i18n/useTranslation';

/** The filmstrip's reading direction. Only that layout orders by date, so only
 *  that layout gets the past / today / future rule above its rows. */
export function ChronologyHeader({ leftWidth, label }: { leftWidth: number; label: string }) {
  const { t } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  return (
    <div className="flex items-center border-b border-hair bg-surface-1">
      <div className="shrink-0 px-3 py-2" style={{ width: leftWidth }}>
        <span className="typo-caption text-foreground num">{label}</span>
      </div>
      <div className="flex-1 flex items-center gap-2 px-1 py-2">
        <span className="typo-eyebrow text-ink-3">{dl.progress_past}</span>
        <span className="bg-hair h-px flex-1" />
        <span className="px-1.5 py-px rounded-interactive border border-primary typo-caption text-primary">
          {dl.progress_today}
        </span>
        <span className="bg-hair h-px flex-1" />
        <span className="typo-eyebrow text-ink-3">{dl.progress_future}</span>
      </div>
      <div className="shrink-0 px-3 py-2">
        <span className="typo-eyebrow text-ink-3">{dl.progress_no_date}</span>
      </div>
    </div>
  );
}
