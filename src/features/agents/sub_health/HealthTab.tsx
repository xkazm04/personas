import { Activity } from 'lucide-react';
import { useHealthCheck, HealthCheckPanel } from '@/features/agents/health';

export function HealthTab() {
  const healthCheck = useHealthCheck();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-2">
        <Activity className="w-5 h-5 text-primary/60" />
        <h2 className="text-base font-semibold text-foreground/80">Health Check</h2>
      </div>

      <p className="text-sm text-muted-foreground/60">
        Run a dry-run analysis against this agent's current configuration to detect missing credentials,
        disconnected connectors, incompatible tool combinations, and underspecified use cases.
        Issues are surfaced as actionable cards with one-click fixes.
      </p>

      <div className="rounded-xl border border-primary/20 bg-secondary/40 p-4">
        <HealthCheckPanel healthCheck={healthCheck} />
      </div>
    </div>
  );
}
