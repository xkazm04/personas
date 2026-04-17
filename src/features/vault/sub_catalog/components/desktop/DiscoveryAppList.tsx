import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { DiscoveredApp, DesktopConnectorManifest } from '@/api/system/desktop';
import { DesktopAppCard } from './DesktopAppCard';
import { CapabilityApprovalCard } from './CapabilityApprovalCard';
import { useTranslation } from '@/i18n/useTranslation';

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
      {scanning ? (
        <div className="flex items-center justify-center py-8 text-foreground">
          <LoadingSpinner className="mr-2" />
          {dd.scanning}
        </div>
      ) : (
        <>
          {installedApps.length > 0 && (
            <div className="space-y-2">
              <h4 className="typo-label font-medium text-foreground uppercase tracking-wide">
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
              <h4 className="typo-label font-medium text-foreground uppercase tracking-wide">
                {dd.not_detected}
              </h4>
              {notInstalledApps.map((app) => (
                <DesktopAppCard
                  key={app.connector_name}
                  app={app}
                  selected={false}
                  onSelect={() => {}}
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
