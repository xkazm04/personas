import { useState, useRef, useCallback, memo } from 'react';
import { motion } from 'framer-motion';
import { useTemplateMotion } from '@/features/templates/animationPresets';
import { useTemplateCardData } from '../useTemplateCardData';
import { TemplateCardHeader } from './TemplateCardHeader';
import { TemplateCardBody } from './TemplateCardBody';
import { TemplateCardFooter } from './TemplateCardFooter';
import { TemplateCardPreview } from './TemplateCardPreview';
import { PREVIEW_DELAY_MS } from './templateCardTypes';
import type { TemplateCardProps } from './templateCardTypes';

export const TemplateCard = memo(function TemplateCard({
  review,
  onAdopt,
  onViewDetails,
  onDelete,
  onViewFlows,
  onTryIt,
  installedConnectorNames,
  credentialServiceTypes,
}: TemplateCardProps) {
  const { motion: MOTION, prefersReducedMotion } = useTemplateMotion();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = useCallback(() => {
    setHasInteracted(true);
    hoverTimerRef.current = setTimeout(() => setPreviewOpen(true), PREVIEW_DELAY_MS);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setPreviewOpen(false);
  }, []);

  const {
    connectors,
    triggerTypes,
    designResult,
    displayFlows,
    suggestedTriggers,
    readinessStatuses,
    readinessScore,
    tier,
    verification,
    systemPromptPreview,
    difficultyMeta,
    setupMeta,
  } = useTemplateCardData(review, installedConnectorNames, credentialServiceTypes, hasInteracted);

  return (
    <div
      className="relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <motion.div
        layoutId={`template-card-${review.id}`}
        className={`group rounded-xl border border-primary/10 bg-secondary/30 hover:bg-secondary/50 hover:border-primary/15 transition-colors ${MOTION.smooth.css}`}
      >
        <TemplateCardHeader
          name={review.test_case_name}
          instruction={review.instruction}
          verification={verification}
          readinessScore={readinessScore}
          tier={tier}
          motionCss={MOTION.snappy.css}
          onViewDetails={onViewDetails}
          onDelete={onDelete}
          difficultyMeta={difficultyMeta}
          setupMeta={setupMeta}
        />

        <TemplateCardBody
          connectors={connectors}
          triggerTypes={triggerTypes}
          suggestedTriggers={suggestedTriggers}
          displayFlows={displayFlows}
          readinessStatuses={readinessStatuses}
          onViewFlows={onViewFlows}
        />

        <TemplateCardFooter
          designResult={designResult}
          displayFlows={displayFlows}
          onAdopt={onAdopt}
          onTryIt={onTryIt}
          onViewFlows={onViewFlows}
        />
      </motion.div>

      <TemplateCardPreview
        reviewId={review.id}
        name={review.test_case_name}
        instruction={review.instruction}
        connectors={connectors}
        displayFlows={displayFlows}
        readinessStatuses={readinessStatuses}
        systemPromptPreview={systemPromptPreview}
        previewOpen={previewOpen}
        prefersReducedMotion={prefersReducedMotion}
      />
    </div>
  );
});
