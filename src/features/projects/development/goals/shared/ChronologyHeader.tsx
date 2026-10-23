import { useTranslation } from '@/i18n/useTranslation';

/** The filmstrip's reading direction. Only that layout orders by date, so only
 *  that layout gets the past / today / future rule above its rows. */
export function ChronologyHeader({ leftWidth, label }: { leftWidth: number; label: string }) {
  const { t } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  return (
    <div className="flex items-center border-b border-primary/10 bg-secondary/20">
      <div className="shrink-0 px-3 py-2" style={{ width: leftWidth }}>
        <span className="typo-caption text-foreground tabular-nums">{label}</span>
      </div>
      <div className="flex-1 flex items-center gap-2 px-1 py-2">
        <span className="typo-caption text-foreground uppercase tracking-wider">{dl.progress_past}</span>
        <span className="h-px flex-1 bg-gradient-to-r from-primary/20 to-violet-400/40" />
        <span className="px-1.5 py-px rounded-full border border-violet-500/30 bg-violet-500/10 typo-caption text-violet-300">
          {dl.progress_today}
        </span>
        <span className="h-px flex-1 bg-gradient-to-r from-violet-400/40 to-primary/20" />
        <span className="typo-caption text-foreground uppercase tracking-wider">{dl.progress_future}</span>
      </div>
      <div className="shrink-0 px-3 py-2">
        <span className="typo-caption text-foreground uppercase tracking-wider">{dl.progress_no_date}</span>
      </div>
    </div>
  );
}
