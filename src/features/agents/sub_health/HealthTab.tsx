import { Activity } from 'lucide-react';
import { useHealthCheck, HealthCheckPanel } from '@/features/agents/health';
import { useTranslation } from '@/i18n/useTranslation';

export function HealthTab() {
  const { t } = useTranslation();
  const healthCheck = useHealthCheck();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-2">
        <Activity className="w-5 h-5 text-primary/60" />
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
