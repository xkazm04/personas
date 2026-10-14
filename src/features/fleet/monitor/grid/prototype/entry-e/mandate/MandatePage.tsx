// The mandate page: one mandate drawn as a card. Its act log comes first
// (what was decided inside the envelope, and by whom), the envelope sits in
// the rail, and the page's doors act on the selected act: S suspends or
// resumes, V reverts, N takes the act's scope back.

import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import type { MandateSummary } from '@/lib/bindings/MandateSummary';
import { ActLog, visibleActs } from './ActLog';
import { MandateRail } from './MandateRail';
import { useActLog, type ActFilter } from './useActLog';
import { useDrawerListKeys } from './useDrawerKeys';
import { useMandateDoors } from './useMandateDoors';
import { statusLabel } from './mandateCopy';

export function MandatePage({ mandate, held, onChanged }: {
  mandate: MandateSummary;
  held: number | null;
  /** Re-read the mandates after a door wrote (the act event also does). */
  onChanged: () => void;
}) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const log = useActLog(mandate.charterId);
  const [filter, setFilter] = useState<ActFilter>('all');
  const [selected, setSelected] = useState(0);
  const rows = useMemo(() => visibleActs(log, filter), [log, filter]);
  const act = rows[Math.min(selected, rows.length - 1)] ?? null;
  const done = useCallback(() => { onChanged(); log.refresh(); }, [onChanged, log]);
  const doors = useMandateDoors(mandate, act, done);
  const pick = useCallback((f: ActFilter) => { setFilter(f); setSelected(0); }, []);

  useDrawerListKeys({
    count: rows.length,
    selected,
    onSelect: setSelected,
    letters: {
      s: () => { void doors.suspend(); },
      v: () => { void doors.revert(); },
      n: () => { void doors.narrow(); },
    },
  });

  return (
    <div className="flex min-h-0 flex-1 gap-4" data-testid="mandate-page" data-charter={mandate.charterId}>
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
        <span className="typo-eyebrow">{m.ml_act_log}</span>
        <ActLog log={log} filter={filter} onFilter={pick} rows={rows} selected={selected} onSelect={setSelected} />
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
