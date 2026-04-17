import { AnimatePresence, motion } from 'framer-motion';
import { CircleDot, CheckCircle2, XCircle, FileText } from 'lucide-react';
import { getConnectorMeta, ConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';
import { TRANSITION_NORMAL } from '@/features/templates/animationPresets';
import { CARD_PADDING } from '@/lib/utils/designTokens';
import type { UseCaseFlow } from '@/lib/types/frontendTypes';
import type { ConnectorReadinessStatus } from '@/lib/types/designTypes';
import { SectionLabel } from '@/features/shared/components/display/SectionLabel';
import { useTranslation } from '@/i18n/useTranslation';

interface TemplateCardPreviewProps {
  reviewId: string;
  name: string;
  instruction: string;
  connectors: string[];
  displayFlows: UseCaseFlow[];
  readinessStatuses: ConnectorReadinessStatus[];
  systemPromptPreview: string | null;
  previewOpen: boolean;
  prefersReducedMotion: boolean;
}

export function TemplateCardPreview({
  reviewId,
  name,
  instruction,
  connectors,
  displayFlows,
  readinessStatuses,
  systemPromptPreview,
  previewOpen,
  prefersReducedMotion,
}: TemplateCardPreviewProps) {
  const { t } = useTranslation();
  return (
    <AnimatePresence>
      {previewOpen && (
        <motion.div
          layoutId={`template-preview-${reviewId}`}
          initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: 12, scale: 0.97 }}
          animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, x: 0, scale: 1 }}
          exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: 8, scale: 0.98 }}
          transition={TRANSITION_NORMAL}
          className="absolute top-0 left-full ml-2 z-40 w-[320px] max-h-[400px] overflow-y-auto rounded-modal border border-primary/15 bg-background/95 backdrop-blur-sm shadow-elevation-4 hidden md:block"
        >
          <div className={`${CARD_PADDING.standard} space-y-4`}>
            {/* Full Description */}
            <div>
              <h4 className="typo-heading font-semibold text-foreground/90 mb-1.5">
                {name}
              </h4>
              <p className="typo-body text-foreground leading-relaxed">
                {instruction}
              </p>
            </div>

            {/* Use Cases with Descriptions */}
            {displayFlows.length > 0 && (
              <div>
                <SectionLabel as="h5">{t.templates.card.use_cases_label}</SectionLabel>
                <div className="space-y-2">
                  {displayFlows.map((flow) => (
                    <div key={flow.id} className="flex items-start gap-2">
                      <CircleDot className="w-3 h-3 text-violet-400/60 flex-shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <span className="typo-body text-foreground font-medium">
                          {flow.name}
                        </span>
                        {flow.description && (
                          <p className="typo-caption text-foreground mt-0.5 line-clamp-2">
                            {flow.description}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Connector Configuration Status */}
            {connectors.length > 0 && (
              <div>
                <SectionLabel as="h5">{t.templates.card.connectors_label}</SectionLabel>
                <div className="space-y-1.5">
                  {connectors.map((c) => {
                    const meta = getConnectorMeta(c);
                    const status = readinessStatuses.find((s) => s.connector_name === c);
                    const isReady = status?.health === 'ready';
                    return (
                      <div key={c} className="flex items-center gap-2">
                        <div
                          className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
                          style={{ backgroundColor: `${meta.color}18` }}
                        >
                          <ConnectorIcon meta={meta} size="w-3 h-3" />
                        </div>
                        <span className="typo-body text-foreground flex-1 truncate">
                          {meta.label}
                        </span>
                        {isReady ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400/70 flex-shrink-0" />
                        ) : (
                          <XCircle className="w-3.5 h-3.5 text-foreground flex-shrink-0" />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* System Prompt Preview */}
            {systemPromptPreview && (
              <div>
                <SectionLabel as="h5" className="flex items-center gap-1.5">
                  <FileText className="w-3 h-3" />
                  {t.templates.card.system_prompt}
                </SectionLabel>
                <p className="typo-code text-foreground leading-relaxed bg-primary/3 rounded-card px-2.5 py-2 font-mono">
                  {systemPromptPreview}
                </p>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
