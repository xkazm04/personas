// KPI popover — opened from a project's KPIs dimension cell. The cell is the
// loudest one on an island (an off-track KPI paints it red), so the click has
// to answer the question the colour raises: WHICH one. Lists every KPI on the
// project, worst status first, each with its current/target reading.
//
// Rows are inert (the per-KPI action layer — jump into the KPI dashboard — is
// the natural next step). Styled to match the app's sidebar menus, like the
// goal/persona/fleet list popovers.
import { useEffect, useRef } from 'react';
import { Gauge } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';

import { mix } from './ink';

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
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => { if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose(); };
    window.addEventListener('keydown', onKey);
    const id = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => { window.removeEventListener('keydown', onKey); window.clearTimeout(id); document.removeEventListener('mousedown', onDown); };
  }, [onClose]);

  const sorted = [...items].sort((a, b) => RANK[a.status] - RANK[b.status] || a.name.localeCompare(b.name));
  const off = sorted.filter((k) => k.status === 'crit').length;

  return (
    <div
      ref={panelRef}
      className="fixed z-50 w-[272px] rounded-card border border-primary/15 bg-secondary/95 backdrop-blur-sm shadow-elevation-4 overflow-hidden"
      style={{ left: x, top: y }}
      onPointerDown={(e) => e.stopPropagation()}
      data-testid="mm-kpi-list"
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/10 bg-primary/5">
        <Gauge className="w-4 h-4 shrink-0" style={{ color: off > 0 ? 'var(--status-error)' : 'var(--status-success)' }} aria-hidden />
        <span className="typo-label text-foreground/90">{t.mastermind.kpis_title}</span>
        <span className="ml-auto typo-caption text-foreground/50 tabular-nums">{sorted.length}</span>
      </div>
      <ul className="max-h-[280px] overflow-y-auto py-1">
        {sorted.map((k) => (
          <li key={k.id} className="flex items-center gap-2.5 px-3 py-2 typo-body text-foreground/70">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: mix(STATUS_INK[k.status], 85) }} aria-hidden />
            <span className="truncate flex-1">{k.name}</span>
            <span className="typo-caption text-foreground/50 tabular-nums shrink-0">
              {k.current == null ? t.mastermind.kpi_unmeasured : `${k.current} / ${k.target}${k.unit ? ` ${k.unit}` : ''}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
