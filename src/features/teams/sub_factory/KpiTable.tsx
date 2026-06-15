// Shared L3 — the KPI table. One KPI per row (single line); click a row to open
// the calibration console. The KPI category is its own column rendered as a
// lucide icon (no more "Technical · weekly" subtitle — cadence dropped, type
// promoted to an icon column). Rows sort worst → best so attention lands on top.
import { useState } from 'react';
import { ArrowUpDown, Wrench, ShieldCheck, Activity, Gem, type LucideIcon } from 'lucide-react';

import {
  STATUS_COLOR,
  CATEGORY_LABEL,
  kpiStatus,
  progressPct,
  type KpiStatus,
  type MockKpi,
} from './factoryMock';
import { Sparkline, StatusDot, StatusPill, KpiBarRating } from './factoryPrimitives';

const SEV: Record<KpiStatus, number> = { crit: 0, warn: 1, ok: 2, met: 3, unmeasured: 4 };

/** KPI category enum → lucide icon (its own column). */
const CATEGORY_ICON: Record<string, LucideIcon> = {
  technical: Wrench,
  quality: ShieldCheck,
  traffic: Activity,
  value: Gem,
};

function TypeIcon({ category }: { category: string }) {
  const Icon = CATEGORY_ICON[category] ?? Wrench;
  return (
    <span className="justify-self-center" title={CATEGORY_LABEL[category as keyof typeof CATEGORY_LABEL] ?? category}>
      <Icon className="w-4 h-4 text-foreground/70" aria-label={category} />
    </span>
  );
}

type Density = 'compact' | 'comfortable' | 'spacious';
const ROW_PAD: Record<Density, string> = { compact: 'py-1.5', comfortable: 'py-2', spacious: 'py-3' };

export function KpiTable({
  kpis,
  onOpen,
  bar = 'bar',
  density = 'comfortable',
  withContext = true,
}: {
  kpis: Array<{ kpi: MockKpi; contextName: string }>;
  onOpen: (id: string) => void;
  bar?: 'bar' | 'segments' | 'meter';
  density?: Density;
  withContext?: boolean;
}) {
  const [sortWorst, setSortWorst] = useState(true);
  const rows = [...kpis].sort((a, b) => {
    const d = SEV[kpiStatus(a.kpi)] - SEV[kpiStatus(b.kpi)];
    return sortWorst ? d : -d;
  });
  const pad = ROW_PAD[density];

  return (
    <div className="rounded-card border border-primary/10 overflow-hidden">
      {/* header */}
      <div className={`grid items-center gap-3 px-3 ${pad} bg-secondary/20 border-b border-primary/10`} style={{ gridTemplateColumns: cols(withContext) }}>
        <span aria-hidden="true" />
        <button type="button" onClick={() => setSortWorst((s) => !s)} className="flex items-center gap-1 typo-label text-foreground/70 hover:text-foreground justify-self-start">
          KPI <ArrowUpDown className="w-3 h-3" />
        </button>
        {withContext && <span className="typo-label text-foreground/50 hidden lg:block">Context</span>}
        <span className="typo-label text-foreground/50">Rating</span>
        <span className="typo-label text-foreground/50 text-right">Value</span>
        <span className="typo-label text-foreground/50 text-center hidden md:block">Trend</span>
        <span className="typo-label text-foreground/50 text-right">Status</span>
      </div>
      {/* rows */}
      <div className="divide-y divide-primary/5">
        {rows.map(({ kpi, contextName }) => {
          const st = kpiStatus(kpi);
          const pct = progressPct(kpi);
          return (
            <button
              key={kpi.id}
              type="button"
              onClick={() => onOpen(kpi.id)}
              className={`w-full grid items-center gap-3 px-3 ${pad} text-left hover:bg-secondary/20 transition-colors`}
              style={{ gridTemplateColumns: cols(withContext) }}
            >
              <TypeIcon category={kpi.category} />
              <span className="flex items-center gap-2 min-w-0">
                <StatusDot status={st} size={9} />
                <span className="typo-title truncate">{kpi.name}</span>
              </span>
              {withContext && <span className="typo-caption truncate hidden lg:block">{contextName}</span>}
              <span className="flex items-center gap-2">
                <KpiBarRating kpi={kpi} variant={bar} width={density === 'spacious' ? 130 : 96} />
                {pct != null && <span className="typo-caption tabular-nums w-8">{pct}%</span>}
              </span>
              <span className="typo-data tabular-nums text-right" style={{ color: STATUS_COLOR[st] }}>
                {kpi.current ?? '—'}
                <span className="typo-caption"> / {kpi.target}{kpi.unit}</span>
              </span>
              <span className="justify-self-center hidden md:block">
                <Sparkline series={kpi.series} color={STATUS_COLOR[st]} width={56} height={16} />
              </span>
              <span className="justify-self-end"><StatusPill status={st} /></span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function cols(withContext: boolean): string {
  // type | name | (context) | rating | value | trend | status
  return withContext
    ? '36px minmax(150px,2fr) minmax(0,1fr) minmax(140px,1.2fr) 110px 72px 110px'
    : '36px minmax(150px,2.4fr) minmax(140px,1.2fr) 110px 72px 110px';
}
