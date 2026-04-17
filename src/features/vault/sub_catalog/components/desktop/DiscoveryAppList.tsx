import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { DiscoveredApp, DesktopConnectorManifest } from '@/api/system/desktop';
import { DesktopAppCard } from './DesktopAppCard';
import { CapabilityApprovalCard } from './CapabilityApprovalCard';

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
  return (
    <div
      key="apps"
      className="animate-fade-slide-in space-y-3"
    >
      {scanning ? (
        <div className="flex items-center justify-center py-8 text-foreground">
          <LoadingSpinner className="mr-2" />
          Scanning for desktop apps...
        </div>
      ) : (
        <>
          {installedApps.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-medium text-foreground uppercase tracking-wide">
                Detected on your system
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
              <h4 className="text-xs font-medium text-foreground uppercase tracking-wide">
                Not detected
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
            <div className="text-center py-8 text-foreground text-sm">
              No desktop apps detected. Try refreshing.
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
