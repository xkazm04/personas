import { useTranslation } from '@/i18n/useTranslation';
import { AlertCircle, CheckCircle2, AlertTriangle, Activity } from 'lucide-react';
import type { AuditIncidentSummary } from '@/lib/bindings/AuditIncidentSummary';

interface Props {
  summary: AuditIncidentSummary | null;
}

export function IncidentsInboxKpiHeader({ summary }: Props) {
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
      />
      <Tile
        label={t.overview.incidents.kpi_critical}
        value={critical}
        Icon={AlertTriangle}
        tone="danger"
        sublabel={critical > 0 ? t.overview.incidents.urgency_critical : undefined}
      />
      <Tile
        label={t.overview.incidents.kpi_acknowledged}
        value={ack}
        Icon={Activity}
        tone="info"
      />
      <Tile
        label={t.overview.incidents.kpi_resolved}
        value={resolved}
        Icon={CheckCircle2}
        tone="success"
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
}

function Tile({ label, value, Icon, tone, sublabel }: TileProps) {
  const accent = toneClass(tone);
  return (
    <div className="flex items-center gap-3 rounded-card border border-primary/10 bg-secondary/20 p-3">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-card ${accent}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="flex min-w-0 flex-col">
        <span className="typo-caption text-foreground">{label}</span>
        <span className="typo-heading text-foreground">{value}</span>
        {sublabel && <span className="typo-caption text-foreground truncate">{sublabel}</span>}
      </div>
    </div>
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
