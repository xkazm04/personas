import { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { silentCatch } from '@/lib/silentCatch';
import {
  obsidianRevitalizeHistory,
  type RevitalizeRunRecord,
} from '@/api/obsidianBrain';

const HISTORY_LIMIT = 20;

function formatDuration(secs: number): string {
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

/**
 * Persisted run history for the Revitalize tab: when each pass ran, on which
 * vault, and what the cleaning achieved. Backed by `obsidian_revitalize_runs`
 * so it survives app restarts (the live job store evicts after 30 minutes).
 */
export default function RevitalizeHistoryTable() {
  const { t, tx } = useTranslation();
  const ob = t.plugins.obsidian_brain;
  const running = useSystemStore((s) => s.obsidianRevitalizeRunning);
  const [runs, setRuns] = useState<RevitalizeRunRecord[] | null>(null);

  // Load on mount, and reload whenever a pass settles (running → false) so
  // the freshly recorded run appears without a manual refresh.
  useEffect(() => {
    if (running) return;
    let alive = true;
    obsidianRevitalizeHistory(HISTORY_LIMIT)
      .then((rows) => {
        if (alive) setRuns(rows);
      })
      .catch(silentCatch('obsidian-brain/RevitalizeHistoryTable:load'));
    return () => {
      alive = false;
    };
  }, [running]);

  if (runs === null) return null;

  return (
    <SectionCard
      title={ob.revitalize_history_title}
      subtitle={ob.revitalize_history_subtitle}
      titleClassName="text-primary"
    >
      {runs.length === 0 ? (
        <div className="flex items-center gap-2.5 py-3 px-1">
          <History className="w-4 h-4 text-foreground/90 flex-shrink-0" />
          <p className="typo-caption text-foreground">{ob.revitalize_history_empty}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-primary/10">
                <th className="typo-label text-foreground/90 font-medium py-2 pr-3">{ob.revitalize_history_col_when}</th>
                <th className="typo-label text-foreground/90 font-medium py-2 pr-3">{ob.revitalize_history_col_vault}</th>
                <th className="typo-label text-foreground/90 font-medium py-2 pr-3">{ob.revitalize_history_col_result}</th>
                <th className="typo-label text-foreground/90 font-medium py-2 pr-3">{ob.revitalize_history_col_cleaned}</th>
                <th className="typo-label text-foreground/90 font-medium py-2 text-right">{ob.revitalize_history_col_tokens}</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const failed = run.status === 'failed';
                const tokensSaved = Math.max(0, run.estTokensBefore - run.estTokensAfter);
                const statusPill = (
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full typo-caption font-medium border ${
                      failed
                        ? 'bg-red-500/10 text-red-400 border-red-500/25'
                        : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                    }`}
                  >
                    {failed ? ob.revitalize_history_status_failed : ob.revitalize_history_status_completed}
                  </span>
                );
                return (
                  <tr key={run.id} className="border-b border-primary/5 last:border-b-0">
                    <td className="py-2.5 pr-3 typo-caption text-foreground whitespace-nowrap align-top">
                      <RelativeTime timestamp={run.createdAt} />
                      <p className="typo-caption text-foreground/90 mt-0.5">
                        {tx(ob.revitalize_history_duration, { duration: formatDuration(run.durationSecs) })}
                      </p>
                    </td>
                    <td className="py-2.5 pr-3 typo-caption align-top max-w-[10rem]">
                      <span className="text-violet-300 truncate block" title={run.vaultPath}>
                        {run.vaultName}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 align-top">
                      {failed && run.error ? (
                        <Tooltip content={run.error}>{statusPill}</Tooltip>
                      ) : (
                        statusPill
                      )}
                    </td>
                    <td className="py-2.5 pr-3 typo-caption align-top whitespace-nowrap">
                      {failed ? (
                        <span aria-hidden className="text-foreground/90">—</span>
                      ) : (
                        <span className="inline-flex items-center gap-2">
                          <span className="text-red-400">{tx(ob.revitalize_history_removed_short, { count: run.filesDeleted })}</span>
                          <span aria-hidden className="text-foreground/90">·</span>
                          <span className="text-violet-300">{tx(ob.revitalize_history_merged_short, { count: run.filesMerged })}</span>
                          <span aria-hidden className="text-foreground/90">·</span>
                          <span className="text-cyan-300">{tx(ob.revitalize_history_updated_short, { count: run.filesUpdated })}</span>
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 typo-caption text-right align-top">
                      {failed || tokensSaved === 0 ? (
                        <span aria-hidden className="text-foreground/90">—</span>
                      ) : (
                        <span className="text-emerald-400">
                          <Numeric value={tokensSaved} unit="compact" />
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}
