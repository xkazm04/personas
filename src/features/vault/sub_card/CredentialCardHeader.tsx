import { Trash2, Key, Plug } from 'lucide-react';
import { ThemedConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';
import { Button } from '@/features/shared/components/buttons';
import { useTier } from '@/hooks/utility/interaction/useTier';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';

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
  const { isStarter: isSimple } = useTier();

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
              {!isSimple && (
              <BadgeRow
                credential={credential}
                connector={connector}
                rotationStatus={rotationStatus}
                rotationCountdown={rotationCountdown}
              />
              )}
            </div>

          </div>
        </div>

        {!isSimple && (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            icon={<Trash2 className="w-4 h-4 text-red-400/70" />}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(credential.id);
            }}
            className="hover:bg-red-500/10"
            title="Delete credential"
          />
        </div>
        )}
      </div>
    </div>
  );
}
