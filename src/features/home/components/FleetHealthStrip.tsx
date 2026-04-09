import { useEffect, useState, useCallback } from 'react';
import { Activity, CheckCircle2, Bot, Key } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { getMetricsSummary } from '@/api/overview/observability';
import { listCredentials } from '@/api/vault/credentials';
import { useHomeTranslation } from '../i18n/useTranslation';
import { CARD_PADDING } from '@/lib/utils/designTokens';
import type { SidebarSection } from '@/lib/types/types';

interface FleetMetrics {
  executionsToday: number;
  successRate: number;
  activePersonas: number;
  credentialCount: number;
  hasFailureSpike: boolean;
}

function useFleetMetrics() {
  const [metrics, setMetrics] = useState<FleetMetrics | null>(null);

  const load = useCallback(async () => {
    try {
      const [summary, credentials] = await Promise.all([
        getMetricsSummary(1),
        listCredentials(),
      ]);

      const rate = summary.totalExecutions > 0
        ? Math.round((summary.successfulExecutions / summary.totalExecutions) * 100)
        : 100;

      const hasFailureSpike = summary.totalExecutions >= 3 && summary.failedExecutions / summary.totalExecutions > 0.5;

      setMetrics({
        executionsToday: summary.totalExecutions,
        successRate: rate,
        activePersonas: summary.activePersonas,
        credentialCount: credentials.length,
        hasFailureSpike,
      });
    } catch {
      // Silently fail — strip just won't render
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return metrics;
}

interface PillProps {
  icon: React.ElementType;
  label: string;
  value: string | number;
  onClick: () => void;
  pulse?: boolean;
  accentColor: string;
  iconColor: string;
}

function MetricPill({ icon: Icon, label, value, onClick, pulse, accentColor, iconColor }: PillProps) {
  return (
    <button
      onClick={onClick}
      className={[
        'group flex items-center gap-2 rounded-interactive',
        CARD_PADDING.compact,
        'bg-primary/5 border border-primary/10',
        'hover:border-primary/25 hover:bg-primary/8',
        'transition-all duration-200 cursor-pointer',
        pulse ? 'animate-pulse' : '',
      ].join(' ')}
    >
      <div className={`flex-shrink-0 rounded-interactive ${accentColor} flex items-center justify-center w-6 h-6`}>
        <Icon className={`w-3.5 h-3.5 ${iconColor}`} />
      </div>
      <div className="flex flex-col items-start min-w-0">
        <span className="typo-data text-foreground leading-tight">{value}</span>
        <span className="typo-caption text-muted-foreground leading-tight truncate">{label}</span>
      </div>
    </button>
  );
}

export default function FleetHealthStrip() {
  const metrics = useFleetMetrics();
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const { t } = useHomeTranslation();

  if (!metrics) return null;

  const nav = (section: SidebarSection) => () => setSidebarSection(section);

  const fleet = t.fleet;

  return (
    <div className="animate-fade-slide-in motion-reduce:animate-none flex items-center gap-2 flex-wrap">
      <MetricPill
        icon={Activity}
        label={fleet.executions_today}
        value={metrics.executionsToday}
        onClick={nav('overview')}
        accentColor="bg-indigo-500/15"
        iconColor="text-indigo-400"
      />
      <MetricPill
        icon={CheckCircle2}
        label={fleet.success_rate}
        value={`${metrics.successRate}%`}
        onClick={nav('overview')}
        pulse={metrics.hasFailureSpike}
        accentColor={metrics.hasFailureSpike ? 'bg-red-500/15' : 'bg-emerald-500/15'}
        iconColor={metrics.hasFailureSpike ? 'text-red-400' : 'text-emerald-400'}
      />
      <MetricPill
        icon={Bot}
        label={fleet.active_agents}
        value={metrics.activePersonas}
        onClick={nav('personas')}
        accentColor="bg-cyan-500/15"
        iconColor="text-cyan-400"
      />
      <MetricPill
        icon={Key}
        label={fleet.credentials}
        value={metrics.credentialCount}
        onClick={nav('credentials')}
        accentColor="bg-amber-500/15"
        iconColor="text-amber-400"
      />
    </div>
  );
}
