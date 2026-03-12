import { useEffect, useRef } from 'react';
import { Activity } from 'lucide-react';
import { useHealthCheck, HealthCheckPanel } from '@/features/agents/health';
import { isTimestampStale } from '@/stores/slices/agents/healthCheckSlice';
import { usePersonaStore } from '@/stores/personaStore';

export function HealthTab() {
  const healthCheck = useHealthCheck();
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);
  const autoRefreshed = useRef(false);

  // Auto-trigger a refresh when the tab becomes visible with stale data
  useEffect(() => {
    if (autoRefreshed.current || !selectedPersona) return;
    if (healthCheck.phase !== 'done' || !healthCheck.result) return;

    if (isTimestampStale(healthCheck.result.checkedAt)) {
      autoRefreshed.current = true;
      healthCheck.runHealthCheck(selectedPersona);
    }
  }, [healthCheck.phase, healthCheck.result, selectedPersona, healthCheck.runHealthCheck]);

  // Reset auto-refresh latch when persona changes
  useEffect(() => {
    autoRefreshed.current = false;
  }, [selectedPersona?.id]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-2">
        <Activity className="w-5 h-5 text-primary/60" aria-hidden="true" />
        <h2 className="text-base font-semibold text-foreground/80">Health Check</h2>
      </div>

      <p className="text-sm text-muted-foreground/70">
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
