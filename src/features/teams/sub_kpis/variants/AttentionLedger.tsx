// ATTENTION LEDGER — the strategic brief variant (kpi-strategic-map spark,
// WP2). Not a map: one section per project, exceptions first, ONE ranked next
// move, then what changed since the previous reading. Every sparkline on the
// surface shares one window and one 0–100 %-of-target axis, so a glance
// compares them honestly (registry: scale-and-axis-design).
import { useMemo } from 'react';

import Button from '@/features/shared/components/buttons/Button';
import { useTranslation } from '@/i18n/useTranslation';
import type { KpiVariantProps } from '../KPIDashboard';
import { sharedWindow } from '../kpiSample';
import { useLazyTrends } from '../useKpiOverview';
import { ledgerKpiIds } from './AttentionLedger.model';
import { LedgerSection } from './AttentionLedgerSection';

const GHOST_BAR = 'rounded bg-primary/[0.06]';

export default function AttentionLedger({ overview, loading, onFocus, onOpen }: KpiVariantProps) {
  const { t } = useTranslation();
  const o = t.kpis.overview;
  // Bounded read: LEDGER_ID_CAP ids at most, taken in project order (see
  // AttentionLedger.model.ts) — the ledger never turns into a fleet-wide dump.
  const ids = useMemo(() => ledgerKpiIds(overview), [overview]);
  const { trends, status, retry } = useLazyTrends(ids);
  const window = useMemo(() => sharedWindow(trends, ids, 'production'), [trends, ids]);
  const sparkGhost = status === 'loading' && Object.keys(trends).length === 0;

  if (loading && overview.length === 0) return <AttentionLedgerGhost />;

  return (
    <div className="space-y-3" data-testid="kpi-ledger">
      {status === 'failed' && (
        <div className="flex items-center gap-3">
          <p className="typo-caption text-foreground">{o.trends_failed}</p>
          <Button variant="ghost" size="sm" onClick={retry}>
            {o.retry}
          </Button>
        </div>
      )}
      {overview.map((project) => (
        <LedgerSection
          key={project.projectId}
          project={project}
          trends={trends}
          window={window}
          sparkGhost={sparkGhost}
          onFocus={onFocus}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

/** The only moment the ledger has nothing at all: cold store, read in flight.
 *  Two section silhouettes in the real geometry, invisible for their first
 *  ~150 ms (docs/design/overview-loading.md v2) so a fast read never flashes. */
function AttentionLedgerGhost() {
  return (
    <div className="space-y-3" data-testid="kpi-ledger-ghost" aria-hidden="true">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="rounded-card border border-primary/15 bg-secondary/10 p-4 space-y-2.5 animate-fade-in"
          style={{ animationDelay: `${150 + i * 35}ms` }}
        >
          <span className={`block h-3.5 w-40 ${GHOST_BAR}`} />
          <span className={`block h-2.5 w-2/3 ${GHOST_BAR}`} />
          <span className={`block h-2.5 w-1/2 ${GHOST_BAR}`} />
          <span className={`block h-2.5 w-3/5 ${GHOST_BAR}`} />
        </div>
      ))}
    </div>
  );
}
