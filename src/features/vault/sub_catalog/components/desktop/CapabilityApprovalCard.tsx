import { Shield } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import {
  CAPABILITY_INFO,
  type DiscoveredApp,
  type DesktopConnectorManifest,
} from '@/api/system/desktop';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import Button from '@/features/shared/components/buttons/Button';

interface CapabilityApprovalCardProps {
  manifest: DesktopConnectorManifest;
  app: DiscoveredApp;
  onApprove: () => void;
  onCancel: () => void;
  approving: boolean;
}

export function CapabilityApprovalCard({ manifest, app, onApprove, onCancel, approving }: CapabilityApprovalCardProps) {
  const { t } = useTranslation();
  const dd = t.vault.desktop_discovery;
  const caps = dd.capabilities;
  return (
    <div
      className="animate-fade-slide-in overflow-hidden"
    >
      <div className="p-4 rounded-modal border border-status-warning/20 space-y-3 bg-surface-1">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-status-warning" />
          <h4 className="typo-heading text-foreground">
            {dd.permission_required}
          </h4>
        </div>

        <p className="typo-caption text-foreground">
          <strong>{app.label}</strong> {t.vault.desktop_discovery.approve_description}
        </p>

        <div className="space-y-1.5">
          {manifest.capabilities.map((cap) => {
            const info = CAPABILITY_INFO[cap];
            return (
              <div
                key={cap}
                className="flex items-center gap-3 p-2 rounded-card bg-surface-1"
              >
                <div
                  className={`w-2 h-2 rounded-full ${
                    info.risk === 'high'
                      ? 'bg-status-error'
                      : info.risk === 'medium'
                        ? 'bg-status-warning'
                        : 'bg-status-success'
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <p className="typo-caption text-foreground">{caps[info.labelKey]}</p>
                  <p className="typo-caption text-foreground">{caps[info.descriptionKey]}</p>
                </div>
                <span
                  className={`typo-label px-1.5 py-0.5 rounded-interactive ${
                    info.risk === 'high'
                      ? 'bg-status-error/10 text-status-error'
                      : info.risk === 'medium'
                        ? 'bg-status-warning/10 text-status-warning'
                        : 'bg-status-success/10 text-status-success'
                  }`}
                >
                  {tokenLabel(t, 'capability_risk', info.risk)}
                </span>
              </div>
            );
          })}
        </div>

        {manifest.allowed_binaries.length > 0 && (
          <div className="typo-caption text-foreground">
            <span className="font-medium">{dd.allowed_binaries}</span>
            {manifest.allowed_binaries.join(', ')}
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button
            type="button"
            onClick={onCancel}
            variant="ghost"
            size="sm"
            className="flex-1"
          >
            {t.common.cancel}
          </Button>
          <Button
            type="button"
            onClick={onApprove}
            disabled={approving}
            variant="accent"
            tone="warning"
            size="sm"
            className="flex-1"
          >
            {approving ? (
              <LoadingSpinner size="sm" className="mx-auto" />
            ) : (
              dd.approve_connect
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
