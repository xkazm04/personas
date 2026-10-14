// The act log across every mandate (L): the same counted filters and rows as
// a mandate page's, each row naming its mandate. Enter opens the selected
// act's mandate page.

import { useMemo, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import type { MandateSummary } from '@/lib/bindings/MandateSummary';
import { ActLog, visibleActs } from './ActLog';
import { useActLog, type ActFilter } from './useActLog';
import { useDrawerListKeys } from './useDrawerKeys';

export function LedgerView({ mandates, onOpen }: {
  mandates: readonly MandateSummary[] | null;
  onOpen: (charterId: string) => void;
}) {
  const { t } = useTranslation();
  const m = t.monitor;
  const log = useActLog(null);
  const [filter, setFilter] = useState<ActFilter>('all');
  const [selected, setSelected] = useState(0);
  const rows = useMemo(() => visibleActs(log, filter), [log, filter]);
  const names = useMemo(() => new Map((mandates ?? []).map((x) => [x.charterId, x.projectName ?? x.title])), [mandates]);
  const cur = rows[Math.min(selected, rows.length - 1)];
  useDrawerListKeys({ count: rows.length, selected, onSelect: setSelected, onEnter: () => { if (cur) onOpen(cur.charterId); } });

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="mandate-ledger">
      <ActLog
        log={log}
        filter={filter}
        onFilter={(f) => { setFilter(f); setSelected(0); }}
        rows={rows}
        selected={selected}
        onSelect={setSelected}
        mandateName={(id) => names.get(id) ?? m.ml_project_unknown}
      />
    </div>
  );
}
