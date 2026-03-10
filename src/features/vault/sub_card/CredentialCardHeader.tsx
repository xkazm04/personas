import { Trash2, Key, Plug } from 'lucide-react';
import { ThemedConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import { formatTimestamp } from '@/lib/utils/formatters';
import type { RotationStatus } from '@/api/vault/rotation';
import type { HealthResult } from '@/features/vault/hooks/health/useCredentialHealth';
import { CompositeHealthDot } from './badges/CompositeHealthDot';
import { BadgeRow } from './CredentialCardBadges';

export interface CredentialCardHeaderProps {
  credential: CredentialMetadata;
  connector: ConnectorDefinition | undefined;
  effectiveHealthcheckResult: HealthResult | null;
  rotationStatus: RotationStatus | null;
  rotationCountdown: string | null;
  onSelect: () => void;
  onDelete: (id: string) => void;
}

export function CredentialCardHeader({
  credential,
  connector,
  effectiveHealthcheckResult,
  rotationStatus,
  rotationCountdown,
  onSelect,
  onDelete,
}: CredentialCardHeaderProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      className="w-full px-3 py-2.5 cursor-pointer hover:bg-secondary/50 transition-colors text-left focus-visible:ring-2 focus-visible:ring-violet-500/40 focus-visible:ring-inset focus-visible:outline-none rounded-xl"
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 border"
            style={{
              backgroundColor: connector ? `${connector.color}15` : undefined,
              borderColor: connector ? `${connector.color}30` : undefined,
            }}
          >
            {connector?.icon_url ? (
              <ThemedConnectorIcon url={connector.icon_url} label={connector.label} color={connector.color} size="w-4 h-4" />
            ) : connector ? (
              <Plug className="w-4 h-4" style={{ color: connector.color }} />
            ) : (
              <Key className="w-4 h-4 text-emerald-400/80" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <h4 className="font-medium text-foreground text-sm truncate max-w-[140px] sm:max-w-[180px]">
                {credential.name}
              </h4>
              <CompositeHealthDot
                healthResult={effectiveHealthcheckResult}
                rotationStatus={rotationStatus}
              />
              <BadgeRow
                credential={credential}
                connector={connector}
                rotationStatus={rotationStatus}
                rotationCountdown={rotationCountdown}
              />
            </div>

            <div className="mt-1 text-sm text-muted-foreground/90">
              Last used {formatTimestamp(credential.last_used_at, 'Never')}
              {credential.healthcheck_last_tested_at && (
                <>
                  {' · Last tested '}
                  {formatTimestamp(credential.healthcheck_last_tested_at, 'Never')}
                  {effectiveHealthcheckResult?.isStale && (
                    <span className="text-muted-foreground/50 italic" title="Result from a previous session — re-test for a fresh check"> (cached)</span>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(credential.id);
            }}
            className="p-1.5 hover:bg-red-500/10 rounded-lg transition-colors"
            title="Delete credential"
          >
            <Trash2 className="w-4 h-4 text-red-400/70" />
          </button>
        </div>
      </div>
    </div>
  );
}
