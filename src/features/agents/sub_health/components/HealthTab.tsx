import { useEffect, useRef } from 'react';
import { Activity } from 'lucide-react';
import { useHealthCheck, HealthCheckPanel } from '@/features/agents/health';
import { isTimestampStale } from '@/stores/slices/agents/healthCheckSlice';
import { useAgentStore } from "@/stores/agentStore";
import { useTranslation } from '@/i18n/useTranslation';

export function HealthTab() {
  const { t } = useTranslation();
  const healthCheck = useHealthCheck();
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
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
        <h2 className="text-base font-semibold text-foreground">{t.agents.health_tab.title}</h2>
      </div>

      <p className="text-sm text-foreground">
        {t.agents.health_tab.description}
      </p>

      <div className="rounded-modal border border-primary/20 bg-secondary/40 p-4">
        <HealthCheckPanel healthCheck={healthCheck} />
      </div>
    </div>
  );
}
