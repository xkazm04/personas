import {
  Monitor,
  Check,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { DiscoveredApp } from '@/api/system/desktop';

const APP_ICONS: Record<string, string> = {
  desktop_vscode: 'VS Code',
  desktop_docker: 'Docker',
  desktop_terminal: 'Terminal',
  desktop_obsidian: 'Obsidian',
  desktop_browser: 'Browser',
};

function riskBadge(hasHighRisk: boolean) {
  if (hasHighRisk) {
    return (
      <span className="flex items-center gap-1 text-[11px] text-amber-400/80" title="This app can run commands on your system — review before allowing">
        <AlertTriangle className="w-3 h-3" />
        Review recommended
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-[11px] text-emerald-400/80" title="Read-only access, safe to allow">
      <ShieldCheck className="w-3 h-3" />
      Safe to allow
    </span>
  );
}

const HIGH_RISK_APPS = new Set(['desktop_docker', 'desktop_terminal']);

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
  if (isScanning) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <LoadingSpinner size="xl" className="text-violet-400" />
        <span className="typo-body text-muted-foreground/80">Scanning your desktop...</span>
      </div>
    );
  }

  const installed = apps.filter((a) => a.installed);

  if (installed.length === 0) {
    return (
      <div className="text-center py-16">
        <Monitor className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
        <p className="typo-body text-muted-foreground/70">No supported desktop apps detected.</p>
        <p className="typo-body text-muted-foreground/50 mt-1">
          You can connect desktop apps later from the Connections section.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="typo-heading-lg text-foreground/90 mb-1">
          Your desktop environment
        </h3>
        <p className="typo-body text-muted-foreground/70">
          We found these apps on your machine. Allow access so your agents can interact with them directly.
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
              className={`flex items-center gap-3 rounded-xl border p-3.5 transition-all ${
                isApproved
                  ? 'bg-emerald-500/5 border-emerald-500/20'
                  : 'bg-secondary/30 border-primary/10'
              }`}
            >
              <div className="w-9 h-9 rounded-lg bg-secondary/50 border border-primary/10 flex items-center justify-center flex-shrink-0">
                <Monitor className="w-4.5 h-4.5 text-foreground/60" />
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
                    <span className="text-[11px] text-muted-foreground/50">v{app.version}</span>
                  )}
                  {riskBadge(hasHighRisk)}
                </div>
              </div>

              <button
                onClick={() => onApprove(app.connector_name)}
                disabled={isApproved || isApproving}
                className={`flex items-center gap-1.5 px-3 py-1.5 typo-heading rounded-lg transition-colors flex-shrink-0 ${
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
                    Approved
                  </>
                ) : isApproving ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  'Approve'
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
