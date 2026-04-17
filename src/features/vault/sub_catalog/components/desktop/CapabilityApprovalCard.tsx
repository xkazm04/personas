import { Shield } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import {
  CAPABILITY_INFO,
  type DiscoveredApp,
  type DesktopConnectorManifest,
} from '@/api/system/desktop';
import { useTranslation } from '@/i18n/useTranslation';

interface CapabilityApprovalCardProps {
  manifest: DesktopConnectorManifest;
  app: DiscoveredApp;
  onApprove: () => void;
  onCancel: () => void;
  approving: boolean;
}

export function CapabilityApprovalCard({ manifest, app, onApprove, onCancel, approving }: CapabilityApprovalCardProps) {
  const { t } = useTranslation();
  return (
    <div
      className="animate-fade-slide-in overflow-hidden"
    >
      <div className="p-4 rounded-modal border border-orange-500/20 bg-gradient-to-b from-orange-500/5 to-transparent space-y-3">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-orange-400" />
          <h4 className="typo-heading font-semibold text-foreground">
            Permission Required
          </h4>
        </div>

        <p className="typo-caption text-foreground">
          <strong>{app.label}</strong> requests the following capabilities.
          Review and approve to enable this connector.
        </p>

        <div className="space-y-1.5">
          {manifest.capabilities.map((cap) => {
            const info = CAPABILITY_INFO[cap];
            return (
              <div
                key={cap}
                className="flex items-center gap-3 p-2 rounded-card bg-secondary/20"
              >
                <div
                  className={`w-2 h-2 rounded-full ${
                    info.risk === 'high'
                      ? 'bg-rose-400'
                      : info.risk === 'medium'
                        ? 'bg-amber-400'
                        : 'bg-emerald-400'
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <p className="typo-caption font-medium text-foreground">{info.label}</p>
                  <p className="typo-caption text-foreground">{info.description}</p>
                </div>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                    info.risk === 'high'
                      ? 'bg-rose-500/10 text-rose-400'
                      : info.risk === 'medium'
                        ? 'bg-amber-500/10 text-amber-400'
                        : 'bg-emerald-500/10 text-emerald-400'
                  }`}
                >
                  {info.risk}
                </span>
              </div>
            );
          })}
        </div>

        {manifest.allowed_binaries.length > 0 && (
          <div className="typo-caption text-foreground">
            <span className="font-medium">{t.vault.desktop_discovery.allowed_binaries}</span>
            {manifest.allowed_binaries.join(', ')}
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={onCancel}
            className="flex-1 px-3 py-1.5 typo-caption font-medium text-foreground bg-secondary/30 rounded-card hover:bg-secondary/50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onApprove}
            disabled={approving}
            className="flex-1 px-3 py-1.5 typo-caption font-medium text-white bg-orange-500 rounded-card hover:bg-orange-600 transition-colors disabled:opacity-50"
          >
            {approving ? (
              <LoadingSpinner size="sm" className="mx-auto" />
            ) : (
              'Approve & Connect'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
