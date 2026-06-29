import { useEffect, useState } from 'react';
import { Activity, CheckCircle2, Bot, Key, type LucideIcon } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useAgentStore } from '@/stores/agentStore';
import { getMetricsSummary } from '@/api/overview/observability';
import { listCredentials } from '@/api/vault/credentials';
import { useTranslation } from '@/i18n/useTranslation';
import { CARD_PADDING } from '@/lib/utils/designTokens';
import { hasFailureSpike, fleetSuccessRatePct } from './lib/fleetHealth';
import type { SidebarSection } from '@/lib/types/types';
import { silentCatch } from '@/lib/silentCatch';


interface FleetMetrics {
  executionsToday: number;
  // Success rate over TERMINAL runs only (completed / (completed + failed)), or
  // null when nothing has finished yet (all in-flight) → render neutral "—".
  successRate: number | null;
  credentialCount: number;
  hasFailureSpike: boolean;
}

const FLEET_METRICS_REFRESH_MS = 30_000;

function useFleetMetrics() {
  const [metrics, setMetrics] = useState<FleetMetrics | null>(null);

  useEffect(() => {
    // `cancelled` guards against a state write after unmount (the fetch can
    // resolve once the home view is gone). The interval keeps the strip fresh —
    // it previously loaded once on mount and then froze for the session.
    let cancelled = false;
    const load = async () => {
      try {
        const [summary, credentials] = await Promise.all([
          getMetricsSummary(1),
          listCredentials(),
        ]);
        if (cancelled) return;

        // Rate + spike are computed over TERMINAL executions only (completed +
        // failed); in-flight/cancelled rows are excluded so the pill isn't
        // diluted by running work (see lib/fleetHealth.ts). `successfulExecutions`
        // is the backend's `completed` count.
        setMetrics({
          executionsToday: summary.totalExecutions,
          successRate: fleetSuccessRatePct(summary.successfulExecutions, summary.failedExecutions),
          credentialCount: credentials.length,
          hasFailureSpike: hasFailureSpike(summary.successfulExecutions, summary.failedExecutions),
        });
      } catch (err) {
        if (!cancelled) silentCatch("features/home/sub_welcome/FleetHealthStrip:catch1")(err);
      }
    };

    void load();
    const id = setInterval(() => void load(), FLEET_METRICS_REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return metrics;
}

interface PillProps {
  icon: LucideIcon;
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
        <span className="typo-caption text-foreground leading-tight truncate">{label}</span>
      </div>
    </button>
  );
}

export default function FleetHealthStrip() {
  const metrics = useFleetMetrics();
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  // "Active agents" = ENABLED personas (the configured fleet), NOT personas that
  // happened to execute in the metrics window. summary.activePersonas counts the
  // latter (correct for the observability KPI, wrong for this pill). Mirror the
  // cockpit-summary convention: enabled !== false.
  const activeAgents = useAgentStore(
    (s) => s.personas.filter((p) => p.enabled !== false).length,
  );
  const { t: globalT } = useTranslation();
  const t = globalT.home;

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
        // No finished runs yet (all in-flight / nothing executed) → successRate
        // is null; show a neutral "—" instead of a misleading confident "0%"/
        // "100%" for a fleet whose runs haven't terminated.
        value={metrics.successRate !== null ? `${metrics.successRate}%` : '—'}
        onClick={nav('overview')}
        pulse={metrics.hasFailureSpike}
        accentColor={metrics.hasFailureSpike ? 'bg-red-500/15' : 'bg-emerald-500/15'}
        iconColor={metrics.hasFailureSpike ? 'text-red-400' : 'text-emerald-400'}
      />
      <MetricPill
        icon={Bot}
        label={fleet.active_agents}
        value={activeAgents}
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
