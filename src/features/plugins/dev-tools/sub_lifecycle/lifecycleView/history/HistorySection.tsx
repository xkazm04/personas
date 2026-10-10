/**
 * Layer 1's history, under the rail: a kit Section (its head says what the
 * figure is and that history is judged with TODAY's step settings) holding
 * the "what changed" line over the history figure.
 *
 * Every state is the same height (`HIST_BODY_REM`), so the rail above never
 * moves and the page below never jumps: a geometry-true ghost while the read
 * is pending (it starts on idle, after the rail painted), an inline Banner
 * with Retry when the read failed and nothing is warm, the shared empty state
 * (one line) when there is not yet a second Measure to compare, the figure
 * otherwise. A failed revalidation keeps the warm figure and says so in the
 * head.
 */
import { History, RefreshCw } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { Banner } from '@/features/shared/components/feedback/Banner';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { Section } from '@/features/shared/components/kit';

import { useLifecycleViewModel } from '../context';
import { lcSurface } from '../system/lcSurface';
import { LT } from '../system/lcType';
import { GLYPH } from '../system/scales';
import { HistoryFigure } from './HistoryFigure';
import { HistoryGhost } from './HistoryGhost';
import { HIST_BODY_REM } from './historyGeometry';
import { whatChanged } from './historyModel';
import { useTimeTravel } from './timeTravel';
import { WhatChanged } from './WhatChanged';

function Body({ ghost }: { ghost: boolean }) {
  const { dl } = useLifecycleViewModel();
  const { history, columns, error, refetch, viewedIndex } = useTimeTravel();
  if (ghost) return <HistoryGhost />;
  if (!history && error) {
    return (
      <div className="flex h-full items-center" data-testid="lc-history-failed">
        <Banner severity="error" compact message={dl.lcx3_history_failed} cause={error} onRetry={refetch} className="w-full" />
      </div>
    );
  }
  if (!history) return <HistoryGhost />;
  if (columns.length < 2) {
    return (
      <div className="h-full" data-testid="lc-history-empty">
        <EmptyState icon={History} title={dl.lcx3_history_empty} iconColor="text-primary" className="h-full py-0" />
      </div>
    );
  }
  const at = viewedIndex ?? columns.length - 1;
  return (
    <>
      <WhatChanged fragments={whatChanged(columns, at, history.stepIds)} viewing={viewedIndex !== null} />
      <div className="mt-2"><HistoryFigure /></div>
    </>
  );
}

/** `ghost`: Layer 1's cold-load ghost draws this frame in its loading state, whatever is cached. */
export function HistorySection({ ghost = false }: { ghost?: boolean }) {
  const { dl } = useLifecycleViewModel();
  const { history, columns, error, refetch } = useTimeTravel();
  const shown = !ghost && columns.length >= 2;
  const stale = !ghost && !!history && !!error;
  return (
    <div className={lcSurface('lane')} data-testid="lc-history">
      <Section
        level={2}
        title={dl.lcx3_history}
        count={shown ? columns.length : undefined}
        meta={<span className={LT.meta}>{dl.lcx3_history_caption}</span>}
        actions={stale ? (
          <Button variant="ghost" size="xs" icon={<RefreshCw className={GLYPH.sm} />} onClick={refetch} data-testid="lc-history-retry">
            <span className="text-status-error">{dl.lcx3_history_stale}</span>
          </Button>
        ) : undefined}
      >
        <div className="k-in" style={{ height: `${HIST_BODY_REM}rem` }} data-history-state={ghost || (!history && !error) ? 'loading' : !history ? 'failed' : shown ? 'figure' : 'empty'}>
          <Body ghost={ghost} />
        </div>
      </Section>
    </div>
  );
}
