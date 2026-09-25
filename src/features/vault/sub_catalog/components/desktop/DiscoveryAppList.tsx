import type { DiscoveredApp, DesktopConnectorManifest } from '@/api/system/desktop';
import { DesktopAppCard } from './DesktopAppCard';
import { CapabilityApprovalCard } from './CapabilityApprovalCard';
import { useTranslation } from '@/i18n/useTranslation';

const GHOST_WIDTHS = ['w-36', 'w-28', 'w-44', 'w-32'];

function DiscoveryCardGhost({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-hidden="true" className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="w-full p-3 rounded-modal border border-primary/10 bg-secondary/20 animate-fade-in"
          style={{ animationDelay: `${120 + i * 35}ms` }}
        >
          <div className="flex items-center gap-3">
            <span className="w-8 h-8 rounded-card bg-primary/[0.06] shrink-0" />
            <span className={`h-3.5 rounded bg-primary/[0.06] ${GHOST_WIDTHS[i % GHOST_WIDTHS.length]}`} />
          </div>
        </div>
      ))}
    </div>
  );
}

interface DiscoveryAppListProps {
  installedApps: DiscoveredApp[];
  notInstalledApps: DiscoveredApp[];
  allApps: DiscoveredApp[];
  scanning: boolean;
  selectedApp: string | null;
  manifest: DesktopConnectorManifest | null;
  approving: boolean;
  onSelectApp: (connectorName: string) => void;
  onApprove: () => void;
  onCancelApproval: () => void;
}

export function DiscoveryAppList({
  installedApps,
  notInstalledApps,
  allApps,
  scanning,
  selectedApp,
  manifest,
  approving,
  onSelectApp,
  onApprove,
  onCancelApproval,
}: DiscoveryAppListProps) {
  const { t } = useTranslation();
  const dd = t.vault.desktop_discovery;
  return (
    <div
      key="apps"
      className="animate-fade-slide-in space-y-3"
    >
      {scanning && allApps.length === 0 ? (
        <div className="space-y-2">
          <h4 className="typo-label text-foreground">
            {dd.detected_on_system}
          </h4>
          <DiscoveryCardGhost />
        </div>
      ) : (
        <>
          {installedApps.length > 0 && (
            <div className="space-y-2">
              <h4 className="typo-label text-foreground">
                {dd.detected_on_system}
              </h4>
              {installedApps.map((app) => (
                <DesktopAppCard
                  key={app.connector_name}
                  app={app}
                  selected={selectedApp === app.connector_name}
                  onSelect={() => onSelectApp(app.connector_name)}
                />
              ))}
            </div>
          )}

          {notInstalledApps.length > 0 && (
            <div className="space-y-2">
              <h4 className="typo-label text-foreground">
                {dd.not_detected}
              </h4>
              {notInstalledApps.map((app) => (
                <DesktopAppCard
                  key={app.connector_name}
                  app={app}
                  selected={false}
                  disabled
                />
              ))}
            </div>
          )}

          {allApps.length === 0 && !scanning && (
            <div className="text-center py-8 text-foreground typo-body">
              {dd.no_apps}
            </div>
          )}
        </>
      )}

      {selectedApp && manifest && (
        <CapabilityApprovalCard
          manifest={manifest}
          app={allApps.find((a) => a.connector_name === selectedApp)!}
          onApprove={onApprove}
          onCancel={onCancelApproval}
          approving={approving}
        />
      )}
    </div>
  );
}
