/**
 * ReportReader — layer two for a report: a full-height reader over the chat
 * column (the BrainViewer precedent: back arrow, Esc, title, then the body).
 *
 * Loading is a surface state, so it is a ghost under the permanent chrome,
 * never a spinner. Opening a report marks it read (idempotent server-side).
 * Reports are immutable once written, so a small module cache keeps a reopen
 * warm instead of re-ghosting.
 */

import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { companionGetReport, companionMarkReportRead } from '@/api/companion';
import type { CompanionReport } from '@/lib/bindings/CompanionReport';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { createModuleCache } from '@/hooks/utility/data/useModuleSubscription';
import { useTranslation } from '@/i18n/useTranslation';
import { FULLSCREEN_LAYER_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { silentCatch } from '@/lib/silentCatch';
import { AssistantProse } from './AssistantProse';

const reportCache = createModuleCache<string, CompanionReport>({ maxSize: 24 });

/** Test hatch. */
export function __resetReportCacheForTests(): void {
  reportCache.clear();
}

type LoadState = { status: 'loading' } | { status: 'ready'; report: CompanionReport } | { status: 'failed' };

export function ReportReader({
  reportId,
  onClose,
  overlay = true,
  escToClose = true,
}: {
  reportId: string;
  onClose: () => void;
  /** Paint over the chat column (Current). False fills the parent (prototype layer two). */
  overlay?: boolean;
  /** The prototypes' `useLayer` already owns Esc; the Current overlay does not. */
  escToClose?: boolean;
}) {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  const [state, setState] = useState<LoadState>(() => {
    const hit = reportCache.get(reportId);
    return hit ? { status: 'ready', report: hit } : { status: 'loading' };
  });

  useEffect(() => {
    let alive = true;
    const hit = reportCache.get(reportId);
    setState(hit ? { status: 'ready', report: hit } : { status: 'loading' });
    companionGetReport(reportId)
      .then((report) => {
        if (!alive) return;
        reportCache.set(reportId, report);
        setState({ status: 'ready', report });
        if (report.status !== 'read') {
          companionMarkReportRead(reportId).catch(silentCatch('companion_mark_report_read'));
        }
      })
      .catch((err: unknown) => {
        silentCatch('companion_get_report')(err);
        if (alive && !hit) setState({ status: 'failed' });
      });
    return () => {
      alive = false;
    };
  }, [reportId]);

  // One rung above the full-screen layer (the DeckLayer precedent) so the
  // reader closes before whatever it sits in; a modal raised inside still wins.
  useAppKeyboard(
    (e) => {
      if (e.key !== 'Escape') return false;
      e.preventDefault();
      onClose();
      return true;
    },
    { priority: FULLSCREEN_LAYER_PRIORITY + 1, enabled: escToClose },
  );

  const report = state.status === 'ready' ? state.report : null;
  const shell = overlay
    ? 'absolute inset-0 z-20 flex flex-col bg-secondary/95 backdrop-blur-sm'
    : 'flex flex-col h-full min-h-0';

  return (
    <div className={shell} role="region" aria-label={c.report_kicker} data-testid="companion-report-reader">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-foreground/10 shrink-0">
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-interactive text-foreground hover:bg-foreground/5 transition-colors focus-ring"
          aria-label={t.common.back}
        >
          <ArrowLeft className="w-4 h-4" aria-hidden />
        </button>
        <div className="min-w-0 flex-1">
          <div className="typo-label uppercase tracking-wider text-primary">{c.report_kicker}</div>
          {report ? (
            <h2 className="typo-heading text-foreground truncate">{report.title}</h2>
          ) : (
            <div className="h-5 w-48 max-w-full rounded-card bg-primary/[0.08] animate-fade-in" aria-hidden />
          )}
        </div>
        {report && (
          <RelativeTime timestamp={report.createdAt} className="typo-caption text-foreground tabular-nums shrink-0" />
        )}
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-5 py-4">
        <div className="mx-auto max-w-[74ch] space-y-4">
          {state.status === 'loading' && (
            <div className="space-y-2.5" aria-hidden data-testid="companion-report-ghost">
              {[92, 100, 84, 96, 60].map((w, i) => (
                <div
                  key={i}
                  className="h-3.5 rounded-card bg-primary/[0.06] animate-fade-in"
                  style={{ width: `${w}%`, animationDelay: `${120 + i * 35}ms` }}
                />
              ))}
            </div>
          )}
          {state.status === 'failed' && <p className="typo-body text-foreground">{c.report_load_failed}</p>}
          {report && (
            <>
              {report.summary && <p className="typo-body-lg text-foreground">{report.summary}</p>}
              <div className="typo-body text-foreground">
                <AssistantProse content={report.body} fold={false} codeBlockActions />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
