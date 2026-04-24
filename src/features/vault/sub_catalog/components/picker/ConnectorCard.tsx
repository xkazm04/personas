import { Plug, Monitor, BadgeCheck } from 'lucide-react';
import { motion, type Variants } from 'framer-motion';
import { ThemedConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';
import type { ConnectorDefinition } from '@/lib/types/types';
import { getAuthMethods } from '@/lib/types/types';
import { getAuthBadgeClasses, getAuthIcon } from '@/features/vault/shared/utils/authMethodStyles';
import { getLicenseTier, LICENSE_TIER_META } from '@/lib/credentials/connectorLicensing';
import { isDesktopBridge } from '@/lib/utils/platform/connectors';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { LICENSE_ICON } from './connectorCardConstants';
import type { RecipeIndicator } from './useRecipeIndicators';

interface ConnectorCardProps {
  connector: ConnectorDefinition;
  isOwned: boolean;
  recipeIndicator?: RecipeIndicator;
  onPickType: (connector: ConnectorDefinition) => void;
}

const cardVariants: Variants = {
  rest: {
    scale: 1,
    transition: { staggerChildren: 0.04, staggerDirection: -1 },
  },
  hover: {
    scale: 1.02,
    transition: { staggerChildren: 0.04, delayChildren: 0.02 },
  },
};

const cardVariantsReduced: Variants = { rest: {}, hover: {} };

const badgeSubtle: Variants = {
  rest: { opacity: 0.2 },
  hover: { opacity: 1 },
};

const badgeStrong: Variants = {
  rest: { opacity: 0.6 },
  hover: { opacity: 1 },
};

const labelVariants: Variants = {
  rest: { fontWeight: 500 },
  hover: { fontWeight: 600 },
};

export function ConnectorCard({ connector, isOwned, recipeIndicator, onPickType }: ConnectorCardProps) {
  const authMethods = getAuthMethods(connector);
  const tier = getLicenseTier(connector.name, connector.metadata as Record<string, unknown> | null);
  const tierMeta = LICENSE_TIER_META[tier];
  const TierIcon = LICENSE_ICON[tier];
  const { shouldAnimate } = useMotion();

  const ringClass = isOwned
    ? 'ring-1 ring-inset ring-emerald-500/40'
    : 'ring-1 ring-inset ring-primary/40';

  const bgClass = isOwned
    ? 'bg-emerald-500/8 hover:bg-emerald-500/15'
    : 'bg-secondary/25 hover:bg-secondary/50';

  return (
    <motion.button
      onClick={() => onPickType(connector)}
      data-testid={`catalog-connector-${connector.name}`}
      initial="rest"
      animate="rest"
      whileHover="hover"
      whileFocus="hover"
      variants={shouldAnimate ? cardVariants : cardVariantsReduced}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className={`group relative flex flex-col items-center gap-2 p-3 rounded-modal text-center min-h-[9rem] justify-between transition-[background-color,box-shadow] duration-200 hover:shadow-elevation-2 ${ringClass} ${bgClass}`}
    >
      {/* License tier badge (top-right) — first in stagger order */}
      <motion.span
        variants={badgeSubtle}
        className={`absolute top-1.5 right-1.5 inline-flex items-center justify-center w-6 h-6 rounded-card border ${tierMeta.bgClass} ${tierMeta.borderClass}`}
        title={`${tierMeta.label} license`}
      >
        <TierIcon className={`w-3 h-3 ${tierMeta.textClass}`} />
      </motion.span>

      {/* Auth method icons (top-left) */}
      <motion.div
        variants={badgeSubtle}
        className="absolute top-1.5 left-1.5 flex flex-col gap-1 z-10"
      >
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
      </motion.div>

      {/* Desktop bridge badge (bottom-left) */}
      {isDesktopBridge(connector) && (
        <motion.span
          variants={badgeStrong}
          className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-input border text-[10px] font-medium bg-orange-500/10 border-orange-500/20 text-orange-400"
        >
          <Monitor className="w-2.5 h-2.5" />
          Local
        </motion.span>
      )}

      {/* Recipe reuse indicator (bottom-right) */}
      {recipeIndicator && (
        <motion.span
          variants={badgeStrong}
          className="absolute bottom-1.5 right-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-input border text-[10px] font-medium bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
          title={`Verified setup — used ${recipeIndicator.usageCount} ${recipeIndicator.usageCount === 1 ? 'time' : 'times'}`}
        >
          <BadgeCheck className="w-2.5 h-2.5" />
          {recipeIndicator.usageCount > 0 ? recipeIndicator.usageCount : 'Cached'}
        </motion.span>
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
      <motion.span
        variants={labelVariants}
        className="typo-heading text-foreground/90 w-full leading-tight line-clamp-2 min-h-[2rem] flex items-center justify-center px-1"
      >
        {connector.label}
      </motion.span>
    </motion.button>
  );
}
