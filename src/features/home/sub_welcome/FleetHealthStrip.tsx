import { useEffect } from 'react';
import { Activity, CheckCircle2, Bot, Key, type LucideIcon } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useAgentStore } from '@/stores/agentStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { useTranslation } from '@/i18n/useTranslation';
import { CARD_PADDING } from '@/lib/utils/designTokens';
import { hasFailureSpike, fleetSuccessRatePct } from './lib/fleetHealth';
import { useVaultCredentials } from './lib/useVaultCredentials';
import { usePausableInterval } from '../lib/usePausableInterval';
import type { SidebarSection } from '@/lib/types/types';

const FLEET_METRICS_REFRESH_MS = 30_000;

/** Shaped placeholder while the first metrics snapshot loads — four pill-sized
 *  shimmer blocks matching the real strip's layout, so chrome lands without a
 *  jump when data arrives (replaces the old render-nothing behavior). */
function FleetHealthStripSkeleton() {
  return (
    <div className="flex items-center gap-2 flex-wrap" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className={`animate-pulse rounded-interactive bg-primary/5 border border-primary/10 ${CARD_PADDING.compact} flex items-center gap-2`}
        >
          <div className="w-6 h-6 rounded-interactive bg-primary/10 flex-shrink-0" />
          <div className="flex flex-col gap-1">
            <div className="h-3 w-8 rounded bg-primary/10" />
            <div className="h-2.5 w-14 rounded bg-primary/8" />
          </div>
        </div>
      ))}
    </div>
  );
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
  // Fleet metrics ride the shared Overview spine (homeSpineSlice): FleetHealthStrip
  // reads the cached 1-day snapshot and triggers the SHARED fetch — it no longer
  // owns any IPC. Credentials come from the single canonical vault source.
  const metrics = useOverviewStore((s) => s.fleetMetrics);
  const credentialCount = useVaultCredentials().length;
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

  // The poll only runs while the Welcome tab is the visible Home tab AND the
  // window isn't hidden — see usePausableInterval. Under the keep-alive HomePage
  // the strip stays mounted when the user switches tabs, so an unguarded poll
  // would keep hitting the backend off-screen.
  const active = useSystemStore((s) => s.sidebarSection === 'home' && s.homeTab === 'welcome');

  // Initial load on mount (the pausable interval handles refresh thereafter).
  // The store action is TTL-guarded + dedup-safe, so this coexists with the nav
  // hook's prime call without doubling backend work.
  useEffect(() => {
    void useOverviewStore.getState().fetchFleetMetrics();
  }, []);
  usePausableInterval(
    () => void useOverviewStore.getState().fetchFleetMetrics(),
    FLEET_METRICS_REFRESH_MS,
    active,
  );

  if (!metrics) return <FleetHealthStripSkeleton />;

  const nav = (section: SidebarSection) => () => setSidebarSection(section);
  const fleet = t.fleet;

  // Rate + spike are computed over TERMINAL executions only (completed + failed);
  // in-flight/cancelled rows are excluded so the pill isn't diluted by running
  // work (see lib/fleetHealth.ts). `successfulExecutions` is the backend's
  // `completed` count.
  const successRate = fleetSuccessRatePct(metrics.successfulExecutions, metrics.failedExecutions);
  const failureSpike = hasFailureSpike(metrics.successfulExecutions, metrics.failedExecutions);

  return (
    <div className="animate-fade-slide-in motion-reduce:animate-none flex items-center gap-2 flex-wrap">
      <MetricPill
        icon={Activity}
        label={fleet.executions_today}
        value={metrics.totalExecutions}
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
        value={successRate !== null ? `${successRate}%` : '—'}
        onClick={nav('overview')}
        pulse={failureSpike}
        accentColor={failureSpike ? 'bg-status-error/15' : 'bg-status-success/15'}
        iconColor={failureSpike ? 'text-status-error' : 'text-status-success'}
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
        value={credentialCount}
        onClick={nav('credentials')}
        accentColor="bg-amber-500/15"
        iconColor="text-amber-400"
      />
    </div>
  );
}
