import { useTranslation } from '@/i18n/useTranslation';
import { AlertCircle, CheckCircle2, AlertTriangle, Activity } from 'lucide-react';
import type { AuditIncidentSummary } from '@/lib/bindings/AuditIncidentSummary';
import type { IncidentFilters } from '@/lib/bindings/IncidentFilters';

interface Props {
  summary: AuditIncidentSummary | null;
  /** Current inbox filters — drives which tile reads as active. */
  filters: IncidentFilters;
  /** Apply a tile's filter slice (clicking a KPI jumps the inbox to that view). */
  onApplyFilters: (next: IncidentFilters) => void;
}

// Each tile is a one-click jump to the exact slice its number counts. The
// summary KPIs are global (no source/time/persona scoping), so the targets
// clear those dimensions to keep the list count matching the headline number.
const OPEN_FILTERS: IncidentFilters = {
  statuses: ['open'], severities: null, source_tables: null, persona_id: null, since: null,
};
const CRITICAL_FILTERS: IncidentFilters = {
  statuses: ['open'], severities: ['critical'], source_tables: null, persona_id: null, since: null,
};
const ACK_FILTERS: IncidentFilters = {
  statuses: ['acknowledged'], severities: null, source_tables: null, persona_id: null, since: null,
};
const RESOLVED_FILTERS: IncidentFilters = {
  statuses: ['resolved'], severities: null, source_tables: null, persona_id: null, since: null,
};

function arrEq(a: readonly string[] | null | undefined, b: readonly string[] | null | undefined): boolean {
  const xs = a ?? [];
  const ys = b ?? [];
  return xs.length === ys.length && xs.every((v, i) => v === ys[i]);
}

/** True when the inbox is currently showing exactly this tile's slice. */
function filtersMatch(a: IncidentFilters, b: IncidentFilters): boolean {
  return (
    arrEq(a.statuses, b.statuses) &&
    arrEq(a.severities, b.severities) &&
    arrEq(a.source_tables, b.source_tables) &&
    (a.persona_id ?? null) === (b.persona_id ?? null) &&
    (a.since ?? null) === (b.since ?? null)
  );
}

export function IncidentsInboxKpiHeader({ summary, filters, onApplyFilters }: Props) {
  const { t } = useTranslation();
  const open = Number(summary?.open ?? 0);
  const ack = Number(summary?.acknowledged ?? 0);
  const resolved = Number(summary?.resolved ?? 0);
  const critical = Number(
    summary?.openBySeverity.find(([sev]) => sev === 'critical')?.[1] ?? 0,
  );

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Tile
        label={t.overview.incidents.kpi_open}
        value={open}
        Icon={AlertCircle}
        tone="warning"
        active={filtersMatch(filters, OPEN_FILTERS)}
        onClick={() => onApplyFilters(OPEN_FILTERS)}
      />
      <Tile
        label={t.overview.incidents.kpi_critical}
        value={critical}
        Icon={AlertTriangle}
        tone="danger"
        sublabel={critical > 0 ? t.overview.incidents.urgency_critical : undefined}
        active={filtersMatch(filters, CRITICAL_FILTERS)}
        onClick={() => onApplyFilters(CRITICAL_FILTERS)}
      />
      <Tile
        label={t.overview.incidents.kpi_acknowledged}
        value={ack}
        Icon={Activity}
        tone="info"
        active={filtersMatch(filters, ACK_FILTERS)}
        onClick={() => onApplyFilters(ACK_FILTERS)}
      />
      <Tile
        label={t.overview.incidents.kpi_resolved}
        value={resolved}
        Icon={CheckCircle2}
        tone="success"
        active={filtersMatch(filters, RESOLVED_FILTERS)}
        onClick={() => onApplyFilters(RESOLVED_FILTERS)}
      />
    </div>
  );
}

interface TileProps {
  label: string;
  value: number;
  Icon: typeof AlertCircle;
  tone: 'warning' | 'danger' | 'info' | 'success';
  /** Optional plain-language framing shown under the value (e.g. urgency). */
  sublabel?: string;
  active: boolean;
  onClick: () => void;
}

function Tile({ label, value, Icon, tone, sublabel, active, onClick }: TileProps) {
  const accent = toneClass(tone);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-3 rounded-card border p-3 text-left transition-colors focus-ring ${
        active
          ? 'border-primary/40 bg-primary/10'
          : 'border-primary/10 bg-secondary/20 hover:bg-secondary/40'
      }`}
    >
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-card ${accent}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="flex min-w-0 flex-col">
        <span className="typo-caption text-foreground">{label}</span>
        <span className="typo-heading text-foreground">{value}</span>
        {sublabel && <span className="typo-caption text-foreground truncate">{sublabel}</span>}
      </div>
    </button>
  );
}

function toneClass(tone: 'warning' | 'danger' | 'info' | 'success'): string {
  switch (tone) {
    case 'warning': return 'bg-amber-500/15 text-amber-400';
    case 'danger': return 'bg-red-500/15 text-red-400';
    case 'info': return 'bg-blue-500/15 text-blue-400';
    case 'success': return 'bg-emerald-500/15 text-emerald-400';
  }
}
