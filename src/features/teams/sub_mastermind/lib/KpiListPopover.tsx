// KPI popover — opened from a project's KPIs dimension cell. The cell is the
// loudest one on an island (an off-track KPI paints it red), so the click has
// to answer the question the colour raises: WHICH one. Lists every KPI on the
// project, worst status first, each with its current/target reading.
//
// Rows are inert (the per-KPI action layer — jump into the KPI dashboard — is
// the natural next step). Chrome + dismissal come from ListPopover.
import { Gauge } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';

import { mix } from './ink';
import { ListPopover } from './ListPopover';

/** One row: a KPI reduced to what the popover renders. Built by the page from
 *  the Factory project so this component stays free of the factory model. */
export interface KpiListItem {
  id: string;
  name: string;
  /** Factory KpiStatus — drives the dot colour and the sort order. */
  status: 'crit' | 'warn' | 'ok' | 'met' | 'unmeasured';
  current: number | null;
  target: number;
  unit: string;
}

/** Worst first: an island painted red should list its red KPIs at the top. */
const RANK: Record<KpiListItem['status'], number> = { crit: 0, warn: 1, ok: 2, met: 3, unmeasured: 4 };

const STATUS_INK: Record<KpiListItem['status'], string> = {
  crit: 'var(--status-error)',
  warn: 'var(--status-warning)',
  ok: 'var(--status-info)',
  met: 'var(--status-success)',
  unmeasured: 'var(--muted-foreground)',
};

export function KpiListPopover({ items, x, y, onClose }: {
  items: KpiListItem[];
  /** Viewport-space anchor (clamped by the caller). */
  x: number;
  y: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const sorted = [...items].sort((a, b) => RANK[a.status] - RANK[b.status] || a.name.localeCompare(b.name));
  const off = sorted.filter((k) => k.status === 'crit').length;

  return (
    <ListPopover
      title={t.mastermind.kpis_title}
      icon={Gauge}
      ink={off > 0 ? 'var(--status-error)' : 'var(--status-success)'}
      trailing={sorted.length}
      x={x}
      y={y}
      width={272}
      maxListHeight={280}
      testId="mm-kpi-list"
      onClose={onClose}
    >
      {sorted.map((k) => (
        <li key={k.id} className="flex items-center gap-2.5 px-3 py-2 typo-body text-foreground/70">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: mix(STATUS_INK[k.status], 85) }} aria-hidden />
          <span className="truncate flex-1">{k.name}</span>
          <span className="typo-caption text-foreground/50 tabular-nums shrink-0">
            {k.current == null ? t.mastermind.kpi_unmeasured : `${k.current} / ${k.target}${k.unit ? ` ${k.unit}` : ''}`}
          </span>
        </li>
      ))}
    </ListPopover>
  );
}
