import {
  Monitor,
  Check,
  ShieldCheck,
  AlertTriangle,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { DiscoveredApp } from '@/api/system/desktop';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import { extractMessage } from '@/lib/silentCatch';
import type { DiscoveryScanState } from './useOnboardingState';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

const APP_ICONS: Record<string, string> = {
  desktop_docker: 'Docker',
  desktop_obsidian: 'Obsidian',
  desktop_browser: 'Browser',
};

function riskBadge(hasHighRisk: boolean, labels: { review: string; reviewTooltip: string; safe: string; safeTooltip: string }) {
  if (hasHighRisk) {
    return (
      <Tooltip content={labels.reviewTooltip}><span className="flex items-center gap-1 typo-caption text-status-warning">
        <AlertTriangle className="w-3 h-3" />
        {labels.review}
      </span></Tooltip>
    );
  }
  return (
    <Tooltip content={labels.safeTooltip}><span className="flex items-center gap-1 typo-caption text-status-success">
      <ShieldCheck className="w-3 h-3" />
      {labels.safe}
    </span></Tooltip>
  );
}

// `desktop_terminal` added 2026-08-16. Its capability set is
// `ProcessSpawn + FileRead + FileWrite + EnvRead` over bash/sh/zsh/powershell/cmd
// — a strict superset of anything else on this screen — and it was rendering
// with the SAFE badge, because this set named exactly one app.
//
// A risk badge that enumerates the risky items, rather than deriving risk from
// the capabilities each app actually requests, is a list someone has to remember
// to update. It was not updated, and the item it missed is the one that can run
// arbitrary commands. Deriving the badge from the capability set is the real fix
// and is filed in informed-consent-gate.md §8; this closes the live gap now.
const HIGH_RISK_APPS = new Set(['desktop_docker', 'desktop_terminal']);

export function DesktopDiscoveryStep({
  apps,
  scanState,
  approvedApps,
  approvingApp,
  onApprove,
  onRetry,
}: {
  apps: DiscoveredApp[];
  scanState: DiscoveryScanState;
  approvedApps: Set<string>;
  approvingApp: string | null;
  onApprove: (connectorName: string) => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation();

  const riskLabels = {
    review: t.onboarding.risk_review,
    reviewTooltip: t.onboarding.risk_review_tooltip,
    safe: t.onboarding.risk_safe,
    safeTooltip: t.onboarding.risk_safe_tooltip,
  };

  if (scanState.phase === 'scanning') {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <LoadingSpinner size="xl" className="text-role-agent" />
        <span className="typo-body text-ink-1">{t.onboarding.scanning_desktop}</span>
      </div>
    );
  }

  if (scanState.phase === 'error') {
    return (
      <div className="text-center py-16">
        <AlertCircle className="w-10 h-10 mx-auto text-status-warning mb-3" />
        <p className="typo-body text-ink-1">{t.onboarding.desktop_scan_error}</p>
        <p className="typo-body text-ink-2 mt-1">
          {scanState.error
            ? resolveErrorTranslated(t, extractMessage(scanState.error.raw)).message
            : t.onboarding.desktop_scan_error_hint}
        </p>
        <Button
          type="button"
          onClick={onRetry}
          variant="accent"
          tone="agent"
          size="sm"
          className="mt-4"
          icon={<RefreshCw className="w-3.5 h-3.5" />}
        >{t.onboarding.desktop_scan_retry}</Button>
      </div>
    );
  }

  const installed = apps.filter((a) => a.installed);

  if (installed.length === 0) {
    return (
      <div className="text-center py-16">
        <Monitor className="w-10 h-10 mx-auto text-ink-1 mb-3" />
        <p className="typo-body text-ink-1">{t.onboarding.desktop_empty}</p>
        <p className="typo-body text-ink-2 mt-1">
          {t.onboarding.desktop_empty_hint}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="typo-heading-lg text-ink-1 mb-1">
          {t.onboarding.desktop_title}
        </h3>
        <p className="typo-body text-ink-1">
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
                  ? 'bg-status-success/5 border-status-success/20'
                  : 'bg-surface-1 border-hair'
              }`}
            >
              <div className="w-9 h-9 rounded-card bg-surface-2 border border-hair flex items-center justify-center flex-shrink-0">
                <Monitor className="w-[18px] h-[18px] text-ink-1" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="typo-heading text-ink-1">
                    {app.label || APP_ICONS[app.connector_name] || app.connector_name}
                  </span>
                  {app.running && (
                    <Tooltip content={t.onboarding.app_running_tooltip}><span className="w-1.5 h-1.5 rounded-full bg-status-success flex-shrink-0"/></Tooltip>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  {app.version && (
                    <span className="typo-caption text-ink-2">v{app.version}</span>
                  )}
                  {riskBadge(hasHighRisk, riskLabels)}
                </div>
              </div>

              <button
                type="button"
                onClick={() => onApprove(app.connector_name)}
                disabled={isApproved || isApproving}
                className={`flex items-center gap-1.5 px-3 py-1.5 typo-heading rounded-card transition-colors flex-shrink-0 ${
                  isApproved
                    ? 'bg-status-success/10 text-status-success border border-status-success/20 cursor-default'
                    : isApproving
                      ? 'bg-role-agent/10 text-role-agent border border-role-agent/20 cursor-wait'
                      : 'bg-role-agent/15 text-role-agent border border-role-agent/25 hover:bg-role-agent/25'
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
