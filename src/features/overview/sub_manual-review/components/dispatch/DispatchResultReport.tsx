// What the dispatch ACTUALLY did.
//
// `DispatchIdeasResult` carries `dispatched[]` and `skipped[]`, each skip with
// its own reason. A panel that reported only the first number would say
// "12 dispatched" when nine went and three were dropped — the shape of claim
// this whole wave exists to remove. So the report is a single block that always
// states both, and never renders a success tone while a skip is present.
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import type { DispatchSkip } from '@/lib/bindings/DispatchSkip';

export interface DispatchReport {
  target: 'runner' | 'fleet';
  dispatched: number;
  skipped: DispatchSkip[];
  /** Set when the call itself failed — then nothing was dispatched at all. */
  error: string | null;
}

export function DispatchResultReport({
  report,
  titleById,
}: {
  report: DispatchReport;
  /** Resolves a skipped id back to the idea the user selected. */
  titleById: Map<string, string>;
}) {
  const { t, tx } = useTranslation();
  const c = t.chrome;

  const partial = report.skipped.length > 0;
  const failed = report.error !== null;
  const tone = failed
    ? 'border-status-error/30 bg-status-error/10 text-status-error'
    : partial
      ? 'border-status-warning/30 bg-status-warning/10 text-status-warning'
      : 'border-status-success/30 bg-status-success/10 text-status-success';
  const Icon = failed ? XCircle : partial ? AlertTriangle : CheckCircle2;

  const targetLabel = report.target === 'fleet' ? c.dispatch_to_fleet : c.dispatch_to_runner;

  return (
    <div
      data-testid="dispatch-result"
      data-tone={failed ? 'error' : partial ? 'partial' : 'success'}
      className={`rounded-card border px-3 py-2 typo-caption ${tone}`}
      role="status"
    >
      <p className="flex items-center gap-1.5 font-medium">
        <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden />
        {failed
          ? report.error
          : partial
            ? tx(c.dispatch_result_partial, {
                dispatched: report.dispatched,
                skipped: report.skipped.length,
                target: targetLabel,
              })
            : tx(c.dispatch_result_ok, { count: report.dispatched, target: targetLabel })}
      </p>
      {report.skipped.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-foreground">
          {report.skipped.map((skip) => (
            <li key={skip.ideaId} data-testid={`dispatch-skip-${skip.ideaId}`}>
              {/* The reason is the backend's own words. Paraphrasing it here
                  would be a second, lossier account of what happened. */}
              <span className="text-foreground">{titleById.get(skip.ideaId) ?? skip.ideaId}</span>
              {' — '}
              {skip.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
