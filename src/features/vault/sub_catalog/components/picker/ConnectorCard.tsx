import { Plug, Monitor, BadgeCheck } from 'lucide-react';
import { ThemedConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';
import type { ConnectorDefinition } from '@/lib/types/types';
import { getAuthMethods } from '@/lib/types/types';
import { getAuthBadgeClasses, getAuthIcon } from '@/features/vault/shared/utils/authMethodStyles';
import { getLicenseTier, LICENSE_TIER_META } from '@/lib/credentials/connectorLicensing';
import { isDesktopBridge } from '@/lib/utils/platform/connectors';
import { LICENSE_ICON } from './connectorCardConstants';
import type { RecipeIndicator } from './useRecipeIndicators';

interface ConnectorCardProps {
  connector: ConnectorDefinition;
  isOwned: boolean;
  recipeIndicator?: RecipeIndicator;
  onPickType: (connector: ConnectorDefinition) => void;
}

export function ConnectorCard({ connector, isOwned, recipeIndicator, onPickType }: ConnectorCardProps) {
  const authMethods = getAuthMethods(connector);
  const tier = getLicenseTier(connector.name, connector.metadata as Record<string, unknown> | null);
  const tierMeta = LICENSE_TIER_META[tier];
  const TierIcon = LICENSE_ICON[tier];

  return (
    <button
      onClick={() => onPickType(connector)}
      data-testid={`catalog-connector-${connector.name}`}
      className={`group relative flex flex-col items-center gap-2 p-3 rounded-modal border text-center transition-all transition-transform hover:scale-[1.02] min-h-[9rem] justify-between ${
        isOwned
          ? 'bg-emerald-500/8 border-emerald-500/20 hover:bg-emerald-500/15'
          : 'bg-secondary/25 border-primary/15 hover:bg-secondary/50 hover:border-primary/25'
      }`}
    >
      {/* Auth method icons */}
      <div className="absolute top-1.5 left-1.5 flex flex-col gap-1 z-10 opacity-20 group-hover:opacity-100 transition-opacity duration-200">
        {authMethods.map((m) => {
          const Icon = getAuthIcon(m);
          return (
            <span
              key={m.id}
              title={m.label}
              className={`inline-flex items-center justify-center w-7 h-7 rounded-card backdrop-blur-sm border ${getAuthBadgeClasses(m)}`}
            >
              <Icon className="w-3.5 h-3.5" />
            </span>
          );
        })}
      </div>

      {/* License tier badge */}
      <span
        className={`absolute top-1.5 right-1.5 inline-flex items-center justify-center w-6 h-6 rounded-card border opacity-20 group-hover:opacity-100 transition-opacity duration-200 ${tierMeta.bgClass} ${tierMeta.borderClass}`}
        title={`${tierMeta.label} license`}
      >
        <TierIcon className={`w-3 h-3 ${tierMeta.textClass}`} />
      </span>

      {/* Desktop bridge badge */}
      {isDesktopBridge(connector) && (
        <span
          className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-input border text-[10px] font-medium bg-orange-500/10 border-orange-500/20 text-orange-400 opacity-60 group-hover:opacity-100 transition-opacity duration-200"
        >
          <Monitor className="w-2.5 h-2.5" />
          Local
        </span>
      )}

      {/* Recipe reuse indicator */}
      {recipeIndicator && (
        <span
          className="absolute bottom-1.5 right-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-input border text-[10px] font-medium bg-emerald-500/10 border-emerald-500/20 text-emerald-400 opacity-60 group-hover:opacity-100 transition-opacity duration-200"
          title={`Verified setup \u2014 used ${recipeIndicator.usageCount} ${recipeIndicator.usageCount === 1 ? 'time' : 'times'}`}
        >
          <BadgeCheck className="w-2.5 h-2.5" />
          {recipeIndicator.usageCount > 0 ? recipeIndicator.usageCount : 'Cached'}
        </span>
      )}

      {/* Large icon */}
      <div
        className="w-14 h-14 min-w-14 min-h-14 rounded-modal flex items-center justify-center border"
        style={{
          backgroundColor: `${connector.color}12`,
          borderColor: `${connector.color}25`,
        }}
      >
        {connector.icon_url ? (
          <ThemedConnectorIcon url={connector.icon_url} label={connector.label} color={connector.color} size="w-10 h-10" />
        ) : (
          <Plug className="w-8 h-8" style={{ color: connector.color }} />
        )}
      </div>

      {/* Label — 2-line clamp keeps card height stable whether label is 1 or 2 lines */}
      <span className="text-sm font-semibold text-foreground/90 w-full leading-tight line-clamp-2 min-h-[2rem] flex items-center justify-center px-1">
        {connector.label}
      </span>
    </button>
  );
}
