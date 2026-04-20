import {
  Monitor,
  Check,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { DiscoveredApp } from '@/api/system/desktop';
import { useTranslation } from '@/i18n/useTranslation';

const APP_ICONS: Record<string, string> = {
  desktop_docker: 'Docker',
  desktop_obsidian: 'Obsidian',
  desktop_browser: 'Browser',
};

function riskBadge(hasHighRisk: boolean, labels: { review: string; reviewTooltip: string; safe: string; safeTooltip: string }) {
  if (hasHighRisk) {
    return (
      <span className="flex items-center gap-1 text-[11px] text-amber-400/80" title={labels.reviewTooltip}>
        <AlertTriangle className="w-3 h-3" />
        {labels.review}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-[11px] text-emerald-400/80" title={labels.safeTooltip}>
      <ShieldCheck className="w-3 h-3" />
      {labels.safe}
    </span>
  );
}

const HIGH_RISK_APPS = new Set(['desktop_docker']);

export function DesktopDiscoveryStep({
  apps,
  isScanning,
  approvedApps,
  approvingApp,
  onApprove,
}: {
  apps: DiscoveredApp[];
  isScanning: boolean;
  approvedApps: Set<string>;
  approvingApp: string | null;
  onApprove: (connectorName: string) => void;
}) {
  const { t } = useTranslation();

  const riskLabels = {
    review: t.onboarding.risk_review,
    reviewTooltip: t.onboarding.risk_review_tooltip,
    safe: t.onboarding.risk_safe,
    safeTooltip: t.onboarding.risk_safe_tooltip,
  };

  if (isScanning) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <LoadingSpinner size="xl" className="text-violet-400" />
        <span className="typo-body text-foreground">{t.onboarding.scanning_desktop}</span>
      </div>
    );
  }

  const installed = apps.filter((a) => a.installed);

  if (installed.length === 0) {
    return (
      <div className="text-center py-16">
        <Monitor className="w-10 h-10 mx-auto text-foreground mb-3" />
        <p className="typo-body text-foreground">{t.onboarding.desktop_empty}</p>
        <p className="typo-body text-foreground mt-1">
          {t.onboarding.desktop_empty_hint}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="typo-heading-lg text-foreground/90 mb-1">
          {t.onboarding.desktop_title}
        </h3>
        <p className="typo-body text-foreground">
          {t.onboarding.desktop_description}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-2.5">
        {installed.map((app) => {
          const isApproved = approvedApps.has(app.connector_name);
          const isApproving = approvingApp === app.connector_name;
          const hasHighRisk = HIGH_RISK_APPS.has(app.connector_name);

          return (
            <div
              key={app.connector_name}
              className={`flex items-center gap-3 rounded-modal border p-3.5 transition-all ${
                isApproved
                  ? 'bg-emerald-500/5 border-emerald-500/20'
                  : 'bg-secondary/30 border-primary/10'
              }`}
            >
              <div className="w-9 h-9 rounded-card bg-secondary/50 border border-primary/10 flex items-center justify-center flex-shrink-0">
                <Monitor className="w-4.5 h-4.5 text-foreground" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="typo-heading text-foreground/90">
                    {app.label || APP_ICONS[app.connector_name] || app.connector_name}
                  </span>
                  {app.running && (
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" title="Running" />
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  {app.version && (
                    <span className="text-[11px] text-foreground">v{app.version}</span>
                  )}
                  {riskBadge(hasHighRisk, riskLabels)}
                </div>
              </div>

              <button
                onClick={() => onApprove(app.connector_name)}
                disabled={isApproved || isApproving}
                className={`flex items-center gap-1.5 px-3 py-1.5 typo-heading rounded-card transition-colors flex-shrink-0 ${
                  isApproved
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 cursor-default'
                    : isApproving
                      ? 'bg-violet-500/10 text-violet-300 border border-violet-500/20 cursor-wait'
                      : 'bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25'
                }`}
              >
                {isApproved ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    {t.onboarding.approved}
                  </>
                ) : isApproving ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  t.onboarding.approve
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
