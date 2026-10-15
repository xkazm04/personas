// The act log across every mandate (L): the same counted filters and rows as
// a mandate page's, each row naming its mandate. Enter opens the selected
// act's mandate page. Opened at an act (the dock ticker's press), it selects
// that act once the page of acts holds it and scrolls it into view.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import type { MandateSummary } from '@/lib/bindings/MandateSummary';
import { ActLog, visibleActs } from './ActLog';
import { useActLog, type ActFilter } from './useActLog';
import { useDrawerListKeys } from './useDrawerKeys';

export function LedgerView({ mandates, focusActId = null, onOpen }: {
  mandates: readonly MandateSummary[] | null;
  /** Select this act on arrival (once). */
  focusActId?: string | null;
  onOpen: (charterId: string) => void;
}) {
  const { t } = useTranslation();
  const m = t.monitor;
  const log = useActLog(null);
  const [filter, setFilter] = useState<ActFilter>('all');
  const [selected, setSelected] = useState(0);
  const rows = useMemo(() => visibleActs(log, filter), [log, filter]);
  const names = useMemo(() => new Map((mandates ?? []).map((x) => [x.charterId, x.projectName ?? x.title])), [mandates]);
  const titles = useMemo(() => new Map((mandates ?? []).map((x) => [x.charterId, x.title])), [mandates]);
  const host = useRef<HTMLDivElement>(null);
  const focused = useRef(false);
  useEffect(() => {
    if (!focusActId || focused.current) return;
    const at = rows.findIndex((a) => a.id === focusActId);
    if (at < 0) return;
    focused.current = true;
    setSelected(at);
  }, [focusActId, rows]);
  useEffect(() => {
    if (!focused.current) return;
    host.current?.querySelector('[aria-current="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);
  const cur = rows[Math.min(selected, rows.length - 1)];
  useDrawerListKeys({ count: rows.length, selected, onSelect: setSelected, onEnter: () => { if (cur) onOpen(cur.charterId); } });

  return (
    <div ref={host} className="flex min-h-0 flex-1 flex-col" data-testid="mandate-ledger">
      <ActLog
        log={log}
        filter={filter}
        onFilter={(f) => { setFilter(f); setSelected(0); }}
        rows={rows}
        selected={selected}
        onSelect={setSelected}
        mandateName={(id) => names.get(id) ?? m.ml_project_unknown}
        mandateTitle={(id) => titles.get(id) ?? null}
      />
    </div>
  );
}
