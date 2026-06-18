import { Key, LayoutTemplate, Sparkles, Plug, ArrowRight, Globe } from 'lucide-react';
import { motion, type Variants } from 'framer-motion';
import { EmptyIllustration } from '@/features/shared/components/display/EmptyIllustration';
import { ThemedConnectorIcon } from '@/lib/connectors/connectorMeta';
import type { ConnectorDefinition } from '@/lib/types/types';
import { IS_MOBILE } from '@/lib/utils/platform/platform';
import { useMotion, useMotionVariants } from '@/hooks/utility/interaction/useMotion';
import { QUICK_START_SERVICES } from './credentialListTypes';
import { useTranslation } from '@/i18n/useTranslation';

// Choreographed reveal: parent cascades each block (and the two pathway cards)
// in sequence. `useMotionVariants` strips the y/stagger under reduced motion.
const STAGGER: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};

const ITEM: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.25, ease: [0.22, 1, 0.36, 1] } },
};

// Card-level transitions exclude `transform` (Framer owns it via the variant /
// whileHover y) so the entrance/lift never fights a CSS transition.
const CARD_TRANSITION = 'transition-[background-color,border-color,box-shadow,color] duration-snap';

interface EmptyStateViewProps {
  connectorDefinitions: ConnectorDefinition[];
  onQuickStart?: (connector: ConnectorDefinition) => void;
  onGoToCatalog?: () => void;
  onGoToAddNew?: () => void;
  onWorkspaceConnect?: () => void;
}

export function EmptyStateView({ connectorDefinitions, onQuickStart, onGoToCatalog, onGoToAddNew, onWorkspaceConnect }: EmptyStateViewProps) {
  const { t } = useTranslation();
  const { shouldAnimate } = useMotion();
  const container = useMotionVariants(STAGGER);
  const item = useMotionVariants(ITEM);
  const lift = shouldAnimate ? { y: -2, transition: { duration: 0.15, ease: 'easeOut' as const } } : undefined;
  const quickConnectors = QUICK_START_SERVICES
    .map((name) => connectorDefinitions.find((c) => c.name.toLowerCase().includes(name)))
    .filter((c): c is ConnectorDefinition => c != null);

  return (
    <motion.div
      className="space-y-4"
      variants={container}
      initial="hidden"
      animate="show"
    >
      {/* Heading */}
      <motion.div variants={item} className="pt-6 pb-2">
        <EmptyIllustration
          icon={Key}
          heading={t.vault.empty_state.heading}
          description={t.vault.empty_state.description}
        />
      </motion.div>

      {/* Two pathway cards — nested stagger so each card reveals in turn */}
      <motion.div
        variants={container}
        className="grid gap-3"
        style={{ gridTemplateColumns: IS_MOBILE ? '1fr' : 'repeat(auto-fill, minmax(300px, 1fr))' }}
      >
        {/* Catalog path — the recommended default */}
        <motion.button
          variants={item}
          whileHover={lift}
          onClick={() => onGoToCatalog?.()}
          className={`group text-left p-4 rounded-modal border border-primary/15 ring-1 ring-primary/30 bg-secondary/25 hover:bg-secondary/50 hover:border-primary/25 hover:shadow-elevation-2 ${CARD_TRANSITION}`}
        >
          <div className="w-9 h-9 rounded-card bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-3">
            <LayoutTemplate className="w-4.5 h-4.5 text-emerald-400" />
          </div>
          <span className="block typo-code font-mono uppercase tracking-wider text-primary/70 mb-1">
            {t.vault.empty_state.recommended}
          </span>
          <p className="typo-body font-medium text-foreground mb-1">{t.vault.empty_state.catalog_heading}</p>
          <p className="typo-body text-foreground leading-relaxed">
            {t.vault.empty_state.catalog_description}
          </p>
          <div className="flex items-center gap-1.5 mt-3">
            {connectorDefinitions.slice(0, 4).map((c) => (
              <div
                key={c.id}
                className="w-5 h-5 rounded border flex items-center justify-center"
                style={{
                  backgroundColor: `${c.color}12`,
                  borderColor: `${c.color}25`,
                }}
                title={c.label}
              >
                {c.icon_url ? (
                  <ThemedConnectorIcon url={c.icon_url} label={c.label} color={c.color} size="w-3 h-3" />
                ) : (
                  <Plug className="w-2.5 h-2.5" style={{ color: c.color }} />
                )}
              </div>
            ))}
            {connectorDefinitions.length > 4 && (
              <span className="typo-body text-foreground ml-0.5">+{connectorDefinitions.length - 4}</span>
            )}
          </div>
        </motion.button>

        {/* AI design path */}
        <motion.button
          variants={item}
          whileHover={lift}
          data-testid="create-credential-btn"
          onClick={() => onGoToAddNew?.()}
          className={`group text-left p-4 rounded-modal border border-primary/15 bg-secondary/25 hover:bg-secondary/50 hover:border-primary/25 hover:shadow-elevation-2 ${CARD_TRANSITION}`}
        >
          <div className="w-9 h-9 rounded-card bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mb-3">
            <Sparkles className="w-4.5 h-4.5 text-violet-400" />
          </div>
          <p className="typo-body font-medium text-foreground mb-1">{t.vault.empty_state.ai_heading}</p>
          <p className="typo-body text-foreground leading-relaxed">
            {t.vault.empty_state.ai_description}
          </p>
          <span className="inline-flex items-center gap-1 mt-3 typo-body text-violet-400/60 group-hover:text-violet-400/80 transition-colors">
            {t.vault.empty_state.works_with_any} <ArrowRight className="w-3 h-3" />
          </span>
        </motion.button>
      </motion.div>

      {/* Workspace Connect */}
      {onWorkspaceConnect && (
        <motion.button
          variants={item}
          whileHover={lift}
          onClick={onWorkspaceConnect}
          className={`w-full text-left p-4 rounded-modal bg-gradient-to-r from-blue-500/5 to-emerald-500/5 border border-blue-500/15 hover:from-blue-500/10 hover:to-emerald-500/10 hover:border-blue-500/25 hover:shadow-elevation-2 ${CARD_TRANSITION}`}
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-card bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
              <Globe className="w-4.5 h-4.5 text-blue-400" />
            </div>
            <div>
              <p className="typo-body font-medium text-foreground">{t.vault.workspace_connect}</p>
              <p className="typo-body text-foreground">
                {t.vault.type_picker.workspace_connect_hint}
              </p>
            </div>
          </div>
        </motion.button>
      )}

      {/* Quick-start row */}
      {quickConnectors.length > 0 && onQuickStart && (
        <motion.div variants={item} className="space-y-2">
          <p className="typo-code font-mono uppercase tracking-wider text-foreground text-center">{t.vault.quick_start}</p>
          <div className="flex items-center justify-center gap-2 flex-wrap">
            {quickConnectors.map((connector) => (
              <button
                key={connector.id}
                onClick={() => onQuickStart(connector)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-modal border border-primary/10 bg-secondary/20 hover:bg-secondary/50 hover:border-primary/20 transition-all typo-body"
              >
                <div
                  className="w-4.5 h-4.5 rounded flex items-center justify-center"
                  style={{ backgroundColor: `${connector.color}15` }}
                >
                  {connector.icon_url ? (
                    <ThemedConnectorIcon url={connector.icon_url} label={connector.label} color={connector.color} size="w-3 h-3" />
                  ) : (
                    <Plug className="w-2.5 h-2.5" style={{ color: connector.color }} />
                  )}
                </div>
                <span className="text-foreground">{connector.label}</span>
              </button>
            ))}
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
