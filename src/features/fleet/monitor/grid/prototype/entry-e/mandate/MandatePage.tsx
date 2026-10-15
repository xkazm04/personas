// The mandate page: one mandate drawn as a card. Two views under its head:
// the act log (1, the default: what was decided inside the envelope, and by
// whom) and the Scopes section (2: per scope its acts, or what widening it
// would take off your desk; W widens, N narrows). The envelope sits in the
// rail, and the rail's doors act on the selected act: S suspends or resumes,
// V reverts, N takes the act's scope back.

import { useCallback, useMemo, useState } from 'react';
import { SegmentedTabs, segmentedTabPanelProps } from '@/features/shared/components/layout/SegmentedTabs';
import { useTranslation } from '@/i18n/useTranslation';
import type { MandateSummary } from '@/lib/bindings/MandateSummary';
import { Kbd } from '../parts';
import { ActLog, visibleActs } from './ActLog';
import { MandateRail } from './MandateRail';
import { ScopesView } from './scopes/ScopesView';
import { useScopes } from './scopes/useScopes';
import { useActLog, type ActFilter } from './useActLog';
import { useDrawerListKeys } from './useDrawerKeys';
import { useMandateDoors } from './useMandateDoors';
import { statusLabel } from './mandateCopy';

type PageView = 'log' | 'scopes';
const TABS_ID = 'mandate-page-view';

export function MandatePage({ mandate, held, onChanged }: {
  mandate: MandateSummary;
  held: number | null;
  /** Re-read the mandates after a door wrote (the act event also does). */
  onChanged: () => void;
}) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const log = useActLog(mandate.charterId);
  const [view, setView] = useState<PageView>('log');
  const [filter, setFilter] = useState<ActFilter>('all');
  const [selected, setSelected] = useState(0);
  const [scopeSel, setScopeSel] = useState(0);
  const rows = useMemo(() => visibleActs(log, filter), [log, filter]);
  const act = view === 'log' ? rows[Math.min(selected, rows.length - 1)] ?? null : null;
  const done = useCallback(() => { onChanged(); log.refresh(); }, [onChanged, log]);
  const doors = useMandateDoors(mandate, act, done);
  const scopes = useScopes(mandate.charterId, done);
  const pick = useCallback((f: ActFilter) => { setFilter(f); setSelected(0); }, []);
  const show = useCallback((v: PageView) => { scopes.disarm(); setView(v); }, [scopes]);

  useDrawerListKeys({
    enabled: view === 'log',
    count: rows.length,
    selected,
    onSelect: setSelected,
    letters: {
      s: () => { void doors.suspend(); },
      v: () => { void doors.revert(); },
      n: () => { void doors.narrow(); },
      2: () => show('scopes'),
    },
  });

  const tabs = [
    { id: 'log' as const, label: <span className="flex items-center gap-1.5">{m.ml_act_log} <Kbd>1</Kbd></span>, testId: 'mandate-view-log' },
    { id: 'scopes' as const, label: <span className="flex items-center gap-1.5">{m.ml_scopes} <Kbd>2</Kbd></span>, testId: 'mandate-view-scopes' },
  ];

  return (
    <div className="flex min-h-0 flex-1 gap-4" data-testid="mandate-page" data-charter={mandate.charterId} data-view={view}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        <header className="flex flex-col gap-1">
          <span className="typo-eyebrow">
            {[m.ml_mandate, mandate.projectName ?? m.ml_project_unknown, statusLabel(m, mandate.status)].join(' · ')}
          </span>
          <h3 className="typo-heading text-foreground">{mandate.title}</h3>
          <p className="typo-body text-foreground">
            {tx(m.ml_mandate_context, { steward: mandate.stewardName ?? m.ml_steward_unknown, rung: mandate.scopeRung })}
          </p>
        </header>
        <SegmentedTabs tabs={tabs} activeTab={view} onTabChange={show} variant="segment" size="sm" ariaLabel={m.ml_mandate_views_aria} idPrefix={TABS_ID} />
        <div {...segmentedTabPanelProps(TABS_ID, view)} role="tabpanel" className="flex min-h-0 flex-1 flex-col">
        {view === 'log' ? (
          <ActLog log={log} filter={filter} onFilter={pick} rows={rows} selected={selected} onSelect={setSelected} mandateTitle={() => mandate.title} />
        ) : (
          <ScopesView
            state={scopes}
            selected={scopeSel}
            onSelect={setScopeSel}
            extraLetters={{ s: () => { void doors.suspend(); }, 1: () => show('log') }}
          />
        )}
        </div>
      </div>
      <MandateRail
        mandate={mandate}
        held={held}
        act={act}
        notice={doors.notice}
        onSuspend={doors.suspend}
        onRevert={doors.revert}
        onNarrow={doors.narrow}
      />
    </div>
  );
}
