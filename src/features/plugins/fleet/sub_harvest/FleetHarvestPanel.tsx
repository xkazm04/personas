import { useCallback, useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { Button } from '@/features/shared/components/buttons';
import { CopyButton } from '@/features/shared/components/buttons/CopyButton';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useTranslation, interpolate } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import type { FleetRunReport } from '@/lib/bindings/FleetRunReport';
import type { FleetRunSummary } from '@/lib/bindings/FleetRunSummary';
import { listRuns, runReport } from '@/api/fleet/fleet';
import { FleetRunSessionRow } from './FleetRunSessionRow';
import { buildRunMarkdown, formatTokens } from './fleetRunMarkdown';

/**
 * Run harvest — the fleet reports what it delivered.
 *
 * Opened from the Sessions action row once at least one session has declared
 * `FLEET:DONE`. Everything shown is a fold over data the machine already
 * produced (`registry::mark_finished` summaries + the incremental transcript
 * rollups), so there is no new polling: the panel reads once when it opens and
 * again only when the operator picks a different run.
 */
interface Props {
  open: boolean;
  onClose: () => void;
}

export function FleetHarvestPanel({ open, onClose }: Props) {
  const { t } = useTranslation();
  const [runs, setRuns] = useState<FleetRunSummary[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [report, setReport] = useState<FleetRunReport | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    listRuns(25)
      .then((list) => {
        setRuns(list);
        setRunId((prev) => prev ?? list[0]?.runId ?? null);
      })
      .catch(silentCatch('fleet harvest: list runs'))
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open || !runId) return;
    setLoading(true);
    runReport(runId)
      .then(setReport)
      .catch(silentCatch('fleet harvest: run report'))
      .finally(() => setLoading(false));
  }, [open, runId]);

  const markdown = useMemo(() => (report ? buildRunMarkdown(report) : ''), [report]);
  const runLabel = useCallback(
    (r: FleetRunSummary) =>
      r.runLabel ?? interpolate(t.plugins.fleet.harvest_run_untitled, { id: r.runId.slice(0, 6) }),
    [t],
  );

  return (
    <BaseModal isOpen={open} onClose={onClose} titleId="fleet-harvest-title" size="lg" staggerChildren={false}>
      <div className="flex max-h-[80vh] flex-col" data-testid="fleet-harvest-panel">
        <div className="flex items-center gap-2 border-b border-primary/10 px-4 py-3">
          <h2 id="fleet-harvest-title" className="flex-1 typo-h3">
            {t.plugins.fleet.harvest_title}
          </h2>
          {markdown && (
            <CopyButton
              text={markdown}
              label={t.plugins.fleet.harvest_copy}
              copiedLabel={t.plugins.fleet.harvest_copied}
            />
          )}
          <Button variant="ghost" size="sm" icon={<X className="h-3.5 h-3.5" />} onClick={onClose} />
        </div>

        {runs.length > 1 && (
          <div className="flex flex-wrap gap-1.5 border-b border-primary/10 px-4 py-2">
            {runs.map((r) => (
              <button
                key={r.runId}
                type="button"
                data-testid={`fleet-harvest-run-${r.runId}`}
                onClick={() => setRunId(r.runId)}
                aria-pressed={r.runId === runId}
                className={`rounded-interactive border px-2 py-0.5 typo-caption transition-colors ${
                  r.runId === runId
                    ? 'border-primary/40 bg-primary/15 text-foreground'
                    : 'border-primary/10 bg-secondary/40 hover:bg-secondary/60'
                }`}
              >
                {`${runLabel(r)} · ${r.finishedCount}/${r.sessionCount}`}
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {loading && !report ? (
            <div className="flex justify-center py-8">
              <LoadingSpinner />
            </div>
          ) : !report || report.sessions.length === 0 ? (
            <p className="py-8 text-center typo-body opacity-70">{t.plugins.fleet.harvest_empty}</p>
          ) : (
            <>
              <p className="mb-3 typo-caption tabular-nums opacity-80">
                {interpolate(t.plugins.fleet.harvest_totals, {
                  delivered: report.totals.finishedCount,
                  total: report.totals.sessionCount,
                  files: report.totals.filesTouched,
                  tokensIn: formatTokens(report.totals.tokens.input),
                  tokensOut: formatTokens(report.totals.tokens.output),
                })}
              </p>
              <ul className="flex flex-col gap-2">
                {report.sessions.map((s) => (
                  <FleetRunSessionRow key={s.sessionId} session={s} />
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </BaseModal>
  );
}
